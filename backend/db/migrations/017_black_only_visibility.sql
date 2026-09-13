-- ============================================================
-- Fantasi — Migration 017
-- Black-only visibility (Black tier, opt-in): when on, a member is excluded
-- from Discover/Search results and direct profile views (404, same as a
-- block) for anyone whose own membership tier isn't Black. Off by default —
-- unlike incognito/geofencing, this narrows who can find you at all, so it
-- shouldn't turn on silently.
-- ============================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS black_only_visibility BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
