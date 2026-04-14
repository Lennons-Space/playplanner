-- ============================================================
-- Migration 012: Facility/premium filters + venue data provenance
-- ============================================================
--
-- PART A — Venue provenance columns
-- -----------------------------------
-- Adds two columns for tracking where venue data came from.
-- Required before any bulk import from OSM or other open datasets.
--
--   data_source  — where the record originated:
--       'manual'           admin or business entered it directly
--       'user_submitted'   submitted by a user through the app
--       'osm'              imported from OpenStreetMap (ODbL licence)
--       'ogl'              imported from a UK Government Open Data source
--       'foursquare'       imported from Foursquare Places API
--       'business_claimed' data added/verified by the venue operator
--
--   license — the open licence under which the source data was released.
--       null for manual/user entries (no external licence applies).
--       'ODbL-1.0' for OpenStreetMap records (share-alike DB licence).
--       'OGL-3.0' for UK Government Open Data records.
--
-- These columns are required for:
--   • ODbL share-alike compliance (OSM records must be identifiable)
--   • Attribution in the app (OSM, OGL attribution requirements)
--   • Legal separation of licensed data from proprietary enrichment
--   • Future data licensing revenue (selling venue data requires provenance)
--
-- The default is 'manual' so all existing records are correctly
-- attributed — they were all entered manually before this migration.
--
-- PART B — get_nearby_venues RPC update
-- ----------------------------------------
-- Extends the stored function to accept two new filter parameters:
--
--   p_facility_ids uuid[]  — show only venues with at least one of the
--                            listed facility IDs (OR semantics: inclusive
--                            filter that returns more results). Null = all.
--
--   p_premium_only boolean — when true, show only currently featured
--                            venues (is_premium = true AND featured_until
--                            is not null AND featured_until > now()).
--                            This allows a "featured venues" browse mode.
--                            false = all venues (default).
--
-- APPROACH
-- --------
-- DROP FUNCTION drops the old 9-parameter overload so PostgREST does not
-- see two overloads of the same name and fail with an ambiguity error.
-- The new function is then created with all 11 parameters.
-- REVOKE/GRANT are updated to cover the new signature.
-- ============================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PART A: Venue provenance
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS data_source text
    DEFAULT 'manual'
    CHECK (data_source IN ('manual', 'user_submitted', 'osm', 'ogl', 'foursquare', 'business_claimed')),
  ADD COLUMN IF NOT EXISTS license text;   -- null = no external licence; 'ODbL-1.0', 'OGL-3.0', etc.

-- Back-fill existing rows: all records before this migration were manually entered.
UPDATE venues SET data_source = 'manual' WHERE data_source IS NULL;

-- Index for filtering or grouping by source (used by future data export scripts).
CREATE INDEX IF NOT EXISTS venues_data_source_idx ON venues (data_source);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART B: Drop old RPC overload, create new one
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove the old 9-parameter version to prevent PostgREST ambiguity.
DROP FUNCTION IF EXISTS get_nearby_venues(float, float, float, uuid[], int, int, text[], boolean, int);

-- Recreate with two additional parameters.
-- All existing callers continue to work because the new params have defaults
-- (p_facility_ids default null = no facility filter; p_premium_only default false = all venues).

