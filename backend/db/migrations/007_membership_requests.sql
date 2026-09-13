-- ============================================================
-- Fantasi — Migration 007
-- Replaces payment-processor-driven upgrades (not usable for this
-- site's content — see project notes) with a private-invitation
-- model: a member requests a tier, an admin reviews and grants it.
-- Same shape as `reports` / `privacy_requests`.
-- ============================================================

BEGIN;

CREATE TYPE membership_request_status AS ENUM ('pending', 'granted', 'declined');

CREATE TABLE membership_requests (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_tier membership_tier NOT NULL,
  note           TEXT    CHECK (char_length(note) <= 1000),
  status         membership_request_status NOT NULL DEFAULT 'pending',
  reviewed_by    UUID    REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_membership_requests_status  ON membership_requests (status);
CREATE INDEX idx_membership_requests_user_id ON membership_requests (user_id);

CREATE TRIGGER trg_membership_requests_updated_at
  BEFORE UPDATE ON membership_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
