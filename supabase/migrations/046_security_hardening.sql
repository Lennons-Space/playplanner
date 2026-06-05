-- =============================================================================
-- 046_security_hardening.sql
--
-- Fixes reported by the Supabase database linter (2026-06-05):
--
--   A. search_path mutable on two functions
--      Migration 045 re-created get_nearby_venues without the SET search_path
--      clause that migration 025 had added. Migration 035 created
--      update_push_token_updated_at without it from the start.
--      Risk: a schema earlier in the session search_path could shadow a
--      system function (e.g. a malicious `myschema.now()` runs instead of
--      `pg_catalog.now()`). Fixed by locking search_path = extensions, public
--      and fully schema-qualifying all table references inside the body.
--
--   B. anon role can execute privileged functions
--      PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION.
--      Migrations that only added GRANT TO authenticated never revoked anon.
--      Risk: unauthenticated callers can invoke functions that were written
--      for authenticated users only.
--
--   C. pass_interest INSERT policy is always-true
--      The "Anyone can register interest" policy has WITH CHECK (true),
--      meaning any anonymous caller can insert rows.
--      Since the interest-registration screen has been removed, tighten to
--      require a signed-in user.
--
-- WHAT IS NOT CHANGED
-- -------------------
-- - delete_own_account: authenticated EXECUTE is preserved (profile.tsx uses
--   it for GDPR Art.17 account deletion — it guards itself with auth.uid()).
-- - review_venue_claim: authenticated EXECUTE is preserved (admin moderation
--   screen calls it; the function enforces its own admin check internally).
-- - get_nearby_venues: anon + authenticated EXECUTE are preserved (public map
--   access; the function is SECURITY INVOKER so RLS on venues applies).
-- - No app-side code changes required.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A: Fix search_path on get_nearby_venues
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT THIS DOES (beginner explanation):
--   When a database function runs, it needs to know where to look for tables
--   and other functions — this is the "search_path". If it's not set, an
--   attacker could (in theory) create a fake table or function with the same
--   name that runs instead of the real one. Locking search_path = extensions,
--   public means the function only ever looks in those two schemas, and we
--   prefix every table name with "public." so there's zero ambiguity.
--
--   This is a recreation of the function from migration 045 with two changes:
--   1. Added: SET search_path = extensions, public
--   2. Added: public. prefix on every table reference inside the body
--   Everything else (signature, return type, logic, grants) is identical.
-- ─────────────────────────────────────────────────────────────────────────────
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
  distance_km     float,
  cover_photo_url text
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
    sub.featured_until, sub.has_hours, sub.distance_km,
    sub.cover_photo_url
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
      )::numeric, 2)::float AS distance_km,

      COALESCE(
        (
          SELECT vp.url
          FROM public.venue_photos vp
          WHERE vp.venue_id = v.id
            AND vp.status = 'approved'
          ORDER BY vp.is_cover DESC, vp.sort_order ASC
          LIMIT 1
        ),
        v.image_url
      ) AS cover_photo_url

    FROM public.venues v
    WHERE
      v.is_published        = true
      AND v.moderation_status = 'approved'
      AND v.discovery_approved = true
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

-- Preserve existing access: public map (anon) and signed-in users both need
-- this RPC. SECURITY INVOKER means their own RLS applies — no privilege escalation.
REVOKE EXECUTE ON FUNCTION public.get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A (continued): Fix search_path on update_push_token_updated_at
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT THIS DOES:
--   This is a tiny trigger function that sets updated_at = now() when a push
--   token row is updated. It was defined in migration 035 without a locked
--   search_path. We re-create it here with one added line:
--     SET search_path = extensions, public
--   The trigger that calls this function does not need to be re-created.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_push_token_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = extensions, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B: Revoke anon EXECUTE from privileged functions
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT THIS DOES (beginner explanation):
--   In PostgreSQL, when you create a function it is automatically executable
--   by everyone (PUBLIC), which includes the unauthenticated "anon" role.
--   To close this, we REVOKE EXECUTE from the roles that should never call
--   these functions.
--
--   Think of it like: the function was accidentally left with the door unlocked.
--   REVOKE locks the door. The people who legitimately need access still have
--   their key (their individual GRANT is added below where needed).
-- ─────────────────────────────────────────────────────────────────────────────

-- delete_own_account
-- ------------------
-- Should only ever be called by a signed-in user deleting their own account.
-- anon callers have no auth.uid(), so the function would be a no-op for them —
-- but it still should not be reachable.
-- authenticated EXECUTE is intentionally preserved (profile.tsx uses it).
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM anon;


-- handle_new_user
-- ---------------
-- This is a trigger function (it fires when a new auth.users row is created).
-- It cannot do anything useful when called directly via RPC — PostgreSQL
-- requires trigger functions to be called by a trigger, not by a user.
-- We revoke from both anon and authenticated since no app code calls it directly.
-- The trigger itself continues to fire as normal (triggers are called by the
-- database engine, not by the anon/authenticated roles).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;


-- redact_venue_report_notes_on_profile_delete
-- -------------------------------------------
-- Another trigger function — fires on BEFORE DELETE on profiles to redact
-- free-text venue report notes. Same reasoning as handle_new_user above.
-- Already has SET search_path (migration 025). Just close the execute gap.
REVOKE EXECUTE ON FUNCTION public.redact_venue_report_notes_on_profile_delete() FROM anon, authenticated;


-- review_venue_claim
-- ------------------
-- Migration 027 already revoked from PUBLIC and granted to authenticated.
-- The linter may be seeing stale live-DB state from before that migration ran,
-- or a subsequent event re-opened it. Re-assert the correct grants here.
-- authenticated EXECUTE is preserved: the admin moderation screen calls this
-- function and relies on its internal admin check (`is_admin = true`).
REVOKE EXECUTE ON FUNCTION public.review_venue_claim(uuid, text, text) FROM anon;
-- (authenticated GRANT already exists from migration 027 — no re-grant needed)


-- is_admin
-- --------
-- Utility function that checks whether the current user is an admin.
-- Not called from any app code — the admin check in review_venue_claim
-- queries the profiles table directly. Revoke from both roles.
-- The function can still be called by postgres / service role for maintenance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
      AND pg_get_function_arguments(p.oid) = ''
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated;
  END IF;
END;
$$;


-- rls_auto_enable
-- ---------------
-- Admin/maintenance utility function. Not called from any app code.
-- Revoke from both anon and authenticated.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
      AND pg_get_function_arguments(p.oid) = ''
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION C: Tighten pass_interest INSERT policy
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT THIS DOES:
--   The pass_interest table stored emails from parents who wanted to be
--   notified when a paid subscription ("Pass") launched. The registration
--   screen has been removed, but the table and its RLS policy remain.
--
--   The original policy used WITH CHECK (true) — meaning anyone, signed in
--   or not, could insert a row. Now that there is no UI entry point, tighten
--   this to require a signed-in user. This is a safer default while the
--   table is dormant.
--
--   The table itself and any existing rows are untouched.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can register interest" ON public.pass_interest;
DROP POLICY IF EXISTS "Authenticated users can register interest" ON public.pass_interest;

CREATE POLICY "Authenticated users can register interest"
  ON public.pass_interest
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
