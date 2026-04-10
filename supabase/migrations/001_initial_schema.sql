-- ============================================================
-- Play Planner — Initial Database Schema
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "postgis";  -- for location-based queries

-- ============================================================
-- LOOKUP TABLES
-- ============================================================

create table categories (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  slug       text not null unique,
  icon       text not null,          -- emoji or icon name
  color      text not null,          -- hex colour for map pins
  created_at timestamptz default now()
);

create table facilities (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  slug       text not null unique,
  icon       text not null,
  created_at timestamptz default now()
);

-- ============================================================
-- PROFILES (one row per Supabase auth user)
-- ============================================================

create table profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  username              text unique,
  full_name             text,
  avatar_url            text,
  bio                   text,
  is_business_owner     boolean default false,
  is_admin              boolean default false,
  -- User subscription
  subscription_tier     text default 'free' check (subscription_tier in ('free', 'premium')),
  subscription_expires_at timestamptz,
  stripe_customer_id    text unique,
  -- Children info (optional, for personalisation — stored only when user explicitly provides it)
  -- ICO Children's Code data minimisation: store age RANGES only, never exact ages
  -- e.g. ['0-2', '3-5', '6-8'] not [2, 5, 7]
  children_ages         text[],
  -- GDPR consent
  -- IMPORTANT: marketing_consent defaults to false (opt-in only, never opt-out)
  marketing_consent     boolean default false,
  -- terms_accepted_at is set by the app only when the user explicitly ticks "I accept"
  -- It is NOT auto-set on signup — doing so would be invalid consent under UK/EU GDPR
  terms_accepted_at     timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ============================================================
-- VENUES
-- ============================================================

