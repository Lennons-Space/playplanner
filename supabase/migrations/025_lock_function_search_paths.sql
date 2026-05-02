-- =============================================================================
-- 025_lock_function_search_paths.sql
--
-- MEDIUM: function_search_path_mutable — 5 functions
--
-- WHY THIS MATTERS
-- ----------------
-- When a PL/pgSQL function has no SET search_path clause, its search_path is
-- inherited from the session that calls it. An attacker (or a compromised
-- extension) could create a schema earlier in the search_path that shadows a
-- system or public function. For example, if search_path = myschema,public,
-- a malicious `myschema.now()` would run instead of the real `pg_catalog.now()`.
--
-- FIX
-- ---
-- Set `SET search_path = extensions, public` (empty string) on each function. With an empty
-- search_path every table/function reference inside the body MUST be fully
-- schema-qualified (e.g. `public.venues` not just `venues`), so there is no
-- ambiguity and no shadowing is possible.
--
-- All five functions are recreated below with:
--   SET search_path = extensions, public
-- and fully-qualified schema references inside their bodies.
--
-- SECURITY NOTES
-- --------------
-- - touch_updated_at        — SECURITY INVOKER (no definer needed; safe trigger)
-- - update_venue_rating     — SECURITY INVOKER (same)
-- - set_venue_location      — SECURITY INVOKER (same)
-- - get_nearby_venues       — SECURITY INVOKER (MUST stay; see migration 002 comment)
-- - redact_venue_report_notes_on_profile_delete — SECURITY DEFINER (preserved from
--   migration 014; needs elevated rights to UPDATE venue_reports rows belonging to
--   the deleted user even after reported_by is SET NULL)
--
-- References:
--   PostgreSQL docs — SET search_path, security best practices
--   UK GDPR Art.25 — data protection by design
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. touch_updated_at
--    Trigger function: sets updated_at = now() before any UPDATE.
--    Defined in migration 001; recreated here with locked search_path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = extensions, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. set_venue_location
--    Trigger function: derives the PostGIS geography column from lat/lng.
--    Defined in migration 001; recreated here with locked search_path.
--    postgis functions live in public (ST_Point) — fully qualified below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_venue_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = extensions, public
AS $$
BEGIN
  NEW.location = ST_Point(NEW.longitude, NEW.latitude)::geography;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. update_venue_rating
--    Trigger function: recalculates review_count and average_rating on venues
--    after any INSERT/UPDATE/DELETE on reviews.
--    Defined in migration 001; recreated here with locked search_path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_venue_rating()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = extensions, public
AS $$
BEGIN
  UPDATE public.venues
  SET
    review_count   = (
      SELECT COUNT(*)
      FROM public.reviews
      WHERE venue_id = COALESCE(NEW.venue_id, OLD.venue_id)
        AND moderation_status = 'approved'
    ),
    average_rating = (
      SELECT COALESCE(AVG(rating), 0)
      FROM public.reviews
      WHERE venue_id = COALESCE(NEW.venue_id, OLD.venue_id)
        AND moderation_status = 'approved'
    ),
    updated_at     = now()
  WHERE id = COALESCE(NEW.venue_id, OLD.venue_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ---------------------------------------------------------------------------
-- 4. get_nearby_venues
--    RPC: returns venues within a radius with filters attached.
--    Latest full definition is from migration 019 (float8 lat/lng, 11 params).
--    SECURITY INVOKER is preserved intentionally — see migration 002 comment:
--    running as the caller means RLS on the venues table applies, so a future
--    policy tightening (e.g. hiding reported venues) is automatically enforced.
--
--    The 9-param overload from migration 002 was superseded by the 11-param
--    overload from migration 013/019. Only the 11-param signature exists at
--    this point; we recreate it here with SET search_path = extensions, public.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
);

