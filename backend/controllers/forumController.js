'use strict';

const { query, withTransaction } = require('../config/db');

// ── Shared post projection ────────────────────────────────────────────────────
// $1 is always the viewer's own user id (for liked_by_me). Used by both the
// feed and single-post lookups so the shape never drifts between them.
const POST_SELECT = `
  SELECT
    p.id, p.body, p.repost_of_id, p.created_at,
    p.author_id, pa.display_name AS author_name, pa.avatar_url AS author_avatar, ua.membership_tier AS author_tier,
    (SELECT COUNT(*) FROM forum_post_likes WHERE post_id = p.id)::int AS like_count,
    (SELECT COUNT(*) FROM forum_comments WHERE post_id = p.id AND is_deleted = FALSE)::int AS comment_count,
    (SELECT COUNT(*) FROM forum_posts r WHERE r.repost_of_id = p.id AND r.is_deleted = FALSE)::int AS repost_count,
    EXISTS(SELECT 1 FROM forum_post_likes WHERE post_id = p.id AND user_id = $1) AS liked_by_me,
    (SELECT COALESCE(json_agg(json_build_object('id', mu.id, 'display_name', mp.display_name)), '[]')
       FROM forum_mentions fm
       JOIN users mu ON mu.id = fm.mentioned_user_id
       JOIN profiles mp ON mp.user_id = mu.id
       WHERE fm.post_id = p.id) AS mentions,
    -- present only when this post is a repost, NULL if it's a plain post or
    -- the original was deleted (ON DELETE SET NULL on repost_of_id)
    orig.id AS orig_id, orig.body AS orig_body, orig.created_at AS orig_created_at, orig.author_id AS orig_author_id,
    origpa.display_name AS orig_author_name, origpa.avatar_url AS orig_author_avatar
  FROM forum_posts p
  JOIN users ua ON ua.id = p.author_id
  JOIN profiles pa ON pa.user_id = p.author_id
  LEFT JOIN forum_posts orig ON orig.id = p.repost_of_id AND orig.is_deleted = FALSE
  LEFT JOIN profiles origpa ON origpa.user_id = orig.author_id
`;

function shapePost(row) {
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    author: { id: row.author_id, display_name: row.author_name, avatar_url: row.author_avatar, membership_tier: row.author_tier },
    like_count: row.like_count,
    comment_count: row.comment_count,
    repost_count: row.repost_count,
    liked_by_me: row.liked_by_me,
    mentions: row.mentions,
    repost_of: row.repost_of_id ? (
      row.orig_id ? {
        id: row.orig_id,
        body: row.orig_body,
        created_at: row.orig_created_at,
        author: { id: row.orig_author_id, display_name: row.orig_author_name, avatar_url: row.orig_author_avatar },
      } : null // original was deleted
    ) : null,
  };
}

// ── GET /api/forum/posts ───────────────────────────────────────────────────────
async function listFeed(req, res) {
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await query(
      `${POST_SELECT}
       WHERE p.is_deleted = FALSE
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({ posts: rows.map(shapePost), page, limit });
  } catch (err) {
    console.error('[forum.listFeed]', err.message);
    res.status(500).json({ error: 'Could not load the feed.' });
  }
}

// ── POST /api/forum/posts ──────────────────────────────────────────────────────
// Also handles reposts (repost_of_id set) and quote-reposts (both body and
// repost_of_id set) — gated to Gold/Black by requireTier('gold') on the route.
async function createPost(req, res) {
  const { body, repost_of_id, mentioned_user_ids } = req.body;

  if (!body && !repost_of_id) {
    return res.status(422).json({ error: 'A post needs either text or something to repost.' });
  }

  try {
    let originalAuthorId = null;
    if (repost_of_id) {
      const { rows } = await query('SELECT author_id FROM forum_posts WHERE id = $1 AND is_deleted = FALSE', [repost_of_id]);
      if (!rows.length) return res.status(404).json({ error: 'The post you tried to repost no longer exists.' });
      originalAuthorId = rows[0].author_id;
    }

    const mentionIds = Array.isArray(mentioned_user_ids) ? [...new Set(mentioned_user_ids)].filter(id => id !== req.user.id) : [];
    let validMentionIds = [];
    if (mentionIds.length) {
      const { rows } = await query(
        `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_approved = TRUE AND is_active = TRUE`,
        [mentionIds]
      );
      validMentionIds = rows.map(r => r.id);
    }

    const postId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO forum_posts (author_id, body, repost_of_id) VALUES ($1, $2, $3) RETURNING id`,
        [req.user.id, body || null, repost_of_id || null]
      );
      const newPostId = rows[0].id;

      for (const uid of validMentionIds) {
        await client.query(`INSERT INTO forum_mentions (post_id, mentioned_user_id) VALUES ($1, $2)`, [newPostId, uid]);
        await client.query(
          `INSERT INTO forum_notifications (user_id, actor_id, type, post_id) VALUES ($1, $2, 'mention', $3)`,
          [uid, req.user.id, newPostId]
        );
      }

      if (originalAuthorId && originalAuthorId !== req.user.id) {
        await client.query(
          `INSERT INTO forum_notifications (user_id, actor_id, type, post_id) VALUES ($1, $2, 'repost', $3)`,
          [originalAuthorId, req.user.id, newPostId]
        );
      }

      return newPostId;
    });

    const { rows } = await query(`${POST_SELECT} WHERE p.id = $2`, [req.user.id, postId]);
    res.status(201).json(shapePost(rows[0]));
  } catch (err) {
    console.error('[forum.createPost]', err.message);
    res.status(500).json({ error: 'Could not create post.' });
  }
}

