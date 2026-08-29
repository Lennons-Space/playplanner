-- =============================================================================
-- 20260829205506_venue_owner_update_boundary.sql
--
-- PP-011 -- the claimed-venue owner UPDATE trust boundary.
--
-- Closes the second half of the escalation chain that migration 063 left open
-- on purpose. 063 closed PP-010 at INSERT: ownership can no longer be minted,
-- so an attacker cannot make themselves `claimed_by` on their own submission.
-- This migration closes what happens AFTER ownership is established legitimately
-- through the admin-approved claim flow.
--
-- DEPENDS ON: 063 (private.current_uid, schema private + its USAGE grant) and
--             001/025 (public.update_venue_rating, hardened in section 1 below).
--
-- =============================================================================
-- THE PROBLEM, CONFIRMED AGAINST LIVE PRODUCTION 2026-08-29
-- =============================================================================
--
-- Live catalog state before this migration (read-only audit, 46,908 venues):
--
--   policy "Owners can update claimed venue"
--     roles      = {public}
--     USING      = (auth.uid() = claimed_by)
--     WITH CHECK = NULL          <-- so Postgres reuses USING as the check
--
--   policy "Admins can update any venue"
--     roles      = {public}
--     USING      = is_admin()
--     WITH CHECK = NULL
--
--   grants:  anon / authenticated / service_role each hold table UPDATE, and
--            effective per-column UPDATE = 43 of 43 columns for all three.
--
--   relrowsecurity = true, relforcerowsecurity = FALSE.
--
--   UPDATE-side triggers:  venue_location_trigger, venues_updated_at.
--                          Neither enforces anything. 063's two triggers are
--                          BEFORE INSERT and AFTER INSERT only.
--
-- With no WITH CHECK, no UPDATE-side invariant trigger, and a full-column grant,
-- a legitimately claimed owner could change ANY column on their own venue row:
-- self-verify (is_verified), self-publish (is_published / moderation_status),
-- forge the moderation audit trail (moderated_by / moderated_at /
-- moderation_notes), grant themselves paid placement (is_premium /
-- featured_until), inflate reputation (review_count / average_rating), rewrite
-- provenance (data_source / license / osm_id -- which is UNIQUE, so it also
-- enables a collision against the OSM import), blank the CC image attribution
-- the licence obliges us to display, or flip discovery_approved.
--
-- This was not inferred. supabase/tests/063_venue_submission_trust_bypass.mjs
-- carried a PASSING test asserting the exploit worked. That test is inverted by
-- this change.
--
-- NOT an escalation route, contrary to an earlier draft of the analysis:
-- changing `claimed_by` was ALREADY refused before this migration. With no
-- WITH CHECK, Postgres re-uses USING as the check and evaluates it against the
-- NEW row, so auth.uid() = NEW.claimed_by fails on any transfer. This migration
-- makes that guarantee explicit rather than incidental, and enforces it twice.
--
-- Exposure at time of writing: claims total = 0, claimed = 0. There is no
-- incident. This is preventive hardening, and the window closes the moment the
-- first claim is approved -- which is exactly why it lands now.
--
-- =============================================================================
-- WHY A TRIGGER IS THE PRIMARY LAYER, NOT A POLICY
-- =============================================================================
--
-- An RLS WITH CHECK expression can only see the NEW row. It cannot reference
-- OLD. So a policy can express "the new value must satisfy X" but it can NEVER
-- express "this column must not change". A hardened WITH CHECK can pin
-- claimed_by; it fundamentally cannot stop is_verified going false -> true.
--
-- Column-level UPDATE grants could express it, but they are role-level, and the
-- admin moderation UI (app/admin/moderation.tsx) writes moderation_status,
-- is_published, moderated_by, moderated_at and moderation_notes as the SAME
-- `authenticated` role an owner uses. A grant cannot tell an admin from an
-- owner. Narrowing the grant is therefore deferred to Stage 2, after admin
-- moderation moves behind a SECURITY DEFINER RPC.
--
-- Only a trigger sees OLD and NEW and can distinguish caller identity per row.
-- It is also the layer a future mistake cannot silently undo: a permissive
-- policy is OR'd in, and a table-level GRANT restores every column at once, but
-- a trigger cannot be OR'd away and is unaffected by grants. Same reasoning 063
-- used for its BEFORE INSERT trigger.
--
-- =============================================================================
-- ALLOWLIST, NOT BLACKLIST -- AND WHY IT FAILS CLOSED
-- =============================================================================
--
-- The check compares the WHOLE ROW with the authorised keys removed:
--
--     to_jsonb(OLD) - c_owner_editable   vs   to_jsonb(NEW) - c_owner_editable
--
-- Any difference at all is a forbidden change. A column added to `venues` in
-- future is, by construction, NOT in the allowlist, so it appears on both sides
-- of the comparison and any owner attempt to change it is rejected until
-- somebody deliberately adds it to c_owner_editable. The boundary fails CLOSED
-- as the schema grows. There is no enumeration of today's forbidden columns
-- anywhere in this file.
--
-- to_jsonb() over a composite renders every attribute through that type's
-- output function, so it cannot silently skip a datatype it does not understand.
-- Verified on PostgreSQL 18.4 against a row containing point (the closest stock
-- analogue to geography(Point,4326) -- both are non-JSON-native types rendered
-- via their output function), bytea, numeric, timestamptz, uuid, inet, boolean
-- and a NULL: 9 JSON keys for 9 columns, a point/bytea/timestamptz change was
-- detected, NULL compared equal to itself, and numeric 4.50 vs 4.5 correctly did
-- NOT register as a change.
--
-- =============================================================================
-- CALLER CLASSIFICATION
-- =============================================================================
--
-- SECURITY INVOKER is mandatory so current_user is the REAL caller, exactly as
-- 063 does. It is derived from the effective role, never from client JWT data.
--
--   current_user = 'anon'           -> rejected outright (belt and braces; the
--                                      grant is revoked below too)
--   current_user <> 'authenticated' -> pass through. This is service_role, the
--                                      postgres/SQL-editor session, and any
--                                      SECURITY DEFINER function owned by
--                                      postgres (apply_venue_proposal,
--                                      auto_apply_venue_proposal,
--                                      rollback_enrichment_run,
--                                      review_venue_claim, and -- after
--                                      section 1 below -- update_venue_rating).
--                                      Keeps the OSM import and the enrichment
--                                      pipeline working unchanged.
--   admin (is_admin())              -> pass through; moderation is unchanged.
--   claimed owner                   -> may change ONLY the allowlist.
--   anyone else                     -> rejected.
--
-- THERE IS NO TRIGGER-DEPTH EXEMPTION, DELIBERATELY. An earlier draft passed
-- any write nested inside another trigger (pg_trigger_depth() > 1). That was
-- withdrawn: it is a context-wide bypass, not a capability check, and it would
-- have let ANY future trigger that writes `venues` skip the allowlist -- the
-- opposite of failing closed. It was also justified by a false claim that
-- creating a trigger on `venues` requires table ownership. It does not:
-- CREATE TRIGGER requires the TRIGGER privilege on the table plus EXECUTE on
-- the trigger function, and the live audit shows BOTH anon and authenticated
-- currently hold TRIGGER on public.venues. Proven on PostgreSQL 18.4: a role
-- holding only TRIGGER (not ownership) successfully created a trigger on a
-- table it did not own, using a postgres-owned function it could EXECUTE.
--
-- The one legitimate nested writer is made trusted EXPLICITLY instead, by
-- capability, in section 1.
--
-- Caller identity comes from private.current_uid(), the SECURITY DEFINER helper
-- migration 063 created for precisely this situation. A SECURITY INVOKER
-- function calling auth.uid() DIRECTLY needs the CALLING role to hold USAGE on
-- schema auth, and that privilege could not be proven to hold for
-- `authenticated` in production. RLS policies calling auth.uid() successfully
-- does NOT prove it: confirmed empirically during this work that a policy qual
-- resolves auth.uid() fine while a SECURITY INVOKER function running as
-- `authenticated` raises "permission denied for schema auth" in the same
-- database.
--
-- is_admin() is called at most once per row, and only when the fast owner path
-- does not already accept the row. The existing "Admins can update any venue"
-- policy already evaluates is_admin() per row, so this adds no new order of
-- magnitude to bulk moderation.
--
-- =============================================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- =============================================================================
--
--   * Does NOT narrow authenticated's column-level UPDATE grant (Stage 2).
--   * Does NOT move admin moderation to an RPC (Stage 2).
--   * Does NOT revoke the TRIGGER / TRUNCATE / REFERENCES / MAINTAIN privileges
--     anon and authenticated hold on public.venues. Those are gratuitous and
--     should go, but they are a distinct privilege-hardening concern and belong
--     in their own migration. NOTE for whoever writes it: RLS does NOT apply to
--     TRUNCATE -- proven on PG 18.4, where a role that could see one row of two
--     under RLS, and a role that could see none, each truncated the whole table.
--   * Does NOT make claimed venues uneditable -- owners keep a real, if narrow,
--     editing surface, and future time-limited offers belong in venue_offers
--     (which already exists with an owner-manage policy keyed on claimed_by),
--     never by widening venue UPDATE.
--   * Does NOT allow owner edits to name / category_id / address / city /
--     postcode / country / latitude / longitude. Those change listing identity
--     or location and are intended to go through a reviewed change-request flow
--     later.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Harden public.update_venue_rating() so the ONE legitimate nested writer is
--    trusted by CAPABILITY rather than by context.
--
--    THE PROBLEM. update_venue_rating() is the AFTER INSERT/UPDATE/DELETE
--    trigger on `reviews` that maintains venues.review_count and
--    venues.average_rating. As defined in 001 and re-locked in 025 it is
--    SECURITY INVOKER, so its UPDATE on `venues` executes as the REVIEWING
--    USER -- an ordinary `authenticated` caller who is usually neither the
--    claimed owner nor an admin, writing two columns that are (correctly) NOT
--    in the owner allowlist. Without this section the boundary in section 2
--    would refuse it and break review posting.
--
--    THE FIX. Make the function itself run in a trusted context. It becomes
--    SECURITY DEFINER, owned by the migration runner (postgres), so
--    current_user inside it is 'postgres' and section 2 exempts it through the
--    ordinary trusted-role branch. No context-wide bypass is required.
--
--    SIDE EFFECT, DELIBERATE AND WORTH KNOWING: as SECURITY INVOKER this
--    function's UPDATE was silently filtered by RLS whenever the reviewing user
--    could not satisfy a venues UPDATE policy, so the aggregate simply did not
--    change -- e.g. a user deleting their own approved review never decremented
--    review_count. As SECURITY DEFINER the maintenance now always applies. That
--    is the behaviour 001 plainly intended.
--
--    SAFETY. It takes no parameters, so there is nothing for a caller to
--    influence. search_path is pinned to '' and every reference is schema
--    qualified, so it cannot be redirected. Its body is unchanged apart from
--    that qualification.
--
--    EXECUTE is revoked from every API role. Proven on PostgreSQL 18.4 that
--    revoking EXECUTE AFTER a trigger already exists does NOT stop that trigger
--    firing -- review_rating_trigger continues to work. The revoke does two
--    useful things: it stops a direct call, and -- because CREATE TRIGGER
--    requires EXECUTE on the function -- it stops a role holding the TRIGGER
--    privilege on some table from attaching this postgres-owned SECURITY
--    DEFINER function to a trigger of its own.
--
--    CREATE OR REPLACE preserves the function OID, so the existing
--    review_rating_trigger stays bound to it. The trigger is NOT recreated.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_venue_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

