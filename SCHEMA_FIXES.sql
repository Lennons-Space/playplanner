-- ============================================================
-- PlayPlanner Schema Fixes — Security & Compliance
-- Apply these changes AFTER reviewing 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- FIX #1: Lock search_path on SECURITY DEFINER functions
-- ============================================================
-- These functions need to specify search_path = public to prevent
-- SQL injection via search_path hijacking.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- Similarly, update is_admin():
create or replace function is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$ language sql security definer set search_path = public stable;

-- ============================================================
-- FIX #2–4: Add moderation enforcement to insert policies
-- ============================================================
-- These prevent users from submitting pre-approved/published content.

drop policy if exists "Authenticated users can submit venues" on venues;
create policy "Authenticated users can submit venues" on venues
  for insert with check (
    auth.uid() = submitted_by
    and moderation_status = 'pending'
    and is_published = false
  );

drop policy if exists "Authenticated users can upload photos" on venue_photos;
create policy "Authenticated users can upload photos" on venue_photos
  for insert with check (auth.uid() = uploaded_by and is_approved = false);

drop policy if exists "Users can write reviews" on reviews;
create policy "Users can write reviews" on reviews
  for insert with check (auth.uid() = user_id and moderation_status = 'pending');

-- ============================================================
-- FIX #5: Fix children_ages data minimisation (profiles)
-- ============================================================
-- Change from exact integers to age ranges per GDPR/EDPB guidance.
-- This is a breaking change if data exists — coordinate with app team.

alter table profiles
  alter column children_ages type text[] using array_to_string(children_ages, ',')::text[];

-- Add a comment explaining the format:
comment on column profiles.children_ages is
  'Age ranges as text[], e.g. [''0-2'', ''3-5'', ''6-12'']. Never store exact ages — supports data minimisation (GDPR) and ICO Children''s Code.';

-- ============================================================
-- FIX #6: Add GDPR Audit Log Table
-- ============================================================
-- Required by GDPR Article 5(2) accountability principle.
-- Logs sensitive operations (profile updates, reviews, venues, etc.)
-- so the organisation can prove what happened and when.

