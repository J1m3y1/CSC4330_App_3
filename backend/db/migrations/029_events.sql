-- ============================================================
-- Fantasi — Migration 029
-- Events: real events with a date and RSVP (interested/going) — nothing
-- like this existed before this migration. group_id is a nullable, ON
-- DELETE SET NULL reference: most events won't be group-organized, so
-- requiring a group would block the common case; an organizer can
-- optionally tag an event as hosted by a Group they own.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 100),
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 1500),
  location        TEXT,                 -- freeform display string, same convention as profiles.location
  state           TEXT,                 -- normalized, same convention as profiles.state (migration 027)
  event_date      TIMESTAMPTZ NOT NULL,
  event_end_date  TIMESTAMPTZ,
  organizer_id    UUID NOT NULL REFERENCES users(id),
  group_id        UUID REFERENCES groups(id) ON DELETE SET NULL,
  cover_image_url TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_end_date IS NULL OR event_end_date >= event_date)
);

CREATE INDEX IF NOT EXISTS idx_events_state      ON events (state);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events (event_date);
CREATE INDEX IF NOT EXISTS idx_events_group      ON events (group_id);

CREATE TABLE IF NOT EXISTS event_attendees (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('interested', 'going')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_attendees_user ON event_attendees (user_id);

COMMIT;
