-- ============================================================
-- Fantasi — Migration 004
-- Backs Dashboard/Privacy.html's six DSAR-style request types
-- (access / correct / restrict / object / portability / delete)
-- with a real, admin-reviewed queue — the same shape as `reports`.
-- ============================================================

BEGIN;

CREATE TYPE privacy_request_type   AS ENUM ('access', 'correct', 'restrict', 'object', 'portability', 'delete');
CREATE TYPE privacy_request_status AS ENUM ('pending', 'completed', 'dismissed');

CREATE TABLE privacy_requests (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        privacy_request_type   NOT NULL,
  reason      TEXT    CHECK (char_length(reason) <= 1000),
  status      privacy_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID    REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_privacy_requests_status  ON privacy_requests (status);
CREATE INDEX idx_privacy_requests_user_id ON privacy_requests (user_id);

CREATE TRIGGER trg_privacy_requests_updated_at
  BEFORE UPDATE ON privacy_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