create table venues (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  slug            text unique,
  description     text,
  category_id     uuid references categories(id),

  -- Address
  address_line1   text,
  address_line2   text,
  city            text not null,
  postcode        text not null,
  country         text default 'GB',

  -- Geospatial (PostGIS)
  latitude        decimal(9,6) not null,
  longitude       decimal(9,6) not null,
  location        geography(Point, 4326),  -- auto-set by trigger below

  -- Contact
  phone           text,
  email           text,
  website         text,

  -- Details
  price_range     text check (price_range in ('free', 'budget', 'moderate', 'premium')),
  min_age         int default 0 check (min_age >= 0),
  max_age         int default 12 check (max_age <= 18),
  constraint valid_age_range check (min_age <= max_age),

  -- Status & moderation
  is_published        boolean default false,
  is_verified         boolean default false,
  claimed_by          uuid references profiles(id),
  submitted_by        uuid references profiles(id),
  moderation_status   text default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  moderation_notes    text,
  moderated_by        uuid references profiles(id),
  moderated_at        timestamptz,

  -- Premium listing
  is_premium          boolean default false,
  featured_until      timestamptz,

  -- Cached aggregates (updated by trigger)
  review_count        int default 0,
  average_rating      decimal(3,2) default 0,

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Spatial index for fast "nearby" queries
create index venues_location_idx on venues using gist(location);
create index venues_city_idx on venues(city);
create index venues_moderation_idx on venues(moderation_status, is_published);

-- ============================================================
-- OPENING HOURS
-- ============================================================

create table opening_hours (
  id           uuid primary key default uuid_generate_v4(),
  venue_id     uuid references venues(id) on delete cascade,
  day_of_week  int not null check (day_of_week between 0 and 6),  -- 0=Sun, 6=Sat
  opens_at     time,
  closes_at    time,
  is_closed    boolean default false,
  notes        text,
  unique(venue_id, day_of_week)
);

-- ============================================================
-- VENUE PHOTOS
-- ============================================================

create table venue_photos (
  id           uuid primary key default uuid_generate_v4(),
  venue_id     uuid references venues(id) on delete cascade,
  uploaded_by  uuid references profiles(id),
  storage_path text not null,       -- path in Supabase Storage bucket
  url          text not null,       -- public URL
  is_cover     boolean default false,
  -- SAFETY: Photos must be moderated before going live.
  -- Defaulting to false means every uploaded photo sits in a queue
  -- until an admin approves it. This prevents harmful content
  -- appearing on the app automatically.
  is_approved  boolean default false,
  caption      text,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

-- ============================================================
-- VENUE FACILITIES (many-to-many)
-- ============================================================

create table venue_facilities (
  venue_id    uuid references venues(id) on delete cascade,
  facility_id uuid references facilities(id) on delete cascade,
  notes       text,
  primary key (venue_id, facility_id)
);

-- ============================================================
-- REVIEWS
-- ============================================================

create table reviews (
  id                uuid primary key default uuid_generate_v4(),
  venue_id          uuid references venues(id) on delete cascade,
  user_id           uuid references profiles(id) on delete cascade,
  rating            int not null check (rating between 1 and 5),
  title             text,
  body              text not null,
  visit_date        date,
  children_ages     text[],          -- e.g. ['0-2', '3-5'] age groups visited

  -- Moderation
  -- SAFETY: Reviews default to 'pending', not 'approved'.
  -- Every review must be checked before it goes live on the app.
  -- This prevents fake reviews, spam, and harmful content appearing automatically.
  moderation_status text default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  flagged_count     int default 0,

  -- Engagement
  helpful_count     int default 0,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  unique(venue_id, user_id)  -- one review per user per venue
);

create index reviews_venue_idx on reviews(venue_id, moderation_status);

create table review_photos (
  id           uuid primary key default uuid_generate_v4(),
  review_id    uuid references reviews(id) on delete cascade,
  storage_path text not null,
  url          text not null,
  created_at   timestamptz default now()
);

create table review_helpful (
  review_id  uuid references reviews(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  primary key (review_id, user_id)
);

create table review_flags (
  id          uuid primary key default uuid_generate_v4(),
  review_id   uuid references reviews(id) on delete cascade,
  reported_by uuid references profiles(id),
  reason      text not null,
  created_at  timestamptz default now(),
  unique(review_id, reported_by)
);

-- ============================================================
-- FAVOURITES
-- ============================================================

create table favourites (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references profiles(id) on delete cascade,
  venue_id   uuid references venues(id) on delete cascade,
  list_name  text default 'My Favourites',
  created_at timestamptz default now(),
  unique(user_id, venue_id)
);

-- ============================================================
-- BUSINESS SUBSCRIPTIONS
-- ============================================================

create table business_subscriptions (
  id                      uuid primary key default uuid_generate_v4(),
  profile_id              uuid references profiles(id) on delete cascade,
  venue_id                uuid references venues(id) on delete cascade,
  stripe_subscription_id  text unique,
  stripe_customer_id      text,
  plan                    text not null check (plan in ('basic', 'pro', 'enterprise')),
  status                  text not null check (status in ('active', 'cancelled', 'past_due', 'trialing')),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ============================================================
-- VENUE OFFERS / PROMOTIONS (premium business feature)
-- ============================================================

create table venue_offers (
  id           uuid primary key default uuid_generate_v4(),
  venue_id     uuid references venues(id) on delete cascade,
  title        text not null,
  description  text,
  discount_text text,
  valid_from   timestamptz,
  valid_until  timestamptz,
  is_active    boolean default true,
  created_at   timestamptz default now()
);

-- ============================================================
-- VENUE ANALYTICS (premium business dashboard)
-- ============================================================

create table venue_analytics (
  id                uuid primary key default uuid_generate_v4(),
  venue_id          uuid references venues(id) on delete cascade,
  date              date not null,
  views             int default 0,
  favourites_added  int default 0,
  website_clicks    int default 0,
  direction_clicks  int default 0,
  unique(venue_id, date)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- 1. Auto-set PostGIS location point from lat/lng
create or replace function set_venue_location()
returns trigger as $$
begin
  new.location = st_point(new.longitude, new.latitude)::geography;
  return new;
end;
$$ language plpgsql;

create trigger venue_location_trigger
before insert or update of latitude, longitude on venues
for each row execute function set_venue_location();

-- 2. Keep review_count and average_rating up to date on venues
--    Only counts reviews that have been approved by a moderator.
create or replace function update_venue_rating()
returns trigger as $$
begin
  update venues
  set
    review_count   = (select count(*) from reviews where venue_id = coalesce(new.venue_id, old.venue_id) and moderation_status = 'approved'),
    average_rating = (select coalesce(avg(rating), 0) from reviews where venue_id = coalesce(new.venue_id, old.venue_id) and moderation_status = 'approved'),
    updated_at     = now()
  where id = coalesce(new.venue_id, old.venue_id);
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger review_rating_trigger
after insert or update or delete on reviews
for each row execute function update_venue_rating();

-- 3. Auto-update updated_at timestamps
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at             before update on profiles              for each row execute function touch_updated_at();
create trigger venues_updated_at               before update on venues                for each row execute function touch_updated_at();
create trigger reviews_updated_at              before update on reviews               for each row execute function touch_updated_at();
create trigger business_subscriptions_updated_at before update on business_subscriptions for each row execute function touch_updated_at();

-- 4. Auto-create profile row when a new user signs up
--    GDPR NOTE: We do NOT auto-set terms_accepted_at here.
--    That field is only written by the app when the user explicitly
--    ticks "I accept the terms" during registration. Auto-setting it
--    would record invalid consent under UK GDPR Article 7 / EU GDPR
--    Article 7 (consent must be freely given, specific, informed, and
--    unambiguous — a hidden server-side timestamp does not satisfy this).
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer
   set search_path = public, auth;
-- search_path is locked to prevent SQL injection via schema manipulation.
-- Without this, a malicious user could create a fake 'profiles' table in
-- another schema and trick this function into writing data there instead.

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
-- RLS is Supabase's main data-privacy protection layer.
-- It means each user can only see and edit exactly what they are
-- allowed to. Without it, any logged-in user could read everyone
-- else's data. Every table must have it enabled.

alter table categories            enable row level security;
alter table facilities            enable row level security;
alter table profiles              enable row level security;
alter table venues                enable row level security;
alter table opening_hours         enable row level security;
alter table venue_photos          enable row level security;
alter table venue_facilities      enable row level security;
alter table reviews               enable row level security;
alter table review_photos         enable row level security;
alter table review_helpful        enable row level security;
alter table review_flags          enable row level security;
alter table favourites            enable row level security;
alter table business_subscriptions enable row level security;
alter table venue_offers          enable row level security;
alter table venue_analytics       enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Helper function: returns true if the current user is an admin.
-- Used in policies below to allow admins to access records they need
-- to moderate. Without this, admins would be blocked by the same
-- rules as regular users.
create or replace function is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from profiles where id = auth.uid()),
    false
  );
$$ language sql security definer stable
   set search_path = public;

-- -----------------------------------------------
-- CATEGORIES & FACILITIES (public read-only lookups)
-- -----------------------------------------------

-- Everyone (including unauthenticated users browsing the app) can
-- read categories and facilities. No one can edit them from the app —
-- that is done directly in the Supabase dashboard by the admin.
create policy "Categories are publicly readable"  on categories  for select using (true);
create policy "Facilities are publicly readable"  on facilities  for select using (true);

-- -----------------------------------------------
-- PROFILES
-- -----------------------------------------------

-- Any authenticated user can read public profile data (username,
-- avatar). This is needed so venue submitters and reviewers can
-- be shown on venue pages.
create policy "Profiles are viewable by authenticated users" on profiles
  for select using (auth.uid() is not null);

-- Users can only update their own profile row.
create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);

-- Users can delete their own profile (right to erasure / GDPR Art.17).
-- The cascade on profiles → auth.users means deleting the profile
-- also deletes the auth account.
create policy "Users can delete own profile" on profiles
  for delete using (auth.uid() = id);

-- -----------------------------------------------
-- VENUES
-- -----------------------------------------------

-- Published, approved venues are visible to everyone including
-- unauthenticated users (so the map works before login).
create policy "Approved venues are public" on venues
  for select using (is_published = true and moderation_status = 'approved');

-- Logged-in users can see their own submitted or claimed venues even
-- if they haven't been approved yet (so they can track their submission).
create policy "Owners can view own venues" on venues
  for select using (auth.uid() = submitted_by or auth.uid() = claimed_by);

-- Admins can see all venues (needed for the moderation screen).
create policy "Admins can view all venues" on venues
  for select using (is_admin());

-- Any authenticated user can submit a new venue.
-- The WITH CHECK clause enforces that new venues MUST arrive as pending
-- and unpublished. This prevents a user from bypassing moderation by
-- directly calling the API with moderation_status='approved'.
create policy "Authenticated users can submit venues" on venues
  for insert with check (
    auth.uid() = submitted_by
    and moderation_status = 'pending'
    and is_published = false
    and is_verified = false
  );

-- Only the business owner who has claimed the venue can update it.
create policy "Owners can update claimed venue" on venues
  for update using (auth.uid() = claimed_by);

-- Admins can update any venue (to approve, reject, or edit).
create policy "Admins can update any venue" on venues
  for update using (is_admin());

-- -----------------------------------------------
-- OPENING HOURS
-- -----------------------------------------------

-- Opening hours are public for approved, published venues.
create policy "Opening hours are public for approved venues" on opening_hours
  for select using (
    exists (
      select 1 from venues
      where venues.id = opening_hours.venue_id
        and venues.is_published = true
        and venues.moderation_status = 'approved'
    )
  );

-- Venue owners can manage their own opening hours.
create policy "Owners can manage opening hours" on opening_hours
  for all using (
    exists (
      select 1 from venues
      where venues.id = opening_hours.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- Admins can manage all opening hours.
create policy "Admins can manage all opening hours" on opening_hours
  for all using (is_admin());

-- -----------------------------------------------
-- VENUE PHOTOS
-- -----------------------------------------------

-- Only approved photos on approved venues are visible publicly.
-- is_approved defaults to false, so photos sit in a queue
-- until an admin marks them as approved.
create policy "Approved photos are public" on venue_photos
  for select using (
    is_approved = true
    and exists (
      select 1 from venues
      where venues.id = venue_photos.venue_id
        and venues.is_published = true
        and venues.moderation_status = 'approved'
    )
  );

-- Authenticated users can upload photos.
-- is_approved must be false on insert — photos are never auto-approved.
create policy "Authenticated users can upload photos" on venue_photos
  for insert with check (
    auth.uid() = uploaded_by
    and is_approved = false
  );

-- Users can delete their own uploaded photos.
create policy "Users can delete own photos" on venue_photos
  for delete using (auth.uid() = uploaded_by);

-- Admins can manage all photos (approve, delete).
create policy "Admins can manage all photos" on venue_photos
  for all using (is_admin());

-- -----------------------------------------------
-- VENUE FACILITIES
-- -----------------------------------------------

-- Facilities tags are public for approved venues.
create policy "Venue facilities are public for approved venues" on venue_facilities
  for select using (
    exists (
      select 1 from venues
      where venues.id = venue_facilities.venue_id
        and venues.is_published = true
        and venues.moderation_status = 'approved'
    )
  );

-- Owners can manage facilities on their claimed venue.
create policy "Owners can manage own venue facilities" on venue_facilities
  for all using (
    exists (
      select 1 from venues
      where venues.id = venue_facilities.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- -----------------------------------------------
-- REVIEWS
-- -----------------------------------------------

-- Only approved reviews are publicly visible.
-- moderation_status defaults to 'pending', so reviews are invisible
-- until a moderator approves them. This prevents fake or harmful
-- reviews appearing automatically.
create policy "Approved reviews are public" on reviews
  for select using (moderation_status = 'approved');

-- Users can see their own reviews regardless of moderation status
-- (so they know their review was submitted and can track its status).
create policy "Users can view own reviews" on reviews
  for select using (auth.uid() = user_id);

-- Admins can see all reviews (needed for the moderation queue).
create policy "Admins can view all reviews" on reviews
  for select using (is_admin());

-- Any authenticated user can write a review.
-- Enforces moderation_status = 'pending' so no review can go live
-- automatically — even if the API is called directly without the app.
create policy "Users can write reviews" on reviews
  for insert with check (
    auth.uid() = user_id
    and moderation_status = 'pending'
  );

-- Users can edit their own reviews (only their own, never others).
create policy "Users can edit own reviews" on reviews
  for update using (auth.uid() = user_id);

-- Admins can update any review (to approve, reject, or remove flags).
create policy "Admins can update any review" on reviews
  for update using (is_admin());

-- Users can delete their own review (right to erasure).
create policy "Users can delete own reviews" on reviews
  for delete using (auth.uid() = user_id);

-- -----------------------------------------------
-- REVIEW PHOTOS
-- -----------------------------------------------

-- Review photos are visible when their parent review is approved.
create policy "Review photos visible for approved reviews" on review_photos
  for select using (
    exists (
      select 1 from reviews
      where reviews.id = review_photos.review_id
        and reviews.moderation_status = 'approved'
    )
  );

-- Review owners can attach photos to their own reviews.
create policy "Users can add photos to own reviews" on review_photos
  for insert with check (
    exists (
      select 1 from reviews
      where reviews.id = review_photos.review_id
        and reviews.user_id = auth.uid()
    )
  );

-- Users can delete their own review photos.
create policy "Users can delete own review photos" on review_photos
  for delete using (
    exists (
      select 1 from reviews
      where reviews.id = review_photos.review_id
        and reviews.user_id = auth.uid()
    )
  );

-- Admins can manage all review photos.
create policy "Admins can manage review photos" on review_photos
  for all using (is_admin());

-- -----------------------------------------------
-- REVIEW HELPFUL VOTES
-- -----------------------------------------------

-- Anyone can see helpful vote counts on approved reviews.
create policy "Helpful votes visible on approved reviews" on review_helpful
  for select using (
    exists (
      select 1 from reviews
      where reviews.id = review_helpful.review_id
        and reviews.moderation_status = 'approved'
    )
  );

-- Authenticated users can mark a review as helpful.
create policy "Authenticated users can vote helpful" on review_helpful
  for insert with check (auth.uid() = user_id);

-- Users can remove their own helpful vote.
create policy "Users can remove own helpful vote" on review_helpful
  for delete using (auth.uid() = user_id);

-- -----------------------------------------------
-- REVIEW FLAGS (abuse reports)
-- -----------------------------------------------

-- Only admins can see who reported what (protects reporter identity).
create policy "Admins can view all flags" on review_flags
  for select using (is_admin());

-- Any authenticated user can report a review.
create policy "Authenticated users can flag reviews" on review_flags
  for insert with check (auth.uid() = reported_by);

-- -----------------------------------------------
-- FAVOURITES
-- -----------------------------------------------

-- Favourites are completely private — only the owner can see them.
create policy "Users see own favourites"    on favourites for select using (auth.uid() = user_id);
create policy "Users add own favourites"    on favourites for insert with check (auth.uid() = user_id);
create policy "Users remove own favourites" on favourites for delete using (auth.uid() = user_id);

-- -----------------------------------------------
-- BUSINESS SUBSCRIPTIONS
-- -----------------------------------------------

-- Subscription records are private to the account owner.
create policy "Users see own subscriptions" on business_subscriptions
  for select using (auth.uid() = profile_id);

-- Admins can view all subscriptions (for support and billing queries).
create policy "Admins can view all subscriptions" on business_subscriptions
  for select using (is_admin());

-- -----------------------------------------------
-- VENUE OFFERS
-- -----------------------------------------------

-- Active offers on approved venues are publicly visible.
create policy "Active offers on approved venues are public" on venue_offers
  for select using (
    is_active = true
    and exists (
      select 1 from venues
      where venues.id = venue_offers.venue_id
        and venues.is_published = true
        and venues.moderation_status = 'approved'
    )
  );

-- Venue owners can manage offers on their own claimed venue.
create policy "Owners can manage own venue offers" on venue_offers
  for all using (
    exists (
      select 1 from venues
      where venues.id = venue_offers.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- -----------------------------------------------
-- VENUE ANALYTICS
-- -----------------------------------------------

-- Only the venue owner can see analytics for their venue.
create policy "Owners see own analytics" on venue_analytics
  for select using (
    exists (
      select 1 from venues
      where venues.id = venue_analytics.venue_id
        and venues.claimed_by = auth.uid()
    )
  );

-- Admins can see all analytics.
create policy "Admins can see all analytics" on venue_analytics
  for select using (is_admin());

-- Analytics rows are written by Edge Functions using service_role key,
-- which bypasses RLS. No direct insert policy needed for app users.

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

-- These speed up the most common lookups. Without them, queries
-- that load a user's reviews, favourites, or profile by username
-- would slow down as the database grows.
create index reviews_user_idx      on reviews(user_id);
create index favourites_user_idx   on favourites(user_id);
create index profiles_username_idx on profiles(username);
create index business_subs_profile_idx on business_subscriptions(profile_id);

-- ============================================================
-- GDPR COMPLIANCE TABLES
-- ============================================================

-- Location Consent Log
-- Required by GDPR Article 7 and ICO Children's Code Standard 10.
-- Every time a user gives or withdraws consent for location access,
-- a record is written here. This proves consent was valid if the ICO
-- ever asks. The app must write to this table on the consent screen.
-- ip_hash is a one-way hash of the IP — never the raw IP address.
create table location_consent_log (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid references profiles(id) on delete cascade,
  consented_at         timestamptz,
  consent_withdrawn_at timestamptz,
  consent_version      text not null,   -- e.g. 'v1.0' — update when wording changes
  ip_hash              text,            -- SHA-256 of IP, never raw IP (GDPR data minimisation)
  created_at           timestamptz default now()
);

alter table location_consent_log enable row level security;

-- Users can read and manage their own consent records.
create policy "Users can view own location consent" on location_consent_log
  for select using (auth.uid() = user_id);

create policy "Users can log own consent" on location_consent_log
  for insert with check (auth.uid() = user_id);

create policy "Users can update own consent" on location_consent_log
  for update using (auth.uid() = user_id);

-- Admins can view all consent logs for compliance auditing.
create policy "Admins can view all consent logs" on location_consent_log
  for select using (is_admin());

-- GDPR Audit Log
-- Required by GDPR Article 5(2) — the accountability principle.
-- Logs sensitive operations: data exports, deletions, consent changes.
-- This is your evidence trail if the ICO investigates.
create table gdpr_audit_log (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references profiles(id) on delete set null,
  action       text not null,      -- e.g. 'data_export', 'data_deletion', 'consent_given'
  table_name   text,               -- which table was affected
  record_id    uuid,               -- which record was affected
  performed_by uuid references profiles(id) on delete set null,
  created_at   timestamptz default now()
);

alter table gdpr_audit_log enable row level security;

-- Users can see their own audit history (transparency, GDPR Art.15).
create policy "Users can view own audit log" on gdpr_audit_log
  for select using (auth.uid() = user_id);

-- Only admins and the system (service_role) can write audit entries.
-- The app should write these via an Edge Function, never directly.
create policy "Admins can view all audit logs" on gdpr_audit_log
  for select using (is_admin());

-- ============================================================
-- COLUMN SECURITY NOTES
-- ============================================================
-- RLS in Postgres restricts ROWS, not COLUMNS. The policies above
-- control who can read which profile rows, but a user who can read
-- a row can read ALL its columns (including stripe_customer_id,
-- is_admin, subscription_tier, children_ages).
--
-- REQUIRED APP-LEVEL ENFORCEMENT:
-- When querying other users' profiles, ONLY select safe columns:
--   id, username, full_name, avatar_url, bio, is_business_owner
-- NEVER select: stripe_customer_id, is_admin, subscription_tier,
--   subscription_expires_at, children_ages, marketing_consent,
--   terms_accepted_at for any user other than auth.uid().
--
-- Consider creating a public_profiles VIEW for this purpose
-- once the app is in a later development phase.
