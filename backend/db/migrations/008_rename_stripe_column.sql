-- ============================================================
-- Fantasi — Migration 008
-- `stripe_payment_intent_id` is a leftover name from when membership
-- upgrades went through Stripe (removed — see project notes on why).
-- It's still a useful idempotency key for grantMembership(), just under
-- a name that no longer describes what it holds (a "manual_<uuid>" or
-- "invitation_<uuid>" tag now, never a real Stripe ID).
-- ============================================================

BEGIN;

ALTER TABLE memberships RENAME COLUMN stripe_payment_intent_id TO grant_ref;

COMMIT;