create table if not exists public.gdpr_audit_log (
  id           uuid primary key default uuid_generate_v4(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,  -- 'create', 'update', 'delete', 'view'
  table_name   text not null,
  record_id    uuid,
  old_values   jsonb,  -- before state (for updates)
  new_values   jsonb,  -- after state (for updates/creates)
  reason       text,   -- why (e.g., 'admin moderation', 'user edit')
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz default now()
);

create index if not exists gdpr_audit_log_actor_idx on public.gdpr_audit_log(actor_id, created_at desc);
create index if not exists gdpr_audit_log_table_idx on public.gdpr_audit_log(table_name, created_at desc);
create index if not exists gdpr_audit_log_record_idx on public.gdpr_audit_log(record_id);

alter table public.gdpr_audit_log enable row level security;

-- Only admins can view audit logs
create policy "Admins can view audit logs" on public.gdpr_audit_log
  for select using (is_admin());

comment on table public.gdpr_audit_log is
  'GDPR Article 5(2) accountability: records of all sensitive operations. Admins only.';

-- Allow users to insert their own consent events (terms_accepted, marketing_consent_given, etc.)
-- Narrowly scoped: user_id and performed_by must match the authenticated user.
-- Broader audit entries (admin moderation, data deletions) must go via a service-role Edge Function.
create policy if not exists "Users can insert own consent events" on public.gdpr_audit_log
  for insert with check (
    auth.uid() = user_id
    and auth.uid() = performed_by
  );

-- ============================================================
-- FIX #7: Add Location Consent Log Table
-- ============================================================
-- Required by GDPR Article 7 (proof of consent) + ICO Children's Code Standard 10.
-- Logs when location consent is granted, revoked, or requested.

create table if not exists public.location_consent_log (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  action     text not null check (action in ('requested', 'granted', 'revoked', 'withdrawn')),
  reason     text,  -- e.g., 'user_requested', 'map_feature', 'withdraw_account_deletion'
  ip_address inet,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists location_consent_user_idx on public.location_consent_log(user_id, created_at desc);

alter table public.location_consent_log enable row level security;

create policy "Users see own consent log" on public.location_consent_log
  for select using (auth.uid() = user_id);

create policy "Admins see all consent logs" on public.location_consent_log
  for select using (is_admin());

comment on table public.location_consent_log is
  'GDPR Article 7 + ICO Children''s Code Standard 10: proof of location consent. User can request data export including this.';

-- ============================================================
-- FIX #8: Add missing insert policy for opening_hours
-- ============================================================

create policy if not exists "Owners can insert opening hours" on public.opening_hours
  for insert with check (
    exists (
      select 1 from public.venues
      where venues.id = opening_hours.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- ============================================================
-- FIX #9: Add missing insert/delete policies for review_photos
-- ============================================================

create policy if not exists "Users can upload review photos" on public.review_photos
  for insert with check (
    exists (
      select 1 from public.reviews
      where reviews.id = review_photos.review_id
        and reviews.user_id = auth.uid()
    )
  );

create policy if not exists "Users can delete own review photos" on public.review_photos
  for delete using (
    exists (
      select 1 from public.reviews
      where reviews.id = review_photos.review_id
        and reviews.user_id = auth.uid()
    )
  );

-- ============================================================
-- FIX #10: Add missing insert policy for venue_facilities
-- ============================================================

create policy if not exists "Owners can insert venue facilities" on public.venue_facilities
  for insert with check (
    exists (
      select 1 from public.venues
      where venues.id = venue_facilities.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- ============================================================
-- FIX #11: Add update/delete policies for business_subscriptions
-- ============================================================
-- Required for Stripe webhook integration (plan changes, cancellations).

create policy if not exists "Admins can update subscriptions" on public.business_subscriptions
  for update using (is_admin());

create policy if not exists "Admins can delete subscriptions" on public.business_subscriptions
  for delete using (is_admin());

-- ============================================================
-- FIX #12: Add updated_at trigger for business_subscriptions
-- ============================================================

create trigger if not exists business_subscriptions_updated_at
  before update on public.business_subscriptions
  for each row execute function public.touch_updated_at();

-- ============================================================
-- FIX #13: Add missing insert/update policies for venue_offers
-- ============================================================

create policy if not exists "Owners can insert venue offers" on public.venue_offers
  for insert with check (
    exists (
      select 1 from public.venues
      where venues.id = venue_offers.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

create policy if not exists "Owners can update own venue offers" on public.venue_offers
  for update using (
    exists (
      select 1 from public.venues
      where venues.id = venue_offers.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

create policy if not exists "Owners can delete own venue offers" on public.venue_offers
  for delete using (
    exists (
      select 1 from public.venues
      where venues.id = venue_offers.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- ============================================================
-- FIX #14: Add insert/update policies for venue_analytics
-- ============================================================
-- Required for backend jobs that record view/click analytics.

create policy if not exists "Admins can insert analytics" on public.venue_analytics
  for insert with check (is_admin());

create policy if not exists "Admins can update analytics" on public.venue_analytics
  for update using (is_admin());

-- ============================================================
-- FIX #15: Add performance indexes
-- ============================================================

create index if not exists reviews_user_idx on public.reviews(user_id);
create index if not exists reviews_created_at_idx on public.reviews(created_at desc);
create index if not exists favourites_user_idx on public.favourites(user_id);
create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists business_subscriptions_profile_idx on public.business_subscriptions(profile_id);

-- ============================================================
-- FIX #16: Add age range validation constraint
-- ============================================================

alter table public.venues
  add constraint if not exists age_range_valid check (min_age <= max_age);

-- ============================================================
-- FIX #17: Protect sensitive profile columns (optional)
-- ============================================================
-- NOTE: Postgres 16+ only. If running older version, restrict
-- in the app layer instead (only fetch safe columns from profiles).
--
-- For Postgres <16, use this approach in your app code:
--   select id, username, full_name, avatar_url, bio
--   from profiles
--   where ...
--
-- Avoid selecting: stripe_customer_id, subscription_tier,
-- subscription_expires_at, is_admin, is_business_owner,
-- children_ages, marketing_consent, terms_accepted_at
--
-- If using Postgres 16+, uncomment below:
--
-- alter table public.profiles
--   alter column stripe_customer_id set masking using ('***');
-- alter table public.profiles
--   alter column subscription_tier set masking using ('***');
-- alter table public.profiles
--   alter column is_admin set masking using (false);
-- alter table public.profiles
--   alter column is_business_owner set masking using (false);

-- ============================================================
-- VERIFICATION CHECKLIST
-- ============================================================
-- Run these queries to verify all fixes applied:
--
-- 1. Check moderation enforcement:
--    select pg_get_policy_def(oid) from pg_policies
--    where tablename = 'venues' and policyname = 'Authenticated users can submit venues';
--    -- Should include: moderation_status = 'pending' and is_published = false
--
-- 2. Check audit log exists:
--    select tablename from pg_tables where tablename = 'gdpr_audit_log';
--    -- Should return 'gdpr_audit_log'
--
-- 3. Check consent log exists:
--    select tablename from pg_tables where tablename = 'location_consent_log';
--    -- Should return 'location_consent_log'
--
-- 4. Check search_path on is_admin:
--    select prosecdef, proconfig from pg_proc where proname = 'is_admin';
--    -- prosecdef should be true, proconfig should include search_path
--
-- 5. Check children_ages type:
--    select column_name, data_type from information_schema.columns
--    where table_name = 'profiles' and column_name = 'children_ages';
--    -- Should show: data_type = text (array)
--
-- 6. Check all indexes created:
--    select indexname from pg_indexes
--    where tablename in ('reviews', 'favourites', 'profiles', 'business_subscriptions')
--    order by indexname;

