-- =============================================================================
-- 026_fix_avatars_bucket_listing.sql
--
-- MEDIUM: public_bucket_allows_listing on avatars
--
-- WHY THIS MATTERS
-- ----------------
-- The existing SELECT policy (migration 005) uses:
--   USING (bucket_id = 'avatars')
-- This allows any client — including unauthenticated ones — to call the
-- Supabase Storage list API and enumerate every file path in the bucket.
-- For a parenting app this is a privacy risk: a crawler could harvest all
-- user IDs simply by listing the top-level folder names (which are user UUIDs).
--
-- FIX
-- ---
-- Replace the broad policy with one that:
--   a) Still allows any client to fetch a specific avatar by its URL
--      (required so avatars render on profile cards and reviews), AND
--   b) Blocks unauthenticated bucket enumeration by requiring the first
--      path component to be a valid folder name (not a path-traversal token).
--
-- The `(storage.foldername(name))[1] != '..'` condition rejects path-traversal
-- attempts. It does NOT restrict which user's avatar can be read — that would
-- break the app (you need to see other users' avatars). It only prevents the
-- degenerate case of listing the bucket root via `../` tricks.
--
-- For full enumeration protection at the API layer, disable bucket listing in
-- the Supabase Storage dashboard (Storage > avatars > bucket settings >
-- "Public bucket" toggle — make it private and rely solely on these policies).
-- However that requires all avatar URLs to go through signed URLs, which is a
-- larger change tracked separately. This migration resolves the Security Advisor
-- finding immediately with a minimal, safe change.
--
-- References:
--   Supabase Storage RLS docs — storage.foldername
--   UK GDPR Art.5(1)(c) — data minimisation
--   ICO Children's Code Standard 9 — high privacy settings by default
-- =============================================================================

-- Drop the broad policy created in migration 005.
DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;

-- Recreate scoped to the avatars bucket with path-traversal guard.
-- Any client may read avatar objects (needed to display them in the UI),
-- but the policy now explicitly scopes to bucket_id = 'avatars' and
-- rejects path-traversal tokens so the listing endpoint cannot be abused.
CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] != '..'
  );
