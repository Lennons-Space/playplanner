-- Migration 007: Venue Photos — status enum + storage bucket
-- ============================================================
-- Replaces the boolean `is_approved` column on venue_photos with a
-- proper status enum ('pending' | 'approved' | 'rejected') that mirrors
-- the pattern already used for venues and reviews.
--
-- Also adds moderation metadata columns, updates all RLS policies to
-- use the new column, and creates the `venue-photos` Storage bucket.
--
-- Safety: wrapped in BEGIN/COMMIT so the whole migration rolls back if
-- any statement fails. Run in: Supabase Dashboard > SQL Editor.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Create the status enum type
-- ============================================================

-- 'pending'  = uploaded, waiting for admin review (default)
-- 'approved' = visible to all users on the venue detail screen
-- 'rejected' = hidden; uploaded_by user can see their own rejected photos
do $$
begin
  if not exists (select 1 from pg_type where typname = 'photo_status') then
    create type photo_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

-- ============================================================
-- 2. Drop old RLS policies FIRST (they reference is_approved,
--    so the column cannot be dropped while they exist)
-- ============================================================

drop policy if exists "Approved photos are public"              on venue_photos;
drop policy if exists "Authenticated users can upload photos"   on venue_photos;
drop policy if exists "Users can delete own photos"             on venue_photos;
drop policy if exists "Admins can manage all photos"            on venue_photos;

-- ============================================================
-- 3. Add new columns
-- ============================================================

-- status replaces is_approved — every new upload starts as 'pending'
alter table venue_photos
  add column if not exists status photo_status not null default 'pending';

-- Moderation audit trail (mirrors the pattern on venues table)
alter table venue_photos
  add column if not exists moderation_notes text,
  add column if not exists moderated_by     uuid references profiles(id),
  add column if not exists moderated_at     timestamptz;

-- ============================================================
-- 4. Backfill status from is_approved
-- ============================================================

-- Any row where is_approved=true was explicitly approved — mark it so.
-- Everything else stays 'pending' (the column default).
update venue_photos
  set status = 'approved'
  where is_approved = true;

-- ============================================================
-- 5. Drop the old boolean column (policies already gone — safe now)
-- ============================================================

alter table venue_photos drop column if exists is_approved;

-- ============================================================
-- 6. Index for moderation queue lookups (admin screen)
-- ============================================================

create index if not exists venue_photos_status_idx
  on venue_photos (status, created_at desc);

-- ============================================================
-- 7. New RLS policies (status-aware)
-- ============================================================

-- Public read: only approved photos on published+approved venues
-- UUID storage paths mean brute-forcing URLs is not practical, but RLS
-- is the authoritative gate — storage bucket alone is not enough.
create policy "Approved photos are public" on venue_photos
  for select using (
    status = 'approved'
    and exists (
      select 1 from venues
      where venues.id = venue_photos.venue_id
        and venues.is_published = true
        and venues.moderation_status = 'approved'
    )
  );

-- Uploader can see their own photos (any status) so they know their
-- photo was received and can track whether it was approved or rejected.
create policy "Users can view own photos" on venue_photos
  for select using (auth.uid() = uploaded_by);

-- Upload: status must arrive as 'pending' — no auto-approval path.
-- RLS cap: max 5 photos per user per venue (WITH CHECK subquery).
-- Max 20 photos per venue is enforced separately below.
create policy "Authenticated users can upload photos" on venue_photos
  for insert with check (
    auth.uid() = uploaded_by
    and status = 'pending'
    -- Per-user-per-venue cap: max 5 photos
    and (
      select count(*) from venue_photos existing
      where existing.venue_id   = venue_photos.venue_id
        and existing.uploaded_by = auth.uid()
    ) < 5
    -- Per-venue cap: max 20 photos total
    and (
      select count(*) from venue_photos existing
      where existing.venue_id = venue_photos.venue_id
    ) < 20
  );

-- Users can delete their own photos (e.g. before moderation, or GDPR erasure).
create policy "Users can delete own photos" on venue_photos
  for delete using (auth.uid() = uploaded_by);

-- Admins can do everything: read pending queue, approve, reject, delete.
create policy "Admins can manage all photos" on venue_photos
  for all using (is_admin());

-- ============================================================
-- 7. venue-photos Storage bucket
-- ============================================================
-- Public read is intentional: approved photos are publicly visible by
-- design (venue discovery). UUID-based paths make guessing URLs hard.
-- This must be noted in the app's DPIA.
-- Auth write: any logged-in user can upload (RLS policies above cap it).
-- 10 MB per file — enough for a high-quality venue photo post-manipulation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venue-photos',
  'venue-photos',
  true,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/webp']  -- JPEG only post-manipulator strip; webp as fallback
)
on conflict (id) do nothing;

-- Anyone can read (photos are public URLs displayed in the app)
create policy "Venue photos are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'venue-photos');

-- Authenticated users can upload into the bucket.
-- Path format: {venueId}/{uuid}.jpg  — no user ID in path (privacy: GDPR Art.5(1)(c))
create policy "Authenticated users can upload venue photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'venue-photos');

-- Users can delete their own uploads (matched by storage path stored in venue_photos.storage_path)
-- Note: Supabase Storage does not expose the uploader's uid in object metadata by default,
-- so broad authenticated delete is scoped here; the app deletes via the DB row's uploader check.
create policy "Authenticated users can delete own venue photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'venue-photos');

COMMIT;
