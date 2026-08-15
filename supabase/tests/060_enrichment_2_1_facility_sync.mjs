// =============================================================================
// supabase/tests/060_enrichment_2_1_facility_sync.mjs
//
// Behavioural proof that Enrichment 2.1's facility-sync provenance tag
// ('official-enrichment') coexists safely with migration 050's REAL,
// UNMODIFIED parent-vote mirror trigger — using an in-process Postgres
// (pglite), no live Supabase, migration 050 is already applied to
// production (this file re-verifies its behaviour, doesn't change it).
// No PostGIS needed here (unlike the spatial RPC — see
// 060_enrichment_2_1_staging_checklist.sql for that one), so this DOES run
// in pglite, unlike this migration's Section A.
//
// Run: node supabase/tests/060_enrichment_2_1_facility_sync.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_050 = readFileSync(join(__dirname, '../migrations/050_parent_facility_votes.sql'), 'utf8');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER_A = '22222222-2222-2222-2222-222222222222';
const USER_B = '33333333-3333-3333-3333-333333333333';
const USER_C = '44444444-4444-4444-4444-444444444444';
const USER_D = '55555555-5555-5555-5555-555555555555';
const USER_E = '66666666-6666-6666-6666-666666666666';

const OFFICIAL_ENRICHMENT_NOTES = 'official-enrichment';

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  create or replace function touch_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end; $$;

  create table profiles (id uuid primary key, is_admin boolean default false);
  create or replace function is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from profiles where id = auth.uid()), false);
  $$;

  create table venues (id uuid primary key default gen_random_uuid(), name text not null default 'Test Venue', updated_at timestamptz default now());
  create table facilities (id uuid primary key default gen_random_uuid(), name text unique not null, slug text unique not null, icon text);
  create table venue_facilities (
    venue_id uuid not null references venues(id) on delete cascade,
    facility_id uuid not null references facilities(id) on delete cascade,
    notes text,
    primary key (venue_id, facility_id)
  );

  insert into profiles (id, is_admin) values ('${ADMIN}', true);
  insert into auth.users (id) values ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${USER_D}'), ('${USER_E}');
`;

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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);

async function newVenue() {
  const r = await q(`insert into venues default values returning id`);
  return r.rows[0].id;
}
async function facilityId(slug) {
  const r = await q(`select id from facilities where slug = $1`, [slug]);
  return r.rows[0]?.id ?? null;
}
async function vote(venueId, userId, present) {
  await q(
    `insert into venue_facility_votes (venue_id, user_id, facility_slug, present) values ($1,$2,'parking',$3)
     on conflict (venue_id, user_id, facility_slug) do update set present = excluded.present`,
    [venueId, userId, present],
  );
}
/** Simulates facilitySync.ts's applyFacilitySync INSERT for a 'publish' decision. */
async function publishOfficialFact(venueId, slug) {
  const fid = await facilityId(slug);
  await q(
    `insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,$3)
     on conflict (venue_id, facility_id) do nothing`,
    [venueId, fid, OFFICIAL_ENRICHMENT_NOTES],
  );
}
async function facilityRow(venueId, slug) {
  const fid = await facilityId(slug);
  const r = await q(`select notes from venue_facilities where venue_id=$1 and facility_id=$2`, [venueId, fid]);
  return r.rows[0] ?? null;
}

async function main() {
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_050);

  console.log('\nEnrichment 2.1 facility-sync coexistence — database tests (pglite, real unmodified migration 050 trigger)\n');

  await test('an official-enrichment row is never deleted when votes later flip parking to "not present"', async () => {
    const v = await newVenue();
    await publishOfficialFact(v, 'parking');
    let row = await facilityRow(v, 'parking');
    eq(row?.notes, OFFICIAL_ENRICHMENT_NOTES, 'official row published');

    // 5 votes, majority "not present" -> high confidence, present=false -> the
    // REAL mirror trigger's DELETE branch fires, but its guard is
    // `AND notes = 'parent-confirmed'` — must NOT touch our row.
    await vote(v, USER_A, false);
    await vote(v, USER_B, false);
    await vote(v, USER_C, false);
    await vote(v, USER_D, false);
    await vote(v, USER_E, true);

    row = await facilityRow(v, 'parking');
    assert(row !== null, 'official-enrichment row must still exist after a negative vote mirror event');
    eq(row.notes, OFFICIAL_ENRICHMENT_NOTES, 'notes untouched — proves the trigger guard excludes non-parent-confirmed rows');
  });

  await test('an official-enrichment row is never overwritten when votes later confirm parking present', async () => {
    const v = await newVenue();
    await publishOfficialFact(v, 'parking');

    // 5 votes, majority "present" -> high confidence, present=true -> the REAL
    // mirror trigger's UPSERT branch fires, but its WHERE clause only updates
    // rows where notes IS NULL OR notes = 'parent-confirmed' — must be a no-op here.
    for (const u of [USER_A, USER_B, USER_C, USER_D, USER_E]) await vote(v, u, true);

    const row = await facilityRow(v, 'parking');
    eq(row.notes, OFFICIAL_ENRICHMENT_NOTES, 'notes still official-enrichment — the vote mirror never overwrote it');
  });

  await test('the vote mirror still works completely normally when NO official row exists', async () => {
    const v = await newVenue();
    for (const u of [USER_A, USER_B, USER_C, USER_D, USER_E]) await vote(v, u, true);
    const row = await facilityRow(v, 'parking');
    eq(row?.notes, 'parent-confirmed', 'unmodified 050 behaviour: parent-confirmed row created normally');
  });

  await test('repeating the same official publish is idempotent — no duplicate row, no error', async () => {
    const v = await newVenue();
    await publishOfficialFact(v, 'parking');
    await publishOfficialFact(v, 'parking'); // same fact again, e.g. a re-run of the same enrichment pass
    const r = await q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v]);
    eq(r.rows[0].n, 1, 'exactly one row after repeating the same publish');
  });

  await test('a NULL-notes (admin/import) row survives a negative vote mirror event — the DELETE guard is exact-match "parent-confirmed" only', async () => {
    const v = await newVenue();
    const fid = await facilityId('parking');
    await q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,null)`, [v, fid]);
    for (const u of [USER_A, USER_B, USER_C, USER_D, USER_E]) await vote(v, u, false); // majority NOT present
    const row = await facilityRow(v, 'parking');
    assert(row !== null, 'a NULL-notes row must survive — the DELETE branch only ever removes notes=\'parent-confirmed\' rows');
  });

  await test('a NULL-notes row IS eligible for the UPDATE branch (upgraded to parent-confirmed on strong positive votes) — the real reason 2.1 never writes NULL notes', async () => {
    const v = await newVenue();
    const fid = await facilityId('parking');
    await q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,null)`, [v, fid]);
    for (const u of [USER_A, USER_B, USER_C, USER_D, USER_E]) await vote(v, u, true); // majority present
    const row = await facilityRow(v, 'parking');
    eq(row.notes, 'parent-confirmed', 'the UPDATE branch guard (notes IS NULL OR =\'parent-confirmed\') DOES rewrite a NULL row — provenance would be silently lost if 2.1 used NULL instead of a distinct tag');
  });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
