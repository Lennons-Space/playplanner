-- =============================================================================
-- 065_restrict_profile_read_exposure.sql
--
-- STEP 2 OF 2 -- THE CONTAINMENT. Apply ONLY after 064 is applied AND a client
-- build using get_my_profile() / get_my_profile_export() is live and verified.
-- This file is the point at which an OLD client can no longer load a profile.
--
-- CRITICAL privacy containment: every authenticated user can currently read
-- EVERY column of EVERY other user's `profiles` row -- including children's
-- age ranges, home postcode, marketing/consent state and Stripe identifiers.
--
-- THE LIVE STATE (verified read-only against production 2026-08-18)
-- -----------------------------------------------------------------
--   policy "Profiles are viewable by authenticated users"
--     FOR SELECT USING (auth.uid() IS NOT NULL)
--   plus table-level SELECT on public.profiles held by `authenticated`,
--   i.e. EVERY column of EVERY row. The whole user base is enumerable in one
--   request, including users who set show_in_search = false.
--
-- ROOT CAUSE -- TWO FAULTS
-- ------------------------
--   FAULT 1 (drift). 001:422 created the broad policy. 003:62-64 was written to
--     replace it with own-row-only. In production the broad policy is STILL
--     PRESENT and 003's replacement is ABSENT, while 003's non-policy objects
--     (the public_profiles view, delete_own_account()) DID land.
--
--   FAULT 2 (design). Migration 024 set `security_invoker = true` on
--     public_profiles. A security_invoker view evaluates the BASE TABLE's RLS
--     as the CALLING user, so restoring 003's own-row-only policy alone would
--     make public_profiles return ONLY the caller's own row -- breaking every
--     reviewer/profile display. 003's intent and 024's hardening are mutually
--     incompatible as written.
--
-- WHY RLS ALONE CANNOT FIX THIS
-- -----------------------------
-- RLS is row-level. The requirement is column-differentiated:
--   * own row      -> all columns (via 064's RPCs)
--   * opted-in row -> only the 8 public_profiles columns
-- No single RLS policy expresses that, and public_profiles must keep reading
-- `profiles` DIRECTLY (PostgREST resolves the
-- `public_profiles!reviews_user_id_fkey` embed in hooks/useReviews.ts:101
-- through the view's base-table column provenance; a view sourced from a
-- function loses the FK and that embed breaks).
--
-- Therefore: RLS for ROWS, column privileges for COLUMNS.
--
-- WHAT THE BOUNDARY ACTUALLY IS -- stated precisely
-- -------------------------------------------------
-- After this migration an authenticated caller CAN still query `public.profiles`
-- directly for the SAFE columns of an opted-in (show_in_search = true) user, and
-- that succeeds. It returns EXACTLY the same columns, for exactly the same rows,
-- as public_profiles already exposes -- so it is an equivalent access path, not
-- an escalation. Adding ANY sensitive column to such a query fails atomically at
-- the privilege layer (no partial row is returned). Both behaviours are asserted
-- explicitly in supabase/tests/065_profile_read_exposure.mjs.
--
-- The enforced boundary is therefore:
--   * the COLUMN GRANTS below decide what may ever be read cross-user;
--   * the RLS policies decide which rows;
--   * public_profiles is the safe DEFAULT query surface and the documented
--     client path -- it is NOT, and with security_invoker cannot be, the only
--     physical path to the same safe columns.
-- Claiming "cross-user access only through the view" would overstate what is
-- enforced. What is enforced is that no sensitive column is readable cross-user
-- by any path at all.
--
-- Layer 2 is also what makes this durable: policy DDL has demonstrably gone
-- missing on this database (FAULT 1). Column grants are not policies and are not
-- reverted by a schema re-apply.
--
-- COMPATIBILITY
-- -------------
-- Production is 058 + 062 + 064 (+ this). Independent of 059/060/061/063.
-- `is_admin()` (001:396-403) is SECURITY DEFINER, so the admin policy does not
-- recurse into profiles RLS (no 42P17).
-- Admin screens joining `profiles` directly for cross-user display
-- (app/admin/moderation.tsx:200,374 and hooks/useVenueClaims.ts:58) select only
-- id/username/full_name and are preserved by the admin policy + column grants.
--
-- Idempotent. Does NOT edit any historical migration. Does NOT drop the view
-- (that would break dependent objects); its options are re-asserted via ALTER.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. LAYER 1 -- SELECT policies on public.profiles (ROWS).
--
--    Permissive policies OR together, which is intended: each grants a distinct
--    minimal slice of ROWS. Columns are constrained separately in section 2 --
--    that separation is the design.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"                   ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable"                 ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles"                 ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- REQUIRED by public_profiles: that view is security_invoker, so without this
-- policy it would return only the caller's own row. Safe because section 2
-- reduces the readable columns to exactly the view's own column list.
CREATE POLICY "Public profiles are viewable" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (show_in_search = true);

-- Needed by the moderation and venue-claim queues, which must attribute pending
-- content to a user even when show_in_search = false.
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. LAYER 2 -- column-level SELECT privileges (COLUMNS). THE CONTAINMENT.
--
--    Granted: exactly the public_profiles column list, plus show_in_search,
--    which the view's WHERE clause needs under security_invoker.
--
--    NOT granted to any client role -- unreadable for ANY row, including the
--    caller's own (that is what 064's RPCs are for):
--      children_ages, postcode, marketing_consent, terms_accepted_at,
--      subscription_tier, subscription_expires_at, stripe_customer_id,
--      is_admin, updated_at
--
--    SCOPE, STATED PRECISELY (corrected 2026-08-19 -- an earlier draft of this
--    comment said "SELECT only", which was not literally true):
--      * for `authenticated` this migration changes SELECT and nothing else --
--        062's UPDATE column grants are untouched and remain in force;
--      * for `anon` it is BROADER than SELECT. `REVOKE ALL ... FROM anon`
--        below removes EVERY privilege anon holds on this table, not just
--        SELECT. That is deliberate -- see the note at that statement.
--      * service_role is NOT revoked: server/import/admin paths are unaffected.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON public.profiles FROM PUBLIC;
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (
  id,
  username,
  full_name,
  avatar_url,
  bio,
  is_business_owner,
  show_reviews_publicly,
  created_at,
  show_in_search
) ON public.profiles TO authenticated;

