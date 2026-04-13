-- Migration 005: avatars storage bucket
-- ============================================================
-- Creates the `avatars` bucket and RLS policies so each user
-- can only manage their own avatar file, but any client can
-- read them (required for displaying avatars on reviews/profiles).
--
-- GDPR Art.5(1)(c) — data minimisation:
--   Only image/* MIME types accepted. Max 5 MB per file.
--   File path enforces {user_id}/{filename} — no cross-user writes.
--
-- ICO Children's Code Standard 4 (transparency):
--   Avatar images are public by design — the user explicitly
--   chooses and uploads them. This is made clear in the UI.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,  -- 5 MB — enough for a high-quality profile photo
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Authenticated users may upload into their own sub-folder only.
-- Path structure: avatars/{user_id}/{filename}
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read — avatars are intentionally visible (shown beside reviews, profiles).
create policy "Avatar images are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');
