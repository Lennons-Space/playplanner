-- =============================================================================
-- 064_add_profile_self_read_rpcs.sql
--
-- STEP 1 OF 2 -- PURELY ADDITIVE. Changes NO privilege and NO policy.
-- Pair: 065_restrict_profile_read_exposure.sql does the actual restriction.
--
-- WHY THIS IS SPLIT OUT
-- ---------------------
-- The containment in 065 removes the client's ability to SELECT the privileged
-- profile columns directly. The app must therefore already know how to read the
-- caller's own row a different way BEFORE that happens. Shipping both in one
-- migration creates a dependency cycle:
--
--   old client + restricted DB  -> own-profile load returns nothing
--   new client + unrestricted DB -> RPC does not exist yet
--
-- Applying THIS file first breaks nothing: the old direct-SELECT path still
-- works exactly as it does today, and the new RPCs simply become available. A
-- client build using them can then be shipped and verified against production
-- while the old path is still live. Only then is 065 applied.
--
-- Rollout states, each proved in supabase/tests/065_profile_read_exposure.mjs:
--   STATE 1  current DB            + current client  -> works
--   STATE 2  + 064                 + current client  -> works (nothing removed)
--   STATE 3  + 064                 + new client      -> works (RPCs present)
--   STATE 4  + 064 + 065           + new client      -> works, and contained
--
-- TWO FUNCTIONS, NOT ONE -- deliberate least privilege
-- ----------------------------------------------------
--   get_my_profile()        -> what the APP needs for ordinary operation.
--                              Feeds Zustand. Does NOT return
--                              stripe_customer_id: a payment identifier has no
--                              reason to sit in ordinary client state.
--
--   get_my_profile_export() -> what the RIGHT-OF-ACCESS EXPORT needs. Returns
--                              EVERY column of the caller's own profiles row,
--                              stripe_customer_id included. Used only by the
--                              export path, so the identifier transits once on
--                              explicit user request and is never cached in
--                              application state.
--
-- Splitting them means "not in normal app state" and "not in the user's own
-- data export" stop being the same decision. They are different questions and
-- previously had the same (wrong for the export) answer.
--
-- SHARED SAFETY PROPERTIES (both functions)
-- -----------------------------------------
--   * ZERO parameters. auth.uid() is resolved internally, so there is no
--     caller-supplied user id to tamper with and no way to request another
--     user's row. A get_profile(uuid) would reintroduce the very leak 065
--     closes.
--   * SECURITY DEFINER -- required, not decorative: after 065 the client roles
--     hold no SELECT privilege on the privileged columns, so an invoker-rights
--     function could not read the caller's own row either.
--   * SET search_path = '' with fully schema-qualified references.
--   * STABLE, read-only.
--   * Explicit return column lists -- never SELECT *, so a future column added
--     to `profiles` cannot silently start flowing to a client.
--   * EXECUTE revoked from PUBLIC, anon AND authenticated, then granted to
--     authenticated only. All three revokes are required: Supabase's ALTER
--     DEFAULT PRIVILEGES grants EXECUTE on new functions DIRECTLY to
--     anon/authenticated, so revoking PUBLIC alone leaves both roles holding it
--     (proven in production during the 062 rollout, 2026-08-16).
--
-- Idempotent. Does NOT edit any historical migration. Safe to apply on its own
-- and safe to leave applied indefinitely without 065.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Ordinary application read -- the caller's own profile, minus payment ids.
--    Column list mirrors what store/authStore.ts already put in the Profile
--    object, so the client shape is unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  id                      uuid,
  username                text,
  full_name               text,
  avatar_url              text,
  bio                     text,
  is_admin                boolean,
  is_business_owner       boolean,
  subscription_tier       text,
  subscription_expires_at timestamptz,
  children_ages           text[],
  postcode                text,
  marketing_consent       boolean,
  terms_accepted_at       timestamptz,
  show_in_search          boolean,
  show_reviews_publicly   boolean,
  created_at              timestamptz,
  updated_at              timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.bio,
         p.is_admin, p.is_business_owner,
         p.subscription_tier, p.subscription_expires_at,
         p.children_ages, p.postcode,
         p.marketing_consent, p.terms_accepted_at,
         p.show_in_search, p.show_reviews_publicly,
         p.created_at, p.updated_at
    FROM public.profiles p
   WHERE p.id = (SELECT auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

COMMENT ON FUNCTION public.get_my_profile() IS
  'Ordinary application read of the CALLING user''s own profile row. Takes no '
  'argument by design -- auth.uid() is resolved internally, so no user can '
  'request another user''s row. Deliberately omits stripe_customer_id: a '
  'payment identifier must not sit in ordinary client application state. For '
  'the user''s own data export use get_my_profile_export() instead.';

-- -----------------------------------------------------------------------------
-- 2. Right-of-access export read -- EVERY column of the caller's own row.
--
--    The export is the user's copy of the data held about them, so withholding
--    a column from it is a different decision from keeping that column out of
--    day-to-day app state. This function makes the export complete with respect
--    to the profiles table; the accompanying test asserts, by comparing against
--    information_schema, that its return list covers every column of the table
--    -- so a column added later cannot silently go missing from exports.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_profile_export()
RETURNS TABLE (
  id                      uuid,
  username                text,
  full_name               text,
  avatar_url              text,
  bio                     text,
  is_business_owner       boolean,
  is_admin                boolean,
  subscription_tier       text,
  subscription_expires_at timestamptz,
  stripe_customer_id      text,
  children_ages           text[],
  marketing_consent       boolean,
  terms_accepted_at       timestamptz,
  created_at              timestamptz,
  updated_at              timestamptz,
  postcode                text,
  show_in_search          boolean,
  show_reviews_publicly   boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.bio,
         p.is_business_owner, p.is_admin,
         p.subscription_tier, p.subscription_expires_at, p.stripe_customer_id,
         p.children_ages, p.marketing_consent, p.terms_accepted_at,
         p.created_at, p.updated_at,
         p.postcode, p.show_in_search, p.show_reviews_publicly
    FROM public.profiles p
   WHERE p.id = (SELECT auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_profile_export() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_export() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_export() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_my_profile_export() TO authenticated;

COMMENT ON FUNCTION public.get_my_profile_export() IS
  'Returns EVERY column of the CALLING user''s own profile row, including '
  'stripe_customer_id, for the user''s own data export. Takes no argument by '
  'design -- auth.uid() is resolved internally, so no user can request another '
  'user''s row. Not used by ordinary app state; see get_my_profile().';

COMMIT;
