-- Migration 004: Profile privacy columns + public_profiles view
--
-- Adds three new columns to the profiles table:
--   postcode            — approx location only; never full address (data minimisation, UK GDPR Art.5(1)(c))
--   show_in_search      — controls whether this user appears in public search (default FALSE — ICO Children's Code Standard 9)
--   show_reviews_publicly — controls whether reviews show the author's name (default TRUE)
--
-- Creates a public_profiles VIEW as the sole query path for cross-user data.
-- The view is a formal security boundary: it NEVER exposes children_ages,
-- is_admin, subscription_tier, stripe_customer_id, marketing_consent, or
-- terms_accepted_at — even if a future developer forgets and does SELECT *.
--
-- GDPR Art.25 (data protection by design and by default):
--   Sensitive fields are excluded at the view level so the default query
--   pattern is the safe pattern.

-- ── 1. Add columns ──────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS postcode              text,
  ADD COLUMN IF NOT EXISTS show_in_search        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_reviews_publicly boolean NOT NULL DEFAULT true;

-- ── 2. Comments (self-documenting schema) ───────────────────────────────────

COMMENT ON COLUMN profiles.postcode IS
  'Approximate location for the user — postcode only, never a full address. NULL by default. UK GDPR Art.5(1)(c) data minimisation.';

COMMENT ON COLUMN profiles.show_in_search IS
  'When false the user is invisible to other users searching for parents. Default false per ICO Children''s Code Standard 9 (high privacy by default).';

COMMENT ON COLUMN profiles.show_reviews_publicly IS
  'When false the user''s name is hidden on their reviews. Default true because reviews help other families.';

-- ── 3. public_profiles view ─────────────────────────────────────────────────
--
-- This is the ONLY authorised way to read another user's profile data.
-- The column list is intentionally explicit — never use SELECT *.
-- Only rows where show_in_search = true are visible through this view.
--
-- Excluded from the view (never cross-user visible):
--   children_ages, is_admin, subscription_tier, subscription_expires_at,
--   marketing_consent, terms_accepted_at, postcode, stripe_customer_id

CREATE OR REPLACE VIEW public_profiles AS
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

-- ── 4. Permissions ──────────────────────────────────────────────────────────
--
-- Authenticated users may SELECT from the view (to see other parents).
-- Anonymous users cannot — this is not a public directory.
-- No INSERT/UPDATE/DELETE through the view — always go through the base table via RLS.

GRANT SELECT ON public_profiles TO authenticated;
REVOKE ALL ON public_profiles FROM anon;

-- ── 5. RLS note ─────────────────────────────────────────────────────────────
--
-- The profiles table already has RLS enabled (migration 001).
-- Existing policies allow each user to read and update only their own row.
-- The public_profiles view inherits the SECURITY DEFINER context of the view
-- owner (postgres), so it bypasses RLS. The WHERE show_in_search = true clause
-- is the access gate — it replaces RLS for cross-user visibility.
-- Own-row writes (edit profile) continue to go through the base table + RLS.
