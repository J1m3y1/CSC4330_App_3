-- ============================================================
-- Fantasi — Migration 012
-- Blurred-photo mode: when a member turns this on, their real photo
-- is withheld (not just CSS-blurred client-side — the actual URL never
-- reaches an unapproved viewer's browser) until they personally approve
-- that specific viewer.
-- ============================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS blur_photos BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TYPE photo_approval_status AS ENUM ('pending', 'approved', 'denied');

CREATE TABLE photo_approvals (
  owner_id      UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id     UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        photo_approval_status  NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  PRIMARY KEY (owner_id, viewer_id),
  CONSTRAINT chk_no_self_photo_approval CHECK (owner_id <> viewer_id)
);

CREATE INDEX idx_photo_approvals_owner ON photo_approvals (owner_id, status);

COMMIT;