CREATE OR REPLACE FUNCTION get_nearby_venues(
  lat              float,
  lng              float,
  p_radius_km      float      DEFAULT 10,
  category_ids     uuid[]     DEFAULT NULL,
  p_min_age        int        DEFAULT NULL,
  p_max_age        int        DEFAULT NULL,
  price_ranges     text[]     DEFAULT NULL,
  open_now         boolean    DEFAULT false,
  p_limit          int        DEFAULT 50,
  p_facility_ids   uuid[]     DEFAULT NULL,   -- NEW: facility filter (OR semantics)
  p_premium_only   boolean    DEFAULT false   -- NEW: show only currently featured venues
)
RETURNS TABLE (
  id              uuid,
  name            text,
  slug            text,
  description     text,
  category_id     uuid,
  city            text,
  postcode        text,
  latitude        numeric,
  longitude       numeric,
  price_range     text,
  min_age         int,
  max_age         int,
  is_premium      boolean,
  is_verified     boolean,
  review_count    int,
  average_rating  numeric,
  featured_until  timestamptz,
  has_hours       boolean,
  distance_km     float
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
AS $$
BEGIN
  -- Input validation: bad coordinates produce internal PostGIS errors that
  -- could expose implementation details. Raise a clean error first.
  IF lat IS NULL OR lat < -90 OR lat > 90 THEN
    RAISE EXCEPTION 'lat must be between -90 and 90'
      USING errcode = 'check_violation';
  END IF;
  IF lng IS NULL OR lng < -180 OR lng > 180 THEN
    RAISE EXCEPTION 'lng must be between -180 and 180'
      USING errcode = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    sub.id,
    sub.name,
    sub.slug,
    sub.description,
    sub.category_id,
    sub.city,
    sub.postcode,
    sub.latitude,
    sub.longitude,
    sub.price_range,
    sub.min_age,
    sub.max_age,
    sub.is_premium,
    sub.is_verified,
    sub.review_count,
    sub.average_rating,
    sub.featured_until,
    sub.has_hours,
    sub.distance_km
  FROM (
    SELECT
      v.id,
      v.name,
      v.slug,
      v.description,
      v.category_id,
      v.city,
      v.postcode,
      v.latitude,
      v.longitude,
      v.price_range,
      v.min_age,
      v.max_age,
      v.is_premium,
      v.is_verified,
      v.review_count,
      v.average_rating,
      v.featured_until,

      EXISTS(
        SELECT 1 FROM opening_hours oh WHERE oh.venue_id = v.id
      ) AS has_hours,

      ROUND((
        ST_Distance(
          v.location,
          ST_Point(lng, lat)::geography
        ) / 1000.0
      )::numeric, 2)::float AS distance_km

    FROM venues v
    WHERE
      -- RLS is the primary access control; repeating here improves planner use
      -- of the moderation index (venues_moderation_idx).
      v.is_published        = true
      AND v.moderation_status = 'approved'

      -- Guard against rows missing a PostGIS location value
      AND v.location IS NOT NULL

      -- Spatial filter capped at 50 km (prevents full-table scans / DoS)
      AND ST_DWithin(
        v.location,
        ST_Point(lng, lat)::geography,
        LEAST(p_radius_km, 50.0) * 1000.0
      )

      -- Category filter
      AND (category_ids IS NULL OR v.category_id = ANY(category_ids))

      -- Age range filter
      AND (p_min_age IS NULL OR v.max_age >= p_min_age)
      AND (p_max_age IS NULL OR v.min_age <= p_max_age)

      -- Price range filter
      AND (price_ranges IS NULL OR v.price_range = ANY(price_ranges))

      -- Open-now filter (BST-aware via 'Europe/London')
      AND (
        open_now = false
        OR EXISTS (
          SELECT 1
          FROM opening_hours oh
          WHERE oh.venue_id    = v.id
            AND oh.day_of_week = EXTRACT(DOW FROM now() AT TIME ZONE 'Europe/London')::int
            AND oh.is_closed   = false
            AND oh.opens_at   <= (now() AT TIME ZONE 'Europe/London')::time
            AND oh.closes_at  >  (now() AT TIME ZONE 'Europe/London')::time
        )
        OR NOT EXISTS (
          SELECT 1 FROM opening_hours oh WHERE oh.venue_id = v.id
        )
      )

      -- Facility filter (OR semantics: venue must have at least ONE of the
      -- listed facilities). Null = no facility filter applied.
      -- OR semantics chosen over AND because AND frequently yields zero results
      -- when parents select multiple facilities, which is a poor UX. Parents
      -- can always narrow down by selecting just one facility at a time.
      AND (
        p_facility_ids IS NULL
        OR EXISTS (
          SELECT 1
          FROM venue_facilities vf
          WHERE vf.venue_id    = v.id
            AND vf.facility_id = ANY(p_facility_ids)
        )
      )

      -- Premium-only filter: show only venues that are currently featured.
      -- featured_until IS NOT NULL check prevents NULL from being treated as
      -- "featured indefinitely" — admins must set an explicit expiry date.
      AND (
        p_premium_only = false
        OR (
          v.is_premium      = true
          AND v.featured_until IS NOT NULL
          AND v.featured_until > now()
        )
      )

  ) sub
  ORDER BY
    -- Featured venues float to top only when featured_until is set and current.
    CASE
      WHEN sub.is_premium
       AND sub.featured_until IS NOT NULL
       AND sub.featured_until > now()
      THEN 0
      ELSE 1
    END,
    sub.distance_km ASC
  LIMIT LEAST(p_limit, 200);

END;
$$;

-- Revoke the automatic PUBLIC execute grant, then re-grant only to the two
-- roles PostgREST uses. Matches the security pattern from migration 002.
REVOKE EXECUTE ON FUNCTION get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) TO anon, authenticated;
