-- =============================================================================
-- 063_fix_venue_submission_trust_bypass.sql
--
-- Hardens the `public.venues` INSERT boundary.
--
--   PP-012 (HIGH)     -- there is NO database-level venue submission rate limit.
--   PP-010 (CRITICAL) -- an INSERT may establish venue OWNERSHIP (claimed_by),
--                        which chains into the claimed-owner UPDATE policy.
--   PP-011 (HIGH)     -- that claimed-owner UPDATE policy itself. NOT fixed here,
--                        deliberately. See "PP-011 IS OUT OF SCOPE" below.
--
-- =============================================================================
-- VERIFIED LIVE PRODUCTION BASELINE -- read-only probes, 2026-08-26
-- =============================================================================
-- Everything below was read out of the live database. It is NOT derived from
-- migration history. That distinction matters: this database has twice been
-- found to be missing DDL that the migration set says was applied, so migration
-- history is not evidence of live state and is not used as evidence here.
--
-- POLICIES on public.venues -- exactly SIX, no others:
--
--   INSERT  "Authenticated users can submit venues"      roles={public}
--             WITH CHECK ( auth.uid() = submitted_by
--                          AND moderation_status = 'pending'
--                          AND is_published = false
--                          AND is_verified  = false )
--   SELECT  "Approved venues are public"    USING (is_published AND approved)
--   SELECT  "Owners can view own venues"    USING (uid = submitted_by OR uid = claimed_by)
--   SELECT  "Admins can view all venues"    USING (is_admin())
--   UPDATE  "Owners can update claimed venue"  USING (auth.uid() = claimed_by)
--             WITH CHECK = NULL
--   UPDATE  "Admins can update any venue"      USING (is_admin())
--             WITH CHECK = NULL
--
--   There is NO "Rate limit venue submissions" policy.
--   There is NO second INSERT policy and no overlapping UPDATE policy.
--
-- PRIVILEGES on public.venues:
--   anon, authenticated and service_role each hold table-level INSERT and
--   UPDATE, on EVERY column. None of it was ever granted by a migration --
--   it all comes from Supabase's ALTER DEFAULT PRIVILEGES. Safety today
--   therefore rests entirely on RLS, with no privilege layer underneath it.
--
-- TRIGGERS on public.venues -- exactly two, both from 001:
--   venue_location_trigger  BEFORE INSERT OR UPDATE OF latitude, longitude
--   venues_updated_at       BEFORE UPDATE
--   There is NO trust/moderation protection trigger of any kind.
--
-- HELPERS: neither private.venue_submissions_last_24h() nor
--   public.enforce_venue_submission_invariants() exists. No part of this
--   migration has ever been partially deployed.
--
-- DATA: total_venues = 46908, claimed_venues = 0, self_claimed_venues = 0.
--
-- =============================================================================
-- ROOT CAUSE (revised -- the earlier "two OR'd INSERT policies" account is
--             DISPROVEN and has been removed)
-- =============================================================================
-- An earlier draft of this migration blamed policy composition: that `venues`
-- carried two permissive INSERT policies (001's and 003's) which PostgreSQL
-- OR'd together, and that the weaker one admitted a one-shot self-publish.
-- The live probe disproves that outright. Production has ONE INSERT policy and
-- 003's rate-limit policy is simply ABSENT. The real causes are:
--
-- PP-012 -- THE RATE LIMIT IS MISSING, NOT BYPASSED.
--   003 intended a 10-per-24h cap and its policy is not in the database, even
--   though 003 is recorded as applied. Nothing OR'd it away; it is not there.
--   So the cap has never bound, at any point, for anyone. 003:104-105 claims
--   "no amount of client manipulation can bypass it" -- there is nothing to
--   bypass.
--
-- PP-010 -- THE LIVE INSERT POLICY IS CORRECT ABOUT VISIBILITY AND SILENT
--           ABOUT OWNERSHIP.
--   The live WITH CHECK does pin moderation_status/is_published/is_verified, so
--   a DIRECT one-shot insert of an approved+published+verified venue is
--   REFUSED. That part of the original PP-010 write-up was wrong.
--   What it does NOT constrain is `claimed_by` -- nor is_premium,
--   featured_until, moderated_by/at, moderation_notes, slug, the provenance
--   columns (data_source/license/osm_id), the image columns, the cached
--   aggregates, or discovery_approved. With `authenticated` holding INSERT on
--   every column, all of them are settable by the submitter today.
--
--   `claimed_by` is the dangerous one, because it is not merely a forged field
--   -- it is an ENTRY POINT:
--
--       authenticated user
--         -> INSERT a pending venue with claimed_by = self          (allowed today)
--            -> now satisfies "Owners can update claimed venue"
--               USING (auth.uid() = claimed_by), which has NO WITH CHECK, so
--               PostgreSQL reuses USING as the WITH CHECK
--                  -> UPDATE the row to moderation_status='approved',
--                     is_published=true, is_verified=true, is_premium=true, ...
--                     -> get_nearby_venues (046) then serves it to `anon`
--
--   So PP-010 is not a direct publish bypass. It is a two-stage chain in which
--   the INSERT boundary MANUFACTURES the ownership that the UPDATE boundary
--   (PP-011) then trusts. This migration closes stage one.
--
-- PP-010 and PP-012 are NOT "the same boundary" in the sense the earlier draft
-- claimed. They are two distinct defects that happen to be reachable through
-- the same statement, and they are fixed together because both fixes are
-- INSERT-side and share the same trigger and privilege scaffolding.
--
-- =============================================================================
-- PP-011 IS OUT OF SCOPE, DELIBERATELY
-- =============================================================================
-- "Owners can update claimed venue" is left exactly as it is. After this
-- migration a user can no longer MINT ownership at INSERT, but ownership can
-- still be established legitimately: venue_claims (023) -> an admin calls
-- public.review_venue_claim() (027, SECURITY DEFINER, admin-gated), which sets
-- venues.claimed_by. A venue owner who gets through that admin review still has
-- unrestricted UPDATE over every trust column on their venue. That is PP-011,
-- it remains OPEN, and it needs its own migration with its own regression
-- evidence for the legitimate business-owner edit flow.
--
-- Splitting is safe right now specifically because the live probe returned
-- claimed_venues = 0: there is no existing claimed row left exposed in the gap
-- between this migration and the PP-011 fix.
--
-- =============================================================================
-- COLUMN CLASSIFICATION -- every column of public.venues as it exists LIVE
-- =============================================================================
-- Production is believed to be at 058 + 062 + 064 + 065 + 066 + 067. Migrations
-- 059/060/061 are UNAPPLIED, so `operating_status` and `booking_url` do not
-- exist and are deliberately not referenced anywhere in this file. This
-- migration is independent of 059/060/061 and may be applied before or after
-- them. (029's google_* columns were dropped by 033 and are also absent.)
--
-- A = user-submittable   B = generated/defaulted   C = server/admin/trust-owned
--
--  A  name, description, category_id, address_line1, city, postcode,
--     latitude, longitude, phone, website, min_age, max_age
--  A  submitted_by         -- identity; pinned to auth.uid()
--  A  moderation_status    -- client sends it; VALUE pinned to 'pending'
--  A  is_published         -- client sends it; VALUE pinned to false
--  A* address_line2, country, email, price_range
--       Submittable in principle, but app/venue/add.tsx does not send them, so
--       they are NOT granted. See "IF THE SUBMISSION FORM GROWS" below.
--
--  B  id                   -- default uuid_generate_v4()
--  B  location             -- assigned by venue_location_trigger (001:299)
--  B  created_at, updated_at -- default now(); FORCED by the trigger, see below
--
--  C  is_verified, is_published, moderation_status   -- visibility / moderation
--  C  moderation_notes, moderated_by, moderated_at   -- moderator identity/content
--  C  claimed_by                                     -- ownership (the PP-010 chain)
--  C  is_premium, featured_until                     -- commercial placement
--  C  discovery_approved                             -- discovery eligibility (046)
--  C  slug                                           -- unique; squattable
--  C  review_count, average_rating                   -- rating/review state
--  C  data_source, license, osm_id                   -- provenance & licensing
--  C  image_url, image_source, image_attribution,
--     image_license, image_is_exact, image_updated_at -- provenance & attribution
--
-- Every class C column is now defended at BOTH the policy layer and the trigger
-- layer, not by column privileges alone. The earlier draft protected roughly
-- half of them by privilege omission only -- which reproduced, inside the fix,
-- exactly the single-layer fragility the fix exists to remove.
--
-- FOUR DOCUMENTED EXCEPTIONS, and why:
--
--   id   -- column defaults are applied BEFORE BEFORE-row triggers fire and
--           before WITH CHECK is evaluated, so a defaulted uuid and a forged
--           uuid are indistinguishable to both layers. Neither can assert on
--           it. Protection is the column grant only. Consequence of a forgery
--           is bounded: a chosen-but-random-looking id, or a PK collision that
--           errors. No trust, visibility or ownership effect.
--
--   created_at, updated_at
--        -- same indistinguishability problem, but these DO carry a security
--           consequence: back-dating created_at would move a row outside the
--           24h window and make the PP-012 cap uncountable. A time-window
--           assertion in WITH CHECK would be fragile (clock skew, long
--           transactions). So instead the trigger simply OVERWRITES both with
--           now() on the enforced path. That is airtight, cannot be forged even
--           under a wide-open grant, and is non-breaking because the client
--           never sends them. They are therefore absent from the policy on
--           purpose -- the policy cannot do better than the trigger here.
--
--   location
--        -- not granted, and assigned by venue_location_trigger. Asserting on
--           it in WITH CHECK would mean asserting on a PostGIS geography value
--           derived from user-supplied lat/lng, which is circular. Column grant
--           + the existing trigger are the correct boundary.
--
-- ONE SEMANTIC NOTE (not a security issue): `data_source` defaults to 'manual',
-- so user submissions are recorded as 'manual' rather than the more accurate
-- 'user_submitted'. This migration PINS the current default rather than
-- changing it -- admin queries and export scripts filter on this column, so
-- changing its meaning belongs in its own migration, not in a security hotfix.
--
-- =============================================================================
-- IF THE SUBMISSION FORM GROWS
-- =============================================================================
-- The INSERT grant below lists EXACTLY the 15 columns app/venue/add.tsx sends
-- (verified against the client, not assumed). If the form later starts sending
-- address_line2, country, email or price_range, the insert will fail with
-- "permission denied for column ...". The fix is one line -- add the column to
-- the GRANT INSERT list. The 063 test asserts the exact granted set, so a form
-- change that outgrows this grant fails the suite rather than failing on a
-- user's device.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Private helper schema. Created by 058; re-asserted so this file is safe
--    standalone and so the privilege state is explicit rather than inherited.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- -----------------------------------------------------------------------------
-- 1. Index backing the rate-limit count.
--
--    Without this, every venue INSERT triggers a sequential scan of 46,908 rows
--    to count one user's recent submissions. The index is PARTIAL: the great
--    majority of rows are OSM imports with submitted_by IS NULL, and they can
--    never be counted, so they are excluded and the index stays small.
--
--    Deliberately NOT CONCURRENTLY: CREATE INDEX CONCURRENTLY cannot run inside
--    a transaction block, and keeping this migration atomic is worth more than
--    avoiding a sub-second SHARE lock on a 47k-row table.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS venues_submitted_by_created_at_idx
  ON public.venues (submitted_by, created_at)
  WHERE submitted_by IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. private.current_uid()
--
--    Returns the caller's auth.uid(), resolved as the function OWNER.
--
--    WHY THIS EXISTS. The invariant trigger below must be SECURITY INVOKER (it
--    reads current_user to decide whether to enforce), and it runs with
--    search_path = ''. A SECURITY INVOKER function calling auth.uid() directly
--    needs the CALLING role to hold USAGE on schema `auth`. That privilege
--    could not be proven to hold for `authenticated` in production: the fact
--    that RLS policies call auth.uid() successfully does NOT prove it, because
--    policy expressions may be evaluated with the table owner's privileges. If
--    it does not hold, a direct call would raise "permission denied for schema
--    auth" and break EVERY venue submission.
--
--    Routing through a SECURITY DEFINER function removes the doubt entirely:
--    the auth-schema access is checked against the owner, and the caller needs
--    only EXECUTE on this function. The trigger can therefore enforce identity
--    itself instead of delegating it to the policy -- which closes the residual
--    gap the earlier draft had to accept (a future permissive policy allowing a
--    spoofed submitted_by would have charged the rate cap to the spoofed user).
--
--    Takes no parameters, so there is nothing for a caller to influence.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_uid()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT auth.uid();
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on new functions DIRECTLY
-- to anon/authenticated/service_role, so revoking PUBLIC alone does not remove
-- it. All revokes are required before the intended grant. (Verified against
-- production during the 062 rollout, 2026-08-16.)
REVOKE EXECUTE ON FUNCTION private.current_uid() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.current_uid() FROM anon;
REVOKE EXECUTE ON FUNCTION private.current_uid() FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.current_uid() FROM service_role;
GRANT  EXECUTE ON FUNCTION private.current_uid() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. private.enforce_venue_submission_quota()  -- PP-012, the ONLY count
--
--    THE SINGLE AUTHORITATIVE RATE-LIMIT IMPLEMENTATION. There is deliberately
--    no second count anywhere in this migration.
--
--    Why SECURITY DEFINER: the count must not be filtered by `venues` own
--    SELECT policies. A SECURITY INVOKER count would silently under-report the
--    moment "Owners can view own venues" is narrowed, and the cap would stop
--    binding without anything failing. (The earlier draft had exactly this
--    defect: an RLS-immune counter in the policy, but a raw RLS-subject
--    SELECT count(*) inside the trigger.)
--
--    Why VOLATILE, and why the lock and the count are separate statements:
--    a VOLATILE function takes a FRESH snapshot at the start of each query it
--    executes, whereas a STABLE one reuses the calling query's snapshot. The
--    PERFORM is one statement and the SELECT is the next, so the count's
--    snapshot is taken AFTER the advisory lock has been acquired. Collapsing
--    them into one statement, or marking this function STABLE, would take the
--    snapshot BEFORE the lock and a blocked transaction would then count stale
--    data on wake-up -- the lock would look correct and enforce nothing.
--
--    Keyed on auth.uid() (server-derived), never on a client-supplied column.
--    Takes no parameters: a parameterised SECURITY DEFINER counter would let
--    any user probe another user's submission volume.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_venue_submission_quota()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid;
  v_recent integer;
BEGIN
  v_uid := auth.uid();

  -- No JWT identity => not a user submission path. The trigger's role check has
  -- already excluded trusted contexts; this is belt and braces.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Transaction-scoped, per-user, namespaced two-key advisory lock. Two
  -- concurrent submissions by the SAME user serialise here; different users
  -- never contend. Released automatically on COMMIT or ROLLBACK.
  PERFORM pg_advisory_xact_lock(
            hashtext('pp012:venue_submit'),
            hashtext(v_uid::text));

  -- Separate statement => fresh snapshot => sees rows committed by whichever
  -- transaction just released the lock.
  SELECT count(*)::integer
    INTO v_recent
    FROM public.venues
   WHERE submitted_by = v_uid
     AND created_at > now() - interval '24 hours';

  IF v_recent > 10 THEN
    RAISE EXCEPTION 'venue submission limit reached (10 per 24 hours)'
      USING ERRCODE = '42501', HINT = 'PP-012 invariant';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.enforce_venue_submission_quota() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.enforce_venue_submission_quota() FROM anon;
REVOKE EXECUTE ON FUNCTION private.enforce_venue_submission_quota() FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_venue_submission_quota() FROM service_role;
GRANT  EXECUTE ON FUNCTION private.enforce_venue_submission_quota() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Ownership assertion.
--
--    Both helpers above bypass RLS by design. That is only safe while they are
--    owned by a role that `venues` RLS does not apply to. Rather than issue a
--    blind ALTER FUNCTION ... OWNER TO (which would fail, or silently do the
--    wrong thing, depending on who runs the migration), assert the property and
--    abort the transaction if it does not hold.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_table_owner oid;
BEGIN
  SELECT relowner INTO v_table_owner
    FROM pg_class WHERE oid = 'public.venues'::regclass;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid IN ('private.current_uid()'::regprocedure,
                     'private.enforce_venue_submission_quota()'::regprocedure)
       AND p.proowner <> v_table_owner
  ) THEN
    RAISE EXCEPTION
      'private.* helpers must be owned by the owner of public.venues, '
      'otherwise their SECURITY DEFINER RLS-bypass does not hold';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. The single INSERT policy.
