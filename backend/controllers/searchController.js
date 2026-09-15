'use strict';

const { query } = require('../config/db');

// Same block-exclusion convention as messagesController.js/groupsController.js.
const BLOCK_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM blocks b
  WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
     OR (b.blocker_id = u.id AND b.blocked_id = $1)
)`;
// Simple black_only_visibility mask — same lightweight pattern forumController.js
// already uses for previews (not the fuller "approved view request" exception
// discoverController.js's full profile view has; a search preview doesn't need it).
const VISIBILITY_MASK = `(NOT p.black_only_visibility OR $2 = 'black')`;

function likeParam(q) {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

async function searchMembers(userId, tier, needle, limit, offset) {
  const like = likeParam(needle);
  const countRes = await query(
    `SELECT COUNT(*) FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE u.is_approved = TRUE AND u.is_active = TRUE AND u.id <> $1
       AND p.display_name ILIKE $3 AND ${VISIBILITY_MASK} AND ${BLOCK_EXCLUSION}`,
    [userId, tier, like]
  );
  const { rows } = await query(
    `SELECT p.user_id, p.display_name, p.avatar_url, u.membership_tier
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE u.is_approved = TRUE AND u.is_active = TRUE AND u.id <> $1
       AND p.display_name ILIKE $3 AND ${VISIBILITY_MASK} AND ${BLOCK_EXCLUSION}
     ORDER BY p.display_name ASC LIMIT $4 OFFSET $5`,
    [userId, tier, like, limit, offset]
  );
  return { rows, total: parseInt(countRes.rows[0].count, 10) };
}

async function searchGroups(needle, limit, offset) {
  const like = likeParam(needle);
  const countRes = await query(
    `SELECT COUNT(*) FROM groups WHERE is_active = TRUE AND (name ILIKE $1 OR description ILIKE $1)`,
    [like]
  );
  const { rows } = await query(
    `SELECT id, name, description, category, location, state FROM groups
     WHERE is_active = TRUE AND (name ILIKE $1 OR description ILIKE $1)
     ORDER BY name ASC LIMIT $2 OFFSET $3`,
    [like, limit, offset]
  );
  return { rows, total: parseInt(countRes.rows[0].count, 10) };
}

async function searchEvents(needle, limit, offset) {
  const like = likeParam(needle);
  const countRes = await query(
    `SELECT COUNT(*) FROM events WHERE is_active = TRUE AND (title ILIKE $1 OR description ILIKE $1)`,
    [like]
  );
  const { rows } = await query(
    `SELECT id, title, description, location, state, event_date FROM events
     WHERE is_active = TRUE AND (title ILIKE $1 OR description ILIKE $1)
     ORDER BY event_date ASC LIMIT $2 OFFSET $3`,
    [like, limit, offset]
  );
  return { rows, total: parseInt(countRes.rows[0].count, 10) };
}

async function searchPosts(tier, needle, limit, offset) {
  const like = likeParam(needle);
  const countRes = await query(
    `SELECT COUNT(*) FROM forum_posts p JOIN profiles pa ON pa.user_id = p.author_id
     WHERE p.is_deleted = FALSE AND p.body ILIKE $2 AND (NOT pa.black_only_visibility OR $1 = 'black')`,
    [tier, like]
  );
  const { rows } = await query(
    `SELECT p.id, p.body, p.created_at, pa.display_name AS author_name, pa.avatar_url AS author_avatar
     FROM forum_posts p JOIN profiles pa ON pa.user_id = p.author_id
     WHERE p.is_deleted = FALSE AND p.body ILIKE $2 AND (NOT pa.black_only_visibility OR $1 = 'black')
     ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`,
    [tier, like, limit, offset]
  );
  return { rows, total: parseInt(countRes.rows[0].count, 10) };
}

async function searchResources(needle, limit, offset) {
  const like = likeParam(needle);
  const countRes = await query(
    `SELECT COUNT(*) FROM dictionary_terms WHERE term ILIKE $1 OR definition ILIKE $1`,
    [like]
  );
  const { rows } = await query(
    `SELECT id, term, slug, definition, category FROM dictionary_terms
     WHERE term ILIKE $1 OR definition ILIKE $1
     ORDER BY term ASC LIMIT $2 OFFSET $3`,
    [like, limit, offset]
  );
  return { rows, total: parseInt(countRes.rows[0].count, 10) };
}

const CATEGORY_HANDLERS = {
  members:   (req, limit, offset) => searchMembers(req.user.id, req.user.membership_tier, req.query.q, limit, offset),
  groups:    (req, limit, offset) => searchGroups(req.query.q, limit, offset),
  events:    (req, limit, offset) => searchEvents(req.query.q, limit, offset),
  posts:     (req, limit, offset) => searchPosts(req.user.membership_tier, req.query.q, limit, offset),
  resources: (req, limit, offset) => searchResources(req.query.q, limit, offset),
};

// ── GET /api/search ─────────────────────────────────────────────────────────────
// With ?category=X: full paginated results for that one category (the
// SearchResults page's "View all" links land here). Without it: a small
// slice (10) of every category at once, for the combined overview.
async function search(req, res) {
  const { category } = req.query;
  const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);

  try {
    if (category) {
      const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;
      const { rows, total } = await CATEGORY_HANDLERS[category](req, limit, offset);
      return res.json({ [category]: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    }

    const limit = 10;
    const results = {};
    for (const [name, handler] of Object.entries(CATEGORY_HANDLERS)) {
      const { rows, total } = await handler(req, limit, 0);
      results[name] = { items: rows, total };
    }
    res.json(results);
  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: 'Search failed. Please try again.' });
  }
}

// ── GET /api/search/typeahead ───────────────────────────────────────────────────
// Powers the header's live-typing flyout — top 5 per category, no pagination.
async function typeahead(req, res) {
  try {
    const results = {};
    for (const [name, handler] of Object.entries(CATEGORY_HANDLERS)) {
      const { rows } = await handler(req, 5, 0);
      results[name] = rows;
    }
    res.json(results);
  } catch (err) {
    console.error('[typeahead]', err.message);
    res.status(500).json({ error: 'Search failed.' });
  }
}

module.exports = { search, typeahead };
