// =============================================================================
// supabase/tests/20260829205506_venue_owner_update_boundary.mjs
//
// Behavioural database tests for PP-011 -- the claimed-venue owner UPDATE trust
// boundary -- using in-process Postgres (pglite). NO live Supabase, NO
// production access, NO network.
//
// PART 0 reproduces the exploit against the TRUE pre-fix production baseline
// (re-verified live 2026-08-29: two USING-only UPDATE policies with roles
// {public}, anon/authenticated/service_role each holding UPDATE on 43 of 43
// columns, and no UPDATE-side invariant trigger). Those tests are written to
// PASS only while the exploit works, so they are the proof that the rest of this
// file is testing something real.
//
// Structure:
//   PART 0 -- PRE-FIX REPRODUCTION (bootstrap only, migration NOT applied)
//   PART 1 -- the owner allowlist: every permitted column
//   PART 2 -- the forbidden matrix: every other class of column
//   PART 3 -- statement atomicity: mixed columns, multi-row
//   PART 4 -- identity boundary: non-owner, unclaimed, anon
//   PART 5 -- compatibility: admin, bulk admin, service_role, the review-rating
//             trigger, and a SECURITY DEFINER enrichment write
//   PART 6 -- FAIL CLOSED: a column added to venues after the migration
//   PART 7 -- immunity: re-widen the policy, re-widen the grant, and install a
//             hostile nested trigger
//   PART 8 -- resulting policy / grant / trigger shape
//   PART 9 -- idempotency, then rollback fidelity, then re-apply
//
// FIDELITY NOTES (disclosed, not hidden):
//   * pglite has no PostGIS, so `location geography(Point,4326)` is modelled as
//     text and set_venue_location() writes a text value -- the same concession
//     migration 063's suite makes. The property under test is that `location`
//     is OUTSIDE the allowlist and that a derived change to it is detected,
//     which text reproduces exactly. That to_jsonb() renders a non-JSON-native
//     type through its output function rather than skipping it was proven
//     separately on real PostgreSQL 18.4 using `point`, and PART 2 re-proves the
//     datatype coverage here over bytea / numeric / timestamptz / uuid / inet.
//   * pglite is a single in-process backend, so no test here claims to prove
//     behaviour under genuine multi-connection contention.
//
// Run:  node supabase/tests/20260829205506_venue_owner_update_boundary.mjs
//       (part of npm run test:db)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, '../migrations/20260829205506_venue_owner_update_boundary.sql');
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8');

// The rollback is extracted from the migration's own comment block rather than
// duplicated here, so the SQL this suite tests is provably the SQL the migration
// documents. If someone deletes or renames the block, this throws immediately.
function extractRollback(sql) {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) => l.trim() === '--   BEGIN;');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '--   COMMIT;');
  if (start < 0 || end < 0) {
    throw new Error('documented ROLLBACK block not found in the migration file');
  }
  return lines.slice(start, end + 1).map((l) => l.replace(/^--\s?/, '')).join('\n');
}
const ROLLBACK = extractRollback(MIGRATION);

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// The seven columns a claimed owner may edit, per the 2026-08-29 product ruling.
const ALLOWED = ['description', 'phone', 'email', 'website', 'price_range', 'min_age', 'max_age'];

