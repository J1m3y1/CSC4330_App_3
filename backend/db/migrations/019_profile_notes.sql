-- ============================================================
-- Fantasi — Migration 019
-- Private member notes (Gold tier): a member can keep one private note
-- about another member's profile — visible only to whoever wrote it, never
-- to the profile owner or anyone else. One note per (author, subject) pair,
-- editable in place rather than a running list.
-- ============================================================

BEGIN;

CREATE TABLE profile_notes (
  author_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (author_id, subject_id),
  CONSTRAINT chk_no_self_note CHECK (author_id <> subject_id)
);

COMMIT;
