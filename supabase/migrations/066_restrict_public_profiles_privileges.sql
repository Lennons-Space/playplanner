-- =============================================================================
-- 066_restrict_public_profiles_privileges.sql
--
-- Follow-up containment for migration 065.
--
-- Production verification after 065 found that public.public_profiles retained
-- historical ALL privileges for the authenticated role. Migration 065 granted
-- SELECT but did not revoke those pre-existing privileges first.
--
-- This migration makes the intended boundary explicit:
--   authenticated -> SELECT only
--   anon          -> no privileges
--   PUBLIC        -> no privileges
--
-- service_role is intentionally untouched.
-- No data is modified.
-- =============================================================================

BEGIN;

REVOKE ALL PRIVILEGES
ON TABLE public.public_profiles
FROM PUBLIC, anon, authenticated;

GRANT SELECT
ON TABLE public.public_profiles
TO authenticated;

COMMIT;