-- ============================================================
-- Fantasi — Migration 020
-- Boost: a member can temporarily jump to the top of Discover results.
-- Available to every tier (no payment processor exists to gate it behind),
-- limited by a 24-hour cooldown per member so it stays a real signal rather
-- than something everyone leaves permanently on. Each boost lasts 30
-- minutes from activation.
-- ============================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS boosted_until   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_boosted_at TIMESTAMPTZ NULL;

COMMIT;
