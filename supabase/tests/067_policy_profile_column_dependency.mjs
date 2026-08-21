// =============================================================================
// supabase/tests/067_policy_profile_column_dependency.mjs
//
// Behavioural database tests for:
//   067_fix_policies_reading_profile_columns.sql
//
// WHAT THIS PROVES
// ----------------
// PART 0  REPRODUCTION. With 062 + 064 + 065 + 066 applied (production's exact
//         state) and the REAL migration-021 policy on public.reviews, EVERY
//         SELECT against reviews fails for the authenticated role. This is the
//         live failure reported from a real Android device on 2026-08-20:
//           * Download My Data      -> "Something went wrong preparing your data"
//           * My Reviews            -> "Could not load your reviews"
//           * Admin pending reviews -> error toast
//         The same reproduction covers venue_claims and storage.objects.
//
// PART 1  067 repairs all of it.
// PART 2  ROW SEMANTICS are preserved exactly as migration 021 defined them --
//         including the two cases a careless fix gets wrong:
//           (a) an author with show_in_search = false must NOT lose review
//               visibility (show_in_search must not start governing reviews);
//           (b) an anonymous caller must STILL see nothing (routing the lookup
//               through SECURITY DEFINER must not start publishing review
//               bodies to logged-out users).
// PART 3  THE 065/066 BOUNDARY IS UNCHANGED. 067 restores no table-level
//         SELECT, no anon privilege, and no sensitive column, and leaves 062's
//         UPDATE column grants intact.
// PART 4  The four real client query shapes, modelled as the SQL PostgREST
//         compiles them to.
//
// FIDELITY NOTES (disclosed):
//   * Migrations 062/064/065/066/067 are applied from their REAL files, never
//     paraphrased.
//   * The pre-065 baseline policies are transcribed from 001/009/021/023/031
//     and the profiles policy set verified read-only against production on
//     2026-08-18.
//   * PostgREST is absent; its resource embedding is modelled as the equivalent
//     SQL join it compiles to.
//   * storage.objects is modelled as a minimal table so 067 can be applied
//     verbatim; Supabase's real storage schema has more columns, none of which
//     the policy under test reads.
//
// NOTE ON WHY THIS FILE EXISTS AT ALL: the 065 test suite stubbed public.reviews
// with `create policy "reviews readable" ... using (true)`. That stub is what
// hid this defect -- the fixture asserted the assumption instead of testing it.
// Every policy this file depends on is transcribed from the real migration.
//
// Run:  node supabase/tests/067_policy_profile_column_dependency.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readMigration = (f) => readFileSync(join(__dirname, '../migrations/', f), 'utf8');

const MIGRATION_062 = readMigration('062_fix_profile_privilege_escalation.sql');
const MIGRATION_064 = readMigration('064_add_profile_self_read_rpcs.sql');
const MIGRATION_065 = readMigration('065_restrict_profile_read_exposure.sql');
const MIGRATION_066 = readMigration('066_restrict_public_profiles_privileges.sql');
const MIGRATION_067 = readMigration('067_fix_policies_reading_profile_columns.sql');

const ADMIN  = '00000000-0000-0000-0000-00000000000a';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // in search,     reviews public
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // NOT in search, reviews public
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // in search,     reviews PRIVATE

const VENUE  = '11111111-1111-1111-1111-111111111111';

const REVIEW_A = 'a1111111-1111-1111-1111-111111111111'; // approved, author A
const REVIEW_B = 'b1111111-1111-1111-1111-111111111111'; // approved, author B
const REVIEW_C = 'c1111111-1111-1111-1111-111111111111'; // approved, author C
const REVIEW_P = 'd1111111-1111-1111-1111-111111111111'; // pending,  author A

const SENSITIVE = [
  'children_ages', 'postcode', 'marketing_consent', 'terms_accepted_at',
  'stripe_customer_id', 'subscription_tier', 'subscription_expires_at', 'is_admin',
];

// -----------------------------------------------------------------------------
// Bootstrap -- the pre-065 production baseline.
// -----------------------------------------------------------------------------
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  grant usage on schema auth to anon, authenticated, service_role;

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  -- 001:37-62 + 004:19-22
  create table public.profiles (
    id                      uuid primary key references auth.users(id) on delete cascade,
    username                text unique,
    full_name               text,
    avatar_url              text,
    bio                     text,
    is_business_owner       boolean default false,
    is_admin                boolean default false,
    subscription_tier       text default 'free' check (subscription_tier in ('free','premium')),
    subscription_expires_at timestamptz,
    stripe_customer_id      text unique,
    children_ages           text[],
    marketing_consent       boolean default false,
    terms_accepted_at       timestamptz,
    created_at              timestamptz default now(),
    updated_at              timestamptz default now(),
    postcode                text,
    show_in_search          boolean not null default false,
    show_reviews_publicly   boolean not null default true
  );
  alter table public.profiles enable row level security;
  grant select, insert, update, delete on public.profiles to anon, authenticated, service_role;

  -- 001:396-403
  create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
  $$;
  -- 048:39
  grant execute on function public.is_admin() to anon, authenticated;

  create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
  create trigger profiles_updated_at before update on public.profiles
    for each row execute function public.touch_updated_at();

  -- ===== venues (minimal) =====
  create table public.venues (
    id uuid primary key,
    name text,
    city text,
    claimed_by uuid,
    submitted_by uuid,
    moderation_status text default 'approved'
  );
  alter table public.venues enable row level security;
  grant select, insert, update, delete on public.venues to anon, authenticated, service_role;
  create policy "Approved venues are public" on public.venues
    for select using (moderation_status = 'approved' or public.is_admin());

  -- ===== reviews (001:520-600 column set, trimmed to what the app selects) =====
  create table public.reviews (
    id                uuid primary key,
    venue_id          uuid references public.venues(id) on delete cascade,
    user_id           uuid references public.profiles(id) on delete cascade,
    rating            int,
    title             text,
    body              text,
    is_anonymous      boolean default false,
    visit_date        date,
    children_ages     text[],
    moderation_status text default 'pending',
    moderation_notes  text,
    helpful_count     int default 0,
    created_at        timestamptz default now(),
    updated_at        timestamptz default now()
  );
  alter table public.reviews enable row level security;
  grant select, insert, update, delete on public.reviews to anon, authenticated, service_role;

  -- 001:574-600 -- untouched by 021 and untouched by 067
  create policy "Users can view own reviews" on public.reviews
    for select using (auth.uid() = user_id);
  create policy "Admins can view all reviews" on public.reviews
    for select using (public.is_admin());
  create policy "Users can edit own reviews" on public.reviews
    for update using (auth.uid() = user_id);
  create policy "Users can delete own reviews" on public.reviews
    for delete using (auth.uid() = user_id);

  -- ===== 021_enforce_show_reviews_publicly.sql -- VERBATIM. THE DEFECT. =====
  create policy "Approved reviews are public"
    on public.reviews for select
    using (
      moderation_status = 'approved'
      and (
        exists (
          select 1 from public.profiles p
          where p.id = reviews.user_id
            and p.show_reviews_publicly = true
        )
        or auth.uid() = user_id
        or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
      )
    );

  -- ===== 023_business_claiming.sql -- venue_claims + its admin policies =====
  create table public.venue_claims (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references public.venues(id) on delete cascade,
    user_id  uuid references public.profiles(id) on delete cascade,
    verified_phone text,
    status text default 'pending',
    notes text,
    admin_notes text,
    created_at timestamptz default now()
  );
  alter table public.venue_claims enable row level security;
  grant select, insert, update, delete on public.venue_claims to anon, authenticated, service_role;

  create policy "Users can view own claims" on public.venue_claims
    for select using (auth.uid() = user_id);
  create policy "Admins can view all claims" on public.venue_claims
    for select using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
  create policy "Admins can update claims" on public.venue_claims
    for update using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

  -- ===== venue_photos (007/008, minimal) =====
  create table public.venue_photos (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references public.venues(id) on delete cascade,
    storage_path text,
    uploaded_by uuid,
    status text default 'pending'
  );
  alter table public.venue_photos enable row level security;
  grant select, insert, update, delete on public.venue_photos to anon, authenticated, service_role;
  create policy "Approved venue photos are public" on public.venue_photos
    for select using (status = 'approved' or uploaded_by = auth.uid() or public.is_admin());

  -- ===== storage.objects (minimal) + the REAL 008 SELECT policies and
  --       031's admin DELETE policy.
  --
  --       The SELECT policies matter: PostgreSQL applies SELECT policies to a
  --       DELETE that carries a WHERE clause, because it must read the row to
  --       match it. Omitting them makes every delete match zero rows and the
  --       DELETE tests pass for the wrong reason. =====
  create schema if not exists storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;

  -- 008:91-136
  create policy "Approved venue photos readable" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'venue-photos'
      and exists (
        select 1 from public.venue_photos
        where venue_photos.storage_path = storage.objects.name
          and venue_photos.status = 'approved'
      )
    );
  create policy "Users can read own venue photos" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'venue-photos'
      and exists (
        select 1 from public.venue_photos
        where venue_photos.storage_path = storage.objects.name
          and venue_photos.uploaded_by = auth.uid()
      )
    );
  create policy "Admins can read all venue photos" on storage.objects
    for select to authenticated
    using (bucket_id = 'venue-photos' and public.is_admin());

  -- 031:29-40 -- owner delete path, no profiles reference, untouched by 067
  create policy "Users can delete own venue photos" on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'venue-photos'
      and exists (
        select 1 from public.venue_photos
        where venue_photos.storage_path = storage.objects.name
          and venue_photos.uploaded_by = auth.uid()
      )
    );

  -- 031:44-51 -- THE DEFECT: inline is_admin read
  create policy "Admins can delete any venue photo from storage"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'venue-photos'
      and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
    );

  -- ===== THE LIVE PROFILES POLICY SET (verified against production 2026-08-18) =====
  create policy "Profiles are viewable by authenticated users" on public.profiles
    for select using (auth.uid() is not null);
  create policy "Users can update own profile" on public.profiles
    for update using (auth.uid() = id);
  create policy "Users can delete own profile" on public.profiles
    for delete using (auth.uid() = id);

  -- 024:40-54
  create view public.public_profiles
    with (security_invoker = true, security_barrier = true)
  as
    select id, username, full_name, avatar_url, bio,
           is_business_owner, show_reviews_publicly, created_at
      from public.profiles
     where show_in_search = true;
  grant select on public.public_profiles to authenticated;
  revoke all on public.public_profiles from anon;

  -- ===== seed =====
  insert into auth.users (id, email) values
    ('${ADMIN}','admin@test'), ('${USER_A}','a@test'),
    ('${USER_B}','b@test'),    ('${USER_C}','c@test');

  insert into public.profiles (id, username, full_name, is_admin, show_in_search,
                               show_reviews_publicly, children_ages, postcode,
                               stripe_customer_id, marketing_consent, terms_accepted_at,
                               subscription_tier)
  values
    ('${ADMIN}',  'admin','Ada Admin', true,  false, true,  null,          null,       null,        false, now(), 'free'),
    ('${USER_A}', 'alice','Alice A',   false, true,  true,  array['0-2'],  'SY13 1NX', 'cus_ALICE', true,  now(), 'premium'),
    ('${USER_B}', 'bob',  'Bob B',     false, false, true,  array['6-8'],  'SW1A 1AA', 'cus_BOB',   false, now(), 'free'),
    ('${USER_C}', 'cara', 'Cara C',    false, true,  false, array['3-5'],  'M1 1AA',   'cus_CARA',  false, now(), 'free');

  insert into public.venues (id, name, city) values ('${VENUE}', 'Sunny Soft Play', 'Whitchurch');

  insert into public.reviews (id, venue_id, user_id, rating, title, body, moderation_status)
  values
    ('${REVIEW_A}','${VENUE}','${USER_A}',5,'Great','Lovely place','approved'),
    ('${REVIEW_B}','${VENUE}','${USER_B}',4,'Good','Nice and clean','approved'),
    ('${REVIEW_C}','${VENUE}','${USER_C}',3,'Okay','It was fine','approved'),
    ('${REVIEW_P}','${VENUE}','${USER_A}',2,'Pending','Not yet moderated','pending');

  insert into public.venue_claims (venue_id, user_id, status, verified_phone)
    values ('${VENUE}','${USER_A}','pending','+447700900000');

  insert into public.venue_photos (venue_id, storage_path, uploaded_by, status)
    values ('${VENUE}','venues/${VENUE}/photo.jpg','${USER_A}','approved');

  insert into storage.objects (bucket_id, name, owner)
    values ('venue-photos','venues/${VENUE}/photo.jpg','${USER_A}');
`;

// -----------------------------------------------------------------------------
// Harness
// -----------------------------------------------------------------------------
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (e) { failures.push({ name, message: e?.message ?? String(e) });
              console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function throws(promise, re, msg) {
  try { await promise; } catch (e) {
    const m = e?.message ?? String(e);
    if (re && !re.test(m)) throw new Error(`${msg || 'wrong error'}: got "${m}"`);
    return;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

function makeHelpers(db) {
  const q = (sql, params) => db.query(sql, params);
  async function asUser(uid) {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    await db.exec('set role authenticated');
  }
  async function asAnon() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role anon');
  }
  async function reset() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  }
  return { q, asUser, asAnon, reset };
}

// Production's exact state, from the real migration files.
async function productionDb(withFix) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_062);
  await db.exec(MIGRATION_064);
  await db.exec(MIGRATION_065);
  await db.exec(MIGRATION_066);
  if (withFix) await db.exec(MIGRATION_067);
  return db;
}

// The real client queries, as the SQL PostgREST compiles them to.
const Q_MY_REVIEWS = `
  select r.id, r.venue_id, r.rating, r.title, r.body, r.is_anonymous,
         r.moderation_status, r.moderation_notes, r.created_at,
         v.name as venue_name, v.city as venue_city
    from public.reviews r
    left join public.venues v on v.id = r.venue_id
   where r.user_id = $1
   order by r.created_at desc`;

const Q_EXPORT_REVIEWS = `
  select r.rating, r.title, r.body, r.is_anonymous, r.visit_date,
         r.moderation_status, r.created_at, v.name as venue_name
    from public.reviews r
    left join public.venues v on v.id = r.venue_id
   where r.user_id = $1
   order by r.created_at desc`;

const Q_ADMIN_PENDING = `
  select r.id, r.rating, r.title, r.body, r.created_at, r.venue_id,
         v.id as v_id, v.name as v_name,
         p.username, p.full_name
    from public.reviews r
    left join public.venues v on v.id = r.venue_id
    left join public.profiles p on p.id = r.user_id
   where r.moderation_status = 'pending'
   order by r.created_at asc
   limit 50`;

const Q_VENUE_REVIEWS = `
  select r.id, r.venue_id, r.user_id, r.rating, r.title, r.body,
         r.visit_date, r.is_anonymous, r.moderation_status, r.helpful_count,
         r.created_at, r.updated_at,
         pp.id as p_id, pp.username, pp.full_name, pp.avatar_url, pp.show_reviews_publicly
    from public.reviews r
    left join public.public_profiles pp on pp.id = r.user_id
   where r.venue_id = $1 and r.moderation_status = 'approved'
   order by r.created_at desc`;

// =============================================================================
// PART 0 -- REPRODUCTION of the live failure
// =============================================================================
async function part0() {
  console.log('\nPART 0 -- REPRODUCTION: production state (062+064+065+066), no 067');
  const db = await productionDb(false);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  await test('SANITY: 065 really did remove is_admin from authenticated', async () => {
    await reset();
    const r = await q(`select has_column_privilege('authenticated','public.profiles','is_admin','SELECT') as ok`);
    eq(r.rows[0].ok, false, 'is_admin must NOT be selectable -- otherwise nothing is being reproduced');
  });

  await test('REPRO A: Download My Data -- reviews query fails with permission denied', async () => {
    await asUser(USER_A);
    await throws(q(Q_EXPORT_REVIEWS, [USER_A]), /permission denied/i,
      'export reviews query should fail');
    await reset();
  });

  await test('REPRO B: My Reviews -- fails with permission denied', async () => {
    await asUser(USER_A);
    await throws(q(Q_MY_REVIEWS, [USER_A]), /permission denied/i,
      'my-reviews query should fail');
    await reset();
  });

  await test('REPRO C: Admin pending reviews -- fails with permission denied', async () => {
    await asUser(ADMIN);
    await throws(q(Q_ADMIN_PENDING), /permission denied/i,
      'admin pending reviews query should fail');
    await reset();
  });

  await test('REPRO: the failure is the reviews POLICY, not the join -- a bare select fails too', async () => {
    await asUser(USER_A);
    await throws(q(`select id from public.reviews`), /permission denied/i,
      'even a bare reviews select should fail');
    await reset();
  });

  await test('REPRO: the error names profiles -- the table the policy reads', async () => {
    await asUser(USER_A);
    let msg = '';
    try { await q(`select id from public.reviews`); } catch (e) { msg = e?.message ?? ''; }
    assert(/profiles/i.test(msg), `expected the error to name profiles, got: "${msg}"`);
    await reset();
  });

  await test('REPRO: venue-detail review list (anon browsing) fails too', async () => {
    await asAnon();
    await throws(q(Q_VENUE_REVIEWS, [VENUE]), /permission denied/i,
      'anonymous venue review list should fail');
    await reset();
  });

  await test('REPRO: admin venue_claims queue fails', async () => {
    await asUser(ADMIN);
    await throws(q(`select id, status from public.venue_claims`), /permission denied/i,
      'venue_claims select should fail');
    await reset();
  });

  await test('REPRO: venue-photo storage DELETE fails', async () => {
    await asUser(USER_A);
    await throws(q(`delete from storage.objects where bucket_id = 'venue-photos'`),
      /permission denied/i, 'storage delete should fail');
    await reset();
  });

  await test('CONTRAST: venues still load -- venues policy uses is_admin(), not an inline read', async () => {
    await asUser(ADMIN);
    const r = await q(`select id from public.venues`);
    eq(r.rows.length, 1, 'venues should still be readable -- this is why venue moderation still worked');
    await reset();
  });

  await test('CONTRAST: own profile still loads via get_my_profile() -- Profile screen worked', async () => {
    await asUser(USER_A);
    const r = await q(`select * from public.get_my_profile()`);
    eq(r.rows.length, 1, 'get_my_profile should still work');
    eq(r.rows[0].username, 'alice', 'wrong profile');
    await reset();
  });

  await db.close();
}

// =============================================================================
// PART 1 -- 067 repairs every reproduced failure
// =============================================================================
async function part1() {
  console.log('\nPART 1 -- AFTER 067');
  const db = await productionDb(true);
  const { q, asUser, reset } = makeHelpers(db);

  await test('FIX A: Download My Data reviews query succeeds', async () => {
    await asUser(USER_A);
    const r = await q(Q_EXPORT_REVIEWS, [USER_A]);
    eq(r.rows.length, 2, 'author A has 1 approved + 1 pending review');
    await reset();
  });

  await test('FIX B: My Reviews succeeds and includes the pending review', async () => {
    await asUser(USER_A);
    const r = await q(Q_MY_REVIEWS, [USER_A]);
    eq(r.rows.length, 2, 'own reviews regardless of moderation status');
    assert(r.rows.some((x) => x.moderation_status === 'pending'),
      'the pending review must still be visible to its author');
    await reset();
  });

  await test('FIX C: Admin pending reviews succeeds and attributes the author', async () => {
    await asUser(ADMIN);
    const r = await q(Q_ADMIN_PENDING);
    eq(r.rows.length, 1, 'one pending review');
    eq(r.rows[0].username, 'alice', 'admin must still see the author username');
    eq(r.rows[0].full_name, 'Alice A', 'admin must still see the author full_name');
    await reset();
  });

  await test('FIX: admin venue_claims SELECT succeeds', async () => {
    await asUser(ADMIN);
    const r = await q(`select id, status from public.venue_claims`);
    eq(r.rows.length, 1, 'admin should see the pending claim');
    await reset();
  });

  await test('FIX: admin venue_claims UPDATE succeeds', async () => {
    await asUser(ADMIN);
    const r = await q(
      `update public.venue_claims set admin_notes = 'reviewed' where status = 'pending' returning id`);
    eq(r.rows.length, 1, 'admin should be able to update the claim');
    await reset();
  });

  await test('FIX: a non-admin still cannot UPDATE a claim', async () => {
    await asUser(USER_B);
    const r = await q(
      `update public.venue_claims set admin_notes = 'HACKED' returning id`);
    eq(r.rows.length, 0, 'non-admin must not be able to update claims');
    await reset();
  });

  await test('FIX: storage DELETE no longer errors for a user who owns nothing', async () => {
    // USER_B did not upload the photo, so nothing is deleted -- the point is
    // that the statement completes instead of raising 42501.
    await asUser(USER_B);
    const r = await q(`delete from storage.objects where bucket_id = 'venue-photos' returning id`);
    eq(r.rows.length, 0, 'a non-owner deletes nothing, but must not ERROR');
    await reset();
  });

  await test('FIX: the uploader can still delete their own venue photo (031 preserved)', async () => {
    await asUser(USER_A);
    const r = await q(`delete from storage.objects where bucket_id = 'venue-photos' returning id`);
    eq(r.rows.length, 1, 'the uploader must still be able to delete their own object');
    await reset();
  });

  await test('FIX: an admin CAN delete any venue photo', async () => {
    // Fresh DB: the previous test consumed the seeded object.
    const db2 = await productionDb(true);
    const h2 = makeHelpers(db2);
    await h2.asUser(ADMIN);
    const r = await h2.q(`delete from storage.objects where bucket_id = 'venue-photos' returning id`);
    await h2.reset();
    await db2.close();
    eq(r.rows.length, 1, 'admin delete should remove an object it does not own');
  });

  await db.close();
}

// =============================================================================
// PART 2 -- ROW SEMANTICS preserved exactly as migration 021 defined them
// =============================================================================
async function part2() {
  console.log('\nPART 2 -- ROW SEMANTICS (migration 021 rules, unchanged)');
  const db = await productionDb(true);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  const visibleIds = async () => {
    const r = await q(`select id from public.reviews order by id`);
    return r.rows.map((x) => x.id).sort();
  };

  await test('a reader sees approved reviews by authors who publish reviews publicly', async () => {
    await asUser(USER_A);
    const ids = await visibleIds();
    assert(ids.includes(REVIEW_A), 'own approved review missing');
    assert(ids.includes(REVIEW_B), 'approved review by a public-reviews author missing');
    await reset();
  });

  await test('SEMANTICS (a): show_in_search = false does NOT hide the author\'s reviews', async () => {
    // USER_B has show_in_search = false but show_reviews_publicly = true.
    // A naive fix that leaves the profiles sub-select under RLS silently drops
    // this review, making show_in_search govern review visibility.
    await asUser(USER_A);
    const ids = await visibleIds();
    assert(ids.includes(REVIEW_B),
      'review by a show_in_search=false author must STILL be visible -- ' +
      'show_in_search governs the profile directory, not review visibility');
    await reset();
  });

  await test('show_reviews_publicly = false DOES hide the author\'s reviews from others', async () => {
    await asUser(USER_A);
    const ids = await visibleIds();
    assert(!ids.includes(REVIEW_C),
      'REVIEW_C author opted out of public reviews -- it must not be visible');
    await reset();
  });

  await test('an author still sees their own review even with show_reviews_publicly = false', async () => {
    await asUser(USER_C);
    const ids = await visibleIds();
    assert(ids.includes(REVIEW_C), 'author must always see their own review');
    await reset();
  });

  await test('a pending review is NOT visible to other users', async () => {
    await asUser(USER_B);
    const ids = await visibleIds();
    assert(!ids.includes(REVIEW_P), 'pending review leaked to another user');
    await reset();
  });

  await test('an admin sees every review, including pending and opted-out', async () => {
    await asUser(ADMIN);
    const ids = await visibleIds();
    for (const id of [REVIEW_A, REVIEW_B, REVIEW_C, REVIEW_P]) {
      assert(ids.includes(id), `admin should see ${id}`);
    }
    await reset();
  });

  await test('SEMANTICS (b): anon still sees NO reviews -- 067 publishes nothing new', async () => {
    await asAnon();
    const r = await q(`select id from public.reviews`);
    eq(r.rows.length, 0,
      'anonymous callers saw zero reviews before 065 and must still see zero -- ' +
      'review bodies can describe children');
    await reset();
  });

  await test('review_is_publicly_visible() returns false for an anonymous caller', async () => {
    await asAnon();
    const r = await q(`select public.review_is_publicly_visible($1) as ok`, [REVIEW_A]);
    eq(r.rows[0].ok, false, 'anon must get false even for a genuinely public review');
    await reset();
  });

  await db.close();
}

// =============================================================================
// PART 3 -- THE 065/066 BOUNDARY IS UNCHANGED BY 067
// =============================================================================
async function part3() {
  console.log('\nPART 3 -- 065/066 BOUNDARY UNCHANGED');
  const db = await productionDb(true);
  const { q, asUser, reset } = makeHelpers(db);

  await test('no table-level SELECT on profiles was restored to any client role', async () => {
    await reset();
    const r = await q(`
      select has_table_privilege('anon','public.profiles','SELECT')          as anon_sel,
             has_table_privilege('authenticated','public.profiles','SELECT') as auth_sel,
             has_table_privilege('service_role','public.profiles','SELECT')  as svc_sel`);
    eq(r.rows[0].anon_sel, false, 'anon regained table SELECT');
    eq(r.rows[0].auth_sel, false, 'authenticated regained table SELECT');
    eq(r.rows[0].svc_sel, true,  'service_role must be unaffected');
  });

  await test('every sensitive profile column remains unreadable by authenticated', async () => {
    await reset();
    for (const col of SENSITIVE) {
      const r = await q(
        `select has_column_privilege('authenticated','public.profiles',$1,'SELECT') as ok`, [col]);
      eq(r.rows[0].ok, false, `authenticated must not read ${col}`);
    }
  });

  await test('a cross-user read of a sensitive column still fails', async () => {
    await asUser(USER_A);
    await throws(q(`select children_ages from public.profiles where id = $1`, [USER_B]),
      /permission denied/i, 'children_ages must stay unreadable');
    await throws(q(`select stripe_customer_id from public.profiles where id = $1`, [USER_B]),
      /permission denied/i, 'stripe_customer_id must stay unreadable');
    await reset();
  });

  await test('the reviews repair did NOT become a route to sensitive profile data', async () => {
    await asUser(USER_A);
    await throws(
      q(`select r.id, p.children_ages
           from public.reviews r join public.profiles p on p.id = r.user_id`),
      /permission denied/i,
      'joining reviews to a sensitive profile column must still fail');
    await reset();
  });

  await test('anon still holds ZERO privileges on profiles', async () => {
    await reset();
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const r = await q(`select has_table_privilege('anon','public.profiles',$1) as ok`, [p]);
      eq(r.rows[0].ok, false, `anon must not hold ${p}`);
    }
  });

  await test('anon still holds ZERO privileges on public_profiles (066 intact)', async () => {
    await reset();
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const r = await q(`select has_table_privilege('anon','public.public_profiles',$1) as ok`, [p]);
      eq(r.rows[0].ok, false, `anon must not hold ${p} on the view`);
    }
  });

  await test('authenticated still holds SELECT-only on public_profiles (066 intact)', async () => {
    await reset();
    const held = [];
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const r = await q(`select has_table_privilege('authenticated','public.public_profiles',$1) as ok`, [p]);
      if (r.rows[0].ok) held.push(p);
    }
    eq(held.join(','), 'SELECT', 'view privileges drifted');
  });

  await test('public_profiles keeps security_invoker and security_barrier', async () => {
    await reset();
    const r = await q(`
      select array_to_string(c.reloptions, ',') as opts
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='public_profiles'`);
    assert(/security_invoker=true/.test(r.rows[0].opts), `opts: ${r.rows[0].opts}`);
    assert(/security_barrier=true/.test(r.rows[0].opts), `opts: ${r.rows[0].opts}`);
  });

  await test('062 UPDATE column grants are untouched', async () => {
    await reset();
    // Privileged columns must remain non-updatable...
    for (const col of ['is_admin', 'subscription_tier', 'stripe_customer_id', 'subscription_expires_at']) {
      const r = await q(
        `select has_column_privilege('authenticated','public.profiles',$1,'UPDATE') as ok`, [col]);
      eq(r.rows[0].ok, false, `${col} must not be updatable by authenticated`);
    }
    // ...and the user-editable ones must remain updatable.
    for (const col of ['username', 'full_name', 'bio', 'children_ages', 'postcode']) {
      const r = await q(
        `select has_column_privilege('authenticated','public.profiles',$1,'UPDATE') as ok`, [col]);
      eq(r.rows[0].ok, true, `${col} must remain updatable by authenticated`);
    }
  });

  await test('the profiles SELECT policy set from 065 is unchanged (exactly 3)', async () => {
    await reset();
    const r = await q(`
      select policyname from pg_policies
       where schemaname='public' and tablename='profiles' and cmd='SELECT'
       order by policyname`);
    eq(r.rows.map((x) => x.policyname).join('|'),
      'Admins can view all profiles|Public profiles are viewable|Users can view own profile',
      '065 profiles SELECT policy set drifted');
  });

  await test('get_my_profile / get_my_profile_export remain SECURITY DEFINER', async () => {
    await reset();
    const r = await q(`
      select p.proname, p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public'
         and p.proname in ('get_my_profile','get_my_profile_export','review_is_publicly_visible')
       order by p.proname`);
    eq(r.rows.length, 3, 'expected all three functions');
    for (const row of r.rows) eq(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
  });

  await test('review_is_publicly_visible has a locked search_path', async () => {
    await reset();
    const r = await q(`
      select array_to_string(p.proconfig, ',') as cfg
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='review_is_publicly_visible'`);
    assert(/search_path=/.test(r.rows[0].cfg ?? ''), `proconfig was ${r.rows[0].cfg}`);
  });

  await test('067 modifies no data', async () => {
    await reset();
    const a = await q(`select count(*)::int as n from public.profiles`);
    const b = await q(`select count(*)::int as n from public.reviews`);
    eq(a.rows[0].n, 4, 'profile rows changed');
    eq(b.rows[0].n, 4, 'review rows changed');
  });

  await db.close();
}

// =============================================================================
// PART 4 -- idempotency + the full client surface
// =============================================================================
async function part4() {
  console.log('\nPART 4 -- IDEMPOTENCY AND CLIENT SURFACE');
  const db = await productionDb(true);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  await test('067 is idempotent -- re-applying changes nothing', async () => {
    await reset();
    await db.exec(MIGRATION_067);
    await asUser(USER_A);
    const r = await q(Q_MY_REVIEWS, [USER_A]);
    eq(r.rows.length, 2, 'my-reviews still works after re-apply');
    await reset();
  });

  await test('venue-detail review list works for a logged-in user', async () => {
    await asUser(USER_A);
    const r = await q(Q_VENUE_REVIEWS, [VENUE]);
    const ids = r.rows.map((x) => x.id);
    assert(ids.includes(REVIEW_A), 'own approved review should appear');
    assert(ids.includes(REVIEW_B), 'public-reviews author should appear');
    assert(!ids.includes(REVIEW_C), 'opted-out author must not appear');
    await reset();
  });

  await test('the public_profiles embed yields NO row for a show_in_search=false author', async () => {
    // Unchanged, pre-existing behaviour: the review is visible, the author
    // presentation is not. This is exactly why admin moderation embeds the base
    // table rather than the view (app/admin/moderation.tsx:365).
    await asUser(USER_A);
    const r = await q(Q_VENUE_REVIEWS, [VENUE]);
    const rowB = r.rows.find((x) => x.id === REVIEW_B);
    assert(rowB, 'REVIEW_B should be present');
    eq(rowB.username, null, 'author presentation must be absent for a private-directory author');
    const rowA = r.rows.find((x) => x.id === REVIEW_A);
    eq(rowA.username, 'alice', 'author presentation should resolve for a listed author');
    await reset();
  });

  await test('a non-admin gets nothing from the admin pending-reviews query (no error)', async () => {
    await asUser(USER_A);
    const r = await q(Q_ADMIN_PENDING);
    // A's own pending review is visible to A via "Users can view own reviews";
    // what matters is that no OTHER user's pending review leaks and it does not error.
    for (const row of r.rows) eq(row.username, 'alice', 'only own pending review may appear');
    await reset();
  });

  await test('anon can still browse venues (048 regression guard)', async () => {
    await asAnon();
    const r = await q(`select id, name from public.venues`);
    eq(r.rows.length, 1, 'anonymous venue browsing must keep working');
    await reset();
  });

  await db.close();
}


// =============================================================================
// PART 5 -- ORACLE RESISTANCE. The property that failed review in draft 1.
//
// Draft 1 of 067 used can_view_approved_review(p_author_id uuid): it took a
// PROFILE id and consulted no review, so an ordinary authenticated caller could
// read back an arbitrary profile's show_reviews_publicly value -- including for
// a show_in_search = false profile that 065 makes invisible to them, and for a
// user with no approved reviews at all. That is a profile-setting lookup API.
//
// THE REQUIRED PROPERTY, restated as what these tests actually check:
//   a direct call to the helper with an arbitrary identifier must reveal no
//   more than attempting to SELECT that SAME review under the reviews policies.
//
// USER_B is the adversarial case throughout: show_in_search = false (profile
// row invisible to others under 065) AND show_reviews_publicly = true (the flag
// draft 1 leaked).
// =============================================================================
async function part5() {
  console.log('\nPART 5 -- ORACLE RESISTANCE');
  const db = await productionDb(true);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  await test('the rejected author-keyed helper does not exist', async () => {
    await reset();
    const r = await q(`
      select count(*)::int as n
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='can_view_approved_review'`);
    eq(r.rows[0].n, 0, 'the draft-1 author-keyed helper must be gone');
  });

  await test('ORACLE 11: an arbitrary PROFILE id yields FALSE, not that profile flag', async () => {
    // USER_B: show_in_search = false, show_reviews_publicly = true.
    // Draft 1 returned TRUE here and leaked the flag. The review-keyed helper
    // has no meaning for a profile id and must return FALSE.
    await asUser(USER_A);
    for (const target of [ADMIN, USER_A, USER_B, USER_C]) {
      const r = await q(`select public.review_is_publicly_visible($1) as ok`, [target]);
      eq(r.rows[0].ok, false,
        `a profile id must never be answerable -- leaked for ${target}`);
    }
    await reset();
  });

  await test('ORACLE 11b: the hidden profile stays hidden by every other route', async () => {
    await asUser(USER_A);
    const r = await q(`select id from public.profiles where id = $1`, [USER_B]);
    eq(r.rows.length, 0, 'USER_B row must remain invisible under 065');
    const v = await q(`select id from public.public_profiles where id = $1`, [USER_B]);
    eq(v.rows.length, 0, 'USER_B must not appear in public_profiles either');
    await reset();
  });

  await test('ORACLE 9: a nonexistent review id yields FALSE and teaches nothing', async () => {
    await asUser(USER_A);
    const bogus = [
      '99999999-9999-9999-9999-999999999999',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ];
    for (const id of bogus) {
      const h = await q(`select public.review_is_publicly_visible($1) as ok`, [id]);
      eq(h.rows[0].ok, false, `nonexistent id ${id} must be FALSE`);
      const sel = await q(`select id from public.reviews where id = $1`, [id]);
      eq(sel.rows.length, 0, 'and a SELECT for it must also return nothing');
    }
    await reset();
  });

  await test('ORACLE 10: a non-approved review id yields FALSE despite a publishing author', async () => {
    // REVIEW_P is pending; its author USER_A has show_reviews_publicly = true.
    // A caller who is NOT the author must not distinguish this from "no such review".
    await asUser(USER_B);
    const h = await q(`select public.review_is_publicly_visible($1) as ok`, [REVIEW_P]);
    eq(h.rows[0].ok, false, 'a pending review must be FALSE');
    const sel = await q(`select id from public.reviews where id = $1`, [REVIEW_P]);
    eq(sel.rows.length, 0, 'and it must not be selectable by a non-author');
    await reset();
  });

  await test('ORACLE 10b: FALSE is indistinguishable across all four causes', async () => {
    // anonymous / unknown id / non-approved / non-publishing author must all
    // produce the SAME observable output, so FALSE carries no information about
    // which cause applied.
    await asUser(USER_B);
    const cases = [
      '99999999-9999-9999-9999-999999999999', // unknown id
      REVIEW_P,                               // approved=false, author publishes
      REVIEW_C,                               // approved, author opted out
    ];
    const seen = new Set();
    for (const id of cases) {
      const r = await q(`select public.review_is_publicly_visible($1) as ok`, [id]);
      seen.add(JSON.stringify(r.rows[0].ok));
    }
    await asAnon();
    const a = await q(`select public.review_is_publicly_visible($1) as ok`, [REVIEW_A]);
    seen.add(JSON.stringify(a.rows[0].ok));
    await reset();
    eq(seen.size, 1, 'all four FALSE causes must be observationally identical');
    eq([...seen][0], 'false', 'and that shared value must be false');
  });

  await test('SECURITY PROPERTY: helper TRUE implies the caller can SELECT that same review', async () => {
    // The formal requirement: the helper reveals no MORE than a SELECT of the
    // same id. Checked exhaustively over every review, for every caller.
    const allReviews = [REVIEW_A, REVIEW_B, REVIEW_C, REVIEW_P,
                        '99999999-9999-9999-9999-999999999999'];
    for (const uid of [USER_A, USER_B, USER_C, ADMIN]) {
      await asUser(uid);
      for (const rid of allReviews) {
        const h = await q(`select public.review_is_publicly_visible($1) as ok`, [rid]);
        const sel = await q(`select id from public.reviews where id = $1`, [rid]);
        if (h.rows[0].ok) {
          eq(sel.rows.length, 1,
            `helper said TRUE for ${rid} as ${uid} but the row is not selectable -- ` +
            'that is disclosure beyond a SELECT');
        }
      }
    }
    await reset();
  });

  await test('SECURITY PROPERTY: anonymous callers get FALSE for every review id', async () => {
    await asAnon();
    for (const rid of [REVIEW_A, REVIEW_B, REVIEW_C, REVIEW_P]) {
      const r = await q(`select public.review_is_publicly_visible($1) as ok`, [rid]);
      eq(r.rows[0].ok, false, `anon must get FALSE for ${rid}`);
    }
    await reset();
  });

  await test('helper and policy AGREE for a hidden author with a genuinely public review', async () => {
    // USER_B's profile is invisible, but their APPROVED review is legitimately
    // public (show_reviews_publicly = true) -- the preserved product rule. The
    // helper agreeing with the policy is correct, not a leak.
    await asUser(USER_A);
    const h = await q(`select public.review_is_publicly_visible($1) as ok`, [REVIEW_B]);
    eq(h.rows[0].ok, true, 'REVIEW_B is genuinely public');
    const sel = await q(`select id from public.reviews where id = $1`, [REVIEW_B]);
    eq(sel.rows.length, 1, 'and the policy admits it -- helper and policy agree');
    const prof = await q(`select id from public.profiles where id = $1`, [USER_B]);
    eq(prof.rows.length, 0, 'yet the author profile row must remain hidden');
    await reset();
  });

  await test('the helper takes a review id only -- no author-keyed overload exists', async () => {
    await reset();
    const r = await q(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='review_is_publicly_visible'`);
    eq(r.rows.length, 1, 'exactly one helper overload must exist');
    eq(r.rows[0].args, 'p_review_id uuid', 'the parameter must be a review id');
  });

  await db.close();
}

// =============================================================================
(async function main() {
  console.log('='.repeat(78));
  console.log('067_fix_policies_reading_profile_columns.sql -- reproduction + repair');
  console.log('='.repeat(78));

  await part0();
  await part1();
  await part2();
  await part3();
  await part4();
  await part5();

  console.log('\n' + '='.repeat(78));
  console.log(`PASSED: ${passed}   FAILED: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
  console.log('='.repeat(78));
})();
