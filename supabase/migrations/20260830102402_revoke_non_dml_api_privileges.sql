-- =============================================================================
-- 20260830102402_revoke_non_dml_api_privileges.sql
--
-- Removes the four table privileges RLS does NOT govern -- TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN -- from the two API roles, on existing public tables AND
-- on future ones, and closes the direct-EXECUTE surface on internal trigger
-- helper functions.
--
-- DEPENDS ON: nothing structural. Safe to apply after 20260829205506 (PP-011).
--
-- =============================================================================
-- WHY -- CONFIRMED AGAINST LIVE PRODUCTION (PostgreSQL 17.6)
-- =============================================================================
--
-- RLS governs row visibility for SELECT/INSERT/UPDATE/DELETE. It does NOT govern
-- TRUNCATE, and it has nothing to say about REFERENCES, TRIGGER or MAINTAIN.
-- Proven on PostgreSQL 18.4: a role that could see ONE row of two under RLS, and
-- a role that could see NONE at all, each truncated the entire table.
--
-- Live audit, 30 tables/views in scope:
--
--            TRUNCATE  REFERENCES  TRIGGER  MAINTAIN
--   anon        28/30      28/30     28/30    28/30
--   auth        29/30      29/30     29/30    29/30
--   service     30/30      30/30     30/30    30/30
--
-- (anon is short two because 065 revoked ALL on `profiles` and 066 revoked ALL on
-- the `public_profiles` view; authenticated is short one for the same view.)
--
-- These were never granted deliberately. They arrive from Supabase's
-- ALTER DEFAULT PRIVILEGES, which grants the full table privilege set on every
-- new object. Only six objects in this project have ever had their table
-- privileges touched by a migration.
--
-- REACHABILITY -- stated honestly, because it sets the priority:
--
--   anon / authenticated JWT via PostgREST ....... cannot TRUNCATE, cannot DDL
--   service_role JWT via PostgREST ............... cannot TRUNCATE, cannot DDL
--   direct PostgreSQL session .................... yes
--   SQL Editor / dashboard ....................... yes
--   an RPC that offers an arbitrary-SQL path ..... none exist (no dynamic SQL
--                                                  anywhere in this schema)
--
-- PostgREST only ever emits SELECT/INSERT/UPDATE/DELETE and calls to fixed-body
-- functions. So this is LATENT STANDING PRIVILEGE, not an active exploit path,
-- and this migration is preventive. It is still worth removing: a single
-- TRUNCATE on `venues` would destroy 46,908 rows plus every ON DELETE CASCADE
-- dependant, with RLS offering no protection whatsoever.
--
-- A positive live finding that bounds the TRIGGER risk: anon and authenticated
-- hold USAGE but NOT CREATE on schema public, so neither can define its own
-- trigger function. TRIGGER alone still lets a role attach an EXISTING
-- EXECUTE-able function to a table it does not own -- proven on 18.4 -- which is
-- why section 3 also closes the trigger-helper EXECUTE surface.
--
-- =============================================================================
-- AN EXISTING-OBJECT SWEEP ALONE IS NOT ENOUGH
-- =============================================================================
--
-- Live pg_default_acl shows a future public table created by `postgres` still
-- granting anon and authenticated all of
-- DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.
-- Without section 2, the next CREATE TABLE would undo section 1.
--
-- SCOPE TRAP, verified empirically on 18.4: global (`FOR ROLE r`) and
-- schema-scoped (`FOR ROLE r IN SCHEMA s`) defaults COMBINE -- the schema entry
-- is ADDITIVE on top of the global one. A schema-scoped REVOKE therefore cannot
-- cancel a GLOBAL grant. Supabase's standard setup is schema-scoped
-- (`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ...`), and
-- this migration matches that scope so it stays inside `public` as instructed.
-- Section 2b RAISEs a WARNING at apply time if a global grant is nevertheless
-- present, rather than leaving the gap silent.
--
-- =============================================================================
-- DELIBERATELY OUT OF SCOPE
-- =============================================================================
--
--   * SELECT/INSERT/UPDATE/DELETE grants are NOT touched anywhere. Column-level
--     grants on `profiles` (062/065) and `venues` (063) are NOT touched -- this
--     migration never issues a blanket REVOKE ALL, precisely so they survive.
--   * service_role keeps all four privileges. It runs the edge functions, the
--     OSM import and the enrichment scripts.
--   * SEQUENCE and FUNCTION default privileges are NOT changed. Future
--     postgres-created functions in `public` still inherit EXECUTE for
--     PUBLIC/anon/authenticated -- a real residual issue, but deny-by-default
--     function creation is an API-contract change that needs its own migration
--     and its own test strategy. Recorded, not silently bundled.
--   * `supabase_admin`'s equivalent public-schema default ACLs are NOT changed.
--     It is a Supabase-managed role and altering its defaults may have platform
--     side-effects. Every application table in `public` is owned by `postgres`,
--     so PlayPlanner objects are covered by section 2. RESIDUAL RISK: a table
--     created in `public` by supabase_admin would still inherit the four
--     privileges for anon/authenticated.
--   * Broad DML on tables the app never touches (otp_attempts,
--     business_subscriptions, venue_analytics, venue_review_scores, and the
--     half-built review/offer features) is left alone. RLS contains those paths
--     today; narrowing them is a separate least-privilege task.
--   * Schemas auth, storage, graphql, graphql_public, realtime and extensions
--     are not touched in any way.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Existing tables in `public`: remove the four non-RLS-governed privileges
--    from the two API roles.
--
--    ON ALL TABLES IN SCHEMA is one statement rather than a loop, so there is no
--    dynamic identifier interpolation anywhere. It covers base tables,
--    partitioned tables and views; on a view the three are inert, which is
--    harmless.
--
--    MAINTAIN did not exist before PostgreSQL 17, so it is applied through a
--    version guard to keep this migration replayable on an older server. The
--    EXECUTE argument is a constant string -- nothing is interpolated.
-- -----------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Future tables created by `postgres` in `public` must not re-acquire them.
--
--    DML defaults are deliberately left exactly as they are: a new table still
--    grants SELECT/INSERT/UPDATE/DELETE to the roles it grants them to today.
--    Only the four non-DML privileges are removed.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
         || 'REVOKE MAINTAIN ON TABLES FROM anon, authenticated';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2b. Surface the scope trap instead of hiding it.
