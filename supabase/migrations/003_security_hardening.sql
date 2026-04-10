-- =============================================================================
-- 003_security_hardening.sql
--
-- Five targeted security and compliance fixes:
--
--   1. public_profiles view — stops the full profiles row (which contains
--      marketing_consent, terms_accepted_at, children_ages, is_admin, and
--      subscription details) being queryable by other authenticated users.
--      Only the safe "public card" columns are exposed through this view.
--
--   2. RLS tightening on profiles — the original "viewable by authenticated users"
--      policy let ANY logged-in user read ANY other user's full profile row,
--      which is a UK GDPR Art.5(1)(b) purpose limitation violation and an
--      ICO Children's Code Standard 3 (data minimisation) violation.
--      Replaced with an own-row-only SELECT policy.
--
--   3. handle_new_user trigger fix — the original trigger did not copy the
--      marketing_consent flag from sign-up metadata into the profiles row,
--      meaning consent was recorded at sign-up but silently lost before the
--      profile was created. This fixes the gap.
--
--   4. Venue submission rate limit — prevents a single account from flooding
--      the moderation queue (spam, competitor suppression, or scraping via
--      POST). Capped at 10 submissions per user per 24-hour rolling window.
--      This is enforced at the database layer (RLS INSERT policy) so it cannot
--      be bypassed by the client.
--
--   5. delete_own_account function — clients cannot call DELETE on auth.users
--      directly (Supabase blocks this for good reason). This SECURITY DEFINER
--      function runs with elevated rights to perform the deletion on behalf of
--      the authenticated caller, but only for their own account. It also writes
--      a GDPR Art.17 (right to erasure) audit entry before deleting.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Safe public view
--    Only the columns that are safe to show other authenticated users.
--    Mirrors the PublicProfile TypeScript type in types/index.ts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public_profiles AS
  SELECT
    id,
    username,
    full_name,
    avatar_url,
    bio,
    is_business_owner
  FROM profiles;

-- Grant SELECT on the view to any signed-in user.
-- They cannot see the underlying profiles table — only this view.
GRANT SELECT ON public_profiles TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tighten profiles RLS
--    UK GDPR Art.5(1)(b): data must only be used for the purpose it was collected.
--    The original broad "authenticated users can view all profiles" policy violated
--    this — no user needs another user's consent timestamps or subscription details.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Note: other screens that need a public card (e.g. reviewer display names)
-- must query public_profiles, not profiles directly.


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix handle_new_user trigger
--    The marketing_consent value the user sets at registration was being dropped
--    because the original trigger function did not copy it from raw_user_meta_data.
--    Fixed here so the profile row is created with the correct consent flag from day one.
--
--    SECURITY DEFINER means this runs with the rights of its owner (postgres),
--    not the calling user — necessary because triggers fire before the user's
--    own session is fully established.
--    SET search_path prevents a search_path hijack (a known Postgres attack vector).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, marketing_consent)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    -- COALESCE means: use the value from sign-up metadata if it exists,
    -- otherwise default to false (opt-out). Never assume marketing consent.
    COALESCE((new.raw_user_meta_data->>'marketing_consent')::boolean, false)
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Venue submission rate limit
--    Prevents abuse of the submission queue (spam, competitor attacks, scraping).
--    The policy counts how many venues the current user has submitted in the last
--    24 hours. If the count is already 10 or more, the INSERT is rejected.
--    This runs in the database, so no amount of client manipulation can bypass it.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Rate limit venue submissions" ON venues;

CREATE POLICY "Rate limit venue submissions" ON venues
  FOR INSERT
  WITH CHECK (
    auth.uid() = submitted_by
    AND (
      SELECT count(*)
      FROM venues
      WHERE submitted_by = auth.uid()
        AND created_at > now() - interval '24 hours'
    ) < 10
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Account deletion function (GDPR Art.17 — right to erasure)
--    Clients cannot delete their own auth.users row directly. This function
--    runs with SECURITY DEFINER (elevated rights) but only ever deletes the
--    calling user's own account (auth.uid() = id).
--    It first writes an audit log entry so we have a record that erasure was
--    requested and performed — required by GDPR Art.5(2) accountability principle.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void AS $$
BEGIN
  -- Write GDPR Art.17 audit record before deletion.
  -- This must happen first — once the auth.users row is deleted, auth.uid()
  -- returns null and we can no longer identify the requester.
  INSERT INTO gdpr_audit_log (user_id, action, performed_by)
  VALUES (auth.uid(), 'account_deletion_requested', auth.uid());

  -- Delete the auth.users row. Supabase cascades this to profiles and all
  -- tables with ON DELETE CASCADE foreign keys, so no orphaned data remains.
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Allow any authenticated user to call this function (they can only ever
-- delete themselves, as enforced by auth.uid() = id inside the function).
GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated;