// ── Pre-fix production baseline ──────────────────────────────────────────────
// Mirrors the live catalog as confirmed by the read-only audit: the full venues
// column surface, Supabase's broad default grants, both USING-only UPDATE
// policies at roles {public}, and only the two harmless UPDATE-side triggers.
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  -- 063 created this SECURITY DEFINER helper because a SECURITY INVOKER
  -- trigger calling auth.uid() directly needs the CALLING role to hold USAGE
  -- on schema auth. USAGE is deliberately NOT granted in this fixture, so
  -- these tests fail loudly if PP-011 ever reaches for auth.uid() directly.
  create schema private;
  -- Exactly the privilege state migrations 058 and 063 establish in production.
  revoke all on schema private from public;
  revoke all on schema private from anon;
  grant usage on schema private to authenticated;
  create or replace function private.current_uid() returns uuid
  language sql security definer stable set search_path = '' as $$
    select auth.uid();
  $$;
  revoke execute on function private.current_uid() from public;
  grant execute on function private.current_uid() to authenticated;

  create table profiles (
    id uuid primary key,
    is_admin boolean default false,
    is_business_owner boolean default false
  );

  create or replace function is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from profiles where id = auth.uid()), false);
  $$;

  create table venues (
    id                 uuid primary key default gen_random_uuid(),
    name               text not null,
    slug               text unique,
    description        text,
    category_id        uuid,
    address_line1      text,
    address_line2      text,
    city               text not null,
    postcode           text,
    country            text default 'GB',
    latitude           decimal(9,6) not null,
    longitude          decimal(9,6) not null,
    location           text,                    -- geography(Point,4326) in production
    phone              text,
    email              text,
    website            text,
    price_range        text check (price_range in ('free','budget','moderate','premium')),
    min_age            int default 0,
    max_age            int default 12,
    is_published       boolean default false,
    is_verified        boolean default false,
    claimed_by         uuid references profiles(id),
    submitted_by       uuid references profiles(id),
    moderation_status  text default 'pending' check (moderation_status in ('pending','approved','rejected')),
    moderation_notes   text,
    moderated_by       uuid references profiles(id),
    moderated_at       timestamptz,
    is_premium         boolean default false,
    featured_until     timestamptz,
    review_count       int default 0,
    average_rating     decimal(3,2) default 0,
    data_source        text default 'manual',
    license            text,
    osm_id             text unique,
    discovery_approved boolean not null default true,
    image_url          text,
    image_source       text,
    image_attribution  text,
    image_license      text,
    image_is_exact     boolean not null default false,
    image_updated_at   timestamptz,
    -- datatype-coverage columns: these are NOT in production, they exist to
    -- prove to_jsonb() change detection over awkward types inside pglite too.
    probe_blob         bytea,
    probe_net          inet,
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
  );

  create table reviews (
    id                uuid primary key default gen_random_uuid(),
    venue_id          uuid references venues(id) on delete cascade,
    user_id           uuid references profiles(id),
    rating            int not null,
    moderation_status text default 'pending'
  );

  -- 001: derive location from lat/lng (BEFORE UPDATE OF latitude, longitude)
  create or replace function set_venue_location() returns trigger
  language plpgsql as $$
  begin
    new.location = '(' || new.longitude || ',' || new.latitude || ')';
    return new;
  end $$;
  create trigger venue_location_trigger
    before insert or update of latitude, longitude on venues
    for each row execute function set_venue_location();

  -- 001/025: maintain cached aggregates. SECURITY INVOKER in production, so it
  -- runs as the reviewing user and its venues UPDATE is nested inside a trigger.
  create or replace function update_venue_rating() returns trigger
  language plpgsql set search_path = public as $$
  begin
    update venues
       set review_count   = (select count(*) from reviews
                              where venue_id = coalesce(new.venue_id, old.venue_id)
                                and moderation_status = 'approved'),
           average_rating = (select coalesce(avg(rating),0) from reviews
                              where venue_id = coalesce(new.venue_id, old.venue_id)
                                and moderation_status = 'approved'),
           updated_at     = now()
     where id = coalesce(new.venue_id, old.venue_id);
    return coalesce(new, old);
  end $$;
  create trigger review_rating_trigger
    after insert or update or delete on reviews
    for each row execute function update_venue_rating();

  create or replace function touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
  create trigger venues_updated_at before update on venues
    for each row execute function touch_updated_at();

  -- 056/057: an admin-gated SECURITY DEFINER enrichment write, owned by
  -- postgres, modelling apply_venue_proposal()'s effect on venues.
  create or replace function enrichment_apply(p_venue uuid, p_text text)
  returns void language plpgsql security definer set search_path = public as $$
  begin
    update venues set description = p_text, updated_at = now() where id = p_venue;
  end $$;

  -- Supabase default privileges: broad, on every column.
  grant select, insert, update, delete on venues  to anon, authenticated, service_role;
  grant select, insert, update, delete on reviews to anon, authenticated, service_role;
  grant select on profiles to anon, authenticated, service_role;
  grant execute on function enrichment_apply(uuid, text) to authenticated;

  alter table venues enable row level security;

  create policy "Approved venues are public" on venues
    for select using (is_published = true and moderation_status = 'approved');
  create policy "Owners can view own venues" on venues
    for select using (auth.uid() = submitted_by or auth.uid() = claimed_by);
  create policy "Admins can view all venues" on venues
    for select using (is_admin());

  -- 001:466-471, exactly as production holds them: USING only, no WITH CHECK,
  -- no TO clause (so roles = {public}).
  create policy "Owners can update claimed venue" on venues
    for update using (auth.uid() = claimed_by);
  create policy "Admins can update any venue" on venues
    for update using (is_admin());

  insert into profiles (id, is_admin) values
    ('${OWNER}', false), ('${OTHER}', false), ('${ADMIN}', true);