--
--    The live policy is replaced rather than amended. Three changes:
--      * every class C column is now pinned, not just the three visibility ones
--      * TO authenticated -- the live policy has no TO clause (roles={public}),
--        which means it is also evaluated for `anon`. anon can never satisfy
--        auth.uid() = submitted_by, so this is a tightening with no behavioural
--        effect on any real caller, but it makes the intent explicit.
--      * the rate limit is NOT here. See section 6 for why.
--
--    auth.uid() is wrapped in a scalar subquery so it is evaluated once per
--    statement rather than once per row.
--
--    The DROP of 003's policy is retained purely as a no-op safety net: the
--    live probe confirms it does not exist, but dropping it costs nothing and
--    makes this file correct against any database where it does.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can submit venues" ON public.venues;
DROP POLICY IF EXISTS "Rate limit venue submissions"          ON public.venues;

CREATE POLICY "Authenticated users can submit venues" ON public.venues
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- identity: may only submit as yourself
    (SELECT auth.uid()) = submitted_by

    -- moderation & visibility must arrive safe
    AND moderation_status = 'pending'
    AND is_published      = false
    AND is_verified       = false

    -- moderator identity and notes are the moderator's, not the submitter's
    AND moderated_by     IS NULL
    AND moderated_at     IS NULL
    AND moderation_notes IS NULL

    -- ownership must arrive empty -- this is the PP-010 chain entry point
    AND claimed_by IS NULL

    -- commercial placement is server-owned
    AND is_premium     = false
    AND featured_until IS NULL

    -- discovery eligibility. NOT NULL DEFAULT true (044), so `true` IS the
    -- default and forging it is not an escalation today. Pinned anyway so that
    -- if the default is ever tightened to an admin-granted model, a submitter
    -- cannot forge their way back to the permissive value.
    AND discovery_approved = true

    -- unique and squattable
    AND slug IS NULL

    -- cached aggregates are trigger-maintained (001:303)
    AND review_count   = 0
    AND average_rating = 0

    -- provenance & licensing. A forged osm_id would also collide with the
    -- venues_osm_id_unique constraint (016) and could block a real import.
    AND data_source = 'manual'
    AND license IS NULL
    AND osm_id  IS NULL

    -- image provenance & attribution (039)
    AND image_url         IS NULL
    AND image_source      IS NULL
    AND image_attribution IS NULL
    AND image_license     IS NULL
    AND image_is_exact    = false
    AND image_updated_at  IS NULL
  );

