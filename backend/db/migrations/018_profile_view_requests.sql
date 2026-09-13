-- ============================================================
-- Fantasi — Migration 018
-- Black-only visibility, request-to-view escalation: a Free viewer stays
-- fully blocked from a Black-only-visible profile (unchanged — 404
-- everywhere), but Silver/Gold now see a locked card (name + avatar only)
-- in Discover/Search and can send a request; the Black member approves or
-- denies it from their own Profile settings, same UX as blurred-photo mode.
-- Reuses the existing photo_approval_status enum (pending/approved/denied)
-- rather than defining a near-identical one.
-- ============================================================

BEGIN;

CREATE TABLE profile_view_requests (
  owner_id      UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id  UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        photo_approval_status  NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  PRIMARY KEY (owner_id, requester_id),
  CONSTRAINT chk_no_self_view_request CHECK (owner_id <> requester_id)
);

CREATE INDEX idx_profile_view_requests_owner ON profile_view_requests (owner_id, status);

COMMIT;
