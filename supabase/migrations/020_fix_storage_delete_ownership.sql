-- CRIT-01: Restrict storage DELETE to the photo owner or an admin.
-- Previous policy allowed any authenticated user to delete any photo.
drop policy if exists "Authenticated users can delete own venue photos" on storage.objects;

create policy "Users can delete own venue photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'venue-photos'
    and (
      owner = auth.uid()
      or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
    )
  );
