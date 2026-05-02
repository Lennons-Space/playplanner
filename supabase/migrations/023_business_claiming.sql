-- Business claiming flow.
-- Allows venue owners to claim a venue via phone verification + admin review.

-- Add claimed_by to venues
alter table venues
  add column if not exists claimed_by uuid references profiles(id) on delete set null;

create index if not exists venues_claimed_by_idx on venues(claimed_by) where claimed_by is not null;

-- OTP attempts tracking table (temp store, no PII in logs)
create table if not exists otp_attempts (
  id           uuid primary key default uuid_generate_v4(),
  phone_hash   text not null,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  verified     boolean not null default false,
  token        text,
  created_at   timestamptz default now()
);

alter table otp_attempts enable row level security;
-- No user-facing RLS — only accessed via service_role in edge functions

-- Venue claims table
create table if not exists venue_claims (
  id                   uuid primary key default uuid_generate_v4(),
  venue_id             uuid not null references venues(id) on delete cascade,
  user_id              uuid not null references profiles(id) on delete cascade,
  verified_phone       text not null,
  verified_phone_token text not null,
  status               text not null default 'pending'
                         check (status in ('pending', 'approved', 'rejected')),
  notes                text,
  admin_notes          text,
  reviewed_at          timestamptz,
  reviewed_by          uuid references profiles(id) on delete set null,
  created_at           timestamptz default now()
);

alter table venue_claims enable row level security;

-- One active claim per venue (pending or approved)
create unique index if not exists venue_claims_active_unique
  on venue_claims(venue_id)
  where status in ('pending', 'approved');

create index if not exists venue_claims_status_idx on venue_claims(status);
create index if not exists venue_claims_user_idx on venue_claims(user_id);

-- RLS: claimants can insert and read their own claims
create policy "Users can insert own claims" on venue_claims
  for insert with check (auth.uid() = user_id);

create policy "Users can view own claims" on venue_claims
  for select using (auth.uid() = user_id);

-- RLS: admins can read and update all claims
create policy "Admins can view all claims" on venue_claims
  for select using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "Admins can update claims" on venue_claims
  for update using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
