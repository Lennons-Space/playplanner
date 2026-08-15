// =============================================================================
// supabase/tests/060_enrichment_2_1_sections_bc.mjs
//
// Behavioural database tests for migration 060's Sections B (booking_url,
// venue_enrichment.admission_status) and C (auto_apply_generated_description)
// — pglite (in-process Postgres), no live Supabase. Section A (the spatial
// RPC) needs PostGIS, unavailable in this repo's pinned pglite — see
// 060_enrichment_2_1_staging_checklist.sql for that one instead. Sections B/C
// have zero dependency on Section A, so this file extracts exactly that SQL
// text (via the ENRICHMENT_2_1_SECTIONS_BC_START/END markers in the real
// migration file — not a hand-maintained copy) and runs it standalone.
//
// Run: node supabase/tests/060_enrichment_2_1_sections_bc.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_056 = readFileSync(join(__dirname, '../migrations/056_venue_website_enrichment.sql'), 'utf8');
const MIGRATION_060_FULL = readFileSync(join(__dirname, '../migrations/060_enrichment_2_1.sql'), 'utf8');

const START_MARKER = '-- ENRICHMENT_2_1_SECTIONS_BC_START';
const END_MARKER = '-- ENRICHMENT_2_1_SECTIONS_BC_END';
const startIdx = MIGRATION_060_FULL.indexOf(START_MARKER);
const endIdx = MIGRATION_060_FULL.indexOf(END_MARKER);
if (startIdx === -1 || endIdx === -1) {
  console.error('FATAL: extraction markers not found in 060_enrichment_2_1.sql — did the file change shape?');
  process.exit(1);
}
const SECTIONS_BC = MIGRATION_060_FULL.slice(startIdx, endIdx + END_MARKER.length);

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema if not exists auth;
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

  create table venues (
    id uuid primary key default gen_random_uuid(),
    description text, price_range text check (price_range in ('free','budget','moderate','premium')),
    website text, phone text, email text, updated_at timestamptz default now()
  );
  create table opening_hours (
    id uuid primary key default gen_random_uuid(), venue_id uuid references venues(id) on delete cascade,
    day_of_week int not null check (day_of_week between 0 and 6),
    opens_at time, closes_at time, is_closed boolean default false, notes text,
    unique (venue_id, day_of_week)
  );
  create table venue_enrichment (venue_id uuid primary key references venues(id) on delete cascade);

  insert into profiles (id, is_admin) values ('${ADMIN}', true), ('${USER}', false);
`;

// Mirrors migration 059 Section A's addition to venue_field_proposals
// (applied_by) — applied directly here (after 056 creates the table, before
// Sections B/C run) rather than pulling in all of 059's unrelated
// dependencies (categories/venue_discovery_candidates/etc.), since
// auto_apply_generated_description only needs this one column.
const APPLIED_BY_COLUMN = `
  alter table venue_field_proposals
    add column if not exists applied_by text check (applied_by is null or applied_by in ('admin','system'));