REVOKE EXECUTE ON FUNCTION public.update_venue_rating() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_venue_rating() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_venue_rating() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_venue_rating() FROM service_role;

-- -----------------------------------------------------------------------------
-- 2. The invariant function.
--
--    c_owner_editable IS THE SECURITY BOUNDARY. Adding a column to it is a
--    deliberate decision to let a claimed business owner write that column
--    directly, with no review. Do not add a trust, moderation, ownership,
--    commercial, reputation, provenance or system column to it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_venue_owner_update_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  c_owner_editable CONSTANT text[] := ARRAY[
    -- Business content a claimed owner may correct about their own venue.
    'description',
    'phone',
    'email',
    'website',
    'price_range',
    'min_age',
    'max_age',
    -- System-managed side effect of any permitted write, never owner intent.
    'updated_at'
  ];
  v_old_rest jsonb;
  v_new_rest jsonb;
  v_changed  text[];
  v_uid      uuid;
BEGIN
  -- 2a. anon never updates a venue. The grant is revoked in section 5 as well;
  --     this is the layer that survives someone re-granting it.
  IF current_user = 'anon' THEN
    RAISE EXCEPTION 'venues: anonymous callers may not update venues'
      USING ERRCODE = '42501';
  END IF;

  -- 2b. Trusted, non-API roles pass straight through: service_role, postgres,
  --     and any SECURITY DEFINER function owned by postgres -- which, after
  --     section 1, includes the review-rating maintenance path.
  --
  --     There is deliberately NO trigger-depth exemption here. A nested write
  --     that is still running as `authenticated` gets no special treatment.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- 2c. THE ALLOWLIST COMPARISON. Everything outside c_owner_editable must be
  --     byte-for-byte unchanged. Future columns are outside it by construction.
  v_old_rest := to_jsonb(OLD) - c_owner_editable;
  v_new_rest := to_jsonb(NEW) - c_owner_editable;

  IF v_old_rest IS NOT DISTINCT FROM v_new_rest THEN
    -- Only allowlisted columns changed. Still require owner or admin identity:
    -- the trigger must hold even if the RLS layer is later widened.
    v_uid := private.current_uid();
    IF v_uid IS NOT NULL AND v_uid = OLD.claimed_by THEN
      RETURN NEW;
    END IF;
    IF public.is_admin() THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'venues: only the claimed owner or an admin may update this venue'
      USING ERRCODE = '42501';
  END IF;

  -- 2d. Something outside the allowlist changed. Admins may do that; nobody
  --     else may, including the legitimate claimed owner.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(e.key ORDER BY e.key)
    INTO v_changed
    FROM jsonb_each(v_old_rest) AS e
   WHERE e.value IS DISTINCT FROM (v_new_rest -> e.key);

  RAISE EXCEPTION
    'venues: a claimed owner may not change %; owner-editable columns are %',
    array_to_string(v_changed, ', '),
    array_to_string(c_owner_editable, ', ')
    USING ERRCODE = '42501';