-- -----------------------------------------------------------------------------
-- 6. RATE-LIMIT ARCHITECTURE -- why the cap is not in the policy
--
--    PostgreSQL evaluates a single-row INSERT in this order:
--
--      1. column privileges         (before anything executes)
--      2. BEFORE ROW triggers       (may modify NEW)
--      3. RLS WITH CHECK            (on the post-trigger row)
--      4. row is written
--      5. AFTER ROW triggers        (queued; all fire at END of statement)
--
--    Steps 2 and 3 both run BEFORE the row exists. Neither can see rows being
--    inserted by the CURRENT statement, because those rows carry the current
--    command id and are invisible to any snapshot taken during it.
--
--    That is decisive, because PostgREST turns supabase-js `.insert([...])`
--    into ONE multi-row INSERT. A cap evaluated at step 2 or step 3 counts the
--    PRE-STATEMENT total for every row, so a single request carrying 500 venues
--    passes 500 times and writes all 500. A cap in WITH CHECK is therefore not
--    a weaker version of the right check -- it is bypassable by construction,
--    with a one-line client change.
--
--    The cap lives at step 5 instead, where the statement's own rows ARE
--    visible, and asserts the POST-state (> 10) rather than the pre-state
--    (>= 10). AFTER ROW rather than AFTER STATEMENT so that it fires only when
--    rows were actually written, and so a hostile bulk insert is rejected on
--    the first invocation rather than after a full transition-table scan.
--
--    Putting a second, pre-statement count in the policy as "defence in depth"
--    was considered and rejected. It would add a count with knowingly different
--    visibility to the authoritative one -- the precise divergence that made
--    the earlier draft wrong -- in exchange for a check an attacker skips by
--    sending an array. One correct check beats two checks that disagree.
--
--    Concurrency is handled by the advisory lock inside the quota function, not
--    by the layering: a transaction that blocks on the lock re-counts under a
--    fresh snapshot after acquiring it, so it observes the rows committed by
--    the transaction that just released it. Two users at 9 submissions each
--    cannot both be admitted to 11.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 7. Column-level INSERT privileges.
--
--    EXACTLY the 15 columns app/venue/add.tsx sends. Every other column of
--    public.venues becomes un-settable by `authenticated` at the PostgreSQL
--    privilege layer, before RLS is consulted at all.
--
--    REVOKE INSERT ON <table> FROM <role> also drops that role's column-level
--    INSERT grants on the table, so the revoke/grant pair is safe to re-run.
--
--    service_role is untouched on purpose. scripts/import/05_insert.js runs on
--    SUPABASE_SERVICE_KEY and bulk-inserts pre-approved OSM venues with
--    osm_id/data_source/license set. It needs the full-column grant it already
--    holds, and it is exempted from both triggers by role.
--
--    anon is revoked even though it has no INSERT policy to satisfy: this is
--    the "protection by policy absence" fragility that migration 065 removed
--    for `profiles`, and it is removed here for INSERT on `venues`.
--
--    SELECT, UPDATE and DELETE on `venues` are NOT touched by this migration.
--    In particular `authenticated` retains full-column UPDATE -- that is part
--    of PP-011 and belongs to the PP-011 migration.
-- -----------------------------------------------------------------------------
REVOKE INSERT ON public.venues FROM PUBLIC;
REVOKE INSERT ON public.venues FROM anon;
REVOKE INSERT ON public.venues FROM authenticated;