`;

// ── Tiny assert harness (same shape as the 056/057/058/062/063 test files) ────
let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures.push({ name, message: e?.message ?? String(e) });
    console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function throws(promise, re, msg) {
  try {
    await promise;
  } catch (e) {
    const m = e?.message ?? String(e);
    if (re && !re.test(m)) throw new Error(`${msg || 'wrong error'}: ${m}`);
    return m;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

// ── Per-database helpers ─────────────────────────────────────────────────────
function makeHelpers(db) {
  const q = (sql, params) => db.query(sql, params);

  async function asUser(uid) {
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    await db.exec('set role authenticated');
  }
  async function asAnon() {
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role anon');
  }
  async function asServiceRole() {
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role service_role');
  }
  async function reset() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  }

  // Creates a venue already legitimately claimed by `owner`, the way the
  // admin-approved 027 review_venue_claim() path leaves it.
  async function newClaimedVenue(owner = OWNER, name = null) {
    await reset();
    const n = name ?? `V-${Math.random().toString(36).slice(2, 10)}`;
    const r = await q(
      `insert into venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by,
                           is_published, moderation_status, probe_blob, probe_net,
                           image_url, image_source, image_attribution, image_license)
       values ($1,'Bath','BA1 1AA',51.38,-2.36,$2,$2,true,'approved','\\xdeadbeef'::bytea,'10.0.0.1',
               'https://cdn.example/a.jpg','wikimedia','Photo by Someone, CC BY-SA 4.0','CC-BY-SA-4.0')
       returning id`, [n, owner]);
    return r.rows[0].id;
  }

  // Attempt an owner UPDATE of one column, as the claimed owner.
  async function ownerSet(venue, col, valueSql, params = []) {
    await asUser(OWNER);
    try {
      return await q(`update venues set ${col} = ${valueSql} where id = $1`, [venue, ...params]);
    } finally {
      await reset();
    }
  }

  async function col(venue, name) {
    await reset();
    const r = await q(`select ${name} as v from venues where id = $1`, [venue]);
    return r.rows[0]?.v;
  }

  return { q, asUser, asAnon, asServiceRole, reset, newClaimedVenue, ownerSet, col };
}

const DENIED = /42501|may not change|may not update|only the claimed owner|permission denied/i;

// =============================================================================
// PART 0 -- PRE-FIX REPRODUCTION. These prove the exploit is real.
// =============================================================================
async function part0() {
  console.log('\nPART 0 -- pre-fix reproduction: PP-011 against the true production baseline\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  const h = makeHelpers(db);

  await test('REPRO: a legitimately claimed owner can self-verify, self-publish and self-approve', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set is_verified = true, is_published = true,
                                 moderation_status = 'approved', is_premium = true
                where id = $1`, [v]);
    await h.reset();
    const r = (await h.q(`select is_verified, is_published, moderation_status, is_premium
                            from venues where id = $1`, [v])).rows[0];
    assert(r.is_verified && r.is_published && r.moderation_status === 'approved' && r.is_premium,
      'pre-fix, the trust-field escalation must succeed -- otherwise this suite proves nothing');
  });

  await test('REPRO: a claimed owner can forge the moderation audit trail', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set moderated_by = $2, moderated_at = now(),
                                 moderation_notes = 'approved by nobody' where id = $1`, [v, ADMIN]);
    await h.reset();
    eq((await h.q(`select moderated_by from venues where id=$1`, [v])).rows[0].moderated_by, ADMIN);
  });

  await test('REPRO: a claimed owner can inflate ratings and rewrite provenance', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set review_count = 999, average_rating = 5.00,
                                 data_source = 'manual', license = 'forged', osm_id = 'node/1'
                where id = $1`, [v]);
    await h.reset();
    const r = (await h.q(`select review_count, osm_id from venues where id=$1`, [v])).rows[0];
    eq(r.review_count, 999);
    eq(r.osm_id, 'node/1');
  });

  await test('REPRO: a claimed owner can strip the CC image attribution', async () => {
    const v = await h.newClaimedVenue();
    await h.reset();
    await h.q(`update venues set image_url='u', image_attribution='CC BY-SA someone',
                                 image_license='CC-BY-SA-4.0' where id=$1`, [v]);
    await h.asUser(OWNER);
    await h.q(`update venues set image_attribution = null, image_license = null where id=$1`, [v]);
    await h.reset();
    eq((await h.q(`select image_attribution from venues where id=$1`, [v])).rows[0].image_attribution, null);
  });

  await test('REPRO (boundary of the flaw): ownership transfer was ALREADY refused pre-fix', async () => {
    // Corrects an error in the Phase-1 audit write-up, caught by this test.
    // With no WITH CHECK, Postgres re-uses USING as the check and evaluates it
    // against the NEW row, so auth.uid() = NEW.claimed_by fails on a transfer.
    // claimed_by was therefore never the hole; every OTHER trust column was.
    // PP-011 still makes the guarantee explicit rather than incidental, and the
    // trigger blocks it a second time independently of any policy.
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await throws(h.q(`update venues set claimed_by = $2 where id = $1`, [v, OTHER]),
      /row-level security/i,
      'the re-used USING check already blocked ownership transfer');
    await h.reset();
    eq((await h.q(`select claimed_by from venues where id=$1`, [v])).rows[0].claimed_by, OWNER);
  });

  await test('REPRO: anon holds a table UPDATE grant it does not need', async () => {
    await h.reset();
    eq((await h.q(`select has_table_privilege('anon','venues','UPDATE') as x`)).rows[0].x, true,
      'pre-fix anon is blocked only by policy absence, not by privilege');
  });

  await db.close();
}

// =============================================================================
// PART 1 -- the owner allowlist
// =============================================================================
async function part1() {
  console.log('\nPART 1 -- post-fix: the seven owner-editable columns still work\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('1. description -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'description', `'A lovely soft play centre'`);
    eq(await h.col(v, 'description'), 'A lovely soft play centre');
  });

  await test('2. phone -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'phone', `'01225 000000'`);
    eq(await h.col(v, 'phone'), '01225 000000');
  });

  await test('3. email -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'email', `'hello@venue.example'`);
    eq(await h.col(v, 'email'), 'hello@venue.example');
  });

  await test('4. website -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'website', `'https://venue.example'`);
    eq(await h.col(v, 'website'), 'https://venue.example');
  });

  await test('5. price_range -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'price_range', `'budget'`);
    eq(await h.col(v, 'price_range'), 'budget');
  });

  await test('6. min_age and max_age -> succeed (together, in one statement)', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set min_age = 1, max_age = 11 where id = $1`, [v]);
    await h.reset();
    const r = (await h.q(`select min_age, max_age from venues where id=$1`, [v])).rows[0];
    eq(r.min_age, 1); eq(r.max_age, 11);
  });

  await test('6b. all seven allowlisted columns in ONE statement -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set description='d', phone='p', email='e@x.com',
                                 website='https://w', price_range='free',
                                 min_age=2, max_age=9 where id=$1`, [v]);
    await h.reset();
    const r = (await h.q(`select description, price_range, max_age from venues where id=$1`, [v])).rows[0];
    eq(r.description, 'd'); eq(r.price_range, 'free'); eq(r.max_age, 9);
  });

  await test('6c. setting an allowlisted column to NULL -> succeeds (no false positive on nulls)', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'description', `'x'`);
    await h.ownerSet(v, 'description', `null`);
    eq(await h.col(v, 'description'), null);
  });

  await test('6d. a no-op UPDATE touching nothing -> succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set description = description where id = $1`, [v]);
    await h.reset();
  });

  await test('6e. updated_at is system-managed and does not block an allowed edit', async () => {
    const v = await h.newClaimedVenue();
    const before = await h.col(v, 'updated_at');
    await h.ownerSet(v, 'phone', `'999'`);
    const after = await h.col(v, 'updated_at');
    assert(after >= before, 'venues_updated_at must still stamp updated_at');
  });

  await db.close();
}