--
--     A GLOBAL default-privilege grant cannot be cancelled by the schema-scoped
--     revoke above, and revoking globally would reach schemas this migration is
--     not allowed to touch. If such a grant exists, say so loudly at apply time.
--
--     Also report any OTHER creator role (notably supabase_admin) whose
--     public-schema defaults still hand these privileges out, so the residual
--     risk is visible in the apply log rather than only in this comment.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_global   text;
  v_others   text;
BEGIN
  SELECT string_agg(DISTINCT g.grantee::regrole::text, ', ')
    INTO v_global
    FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) g
   WHERE d.defaclobjtype = 'r'
     AND d.defaclnamespace = 0
     AND d.defaclrole = 'postgres'::regrole
     AND g.grantee IN ('anon'::regrole, 'authenticated'::regrole)
     AND g.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');

  IF v_global IS NOT NULL THEN
    RAISE WARNING
      'PP-privilege-hardening: a GLOBAL default-privilege grant for role postgres still gives % one or more of TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on new tables. The schema-scoped revoke in section 2 CANNOT cancel it. A separate decision is needed.',
      v_global;
  END IF;

  SELECT string_agg(DISTINCT d.defaclrole::regrole::text, ', ')
    INTO v_others
    FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) g
   WHERE d.defaclobjtype = 'r'
     AND d.defaclnamespace = 'public'::regnamespace::oid
     AND d.defaclrole <> 'postgres'::regrole
     AND g.grantee IN ('anon'::regrole, 'authenticated'::regrole)
     AND g.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');

  IF v_others IS NOT NULL THEN
    RAISE NOTICE
      'PP-privilege-hardening: creator role(s) % still grant non-DML privileges on new public tables. Left unchanged deliberately (Supabase-managed). Residual risk recorded in this migration header.',
      v_others;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Internal trigger helper functions: remove the direct EXECUTE surface.
--
--    Every function listed here RETURNS trigger. A trigger-returning function
--    can never be a PostgREST RPC -- PostgREST excludes it, and calling one
--    directly raises "trigger functions can only be called as triggers". So no
--    API contract is affected.
--
--    Revoking EXECUTE does NOT stop an existing trigger firing: EXECUTE is
--    checked at CREATE TRIGGER time, not at fire time. Established during PP-011
--    and re-proven for these specific functions in the accompanying suite.
--
--    The revoke does two useful things: it removes a pointless callable surface,
--    and -- because CREATE TRIGGER requires EXECUTE on the function -- it stops a
--    role that somehow regains the TRIGGER privilege from attaching one of these
--    to a table of its own.
--
--    An explicit list rather than a sweep over every trigger-returning function,
--    so the documented rollback can restore the exact prior state. Functions
--    already locked down by 046/050/062/063/PP-011 are not repeated here.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_venue_location()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_push_token_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