GRANT INSERT (
  name,
  description,
  category_id,
  address_line1,
  city,
  postcode,
  latitude,
  longitude,
  phone,
  website,
  min_age,
  max_age,
  submitted_by,
  moderation_status,
  is_published
) ON public.venues TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. BEFORE INSERT trigger -- the invariants, independent of policy and grant.
--
--    This exists because BOTH other layers are things a future migration can
--    silently widen: a permissive policy is OR'd in, and a table-level GRANT
--    restores every column at once. A trigger cannot be OR'd away and is not
--    affected by grants; it runs on every INSERT regardless.
--
--    It therefore re-asserts EVERY class C invariant the policy asserts, plus
--    identity, rather than the subset the earlier draft covered.
--
--    MUST be SECURITY INVOKER so current_user reflects the real caller:
--      service_role key      -> current_user = 'service_role'  -> exempt
--      SECURITY DEFINER RPC  -> current_user = owner(postgres) -> exempt
--      psql / SQL Editor     -> current_user = 'postgres'      -> exempt
--      ordinary API caller   -> current_user = 'authenticated' -> ENFORCED
--    That role exemption is what keeps the OSM import path working unchanged.
--    It is derived from the effective role, never from client-supplied JWT data.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_venue_submission_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;   -- trusted server / admin / import context
  END IF;

  -- identity -------------------------------------------------------------
  IF NEW.submitted_by IS NULL THEN
    RAISE EXCEPTION 'venues.submitted_by is required for a user submission'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  IF NEW.submitted_by IS DISTINCT FROM private.current_uid() THEN
    RAISE EXCEPTION 'a venue may only be submitted on your own behalf'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- moderation & visibility ----------------------------------------------
  IF NEW.moderation_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'a submitted venue must start as pending moderation'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  IF NEW.is_published IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'a submitted venue cannot be published on creation'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  IF NEW.is_verified IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'a submitted venue cannot be verified on creation'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  IF NEW.moderated_by IS NOT NULL
     OR NEW.moderated_at IS NOT NULL
     OR NEW.moderation_notes IS NOT NULL THEN
    RAISE EXCEPTION 'moderator identity and notes cannot be set by the submitter'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- ownership -- the PP-010 chain entry point ----------------------------
  IF NEW.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION 'venue ownership cannot be claimed on creation'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- commercial placement --------------------------------------------------
  IF NEW.is_premium IS DISTINCT FROM false OR NEW.featured_until IS NOT NULL THEN
    RAISE EXCEPTION 'premium/featured placement is server-owned'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- discovery eligibility -------------------------------------------------
  IF NEW.discovery_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'discovery eligibility is server-owned'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- identifiers and cached aggregates -------------------------------------
  IF NEW.slug IS NOT NULL THEN
    RAISE EXCEPTION 'venues.slug is assigned by the server'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  IF NEW.review_count IS DISTINCT FROM 0
     OR NEW.average_rating IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'review aggregates are maintained by the server'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- provenance & licensing -------------------------------------------------
  IF NEW.data_source IS DISTINCT FROM 'manual'
     OR NEW.license IS NOT NULL
     OR NEW.osm_id  IS NOT NULL THEN
    RAISE EXCEPTION 'venue provenance is server-owned'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- image provenance & attribution -----------------------------------------
  IF NEW.image_url IS NOT NULL
     OR NEW.image_source      IS NOT NULL
     OR NEW.image_attribution IS NOT NULL
     OR NEW.image_license     IS NOT NULL
     OR NEW.image_is_exact IS DISTINCT FROM false
     OR NEW.image_updated_at  IS NOT NULL THEN
    RAISE EXCEPTION 'image provenance and attribution are server-owned'
      USING ERRCODE = '42501', HINT = 'PP-010 invariant';
  END IF;

  -- server timestamps ------------------------------------------------------
  -- FORCED rather than rejected: defaults are applied before this trigger runs,
  -- so a defaulted now() and a forged value are indistinguishable and there is
  -- nothing to reject on. Overwriting is airtight and non-breaking (the client
  -- never sends these), and it is what keeps the PP-012 24h window countable --
  -- a back-dated created_at would otherwise hide a submission from the cap.
  NEW.created_at := now();
  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_invariants() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_invariants() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_invariants() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_invariants() FROM service_role;

