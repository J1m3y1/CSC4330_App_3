-- ============================================================
-- Fantasi — Migration 016
-- Disappearing messages (Black tier): a Black member can set a
-- conversation to auto-delete messages after a fixed window. The setting
-- is per-conversation (either party sees it), applies to both sides, and
-- is permanent — expired messages are hard-deleted, not soft-hidden.
-- ============================================================

BEGIN;

-- One row per unordered pair of users. user_a/user_b are always stored
-- with user_a < user_b so a conversation has exactly one settings row
-- regardless of who looks it up or who last changed it.
CREATE TABLE IF NOT EXISTS conversation_settings (
  user_a               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disappearing_seconds INTEGER     NULL, -- NULL = off
  updated_by           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_a, user_b),
  CONSTRAINT chk_conversation_settings_ordered CHECK (user_a < user_b)
);

-- Each message freezes an absolute deadline at send time, so changing the
-- window later never retroactively changes when already-sent messages go.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at) WHERE expires_at IS NOT NULL;

COMMIT;