END;
$$;

-- No API role should ever call the function directly, and no role holding the
-- TRIGGER privilege should be able to attach it elsewhere.
REVOKE EXECUTE ON FUNCTION public.enforce_venue_owner_update_boundary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_owner_update_boundary() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_owner_update_boundary() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_venue_owner_update_boundary() FROM service_role;

-- -----------------------------------------------------------------------------
-- 3. The trigger. BEFORE UPDATE FOR EACH ROW, so a multi-row statement is
--    checked row by row and the first violation aborts the whole statement --
--    no partial privileged write is possible.
--
--    Name note: triggers fire in alphabetical order, so this runs after
--    venue_location_trigger (which derives `location` from lat/lng, meaning an
--    attempted relocation is already visible as a changed `location` here) and
--    before venues_updated_at. The result is order-independent either way,
--    because updated_at is allowlisted.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS venues_enforce_owner_update_boundary ON public.venues;

CREATE TRIGGER venues_enforce_owner_update_boundary
  BEFORE UPDATE ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_venue_owner_update_boundary();

-- -----------------------------------------------------------------------------
-- 4. Harden both UPDATE policies: explicit WITH CHECK on the owner policy, and
--    an explicit role scope on both.
--
--    WITH CHECK makes the claimed_by guarantee explicit instead of relying on
--    Postgres re-using USING as the check.
--
--    TO authenticated on BOTH policies removes the reliance on anon simply
--    never satisfying the qual. This is behaviour-preserving, and that is a
--    conclusion from the live audit rather than an assumption:
--      * relforcerowsecurity = FALSE (live-confirmed), so the table owner
--        (postgres) and every SECURITY DEFINER function owned by it are not
--        subject to RLS at all and never consult these policies;
--      * service_role holds BYPASSRLS, so it never consults them either;
--      * for anon, auth.uid() is NULL and is_admin() is therefore false, so
--        neither policy could ever grant anon anything;
--      * authenticated -- the only role for which these policies decide
--        anything -- is unaffected.
--
--    (SELECT auth.uid()) is the init-plan form used elsewhere in this repo
--    (20260801213434_facility_votes_select_own, 062): semantically identical,
--    evaluated once per statement rather than once per row.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can update claimed venue" ON public.venues;

