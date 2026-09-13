-- ============================================================
-- Fantasi — Migration 003
-- Adds the profile-setup fields that Profile/profile-setup.html
-- collects (heading, looking_for, weight/height, education,
-- relationship status, smoking), widens `bio` to match the "about
-- you" step's 4000-character limit, and adds the column the Stripe
-- webhook uses to process membership payments idempotently.
-- Run as: psql -U fantasi_user -d fantasi -f 003_profile_setup_fields_and_payments.sql
-- ============================================================

BEGIN;

-- ── Profile-setup fields ────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS heading             TEXT CHECK (char_length(heading) <= 50),
  ADD COLUMN IF NOT EXISTS looking_for         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS weight_label        TEXT,   -- e.g. "160–170 lbs" — a picked range, not a precise value
  ADD COLUMN IF NOT EXISTS weight_unit         TEXT NOT NULL DEFAULT 'lbs' CHECK (weight_unit IN ('lbs', 'kg')),
  ADD COLUMN IF NOT EXISTS weight_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS height_label        TEXT,   -- e.g. "6'1\"" or "185 cm"
  ADD COLUMN IF NOT EXISTS height_unit         TEXT NOT NULL DEFAULT 'ft' CHECK (height_unit IN ('ft', 'cm')),
  ADD COLUMN IF NOT EXISTS education           TEXT,
  ADD COLUMN IF NOT EXISTS relationship_status TEXT,
  ADD COLUMN IF NOT EXISTS smoking             TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_looking_for ON profiles USING GIN (looking_for);

-- ── Widen `bio` — the setup flow's "about you" step allows 4000 chars,
--    the original schema/validator only allowed 500. Standardise on 4000.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_bio_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_bio_check CHECK (char_length(bio) <= 4000);

-- ── Stripe payment tracking ─────────────────────────────────
-- Lets the webhook check "have I already granted this charge?" before
-- writing, so a retried webhook delivery can never double-grant a tier.
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT UNIQUE;

COMMIT;