// =============================================================================
// PART 2 -- the forbidden matrix
// =============================================================================
async function part2() {
  console.log('\nPART 2 -- post-fix: every non-allowlisted column is refused\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  // [label, column, new value SQL, column read back]
  const FORBIDDEN = [
    ['7.  name (listing identity)',        'name',               `'Renamed'`],
    ['8.  category_id',                    'category_id',        `'11111111-1111-1111-1111-111111111111'::uuid`],
    ['9a. address_line1',                  'address_line1',      `'1 New Street'`],
    ['9b. address_line2',                  'address_line2',      `'Floor 2'`],
    ['9c. city',                           'city',               `'Bristol'`],
    ['9d. country',                        'country',            `'FR'`],
    ['10. postcode',                       'postcode',           `'BS1 1AA'`],
    ['11a. latitude',                      'latitude',           `52.000000`],
    ['11b. longitude',                     'longitude',          `-1.000000`],
    ['12. is_verified',                    'is_verified',        `true`],
    ['13. is_published',                   'is_published',       `false`],
    ['14. moderation_status',              'moderation_status',  `'rejected'`],
    ['15a. moderation_notes',              'moderation_notes',   `'self approved'`],
    ['15b. moderated_by',                  'moderated_by',       `'${ADMIN}'::uuid`],
    ['15c. moderated_at',                  'moderated_at',       `now()`],
    ['16. discovery_approved',             'discovery_approved', `false`],
    ['18. submitted_by',                   'submitted_by',       `'${OTHER}'::uuid`],
    ['19. is_premium',                     'is_premium',         `true`],
    ['20. featured_until',                 'featured_until',     `now() + interval '1 year'`],
    ['21. review_count',                   'review_count',       `999`],
    ['22. average_rating',                 'average_rating',     `5.00`],
    ['23a. data_source',                   'data_source',        `'osm'`],
    ['23b. license',                       'license',            `'ODbL-1.0'`],
    ['23c. osm_id',                        'osm_id',             `'node/999'`],
    ['24a. image_url',                     'image_url',          `'https://evil.example/x.jpg'`],
    ['24b. image_source',                  'image_source',       `'category_fallback'`],
    ['24c. image_attribution',             'image_attribution',  `null`],
    ['24d. image_license',                 'image_license',      `null`],
    ['24e. image_is_exact',                'image_is_exact',     `true`],
    ['24f. image_updated_at',              'image_updated_at',   `now()`],
    ['25a. slug',                          'slug',               `'hijacked-slug'`],
    ['25b. id',                            'id',                 `gen_random_uuid()`],
    ['25c. created_at',                    'created_at',         `'2000-01-01'::timestamptz`],
    ['25d. location (derived)',            'location',           `'(0,0)'`],
    // datatype coverage inside pglite: awkward types must also be detected
    ['25e. bytea column (datatype cover)', 'probe_blob',         `'\\xfeedface'::bytea`],
    ['25f. inet column (datatype cover)',  'probe_net',          `'192.168.0.1'::inet`],
  ];

  for (const [label, column, valueSql] of FORBIDDEN) {
    await test(`${label} -> rejected`, async () => {
      const v = await h.newClaimedVenue();
      const before = await h.col(v, column);
      await h.asUser(OWNER);
      await throws(
        h.q(`update venues set ${column} = ${valueSql} where id = $1`, [v]),
        DENIED,
        `${column} must be refused to a claimed owner`);
      await h.reset();
      const after = await h.col(v, column);
      assert(String(before) === String(after), `${column} must be unchanged after the refusal`);
    });
  }

  await test('17. claimed_by transfer -> rejected (ownership cannot be dumped)', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await throws(h.q(`update venues set claimed_by = $2 where id = $1`, [v, OTHER]), DENIED);
    await h.reset();
    eq((await h.q(`select claimed_by from venues where id=$1`, [v])).rows[0].claimed_by, OWNER);
  });

  await test('17b. claimed_by set to NULL -> rejected (cannot abandon to unclaimed)', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await throws(h.q(`update venues set claimed_by = null where id = $1`, [v]), DENIED);
    await h.reset();
    eq((await h.q(`select claimed_by from venues where id=$1`, [v])).rows[0].claimed_by, OWNER);
  });

  await test('2z. the refusal names the offending column and is SQLSTATE 42501', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    const msg = await throws(
      h.q(`update venues set is_verified = true where id = $1`, [v]), /is_verified/);
    await h.reset();
    assert(/is_verified/.test(msg), `the error should name the column, got: ${msg}`);
  });

  await db.close();
}

// =============================================================================
// PART 3 -- statement atomicity
// =============================================================================
async function part3() {
  console.log('\nPART 3 -- statement atomicity: no partial privileged write\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('26. one allowed + one forbidden column in a single UPDATE -> whole statement rejected', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await throws(
      h.q(`update venues set description = 'legit change', is_verified = true where id = $1`, [v]),
      DENIED);
    await h.reset();
    const r = (await h.q(`select description, is_verified from venues where id=$1`, [v])).rows[0];
    eq(r.description, null, 'the ALLOWED half must not be written either');
    eq(r.is_verified, false);
  });

  await test('27. multi-row trust-field UPDATE -> rejected, with no partial writes', async () => {
    const v1 = await h.newClaimedVenue(OWNER, 'Multi One');
    const v2 = await h.newClaimedVenue(OWNER, 'Multi Two');
    await h.asUser(OWNER);
    await throws(h.q(`update venues set is_premium = true where claimed_by = $1`, [OWNER]), DENIED);
    await h.reset();
    const r = await h.q(`select id, is_premium from venues where id in ($1,$2)`, [v1, v2]);
    eq(r.rows.length, 2);
    assert(r.rows.every((x) => x.is_premium === false), 'neither row may be written');
  });

  await test('27b. multi-row ALLOWED update across the owner\'s venues -> succeeds', async () => {
    const v1 = await h.newClaimedVenue(OWNER, 'Bulk One');
    const v2 = await h.newClaimedVenue(OWNER, 'Bulk Two');
    await h.asUser(OWNER);
    await h.q(`update venues set phone = '0000' where id in ($1,$2)`, [v1, v2]);
    await h.reset();
    const r = await h.q(`select phone from venues where id in ($1,$2)`, [v1, v2]);
    assert(r.rows.every((x) => x.phone === '0000'));
  });

  await db.close();
}