// ── DELETE /api/forum/posts/:id ────────────────────────────────────────────────
async function deletePost(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query('SELECT author_id FROM forum_posts WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found.' });
    if (rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own posts.' });
    }
    await query('UPDATE forum_posts SET is_deleted = TRUE WHERE id = $1', [id]);
    res.json({ message: 'Post deleted.' });
  } catch (err) {
    console.error('[forum.deletePost]', err.message);
    res.status(500).json({ error: 'Could not delete post.' });
  }
}

// ── POST /api/forum/posts/:id/like ────────────────────────────────────────────
async function likePost(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query('SELECT author_id FROM forum_posts WHERE id = $1 AND is_deleted = FALSE', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found.' });

    await query(
      `INSERT INTO forum_post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, req.user.id]
    );

    if (rows[0].author_id !== req.user.id) {
      await query(
        `INSERT INTO forum_notifications (user_id, actor_id, type, post_id) VALUES ($1, $2, 'like', $3)`,
        [rows[0].author_id, req.user.id, id]
      );
    }
    res.json({ message: 'Liked.' });
  } catch (err) {
    console.error('[forum.likePost]', err.message);
    res.status(500).json({ error: 'Could not like post.' });
  }
}

// ── DELETE /api/forum/posts/:id/like ──────────────────────────────────────────
async function unlikePost(req, res) {
  const { id } = req.params;
  try {
    await query('DELETE FROM forum_post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ message: 'Unliked.' });
  } catch (err) {
    console.error('[forum.unlikePost]', err.message);
    res.status(500).json({ error: 'Could not unlike post.' });
  }
}

// ── GET /api/forum/posts/:id/comments ─────────────────────────────────────────
async function listComments(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT c.id, c.body, c.created_at, c.author_id, p.display_name AS author_name, p.avatar_url AS author_avatar
       FROM forum_comments c
       JOIN profiles p ON p.user_id = c.author_id
       WHERE c.post_id = $1 AND c.is_deleted = FALSE
       ORDER BY c.created_at ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[forum.listComments]', err.message);
    res.status(500).json({ error: 'Could not load comments.' });
  }
}

// ── POST /api/forum/posts/:id/comments ────────────────────────────────────────
// Open to any approved member, not just Gold/Black — only posting to the feed
// itself is tier-gated.
async function createComment(req, res) {
  const { id } = req.params;
  const { body } = req.body;

  try {
    const { rows: postRows } = await query('SELECT author_id FROM forum_posts WHERE id = $1 AND is_deleted = FALSE', [id]);
    if (!postRows.length) return res.status(404).json({ error: 'Post not found.' });

    const { rows } = await query(
      `WITH inserted AS (
         INSERT INTO forum_comments (post_id, author_id, body) VALUES ($1, $2, $3)
         RETURNING id, body, created_at, author_id
       )
       SELECT i.*, p.display_name AS author_name, p.avatar_url AS author_avatar
       FROM inserted i JOIN profiles p ON p.user_id = i.author_id`,
      [id, req.user.id, body]
    );

    if (postRows[0].author_id !== req.user.id) {
      await query(
        `INSERT INTO forum_notifications (user_id, actor_id, type, post_id) VALUES ($1, $2, 'comment', $3)`,
        [postRows[0].author_id, req.user.id, id]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[forum.createComment]', err.message);
    res.status(500).json({ error: 'Could not post comment.' });
  }
}

// ── DELETE /api/forum/comments/:id ────────────────────────────────────────────
async function deleteComment(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query('SELECT author_id FROM forum_comments WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Comment not found.' });
    if (rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own comments.' });
    }
    await query('UPDATE forum_comments SET is_deleted = TRUE WHERE id = $1', [id]);
    res.json({ message: 'Comment deleted.' });
  } catch (err) {
    console.error('[forum.deleteComment]', err.message);
    res.status(500).json({ error: 'Could not delete comment.' });
  }
}

// ── GET /api/forum/mention-candidates?q= ──────────────────────────────────────
async function searchMentionCandidates(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { rows } = await query(
      `SELECT u.id, p.display_name, p.avatar_url
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.is_approved = TRUE AND u.is_active = TRUE AND u.id <> $1
         AND p.display_name ILIKE $2
       ORDER BY p.display_name ASC
       LIMIT 8`,
      [req.user.id, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error('[forum.searchMentionCandidates]', err.message);
    res.status(500).json({ error: 'Could not search members.' });
  }
}

// ── GET /api/forum/notifications ──────────────────────────────────────────────
async function listNotifications(req, res) {
  try {
    const { rows } = await query(
      `SELECT n.id, n.type, n.is_read, n.created_at, n.post_id,
              n.actor_id, ap.display_name AS actor_name, ap.avatar_url AS actor_avatar,
              fp.body AS post_body
       FROM forum_notifications n
       JOIN profiles ap ON ap.user_id = n.actor_id
       LEFT JOIN forum_posts fp ON fp.id = n.post_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[forum.listNotifications]', err.message);
    res.status(500).json({ error: 'Could not load notifications.' });
  }
}

// ── GET /api/forum/notifications/unread-count ─────────────────────────────────
async function getUnreadCount(req, res) {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count FROM forum_notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error('[forum.getUnreadCount]', err.message);
    res.status(500).json({ error: 'Could not load notification count.' });
  }
}

// ── POST /api/forum/notifications/read ────────────────────────────────────────
async function markNotificationsRead(req, res) {
  try {
    await query(`UPDATE forum_notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`, [req.user.id]);
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    console.error('[forum.markNotificationsRead]', err.message);
    res.status(500).json({ error: 'Could not update notifications.' });
  }
}

module.exports = {
  listFeed, createPost, deletePost, likePost, unlikePost,
  listComments, createComment, deleteComment,
  searchMentionCandidates, listNotifications, getUnreadCount, markNotificationsRead,
};
