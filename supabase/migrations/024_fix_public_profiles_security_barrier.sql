-- =============================================================================
-- 024_fix_public_profiles_security_barrier.sql
--
-- HIGH-01: public_profiles view was missing security_invoker = true.
--
-- Two separate protections are required:
--
-- 1. security_invoker = true
--    Forces the view to run as the QUERYING USER, not the DB owner.
--    Without this, Postgres silently defaults to SECURITY DEFINER behaviour
--    for views, meaning RLS on the underlying profiles table is evaluated as
--    the superuser and always passes. Any future tightening of profile RLS
--    (e.g. blocking suspended accounts) would be silently bypassed.
--    The Security Advisor flags this because the explicit keyword is required
--    to override the superuser default — omitting SECURITY DEFINER is NOT
--    enough on its own.
--
-- 2. security_barrier = true
--    Prevents filter-pushdown attacks. Without this flag, Postgres may push
--    a WHERE clause from an outer query INTO the view body and evaluate it
--    before the view's own WHERE clause (show_in_search = true) runs,
--    potentially leaking hidden rows to a crafted outer predicate.
--    security_barrier forces the view's WHERE to be evaluated first.
--
-- Column list is identical to migration 004 — no columns added or removed.
--
-- References:
--   PostgreSQL docs — CREATE VIEW, security_barrier, security_invoker
--   UK GDPR Art.25 — data protection by design and by default
--   ICO Children's Code Standard 9 — high privacy settings by default
-- =============================================================================

-- Drop the existing view (004 created it with CREATE OR REPLACE; IF EXISTS is
-- a no-op guard if a future migration has already dropped it).
DROP VIEW IF EXISTS public_profiles;

-- Recreate with both security options set explicitly.
-- security_invoker = true  → view runs as the calling user; RLS applies.
-- security_barrier = true  → view WHERE is evaluated before any outer predicate.
CREATE VIEW public_profiles
  WITH (security_invoker = true, security_barrier = true)
AS
  SELECT
    id,
    username,
    full_name,
    avatar_url,
    bio,
    is_business_owner,
    show_reviews_publicly,
    created_at
  FROM profiles
  WHERE show_in_search = true;

-- Restore the same grants that migrations 003 and 004 applied.
-- Authenticated users may read the view; anonymous users may not
-- (this is not a public directory — ICO Children's Code Standard 3).
GRANT SELECT ON public_profiles TO authenticated;
REVOKE ALL ON public_profiles FROM anon;

-- Comment explaining the security posture for future developers.
COMMENT ON VIEW public_profiles IS
  'Safe cross-user profile view. '
  'security_invoker = true — RLS on the underlying profiles table is evaluated '
  'as the querying user, not the DB owner. '
  'security_barrier = true — prevents filter-pushdown attacks that could expose '
  'rows hidden by the show_in_search = true WHERE clause. '
  'Never expose: children_ages, is_admin, subscription_tier, stripe_customer_id, '
  'marketing_consent, terms_accepted_at, postcode.';
