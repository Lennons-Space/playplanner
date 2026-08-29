-- =============================================================================
-- 058_fix_venue_photos_rls_recursion.sql
--
-- Reliability-repair fix: 42P17 (infinite recursion detected in policy for
-- relation "venue_photos") on every authenticated photo upload.
--
-- ROOT CAUSE
-- ----------
-- Migration 007's INSERT policy ("Authenticated users can upload photos")
-- enforces the per-user-per-venue (5) and per-venue (20) photo caps with two
-- inline subqueries that SELECT from venue_photos itself:
--
--   and (
--     select count(*) from venue_photos existing
--     where existing.venue_id   = venue_photos.venue_id
--       and existing.uploaded_by = auth.uid()
--   ) < 5
--   and (
--     select count(*) from venue_photos existing
--     where existing.venue_id = venue_photos.venue_id
--   ) < 20
--
-- PostgreSQL marks venue_photos "in use" while evaluating this INSERT policy's
-- WITH CHECK expression. The subqueries then read from venue_photos, which
-- re-triggers RLS policy evaluation on the SAME table — the SELECT policies
-- ("Approved photos are public", "Users can view own photos") get evaluated
-- as part of resolving the subquery, and the engine detects the self-reference
-- and aborts with SQLSTATE 42P17 (invalid_object_definition, reported as
-- "infinite recursion detected in policy for relation \"venue_photos\"")
-- instead of ever completing the insert. This is the exact same recursion
-- class already fixed once in this repo for `reviews` — see migration
-- 054_fix_reviews_rls_recursion.sql (SECURITY DEFINER count function + STABLE
-- + pinned search_path).
--
-- Confirmed via on-device instrumentation (Reliability Repair Sprint,
-- PHOTO_STAGE dev logging in hooks/useVenuePhotos.ts): venue_photos had ZERO
-- rows for the reproduction venue and the Storage object never landed either
-- — ruling out the 5/20 caps themselves, RLS ownership mismatches, and
-- Storage/schema drift as the cause. The failure is structural (the policy
-- can never succeed for ANY insert, on ANY venue, cap or no cap) and is
-- reproduced directly in supabase/tests/058_fix_venue_photos_rls_recursion.mjs
-- by loading the REAL migration 007 policy text into pglite and observing the
-- 42P17 error on a plain first-ever insert.
--
-- FIX (hardening pass — see "REVISION HISTORY" below)
-- ----------------------------------------------------
-- ONE SECURITY DEFINER helper function, private.can_authenticated_user_add_
-- venue_photo(target_venue uuid), replaces both inline count subqueries AND
-- adds a correctness fix (see "NULL venue_id BUG" below). SECURITY DEFINER
-- runs as the function owner (the migration-running role, which has
-- BYPASSRLS in this project — same as postgres in migration 054's comment),
-- so its internal queries execute in a separate, RLS-free execution context
-- and never re-trigger venue_photos' own policies. This breaks the
-- recursion without changing the 5/20 limits themselves.
--
-- REVISION HISTORY (this migration file was hardened before being applied
-- anywhere — the version below is the ONLY version that was ever proposed
-- for production; an earlier draft used two public-schema functions and is
-- documented here only so the DROP FUNCTION IF EXISTS cleanup below makes
-- sense if that draft was ever trialled against a scratch/staging database
-- during review)
-- ---------------------------------------------------------------------------
-- v1 (superseded, never applied to production): two functions,
--   public.user_photo_count_for_venue(uuid) and
--   public.total_photo_count_for_venue(uuid), both in the public schema.
-- v2 (this version): hardened per review feedback —
--   1. SCHEMA EXPOSURE: public.total_photo_count_for_venue(uuid) was
--      independently callable as POST /rest/v1/rpc/total_photo_count_for_venue
--      by any signed-in client (any function in `public` with EXECUTE granted
--      to `authenticated` is directly RPC-callable — that is what `public`
--      being in Supabase's default "Exposed schemas" API setting means). It
--      would have let any authenticated user learn the TOTAL photo count
--      (including pending/rejected, not just approved/visible) for ANY venue
--      by id — a real, if minor, information leak beyond what the SELECT
--      policies already allow. Moved into a new `private` schema instead
--      (see "WHY A NEW SCHEMA" below) and collapsed to a single boolean
--      helper so no numeric count is ever independently queryable at all.
--   2. NULL venue_id BUG: neither v1 function (nor migration 007's original
--      inline subqueries) rejected a NULL venue_id. See "NULL venue_id BUG"
--      below — the new helper explicitly guards against this.
--   3. SEARCH PATH: v1 used `SET search_path = public` (this repo's existing
--      convention, from 025_lock_function_search_paths.sql). This helper
--      needs neither PostGIS nor anything outside pg_catalog, so it uses an
--      empty search_path instead — see "SEARCH PATH" below.
--
-- WHY A NEW SCHEMA ("private")
-- -----------------------------------------------------------------------
-- IMPORTANT — this is a NEW convention, not an existing one. Every migration
-- in this repo was grepped for `create schema`, `private.`, `security.` —
-- there is no existing "private"/non-exposed helper schema anywhere. Every
-- existing function (is_admin(), user_review_count_today(),
-- get_nearby_venues(), etc.) lives in `public` with a LOCKED but still
-- `public`-inclusive search_path (025's whole point was pinning search_path
-- to a fixed, non-shadowable value, not restricting which schema the
-- function itself lives in or is callable from). This migration introduces
-- `private` as this repo's first schema-level exposure boundary. The name
-- `private` was chosen for clarity of intent over an alternative like
-- `internal` or `rls` — it directly signals "not part of the public API
-- surface" to a future reader with no other context.
--
-- HOW MUCH THIS MIGRATION CAN ACTUALLY GUARANTEE — READ THIS BEFORE TRUSTING
-- "private" TO MEAN "unreachable"
-- -----------------------------------------------------------------------
-- Whether a schema is reachable via Supabase's PostgREST Data API
-- (POST /rest/v1/rpc/<fn>) is controlled by a DASHBOARD PROJECT SETTING
-- (Settings -> API -> "Exposed schemas"), which defaults to `public` and
-- `graphql_public` — NOT by anything a SQL migration can inspect or enforce.
-- This migration can only ensure:
--   (a) the function does not live in `public` or `graphql_public` (the two
--       schemas exposed by default), and
--   (b) `anon` and `PUBLIC` have no USAGE on the schema and no EXECUTE on
--       the function, so even if `private` were ever added to the exposed
--       list, only an already-authenticated caller could reach it.
-- It CANNOT confirm, from inside a migration file, that `private` is absent
-- from the live project's exposed-schemas list — that list lives outside
-- Postgres, in Supabase's own project configuration. Liam must verify this
-- himself in the Dashboard (Settings -> API -> Exposed schemas) after
-- applying this migration. It will not be there by default (only schemas
-- explicitly added to that list are ever exposed), but "will not be by
-- default" is not the same guarantee as "is confirmed absent" — check it,
-- don't just trust this migration.
--
-- NULL venue_id BUG (independent correctness fix, not just a security
-- hardening — folded into this migration since it touches the same policy)
-- -----------------------------------------------------------------------
-- venue_photos.venue_id has NO `not null` constraint (see
-- 001_initial_schema.sql: `venue_id uuid references venues(id) on delete
-- cascade` — no NOT NULL). A foreign key constraint does NOT reject NULL
-- (NULL trivially satisfies any FK — there is nothing to check a reference
-- against). Migration 007's original cap subqueries filtered on
-- `existing.venue_id = venue_photos.venue_id`; if the INSERTed row's
-- venue_id is NULL, that comparison is NULL (unknown) for every existing
-- row, so the WHERE clause matches nothing and count(*) = 0 — meaning both
-- `0 < 5` and `0 < 20` trivially pass in isolation.
--
-- Two separate things are true here, confirmed empirically rather than
-- assumed (see supabase/tests/058_fix_venue_photos_rls_recursion.mjs, tests
-- 1b and 1c): a NULL-venue_id insert against migration 007's ACTUAL DEPLOYED
-- policy never independently reaches this arithmetic — it hits the SAME
-- 42P17 recursion as any other insert first, since evaluating any subquery
-- against venue_photos re-triggers its own SELECT policies the moment the
-- table is touched, regardless of what the WHERE clause would have matched
-- (test 1b). The cap-bypass arithmetic flaw is nonetheless real and is
-- proven directly by running 007's exact count-subquery logic AS SUPERUSER
-- (bypassing RLS, isolating the arithmetic from the unrelated recursion bug)
-- with venue_id = NULL: both counts read back 0 (test 1c). So this flaw was
-- never actually exploitable against LIVE production (recursion always
-- blocked the insert first) — but it WOULD have become exploitable the
-- moment recursion was fixed by any means that didn't also add an explicit
-- NULL guard, which is exactly what this migration's own superseded v1
-- draft would have done (see "REVISION HISTORY" above — v1 had no NULL
-- check). The new helper explicitly checks `target_venue IS NOT NULL`
-- before anything else, closing this for good in the version that actually
-- ships — a NULL venue_id now fails the WITH CHECK outright instead of
-- silently bypassing both caps and creating an orphaned photo row.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- - The 5-per-user-per-venue and 20-per-venue numeric limits (unchanged).
-- - auth.uid() = uploaded_by and status = 'pending' remain direct,
--   independently-visible table-column checks in the policy itself (Liam's
--   explicit ask: these two must stay readable at the policy level, not be
--   folded into the helper).
-- - The SELECT policies ("Approved photos are public", "Users can view own
--   photos"), the DELETE policy ("Users can delete own photos"), the admin
--   policy ("Admins can manage all photos"), and every Storage bucket/policy
--   (migrations 007/008/020/031) — none of these are touched.
-- - Migration 20260801213434_facility_votes_select_own (facility-vote RLS)
--   — unrelated table, not touched. (That migration was numbered 057 when
--   this file was written; it was re-versioned during the 2026-08
--   migration-history reconciliation. Version 057 is now
--   057_enrichment_auto_decision.sql, the migration production actually ran.)
--
-- SAFETY (why SECURITY DEFINER is safe here — same reasoning shape as
-- migration 048's is_admin() note)
-- -------------------------------------------------------------------------
-- The helper returns ONE boolean, computed from checks the caller could
-- already legally learn the outcome of some other way (an authenticated
-- user can already see their own venue_photos rows via the existing SELECT
-- policy; venue existence is independently checkable via the public venues
-- read path). It exposes no row contents, and — unlike the superseded v1
-- design — exposes no independently-queryable NUMBER either, only a single
-- pass/fail bit scoped to exactly what the INSERT policy needs to decide.
-- It cannot be used to read, insert, update, or delete anything, accepts no
-- role/identity override, and reads auth.uid() from the session rather than
-- from an argument, so there is no identity parameter to spoof.
--
-- SEARCH PATH
-- -----------
-- `SET search_path = ''` (empty). Every reference inside the function body
-- is already fully schema-qualified (public.venue_photos, public.venues,
-- auth.uid()), and this function needs nothing from `extensions` (no
-- PostGIS, unlike get_nearby_venues) — so, per review feedback, it is
-- pinned to nothing at all rather than reusing 025's wider
-- `extensions, public` convention. pg_catalog (built-in operators/types:
-- =, <, uuid, boolean, AND, IS NOT NULL, EXISTS) is always implicitly
-- searched first regardless of search_path per PostgreSQL's own docs, so an
-- empty search_path does not break those. Verified directly against pglite
-- in supabase/tests/058_fix_venue_photos_rls_recursion.mjs — it works with
-- no fallback needed.
--
-- GRANTS
-- ------
-- This function is called from inside the venue_photos INSERT policy, which
-- is evaluated AS THE QUERYING ROLE — i.e. `authenticated` for every real
-- app upload (migration 048's landmine: revoking EXECUTE from a role that
-- evaluates a policy referencing the function turns every query into a
-- blanket 42501 outage, not a graceful denial). So EXECUTE is granted to
-- `authenticated`, and the schema itself grants USAGE to `authenticated`
-- only (needed so `authenticated` can even resolve the schema-qualified
-- `private.can_authenticated_user_add_venue_photo(...)` call from inside the
-- policy). EXECUTE is explicitly revoked from PUBLIC and from `anon` (the
-- `anon` revoke is defensive/explicit — anon never had it in the first
-- place, since nothing grants it by default on a newly created function
-- other than PUBLIC, but stating it explicitly removes any ambiguity for a
-- future reader). An anon caller can never complete this insert either way
-- (blocked by the top-level `auth.uid() = uploaded_by` check, and now also
-- by `SCHEMA private` having no USAGE grant to anon) — this is about
-- exposure hygiene, not a functional change for anon.
--
-- IDEMPOTENCY
-- -----------
-- CREATE SCHEMA IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF
-- EXISTS / CREATE POLICY, and REVOKE/GRANT are all safe to re-run. The
-- DROP FUNCTION IF EXISTS lines below clean up the superseded v1 public-
-- schema functions in case that draft was ever applied to a scratch/staging
-- database during review — they are no-ops against a database that never
-- saw v1 (including production, which has never had ANY version of this
-- migration applied).
--
-- Safety: wrapped in BEGIN/COMMIT, matching this table's own migration
-- convention (007/008) — the whole migration rolls back if any statement
-- fails. Run in: Supabase Dashboard > SQL Editor.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Clean up the superseded v1 draft (public.*), in case it was ever applied
--    to a scratch/staging database during review. No-op everywhere else,
--    including production.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.user_photo_count_for_venue(uuid);
DROP FUNCTION IF EXISTS public.total_photo_count_for_venue(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The `private` schema — this repo's first non-exposed helper schema.
--    See the "WHY A NEW SCHEMA" and "HOW MUCH THIS MIGRATION CAN ACTUALLY
--    GUARANTEE" header sections above before assuming this is unreachable
--    via the Data API — that also depends on a Dashboard setting.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The single boolean helper. Breaks the venue_photos RLS recursion (was
--    two inline subqueries reading venue_photos from inside venue_photos'
--    own INSERT policy) AND closes the NULL-venue_id cap-bypass bug — see
--    the header comments above for both.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.can_authenticated_user_add_venue_photo(target_venue uuid)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND target_venue IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.venues WHERE id = target_venue
    )
    -- Per-user-per-venue cap: max 5 photos.
    AND (
      SELECT count(*) FROM public.venue_photos
      WHERE venue_id = target_venue
        AND uploaded_by = auth.uid()
    ) < 5
    -- Per-venue cap: max 20 photos total.
    AND (
      SELECT count(*) FROM public.venue_photos
      WHERE venue_id = target_venue
    ) < 20;
$$;

REVOKE EXECUTE ON FUNCTION private.can_authenticated_user_add_venue_photo(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.can_authenticated_user_add_venue_photo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.can_authenticated_user_add_venue_photo(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recreate the INSERT policy. auth.uid() = uploaded_by and
--    status = 'pending' stay as INDEPENDENTLY VISIBLE, direct table-column
--    checks at the policy level (not folded into the helper) — the helper
--    covers only the three checks that genuinely needed a separate
--    RLS-free execution context (venue existence + both caps, all of which
--    would otherwise recurse or leak).
--    Explicit `TO authenticated` (migration 007's original omitted a TO
--    clause, which defaults the policy role to PUBLIC — every role,
--    including anon, would have Postgres attempt to evaluate this policy's
--    WITH CHECK for them, rather than being filtered out before RLS
--    evaluation begins at all). Least-privilege tightening: only
--    `authenticated` can ever legally satisfy `auth.uid() = uploaded_by`
--    anyway, so this is defence-in-depth, not a functional behaviour change.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON public.venue_photos;

CREATE POLICY "Authenticated users can upload photos" ON public.venue_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = uploaded_by
    AND status = 'pending'
    AND private.can_authenticated_user_add_venue_photo(venue_id)
  );

COMMIT;
