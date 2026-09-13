-- ============================================================
-- Fantasi — Migration 006
-- A real photo gallery. `profiles.avatar_url` stays as a fast,
-- denormalized "primary photo" cache (every existing query that reads
-- it — sidebar avatars, message/chatroom sender avatars, discover
-- cards — keeps working unchanged); this table is the actual gallery
-- behind it, kept in sync by the application layer on every write.
-- ============================================================

BEGIN;

CREATE TABLE profile_photos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  position    INTEGER     NOT NULL DEFAULT 0,
  is_primary  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_photos_user_id ON profile_photos (user_id, position);

-- Enforce at most one primary photo per user at the database level, not
-- just in application code.
CREATE UNIQUE INDEX idx_profile_photos_one_primary
  ON profile_photos (user_id) WHERE is_primary = TRUE;

COMMIT;
