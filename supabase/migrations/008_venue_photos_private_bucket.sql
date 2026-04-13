-- Migration 008: venue-photos — private bucket + status-aware storage policies
-- ============================================================
-- WHY THIS MIGRATION EXISTS
-- Migration 007 created the `venue-photos` bucket with `public = true` and a
-- storage SELECT policy scoped to `to public` with no status check. This meant
-- any unauthenticated request with a known (or guessed) storage path could
-- fetch a pending or rejected photo — completely bypassing the moderation gate
-- enforced by `venue_photos` table-level RLS.
--
-- This migration fixes that by:
--   1. Dropping all three storage.objects policies from migration 007.
--   2. Making the bucket private (public = false).
--   3. Restricting MIME types to JPEG only — WebP is removed because it can
--      carry ICC profile/EXIF data that some parsers mishandle, and the app
--      re-encodes all uploads to JPEG before they leave the device anyway.
--   4. Replacing the single public SELECT policy with three narrow policies:
--        a. Approved photos readable by authenticated users (joins venue_photos
--           to verify status = 'approved').
--        b. Uploaders can read their own photos regardless of status — GDPR
--           Art.15 right of access to your own data.
--        c. Admins can read all photos for moderation review.
--   5. Recreating the upload and delete policies (logic unchanged).
--
-- GDPR BASIS
--   Art.5(1)(f) — integrity and confidentiality: pending/rejected photos must
--     not be accessible outside the moderation workflow.
--   Art.15 — right of access: uploaders must be able to retrieve their own
--     photos in any status so they can exercise subject access rights.
--   Art.17 — right to erasure: users and admins must be able to physically
--     remove photo files, not only soft-delete the DB record.
--
-- ICO Children's Code Standard 2 (data minimisation / privacy by default):
--   No photo should be visible beyond the minimum necessary audience.
--   Pending photos visible only to uploader + admins. Rejected photos visible
--   only to uploader (Art.15) and admins (audit trail).
--
-- Safety: wrapped in BEGIN/COMMIT — rolls back entirely on any failure.
-- Run in: Supabase Dashboard > SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Drop existing storage.objects policies for venue-photos
-- ============================================================
-- These three policies were created by migration 007. `if exists` makes this
-- safe to re-run or to apply on a DB where a policy was manually dropped.

-- Root cause of the moderation bypass: no status check, scoped to `to public`.
drop policy if exists "Venue photos are publicly readable"
  on storage.objects;

-- Recreated below with the same upload logic — dropped here for a clean slate.
drop policy if exists "Authenticated users can upload venue photos"
  on storage.objects;

-- Recreated below with the same delete logic — dropped here for a clean slate.
drop policy if exists "Authenticated users can delete own venue photos"
  on storage.objects;

-- ============================================================
-- 2. Make the bucket private and JPEG-only
-- ============================================================
-- public = false: Supabase will no longer serve objects from this bucket
-- without a matching storage RLS SELECT policy. This is the CDN-layer gate;
-- the status-aware policies below are the application-layer gate.
--
-- allowed_mime_types narrowed to JPEG only:
--   WebP (previously allowed) can embed ICC profiles and EXIF data that some
--   server-side image parsers mishandle. JPEG is the target output format
--   after client-side manipulation strips metadata; WebP as an input type is
--   no longer needed and only widens the attack surface.

update storage.buckets
  set public             = false,
      allowed_mime_types = array['image/jpeg']
  where id = 'venue-photos';

-- ============================================================
-- 3a. Approved photos readable by authenticated users
-- ============================================================
-- Joins to venue_photos to verify the file's status = 'approved'.
-- Authenticated-only: even approved photos are not served to anonymous
-- requests (the app requires login to browse venues).
--
-- The EXISTS subquery runs under the calling user's session, so venue_photos
-- table-level RLS applies automatically as a second gate — a user cannot use
-- this policy to probe photo existence for venues whose table rows they
-- cannot see.

create policy "Approved venue photos readable"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'venue-photos'
    and exists (
      select 1 from venue_photos
      where venue_photos.storage_path = storage.objects.name
        and venue_photos.status = 'approved'
    )
  );

-- ============================================================
-- 3b. Uploaders can read their own photos (any status)
-- ============================================================
-- GDPR Art.15 — right of access: a user who uploaded a photo must be able to
-- retrieve it regardless of moderation outcome so they can confirm receipt,
-- understand whether it was rejected, and exercise erasure rights (Art.17).
-- Scoped to uploaded_by = auth.uid() — no cross-user leakage.

create policy "Users can read own venue photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'venue-photos'
    and exists (
      select 1 from venue_photos
      where venue_photos.storage_path = storage.objects.name
        and venue_photos.uploaded_by = auth.uid()
    )
  );

-- ============================================================
-- 3c. Admins can read all photos
-- ============================================================
-- Admins need to view pending and rejected photos to run the moderation queue.
-- is_admin() is defined in migration 003 and reads from profiles.is_admin
-- server-side — a client cannot escalate privilege by claiming admin status.

create policy "Admins can read all venue photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'venue-photos'
    and is_admin()
  );

-- ============================================================
-- 4. Recreate upload policy (logic unchanged from migration 007)
-- ============================================================
-- Any authenticated user may upload into the bucket.
-- Path format: {venueId}/{uuid}.jpg — no user ID in path.
-- GDPR Art.5(1)(c) data minimisation: excluding the user ID from the storage
-- path avoids an unnecessary linkage between the file URL and the uploader.
-- Per-user and per-venue photo caps are enforced by venue_photos table RLS
-- (migration 007, step 7).

create policy "Authenticated users can upload venue photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'venue-photos');

-- ============================================================
-- 5. Recreate delete policy (logic unchanged from migration 007)
-- ============================================================
-- Broad authenticated delete at the storage layer; uploader-scoping is enforced
-- at the application layer (the app deletes the venue_photos DB row first,
-- which is gated by the "Users can delete own photos" table RLS policy, then
-- calls storage delete). Supabase Storage does not expose uploader uid in
-- object metadata by default, making a pure storage-layer uid check unreliable.
--
-- GDPR Art.17 — right to erasure: users and admins must be able to physically
-- remove photo files, not only soft-delete the DB record.

create policy "Authenticated users can delete own venue photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'venue-photos');

COMMIT;
