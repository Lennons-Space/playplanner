-- =====================================================================
-- 018_nullable_postcode.sql
-- =====================================================================
-- Purpose:
--   Make venues.postcode nullable.
--
-- Why:
--   The OSM import pipeline (see scripts/import/) discovered that ~85%
--   of UK family venues on OpenStreetMap have no `addr:postcode` tag.
--   Parks, playgrounds, leisure centres, large outdoor attractions and
--   other real, valid venues often simply do not have a postcode — either
--   because the venue spans multiple postcodes (large country parks) or
--   because the OSM contributor did not add the tag.
--
--   Postcode is NOT required for a venue to be discoverable on the map:
--   discovery is driven by latitude/longitude (PostGIS geography column)
--   via the get_nearby_venues RPC. Postcode is only used as a
--   human-readable address hint in the UI.
--
--   Rejecting these venues on import harms coverage for families and
--   contradicts our data model: the source of truth for venue location
--   is the geo-coordinate, not the postcode string.
--
-- Compatibility:
--   - get_nearby_venues RPC (migrations 002, 012, 013): selects postcode
--     but does not filter by it. RETURNS TABLE declares `postcode text`
--     (nullable), so NULL values flow through correctly.
--   - No RLS policy, index, trigger or check constraint references
--     postcode (verified by searching migrations 001-017).
--   - profiles.postcode is a separate column and is unaffected.
--
-- Rollback:
--   To revert, first backfill NULLs (e.g. with a sentinel or reverse-
--   geocoded value), then:
--     ALTER TABLE venues ALTER COLUMN postcode SET NOT NULL;
-- =====================================================================

ALTER TABLE venues
  ALTER COLUMN postcode DROP NOT NULL;

COMMENT ON COLUMN venues.postcode IS
  'Optional UK postcode. NULL is valid: many OSM-sourced venues (parks, '
  'playgrounds, outdoor attractions) have no postcode. Venue discovery '
  'uses latitude/longitude via PostGIS, not postcode.';
