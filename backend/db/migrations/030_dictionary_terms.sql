-- ============================================================
-- Fantasi — Migration 030
-- Kink Dictionary: a searchable, admin-authored educational glossary
-- (Resources/Dictionary.html, linked from the header's More menu). Terms
-- are admin-authored, not member-submitted — no review-queue status needed,
-- unlike identity_documents/photo_verification_requests/membership_requests.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dictionary_terms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term       TEXT NOT NULL CHECK (char_length(term) BETWEEN 1 AND 80),
  slug       TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL CHECK (char_length(definition) <= 2000),
  category   TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dictionary_terms_slug ON dictionary_terms (slug);
CREATE INDEX IF NOT EXISTS idx_dictionary_terms_term ON dictionary_terms (term);

COMMIT;
