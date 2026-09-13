-- ============================================================
-- Fantasi — Migration 009
-- Real phone verification via Twilio Verify. No table is needed to
-- track in-flight verifications — Twilio's own Verify service holds
-- that state; this only needs somewhere to persist the *result*.
-- ============================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone          TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
