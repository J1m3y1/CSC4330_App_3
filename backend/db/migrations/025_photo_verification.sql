-- ============================================================
-- Fantasi — Migration 025
-- Photo verification: a member takes a live selfie holding a one-time code
-- (proves the photo is freshly taken, not a replay of an old picture) and an
-- admin manually compares it against that member's own profile_photos —
-- confirms the account holder is actually who their photos show, same idea
-- as FetLife's photo verification. Distinct from identity_documents/Veriff
-- (migration 024), which verifies a government ID, not "do your photos
-- actually look like you."
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS photo_verification_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key    TEXT NOT NULL,   -- private disk storage, never a public URL — see middleware/upload.js
  challenge_code TEXT NOT NULL,   -- the one-time code the member was shown and had to hold up
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_verification_user   ON photo_verification_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_verification_status ON photo_verification_requests(status);

-- One open request per member at a time — keeps "already have a pending
-- request?" a plain existence check and stops queue-spamming.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_verification_one_pending
  ON photo_verification_requests(user_id) WHERE status = 'pending';

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
