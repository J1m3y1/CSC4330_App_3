-- ============================================================
-- Fantasi — Migration 026
-- First-sign-in welcome interstitial (Dashboard/Welcome.html). NULL means
-- "never shown yet" — every dashboard page's shared boot logic
-- (requireSession in fantasi-api.js) redirects here until it's set, then
-- POST /api/auth/welcome-seen sets it once, permanently.
-- ============================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_seen_at TIMESTAMPTZ;

COMMIT;
