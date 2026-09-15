'use strict';

const { query } = require('../config/db');

// Block-excluded the same way messagesController.js checks it — a blocked
// pair should never see each other in a shared roster or directory listing.
const BLOCK_EXCLUSION = `NOT EXISTS (
  SELECT 1 FROM blocks b
  WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
     OR (b.blocker_id = u.id AND b.blocked_id = $1)
)`;

// ── GET /api/groups ────────────────────────────────────────────────────────────
async function listGroups(req, res) {
  const { state, category, q } = req.query;
  const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const params = [req.user.id];
    const clauses = ['g.is_active = TRUE'];
    if (state)    { params.push(state);            clauses.push(`g.state = $${params.length}`); }
    if (category) { params.push(category);          clauses.push(`g.category = $${params.length}`); }
    if (q)        { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); clauses.push(`g.name ILIKE $${params.length}`); }

    const where = clauses.join(' AND ');
    const countRes = await query(`SELECT COUNT(*) FROM groups g WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.category, g.location, g.state, g.cover_image_url, g.created_at,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
              EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1) AS is_member,
              (SELECT role FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1) AS my_role
       FROM groups g
       WHERE ${where}
       ORDER BY g.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ groups: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[listGroups]', err.message);
    res.status(500).json({ error: 'Could not fetch groups.' });
  }
}

// ── GET /api/groups/:id ────────────────────────────────────────────────────────
async function getGroup(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.category, g.location, g.state, g.cover_image_url, g.created_at, g.created_by,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
              EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $2) AS is_member,
              (SELECT role FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $2) AS my_role
       FROM groups g
       WHERE g.id = $1 AND g.is_active = TRUE`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[getGroup]', err.message);
    res.status(500).json({ error: 'Could not fetch group.' });
  }
}

// ── GET /api/groups/:id/members ────────────────────────────────────────────────
async function listGroupMembers(req, res) {
  const { id } = req.params;
  const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const countRes = await query(
      `SELECT COUNT(*) FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND ${BLOCK_EXCLUSION}`,
      [req.user.id, id]
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const { rows } = await query(
      `SELECT gm.user_id, gm.role, gm.joined_at, p.display_name, p.avatar_url
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       JOIN profiles p ON p.user_id = gm.user_id
       WHERE gm.group_id = $2 AND ${BLOCK_EXCLUSION}
       ORDER BY gm.role = 'owner' DESC, gm.joined_at ASC
       LIMIT $3 OFFSET $4`,
      [req.user.id, id, limit, offset]
    );

    res.json({ members: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[listGroupMembers]', err.message);
    res.status(500).json({ error: 'Could not fetch group members.' });
  }
}

// ── POST /api/groups ───────────────────────────────────────────────────────────
async function createGroup(req, res) {
  const { name, description, category, location, state } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO groups (name, description, category, location, state, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, category, location, state, created_at`,
      [name, description || null, category || null, location || null, state || null, req.user.id]
    );
    await query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [rows[0].id, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[createGroup]', err.message);
    res.status(500).json({ error: 'Could not create group.' });
  }
}

async function requireOwner(groupId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'owner'`,
    [groupId, userId]
  );
  return rows.length > 0;
}

// ── PATCH /api/groups/:id ──────────────────────────────────────────────────────
async function updateGroup(req, res) {
  const { id } = req.params;
  try {
    if (!(await requireOwner(id, req.user.id))) {
      return res.status(403).json({ error: 'Only the group owner can edit this group.' });
    }
    const fields = [];
    const params = [];
    const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
    if (req.body.name        !== undefined) set('name', req.body.name);
    if (req.body.description !== undefined) set('description', req.body.description);
    if (req.body.category    !== undefined) set('category', req.body.category);
    if (req.body.location    !== undefined) set('location', req.body.location);
    if (req.body.state       !== undefined) set('state', req.body.state);
    if (!fields.length) return res.status(400).json({ error: 'No fields to update.' });

    params.push(id);
    const { rows } = await query(
      `UPDATE groups SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING id, name, description, category, location, state`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[updateGroup]', err.message);
    res.status(500).json({ error: 'Could not update group.' });
  }
}

// ── DELETE /api/groups/:id ─────────────────────────────────────────────────────
async function deleteGroup(req, res) {
  const { id } = req.params;
  try {
    if (!(await requireOwner(id, req.user.id))) {
      return res.status(403).json({ error: 'Only the group owner can delete this group.' });
    }
    await query('UPDATE groups SET is_active = FALSE WHERE id = $1', [id]);
    res.json({ message: 'Group deleted.' });
  } catch (err) {
    console.error('[deleteGroup]', err.message);
    res.status(500).json({ error: 'Could not delete group.' });
  }
}

// ── POST /api/groups/:id/join ──────────────────────────────────────────────────
async function joinGroup(req, res) {
  const { id } = req.params;
  try {
    const groupRes = await query('SELECT id FROM groups WHERE id = $1 AND is_active = TRUE', [id]);
    if (!groupRes.rows.length) return res.status(404).json({ error: 'Group not found.' });

    await query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [id, req.user.id]
    );
    res.json({ joined: true });
  } catch (err) {
    console.error('[joinGroup]', err.message);
    res.status(500).json({ error: 'Could not join group.' });
  }
}

// ── POST /api/groups/:id/leave ─────────────────────────────────────────────────
// The owner can't leave their own group (no ownership-transfer flow exists
// yet) — they have to delete it instead, same as other admin-owned-resource
// patterns in this codebase.
async function leaveGroup(req, res) {
  const { id } = req.params;
  try {
    if (await requireOwner(id, req.user.id)) {
      return res.status(400).json({ error: 'As the owner, you can delete the group but cannot leave it.' });
    }
    await query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ joined: false });
  } catch (err) {
    console.error('[leaveGroup]', err.message);
    res.status(500).json({ error: 'Could not leave group.' });
  }
}

module.exports = {
  listGroups, getGroup, listGroupMembers, createGroup, updateGroup, deleteGroup, joinGroup, leaveGroup,
};
