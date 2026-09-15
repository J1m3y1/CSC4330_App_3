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

// Black-only visibility acts like a one-directional block that either side
// can trip: if either user has it on and the OTHER isn't Black, the pair
// can't message each other at all — checked everywhere isBlocked already is,
// so an old thread doesn't stay reachable after the setting is switched on.
async function blockedByVisibility(userA, userB) {
  const { rows } = await query(
    `SELECT p.user_id, p.black_only_visibility, u.membership_tier
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1 OR p.user_id = $2`,
    [userA, userB]
  );
  const a = rows.find(r => r.user_id === userA);
  const b = rows.find(r => r.user_id === userB);
  if (!a || !b) return false;
  return (a.black_only_visibility && b.membership_tier !== 'black')
      || (b.black_only_visibility && a.membership_tier !== 'black');
}

// ── Disappearing messages ────────────────────────────────────────────────────
// conversation_settings rows are keyed on the pair ordered smallest-UUID-first
// so there's exactly one row per conversation no matter who reads/writes it.
const DISAPPEARING_WINDOWS = [300, 3600, 86400, 604800]; // 5m, 1h, 24h, 7d

function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function getDisappearingSeconds(userA, userB) {
  const [a, b] = orderPair(userA, userB);
  const { rows } = await query(
    'SELECT disappearing_seconds FROM conversation_settings WHERE user_a = $1 AND user_b = $2',
    [a, b]
  );
  return rows[0]?.disappearing_seconds ?? null;
}

// Hard-deletes messages past their expiry — permanent, both sides, matching
// the Safety page's claim. Called opportunistically on read (below) and on
// a periodic sweep (see server.js) so messages disappear close to on time
// even if nobody happens to reload the thread.
async function purgeExpiredMessages() {
  await query('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
}

// ── GET /api/messages/conversations ──────────────────────────────────────────
// Returns a list of unique conversation partners with the latest message
// each. Only 'accepted' conversations, plus 'pending' ones where the CURRENT
// user is the one who sent the first message (so they can see their own
// outgoing request sitting in their own inbox) — a 'pending' conversation
// where the current user is the recipient belongs in getMessageRequests()
// instead, never here. ?view=archived flips to the Archived tab instead.
async function getConversations(req, res) {
  const archivedView = req.query.view === 'archived';
  try {
    await purgeExpiredMessages();
    const { rows } = await query(
      `SELECT DISTINCT ON (partner_id)
         partner_id, partner_name, partner_avatar, last_body, last_sent_at,
         unread_count, request_status, archived
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
           ) AS unread_count,
           COALESCE(cs.request_status, 'accepted') AS request_status,
           cs.updated_by AS request_initiator,
           CASE WHEN $1 = LEAST(m.sender_id, m.recipient_id)
                THEN COALESCE(cs.archived_by_a, FALSE)
                ELSE COALESCE(cs.archived_by_b, FALSE) END AS archived
         FROM messages m
         JOIN profiles p ON p.user_id =
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
         LEFT JOIN conversation_settings cs
           ON cs.user_a = LEAST(m.sender_id, m.recipient_id)
          AND cs.user_b = GREATEST(m.sender_id, m.recipient_id)
         WHERE (m.sender_id = $1 AND m.is_deleted_by_sender    = FALSE)
            OR (m.recipient_id = $1 AND m.is_deleted_by_recipient = FALSE)
         ORDER BY
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END,
           m.created_at DESC
       ) sub
       WHERE archived = $2
         AND (request_status = 'accepted' OR (request_status = 'pending' AND request_initiator = $1))
       ORDER BY partner_id, last_sent_at DESC`,
      [req.user.id, archivedView]
    );

    // Sort conversations by most recent message
    rows.sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
    res.json(rows);
  } catch (err) {
    console.error('[getConversations]', err.message);
    res.status(500).json({ error: 'Could not fetch conversations.' });
  }
}

// ── GET /api/messages/requests ────────────────────────────────────────────────
// Conversations still 'pending' where the CURRENT user is the recipient, not
// the original sender — i.e. someone the caller hasn't replied to (or
// accepted/declined) yet. Once request_status leaves 'pending' (via reply,
// accept, or decline) a thread stops appearing here regardless of direction.
async function getMessageRequests(req, res) {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (partner_id)
         partner_id, partner_name, partner_avatar, last_body, last_sent_at
       FROM (
         SELECT
           m.sender_id     AS partner_id,
           p.display_name  AS partner_name,
           p.avatar_url    AS partner_avatar,
           m.body          AS last_body,
           m.created_at    AS last_sent_at
         FROM messages m
         JOIN profiles p ON p.user_id = m.sender_id
         JOIN conversation_settings cs
           ON cs.user_a = LEAST(m.sender_id, m.recipient_id)
          AND cs.user_b = GREATEST(m.sender_id, m.recipient_id)
         WHERE m.recipient_id = $1
           AND m.is_deleted_by_recipient = FALSE
           AND cs.request_status = 'pending'
         ORDER BY m.sender_id, m.created_at DESC
       ) sub
       ORDER BY partner_id, last_sent_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[getMessageRequests]', err.message);
    res.status(500).json({ error: 'Could not fetch message requests.' });
  }
}

