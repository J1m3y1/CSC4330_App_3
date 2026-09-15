-- ============================================================
-- Fantasi — Migration 031
-- Message Requests: today a message either sends and lands straight in the
-- recipient's normal inbox, or is rejected outright at send time (see
-- canMessage() in messagesController.js) — there is no "pending, needs
-- accept/decline" state anywhere. This adds one to the existing
-- conversation_settings table (migration 016, one row per ordered pair)
-- rather than a new table, since it's already the natural per-conversation
-- settings home. archived_by_a/b are bundled in here for the same reason —
-- the table's already being touched, and Messages.html's Archived tab needs
-- somewhere to live — using the same per-side-flag convention as
-- messages.is_deleted_by_sender/is_deleted_by_recipient.
--
-- Backfill is the safety-critical part: every distinct pair that has
-- exchanged at least one message but has no conversation_settings row yet
-- gets one inserted as 'accepted' — so no already-in-progress real
-- conversation retroactively becomes a "request" the day this ships. New
-- pairs with no prior messages start 'pending' via application code in
-- messagesController.sendMessage(), not this migration.
-- ============================================================

BEGIN;

ALTER TABLE conversation_settings
  ADD COLUMN IF NOT EXISTS request_status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (request_status IN ('pending', 'accepted', 'declined'));

ALTER TABLE conversation_settings
  ADD COLUMN IF NOT EXISTS archived_by_a BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE conversation_settings
  ADD COLUMN IF NOT EXISTS archived_by_b BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: one row per already-messaged pair that doesn't have one yet,
-- ordered the same way orderPair() does in messagesController.js (smaller
-- UUID first) so it satisfies the existing chk_conversation_settings_ordered
-- CHECK constraint.
INSERT INTO conversation_settings (user_a, user_b, request_status, updated_by, updated_at)
SELECT
  LEAST(m.sender_id, m.recipient_id)    AS user_a,
  GREATEST(m.sender_id, m.recipient_id) AS user_b,
  'accepted',
  LEAST(m.sender_id, m.recipient_id),   -- arbitrary but deterministic; NOT NULL requires some value
  NOW()
FROM messages m
WHERE NOT EXISTS (
  SELECT 1 FROM conversation_settings cs
  WHERE cs.user_a = LEAST(m.sender_id, m.recipient_id)
    AND cs.user_b = GREATEST(m.sender_id, m.recipient_id)
)
GROUP BY LEAST(m.sender_id, m.recipient_id), GREATEST(m.sender_id, m.recipient_id);

COMMIT;
