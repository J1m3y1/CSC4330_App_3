'use strict';

const { query } = require('../config/db');

const TIER_RANK = { free: 0, silver: 1, gold: 2, black: 3 };

// ── GET /api/chatrooms ────────────────────────────────────────────────────────
// List all active rooms the current user's tier can access.
async function listRooms(req, res) {
  try {
    const userRank = TIER_RANK[req.user.membership_tier] ?? 0;

    const { rows } = await query(
      `SELECT
         c.id, c.name, c.description, c.min_tier, c.created_at, c.created_by,
         COUNT(cm.id) FILTER (WHERE cm.is_deleted = FALSE) AS message_count,
         MAX(cm.created_at) AS last_message_at
       FROM chatrooms c
       LEFT JOIN chatroom_messages cm ON cm.room_id = c.id
       WHERE c.is_active = TRUE
         AND CASE c.min_tier
               WHEN 'free'   THEN 0
               WHEN 'silver' THEN 1
               WHEN 'gold'   THEN 2
               WHEN 'black'  THEN 3
             END <= $1
       GROUP BY c.id
       ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC`,
      [userRank]
    );

    res.json(rows);
  } catch (err) {
    console.error('[listRooms]', err.message);
    res.status(500).json({ error: 'Could not fetch chatrooms.' });
  }
}

// ── GET /api/chatrooms/:roomId/messages ───────────────────────────────────────
// Paginated message history for a room (newest-first, reversed for display).
async function getRoomMessages(req, res) {
  const { roomId } = req.params;
  const pageNum  = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const offset   = (pageNum - 1) * limitNum;

  try {
    // Verify room exists and user's tier meets the minimum
    const { rows: roomRows } = await query(
      'SELECT id, min_tier FROM chatrooms WHERE id = $1 AND is_active = TRUE',
      [roomId]
    );
    if (!roomRows.length) return res.status(404).json({ error: 'Chatroom not found.' });

    if (TIER_RANK[req.user.membership_tier] < TIER_RANK[roomRows[0].min_tier]) {
      return res.status(403).json({ error: 'Your membership tier cannot access this room.' });
    }

    const { rows } = await query(
      `SELECT
         cm.id, cm.room_id, cm.sender_id, cm.body, cm.created_at,
         p.display_name AS sender_name,
         p.avatar_url   AS sender_avatar
       FROM chatroom_messages cm
       JOIN profiles p ON p.user_id = cm.sender_id
       WHERE cm.room_id = $1 AND cm.is_deleted = FALSE
       ORDER BY cm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [roomId, limitNum, offset]
    );

    res.json({
      messages: rows.reverse(), // chronological order for display
      pagination: { page: pageNum, limit: limitNum },
    });
  } catch (err) {
    console.error('[getRoomMessages]', err.message);
    res.status(500).json({ error: 'Could not fetch messages.' });
  }
}

// ── POST /api/chatrooms/:roomId/messages ──────────────────────────────────────
// Post a message to a chatroom.
async function postRoomMessage(req, res) {
  const { roomId } = req.params;
  const { body }   = req.body;

  try {
    // Verify room and tier access
    const { rows: roomRows } = await query(
      'SELECT id, min_tier FROM chatrooms WHERE id = $1 AND is_active = TRUE',
      [roomId]
    );
    if (!roomRows.length) return res.status(404).json({ error: 'Chatroom not found.' });

    if (TIER_RANK[req.user.membership_tier] < TIER_RANK[roomRows[0].min_tier]) {
      return res.status(403).json({ error: 'Your membership tier cannot post in this room.' });
    }

    const { rows } = await query(
      `INSERT INTO chatroom_messages (room_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, room_id, sender_id, body, created_at`,
      [roomId, req.user.id, body]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[postRoomMessage]', err.message);
    res.status(500).json({ error: 'Could not post message.' });
  }
}

// ── DELETE /api/chatrooms/:roomId/messages/:messageId ─────────────────────────
// Soft-delete own message. Admins can delete any message.
async function deleteRoomMessage(req, res) {
  const { roomId, messageId } = req.params;

  try {
    const { rows } = await query(
      'SELECT sender_id FROM chatroom_messages WHERE id = $1 AND room_id = $2',
      [messageId, roomId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Message not found.' });

    const isOwner = rows[0].sender_id === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own messages.' });
    }

    await query(
      'UPDATE chatroom_messages SET is_deleted = TRUE WHERE id = $1',
      [messageId]
    );

    res.json({ message: 'Message deleted.' });
  } catch (err) {
    console.error('[deleteRoomMessage]', err.message);
    res.status(500).json({ error: 'Could not delete message.' });
  }
}

// ── POST /api/chatrooms (admin only) ─────────────────────────────────────────
// Create a new chatroom.
async function createRoom(req, res) {
  const { name, description, min_tier = 'free' } = req.body;

  try {
    const { rows } = await query(
      `INSERT INTO chatrooms (name, description, min_tier, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, min_tier, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'A chatroom with that name already exists.' });
    }
    console.error('[createRoom]', err.message);
    res.status(500).json({ error: 'Could not create chatroom.' });
  }
}

// ── PATCH /api/chatrooms/:roomId (admin only) ─────────────────────────────────
// Update room details or deactivate it.
async function updateRoom(req, res) {
  const { roomId } = req.params;
  const { name, description, min_tier, is_active } = req.body;

  const updates = [];
  const values  = [];
  let   idx     = 1;

  const set = (col, val) => { updates.push(`${col} = $${idx++}`); values.push(val); };

  if (name        !== undefined) set('name',        name);
  if (description !== undefined) set('description', description);
  if (min_tier    !== undefined) set('min_tier',    min_tier);
  if (is_active   !== undefined) set('is_active',   is_active);

  if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });

  values.push(roomId);

  try {
    const { rows } = await query(
      `UPDATE chatrooms SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Chatroom not found.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A chatroom with that name already exists.' });
    }
    console.error('[updateRoom]', err.message);
    res.status(500).json({ error: 'Could not update chatroom.' });
  }
}

module.exports = {
  listRooms, getRoomMessages, postRoomMessage,
  deleteRoomMessage, createRoom, updateRoom,
};