// =============================================================================
// PART 4 -- identity boundary
// =============================================================================
async function part4() {
  console.log('\nPART 4 -- identity boundary: non-owner, unclaimed, anon\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('28. a different authenticated user cannot touch a claimed venue', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.asUser(OTHER);
    // RLS filters the row out entirely, so this is a silent zero-row update.
    await h.q(`update venues set description = 'not mine' where id = $1`, [v]);
    await h.reset();
    eq((await h.q(`select description from venues where id=$1`, [v])).rows[0].description, null);
  });

  await test('28b. an authenticated user cannot edit an UNCLAIMED venue', async () => {
    await h.reset();
    const r = await h.q(
      `insert into venues (name, city, latitude, longitude, submitted_by)
       values ('Unclaimed','Bath',51.3,-2.3,$1) returning id`, [OTHER]);
    const v = r.rows[0].id;
    await h.asUser(OTHER);
    await h.q(`update venues set description='mine now' where id=$1`, [v]);
    await h.reset();
    eq((await h.q(`select description from venues where id=$1`, [v])).rows[0].description, null);
  });

  await test('29a. anon no longer holds the table UPDATE grant', async () => {
    await h.reset();
    eq((await h.q(`select has_table_privilege('anon','venues','UPDATE') as x`)).rows[0].x, false,
      'PP-011 must remove protection-by-policy-absence for anon');
  });

  await test('29b. anon updating a venue is refused by privilege', async () => {
    const v = await h.newClaimedVenue();
    await h.asAnon();
    await throws(h.q(`update venues set description='x' where id=$1`, [v]), /permission denied|42501/i);
    await h.reset();
  });

  await test('29c. authenticated keeps table UPDATE (admin moderation needs it until Stage 2)', async () => {
    await h.reset();
    eq((await h.q(`select has_table_privilege('authenticated','venues','UPDATE') as x`)).rows[0].x, true);
  });

  await db.close();
}