CREATE POLICY "Owners can update claimed venue" ON public.venues
  FOR UPDATE
  TO authenticated
  USING      ((SELECT auth.uid()) = claimed_by)
  WITH CHECK ((SELECT auth.uid()) = claimed_by);

DROP POLICY IF EXISTS "Admins can update any venue" ON public.venues;

CREATE POLICY "Admins can update any venue" ON public.venues
  FOR UPDATE
  TO authenticated
  USING (is_admin());

-- -----------------------------------------------------------------------------
-- 5. Remove anon's UPDATE privilege.
--
--    anon was blocked only because auth.uid() is NULL for it, so no UPDATE
--    policy could ever match -- protection by policy absence, the same
--    fragility 065 removed for profiles and 063 removed for INSERT on venues.
--    authenticated keeps its table UPDATE because admin moderation needs it;
--    narrowing that is Stage 2. service_role is untouched.
-- -----------------------------------------------------------------------------
REVOKE UPDATE ON public.venues FROM PUBLIC;
REVOKE UPDATE ON public.venues FROM anon;

COMMIT;

-- #############################################################################
-- #                                                                           #
-- #   ROLLBACK -- SECURITY-DEGRADING. DO NOT RUN IN PRODUCTION.               #
-- #                                                                           #
-- #   Running this REOPENS PP-011: it restores the state in which any          #
-- #   legitimately claimed venue owner can self-verify, self-publish,          #
-- #   self-approve moderation, forge the moderation audit trail, grant         #
-- #   themselves premium/featured placement, inflate review_count and          #
-- #   average_rating, rewrite data provenance, and strip image attribution     #
-- #   required by the image licence -- on their own venue row, through the     #
-- #   ordinary PostgREST API, with no admin involvement.                       #
-- #                                                                           #
-- #   It also re-grants UPDATE on public.venues to anon, returns both UPDATE   #
-- #   policies to roles={public}, and returns update_venue_rating() to         #
-- #   SECURITY INVOKER (restoring migration 025's definition exactly).         #
-- #                                                                           #
-- #   Only run it to recover from a proven regression, and re-apply the        #
-- #   migration as soon as the regression is fixed.                            #
-- #                                                                           #
-- #############################################################################
--
--   BEGIN;
--
--   DROP TRIGGER IF EXISTS venues_enforce_owner_update_boundary ON public.venues;
--   DROP FUNCTION IF EXISTS public.enforce_venue_owner_update_boundary();
--
--   DROP POLICY IF EXISTS "Owners can update claimed venue" ON public.venues;
--   CREATE POLICY "Owners can update claimed venue" ON public.venues
--     FOR UPDATE USING (auth.uid() = claimed_by);
--
--   DROP POLICY IF EXISTS "Admins can update any venue" ON public.venues;
--   CREATE POLICY "Admins can update any venue" ON public.venues
--     FOR UPDATE USING (is_admin());
--
--   CREATE OR REPLACE FUNCTION public.update_venue_rating()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SET search_path = extensions, public
--   AS $rollback$
--   BEGIN
--     UPDATE public.venues
--     SET
--       review_count   = (
--         SELECT COUNT(*) FROM public.reviews
--         WHERE venue_id = COALESCE(NEW.venue_id, OLD.venue_id)
--           AND moderation_status = 'approved'
--       ),
--       average_rating = (
--         SELECT COALESCE(AVG(rating), 0) FROM public.reviews
--         WHERE venue_id = COALESCE(NEW.venue_id, OLD.venue_id)
--           AND moderation_status = 'approved'
--       ),
--       updated_at     = now()
--     WHERE id = COALESCE(NEW.venue_id, OLD.venue_id);
--     RETURN COALESCE(NEW, OLD);
--   END;
--   $rollback$;
--
--   GRANT UPDATE ON public.venues TO anon;
--
--   COMMIT;
--
-- =============================================================================
