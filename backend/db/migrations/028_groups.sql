-- ============================================================
-- Fantasi — Migration 028
-- Groups: real joinable communities, distinct from Chatrooms (admin-created,
-- tier-gated chat rooms with no membership roster) and Forum (a single flat
-- global post feed with no communities concept). v1 scope is directory +
-- membership only — no group-scoped discussion feed (see the redesign plan
-- for why: forking forum_posts per-group with different visibility rules
-- than the global Forum is real scope creep for a first pass).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  category        TEXT,
  location        TEXT,                 -- freeform display string, same convention as profiles.location
  state           TEXT,                 -- normalized, same convention as profiles.state (migration 027)
  cover_image_url TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_state    ON groups (state);
CREATE INDEX IF NOT EXISTS idx_groups_category ON groups (category);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);

COMMIT;