-- anon holds nothing at all on profiles. This is not a public directory
-- (ICO Children's Code Standard 3).
--
-- THIS IS BROADER THAN SELECT AND IS MEANT TO BE. No migration has ever
-- GRANTed anything on `profiles` to anon; everything anon holds came from
-- Supabase's ALTER DEFAULT PRIVILEGES (SELECT/INSERT/UPDATE/DELETE on new
-- tables in `public`). 062 already removed UPDATE. So immediately before this
-- migration anon still holds INSERT and DELETE as well as SELECT.
--
-- Those are inert TODAY only because there is NO INSERT policy on `profiles`
-- at all, and the DELETE policy requires auth.uid() = id. That is protection
-- by policy absence -- and this database has ALREADY lost policy DDL twice
-- (003's profiles SELECT policy and its venues rate-limit policy are both
-- missing in production). Leaving a role holding INSERT/DELETE while relying
-- on a policy that may silently vanish is the exact fragility this whole
-- migration exists to remove.
--
-- Verified: anon requires NO privilege on this table for any supported flow.
-- Registration inserts the profile row from `handle_new_user()` (003:83), an
-- AFTER INSERT trigger on auth.users that is SECURITY DEFINER and therefore
-- runs as its owner, not as the caller -- 046:260 additionally revoked EXECUTE
-- on it from anon and authenticated, so it is reachable only as a trigger.
-- Login touches only the auth schema. Account deletion runs through
-- delete_own_account() (003:130), also SECURITY DEFINER. Public browsing never
-- reads profiles: public_profiles has been revoked from anon since 004/024.
REVOKE ALL ON public.profiles FROM anon;

-- -----------------------------------------------------------------------------
-- 3. Re-assert the public_profiles contract WITHOUT dropping the view.
--    Column list intentionally left exactly as migration 024 defined it.
-- -----------------------------------------------------------------------------
ALTER VIEW public.public_profiles SET (security_invoker = true, security_barrier = true);

GRANT SELECT ON public.public_profiles TO authenticated;
REVOKE ALL   ON public.public_profiles FROM anon;
REVOKE ALL   ON public.public_profiles FROM PUBLIC;

COMMIT;
