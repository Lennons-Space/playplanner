create table public.pass_interest (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  source     text default 'profile_menu',
  created_at timestamptz default now(),
  -- Prevent duplicate registrations for the same email address.
  -- ON CONFLICT DO NOTHING in the client means repeat taps are silently ignored
  -- and the user still sees the success state, so UX is not degraded.
  constraint pass_interest_email_unique unique (email)
);
alter table public.pass_interest enable row level security;
create policy "Anyone can register interest"
  on public.pass_interest for insert with check (true);