// ── POST /api/messages/:partnerId/accept-request ──────────────────────────────
async function acceptMessageRequest(req, res) {
  const { partnerId } = req.params;
  try {
    const [a, b] = orderPair(req.user.id, partnerId);
    const { rows } = await query(
      `UPDATE conversation_settings SET request_status = 'accepted', updated_at = NOW()
       WHERE user_a = $1 AND user_b = $2 AND request_status = 'pending' AND updated_by <> $3
       RETURNING request_status`,
      [a, b, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No pending request from this member.' });
    res.json({ request_status: 'accepted' });
  } catch (err) {
    console.error('[acceptMessageRequest]', err.message);
    res.status(500).json({ error: 'Could not accept request.' });
  }
}

// ── POST /api/messages/:partnerId/decline-request ─────────────────────────────
// Declining is permanent (no re-pending) and silent — the sender is never
// told they were declined. Their messages stay soft-deleted on the
// recipient's own side only, reusing the same is_deleted_by_recipient flag a
// normal delete already uses, so nothing new is invented for this.
async function declineMessageRequest(req, res) {
  const { partnerId } = req.params;
  try {
    const [a, b] = orderPair(req.user.id, partnerId);
    const { rows } = await query(
      `UPDATE conversation_settings SET request_status = 'declined', updated_at = NOW()
       WHERE user_a = $1 AND user_b = $2 AND request_status = 'pending' AND updated_by <> $3
       RETURNING request_status`,
      [a, b, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No pending request from this member.' });

    await query(
      `UPDATE messages SET is_deleted_by_recipient = TRUE WHERE sender_id = $1 AND recipient_id = $2`,
      [partnerId, req.user.id]
    );
    res.json({ request_status: 'declined' });
  } catch (err) {
    console.error('[declineMessageRequest]', err.message);
    res.status(500).json({ error: 'Could not decline request.' });
  }
}

// ── POST/DELETE /api/messages/:partnerId/archive ──────────────────────────────
// Per-side flag, same convention as messages.is_deleted_by_sender/recipient —
// archiving never affects the other party's view of the conversation.
async function archiveConversation(req, res) {
  const { partnerId } = req.params;
  try {
    const [a, b] = orderPair(req.user.id, partnerId);
    const column = req.user.id === a ? 'archived_by_a' : 'archived_by_b';
    await query(
      `INSERT INTO conversation_settings (user_a, user_b, request_status, updated_by, updated_at, ${column})
       VALUES ($1, $2, 'accepted', $3, NOW(), TRUE)
       ON CONFLICT (user_a, user_b) DO UPDATE SET ${column} = TRUE`,
      [a, b, req.user.id]
    );
    res.json({ archived: true });
  } catch (err) {
    console.error('[archiveConversation]', err.message);
    res.status(500).json({ error: 'Could not archive conversation.' });
  }
}

async function unarchiveConversation(req, res) {
  const { partnerId } = req.params;
  try {
    const [a, b] = orderPair(req.user.id, partnerId);
    const column = req.user.id === a ? 'archived_by_a' : 'archived_by_b';
    await query(
      `UPDATE conversation_settings SET ${column} = FALSE WHERE user_a = $1 AND user_b = $2`,
      [a, b]
    );
    res.json({ archived: false });
  } catch (err) {
    console.error('[unarchiveConversation]', err.message);
    res.status(500).json({ error: 'Could not unarchive conversation.' });
  }
}

// ── GET /api/messages/unread-count ─────────────────────────────────────────────
// Powers the header Inbox badge (accepted-conversation unread count) and the
// Message Requests tab badge (pending count) in one round trip.
async function getUnreadCount(req, res) {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (
           WHERE m.status <> 'read' AND COALESCE(cs.request_status, 'accepted') = 'accepted'
         ) AS unread,
         COUNT(DISTINCT CASE
           WHEN COALESCE(cs.request_status, 'accepted') = 'pending' AND cs.updated_by <> $1
           THEN m.sender_id
         END) AS pending_requests
       FROM messages m
       LEFT JOIN conversation_settings cs
         ON cs.user_a = LEAST(m.sender_id, m.recipient_id) AND cs.user_b = GREATEST(m.sender_id, m.recipient_id)
       WHERE m.recipient_id = $1 AND m.is_deleted_by_recipient = FALSE`,
      [req.user.id]
    );
    res.json({
      unread: parseInt(rows[0].unread, 10),
      pending_requests: parseInt(rows[0].pending_requests, 10),
    });
  } catch (err) {
    console.error('[getUnreadCount]', err.message);
    res.status(500).json({ error: 'Could not fetch unread count.' });
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
    if (await isBlocked(req.user.id, partnerId) || await blockedByVisibility(req.user.id, partnerId)) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    await purgeExpiredMessages();

    const { rows } = await query(
      `SELECT m.id, m.sender_id, m.recipient_id, m.body, m.status, m.created_at, m.expires_at
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
    if (await isBlocked(req.user.id, partnerId) || await blockedByVisibility(req.user.id, partnerId)) {
      return res.status(403).json({ error: 'Cannot send message.' });
    }

    // Privacy / tier check
    const { allowed, reason } = await canMessage(
      req.user.id, req.user.membership_tier, partnerId
    );
    if (!allowed) return res.status(403).json({ error: reason });

    // Message Requests: a brand-new pair starts 'pending' so the FIRST
    // message the recipient sees is a request, not a normal inbox entry
    // (see getConversations/getMessageRequests above). If the pair already
    // has a row and it's still 'pending' with someone else as the
    // initiator, the current sender must be the original recipient
    // replying — that's an implicit accept, same mental model as
    // Instagram/Twitter DM requests. Already-accepted or already-declined
    // pairs are left untouched either way; a declined pair still lets the
    // message send (soft/silent — see declineMessageRequest above), it just
    // never flips back to pending or accepted on its own.
    const [pairA, pairB] = orderPair(req.user.id, partnerId);
    const { rows: existingSettings } = await query(
      'SELECT request_status, updated_by FROM conversation_settings WHERE user_a = $1 AND user_b = $2',
      [pairA, pairB]
    );
    if (!existingSettings.length) {
      await query(
        `INSERT INTO conversation_settings (user_a, user_b, request_status, updated_by, updated_at)
         VALUES ($1, $2, 'pending', $3, NOW())`,
        [pairA, pairB, req.user.id]
      );
    } else if (existingSettings[0].request_status === 'pending' && existingSettings[0].updated_by !== req.user.id) {
      await query(
        `UPDATE conversation_settings SET request_status = 'accepted', updated_at = NOW()
         WHERE user_a = $1 AND user_b = $2`,
        [pairA, pairB]
      );
    }

    const disappearingSeconds = await getDisappearingSeconds(req.user.id, partnerId);

    const { rows } = await query(
      `INSERT INTO messages (sender_id, recipient_id, body, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $4::INTEGER IS NULL THEN NULL ELSE NOW() + ($4 || ' seconds')::INTERVAL END)
       RETURNING id, sender_id, recipient_id, body, status, created_at, expires_at`,
      [req.user.id, partnerId, body, disappearingSeconds]
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

// ── GET /api/messages/:partnerId/settings ────────────────────────────────────
// Either side of a conversation can see the active disappearing window —
// only a Black member can change it (enforced by requireTier in the route).
async function getConversationSettings(req, res) {
  const { partnerId } = req.params;
  try {
    if (await isBlocked(req.user.id, partnerId) || await blockedByVisibility(req.user.id, partnerId)) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    const disappearing_seconds = await getDisappearingSeconds(req.user.id, partnerId);
    res.json({ disappearing_seconds });
  } catch (err) {
    console.error('[getConversationSettings]', err.message);
    res.status(500).json({ error: 'Could not fetch conversation settings.' });
  }
}

// ── PUT /api/messages/:partnerId/settings ────────────────────────────────────
async function setConversationSettings(req, res) {
  const { partnerId } = req.params;
  const { disappearing_seconds } = req.body;

  if (disappearing_seconds !== null && !DISAPPEARING_WINDOWS.includes(disappearing_seconds)) {
    return res.status(400).json({ error: 'Invalid disappearing-message window.' });
  }
  if (partnerId === req.user.id) {
    return res.status(400).json({ error: 'Invalid conversation.' });
  }

  try {
    if (await isBlocked(req.user.id, partnerId) || await blockedByVisibility(req.user.id, partnerId)) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const [userA, userB] = orderPair(req.user.id, partnerId);
    await query(
      `INSERT INTO conversation_settings (user_a, user_b, disappearing_seconds, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_a, user_b)
       DO UPDATE SET disappearing_seconds = $3, updated_by = $4, updated_at = NOW()`,
      [userA, userB, disappearing_seconds, req.user.id]
    );

    res.json({ disappearing_seconds });
  } catch (err) {
    console.error('[setConversationSettings]', err.message);
    res.status(500).json({ error: 'Could not update conversation settings.' });
  }
}

module.exports = {
  getConversations, getThread, sendMessage, deleteMessage,
  getConversationSettings, setConversationSettings, purgeExpiredMessages,
  getMessageRequests, acceptMessageRequest, declineMessageRequest,
  archiveConversation, unarchiveConversation, getUnreadCount,
};
