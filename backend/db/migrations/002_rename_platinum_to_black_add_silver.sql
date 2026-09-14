-- ============================================================
-- Fantasi — Migration 002 (corrected)
-- Rename membership tier 'platinum' → 'black', add 'silver'
-- ============================================================

-- ── PART 1: Add new enum values (must commit before use) ─────────────────────
ALTER TYPE membership_tier ADD VALUE IF NOT EXISTS 'silver';
ALTER TYPE membership_tier ADD VALUE IF NOT EXISTS 'black';

-- migrate.js sends this whole file as one multi-statement string via a
-- single pool.query() call. With no BEGIN before the two ALTER TYPE
-- statements above, Postgres opens an implicit transaction for them that
-- stays open across the rest of this string — so the explicit BEGIN below
-- was a no-op (Postgres just warns "there is already a transaction in
-- progress" and keeps using the same one), and PART 2 ran in that SAME
-- transaction as the ADD VALUE calls, which Postgres refuses ("unsafe use
-- of new value ... of enum type") since a new enum value isn't safe to use
-- until the transaction that added it has actually committed. This explicit
-- COMMIT closes that implicit transaction for real, so the BEGIN below
-- starts a genuinely fresh one. Verified against a scratch enum type: fails
-- with the exact same error without this line, succeeds with it.
COMMIT;

-- ── PART 2: Migrate data + swap to clean enum type ───────────────────────────

BEGIN;

UPDATE users       SET membership_tier = 'black' WHERE membership_tier = 'platinum';
UPDATE memberships SET tier            = 'black' WHERE tier            = 'platinum';
UPDATE chatrooms   SET min_tier        = 'black' WHERE min_tier        = 'platinum';

-- THE FIX: drop each column's DEFAULT before swapping its type.
ALTER TABLE users     ALTER COLUMN membership_tier DROP DEFAULT;
ALTER TABLE chatrooms ALTER COLUMN min_tier         DROP DEFAULT;

ALTER TYPE membership_tier RENAME TO membership_tier_old;

CREATE TYPE membership_tier AS ENUM ('free', 'silver', 'gold', 'black');

ALTER TABLE users
  ALTER COLUMN membership_tier
  TYPE membership_tier
  USING membership_tier::text::membership_tier;

ALTER TABLE memberships
  ALTER COLUMN tier
  TYPE membership_tier
  USING tier::text::membership_tier;

ALTER TABLE chatrooms
  ALTER COLUMN min_tier
  TYPE membership_tier
  USING min_tier::text::membership_tier;

-- Re-add the defaults now that the new type exists under the same name.
ALTER TABLE users     ALTER COLUMN membership_tier SET DEFAULT 'free';
ALTER TABLE chatrooms ALTER COLUMN min_tier         SET DEFAULT 'free';

DROP TYPE membership_tier_old;

COMMIT;