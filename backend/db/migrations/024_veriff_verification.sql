-- ============================================================
-- Fantasi — Migration 024
-- Real automated identity verification via Veriff, replacing the manual
-- "admin eyeballs the uploaded file" review that migration 015 introduced.
-- A verification session is created before the applicant's account exists
-- (during the sign-up wizard), so veriff_sessions is keyed by the email the
-- applicant is about to register with, not a user_id. Once Veriff's
-- decision webhook lands with an 'approved' status, POST /auth/register
-- consumes that session (marks it used, one-time) and links it onto the
-- identity_documents row it creates — no file is ever uploaded to or
-- stored on our own servers for a Veriff-checked applicant, so
-- storage_key/mime_type have to become optional.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS veriff_sessions (
  id          UUID PRIMARY KEY,        -- Veriff's own verification/session id
  email       CITEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'created'
              CHECK (status IN ('created', 'submitted', 'approved', 'declined', 'resubmission_requested', 'abandoned', 'expired')),
  decision    JSONB,                   -- raw webhook payload, kept for audit/support
  consumed_at TIMESTAMPTZ,             -- set once a registration has used this session — blocks replay
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_veriff_sessions_email ON veriff_sessions (email);

ALTER TABLE identity_documents
  ADD COLUMN IF NOT EXISTS veriff_session_id UUID REFERENCES veriff_sessions(id);

-- No file exists for a Veriff-checked applicant — these were NOT NULL before.
ALTER TABLE identity_documents ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE identity_documents ALTER COLUMN mime_type    DROP NOT NULL;

-- Exactly one of "we hold a file" or "Veriff checked it" should be true.
ALTER TABLE identity_documents
  ADD CONSTRAINT identity_documents_source_chk
  CHECK (
    (storage_key IS NOT NULL AND veriff_session_id IS NULL) OR
    (storage_key IS NULL AND veriff_session_id IS NOT NULL)
  );

COMMIT;
