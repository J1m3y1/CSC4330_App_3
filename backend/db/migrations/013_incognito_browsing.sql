-- ============================================================
-- Fantasi — Migration 013
-- Incognito browsing: when on, viewing someone else's profile never
-- creates a profile_views row for that visit, so the viewer simply never
-- appears in anyone's "who viewed you" list. Simpler and more honest than
-- logging the view and filtering it out at read time.
-- ============================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS incognito BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