-- 050 revoked these two FROM PUBLIC only. Supabase's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE to anon/authenticated/service_role by NAME, and revoking from
-- PUBLIC does not remove a named-role grant -- which is why the live audit still
-- shows them callable. Revoke the named roles explicitly.
REVOKE EXECUTE ON FUNCTION public.mirror_facility_stats_to_venue_facilities()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.recompute_facility_stats()
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. public.user_review_count_today() -- the one non-trigger function with
--    PUBLIC EXECUTE.
--
--    It is SECURITY DEFINER and is called from the `reviews` INSERT policy
--    ("Users can write reviews", migration 054) to cap a user at 10 reviews per
--    24 hours. It takes no arguments and is scoped to the caller's own
--    auth.uid(), so it can only ever return the caller's own count -- the
--    exposure is minor. It is hardened anyway because PUBLIC EXECUTE on a
--    SECURITY DEFINER function should never be accidental.
--
--    Behaviour is unchanged: same signature, same return type, same body
--    semantics. search_path moves from `public` to '' and both referenced
--    objects are already schema-qualified, so pinning is a no-op for the result
--    and removes the last resolution ambiguity.
--
--    authenticated keeps an explicit grant: it is the only role that can satisfy
--    the reviews INSERT policy, and keeping the grant means the policy path is
--    safe regardless of how the qual is evaluated.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_review_count_today()
  RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.reviews
  WHERE user_id = auth.uid()
    AND created_at > now() - interval '24 hours';
$$;

REVOKE EXECUTE ON FUNCTION public.user_review_count_today() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_review_count_today() FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_review_count_today() FROM service_role;
GRANT  EXECUTE ON FUNCTION public.user_review_count_today() TO authenticated;

COMMIT;

-- #############################################################################
-- #                                                                           #
-- #   ROLLBACK -- SECURITY-DEGRADING. DO NOT RUN IN PRODUCTION.               #
-- #                                                                           #
-- #   Running this hands anon and authenticated back TRUNCATE, REFERENCES,     #
-- #   TRIGGER and MAINTAIN on every table in `public`, and makes future        #
-- #   postgres-created public tables grant them again automatically.           #
-- #                                                                           #
-- #   TRUNCATE is the one that matters: RLS does not govern it, so a single    #
-- #   statement would destroy every row of a table plus every ON DELETE        #
-- #   CASCADE dependant, regardless of row policies. It also re-opens direct   #
-- #   EXECUTE on the internal trigger helpers and restores PUBLIC EXECUTE on   #
-- #   user_review_count_today().                                              #
-- #                                                                           #
-- #   Only run it to recover from a proven regression, and re-apply the        #
-- #   migration as soon as the regression is fixed.                            #
-- #                                                                           #
-- #############################################################################
--
--   BEGIN;
--
--   GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
--     TO anon, authenticated;
--
--   DO $rollback$
--   BEGIN
--     IF current_setting('server_version_num')::int >= 170000 THEN
--       EXECUTE 'GRANT MAINTAIN ON ALL TABLES IN SCHEMA public TO anon, authenticated';
--     END IF;
--   END;
--   $rollback$;
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
--
--   DO $rollback$
--   BEGIN
--     IF current_setting('server_version_num')::int >= 170000 THEN
--       EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
--            || 'GRANT MAINTAIN ON TABLES TO anon, authenticated';
--     END IF;
--   END;
--   $rollback$;
--
--   GRANT EXECUTE ON FUNCTION public.set_venue_location()            TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.touch_updated_at()              TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_push_token_updated_at()  TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.mirror_facility_stats_to_venue_facilities()
--     TO anon, authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.recompute_facility_stats()
--     TO anon, authenticated, service_role;
--
--   CREATE OR REPLACE FUNCTION public.user_review_count_today()
--     RETURNS bigint
--     LANGUAGE sql
--     SECURITY DEFINER
--     STABLE
--     SET search_path = public
--   AS $rollback$
--     SELECT count(*)
--     FROM public.reviews
--     WHERE user_id = auth.uid()
--       AND created_at > now() - interval '24 hours';
--   $rollback$;
--
--   GRANT EXECUTE ON FUNCTION public.user_review_count_today() TO PUBLIC;
--
--   COMMIT;
--
-- =============================================================================
