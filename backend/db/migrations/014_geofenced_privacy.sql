-- ============================================================
-- Fantasi — Migration 014
-- Geofenced privacy (Black tier): a member can define one or more
-- geocoded zones around a real address; anyone browsing Discover/Search
-- whose own location falls inside one of those zones never sees that
-- profile. Requires each profile's free-text `location` to also be
-- geocoded (lat/lon) so the discovery query can compute distance.
-- ============================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS profile_geofences (
  id            SERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  address       TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  radius_miles  NUMERIC NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_geofences_user ON profile_geofences(user_id);

COMMIT;
