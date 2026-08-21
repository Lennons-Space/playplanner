-- =============================================================================
-- 062_fix_profile_privilege_escalation.sql
--
-- HOTFIX for PP-001 (CRITICAL, live in production).
--
-- THE BUG
-- -------
-- Migration 001 created:
--
--     create policy "Users can update own profile" on profiles
--       for update using (auth.uid() = id);
--
-- with NO `WITH CHECK`. PostgreSQL then defaults WITH CHECK to the USING
-- expression, evaluated against the NEW row -- which only re-asserts
-- `id = auth.uid()`. That is still true after the edit, so the row is accepted.
-- Nothing anywhere constrained WHICH COLUMNS could change:
--
--   * no ALTER POLICY exists anywhere in migrations 001-061;
--   * the only BEFORE UPDATE trigger on profiles is `profiles_updated_at`,
--     whose entire body is `new.updated_at = now(); return new;`;
--   * there are no column-level privileges anywhere in the migration set;
--   * there is no table-level GRANT/REVOKE on `profiles` at all, so Supabase's
--     default privileges apply and `authenticated` holds table-wide UPDATE.
--
-- Consequence: any signed-in user could run
--
--     PATCH /rest/v1/profiles?id=eq.<their-own-uid>   {"is_admin": true}
--
-- and become an admin in a single request. `is_admin()` (001:396-403) reads
-- that column and gates ~15 RLS policies plus the entire admin RPC surface.
--
-- The app's own restriction (hooks/useProfile.ts ProfileUpdate Pick<>) is a
-- TypeScript type -- compile-time only, and irrelevant to a direct PostgREST
-- call. Client-side hiding is not authorisation.
--
-- WHAT THIS MIGRATION DOES -- three independent layers
-- ----------------------------------------------------
--   LAYER 1 (primary): least-privilege COLUMN-LEVEL UPDATE grants. PostgreSQL
--     itself refuses to update a column the role has no privilege on, before
--     RLS or any trigger is consulted. This is the real boundary.
--   LAYER 2 (backstop): a BEFORE UPDATE trigger that rejects any change to a
--     server-owned column when the caller is acting as anon/authenticated.
--     This survives someone re-granting table-wide UPDATE by accident later.
--   LAYER 3 (hygiene): an explicit WITH CHECK on the RLS policy, pinning row
--     ownership so a user cannot move their row to another identity.
--
-- NOTE: Layer 3 alone does NOT protect is_admin -- a WITH CHECK of
-- `auth.uid() = id` is satisfied by a row that also flips is_admin. The
-- column protection in layers 1 and 2 is what actually fixes PP-001, and it
-- is deliberately independent of the policy.
--
-- COLUMN CLASSIFICATION (derived from the full schema, not assumed)
-- ----------------------------------------------------------------
-- USER-EDITABLE  : username, full_name, bio, avatar_url, children_ages,
--                  postcode, show_in_search, show_reviews_publicly,
--                  marketing_consent, terms_accepted_at (set-once, see below)
-- SERVER-OWNED   : id (identity), is_admin (privilege),
--                  is_business_owner (trust badge -- written only by
--                    review_venue_claim(), migration 027:86-88),
--                  subscription_tier, subscription_expires_at,
--                  stripe_customer_id (all payment state, written only by the
--                    stripe-webhook / create-checkout-session Edge Functions
--                    using the service-role key),
--                  created_at, updated_at (server metadata)
--
-- terms_accepted_at is SET-ONCE rather than fully locked: app/(auth)/register.tsx
-- legitimately writes it client-side at registration (and 001:54-56 documents
-- that this must be an explicit user action, not a server default). Locking it
-- outright would break registration. Allowing free rewrites would make GDPR
-- Art.7 consent evidence forgeable by the data subject. Set-once satisfies both.
--
-- APPLY ORDER / INDEPENDENCE
-- --------------------------
-- Safe to apply directly on top of production's current state (058). Touches
-- ONLY objects created by 001 and 004, both long applied. Does NOT depend on
-- 059/060/061 (committed but unapplied) and does not reference anything they
-- create, so it is order-independent with respect to them.
--
-- Fully idempotent: every statement is IF EXISTS / OR REPLACE / re-grantable,
-- so re-encountering this file later in normal migration order is a no-op.
--
-- Does NOT modify 001 or any historical migration.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- LAYER 3 -- RLS policy hardening (explicit WITH CHECK + role scoping)
--
-- The original policy had no WITH CHECK and no TO clause (so it applied to
-- PUBLIC). Scoping it TO authenticated is strictly stronger and regresses
-- nothing: anon can never satisfy `auth.uid() = id` (auth.uid() is NULL), and
-- service_role bypasses RLS entirely.
--
-- `(SELECT auth.uid())` is the init-plan form already used by migration 057 in
-- this repo -- semantically identical, evaluated once per statement rather than
-- once per row.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING      ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- -----------------------------------------------------------------------------
-- LAYER 1 -- column-level UPDATE privileges (the primary boundary)
--
-- Revoke the table-wide UPDATE that Supabase's default privileges granted, then
-- re-grant UPDATE on ONLY the user-editable columns. PostgreSQL raises 42501
-- (insufficient_privilege) for any UPDATE whose SET list touches a column
-- outside this list -- checked before RLS and before triggers.
--
-- SELECT / INSERT / DELETE are deliberately untouched: the profiles SELECT
-- policy (003:64) and DELETE policy (001:432) must keep working, and
-- delete_own_account() depends on the latter.
--
-- updated_at is intentionally NOT granted. The existing `profiles_updated_at`
-- BEFORE UPDATE trigger still sets it: PostgreSQL checks column privileges
-- against the columns named in the statement's SET list, not against columns
-- assigned by a trigger. (Proven by the regression tests for this migration.)
-- -----------------------------------------------------------------------------
REVOKE UPDATE ON public.profiles FROM PUBLIC;
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  username,
  full_name,
  bio,
  avatar_url,
  children_ages,
  postcode,
  show_in_search,
  show_reviews_publicly,
  marketing_consent,
  terms_accepted_at
) ON public.profiles TO authenticated;

