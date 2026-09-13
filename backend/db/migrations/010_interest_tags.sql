-- ============================================================
-- Fantasi — Migration 010
-- Per-tag interest ratings (into it / curious / soft limit / hard limit),
-- plus Gold+/Black-only custom tags. profiles.interests (plain TEXT[])
-- stays in sync as just the tag names — Discover/Search's existing
-- `interests && $1::text[]` / `$1 = ANY(interests)` filters keep working
-- unchanged; this table is the new richer source of truth for level and
-- whether a tag is one of the fixed generic ones or member-authored.
-- ============================================================

BEGIN;

CREATE TYPE interest_level AS ENUM ('into', 'curious', 'soft_limit', 'hard_limit');

CREATE TABLE profile_interests (
  id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag         TEXT            NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 50),
  level       interest_level  NOT NULL DEFAULT 'into',
  is_custom   BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tag)
);

CREATE INDEX idx_profile_interests_user ON profile_interests (user_id);

COMMIT;
