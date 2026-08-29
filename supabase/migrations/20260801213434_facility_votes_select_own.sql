-- =============================================================================
-- 20260801213434_facility_votes_select_own.sql
-- Phase 8 reliability-repair fix: 42501 when casting/updating a facility vote.
--
-- ROOT CAUSE (confirmed against the 2026-08 production RLS/grant/trigger
-- diagnostics, against the client call site in hooks/useFacilities.ts, and
-- against a local pglite reproduction in supabase/tests/20260801213434_*.mjs)
-- -----------------------------------------------------------------------
-- useCastFacilityVote() upserts into venue_facility_votes with an explicit
-- conflict target:
--
--   supabase.from('venue_facility_votes').upsert(row, { onConflict: '...' }).select('id')
--
-- PostgREST compiles this to:
--   INSERT ... ON CONFLICT (venue_id, user_id, facility_slug) DO UPDATE ...
--   RETURNING id
--
-- PostgreSQL's row-security rules require the calling role to hold the
-- table's SELECT policy for an ON CONFLICT DO UPDATE clause to execute AT
-- ALL -- independent of whether RETURNING is present, and independent of
-- whether a real conflict occurs. Postgres must be able to read a
-- potential conflicting row to decide whether to update it, so the SELECT
-- policy is required up front, not just for the RETURNING output. (The
-- local pglite reproduction confirms this precisely: a bare INSERT with no
-- ON CONFLICT clause and no RETURNING succeeds with zero SELECT policy; the
-- identical ON CONFLICT DO UPDATE upsert fails even with RETURNING removed
-- and even on a brand-new, non-conflicting row.)
--
-- Migration 050 gave venue_facility_votes INSERT/UPDATE/DELETE-own policies
-- but deliberately NO SELECT policy at all -- individual votes are private
-- by design (050 SECTION 6). Every upsert -- which is the ONLY way the
-- client ever writes a vote -- therefore hits SQLSTATE 42501 ("new row
-- violates row-level security policy for table venue_facility_votes"),
-- regardless of whether it's a user's first vote or a re-vote.
--
-- This was confirmed as the actual cause, not merely the leading guess,
-- before this migration was written: production evidence showed RLS
-- enabled with exactly the INSERT/UPDATE/DELETE-own policies above and NO
-- SELECT policy; table grants already correct and untouched (not the
-- cause); both trigger functions still genuinely SECURITY DEFINER, owned by
-- postgres, which bypasses RLS (not the cause); both triggers still
-- enabled (not the cause). SELECT was the only missing piece.
--
-- FIX
-- ---
-- Add an authenticated-own SELECT policy: a signed-in user may read only
-- the vote rows they themselves cast. This does NOT create any new way to
-- see other users' votes or make individual votes public -- the aggregate
-- (venue_facility_stats) remains the only surface anyone else reads from
-- (050 SECTION 6), unchanged by this migration.
--
-- IDEMPOTENCY
-- -----------
-- DROP POLICY IF EXISTS before CREATE POLICY, matching this repo's
-- established idempotent-policy pattern (see migrations 009, 010, 054).
-- =============================================================================

DROP POLICY IF EXISTS "venue_facility_votes_select_own" ON public.venue_facility_votes;

CREATE POLICY "venue_facility_votes_select_own"
  ON public.venue_facility_votes FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
