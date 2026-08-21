-- =============================================================================
-- 067_fix_policies_reading_profile_columns.sql
--
-- COMPATIBILITY REPAIR FOR 065. Weakens NOTHING that 062/065/066 established.
--
-- THE FAILURE
-- -----------
-- 065 correctly removed `authenticated`'s table-level SELECT on public.profiles
-- and replaced it with column-level SELECT on 9 safe columns; 065 additionally
-- revoked ALL privileges on profiles from `anon`.
--
-- PostgreSQL evaluates an RLS policy expression AS THE QUERYING ROLE. Any table
-- or column a policy expression reads must therefore be readable BY THAT ROLE.
-- `is_admin` is (correctly) NOT among the 9 granted columns, so any policy that
-- reads it through an inline sub-select now raises:
--
--     ERROR: 42501 permission denied for table profiles
--
-- The permission check covers every relation in the query's range table, so the
-- error fires REGARDLESS of which permissive policy would have matched and
-- regardless of whether the sub-select would have been reached.
--
-- THE VERIFIED PRODUCTION SCOPE -- FOUR POLICIES
-- ----------------------------------------------
-- A production-wide pg_policies sweep (2026-08-20) confirmed these are EXACTLY
-- the four live policies whose expressions directly reference
-- `profiles.is_admin`. This migration changes these four and nothing else:
--
--   1. public.reviews        "Approved reviews are public"                 SELECT
--   2. public.venue_claims   "Admins can view all claims"                  SELECT
--   3. public.venue_claims   "Admins can update claims"                    UPDATE
--   4. storage.objects       "Admins can delete any venue photo from storage" DELETE
--
-- The affected OPERATION differs per table -- this is not a SELECT-only fault:
--   * public.reviews       -> every SELECT against reviews fails.
--   * public.venue_claims  -> every SELECT AND every UPDATE against
--                             venue_claims fails.
--   * storage.objects      -> every DELETE against storage.objects fails for
--                             `authenticated` (a DELETE carrying a WHERE clause
--                             also evaluates the SELECT policies, but those are
--                             not affected here).
--
-- OBSERVED IMPACT (real-device smoke test, 2026-08-20, post-065)
--   CONFIRMED ON DEVICE: Download My Data, My Reviews, and the admin
--     pending-reviews queue all fail -- all three query public.reviews.
--   BROKEN BY THE SAME POLICIES, NOT YET EXERCISED ON DEVICE: venue-detail
--     review lists, the admin venue-claims queue, and venue-photo deletion.
--   UNAFFECTED, AND OBSERVED WORKING: venue moderation (the venues policies
--     call the SECURITY DEFINER helper is_admin() rather than reading the
--     column inline) and the Profile / Edit Profile screens (064's RPCs and
--     062's UPDATE grants, neither of which 065 touched).
--
-- This is the identical failure class already recorded on this database in
-- migration 048 (EXECUTE revoked from is_admin() broke every venue query). The
-- fix is the same shape: obtain the privileged fact through a SECURITY DEFINER
-- function instead of reading the column inline as the calling role.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
--   * does NOT restore table-level SELECT on profiles to any client role
--   * does NOT restore any privilege to anon
--   * does NOT grant any sensitive profile column to any client role
--   * does NOT alter public_profiles, its grants, or its security options
--   * does NOT alter 062's restricted UPDATE column grants
--   * does NOT modify any row of data
--   * does NOT change the role, command or row semantics of any policy
--
-- Idempotent. Edits no historical migration. Does not touch 062/064/065/066.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Remove the rejected first-draft helper, if it was ever applied anywhere.
--
--    An earlier draft of this migration created
--    can_view_approved_review(p_author_id uuid), keyed on the AUTHOR. That
--    design was rejected in review: because it took a profile id and consulted
--    no review, an ordinary authenticated caller could supply an arbitrary
--    profile UUID and read back that profile's show_reviews_publicly value --
--    even for a profile with show_in_search = false that 065 makes invisible to
--    them, and even for a user with no approved reviews at all. That is a
--    profile-setting lookup API, not a review predicate, and it eroded the
--    row-level boundary 065 established.
--
--    It was never applied to production. This DROP is defensive so that any
--    environment where a draft WAS applied converges on the correct state.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.can_view_approved_review(uuid);

-- -----------------------------------------------------------------------------
-- 1. Public-visibility predicate for a SPECIFIC REVIEW.
--
--    Migration 021 expressed the reviews SELECT rule inline:
--
--      moderation_status = 'approved' AND (
--        exists (select 1 from profiles p
--                 where p.id = reviews.user_id and p.show_reviews_publicly = true)
--        or auth.uid() = user_id
--        or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
--      )
--
--    Only the FIRST arm needs a helper. The other two are already covered by
--    separate permissive policies created in migration 001 and left untouched
--    here ("Users can view own reviews" and "Admins can view all reviews", the
--    latter via the SECURITY DEFINER is_admin()). Permissive policies OR
--    together, so the effective rule is unchanged.
--
--    WHY IT IS KEYED ON THE REVIEW, NOT THE AUTHOR
--    ---------------------------------------------
--    The parameter is a REVIEW id and the function consults the review itself.
--    It therefore cannot answer any question about a profile in isolation:
--    there is no input that makes it report a profile setting without an
--    approved review of that author's actually existing.
--
--    DISCLOSURE SURFACE, stated precisely and exhaustively:
--
--      returns TRUE  <=> the caller is authenticated
--                        AND a review with this id exists
--                        AND it is moderation_status = 'approved'
--                        AND its author has show_reviews_publicly = true
--
--      Whenever it returns TRUE, the policy below admits that same review, so
--      the caller could have obtained the identical fact with
--      `select 1 from reviews where id = <that id>`. TRUE therefore discloses
--      strictly nothing beyond selecting the same row.
--
--      It returns FALSE -- indistinguishably -- for an anonymous caller, a
--      nonexistent id, a non-approved review, and an approved review whose
--      author has show_reviews_publicly = false. Because those four cases are
--      not distinguishable in the output, a FALSE cannot be used to learn that
--      a given id exists, nor to learn any author's setting: a caller who
--      cannot already see the review cannot tell "no such review" from "author
--      is private". Review ids are unguessable v4 UUIDs, so an id the caller
--      cannot see is an id the caller does not have.
--
--      Note it returns FALSE for the caller's OWN unapproved review even though
--      the caller CAN select that row (via "Users can view own reviews"). The
--      helper therefore discloses strictly LESS than a SELECT, never more.
--
--    SECURITY DEFINER is required, not cosmetic: after 065 no client role can
--    see a show_in_search = false profile row at all, so an invoker-rights
--    function could not evaluate the author's setting and reviews by such
--    authors would silently vanish -- see section 2.
--
--    NO RECURSION: the function reads public.reviews while being called from a
--    policy ON public.reviews. It is SECURITY DEFINER and runs as its owner
--    (postgres, which holds BYPASSRLS and owns the table), so RLS is not
--    re-entered inside the body. This is the same mechanism migration 054 used
--    to break the reviews INSERT rate-limit recursion, and it is already live.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_is_publicly_visible(p_review_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $fn$
  SELECT
    -- ANONYMOUS CALLERS GET NOTHING -- this arm is load-bearing, not defensive.
    -- Under migration 021 the author check was `exists (select 1 from profiles
    -- ...)`, and the pre-065 profiles SELECT policy was
    -- `USING (auth.uid() IS NOT NULL)`. For an anonymous caller that policy
    -- matched no rows, so the EXISTS was always FALSE and anon saw ZERO
    -- approved reviews. Reading profiles as definer bypasses that, which would
    -- SILENTLY START PUBLISHING review bodies to logged-out users. Review
    -- bodies can describe children. This migration repairs compatibility; it
    -- does not widen an audience.
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.reviews r
        JOIN public.profiles p ON p.id = r.user_id
       WHERE r.id = p_review_id
         AND r.moderation_status = 'approved'
         AND p.show_reviews_publicly = true
    );
$fn$;

-- All three revokes are required. Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE on new functions DIRECTLY to anon and authenticated, so revoking
-- PUBLIC alone leaves both roles holding it (proven in production during the
-- 062 rollout, 2026-08-16).
REVOKE EXECUTE ON FUNCTION public.review_is_publicly_visible(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_is_publicly_visible(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.review_is_publicly_visible(uuid) FROM authenticated;

-- anon MUST hold EXECUTE even though the function always returns FALSE for it:
-- the "Approved reviews are public" policy has no TO clause, so PostgreSQL
-- evaluates it for anonymous venue browsing too. Without EXECUTE, logged-out
-- browsing fails with 42501 on the FUNCTION instead of on the table -- exactly
-- the regression migration 048 had to repair. Granting EXECUTE discloses
-- nothing: for a caller with no auth.uid() the first arm short-circuits FALSE.
GRANT EXECUTE ON FUNCTION public.review_is_publicly_visible(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.review_is_publicly_visible(uuid) IS
  'Answers "is THIS review an approved review whose author publishes reviews '
  'publicly, for an authenticated caller?" Keyed on the review id, never on a '
  'profile id, so it cannot report any profile setting in isolation. Returns '
  'TRUE only in cases where the reviews SELECT policy already admits that same '
  'row, and returns an indistinguishable FALSE for anonymous callers, unknown '
  'ids, non-approved reviews and non-publishing authors. Own-review and admin '
  'visibility are provided by separate policies and are deliberately NOT '
  'expressed here.';

-- -----------------------------------------------------------------------------
-- 2. public.reviews -- policy 1 of 4.
--     Replaces the inline profiles reads with the predicate above.
--     Role and command unchanged (no TO clause, FOR SELECT), row semantics
--     unchanged from migration 021.
--
--     `moderation_status = 'approved'` is retained even though the helper also
--     checks it: it keeps the policy self-describing and lets the planner
--     discard non-approved rows before any function call.
--
--     The show_in_search TRAP, avoided deliberately: if the author lookup were
--     left under the caller's RLS, 065's profiles policies would restrict it to
--     the caller's own row, rows with show_in_search = true, or (for admins)
--     all rows -- so an author with show_in_search = false would silently lose
--     visibility for their approved reviews. That would make show_in_search (a
--     profile-directory setting) start governing review visibility (a separate,
--     independently-consented setting). Evaluating the author's setting as
--     definer is what keeps show_reviews_publicly the sole governing setting.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Approved reviews are public" ON public.reviews;

CREATE POLICY "Approved reviews are public" ON public.reviews
  FOR SELECT
  USING (
    moderation_status = 'approved'
    AND public.review_is_publicly_visible(id)
  );

-- Untouched and still in force from migration 001 (listed here only so the full
-- SELECT surface on reviews is visible in one place -- NOT recreated):
--   "Users can view own reviews"  FOR SELECT USING (auth.uid() = user_id)
--   "Admins can view all reviews" FOR SELECT USING (is_admin())
-- Both already route through own-row identity or the SECURITY DEFINER helper,
-- so neither reads a profiles column as the calling role. Together with the
-- policy above they reproduce migration 021's three arms exactly.

-- -----------------------------------------------------------------------------
-- 3. public.venue_claims -- policies 2 and 3 of 4, from migration 023.
--     Same inline is_admin read, same 42501. Role (no TO clause), command and
--     row semantics are preserved exactly; only the admin test changes from an
--     inline column read to the existing SECURITY DEFINER helper.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all claims" ON public.venue_claims;
CREATE POLICY "Admins can view all claims" ON public.venue_claims
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update claims" ON public.venue_claims;
CREATE POLICY "Admins can update claims" ON public.venue_claims
  FOR UPDATE
  USING (public.is_admin());

-- Untouched from migration 023: "Users can insert own claims" (INSERT) and
-- "Users can view own claims" (SELECT). Neither reads profiles.

-- -----------------------------------------------------------------------------
-- 4. storage.objects -- policy 4 of 4, from migration 031.
--     Role (authenticated), command (DELETE) and bucket scope preserved
--     exactly; only the admin test changes.
--
--     NOTE: this section requires the migration to run as a role permitted to
--     manage policies on storage.objects (the Supabase `postgres` role is).
--     If it raises insufficient_privilege the whole migration rolls back and
--     nothing in sections 0-3 is applied -- which is the safe outcome, not a
--     partial one. In that case run sections 0-3 alone and raise section 4
--     separately.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can delete any venue photo from storage" ON storage.objects;
CREATE POLICY "Admins can delete any venue photo from storage"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'venue-photos'
    AND public.is_admin()
  );

-- Untouched from migration 031: "Users can delete own venue photos", which
-- checks venue_photos.uploaded_by and reads no profiles column.

COMMIT;
