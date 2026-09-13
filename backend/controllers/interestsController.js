'use strict';

const { query } = require('../config/db');

async function isBlocked(userA, userB) {
  const { rows } = await query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)`,
    [userA, userB]
  );
  return rows.length > 0;
}

// ── POST /api/interests/likes/:id ─────────────────────────────────────────────
async function likeUser(req, res) {
  const { id: likedId } = req.params;
  if (likedId === req.user.id) {
    return res.status(400).json({ error: 'You cannot like yourself.' });
  }
  try {
    if (await isBlocked(req.user.id, likedId)) {
      return res.status(403).json({ error: 'Cannot like this member.' });
    }
    await query(
      `INSERT INTO profile_likes (liker_id, liked_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, likedId]
    );
    res.status(201).json({ message: 'Liked.' });
  } catch (err) {
    console.error('[likeUser]', err.message);
    res.status(500).json({ error: 'Could not like this member.' });
  }
}

// ── DELETE /api/interests/likes/:id ───────────────────────────────────────────
async function unlikeUser(req, res) {
  const { id: likedId } = req.params;
  try {
    await query('DELETE FROM profile_likes WHERE liker_id = $1 AND liked_id = $2', [req.user.id, likedId]);
    res.json({ message: 'Unliked.' });
  } catch (err) {
    console.error('[unlikeUser]', err.message);
    res.status(500).json({ error: 'Could not unlike this member.' });
  }
}

// Shared projection for the three list endpoints below.
const MEMBER_FIELDS = `
  p.user_id, p.display_name, p.bio, p.avatar_url, p.heading,
  CASE WHEN p.show_location THEN p.location ELSE NULL END AS location,
  u.membership_tier
`;

// ── GET /api/interests/liked ───────────────────────────────────────────────────
// Members the current user has liked.
async function listLiked(req, res) {
  try {
    const { rows } = await query(
      `SELECT ${MEMBER_FIELDS}, pl.created_at AS liked_at
       FROM profile_likes pl
       JOIN profiles p ON p.user_id = pl.liked_id
       JOIN users u ON u.id = p.user_id
       WHERE pl.liker_id = $1 AND u.is_active = TRUE
       ORDER BY pl.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listLiked]', err.message);
    res.status(500).json({ error: 'Could not fetch liked members.' });
  }
}

// ── GET /api/interests/liked-me ────────────────────────────────────────────────
// Members who have liked the current user, with whether it's mutual.
async function listLikedMe(req, res) {
  try {
    const { rows } = await query(
      `SELECT ${MEMBER_FIELDS}, pl.created_at AS liked_at,
              EXISTS (
                SELECT 1 FROM profile_likes back
                WHERE back.liker_id = $1 AND back.liked_id = pl.liker_id
              ) AS mutual
       FROM profile_likes pl
       JOIN profiles p ON p.user_id = pl.liker_id
       JOIN users u ON u.id = p.user_id
       WHERE pl.liked_id = $1 AND u.is_active = TRUE
       ORDER BY pl.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listLikedMe]', err.message);
    res.status(500).json({ error: 'Could not fetch members who liked you.' });
  }
}

// ── GET /api/interests/viewed-me ───────────────────────────────────────────────
async function listViewedMe(req, res) {
  try {
    const { rows } = await query(
      `SELECT ${MEMBER_FIELDS}, pv.viewed_at
       FROM profile_views pv
       JOIN profiles p ON p.user_id = pv.viewer_id
       JOIN users u ON u.id = p.user_id
       WHERE pv.viewed_id = $1 AND u.is_active = TRUE
       ORDER BY pv.viewed_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listViewedMe]', err.message);
    res.status(500).json({ error: 'Could not fetch recent viewers.' });
  }
}

module.exports = { likeUser, unlikeUser, listLiked, listLikedMe, listViewedMe };
