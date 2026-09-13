-- ============================================================
-- Fantasi — Migration 015
-- Real government-ID verification: applicants upload an ID at
-- registration, stored outside any publicly-served directory, reviewed by
-- an admin alongside the rest of their application. Replaces the fake
-- "Upload government-issued ID" widget in SignUp.html that never actually
-- collected or sent anything.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS identity_documents (
  id                SERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key       TEXT NOT NULL,   -- filename on private disk storage — never a public URL
  original_filename TEXT,
  mime_type         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_documents_user   ON identity_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_documents_status ON identity_documents(status);

COMMIT;
