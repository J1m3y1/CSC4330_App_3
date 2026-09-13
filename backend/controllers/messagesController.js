'use strict';

const { query } = require('../config/db');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Check whether recipient allows messages from the sender's tier
async function canMessage(senderId, senderTier, recipientId) {
  const { rows } = await query(
    `SELECT p.allow_messages_from
     FROM profiles p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1
       AND u.is_active   = TRUE
       AND u.is_approved = TRUE`,
    [recipientId]
  );
  if (!rows.length) return { allowed: false, reason: 'User not found.' };

  const pref = rows[0].allow_messages_from;
  if (pref === 'nobody') return { allowed: false, reason: 'This member is not accepting messages.' };
  if (pref === 'gold_plus' && !['gold', 'black'].includes(senderTier)) {
    return { allowed: false, reason: 'This member only accepts messages from Gold or Black members.' };
  }
  return { allowed: true };
}

// Check if either user has blocked the other
async function isBlocked(userA, userB) {
  const { rows } = await query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)`,
    [userA, userB]
  );
  return rows.length > 0;
}

// ── GET /api/messages/conversations ──────────────────────────────────────────
// Returns a list of unique conversation partners with the latest message each.
async function getConversations(req, res) {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (partner_id)
         partner_id,
         partner_name,
         partner_avatar,
         last_body,
         last_sent_at,
         unread_count
       FROM (
         SELECT
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS partner_id,
           p.display_name AS partner_name,
           p.avatar_url   AS partner_avatar,
           m.body         AS last_body,
           m.created_at   AS last_sent_at,
           COUNT(*) FILTER (
             WHERE m.recipient_id = $1 AND m.status <> 'read'
           ) OVER (PARTITION BY
             CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
           ) AS unread_count
         FROM messages m
         JOIN profiles p ON p.user_id =
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
         WHERE (m.sender_id = $1 AND m.is_deleted_by_sender    = FALSE)
            OR (m.recipient_id = $1 AND m.is_deleted_by_recipient = FALSE)
         ORDER BY
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END,
           m.created_at DESC
       ) sub
       ORDER BY partner_id, last_sent_at DESC`,
      [req.user.id]
    );

    // Sort conversations by most recent message
    rows.sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
    res.json(rows);
  } catch (err) {
    console.error('[getConversations]', err.message);
    res.status(500).json({ error: 'Could not fetch conversations.' });
  }
}

// ── GET /api/messages/:partnerId ─────────────────────────────────────────────
// Returns paginated messages in a thread between the current user and a partner.
async function getThread(req, res) {
  const { partnerId } = req.params;
  const pageNum  = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const offset   = (pageNum - 1) * limitNum;

  try {
    if (await isBlocked(req.user.id, partnerId)) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const { rows } = await query(
      `SELECT m.id, m.sender_id, m.recipient_id, m.body, m.status, m.created_at
       FROM messages m
       WHERE (
         (m.sender_id = $1 AND m.recipient_id = $2 AND m.is_deleted_by_sender    = FALSE) OR
         (m.sender_id = $2 AND m.recipient_id = $1 AND m.is_deleted_by_recipient = FALSE)
       )
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.id, partnerId, limitNum, offset]
    );

    // Mark fetched messages as read
    await query(
      `UPDATE messages SET status = 'read'
       WHERE sender_id = $2 AND recipient_id = $1 AND status <> 'read'`,
      [req.user.id, partnerId]
    );

    res.json({ messages: rows.reverse(), pagination: { page: pageNum, limit: limitNum } });
  } catch (err) {
    console.error('[getThread]', err.message);
    res.status(500).json({ error: 'Could not fetch messages.' });
  }
}

// ── POST /api/messages/:partnerId ────────────────────────────────────────────
// Send a new direct message.
async function sendMessage(req, res) {
  const { partnerId } = req.params;
  const { body }      = req.body;

  if (partnerId === req.user.id) {
    return res.status(400).json({ error: 'You cannot message yourself.' });
  }

  try {
    // Block check
    if (await isBlocked(req.user.id, partnerId)) {
      return res.status(403).json({ error: 'Cannot send message.' });
    }

    // Privacy / tier check
    const { allowed, reason } = await canMessage(
      req.user.id, req.user.membership_tier, partnerId
    );
    if (!allowed) return res.status(403).json({ error: reason });

    const { rows } = await query(
      `INSERT INTO messages (sender_id, recipient_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, recipient_id, body, status, created_at`,
      [req.user.id, partnerId, body]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[sendMessage]', err.message);
    res.status(500).json({ error: 'Could not send message.' });
  }
}

// ── DELETE /api/messages/:messageId ──────────────────────────────────────────
// Soft-delete a message for the requesting user only.
async function deleteMessage(req, res) {
  const { messageId } = req.params;

  try {
    // Only the sender or recipient can delete for themselves
    const { rows } = await query(
      'SELECT sender_id, recipient_id FROM messages WHERE id = $1',
      [messageId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Message not found.' });

    const msg = rows[0];
    if (msg.sender_id === req.user.id) {
      await query('UPDATE messages SET is_deleted_by_sender = TRUE WHERE id = $1', [messageId]);
    } else if (msg.recipient_id === req.user.id) {
      await query('UPDATE messages SET is_deleted_by_recipient = TRUE WHERE id = $1', [messageId]);
    } else {
      return res.status(403).json({ error: 'Not authorised.' });
    }

    res.json({ message: 'Message deleted.' });
  } catch (err) {
    console.error('[deleteMessage]', err.message);
    res.status(500).json({ error: 'Could not delete message.' });
  }
}

module.exports = { getConversations, getThread, sendMessage, deleteMessage };
