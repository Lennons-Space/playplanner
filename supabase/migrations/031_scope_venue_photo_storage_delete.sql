-- Migration 031: Scope venue-photos storage delete policy to own uploads.
--
-- The previous policy allowed ANY authenticated user to delete ANY file in the
-- venue-photos bucket (the using() clause only checked bucket_id). This meant a
-- malicious signed-in user could delete approved photos they did not upload.
--
-- The new policy restricts delete to objects whose DB row has uploaded_by = auth.uid().
-- The app always deletes via the hook which checks uploaded_by, so this aligns storage
-- policy with the application-level intent.

drop policy if exists "Authenticated users can delete own venue photos" on storage.objects;
drop policy if exists "Users can delete own venue photos" on storage.objects;
drop policy if exists "Admins can delete any venue photo from storage" on storage.objects;

create policy "Users can delete own venue photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'venue-photos'
    and exists (
      select 1 from venue_photos
      where venue_photos.storage_path = storage.objects.name
        and venue_photos.uploaded_by  = auth.uid()
    )
  );

-- Admins can delete any venue photo (for moderation cleanup).
-- The "Admins can manage all photos" policy on the venue_photos TABLE already
-- covers DB row deletes; this covers the matching storage object.
create policy "Admins can delete any venue photo from storage"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'venue-photos'
    and exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );
