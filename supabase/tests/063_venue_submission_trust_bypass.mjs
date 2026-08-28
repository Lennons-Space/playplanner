// =============================================================================
// supabase/tests/063_venue_submission_trust_bypass.mjs
//
// Behavioural database tests for migration 063 using in-process Postgres
// (pglite) -- NO live Supabase, NO production access, NO network.
//
//   PP-012 (HIGH)     -- no database-level venue submission rate limit exists.
//   PP-010 (CRITICAL) -- an INSERT can mint venue ownership (claimed_by), which
//                        chains into the claimed-owner UPDATE policy.
//   PP-011 (HIGH)     -- that UPDATE policy. Deliberately NOT fixed by 063;
//                        asserted here to remain unchanged.
//
// Structure:
//   PART 0 -- PRE-FIX REPRODUCTION against the TRUE production policy set,
//             re-verified live 2026-08-26: ONE INSERT policy (001's),
//             roles={public}; 003's "Rate limit venue submissions" policy is
//             NOT PRESENT; anon/authenticated/service_role each hold table
//             INSERT + UPDATE on every column; the only triggers are
//             venue_location_trigger and venues_updated_at.
//             The earlier two-policy "OR-gap" model was a repo-derived
//             assumption and is DISPROVEN -- 0.1 records the disproof.
//   PART 1 -- POST-FIX field-classification matrix: every class C column,
//             plus the legitimate-flow regression set.
//   PART 2 -- PP-012 rate limit: binding, boundaries, per-user isolation,
//             counter integrity, and the MULTI-ROW bypass.
//   PART 3 -- ROOT-CAUSE IMMUNITY: re-widen the policy layer, then re-widen the
//             grant layer too, and prove the trigger still holds the line.
//   PART 4 -- PP-010 / PP-011 boundary: ownership cannot be minted at INSERT,
//             but the admin-approved claim path still establishes it and
//             PP-011 remains open exactly as before.
//   PART 5 -- Idempotency and rollback fidelity.
//
// FIDELITY NOTES (disclosed, not hidden):
//   * pglite has no PostGIS, so `location geography(Point,4326)` is modelled as
//     `text` and set_venue_location() writes a text value. This preserves the
//     ONLY property under test -- that a trigger-assigned column needs no INSERT
//     grant -- without pretending PostGIS is present.
//   * pglite is a SINGLE in-process backend. Genuine multi-connection contention
//     CANNOT be reproduced, so no test here claims to prove that two concurrent
//     transactions serialise. PART 2 proves the pieces that are provable in
//     process: the advisory lock is actually taken and is transaction-scoped,
//     it is keyed per-user, and the count is re-read in a separate statement
//     after the lock. The serialisation guarantee those compose into is argued
//     in the migration header from documented PostgreSQL semantics, and is NOT
//     asserted as a passing test.
//
// Run:  node supabase/tests/063_venue_submission_trust_bypass.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_063 = readFileSync(
  join(__dirname, '../migrations/063_fix_venue_submission_trust_bypass.sql'),
  'utf8',
);

// The migration with every `--` comment stripped. Static-analysis assertions run
// against THIS, not the raw file: 063 discusses the columns and constructs it
// deliberately avoids, and a prose mention must never fail an executable check.
const MIGRATION_063_CODE = MIGRATION_063.replace(/--[^\n]*/g, '');

// ROLLBACK OPTION B from the migration footer, kept literal so PART 5 applies
// precisely what would be pasted into the SQL editor.
//
// THIS IS THE SECURITY-DEGRADING EMERGENCY ROLLBACK. It restores the VERIFIED
// live baseline and nothing more -- and that baseline is the vulnerable one.
// Applying it deliberately reopens broad INSERT privileges for anon AND
// authenticated, the total absence of a submission quota (PP-012), and the
// claimed_by=self chain into the owner UPDATE policy (PP-010). PART 5 asserts
// those reopen, because a rollback that did NOT reopen them would not be a
// faithful rollback. Option A (drop only the rate-limit trigger) is the
// preferred operation and is tested separately below.
//
// It deliberately does NOT create a "Rate limit venue submissions" policy --
// production has never had one, and a rollback must restore what was there.
const ROLLBACK_SQL = `
  BEGIN;

  DROP TRIGGER  IF EXISTS venues_enforce_submission_rate_limit ON public.venues;
  DROP TRIGGER  IF EXISTS venues_enforce_submission_invariants ON public.venues;
  DROP FUNCTION IF EXISTS public.enforce_venue_submission_rate_limit();
  DROP FUNCTION IF EXISTS public.enforce_venue_submission_invariants();
  DROP FUNCTION IF EXISTS private.enforce_venue_submission_quota();
  DROP FUNCTION IF EXISTS private.current_uid();
  DROP INDEX    IF EXISTS public.venues_submitted_by_created_at_idx;

  GRANT INSERT ON public.venues TO authenticated;
  GRANT INSERT ON public.venues TO anon;

  DROP POLICY IF EXISTS "Authenticated users can submit venues" ON public.venues;

  CREATE POLICY "Authenticated users can submit venues" ON public.venues
    for insert with check (
      auth.uid() = submitted_by
      and moderation_status = 'pending'
      and is_published = false
      and is_verified = false
    );

  COMMIT;
`;

const ADMIN  = '00000000-0000-0000-0000-00000000000a';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Mirrors production `venues` at 058+062+064..067: migration 001's CREATE TABLE
// plus the columns actually added later -- 012 (data_source, license),
// 013/016 (osm_id + unique constraint), 018 (postcode nullable),
// 023 (claimed_by), 039 (image_*), 044 (discovery_approved).
// Deliberately EXCLUDES operating_status (059) and booking_url (060): both
// migrations are unapplied in production, and 063 must not depend on them.
// 029's google_* columns are excluded because 033 dropped them.
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  -- Models the VERIFIED live privilege state: every client role holds table
  -- INSERT and UPDATE on every column of every public table, from Supabase's
  -- ALTER DEFAULT PRIVILEGES. No migration ever granted it.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${ADMIN}'), ('${USER_A}'), ('${USER_B}');

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    is_admin boolean default false
  );
  insert into public.profiles (id, is_admin) select id, (id = '${ADMIN}') from auth.users;

  create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
  $$;

  create table public.categories (id uuid primary key default gen_random_uuid(), name text);
  insert into public.categories (name) values ('Soft Play');

  create table public.venues (
    id                uuid primary key default gen_random_uuid(),
    name              text not null,
    slug              text unique,
    description       text,
    category_id       uuid references public.categories(id),
    address_line1     text,
    address_line2     text,
    city              text not null,
    postcode          text,                       -- nullable since 018
    country           text default 'GB',
    latitude          decimal(9,6) not null,
    longitude         decimal(9,6) not null,
    location          text,                       -- geography(Point,4326) in prod; see fidelity note
    phone             text,
    email             text,
    website           text,
    price_range       text check (price_range in ('free','budget','moderate','premium')),
    min_age           int default 0 check (min_age >= 0),
    max_age           int default 12 check (max_age <= 18),
    constraint valid_age_range check (min_age <= max_age),
    is_published      boolean default false,
    is_verified       boolean default false,
    claimed_by        uuid references public.profiles(id),
    submitted_by      uuid references public.profiles(id),
    moderation_status text default 'pending' check (moderation_status in ('pending','approved','rejected')),
    moderation_notes  text,
    moderated_by      uuid references public.profiles(id),
    moderated_at      timestamptz,
    is_premium        boolean default false,
    featured_until    timestamptz,
    review_count      int default 0,
    average_rating    decimal(3,2) default 0,
    created_at        timestamptz default now(),
    updated_at        timestamptz default now(),
    data_source       text default 'manual'
                        check (data_source in ('manual','user_submitted','osm','ogl','foursquare','business_claimed')),
    license           text,
    osm_id            text,
    image_url         text,
    image_source      text,
    image_attribution text,
    image_license     text,
    image_is_exact    boolean not null default false,
    image_updated_at  timestamptz,
    discovery_approved boolean not null default true,
    constraint venues_osm_id_unique unique (osm_id)
  );
  alter table public.venues enable row level security;

  -- 001:291-301 (PostGIS call replaced by a text write -- see fidelity note)
  create or replace function public.set_venue_location() returns trigger as $$
  begin
    new.location = new.longitude || ',' || new.latitude;
    return new;
  end;
  $$ language plpgsql;

  create trigger venue_location_trigger
    before insert or update of latitude, longitude on public.venues
    for each row execute function public.set_venue_location();

  -- 001:326-332
  create or replace function public.touch_updated_at() returns trigger as $$
  begin new.updated_at = now(); return new; end;
  $$ language plpgsql;

  create trigger venues_updated_at
    before update on public.venues
    for each row execute function public.touch_updated_at();

  -- NOTE: schema auth USAGE is deliberately NOT granted to anon/authenticated
  -- here. Production's grant could not be proven from the repo, so the harness
  -- stays restrictive: migration 063 must work WITHOUT the authenticated role
  -- holding auth-schema access. This is what forces the trigger to reach
  -- auth.uid() through the SECURITY DEFINER helper private.current_uid()
  -- rather than calling it directly.

  -- 001:441-451 SELECT policies
  create policy "Approved venues are public" on public.venues
    for select using (is_published = true and moderation_status = 'approved');
  create policy "Owners can view own venues" on public.venues
    for select using (auth.uid() = submitted_by or auth.uid() = claimed_by);
  create policy "Admins can view all venues" on public.venues
    for select using (public.is_admin());

  -- 001:457-463 INSERT policy -- THE ONLY INSERT POLICY ON venues IN PRODUCTION.
  --
  -- RE-VERIFIED AGAINST LIVE PRODUCTION 2026-08-26 (read-only pg_policies query):
  --   policyname = 'Authenticated users can submit venues'
  --   cmd        = INSERT
  --   roles      = {public}          <- no TO clause, matches 001 exactly
  --   qual       = NULL
  --   with_check = auth.uid() = submitted_by
  --                AND moderation_status = 'pending'
  --                AND is_published = false
  --                AND is_verified  = false
  --
  -- 003's "Rate limit venue submissions" policy DOES NOT EXIST in production.
  -- The earlier two-policy "OR-gap" reconstruction was a repository-derived
  -- ASSUMPTION (003 is in the migration set, therefore it must be live) and is
  -- DISPROVEN. Production has no database-level submission rate limit at all.
  create policy "Authenticated users can submit venues" on public.venues
    for insert with check (
      auth.uid() = submitted_by
      and moderation_status = 'pending'
      and is_published = false
      and is_verified = false
    );

  -- 001:466-471 UPDATE policies. Both have USING and NO WITH CHECK, so Postgres
  -- reuses USING as the WITH CHECK. Untouched by 063; PP-011 remains open.
  create policy "Owners can update claimed venue" on public.venues
    for update using (auth.uid() = claimed_by);
  create policy "Admins can update any venue" on public.venues
    for update using (public.is_admin());
`;

// -- assert harness (same shape as 056/057/058/062) ---------------------------
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
  async function asServiceRole() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role service_role');
  }
  async function reset() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  }
  // The exact payload app/venue/add.tsx:223 sends -- 15 columns, verified
  // against the client rather than assumed.
  const submitAsApp = (uid, name) => q(
    `insert into public.venues
       (name, description, category_id, address_line1, city, postcode,
        latitude, longitude, phone, website, min_age, max_age,
        submitted_by, moderation_status, is_published)
     values ($1,'desc',(select id from public.categories limit 1),'1 High St',
             'Whitchurch','SY13 1NX',52.9,-2.6,'01948 000000','https://x.test',0,12,
             $2,'pending',false)`, [name, uid]);
  return { q, asUser, asAnon, asServiceRole, reset, submitAsApp };
}

// The 15 columns migration 063 grants INSERT on, in alphabetical order.
const EXPECTED_GRANTED_COLUMNS = [
  'address_line1', 'category_id', 'city', 'description', 'is_published',
  'latitude', 'longitude', 'max_age', 'min_age', 'moderation_status',
  'name', 'phone', 'postcode', 'submitted_by', 'website',
];

// =============================================================================
// PART 0 -- PRE-FIX REPRODUCTION (real live policy + privilege set, 063 NOT applied)
// =============================================================================
async function part0() {
  console.log('\nPART 0 -- TRUE production baseline (ONE INSERT policy, verified live 2026-08-26)');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  // ---------------------------------------------------------------------------
  // 0.1 -- The ORIGINAL PP-010 claim, retested against the REAL baseline.
  //        It must FAIL to reproduce. Recording the disproof is the point.
  // ---------------------------------------------------------------------------
  await test('DISPROVEN: one-shot self-publish (approved+published+verified) is REFUSED', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues
           (name, city, postcode, latitude, longitude, submitted_by,
            moderation_status, is_published, is_verified, moderated_by)
         values ('Totally Legit Soft Play','Whitchurch','SY13 1NX',52.9,-2.6,$1,
                 'approved', true, true, $2)`, [USER_A, USER_B]),
      /row-level security|violates/i,
      'the live single policy DOES constrain moderation_status/is_published/is_verified');
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name='Totally Legit Soft Play'`);
    eq(r.rows[0].c, 0, 'nothing should have been written');
  });

  // ---------------------------------------------------------------------------
  // 0.2 -- What the live WITH CHECK does NOT constrain: claimed_by.
  //        In production claimed_by is written ONLY by 027's review_venue_claim
  //        (SECURITY DEFINER, admin-gated). Setting it at INSERT bypasses the
  //        entire business-claim verification flow (023 venue_claims + phone
  //        verification) in a single request.
  // ---------------------------------------------------------------------------
  await test('LIVE HOLE 1: a user can self-assign claimed_by at INSERT (bypasses the claim flow)', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
             values ('Chain Step 1','Whitchurch','SY13 1NX',52.9,-2.6,$1,$1)`, [USER_A]);
    await reset();
    const r = await q(`select claimed_by, moderation_status, is_published
                         from public.venues where name='Chain Step 1'`);
    eq(r.rows[0].claimed_by, USER_A, 'claimed_by should be (vulnerably) self-assigned');
    // Sanity: the row is still pending/unpublished at this point -- step 1 alone
    // is not yet a moderation bypass. That is what step 0.3 completes.
    eq(r.rows[0].moderation_status, 'pending', 'step 1 alone does not publish');
    eq(r.rows[0].is_published, false, 'step 1 alone does not publish');
  });

  // ---------------------------------------------------------------------------
  // 0.3 -- THE CHAIN. 001:466-467 "Owners can update claimed venue" is
  //        `for update using (auth.uid() = claimed_by)` with NO WITH CHECK, so
  //        Postgres infers WITH CHECK = USING: the caller may change ANY column
  //        provided claimed_by still points at themselves.
  //        Self-claim (0.2) + this = the FULL original PP-010 impact, in two
  //        requests instead of one.
  // ---------------------------------------------------------------------------
  await test('LIVE HOLE 2 (THE CHAIN): self-claimed venue is then UPDATEd to approved+published+VERIFIED', async () => {
    await asUser(USER_A);
    await q(`update public.venues
                set moderation_status='approved', is_published=true, is_verified=true,
                    is_premium=true, featured_until = now() + interval '10 years',
                    moderated_by=$1, moderated_at=now()
              where name='Chain Step 1'`, [USER_B]);
    await reset();
    const v = (await q(`select moderation_status, is_published, is_verified, is_premium,
                               featured_until, moderated_by
                          from public.venues where name='Chain Step 1'`)).rows[0];
    assert(v.moderation_status === 'approved' && v.is_published && v.is_verified,
      'the chain should (vulnerably) produce a live, verified venue');
    eq(v.is_premium, true, 'premium should (vulnerably) be self-granted');
    eq(v.moderated_by, USER_B, 'moderator identity should be (vulnerably) forged');
    assert(v.featured_until !== null, 'featured placement should (vulnerably) be self-granted');
  });

  await test('LIVE HOLE 2: the chained venue IS visible to anon on the public map', async () => {
    await asAnon();
    const r = await q(`select count(*)::int c from public.venues where name='Chain Step 1'`);
    await reset();
    eq(r.rows[0].c, 1, 'anon should (vulnerably) see it -- full PP-010 impact, reached in 2 steps');
  });

  // ---------------------------------------------------------------------------
  // 0.4 -- Independent of the chain: premium/featured are unconstrained at
  //        INSERT and SURVIVE an honest admin approval. A moderator approving a
  //        pending venue has no reason to inspect is_premium/featured_until.
  // ---------------------------------------------------------------------------
  await test('LIVE HOLE 3: is_premium + featured_until self-granted at INSERT', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, submitted_by,
                is_premium, featured_until)
             values ('Self Promoted','W','X1 1XX',52.9,-2.6,$1,true, now()+interval '10 years')`,
            [USER_A]);
    await reset();
    const r = await q(`select is_premium from public.venues where name='Self Promoted'`);
    eq(r.rows[0].is_premium, true, 'premium should (vulnerably) be self-granted');
  });

  await test('LIVE HOLE 3: the self-granted premium SURVIVES an honest admin approval', async () => {
    await asUser(ADMIN);
    await q(`update public.venues set moderation_status='approved', is_published=true
              where name='Self Promoted'`);
    await reset();
    const v = (await q(`select is_published, is_premium, featured_until
                          from public.venues where name='Self Promoted'`)).rows[0];
    assert(v.is_published && v.is_premium && v.featured_until !== null,
      'paid-tier featured placement is obtained free, laundered through moderation');
  });

  // ---------------------------------------------------------------------------
  // 0.5 -- Audit-trail and provenance forgery at INSERT, no chain required.
  // ---------------------------------------------------------------------------
  await test('LIVE HOLE 4: moderated_by / moderated_at can be forged at INSERT', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, submitted_by,
                moderated_by, moderated_at)
             values ('Forged Audit','W','X1 1XX',52.9,-2.6,$1,$2, now())`, [USER_A, ADMIN]);
    await reset();
    const v = (await q(`select moderated_by, moderated_at from public.venues
                         where name='Forged Audit'`)).rows[0];
    eq(v.moderated_by, ADMIN, 'a moderator identity should be (vulnerably) forgeable');
    assert(v.moderated_at !== null, 'moderation timestamp should be (vulnerably) forgeable');
  });

  await test('LIVE HOLE 5: provenance/licensing and image attribution forgeable at INSERT', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, submitted_by,
                data_source, license, osm_id, image_url, image_source,
                image_attribution, image_license, image_is_exact)
             values ('Forged Provenance','W','X1 1XX',52.9,-2.6,$1,
                     'osm','ODbL-1.0','node/999999','https://evil.test/x.jpg',
                     'wikimedia','Someone Else','CC-BY-SA-4.0', true)`, [USER_A]);
    await reset();
    const v = (await q(`select data_source, license, osm_id, image_source, image_attribution
                          from public.venues where name='Forged Provenance'`)).rows[0];
    eq(v.data_source, 'osm', 'a user submission should be (vulnerably) mislabelled as an OSM import');
    eq(v.image_attribution, 'Someone Else', 'image attribution should be (vulnerably) forgeable');
    assert(v.osm_id === 'node/999999',
      'a forged osm_id should (vulnerably) squat the unique key a real import needs');
  });

  await test('LIVE HOLE 6: slug and cached review aggregates forgeable at INSERT', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues
               (name, slug, city, postcode, latitude, longitude, submitted_by,
                review_count, average_rating)
             values ('Forged Rating','best-soft-play-uk','W','X1 1XX',52.9,-2.6,$1, 999, 5.00)`,
            [USER_A]);
    await reset();
    const v = (await q(`select slug, review_count, average_rating from public.venues
                         where name='Forged Rating'`)).rows[0];
    eq(v.slug, 'best-soft-play-uk', 'a desirable slug should be (vulnerably) squattable');
    eq(v.review_count, 999, 'review aggregates should be (vulnerably) forgeable');
  });

  await test('LIVE HOLE 7: created_at can be back-dated at INSERT (hides rows from any 24h cap)', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, submitted_by, created_at)
             values ('Back Dated','W','X1 1XX',52.9,-2.6,$1, now() - interval '40 days')`,
            [USER_A]);
    await reset();
    const v = (await q(`select created_at < now() - interval '30 days' AS backdated
                          from public.venues where name='Back Dated'`)).rows[0];
    eq(v.backdated, true, 'created_at should be (vulnerably) back-datable');
  });

  // ---------------------------------------------------------------------------
  // 0.6 -- PP-012, RECLASSIFIED. Production has NO rate-limit policy at all, so
  //        this is not "a limit that fails to bind" -- there is no limit.
  // ---------------------------------------------------------------------------
  await test('PP-012 REPRO: there is NO database rate limit -- 22 submissions in 24h succeed', async () => {
    await asUser(USER_B);
    for (let i = 0; i < 22; i++) {
      await q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by)
               values ($1,'W','X1 1XX',52.9,-2.6,$2)`, [`Spam ${i}`, USER_B]);
    }
    await reset();
    const r = await q(`select count(*)::int c from public.venues
                        where submitted_by=$1 and created_at > now() - interval '24 hours'`, [USER_B]);
    eq(r.rows[0].c, 22, 'all 22 should land against a documented cap of 10');
  });

  await test('BASELINE: anon holds table INSERT and is stopped only by policy absence', async () => {
    await reset();
    const g = await q(
      `select has_table_privilege('anon','public.venues','INSERT') as ins,
              has_table_privilege('anon','public.venues','UPDATE') as upd`);
    eq(g.rows[0].ins, true, 'anon should hold table INSERT pre-fix (verified live)');
    eq(g.rows[0].upd, true, 'anon should hold table UPDATE pre-fix (verified live)');
  });

  await db.close();
}

// =============================================================================
// PART 1 -- POST-FIX field classification matrix + legitimate flow
// =============================================================================
async function part1() {
  console.log('\nPART 1 -- migration 063 applied: every class C column defended, legitimate flow preserved');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);

  // Pre-existing imported rows (service-role/import provenance) written BEFORE
  // 063, to prove the migration does not alter existing data.
  await db.exec(`
    insert into public.venues (name, city, postcode, latitude, longitude,
                               moderation_status, is_published, is_verified,
                               data_source, license, osm_id)
    values ('Imported Park','Whitchurch','SY13 1NX',52.9,-2.6,
            'approved', true, true, 'osm', 'ODbL-1.0', 'node/123');`);
  const beforeRow = (await db.query(
    `select name, moderation_status, is_published, is_verified, data_source, osm_id
       from public.venues where name='Imported Park'`)).rows[0];

  await db.exec(MIGRATION_063);
  const { q, asUser, asAnon, asServiceRole, reset, submitAsApp } = makeHelpers(db);

  await test('EXISTING DATA: imported venue is unchanged by the migration', async () => {
    await reset();
    const after = (await q(`select name, moderation_status, is_published, is_verified, data_source, osm_id
                              from public.venues where name='Imported Park'`)).rows[0];
    eq(JSON.stringify(after), JSON.stringify(beforeRow), 'migration must not modify existing rows');
  });

  // ---------------------------------------------------------------------------
  // 1.1 -- CLASS C MATRIX. Every server/admin/trust-owned column, one test each.
  //        Under the 15-column grant these are refused at the PRIVILEGE layer
  //        ("permission denied for column"). PART 3 removes that layer and
  //        re-runs the same matrix against the trigger alone.
  // ---------------------------------------------------------------------------
  const classC = [
    ['moderation_status forged',  'moderation_status',  `'approved'`],
    ['is_published forged',       'is_published',       `true`],
    ['is_verified forged',        'is_verified',        `true`],
    ['moderation_notes forged',   'moderation_notes',   `'looks fine to me'`],
    ['moderated_at forged',       'moderated_at',       `now()`],
    ['claimed_by self-assigned',  'claimed_by',         `'${USER_A}'::uuid`],
    ['is_premium forged',         'is_premium',         `true`],
    ['featured_until forged',     'featured_until',     `now() + interval '10 years'`],
    ['discovery_approved forged', 'discovery_approved', `false`],
    ['slug squatted',             'slug',               `'best-soft-play-uk'`],
    ['review_count forged',       'review_count',       `999`],
    ['average_rating forged',     'average_rating',     `5.00`],
    ['data_source forged',        'data_source',        `'osm'`],
    ['license forged',            'license',            `'ODbL-1.0'`],
    ['osm_id squatted',           'osm_id',             `'node/999999'`],
    ['image_url forged',          'image_url',          `'https://evil.test/x.jpg'`],
    ['image_source forged',       'image_source',       `'wikimedia'`],
    ['image_attribution forged',  'image_attribution',  `'Someone Else'`],
    ['image_license forged',      'image_license',      `'CC-BY-SA-4.0'`],
    ['image_is_exact forged',     'image_is_exact',     `true`],
    ['image_updated_at forged',   'image_updated_at',   `now()`],
    ['created_at back-dated',     'created_at',         `now() - interval '40 days'`],
  ];
  for (const [label, col, val] of classC) {
    await test(`BLOCKED (class C): ${label}`, async () => {
      await asUser(USER_A);
      await throws(
        q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, ${col})
           values ('Hostile ${col}','W','X1 1XX',52.9,-2.6,$1, ${val})`, [USER_A]),
        /permission denied|row-level security|violates|invariant|server-owned|cannot|must start|may only/i,
        `${col} must not be settable by a submitter`);
      await reset();
      const r = await q(`select count(*)::int c from public.venues where name='Hostile ${col}'`);
      eq(r.rows[0].c, 0, 'nothing should have been written');
    });
  }

  await test('BLOCKED: forged moderated_by (FK to another profile)', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, moderated_by)
         values ('Hostile moderated_by','W','X1 1XX',52.9,-2.6,$1,$2)`, [USER_A, ADMIN]),
      /permission denied|row-level security|invariant/i,
      'moderator identity must not be settable by a submitter');
  });

  await test('BLOCKED: submitting on behalf of another user', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by)
         values ('Impersonated','W','X1 1XX',52.9,-2.6,$1)`, [USER_B]),
      /row-level security|violates|may only be submitted/i,
      'submitted_by must equal auth.uid()');
  });

  await test('BLOCKED: the original full PP-010 exploit payload, atomically', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues
           (name, city, postcode, latitude, longitude, submitted_by, claimed_by,
            moderation_status, is_published, is_verified, is_premium,
            featured_until, moderated_by, moderated_at)
         values ('Full Exploit','W','X1 1XX',52.9,-2.6,$1,$1,'approved',true,true,true,
                 now()+interval '10 years',$1, now())`, [USER_A]),
      /permission denied|row-level security|violates|invariant/i);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name='Full Exploit'`);
    eq(r.rows[0].c, 0);
  });

  await test('BLOCKED: anon cannot submit a venue at all', async () => {
    await asAnon();
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by)
         values ('Anon Venue','W','X1 1XX',52.9,-2.6,$1)`, [USER_A]),
      /permission denied|row-level security|violates/i,
      'anon must hold no INSERT privilege and satisfy no INSERT policy');
    await reset();
  });

  // ---------------------------------------------------------------------------
  // 1.2 -- LEGITIMATE FLOW must be completely unaffected.
  // ---------------------------------------------------------------------------
  await test('ALLOWED: the exact app/venue/add.tsx payload still succeeds', async () => {
    await asUser(USER_A);
    await submitAsApp(USER_A, 'Honest Soft Play');
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name='Honest Soft Play'`);
    eq(r.rows[0].c, 1, 'the real submission payload must still work');
  });

  await test('ALLOWED: submitted venue lands in the correct safe default state', async () => {
    await reset();
    const v = (await q(`select moderation_status, is_published, is_verified, is_premium,
                               claimed_by, moderated_by, moderated_at, moderation_notes,
                               slug, review_count, average_rating, data_source, license,
                               osm_id, image_url, image_is_exact, discovery_approved,
                               location
                          from public.venues where name='Honest Soft Play'`)).rows[0];
    eq(v.moderation_status, 'pending');
    eq(v.is_published, false);
    eq(v.is_verified, false);
    eq(v.is_premium, false);
    eq(v.claimed_by, null, 'ownership must not be minted at INSERT');
    eq(v.moderated_by, null);
    eq(v.moderated_at, null);
    eq(v.moderation_notes, null);
    eq(v.slug, null);
    eq(v.review_count, 0);
    eq(v.osm_id, null);
    eq(v.license, null);
    eq(v.image_url, null);
    eq(v.image_is_exact, false);
    eq(v.data_source, 'manual', 'defaults to manual (see the semantic note in 063)');
    eq(v.discovery_approved, true, '044 default, unchanged');
    // venue_location_trigger assigned `location` even though it is NOT granted:
    // column privileges are checked against the statement column list, not
    // against columns a trigger assigns. (The harness models `location` as text,
    // so the value carries the decimal(9,6) scale -- see the fidelity note.)
    assert(v.location !== null && /52\.9/.test(v.location) && /-2\.6/.test(v.location),
      `venue_location_trigger must still populate location, got ${v.location}`);
  });

  await test('ALLOWED: created_at/updated_at are forced to insert time', async () => {
    await reset();
    const v = (await q(`select created_at > now() - interval '1 minute' as fresh_c,
                               updated_at > now() - interval '1 minute' as fresh_u
                          from public.venues where name='Honest Soft Play'`)).rows[0];
    eq(v.fresh_c, true, 'created_at must be insert time');
    eq(v.fresh_u, true, 'updated_at must be insert time');
  });

  await test('ALLOWED: admin moderation (approve) still works', async () => {
    await asUser(ADMIN);
    await q(`update public.venues set moderation_status='approved', is_published=true,
                                      moderated_by=$1, moderated_at=now()
              where name='Honest Soft Play'`, [ADMIN]);
    await reset();
    const v = (await q(`select is_published, moderation_status from public.venues
                         where name='Honest Soft Play'`)).rows[0];
    assert(v.is_published && v.moderation_status === 'approved', 'moderation must be unaffected');
  });

  await test('ALLOWED: anon can read the approved, published venue (public map intact)', async () => {
    await asAnon();
    const r = await q(`select count(*)::int c from public.venues where name='Honest Soft Play'`);
    await reset();
    eq(r.rows[0].c, 1, 'the public map must still work');
  });

  await test('ALLOWED: service_role import can still create a pre-approved OSM venue', async () => {
    await asServiceRole();
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, moderation_status,
                is_published, is_verified, data_source, license, osm_id,
                image_url, image_source, discovery_approved, slug)
             values ('Imported Playground','W','X1 1XX',52.9,-2.6,'approved',true,true,
                     'osm','ODbL-1.0','node/456','https://commons.test/a.jpg',
                     'wikimedia', true, 'imported-playground')`);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name='Imported Playground'`);
    eq(r.rows[0].c, 1, 'the OSM import path must be completely unaffected');
  });

  await test('ALLOWED: service_role bulk import of 25 rows is not rate limited', async () => {
    await asServiceRole();
    const values = Array.from({ length: 25 }, (_, i) =>
      `('Bulk Import ${i}','W','X1 1XX',52.9,-2.6,'approved',true,'osm','node/bulk${i}')`).join(',');
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, moderation_status,
                is_published, data_source, osm_id)
             values ${values}`);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name like 'Bulk Import %'`);
    eq(r.rows[0].c, 25, 'service_role must be exempt from the cap by role');
  });

  // ---------------------------------------------------------------------------
  // 1.3 -- Structural assertions about what 063 actually installed.
  // ---------------------------------------------------------------------------
  await test('STRUCTURE: exactly ONE INSERT policy on venues, TO authenticated', async () => {
    await reset();
    const r = await q(
      `select policyname, roles::text as roles
         from pg_policies where schemaname='public' and tablename='venues' and cmd='INSERT'`);
    eq(r.rows.length, 1, 'there must be exactly one INSERT policy');
    eq(r.rows[0].policyname, 'Authenticated users can submit venues');
    assert(/authenticated/.test(r.rows[0].roles) && !/\{public\}/.test(r.rows[0].roles),
      `policy must be scoped TO authenticated, got ${r.rows[0].roles}`);
  });

  await test('STRUCTURE: no "Rate limit venue submissions" policy is created', async () => {
    await reset();
    const r = await q(
      `select count(*)::int c from pg_policies
        where schemaname='public' and tablename='venues'
          and policyname='Rate limit venue submissions'`);
    eq(r.rows[0].c, 0, '003 phantom policy must never be recreated');
  });

  await test('GRANTS: authenticated INSERT is limited to exactly the 15 client columns', async () => {
    await reset();
    const r = await q(
      `select column_name from information_schema.column_privileges
        where table_schema='public' and table_name='venues'
          and grantee='authenticated' and privilege_type='INSERT'
        order by column_name`);
    const got = r.rows.map((x) => x.column_name);
    eq(JSON.stringify(got), JSON.stringify(EXPECTED_GRANTED_COLUMNS),
      'the granted INSERT column set must match app/venue/add.tsx exactly');
  });

  await test('GRANTS: anon holds no INSERT on venues at all', async () => {
    await reset();
    const t = await q(`select has_table_privilege('anon','public.venues','INSERT') as ins`);
    eq(t.rows[0].ins, false, 'anon table INSERT must be revoked');
    const c = await q(
      `select count(*)::int c from information_schema.column_privileges
        where table_schema='public' and table_name='venues'
          and grantee='anon' and privilege_type='INSERT'`);
    eq(c.rows[0].c, 0, 'anon must hold no column-level INSERT either');
  });

  // Raw-ACL assertion. has_table_privilege() alone is not enough: it reports
  // false for `authenticated` both when INSERT was revoked and when it never
  // existed. This reads relacl directly and asserts the 'a' (INSERT) bit is
  // gone for anon and authenticated and PRESENT for service_role -- the exact
  // shape the live ACL probe showed before the migration (all three arwdDxtm).
  await test('ACL: relacl shows INSERT removed from anon+authenticated, kept for service_role', async () => {
    await reset();
    const r = await q(
      `select unnest(relacl)::text as acl from pg_class where oid='public.venues'::regclass`);
    const acl = Object.fromEntries(
      r.rows.map((x) => x.acl.split('/')[0].split('=')).map(([g, p]) => [g, p]));
    assert(acl.anon !== undefined, 'anon must still hold an ACL entry');
    assert(!acl.anon.includes('a'), `anon must not hold INSERT, got "${acl.anon}"`);
    assert(!acl.authenticated.includes('a'),
      `authenticated must not hold table-level INSERT, got "${acl.authenticated}"`);
    assert(acl.service_role.includes('a'),
      `service_role must retain INSERT, got "${acl.service_role}"`);
    // SELECT (r), UPDATE (w) and DELETE (d) must survive untouched for all three.
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const [bit, name] of [['r', 'SELECT'], ['w', 'UPDATE'], ['d', 'DELETE']]) {
        assert(acl[role].includes(bit),
          `063 must not change ${name} for ${role}, got "${acl[role]}"`);
      }
    }
  });

  await test('ACL: authenticated holds NO table-level INSERT (only the column grant)', async () => {
    await reset();
    const t = await q(`select has_table_privilege('authenticated','public.venues','INSERT') as ins`);
    eq(t.rows[0].ins, false, 'table-level INSERT must be gone; only column grants remain');
    const c = await q(`select has_column_privilege('authenticated','public.venues','name','INSERT') as n,
                              has_column_privilege('authenticated','public.venues','claimed_by','INSERT') as cb`);
    eq(c.rows[0].n, true, 'a granted column must still be insertable');
    eq(c.rows[0].cb, false, 'an ungranted trust column must not be');
  });

  await test('GRANTS: service_role INSERT is deliberately untouched', async () => {
    await reset();
    const t = await q(`select has_table_privilege('service_role','public.venues','INSERT') as ins`);
    eq(t.rows[0].ins, true, 'the import path depends on service_role keeping full INSERT');
  });

  await test('GRANTS: UPDATE on venues is untouched (that is PP-011 territory)', async () => {
    await reset();
    const t = await q(
      `select has_table_privilege('authenticated','public.venues','UPDATE') as upd`);
    eq(t.rows[0].upd, true, '063 must not silently change the UPDATE boundary');
  });

  await test('GRANTS: anon/authenticated cannot EXECUTE either trigger function', async () => {
    await reset();
    for (const role of ['anon', 'authenticated']) {
      for (const fn of ['public.enforce_venue_submission_invariants()',
                        'public.enforce_venue_submission_rate_limit()']) {
        const r = await q(`select has_function_privilege($1,$2,'EXECUTE') as x`, [role, fn]);
        eq(r.rows[0].x, false, `${role} must not be able to call ${fn} directly`);
      }
    }
  });

  await test('GRANTS: only authenticated may EXECUTE the private helpers', async () => {
    await reset();
    for (const fn of ['private.current_uid()', 'private.enforce_venue_submission_quota()']) {
      const a = await q(`select has_function_privilege('anon',$1,'EXECUTE') as x`, [fn]);
      eq(a.rows[0].x, false, `anon must not execute ${fn}`);
      const u = await q(`select has_function_privilege('authenticated',$1,'EXECUTE') as x`, [fn]);
      eq(u.rows[0].x, true, `authenticated must execute ${fn} (the trigger calls it as the caller)`);
    }
  });

  await test('STRUCTURE: the rate-limit index exists and is partial', async () => {
    await reset();
    const r = await q(
      `select indexdef from pg_indexes
        where schemaname='public' and indexname='venues_submitted_by_created_at_idx'`);
    eq(r.rows.length, 1, 'the supporting index must exist');
    assert(/WHERE .*submitted_by IS NOT NULL/i.test(r.rows[0].indexdef),
      'the index must be partial on submitted_by IS NOT NULL');
  });

  await test('STRUCTURE: 059/060 columns are never referenced by executable SQL', async () => {
    assert(!/operating_status|booking_url/.test(MIGRATION_063_CODE),
      '063 must stay independent of the unapplied 059/060/061');
  });

  await test('NO 42P17: no RLS recursion anywhere in the new submission path', async () => {
    await asUser(USER_B);
    await submitAsApp(USER_B, 'Recursion Check');
    const r = await q(`select count(*)::int c from public.venues where name='Recursion Check'`);
    await reset();
    eq(r.rows[0].c, 1, 'the SECURITY DEFINER counter must not re-enter venues RLS');
  });

  await db.close();
}

// =============================================================================
// PART 2 -- PP-012 rate limit
// =============================================================================
async function part2() {
  console.log('\nPART 2 -- PP-012: the 10-per-24h cap now actually binds');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_063);
  const { q, asUser, asServiceRole, reset, submitAsApp } = makeHelpers(db);

  await test('submissions 1..10 within 24h all succeed', async () => {
    await asUser(USER_A);
    for (let i = 0; i < 10; i++) await submitAsApp(USER_A, `Venue A${i}`);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_A]);
    eq(r.rows[0].c, 10, 'the cap must not bind early');
  });

  await test('submission 11 is REFUSED', async () => {
    await asUser(USER_A);
    await throws(submitAsApp(USER_A, 'Venue A10'),
      /submission limit reached/i, 'the 11th submission must be rejected');
    await reset();
    const r = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_A]);
    eq(r.rows[0].c, 10, 'the rejected row must not be written');
  });

  await test('COUNTER INTEGRITY: the refused write did not consume or corrupt quota', async () => {
    await reset();
    const r = await q(`select count(*)::int c from public.venues
                        where submitted_by=$1 and created_at > now() - interval '24 hours'`, [USER_A]);
    eq(r.rows[0].c, 10, 'a rolled-back insert must leave the count at exactly 10');
  });

  await test('MULTI-ROW BYPASS CLOSED: one statement carrying 500 venues is refused', async () => {
    await asUser(USER_B);
    const values = Array.from({ length: 500 }, (_, i) =>
      `('Bulk ${i}','W','X1 1XX',52.9,-2.6,'${USER_B}','pending',false)`).join(',');
    await throws(
      q(`insert into public.venues
           (name, city, postcode, latitude, longitude, submitted_by,
            moderation_status, is_published)
         values ${values}`),
      /submission limit reached/i,
      'a pre-statement cap would have passed 500 times; the AFTER-row cap must not');
    await reset();
    const r = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_B]);
    eq(r.rows[0].c, 0, 'the whole statement must roll back');
  });

  await test('MULTI-ROW ALLOWED: one statement carrying exactly 10 venues succeeds', async () => {
    await asUser(USER_B);
    const values = Array.from({ length: 10 }, (_, i) =>
      `('Batch ${i}','W','X1 1XX',52.9,-2.6,'${USER_B}','pending',false)`).join(',');
    await q(`insert into public.venues
               (name, city, postcode, latitude, longitude, submitted_by,
                moderation_status, is_published)
             values ${values}`);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_B]);
    eq(r.rows[0].c, 10, 'a legitimate batch at the cap must be allowed');
  });

  await test('QUOTA IS PER USER: USER_B hitting the cap does not affect USER_A or vice versa', async () => {
    await reset();
    const a = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_A]);
    const b = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_B]);
    eq(a.rows[0].c, 10, 'USER_A still at its own cap');
    eq(b.rows[0].c, 10, 'USER_B independently at its own cap');
  });

  await test('USER_B is then capped independently at 11', async () => {
    await asUser(USER_B);
    await throws(submitAsApp(USER_B, 'Venue B10'), /submission limit reached/i);
    await reset();
  });

  await test('24h BOUNDARY: rows older than the window do not count', async () => {
    // Age USER_A's rows out of the window as a trusted role (the trigger forces
    // created_at on the enforced path, which is exactly the point of 0.7).
    await reset();
    await q(`update public.venues set created_at = now() - interval '25 hours'
              where submitted_by=$1`, [USER_A]);
    await asUser(USER_A);
    await submitAsApp(USER_A, 'Venue A New');
    await reset();
    const r = await q(`select count(*)::int c from public.venues
                        where submitted_by=$1 and created_at > now() - interval '24 hours'`, [USER_A]);
    eq(r.rows[0].c, 1, 'the window must roll');
  });

  await test('BACK-DATING CLOSED: a submitter cannot age their own rows out of the window', async () => {
    // created_at is not granted, so this is refused at the privilege layer here;
    // PART 3 proves the trigger forces it even when the grant is wide open.
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, created_at)
         values ('Aged Out','W','X1 1XX',52.9,-2.6,$1, now() - interval '40 days')`, [USER_A]),
      /permission denied|row-level security|invariant/i);
    await reset();
  });

  await test('service_role import is NOT subject to the cap', async () => {
    await asServiceRole();
    for (let i = 0; i < 15; i++) {
      await q(`insert into public.venues (name, city, postcode, latitude, longitude,
                                          moderation_status, is_published, data_source, osm_id)
               values ($1,'W','X1 1XX',52.9,-2.6,'approved',true,'osm',$2)`,
              [`SR Import ${i}`, `node/sr${i}`]);
    }
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name like 'SR Import %'`);
    eq(r.rows[0].c, 15, 'service_role must never be capped');
  });

  // ---------------------------------------------------------------------------
  // 2.x -- CONCURRENCY. See the fidelity note at the top of this file: pglite is
  //        a single in-process backend, so genuine cross-connection contention
  //        CANNOT be reproduced and is NOT claimed here. What is provable in
  //        process is asserted instead.
  // ---------------------------------------------------------------------------
  await test('LOCK: a per-user advisory lock is actually taken on the submit path', async () => {
    await reset();
    // ADMIN has submitted nothing, so this insert SUCCEEDS -- the quota helper
    // still runs, and takes the lock, on the success path. Using a succeeding
    // insert keeps the transaction live so pg_locks can be inspected inside it.
    await db.exec('begin');
    await db.query(`select set_config('test.uid', $1, false)`, [ADMIN]);
    await db.exec('set role authenticated');
    await db.query(
      `insert into public.venues (name, city, postcode, latitude, longitude,
                                  submitted_by, moderation_status, is_published)
       values ('Lock Probe','W','X1 1XX',52.9,-2.6,$1,'pending',false)`, [ADMIN]);
    await db.exec('reset role');
    const r = await db.query(`select count(*)::int c from pg_locks where locktype='advisory'`);
    const locks = r.rows[0].c;
    await db.exec('rollback');
    await reset();
    assert(locks >= 1, `the advisory lock must be held inside the transaction, saw ${locks}`);
  });

  await test('LOCK: the advisory lock is transaction-scoped (released at transaction end)', async () => {
    await reset();
    const r = await db.query(`select count(*)::int c from pg_locks where locktype='advisory'`);
    eq(r.rows[0].c, 0, 'no advisory lock may survive the transaction');
  });

  await test('LOCK: the lock probe rolled back, so it consumed no quota', async () => {
    await reset();
    const r = await db.query(`select count(*)::int c from public.venues where name='Lock Probe'`);
    eq(r.rows[0].c, 0, 'the probe insert must have rolled back');
  });

  await test('LOCK: the lock key is derived from auth.uid(), not from a client column', async () => {
    assert(/hashtext\('pp012:venue_submit'\)/.test(MIGRATION_063_CODE),
      'the lock must use the namespaced two-key form');
    assert(/v_uid\s*:=\s*auth\.uid\(\)/.test(MIGRATION_063_CODE),
      'the lock key must come from auth.uid()');
    assert(!/pg_advisory_xact_lock[\s\S]{0,200}NEW\./.test(MIGRATION_063_CODE),
      'the lock key must never be derived from a NEW.* client-supplied column');
  });

  await test('ARCHITECTURE: exactly one executable count of venues exists in the migration', async () => {
    const counts = MIGRATION_063_CODE.match(/count\(\*\)/g) || [];
    eq(counts.length, 1, 'there must be exactly ONE authoritative counting site');
    assert(/private\.enforce_venue_submission_quota/.test(MIGRATION_063_CODE),
      'that site must be the SECURITY DEFINER quota helper');
  });

  await test('ARCHITECTURE: the quota helper is SECURITY DEFINER, VOLATILE and parameterless', async () => {
    await reset();
    const r = await db.query(
      `select p.prosecdef, p.provolatile, p.pronargs
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname='enforce_venue_submission_quota'`);
    eq(r.rows.length, 1, 'the helper must exist');
    eq(r.rows[0].prosecdef, true, 'must be SECURITY DEFINER so the count is RLS-immune');
    eq(r.rows[0].provolatile, 'v',
      'must be VOLATILE so the post-lock count takes a fresh snapshot');
    eq(r.rows[0].pronargs, 0,
      'must take no parameters, or a user could probe another user\'s volume');
  });

  await test('ARCHITECTURE: the cap is enforced by an AFTER INSERT trigger, not by WITH CHECK', async () => {
    await reset();
    const t = await db.query(
      `select t.tgname, t.tgtype from pg_trigger t
        where t.tgrelid='public.venues'::regclass
          and t.tgname='venues_enforce_submission_rate_limit'`);
    eq(t.rows.length, 1, 'the rate-limit trigger must exist');
    // tgtype bit 1 = ROW, bit 2 = BEFORE (0 => AFTER), bit 4 = INSERT
    assert((t.rows[0].tgtype & 1) === 1, 'must be FOR EACH ROW');
    assert((t.rows[0].tgtype & 2) === 0, 'must be AFTER, not BEFORE');
    assert((t.rows[0].tgtype & 4) === 4, 'must fire on INSERT');
    const p = await db.query(
      `select with_check from pg_policies
        where schemaname='public' and tablename='venues' and cmd='INSERT'`);
    assert(!/24 hours|venue_submissions|quota/i.test(p.rows[0].with_check),
      'the policy must NOT carry a second, bypassable pre-statement count');
  });

  await db.close();
}

// =============================================================================
// PART 3 -- ROOT-CAUSE IMMUNITY: widen the policy layer, then the grant layer
// =============================================================================
async function part3() {
  console.log('\nPART 3 -- root-cause immunity: re-widening policy AND grants must not reopen the hole');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_063);
  const { q, asUser, reset } = makeHelpers(db);

  // Reintroduce the EXACT failure class: a future migration adds a permissive
  // INSERT policy. PostgreSQL ORs permissive policies for the same command.
  await db.exec(`
    create policy "Careless future policy" on public.venues
      for insert to authenticated
      with check (auth.uid() = submitted_by);
  `);

  await test('control: a second permissive INSERT policy genuinely exists again', async () => {
    await reset();
    const r = await q(`select count(*)::int c from pg_policies
                        where schemaname='public' and tablename='venues' and cmd='INSERT'`);
    eq(r.rows[0].c, 2, 'two permissive INSERT policies must now exist');
  });

  await test('BACKSTOP (policy widened): claimed_by self-assignment is STILL blocked', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
         values ('Policy Widened','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_A]),
      /permission denied|invariant|cannot be claimed/i);
    await reset();
  });

  // Now ALSO restore the table-level grant -- the other silent-widening failure
  // mode. With both the policy and the privilege layers reopened, the BEFORE
  // trigger is the ONLY thing left standing.
  await db.exec(`GRANT INSERT ON public.venues TO authenticated;`);

  await test('control: the grant layer is genuinely reopened on every column', async () => {
    await reset();
    const t = await q(`select has_column_privilege('authenticated','public.venues','claimed_by','INSERT') as x`);
    eq(t.rows[0].x, true, 'the privilege layer must really be wide open for this part');
  });

  const triggerOnly = [
    ['claimed_by',         `'${USER_A}'::uuid`, /cannot be claimed/i],
    ['moderation_status',  `'approved'`,        /must start as pending/i],
    ['is_published',       `true`,              /cannot be published/i],
    ['is_verified',        `true`,              /cannot be verified/i],
    ['is_premium',         `true`,              /server-owned/i],
    ['featured_until',     `now()+interval '1 year'`, /server-owned/i],
    ['moderated_at',       `now()`,             /moderator identity/i],
    ['moderation_notes',   `'ok'`,              /moderator identity/i],
    ['discovery_approved', `false`,             /server-owned/i],
    ['slug',               `'squatted'`,        /assigned by the server/i],
    ['review_count',       `999`,               /maintained by the server/i],
    ['average_rating',     `5.00`,              /maintained by the server/i],
    ['data_source',        `'osm'`,             /provenance is server-owned/i],
    ['license',            `'ODbL-1.0'`,        /provenance is server-owned/i],
    ['osm_id',             `'node/hostile'`,    /provenance is server-owned/i],
    ['image_url',          `'https://evil.test/x.jpg'`, /image provenance/i],
    ['image_source',       `'wikimedia'`,       /image provenance/i],
    ['image_attribution',  `'Someone Else'`,    /image provenance/i],
    ['image_license',      `'CC-BY-SA-4.0'`,    /image provenance/i],
    ['image_is_exact',     `true`,              /image provenance/i],
    ['image_updated_at',   `now()`,             /image provenance/i],
  ];
  for (const [col, val, re] of triggerOnly) {
    await test(`BACKSTOP (both layers widened): ${col} still refused BY THE TRIGGER`, async () => {
      await asUser(USER_A);
      await throws(
        q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, ${col})
           values ('TriggerOnly ${col}','W','X1 1XX',52.9,-2.6,$1, ${val})`, [USER_A]),
        re, `${col} must be refused by the trigger, with the trigger's own message`);
      await reset();
      const r = await q(`select count(*)::int c from public.venues where name='TriggerOnly ${col}'`);
      eq(r.rows[0].c, 0);
    });
  }

  await test('BACKSTOP (both layers widened): impersonating another submitter is refused', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by)
         values ('Impersonate 2','W','X1 1XX',52.9,-2.6,$1)`, [USER_B]),
      /may only be submitted on your own behalf|row-level security/i,
      'the trigger must enforce identity itself via private.current_uid()');
    await reset();
  });

  await test('BACKSTOP (both layers widened): back-dated created_at is FORCED to now()', async () => {
    await asUser(USER_A);
    await q(`insert into public.venues (name, city, postcode, latitude, longitude,
                                        submitted_by, created_at, updated_at)
             values ('Forced Timestamps','W','X1 1XX',52.9,-2.6,$1,
                     now() - interval '40 days', now() - interval '40 days')`, [USER_A]);
    await reset();
    const v = (await q(`select created_at > now() - interval '1 minute' as fresh_c,
                               updated_at > now() - interval '1 minute' as fresh_u
                          from public.venues where name='Forced Timestamps'`)).rows[0];
    eq(v.fresh_c, true, 'the trigger must overwrite a back-dated created_at');
    eq(v.fresh_u, true, 'the trigger must overwrite a back-dated updated_at');
  });

  await test('BACKSTOP (both layers widened): the PP-012 cap is STILL enforced', async () => {
    await asUser(USER_B);
    for (let i = 0; i < 10; i++) {
      await q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by)
               values ($1,'W','X1 1XX',52.9,-2.6,$2)`, [`Widened ${i}`, USER_B]);
    }
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by)
         values ('Widened 10','W','X1 1XX',52.9,-2.6,$1)`, [USER_B]),
      /submission limit reached/i, 'the cap lives in a trigger, so widening cannot reach it');
    await reset();
  });

  await test('BACKSTOP: the honest submission path still works with both layers widened', async () => {
    await asUser(ADMIN);
    await q(`insert into public.venues (name, city, postcode, latitude, longitude,
                                        submitted_by, moderation_status, is_published)
             values ('Still Honest','W','X1 1XX',52.9,-2.6,$1,'pending',false)`, [ADMIN]);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name='Still Honest'`);
    eq(r.rows[0].c, 1, 'hardening must not break the legitimate path under any layering');
  });

  await db.close();
}

// =============================================================================
// PART 4 -- PP-010 / PP-011 boundary
// =============================================================================
async function part4() {
  console.log('\nPART 4 -- PP-010 closed at INSERT; PP-011 deliberately still open');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_063);
  const { q, asUser, asServiceRole, reset, submitAsApp } = makeHelpers(db);

  await test('PP-010 STEP 1 CLOSED: ownership cannot be minted at INSERT', async () => {
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
         values ('Mint Ownership','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_A]),
      /permission denied|invariant|cannot be claimed/i);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where name='Mint Ownership'`);
    eq(r.rows[0].c, 0);
  });

  await test('PP-010 CHAIN CLOSED: an honest submitter never becomes claimed_by', async () => {
    await asUser(USER_A);
    await submitAsApp(USER_A, 'Honest Then Hostile');
    await reset();
    const v = (await q(`select claimed_by from public.venues where name='Honest Then Hostile'`)).rows[0];
    eq(v.claimed_by, null, 'the submitter must not own the row');

    // With claimed_by NULL the owner UPDATE policy cannot match, so the second
    // stage of the chain is unreachable: the UPDATE affects zero rows.
    await asUser(USER_A);
    await q(`update public.venues set is_verified=true, is_published=true,
                                      moderation_status='approved'
              where name='Honest Then Hostile'`);
    await reset();
    const after = (await q(`select is_verified, is_published, moderation_status
                              from public.venues where name='Honest Then Hostile'`)).rows[0];
    eq(after.is_verified, false, 'the chain must not reach the UPDATE boundary');
    eq(after.is_published, false);
    eq(after.moderation_status, 'pending');
  });

  await test('LEGITIMATE CLAIM PATH still establishes ownership (027 review_venue_claim)', async () => {
    // 027's review_venue_claim() is SECURITY DEFINER and admin-gated; modelled
    // here by the equivalent privileged write, since 063 does not touch it.
    await asServiceRole();
    await q(`update public.venues set claimed_by=$1 where name='Honest Then Hostile'`, [USER_A]);
    await reset();
    const v = (await q(`select claimed_by from public.venues where name='Honest Then Hostile'`)).rows[0];
    eq(v.claimed_by, USER_A, 'the admin-approved claim flow must still work after 063');
  });

  await test('PP-011 STILL OPEN (by design): a legitimately claimed venue can self-approve', async () => {
    await asUser(USER_A);
    await q(`update public.venues
                set moderation_status='approved', is_published=true, is_verified=true,
                    is_premium=true
              where name='Honest Then Hostile'`);
    await reset();
    const v = (await q(`select moderation_status, is_published, is_verified, is_premium
                          from public.venues where name='Honest Then Hostile'`)).rows[0];
    assert(v.moderation_status === 'approved' && v.is_published && v.is_verified && v.is_premium,
      'PP-011 is NOT fixed by 063 -- this must still succeed, and is why PP-011 stays OPEN');
  });

  await test('PP-011 UNCHANGED: both UPDATE policies still have no WITH CHECK', async () => {
    await reset();
    const r = await q(
      `select policyname, qual, with_check from pg_policies
        where schemaname='public' and tablename='venues' and cmd='UPDATE'
        order by policyname`);
    eq(r.rows.length, 2, 'there must still be exactly two UPDATE policies');
    for (const row of r.rows) {
      eq(row.with_check, null, `${row.policyname} must be left exactly as 063 found it`);
    }
    assert(r.rows.some((x) => x.policyname === 'Owners can update claimed venue'),
      'the claimed-owner UPDATE policy must be untouched');
  });

  await db.close();
}

// =============================================================================
// PART 5 -- idempotency and rollback fidelity
// =============================================================================
async function part5() {
  console.log('\nPART 5 -- idempotency, then rollback restores the verified live baseline exactly');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_063);
  const { q, asUser, reset, submitAsApp } = makeHelpers(db);

  await test('IDEMPOTENT: applying 063 a second time succeeds', async () => {
    await reset();
    await db.exec(MIGRATION_063);
  });

  await test('IDEMPOTENT: the grant set is unchanged after re-applying', async () => {
    await reset();
    const r = await q(
      `select column_name from information_schema.column_privileges
        where table_schema='public' and table_name='venues'
          and grantee='authenticated' and privilege_type='INSERT'
        order by column_name`);
    eq(JSON.stringify(r.rows.map((x) => x.column_name)),
       JSON.stringify(EXPECTED_GRANTED_COLUMNS),
       're-running must not accumulate or drop column grants');
  });

  await test('IDEMPOTENT: still exactly one INSERT policy and one of each trigger', async () => {
    await reset();
    const p = await q(`select count(*)::int c from pg_policies
                        where schemaname='public' and tablename='venues' and cmd='INSERT'`);
    eq(p.rows[0].c, 1);
    const t = await q(`select count(*)::int c from pg_trigger
                        where tgrelid='public.venues'::regclass and not tgisinternal
                          and tgname in ('venues_enforce_submission_invariants',
                                         'venues_enforce_submission_rate_limit')`);
    eq(t.rows[0].c, 2);
  });

  await test('IDEMPOTENT: behaviour after re-applying is identical', async () => {
    await asUser(USER_A);
    await submitAsApp(USER_A, 'After Reapply');
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
         values ('After Reapply Hostile','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_A]),
      /permission denied|invariant|cannot be claimed/i);
    await reset();
  });

  // ---------------------------------------------------------------------------
  // ROLLBACK OPTION A -- the preferred, non-degrading one. Dropping ONLY the
  // AFTER trigger must disable the PP-012 cap and leave every PP-010 protection
  // standing. Proven here so the migration's recommendation is not just advice.
  // ---------------------------------------------------------------------------
  await test('ROLLBACK A: dropping only the rate-limit trigger lifts the cap', async () => {
    await reset();
    await db.exec(`DROP TRIGGER IF EXISTS venues_enforce_submission_rate_limit ON public.venues;`);
    await asUser(USER_B);
    for (let i = 0; i < 14; i++) await submitAsApp(USER_B, `Uncapped ${i}`);
    await reset();
    const r = await q(`select count(*)::int c from public.venues where submitted_by=$1`, [USER_B]);
    eq(r.rows[0].c, 14, 'Option A must lift the cap');
  });

  await test('ROLLBACK A: every PP-010 protection still stands', async () => {
    await asUser(USER_B);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
         values ('A Rollback Hostile','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_B]),
      /permission denied|invariant|cannot be claimed/i,
      'Option A must NOT reopen the claimed_by chain');
    await reset();
    const t = await q(`select has_table_privilege('authenticated','public.venues','INSERT') as ins`);
    eq(t.rows[0].ins, false, 'Option A must not restore broad INSERT');
    const p = await q(`select count(*)::int c from pg_trigger
                        where tgrelid='public.venues'::regclass and not tgisinternal
                          and tgname='venues_enforce_submission_invariants'`);
    eq(p.rows[0].c, 1, 'the invariant trigger must survive Option A');
  });

  await test('ROLLBACK A: the trigger can be recreated in one statement', async () => {
    await reset();
    await db.exec(`CREATE TRIGGER venues_enforce_submission_rate_limit
                     AFTER INSERT ON public.venues
                     FOR EACH ROW
                     EXECUTE FUNCTION public.enforce_venue_submission_rate_limit();`);
    await asUser(USER_B);
    await throws(submitAsApp(USER_B, 'Recapped'), /submission limit reached/i,
      'restoring the trigger must restore the cap');
    await reset();
    await q(`delete from public.venues where submitted_by=$1`, [USER_B]);
  });

  await test('pre-rollback: the self-claim hole is closed', async () => {
    await asUser(USER_B);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
         values ('Pre Rollback','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_B]),
      /permission denied|invariant|cannot be claimed/i);
    await reset();
  });

  await test('rollback SQL applies cleanly', async () => {
    await reset();
    await db.exec(ROLLBACK_SQL);
  });

  await test('post-rollback: the live baseline is restored -- one-shot insert still refused', async () => {
    await asUser(USER_B);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by,
                                    moderation_status, is_published, is_verified)
         values ('Post Rollback A','W','X1 1XX',52.9,-2.6,$1,'approved',true,true)`, [USER_B]),
      /row-level security|violates/i,
      '001s policy pins visibility and must be back');
    await reset();
  });

  await test('post-rollback: the self-claim hole IS restored (proves rollback fidelity)', async () => {
    await asUser(USER_B);
    await q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
             values ('Post Rollback B','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_B]);
    await reset();
    const r = await q(`select claimed_by from public.venues where name='Post Rollback B'`);
    eq(r.rows[0].claimed_by, USER_B, 'rollback must restore the prior (vulnerable) behaviour exactly');
  });

  await test('post-rollback: exactly ONE INSERT policy, roles={public}, no phantom rate limit', async () => {
    await reset();
    const r = await q(`select policyname, roles::text as roles from pg_policies
                        where schemaname='public' and tablename='venues' and cmd='INSERT'`);
    eq(r.rows.length, 1, 'exactly one INSERT policy');
    eq(r.rows[0].policyname, 'Authenticated users can submit venues');
    assert(/\{public\}/.test(r.rows[0].roles),
      `rollback must restore roles={public}, got ${r.rows[0].roles}`);
  });

  await test('post-rollback: anon INSERT grant is restored (it exists in the live baseline)', async () => {
    await reset();
    const t = await q(`select has_table_privilege('anon','public.venues','INSERT') as ins`);
    eq(t.rows[0].ins, true, 'rollback must restore what was actually there');
  });

  await test('post-rollback: 063 helper functions and index are gone', async () => {
    await reset();
    const f = await q(
      `select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where (n.nspname='private' and p.proname in ('current_uid','enforce_venue_submission_quota'))
           or (n.nspname='public'  and p.proname in ('enforce_venue_submission_invariants',
                                                     'enforce_venue_submission_rate_limit'))`);
    eq(f.rows[0].c, 0, 'no 063 helper may survive the rollback');
    const i = await q(`select count(*)::int c from pg_indexes
                        where schemaname='public' and indexname='venues_submitted_by_created_at_idx'`);
    eq(i.rows[0].c, 0, 'the supporting index must be dropped too');
  });

  await test('re-apply 063: blocked again, ending in the intended secure state', async () => {
    await reset();
    await db.exec(MIGRATION_063);
    await asUser(USER_A);
    await throws(
      q(`insert into public.venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by)
         values ('Re-applied','W','X1 1XX',52.9,-2.6,$1,$1)`, [USER_A]),
      /permission denied|invariant|cannot be claimed/i);
    await reset();
  });

  await db.close();
}

// =============================================================================
await part0();
await part1();
await part2();
await part3();
await part4();
await part5();

console.log(`\n${'='.repeat(78)}`);
console.log(`063 venue submission trust bypass: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f.name}\n      ${f.message}`);
  process.exit(1);
}
console.log('All checks passed.');