`;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (e) { failures.push({ name, message: e?.message ?? String(e) }); console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function throws(promise, re, msg) {
  try { await promise; } catch (e) {
    const m = e?.message ?? String(e);
    if (re && !re.test(m)) throw new Error(`${msg || 'wrong error'}: ${m}`);
    return;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);
const asUid = (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);

async function newVenue(description = null) {
  const r = await q(`insert into venues (description) values ($1) returning id`, [description]);
  await q(`insert into venue_enrichment (venue_id) values ($1)`, [r.rows[0].id]);
  return r.rows[0].id;
}
async function newRun(venueId) {
  const r = await q(`insert into venue_enrichment_runs (venue_id, run_label, outcome) values ($1,'t','extracted') returning id`, [venueId]);
  return r.rows[0].id;
}
async function propose(runId, venueId, proposedText, evidenceText = 'evidence') {
  const r = await q(
    `select propose_field($1,$2,'description',$3::jsonb,$4,$5,$6,$7,$8,$9,$10) as id`,
    [runId, venueId, JSON.stringify({ v: proposedText }), 'https://v.example/', evidenceText, null, 'jsonld', 'high', false, '2026-08-14T10:00:00.000Z'],
  );
  return r.rows[0].id;
}

async function main() {
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_056);
  await db.exec(APPLIED_BY_COLUMN);
  await db.exec(SECTIONS_BC);

  console.log('\nMigration 060 Sections B+C — database tests (pglite, no live Supabase, migration NOT applied to production)\n');

  await test('venues.booking_url column exists and is writable', async () => {
    const v = await newVenue();
    await q(`update venues set booking_url = $1 where id = $2`, ['https://x.example/book', v]);
    const r = await q(`select booking_url from venues where id=$1`, [v]);
    eq(r.rows[0].booking_url, 'https://x.example/book', 'booking_url written');
  });

  await test('venue_enrichment.admission_status accepts free/paid/unknown, rejects garbage', async () => {
    const v = await newVenue();
    await q(`update venue_enrichment set admission_status='free' where venue_id=$1`, [v]);
    await q(`update venue_enrichment set admission_status='paid' where venue_id=$1`, [v]);
    await q(`update venue_enrichment set admission_status='unknown' where venue_id=$1`, [v]);
    await throws(q(`update venue_enrichment set admission_status='garbage' where venue_id=$1`, [v]), /check/i, 'garbage value rejected');
  });

  await test('happy: auto_apply_generated_description applies over a NULL description', async () => {
    await asUid(ADMIN);
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await propose(run, v, 'Indoor soft-play centre in Shrewsbury with a toddler area and parking.');
    const res = await q(`select auto_apply_generated_description($1) as r`, [id]);
    eq(res.rows[0].r.ok, true, 'applied ok');
    const venue = await q(`select description from venues where id=$1`, [v]);
    eq(venue.rows[0].description, 'Indoor soft-play centre in Shrewsbury with a toddler area and parking.', 'description written');
    const row = await q(`select status, applied_by from venue_field_proposals where id=$1`, [id]);
    eq(row.rows[0].status, 'applied', 'status applied');
    eq(row.rows[0].applied_by, 'system', 'applied_by system');
  });

  await test('happy: applies over a trivial description (just the venue name, <10 chars)', async () => {
    const v = await newVenue('Zoo');
    const run = await newRun(v);
    const id = await propose(run, v, 'Indoor zoo in Leeds with parking and an on-site cafe.');
    await q(`select auto_apply_generated_description($1)`, [id]);
    const venue = await q(`select description from venues where id=$1`, [v]);
    eq(venue.rows[0].description, 'Indoor zoo in Leeds with parking and an on-site cafe.', 'trivial description overwritten');
  });

  await test('rejects when the existing description is real/substantive — never overwrites a human description', async () => {
    const v = await newVenue('A charming family-run farm with animals and a tea room, open all year round.');
    const run = await newRun(v);
    const id = await propose(run, v, 'Indoor farm in York with parking.');
    await throws(q(`select auto_apply_generated_description($1)`, [id]), /existing_description_not_trivial/, 'real description protected');
    const venue = await q(`select description from venues where id=$1`, [v]);
    eq(venue.rows[0].description, 'A charming family-run farm with animals and a tea room, open all year round.', 'description unchanged');
  });

  await test('rejects an empty generated text', async () => {
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await propose(run, v, '   ');
    await throws(q(`select auto_apply_generated_description($1)`, [id]), /empty_generated_text/, 'empty text rejected');
  });

  await test('rejects generated text that literally equals the scraped evidence (anti-copyright, mirrors the human path)', async () => {
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await propose(run, v, 'Come visit our AMAZING soft play!!!', 'Come visit our AMAZING soft play!!!');
    await throws(q(`select auto_apply_generated_description($1)`, [id]), /not_a_synthesis/, 'verbatim scrape rejected');
  });

  await test('stale current value blocks apply, same as the ordinary auto-apply path', async () => {
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await propose(run, v, 'Indoor museum in Bath with parking.');
    await q(`update venues set description='someone else edited this first' where id=$1`, [v]);
    await throws(q(`select auto_apply_generated_description($1)`, [id]), /stale_current_value/, 'stale guard');
  });

  await test('rejects a proposal for a field other than description', async () => {
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await q(
      `select propose_field($1,$2,'phone','{"v":"+441"}'::jsonb,$3,$4,$5,$6,$7,$8,$9) as id`,
      [run, v, 'https://v.example/', 'e', null, 'jsonld', 'high', false, '2026-08-14T10:00:00.000Z'],
    );
    await throws(q(`select auto_apply_generated_description($1)`, [id.rows[0].id]), /wrong_field/, 'wrong field rejected');
  });

  await test('is idempotent-safe — cannot re-apply an already-applied proposal', async () => {
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await propose(run, v, 'Indoor library in Hull.');
    await q(`select auto_apply_generated_description($1)`, [id]);
    await throws(q(`select auto_apply_generated_description($1)`, [id]), /not_pending/, 're-apply blocked');
  });

  await test('auth: auto_apply_generated_description is service_role only', async () => {
    const v = await newVenue(null);
    const run = await newRun(v);
    const id = await propose(run, v, 'Indoor bowling alley in Derby.');
    await db.exec('set role authenticated');
    await throws(q(`select auto_apply_generated_description('${id}')`), /permission denied/i, 'authenticated must not execute');
    await db.exec('reset role');
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