DROP TRIGGER IF EXISTS venues_enforce_submission_invariants ON public.venues;

CREATE TRIGGER venues_enforce_submission_invariants
  BEFORE INSERT ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_venue_submission_invariants();

-- -----------------------------------------------------------------------------
-- 9. AFTER INSERT trigger -- PP-012, the authoritative cap. See section 6.
--
--    Same SECURITY INVOKER role exemption as section 8, for the same reason:
--    the OSM import inserts tens of thousands of rows as service_role and must
--    not be counted or capped.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_venue_submission_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NULL;   -- trusted server / admin / import context
  END IF;

  PERFORM private.enforce_venue_submission_quota();

  RETURN NULL;     -- return value is ignored for AFTER ROW triggers
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_rate_limit() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_submission_rate_limit() FROM service_role;

DROP TRIGGER IF EXISTS venues_enforce_submission_rate_limit ON public.venues;

CREATE TRIGGER venues_enforce_submission_rate_limit
  AFTER INSERT ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_venue_submission_rate_limit();

COMMIT;

-- #############################################################################
-- #                                                                           #
-- #   ROLLBACK OPTION A -- PREFERRED. Disables the PP-012 rate limit ONLY.     #
-- #                                                                           #
-- #############################################################################
--
-- USE THIS FIRST. It is the only rollback that is safe to reach for casually.
--
-- If the sole problem is that the 10-per-24h cap is blocking legitimate users,
-- drop the AFTER trigger and nothing else. Every PP-010 protection -- the narrow
-- column grant, the pinned policy, the invariant trigger -- stays in force:
--
--   DROP TRIGGER IF EXISTS venues_enforce_submission_rate_limit ON public.venues;
--
-- That is the whole operation. The quota function is left in place (it is inert
-- once nothing calls it) so the trigger can be recreated with one statement:
--
--   CREATE TRIGGER venues_enforce_submission_rate_limit
--     AFTER INSERT ON public.venues
--     FOR EACH ROW
--     EXECUTE FUNCTION public.enforce_venue_submission_rate_limit();
--
-- If instead a submission fails with "permission denied for column X", the fix
-- is FORWARD, not a rollback: add X to the GRANT INSERT list in section 7.
--
--
-- #############################################################################
-- #                                                                           #
-- #      ROLLBACK OPTION B -- SECURITY-DEGRADING EMERGENCY ROLLBACK ONLY       #
-- #                                                                           #
-- #      DO NOT RUN THIS AS A ROUTINE OPERATIONAL STEP. IT DELIBERATELY        #
-- #      RESTORES A STATE WITH THREE KNOWN, VERIFIED VULNERABILITIES.          #
-- #                                                                           #
-- #############################################################################
--
-- This block is mechanically faithful: it restores the exact live baseline
-- verified on 2026-08-26, nothing more and nothing less. That is precisely the
-- problem -- the baseline it restores is the vulnerable one. Running it REOPENS:
--
--   1. BROAD INSERT PRIVILEGES. anon AND authenticated regain table-level INSERT
--      on EVERY column of public.venues, including claimed_by, is_verified,
--      is_premium, moderated_by, the provenance columns and created_at. The
--      column-privilege layer disappears entirely.
--
--   2. THE MISSING QUOTA. There is no submission rate limit of any kind again.
--      Unlimited venue submissions per user, per day, including 500 in a single
--      request. This is PP-012, restored in full.
--
--   3. THE claimed_by = self CHAIN. A user can once more mint ownership of a
--      venue at INSERT, which satisfies "Owners can update claimed venue"
--      (USING with no WITH CHECK), from which they can set the row to
--      approved + published + verified + premium and reach the public map as
--      unmoderated, "verified"-badged content on a children's venue app.
--      This is PP-010, restored in full.
--
-- Only run Option B if 063 is causing a worse production incident than those
-- three vulnerabilities, and treat the window it opens as an active incident
-- with a deadline, not a resting state. Prefer Option A in every other case.
--
--   BEGIN;
--   DROP TRIGGER  IF EXISTS venues_enforce_submission_rate_limit ON public.venues;
--   DROP TRIGGER  IF EXISTS venues_enforce_submission_invariants ON public.venues;
--   DROP FUNCTION IF EXISTS public.enforce_venue_submission_rate_limit();
--   DROP FUNCTION IF EXISTS public.enforce_venue_submission_invariants();
--   DROP FUNCTION IF EXISTS private.enforce_venue_submission_quota();
--   DROP FUNCTION IF EXISTS private.current_uid();
--   DROP INDEX    IF EXISTS public.venues_submitted_by_created_at_idx;
--   GRANT INSERT ON public.venues TO authenticated;   -- REOPENS every column
--   GRANT INSERT ON public.venues TO anon;            -- REOPENS every column
--   DROP POLICY IF EXISTS "Authenticated users can submit venues" ON public.venues;
--   CREATE POLICY "Authenticated users can submit venues" ON public.venues
--     FOR INSERT WITH CHECK (            -- no TO clause: roles={public}, as live
--       auth.uid() = submitted_by
--       AND moderation_status = 'pending'
--       AND is_published = false
--       AND is_verified  = false
--     );
--   COMMIT;
--
--   It does NOT recreate a "Rate limit venue submissions" policy: production has
--   never had one, and a rollback must restore what was there, nothing more.
--   It DOES restore anon's INSERT grant, because the live baseline has it -- and
--   that restoration is itself one of the three vulnerabilities listed above.
-- =============================================================================