CREATE OR REPLACE FUNCTION public.get_nearby_venues(
  lat              float,
  lng              float,
  p_radius_km      float      DEFAULT 32,
  category_ids     uuid[]     DEFAULT NULL,
  p_min_age        int        DEFAULT NULL,
  p_max_age        int        DEFAULT NULL,
  price_ranges     text[]     DEFAULT NULL,
  open_now         boolean    DEFAULT false,
  p_limit          int        DEFAULT 50,
  p_facility_ids   uuid[]     DEFAULT NULL,
  p_premium_only   boolean    DEFAULT false
)
RETURNS TABLE (
  id              uuid,
  name            text,
  slug            text,
  description     text,
  category_id     uuid,
  city            text,
  postcode        text,
  latitude        float8,
  longitude       float8,
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
SET search_path = extensions, public
AS $$
BEGIN
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
    sub.id, sub.name, sub.slug, sub.description, sub.category_id,
    sub.city, sub.postcode,
    sub.latitude::float8,
    sub.longitude::float8,
    sub.price_range, sub.min_age, sub.max_age,
    sub.is_premium, sub.is_verified, sub.review_count, sub.average_rating,
    sub.featured_until, sub.has_hours, sub.distance_km
  FROM (
    SELECT
      v.id, v.name, v.slug, v.description, v.category_id,
      v.city, v.postcode, v.latitude, v.longitude,
      v.price_range, v.min_age, v.max_age,
      v.is_premium, v.is_verified, v.review_count, v.average_rating,
      v.featured_until,

      EXISTS(
        SELECT 1 FROM public.opening_hours oh WHERE oh.venue_id = v.id
      ) AS has_hours,

      ROUND((
        ST_Distance(v.location, ST_Point(lng, lat)::geography) / 1000.0
      )::numeric, 2)::float AS distance_km

    FROM public.venues v
    WHERE
      v.is_published        = true
      AND v.moderation_status = 'approved'
      AND v.location IS NOT NULL
      AND ST_DWithin(
        v.location,
        ST_Point(lng, lat)::geography,
        LEAST(p_radius_km, 80.0) * 1000.0
      )
      AND (category_ids IS NULL OR v.category_id = ANY(category_ids))
      AND (p_min_age IS NULL OR v.max_age >= p_min_age)
      AND (p_max_age IS NULL OR v.min_age <= p_max_age)
      AND (price_ranges IS NULL OR v.price_range = ANY(price_ranges))
      AND (
        open_now = false
        OR EXISTS (
          SELECT 1 FROM public.opening_hours oh
          WHERE oh.venue_id    = v.id
            AND oh.day_of_week = EXTRACT(DOW FROM now() AT TIME ZONE 'Europe/London')::int
            AND oh.is_closed   = false
            AND oh.opens_at   <= (now() AT TIME ZONE 'Europe/London')::time
            AND oh.closes_at  >  (now() AT TIME ZONE 'Europe/London')::time
        )
        OR NOT EXISTS (SELECT 1 FROM public.opening_hours oh WHERE oh.venue_id = v.id)
      )
      AND (
        p_facility_ids IS NULL
        OR EXISTS (
          SELECT 1 FROM public.venue_facilities vf
          WHERE vf.venue_id = v.id AND vf.facility_id = ANY(p_facility_ids)
        )
      )
      AND (
        p_premium_only = false
        OR (v.is_premium = true AND v.featured_until IS NOT NULL AND v.featured_until > now())
      )
  ) sub
  ORDER BY
    CASE
      WHEN sub.is_premium AND sub.featured_until IS NOT NULL AND sub.featured_until > now()
      THEN 0
      ELSE 1
    END,
    sub.distance_km ASC
  LIMIT LEAST(p_limit, 200);

END;
$$;

-- Re-apply the same execute grants as migration 019.
REVOKE EXECUTE ON FUNCTION public.get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. redact_venue_report_notes_on_profile_delete
--    Trigger function (BEFORE DELETE on profiles): NULLs free-text notes on
--    venue_reports when the reporting user deletes their account.
--    Defined in migration 014; recreated here with locked search_path.
--    SECURITY DEFINER is preserved: the trigger fires in the context of the
--    DELETE on profiles; without SECURITY DEFINER the function cannot UPDATE
--    venue_reports rows whose reported_by is already being SET NULL by the FK.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redact_venue_report_notes_on_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
BEGIN
  UPDATE public.venue_reports
  SET    notes = NULL
  WHERE  reported_by = OLD.id;
  RETURN OLD;
END;
$$;
