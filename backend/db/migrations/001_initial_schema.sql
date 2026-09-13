-- ============================================================
-- Fantasi — Database Schema Migration
-- Run as: psql -U fantasi_user -d fantasi -f 001_initial_schema.sql
-- ============================================================

-- ── Extensions ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text for emails

-- ── Enum types ───────────────────────────────────────────
CREATE TYPE membership_tier AS ENUM ('free', 'gold', 'platinum');
CREATE TYPE user_role       AS ENUM ('member', 'admin');
CREATE TYPE message_status  AS ENUM ('sent', 'delivered', 'read');
CREATE TYPE report_status   AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');

-- ============================================================
-- USERS
-- Core identity + auth. No PII beyond what is strictly needed.
-- ============================================================
CREATE TABLE users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT      NOT NULL UNIQUE,
  password_hash     TEXT        NOT NULL,
  role              user_role   NOT NULL DEFAULT 'member',
  membership_tier   membership_tier NOT NULL DEFAULT 'free',

  -- Account state
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  is_approved       BOOLEAN     NOT NULL DEFAULT FALSE,  -- requires admin approval
  is_email_verified BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Password reset
  reset_token_hash  TEXT,
  reset_token_expires TIMESTAMPTZ,

  -- Refresh token (stored as hash so raw token is never in DB)
  refresh_token_hash TEXT,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ
);

CREATE INDEX idx_users_email      ON users (email);
CREATE INDEX idx_users_is_active  ON users (is_active);
CREATE INDEX idx_users_is_approved ON users (is_approved);

-- ============================================================
-- PROFILES
-- Public-facing member info, separate from auth data.
-- ============================================================
CREATE TABLE profiles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Display info
  display_name    TEXT        NOT NULL,
  full_name       TEXT,
  bio             TEXT        CHECK (char_length(bio) <= 500),
  avatar_url      TEXT,
  location        TEXT,

  -- Identity
  date_of_birth   DATE        NOT NULL,
  -- Computed age check — enforced at app layer too
  CONSTRAINT chk_age CHECK (date_of_birth <= CURRENT_DATE - INTERVAL '18 years'),

  -- Interests / tags (stored as array for efficient overlap queries)
  interests       TEXT[]      NOT NULL DEFAULT '{}',

  -- Privacy settings
  show_location   BOOLEAN     NOT NULL DEFAULT TRUE,
  show_last_active BOOLEAN    NOT NULL DEFAULT TRUE,
  allow_messages_from TEXT    NOT NULL DEFAULT 'members'
                              CHECK (allow_messages_from IN ('members','gold_plus','nobody')),

  -- Profile completion
  is_complete     BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ
);

CREATE INDEX idx_profiles_user_id   ON profiles (user_id);
CREATE INDEX idx_profiles_location  ON profiles (location) WHERE show_location = TRUE;
CREATE INDEX idx_profiles_interests ON profiles USING GIN (interests);

-- ============================================================
-- MEMBERSHIPS
-- Tracks subscription history per user.
-- ============================================================
CREATE TABLE memberships (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier            membership_tier NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,               -- NULL = lifetime / until cancelled
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Payment reference (Stripe charge ID etc.) — never store raw card data
  payment_ref     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memberships_user_id  ON memberships (user_id);
CREATE INDEX idx_memberships_active   ON memberships (user_id) WHERE is_active = TRUE;

-- ============================================================
-- BLOCKS & REPORTS
-- Safety-first: blocking and reporting infrastructure.
-- ============================================================
CREATE TABLE blocks (
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE TABLE reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT        NOT NULL CHECK (char_length(reason) <= 1000),
  status        report_status NOT NULL DEFAULT 'pending',
  reviewed_by   UUID        REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_no_self_report CHECK (reporter_id <> reported_id)
);

CREATE INDEX idx_reports_status ON reports (status);

-- ============================================================
-- DIRECT MESSAGES
-- One-to-one private messages between members.
-- ============================================================
CREATE TABLE messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  status       message_status NOT NULL DEFAULT 'sent',
  is_deleted_by_sender    BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted_by_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_no_self_message CHECK (sender_id <> recipient_id)
);

-- Efficiently fetch a conversation thread between two users
CREATE INDEX idx_messages_thread ON messages (
  LEAST(sender_id::TEXT, recipient_id::TEXT),
  GREATEST(sender_id::TEXT, recipient_id::TEXT),
  created_at DESC
);
CREATE INDEX idx_messages_recipient ON messages (recipient_id, created_at DESC);

-- ============================================================
-- CHATROOMS
-- Group chat rooms, optionally restricted by membership tier.
-- ============================================================
CREATE TABLE chatrooms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL UNIQUE,
  description     TEXT        CHECK (char_length(description) <= 300),
  min_tier        membership_tier NOT NULL DEFAULT 'free',
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chatroom_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        NOT NULL REFERENCES chatrooms(id) ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  is_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chatroom_messages_room ON chatroom_messages (room_id, created_at DESC);

-- ============================================================
-- AUTO-UPDATE updated_at via trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
