-- HIGH-02: Enforce show_reviews_publicly at DB level so direct REST cannot bypass it.
-- Previous policy returned any approved review regardless of the author's privacy setting.
drop policy if exists "Approved reviews are public" on reviews;

create policy "Approved reviews are public"
  on reviews for select
  using (
    moderation_status = 'approved'
    and (
      -- Author's profile has reviews set to public
      exists (
        select 1 from profiles p
        where p.id = reviews.user_id
          and p.show_reviews_publicly = true
      )
      -- Review author can always see their own reviews
      or auth.uid() = user_id
      -- Admins can see all approved reviews for moderation
      or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
    )
  );