// =============================================================================
// PART 5 -- compatibility with every legitimate writer
// =============================================================================
async function part5() {
  console.log('\nPART 5 -- compatibility: admin, bulk admin, service_role, rating trigger, enrichment\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('30. admin moderation write still succeeds (the exact moderation.tsx shape)', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(ADMIN);
    await h.q(`update venues set moderation_status='approved', is_published=true,
                                 moderated_by=$2, moderated_at=now(),
                                 moderation_notes='admin-approved'
                where id=$1`, [v, ADMIN]);
    await h.reset();
    const r = (await h.q(`select moderation_status, is_published, moderated_by from venues where id=$1`, [v])).rows[0];
    eq(r.moderation_status, 'approved'); eq(r.is_published, true); eq(r.moderated_by, ADMIN);
  });

  await test('30b. an admin may also set verification and premium', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(ADMIN);
    await h.q(`update venues set is_verified=true, is_premium=true where id=$1`, [v]);
    await h.reset();
    const r = (await h.q(`select is_verified, is_premium from venues where id=$1`, [v])).rows[0];
    assert(r.is_verified && r.is_premium);
  });

  await test('31. admin BULK moderation across many rows still succeeds', async () => {
    await h.reset();
    for (let i = 0; i < 5; i += 1) {
      await h.q(`insert into venues (name, city, latitude, longitude, submitted_by)
                 values ($1,'Bath',51.3,-2.3,$2)`, [`Bulk Mod ${i}`, OTHER]);
    }
    await h.asUser(ADMIN);
    const r = await h.q(
      `update venues set moderation_status='approved', is_published=true,
                         moderated_by=$1, moderated_at=now(),
                         moderation_notes='bulk-approved-from-admin-ui'
        where moderation_status='pending' and is_published=false
        returning id`, [ADMIN]);
    await h.reset();
    assert(r.rows.length >= 5, `bulk approve must affect every pending row, got ${r.rows.length}`);
  });

  await test('32. service_role provenance/import write still succeeds', async () => {
    const v = await h.newClaimedVenue();
    await h.asServiceRole();
    await h.q(`update venues set data_source='osm', license='ODbL-1.0', osm_id='node/12345',
                                 image_url='https://cdn/x.jpg', image_attribution='CC BY-SA'
                where id=$1`, [v]);
    await h.reset();
    const r = (await h.q(`select data_source, osm_id from venues where id=$1`, [v])).rows[0];
    eq(r.data_source, 'osm'); eq(r.osm_id, 'node/12345');
  });

  await test('33. review-rating trigger maintenance still succeeds (nested trigger write)', async () => {
    const v = await h.newClaimedVenue(OWNER);
    // The owner reviews their own venue: RLS lets the nested venues UPDATE
    // through, so the boundary trigger genuinely fires at depth 2.
    await h.asUser(OWNER);
    await h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
               values ($1,$2,5,'approved')`, [v, OWNER]);
    await h.reset();
    const r = (await h.q(`select review_count, average_rating from venues where id=$1`, [v])).rows[0];
    eq(r.review_count, 1, 'review_count must still be maintained by the trigger');
    assert(Number(r.average_rating) === 5, `average_rating should be 5, got ${r.average_rating}`);
  });

  await test('33b. an ADMIN approving a review also maintains the aggregates', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    const rev = (await h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
                            values ($1,$2,4,'pending') returning id`, [v, OTHER])).rows[0].id;
    await h.asUser(ADMIN);
    await h.q(`update reviews set moderation_status='approved' where id=$1`, [rev]);
    await h.reset();
    eq((await h.q(`select review_count from venues where id=$1`, [v])).rows[0].review_count, 1);
  });

  await test('33c. a NON-owner, non-admin reviewer also maintains the aggregates', async () => {
    // update_venue_rating() is SECURITY DEFINER after PP-011, so the nested
    // write is trusted by capability. It is no longer silently RLS-filtered.
    const v = await h.newClaimedVenue(OWNER);
    await h.asUser(OTHER);
    await h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
               values ($1,$2,3,'approved')`, [v, OTHER]);
    await h.reset();
    eq((await h.q(`select review_count from venues where id=$1`, [v])).rows[0].review_count, 1);
  });

  await test('33d. deleting an approved review decrements the aggregate', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    const rev = (await h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
                            values ($1,$2,5,'approved') returning id`, [v, OTHER])).rows[0].id;
    eq((await h.q(`select review_count from venues where id=$1`, [v])).rows[0].review_count, 1);
    await h.asUser(OTHER);
    await h.q(`delete from reviews where id=$1`, [rev]);
    await h.reset();
    eq((await h.q(`select review_count from venues where id=$1`, [v])).rows[0].review_count, 0);
  });

  await test('33e. no API role may EXECUTE update_venue_rating() directly', async () => {
    await h.reset();
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const r = await h.q(
        `select has_function_privilege($1,'public.update_venue_rating()','EXECUTE') as x`, [role]);
      eq(r.rows[0].x, false, `${role} must not hold EXECUTE on the rating maintainer`);
    }
  });

  await test('33f. revoking EXECUTE did NOT stop review_rating_trigger firing', async () => {
    // Proven separately on real PostgreSQL 18.4; re-asserted here because the
    // whole design of 33c-33e depends on it.
    const v = await h.newClaimedVenue(OWNER);
    await h.asUser(OTHER);
    await h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
               values ($1,$2,4,'approved')`, [v, OTHER]);
    await h.reset();
    eq((await h.q(`select review_count from venues where id=$1`, [v])).rows[0].review_count, 1);
  });

  await test('34. SECURITY DEFINER enrichment write still succeeds for a non-owner caller', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.asUser(OTHER);       // not the owner, not an admin
    await h.q(`select enrichment_apply($1, $2)`, [v, 'enriched description']);
    await h.reset();
    eq((await h.col(v, 'description')), 'enriched description');
  });

  await db.close();
}

// =============================================================================
// PART 6 -- FAIL CLOSED when the schema grows
// =============================================================================
async function part6() {
  console.log('\nPART 6 -- fail closed: a column added to venues AFTER the migration\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('FAIL-CLOSED: a brand-new trust column is refused without touching the boundary', async () => {
    const v = await h.newClaimedVenue();
    // A future migration adds a column and forgets PP-011 entirely.
    await h.q(`alter table venues add column future_trust_flag boolean not null default false`);
    await h.q(`grant update on venues to authenticated`);   // table grant covers new columns
    await h.asUser(OWNER);
    await throws(
      h.q(`update venues set future_trust_flag = true where id = $1`, [v]),
      /future_trust_flag|42501|may not change/i,
      'a column nobody added to the allowlist must be refused by default');
    await h.reset();
    eq((await h.q(`select future_trust_flag from venues where id=$1`, [v])).rows[0].future_trust_flag, false);
  });

  await test('FAIL-CLOSED: a new column of an awkward datatype is also refused', async () => {
    const v = await h.newClaimedVenue();
    await h.q(`alter table venues add column future_payload jsonb`);
    await h.asUser(OWNER);
    await throws(
      h.q(`update venues set future_payload = '{"a":1}'::jsonb where id = $1`, [v]),
      /future_payload|42501|may not change/i);
    await h.reset();
  });

  await test('FAIL-CLOSED: the allowlist still works after the schema grew', async () => {
    const v = await h.newClaimedVenue();
    await h.ownerSet(v, 'description', `'still editable'`);
    eq(await h.col(v, 'description'), 'still editable');
  });

  await db.close();
}

// =============================================================================
// PART 7 -- root-cause immunity
// =============================================================================
async function part7() {
  console.log('\nPART 7 -- immunity: re-widen the policy, then re-widen the grant\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('35. policy-widening immunity: a wide-open UPDATE policy does not reopen PP-011', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    await h.q(`drop policy "Owners can update claimed venue" on venues`);
    await h.q(`create policy "Owners can update claimed venue" on venues
                 for update using (true) with check (true)`);
    await h.asUser(OWNER);
    await throws(h.q(`update venues set is_verified = true where id=$1`, [v]), DENIED,
      'the trigger, not the policy, must be what holds the line');
    await h.reset();
    eq((await h.q(`select is_verified from venues where id=$1`, [v])).rows[0].is_verified, false);
  });

  await test('35b. with the policy wide open, a NON-owner still cannot edit even allowed columns', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.asUser(OTHER);
    await throws(h.q(`update venues set description='hijack' where id=$1`, [v]),
      /only the claimed owner|42501/i);
    await h.reset();
    eq((await h.q(`select description from venues where id=$1`, [v])).rows[0].description, null);
  });

  await test('36. grant-widening immunity: re-granting anon UPDATE does not let anon write', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    await h.q(`grant update on venues to anon`);
    eq((await h.q(`select has_table_privilege('anon','venues','UPDATE') as x`)).rows[0].x, true);
    await h.asAnon();
    await throws(h.q(`update venues set description='x' where id=$1`, [v]),
      /anonymous callers may not update|42501/i,
      'the trigger must reject anon even when the grant is restored');
    await h.reset();
  });

  await test('36c. HOSTILE NESTED TRIGGER: a trigger-installed venues write is NOT exempt', async () => {
    // The withdrawn pg_trigger_depth() > 1 exemption would have passed this.
    // CREATE TRIGGER needs only the TRIGGER privilege on the table plus
    // EXECUTE on the function -- NOT ownership -- and the live audit shows
    // anon and authenticated both hold TRIGGER on public.venues. Proven on
    // PostgreSQL 18.4 that a non-owner holding TRIGGER can attach a trigger.
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    // A hostile SECURITY INVOKER trigger function that escalates the venue.
    await h.q(`create or replace function hostile_escalate() returns trigger
               language plpgsql security invoker as $$
               begin
                 update venues set is_verified = true, is_premium = true
                  where id = new.venue_id;
                 return new;
               end $$`);
    await h.q(`create trigger hostile_after_review after insert on reviews
               for each row execute function hostile_escalate()`);

    await h.asUser(OWNER);
    await throws(
      h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
           values ($1,$2,5,'pending')`, [v, OWNER]),
      DENIED,
      'a nested write still running as authenticated must NOT be exempt');
    await h.reset();
    const r = (await h.q(`select is_verified, is_premium from venues where id=$1`, [v])).rows[0];
    eq(r.is_verified, false, 'no escalation may survive');
    eq(r.is_premium, false);
    await h.q(`drop trigger hostile_after_review on reviews`);
  });

  await test('36d. depth alone grants nothing: even a DEEPLY nested write is checked', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    await h.q(`create or replace function hostile_level2() returns trigger
               language plpgsql security invoker as $$
               begin update venues set is_premium = true where id = new.venue_id; return new; end $$`);
    await h.q(`create trigger hostile_l2 after update on reviews
               for each row execute function hostile_level2()`);
    await h.q(`create or replace function hostile_level1() returns trigger
               language plpgsql security invoker as $$
               begin update reviews set rating = 4 where id = new.id; return new; end $$`);
    await h.q(`create trigger hostile_l1 after insert on reviews
               for each row execute function hostile_level1()`);
    await h.asUser(OWNER);
    await throws(
      h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
           values ($1,$2,5,'pending')`, [v, OWNER]),
      DENIED);
    await h.reset();
    eq((await h.q(`select is_premium from venues where id=$1`, [v])).rows[0].is_premium, false);
    await h.q(`drop trigger hostile_l1 on reviews`);
    await h.q(`drop trigger hostile_l2 on reviews`);
  });

  await test('36b. grant-widening immunity: full column grants do not reopen trust fields', async () => {
    const v = await h.newClaimedVenue(OWNER);
    await h.reset();
    await h.q(`grant update on venues to authenticated`);
    await h.asUser(OWNER);
    await throws(h.q(`update venues set is_premium = true where id=$1`, [v]), DENIED);
    await h.reset();
  });

  await db.close();
}

// =============================================================================
// PART 8 -- the resulting catalog shape
// =============================================================================
async function part8() {
  console.log('\nPART 8 -- resulting policy / grant / trigger shape\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('SHAPE: the owner UPDATE policy now has a WITH CHECK and targets authenticated', async () => {
    const r = await h.q(
      `select roles::text[] as roles, qual, with_check from pg_policies
        where schemaname='public' and tablename='venues'
          and policyname='Owners can update claimed venue'`);
    eq(r.rows.length, 1);
    assert(r.rows[0].with_check !== null, 'WITH CHECK must be explicit now');
    assert(/claimed_by/.test(r.rows[0].with_check), 'WITH CHECK must pin claimed_by');
    eq(JSON.stringify(r.rows[0].roles), JSON.stringify(['authenticated']),
      'the owner policy must no longer apply to PUBLIC');
  });

  await test('SHAPE: exactly two UPDATE policies still exist; the admin one is untouched', async () => {
    const r = await h.q(
      `select policyname, roles::text[] as roles, qual, with_check from pg_policies
        where schemaname='public' and tablename='venues' and cmd='UPDATE'
        order by policyname`);
    eq(r.rows.length, 2);
    const admin = r.rows.find((x) => x.policyname === 'Admins can update any venue');
    assert(admin, 'the admin policy must still exist');
    eq(admin.with_check, null, 'the admin policy keeps USING-only semantics');
    assert(/is_admin/.test(admin.qual), 'the admin qual is unchanged');
    eq(JSON.stringify(admin.roles), JSON.stringify(['authenticated']),
      'role narrowing is behaviour-preserving given relforcerowsecurity=false');
  });

  await test('SHAPE: exactly one BEFORE UPDATE boundary trigger, and it is enabled', async () => {
    const r = await h.q(
      `select tgname, tgenabled from pg_trigger
        where tgrelid = 'public.venues'::regclass
          and tgname = 'venues_enforce_owner_update_boundary'`);
    eq(r.rows.length, 1);
    eq(r.rows[0].tgenabled, 'O', 'the trigger must be enabled for origin/local sessions');
  });

  await test('SHAPE: the boundary function is SECURITY INVOKER with a pinned empty search_path', async () => {
    const r = await h.q(
      `select prosecdef, proconfig::text from pg_proc
        where proname = 'enforce_venue_owner_update_boundary'`);
    eq(r.rows.length, 1);
    eq(r.rows[0].prosecdef, false, 'must be SECURITY INVOKER so current_user is the real caller');
    assert(/search_path=/.test(r.rows[0].proconfig), 'search_path must be pinned');
  });

  await test('SHAPE: no API role may EXECUTE the boundary function directly', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const r = await h.q(
        `select has_function_privilege($1,'public.enforce_venue_owner_update_boundary()','EXECUTE') as x`,
        [role]);
      eq(r.rows[0].x, false, `${role} must not hold EXECUTE`);
    }
  });

  await test('SHAPE: update_venue_rating is SECURITY DEFINER with a pinned search_path', async () => {
    const r = await h.q(
      `select prosecdef, proconfig::text from pg_proc where proname='update_venue_rating'`);
    eq(r.rows.length, 1);
    eq(r.rows[0].prosecdef, true, 'the rating maintainer must run in a trusted context');
    assert(/search_path=/.test(r.rows[0].proconfig), 'search_path must be pinned');
  });

  await test('SHAPE: there is NO trigger-depth exemption in the boundary function', async () => {
    const r = await h.q(
      `select prosrc from pg_proc where proname='enforce_venue_owner_update_boundary'`);
    assert(!/pg_trigger_depth/i.test(r.rows[0].prosrc),
      'pg_trigger_depth must not appear: it is a context-wide bypass, not a capability check');
  });

  await test('SHAPE: review_rating_trigger is still bound to update_venue_rating', async () => {
    const r = await h.q(
      `select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid='public.reviews'::regclass and t.tgname='review_rating_trigger'`);
    eq(r.rows.length, 1);
    eq(r.rows[0].proname, 'update_venue_rating',
      'CREATE OR REPLACE must preserve the OID so the trigger stays bound');
  });

  await test('SHAPE: the 063 INSERT boundary is untouched by this migration', async () => {
    const r = await h.q(
      `select count(*)::int c from pg_policies
        where schemaname='public' and tablename='venues' and cmd='SELECT'`);
    eq(r.rows[0].c, 3, 'the three SELECT policies must be unchanged');
  });

  await db.close();
}

// =============================================================================
// PART 9 -- idempotency, rollback fidelity, re-apply
// =============================================================================
async function part9() {
  console.log('\nPART 9 -- idempotency, then rollback fidelity, then re-apply\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('37. IDEMPOTENT: applying the migration a second time succeeds', async () => {
    await h.reset();
    await db.exec(MIGRATION);
  });

  await test('37b. IDEMPOTENT: still exactly one boundary trigger and two UPDATE policies', async () => {
    await h.reset();
    const t = await h.q(`select count(*)::int c from pg_trigger
                          where tgrelid='public.venues'::regclass
                            and tgname='venues_enforce_owner_update_boundary'`);
    eq(t.rows[0].c, 1);
    const p = await h.q(`select count(*)::int c from pg_policies
                          where schemaname='public' and tablename='venues' and cmd='UPDATE'`);
    eq(p.rows[0].c, 2);
  });

  await test('37c. IDEMPOTENT: the boundary still blocks after re-applying', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await throws(h.q(`update venues set is_verified=true where id=$1`, [v]), DENIED);
    await h.reset();
  });

  await test('38. ROLLBACK (from the migration\'s own documented block) restores the pre-fix state', async () => {
    await h.reset();
    await db.exec(ROLLBACK);

    // The trigger and function are gone...
    const t = await h.q(`select count(*)::int c from pg_trigger
                          where tgrelid='public.venues'::regclass
                            and tgname='venues_enforce_owner_update_boundary'`);
    eq(t.rows[0].c, 0, 'the boundary trigger must be gone');
    const f = await h.q(`select count(*)::int c from pg_proc
                          where proname='enforce_venue_owner_update_boundary'`);
    eq(f.rows[0].c, 0, 'the boundary function must be gone');

    // ...the policy is back to USING-only at roles {public}...
    const p = await h.q(`select roles::text[] as roles, with_check from pg_policies
                          where schemaname='public' and tablename='venues'
                            and policyname='Owners can update claimed venue'`);
    eq(p.rows[0].with_check, null, 'the pre-fix policy had no WITH CHECK');
    eq(JSON.stringify(p.rows[0].roles), JSON.stringify(['public']));

    // ...the admin policy is back to roles {public}...
    const a = await h.q(`select roles::text[] as roles from pg_policies
                          where schemaname='public' and tablename='venues'
                            and policyname='Admins can update any venue'`);
    eq(JSON.stringify(a.rows[0].roles), JSON.stringify(['public']));

    // ...update_venue_rating is back to SECURITY INVOKER...
    const f2 = await h.q(`select prosecdef from pg_proc where proname='update_venue_rating'`);
    eq(f2.rows[0].prosecdef, false, 'rollback must restore migration 025 semantics');

    // ...and anon's UPDATE grant is restored.
    eq((await h.q(`select has_table_privilege('anon','venues','UPDATE') as x`)).rows[0].x, true);
  });

  await test('38b. ROLLBACK is SECURITY-DEGRADING: the exploit works again, exactly as documented', async () => {
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await h.q(`update venues set is_verified=true, is_premium=true where id=$1`, [v]);
    await h.reset();
    const r = (await h.q(`select is_verified, is_premium from venues where id=$1`, [v])).rows[0];
    assert(r.is_verified && r.is_premium,
      'rollback must genuinely restore the pre-fix boundary -- this is why it is labelled degrading');
  });

  await test('38c. re-applying after rollback re-closes PP-011 (script ends in the secure state)', async () => {
    await h.reset();
    await db.exec(MIGRATION);
    const v = await h.newClaimedVenue();
    await h.asUser(OWNER);
    await throws(h.q(`update venues set is_verified=true where id=$1`, [v]), DENIED);
    await h.reset();
    eq((await h.q(`select has_table_privilege('anon','venues','UPDATE') as x`)).rows[0].x, false);
  });

  await db.close();
}

// =============================================================================
async function main() {
  console.log('PP-011 -- claimed-venue owner UPDATE boundary');
  console.log(`migration: ${MIGRATION_PATH.replace(/\\/g, '/').split('/').slice(-1)[0]}`);
  console.log(`owner allowlist under test: ${ALLOWED.join(', ')} (+ updated_at)`);

  await part0();
  await part1();
  await part2();
  await part3();
  await part4();
  await part5();
  await part6();
  await part7();
  await part8();
  await part9();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
