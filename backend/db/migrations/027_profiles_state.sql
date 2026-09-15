-- ============================================================
-- Fantasi — Migration 027
-- Adds a normalized profiles.state column so Meet (location-based member
-- discovery) can filter/count by state cheaply and exactly, instead of
-- ILIKE-parsing the freeform `location` string on every request. The
-- existing `location` column and its ILIKE filter in discoverController.js
-- are untouched — this is additive, not a replacement.
--
-- Backfill: profiles.location is always produced by wireLocationSelects()
-- in fantasi-api.js as either "City, State, United States" or
-- "State, United States" (no city chosen). We extract the state token by
-- counting ", "-delimited fields (3 -> take field 2, 2 -> take field 1) and
-- only write it if the result exactly matches one of the 51 real state
-- names below — anything that doesn't parse cleanly (legacy free-text
-- values, non-US entries, malformed strings) is left NULL rather than
-- guessing wrong. This literal list must stay in sync with
-- backend/config/usStates.js and the US_STATES_CITIES keys in
-- public/js/fantasi-api.js.
-- ============================================================

BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS state TEXT;

UPDATE profiles
SET state = parsed.candidate
FROM (
  SELECT id,
    CASE array_length(string_to_array(location, ', '), 1)
      WHEN 3 THEN split_part(location, ', ', 2)
      WHEN 2 THEN split_part(location, ', ', 1)
      ELSE NULL
    END AS candidate
  FROM profiles
  WHERE location IS NOT NULL
) parsed
WHERE profiles.id = parsed.id
  AND profiles.state IS NULL
  AND parsed.candidate = ANY (ARRAY[
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois',
    'Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts',
    'Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
    'New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota',
    'Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
    'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington',
    'West Virginia','Wisconsin','Wyoming'
  ]);

CREATE INDEX IF NOT EXISTS idx_profiles_state ON profiles (state);

COMMIT;
