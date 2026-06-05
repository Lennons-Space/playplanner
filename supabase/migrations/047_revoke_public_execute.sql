-- =============================================================================
-- 047_revoke_public_execute.sql
--
-- WHY THIS IS NEEDED
-- ------------------
-- Migration 046 used REVOKE EXECUTE ... FROM anon, authenticated for trigger-only
-- and maintenance functions. This did not fully close access because PostgreSQL's
-- default EXECUTE grant is given to PUBLIC (everyone), not to anon/authenticated
-- individually. Revoking from a named role only removes an explicit role-level
-- grant; the PUBLIC grant remains, and anon/authenticated inherit from PUBLIC.
--
-- The correct sequence is:
--   1. REVOKE EXECUTE ... FROM PUBLIC   (removes the "everyone" grant)
--   2. GRANT EXECUTE ... TO <role>      (re-add only to roles that need it)
--
-- FUNCTIONS COVERED
-- -----------------
-- handle_new_user()                          — trigger-only; nobody calls it via RPC
-- redact_venue_report_notes_on_profile_delete() — trigger-only; same
-- is_admin()                                 — maintenance utility; not used by app
-- rls_auto_enable()                          — maintenance utility; not used by app
-- delete_own_account()                       — authenticated-only (GDPR Art.17)
-- review_venue_claim(uuid, text, text)       — authenticated-only (admin screen)
--
-- INTENTIONAL LINTER WARNINGS (not fixed here — by design)
-- ---------------------------------------------------------
-- delete_own_account (authenticated) : must be callable; guards itself with
--   auth.uid() internally. GDPR Art.17 account deletion requires this.
-- review_venue_claim (authenticated) : must be callable; enforces its own
--   is_admin check. Admin moderation screen requires this.
-- pass_interest INSERT WITH CHECK (true) : dormant table, authenticated-only
--   insert, no active UI. Acceptable until the feature is built out.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. handle_new_user
--    Trigger function — fires automatically when a new auth.users row is created.
--    Nobody should call this via the REST API (/rpc/handle_new_user).
--    The trigger itself continues to fire normally; the DB engine calls it
--    internally, not through the anon/authenticated permission system.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. redact_venue_report_notes_on_profile_delete
--    Trigger function — fires on BEFORE DELETE on profiles to wipe free-text
--    report notes. Same reasoning: only the DB engine calls this.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.redact_venue_report_notes_on_profile_delete() FROM PUBLIC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. is_admin
--    Utility that checks whether the current user is an admin.
--    Not called from any app code — the admin check in review_venue_claim
--    queries profiles directly. Service role / postgres superuser can still
--    call it for maintenance (they bypass the permission system entirely).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
      AND pg_get_function_arguments(p.oid) = ''
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. rls_auto_enable
--    Maintenance utility — enables RLS on all public tables in one call.
--    Never called from the app. Service role can still call it.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
      AND pg_get_function_arguments(p.oid) = ''
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. delete_own_account
--    GDPR Art.17 right-to-erasure function. Must remain callable by authenticated
--    users (profile.tsx calls it). Revoke PUBLIC, re-grant to authenticated.
--    The function guards itself with auth.uid() — it can only delete the caller's
--    own account, never anyone else's.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. review_venue_claim
--    Admin function to approve/reject business ownership claims. Must remain
--    callable by authenticated users (admin screen calls it). Revoke PUBLIC,
--    re-grant to authenticated. The function enforces its own is_admin check
--    internally — non-admins will get "Admin access required" if they call it.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.review_venue_claim(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.review_venue_claim(uuid, text, text) TO authenticated;