-- -----------------------------------------------------------------------------
-- LAYER 2 -- server-owned column invariant trigger (backstop)
--
-- MUST be SECURITY INVOKER (the default -- stated explicitly because it is a
-- deliberate security decision). A SECURITY DEFINER trigger function would see
-- current_user = its owner (postgres) on EVERY call, so the exemption below
-- would always match and the trigger would never enforce anything.
--
-- Trusted-writer exemption is by EFFECTIVE ROLE, never by client-supplied JWT
-- data (which the client controls and could forge):
--   * service_role key   -> PostgREST does SET LOCAL ROLE service_role
--                           -> current_user = 'service_role'  -> exempt
--   * SECURITY DEFINER RPC (e.g. review_venue_claim, migration 027)
--                           -> current_user = the function owner (postgres)
--                           -> exempt
--   * direct psql/superuser -> current_user = 'postgres'      -> exempt
--   * ordinary API caller   -> current_user = 'authenticated' -> ENFORCED
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Trusted server contexts write these columns legitimately.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id is immutable'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'profiles.is_admin is server-owned and cannot be set by a client'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  IF NEW.is_business_owner IS DISTINCT FROM OLD.is_business_owner THEN
    RAISE EXCEPTION 'profiles.is_business_owner is server-owned (set by review_venue_claim)'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    RAISE EXCEPTION 'profiles.subscription_tier is server-owned (set by Stripe webhook)'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  IF NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at THEN
    RAISE EXCEPTION 'profiles.subscription_expires_at is server-owned (set by Stripe webhook)'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'profiles.stripe_customer_id is server-owned (set by Stripe webhook)'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'profiles.created_at is immutable'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  -- Consent evidence: may be set once (NULL -> value, at registration), never
  -- rewritten or cleared by the data subject afterwards. GDPR Art.7 / Art.5(2).
  IF OLD.terms_accepted_at IS NOT NULL
     AND NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at THEN
    RAISE EXCEPTION 'profiles.terms_accepted_at is consent evidence and cannot be rewritten'
      USING ERRCODE = '42501', HINT = 'PP-001 invariant';
  END IF;

  RETURN NEW;
END;
$$;

-- Not callable directly. (Trigger execution does not consult EXECUTE
-- privileges, so this does not stop the trigger firing -- same pattern this
-- repo already uses for redact_venue_report_notes_on_profile_delete at 047:51.)
--
-- ALL THREE REVOKES ARE REQUIRED -- revoking PUBLIC alone is NOT enough.
-- Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role`, so every newly created
-- function receives EXECUTE as a DIRECT grant to anon and authenticated. A
-- direct grant is not removed by revoking PUBLIC. This was caught by post-apply
-- verification against production on 2026-08-16: after the PUBLIC-only revoke,
-- anon_can_execute and authenticated_can_execute were still true. Production
-- was then hardened with the two additional revokes below, and re-verified as
-- anon_can_execute = false / authenticated_can_execute = false. These lines
-- make the repository match that live state exactly.
REVOKE EXECUTE ON FUNCTION public.enforce_profile_privileged_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_privileged_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_privileged_columns() FROM authenticated;

DROP TRIGGER IF EXISTS profiles_enforce_privileged_columns ON public.profiles;

CREATE TRIGGER profiles_enforce_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_privileged_columns();

COMMIT;
