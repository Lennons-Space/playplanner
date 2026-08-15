// =============================================================================
// supabase/tests/060_enrichment_2_1_sections_defg.mjs
//
// Behavioural database tests for migration 060's Sections D-G — the sections
// added by the pre-commit integration review:
//   D. venue_enrichment age/height EVIDENCE columns
//   E. snapshot_current_value reading the real venues.booking_url column
//   F. auto_apply_booking_url + enrichment_url_host (venue-identity gate)
//   G. enrichment_coverage_grid (per-cell/per-category aggregation)
//
// pglite (in-process Postgres), no live Supabase, migration NOT applied to any
// real project. None of these sections needs PostGIS (Section G deliberately
// aggregates the plain latitude/longitude columns) so unlike Section A they
// are all genuinely testable here.
//
// The SQL is EXTRACTED from the real migration file via its
// ENRICHMENT_2_1_SECTIONS_DEFG_START/END markers — never a hand-maintained
// copy — and is loaded after 056 + the B/C block, matching real migration order
// (Section E replaces a function 056 creates; Section F needs Section B's
// venues.booking_url column).
//
// Run: node supabase/tests/060_enrichment_2_1_sections_defg.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_056 = readFileSync(join(__dirname, '../migrations/056_venue_website_enrichment.sql'), 'utf8');
const MIGRATION_060_FULL = readFileSync(join(__dirname, '../migrations/060_enrichment_2_1.sql'), 'utf8');

function extract(startMarker, endMarker) {
  const s = MIGRATION_060_FULL.indexOf(startMarker);
  const e = MIGRATION_060_FULL.indexOf(endMarker);
  if (s === -1 || e === -1) {
    console.error(`FATAL: markers ${startMarker}/${endMarker} not found in 060_enrichment_2_1.sql — did the file change shape?`);
    process.exit(1);
  }
  return MIGRATION_060_FULL.slice(s, e + endMarker.length);
}
const SECTIONS_BC = extract('-- ENRICHMENT_2_1_SECTIONS_BC_START', '-- ENRICHMENT_2_1_SECTIONS_BC_END');
const SECTIONS_DEFG = extract('-- ENRICHMENT_2_1_SECTIONS_DEFG_START', '-- ENRICHMENT_2_1_SECTIONS_DEFG_END');

const ADMIN = '11111111-1111-1111-1111-111111111111';

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

  create table categories (id uuid primary key default gen_random_uuid(), slug text unique);

  create table venues (
    id uuid primary key default gen_random_uuid(),
    description text, price_range text check (price_range in ('free','budget','moderate','premium')),
    website text, phone text, email text,
    latitude decimal(9,6), longitude decimal(9,6),
    category_id uuid references categories(id),
    -- Admin-owned published age columns. Section D's evidence columns must
    -- NEVER be written into these; their presence here is what lets the test
    -- below prove that separation rather than merely assert it.
    min_age smallint, max_age smallint,
    updated_at timestamptz default now()
  );
  create table opening_hours (
    id uuid primary key default gen_random_uuid(), venue_id uuid references venues(id) on delete cascade,
    day_of_week int not null check (day_of_week between 0 and 6),
    opens_at time, closes_at time, is_closed boolean default false, notes text,
    unique (venue_id, day_of_week)
  );
  create table venue_enrichment (venue_id uuid primary key references venues(id) on delete cascade);

  -- Minimal stand-in for migration 059 Section C's table: Section G only reads
  -- latitude/longitude/created_at from it.
  create table venue_discovery_candidates (
    id uuid primary key default gen_random_uuid(),
    latitude decimal(9,6), longitude decimal(9,6),
    created_at timestamptz not null default now()
  );

  insert into profiles (id, is_admin) values ('${ADMIN}', true);
`;

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

async function newVenue(fields = {}) {
  const r = await q(
    `insert into venues (website, booking_url, latitude, longitude, category_id, min_age, max_age)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [fields.website ?? null, fields.booking_url ?? null, fields.latitude ?? null, fields.longitude ?? null,
      fields.category_id ?? null, fields.min_age ?? null, fields.max_age ?? null],
  );
  await q(`insert into venue_enrichment (venue_id) values ($1)`, [r.rows[0].id]);
  return r.rows[0].id;
}
async function newRun(venueId) {
  const r = await q(`insert into venue_enrichment_runs (venue_id, run_label, outcome) values ($1,'t','extracted') returning id`, [venueId]);
  return r.rows[0].id;
}
async function proposeBooking(runId, venueId, url) {
  const r = await q(
    `select propose_field($1,$2,'booking_url',$3::jsonb,$4,$5,$6,$7,$8,$9,$10) as id`,
    [runId, venueId, JSON.stringify({ v: url }), 'https://v.example/', 'Book tickets online', null, 'heuristic', 'low', false, '2026-08-14T10:00:00.000Z'],
  );
  return r.rows[0].id;
}

async function main() {
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_056);
  await db.exec(APPLIED_BY_COLUMN);
  await db.exec(SECTIONS_BC);
  await db.exec(SECTIONS_DEFG);

  console.log('\nMigration 060 Sections D-G — database tests (pglite, no live Supabase, migration NOT applied to production)\n');

  // ── Section D: age/height evidence ────────────────────────────────────────
  await test('D: age/height evidence columns exist and accept plausible values', async () => {
    const v = await newVenue();
    await q(`update venue_enrichment set min_age_evidence=2, max_age_evidence=11, min_height_cm_evidence=90 where venue_id=$1`, [v]);
    const r = await q(`select min_age_evidence, max_age_evidence, min_height_cm_evidence from venue_enrichment where venue_id=$1`, [v]);
    eq(r.rows[0].min_age_evidence, 2, 'min age');
    eq(r.rows[0].max_age_evidence, 11, 'max age');
    eq(r.rows[0].min_height_cm_evidence, 90, 'min height');
  });

  await test('D: rejects an implausible age and an implausible height', async () => {
    const v = await newVenue();
    await throws(q(`update venue_enrichment set min_age_evidence=40 where venue_id=$1`, [v]), /check/i, 'age > 18 rejected');
    await throws(q(`update venue_enrichment set min_height_cm_evidence=10 where venue_id=$1`, [v]), /check/i, 'height < 50cm rejected');
    await throws(q(`update venue_enrichment set min_height_cm_evidence=400 where venue_id=$1`, [v]), /check/i, 'height > 250cm rejected');
  });

  await test('D: rejects a max age below its min age', async () => {
    const v = await newVenue();
    await throws(q(`update venue_enrichment set min_age_evidence=10, max_age_evidence=4 where venue_id=$1`, [v]), /check/i, 'inverted range rejected');
  });

  await test('D: evidence columns are SEPARATE from admin-owned venues.min_age/max_age', async () => {
    const v = await newVenue({ min_age: 0, max_age: 16 });
    await q(`update venue_enrichment set min_age_evidence=2, max_age_evidence=11 where venue_id=$1`, [v]);
    const r = await q(`select min_age, max_age from venues where id=$1`, [v]);
    // Writing evidence must leave the published, admin-owned values untouched.
    eq(r.rows[0].min_age, 0, 'published min_age untouched');
    eq(r.rows[0].max_age, 16, 'published max_age untouched');
  });

  // ── Section E: snapshot_current_value ─────────────────────────────────────
  await test('E: snapshot_current_value returns the REAL booking_url, not a hardcoded null', async () => {
    const v = await newVenue({ booking_url: 'https://v.example/book' });
    const r = await q(`select snapshot_current_value($1,'booking_url') as s`, [v]);
    eq(r.rows[0].s.value.v, 'https://v.example/book', 'live booking_url returned');
  });

  await test('E: booking_url snapshot HASH changes when the live value changes (the stale guard actually works now)', async () => {
    const v = await newVenue({ booking_url: null });
    const before = await q(`select snapshot_current_value($1,'booking_url') as s`, [v]);
    await q(`update venues set booking_url='https://v.example/book' where id=$1`, [v]);
    const after = await q(`select snapshot_current_value($1,'booking_url') as s`, [v]);
    if (before.rows[0].s.hash === after.rows[0].s.hash) {
      throw new Error('hash did not change — the stale-current-value guard would be blind for this field');
    }
  });

  await test('E: every other field branch is unchanged (description/website/phone/email/price_range/opening_hours)', async () => {
    const v = await newVenue({ website: 'https://v.example/' });
    await q(`update venues set description='d', phone='p', email='e@x.com', price_range='free' where id=$1`, [v]);
    for (const [field, expected] of [['description', 'd'], ['website', 'https://v.example/'], ['phone', 'p'], ['email', 'e@x.com'], ['price_range', 'free']]) {
      const r = await q(`select snapshot_current_value($1,$2) as s`, [v, field]);
      eq(r.rows[0].s.value.v, expected, `${field} snapshot`);
    }
    const hours = await q(`select snapshot_current_value($1,'opening_hours') as s`, [v]);
    eq(JSON.stringify(hours.rows[0].s.value), '[]', 'opening_hours still returns an array');
  });

  await test('E: an unknown field still raises invalid_field', async () => {
    const v = await newVenue();
    await throws(q(`select snapshot_current_value($1,'not_a_field')`, [v]), /invalid_field/, 'unknown field rejected');
  });

  // ── Section F: enrichment_url_host ────────────────────────────────────────
  await test('F: enrichment_url_host strips scheme/www/path and lowercases', async () => {
    const r = await q(`select enrichment_url_host('https://www.Venue.co.uk/book?x=1') as h`);
    eq(r.rows[0].h, 'venue.co.uk', 'host normalised');
  });

  await test('F: enrichment_url_host REFUSES a userinfo-style host (the impersonation trick)', async () => {
    const r = await q(`select enrichment_url_host('https://real-venue.co.uk@evil.example/book') as h`);
    eq(r.rows[0].h, null, 'userinfo host refused');
  });

  await test('F: enrichment_url_host returns null for empty/garbage input', async () => {
    eq((await q(`select enrichment_url_host(null) as h`)).rows[0].h, null, 'null input');
    eq((await q(`select enrichment_url_host('') as h`)).rows[0].h, null, 'empty input');
  });

  // ── Section F: auto_apply_booking_url ─────────────────────────────────────
  await test('F happy: applies a booking URL on the venue own host over an empty value', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue.co.uk', booking_url: null });
    const run = await newRun(v);
    const id = await proposeBooking(run, v, 'https://venue.co.uk/book');
    const res = await q(`select auto_apply_booking_url($1) as r`, [id]);
    eq(res.rows[0].r.ok, true, 'applied ok');
    eq((await q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, 'https://venue.co.uk/book', 'written');
    const row = await q(`select status, applied_by from venue_field_proposals where id=$1`, [id]);
    eq(row.rows[0].status, 'applied', 'status applied');
    eq(row.rows[0].applied_by, 'system', 'attributed to system');
  });

  await test('F happy: accepts a subdomain of the venue own host', async () => {
    const v = await newVenue({ website: 'https://venue2.co.uk' });
    const id = await proposeBooking(await newRun(v), v, 'https://book.venue2.co.uk/tickets');
    eq((await q(`select auto_apply_booking_url($1) as r`, [id])).rows[0].r.ok, true, 'subdomain accepted');
  });

  await test('F: REFUSES a third-party booking host', async () => {
    const v = await newVenue({ website: 'https://venue3.co.uk' });
    const id = await proposeBooking(await newRun(v), v, 'https://bookwhen.com/venue3');
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /host_identity_mismatch/, 'third-party host refused');
    eq((await q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, null, 'nothing written');
  });

  await test('F: REFUSES a look-alike host that merely ends with the venue domain', async () => {
    const v = await newVenue({ website: 'https://venue4.co.uk' });
    const id = await proposeBooking(await newRun(v), v, 'https://venue4.co.uk.evil.example/book');
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /host_identity_mismatch/, 'look-alike refused');
  });

  await test('F: REFUSES a userinfo-disguised host that would otherwise read as the venue', async () => {
    const v = await newVenue({ website: 'https://venue5.co.uk' });
    const id = await proposeBooking(await newRun(v), v, 'https://venue5.co.uk@evil.example/book');
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /identity_unverifiable/, 'userinfo refused');
  });

  await test('F: REFUSES when the venue has no website to verify identity against', async () => {
    const v = await newVenue({ website: null });
    const id = await proposeBooking(await newRun(v), v, 'https://anything.example/book');
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /identity_unverifiable/, 'no anchor to verify against');
  });

  await test('F: REFUSES a non-https booking URL even on the venue own host', async () => {
    const v = await newVenue({ website: 'https://venue6.co.uk' });
    const id = await proposeBooking(await newRun(v), v, 'http://venue6.co.uk/book');
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /insecure_or_invalid_scheme/, 'http refused');
  });

  await test('F: NEVER overwrites a booking_url that is already set', async () => {
    const v = await newVenue({ website: 'https://venue7.co.uk', booking_url: null });
    const id = await proposeBooking(await newRun(v), v, 'https://venue7.co.uk/book');
    // Set it AFTER proposing, so the proposal's snapshot is the empty one.
    await q(`update venues set booking_url='https://venue7.co.uk/original' where id=$1`, [v]);
    // The stale guard catches this first — which is exactly the protection
    // Section E restored by making the snapshot read the real column.
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /stale_current_value|booking_url_already_set/, 'existing value protected');
    eq((await q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, 'https://venue7.co.uk/original', 'original preserved');
  });

  await test('F: refuses a proposal for the wrong field, and a non-pending one', async () => {
    const v = await newVenue({ website: 'https://venue8.co.uk' });
    const run = await newRun(v);
    const wrongField = await q(
      `select propose_field($1,$2,'phone',$3::jsonb,$4,$5,$6,$7,$8,$9,$10) as id`,
      [run, v, JSON.stringify({ v: '01234567890' }), 'https://v.example/', 'e', null, 'jsonld', 'high', false, '2026-08-14T10:00:00.000Z'],
    );
    await throws(q(`select auto_apply_booking_url($1)`, [wrongField.rows[0].id]), /wrong_field/, 'wrong field refused');

    const id = await proposeBooking(run, v, 'https://venue8.co.uk/book');
    await q(`select auto_apply_booking_url($1)`, [id]); // applies, status -> applied
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /not_pending/, 'second apply refused');
  });

  await test('F: auto_apply_booking_url is service_role only — not anon/authenticated', async () => {
    const r = await q(`
      select has_function_privilege('anon', 'auto_apply_booking_url(uuid)', 'execute') as anon_can,
             has_function_privilege('authenticated', 'auto_apply_booking_url(uuid)', 'execute') as auth_can,
             has_function_privilege('service_role', 'auto_apply_booking_url(uuid)', 'execute') as svc_can
    `);
    eq(r.rows[0].anon_can, false, 'anon denied');
    eq(r.rows[0].auth_can, false, 'authenticated denied');
    eq(r.rows[0].svc_can, true, 'service_role allowed');
  });

  // ── Section G: enrichment_coverage_grid ───────────────────────────────────
  await test('G: buckets venues into integer grid cells and counts per category', async () => {
    await q(`delete from venues`);
    const museum = (await q(`insert into categories (slug) values ('museum') returning id`)).rows[0].id;
    const playground = (await q(`insert into categories (slug) values ('playground') returning id`)).rows[0].id;
    // lat 52.5 -> floor((52.5-49)/1)=3 ; lng -2.2 -> floor((-2.2 - -8.7)/1)=6
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: museum });
    await newVenue({ latitude: 52.9, longitude: -2.4, category_id: museum });   // same cell 3:6
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: playground });
    // lng -2.9 -> floor((-2.9 - -8.7)/1)=5, a DIFFERENT column — proves the
    // bucketing actually separates cells rather than lumping everything together.
    await newVenue({ latitude: 52.5, longitude: -2.9, category_id: museum });

    const r = await q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7) order by cell_lat_idx, cell_lng_idx, category_slug`);
    const inCell = r.rows.filter((x) => x.cell_lat_idx === 3 && x.cell_lng_idx === 6);
    const byCat = Object.fromEntries(inCell.map((x) => [x.category_slug, Number(x.venue_count)]));
    eq(byCat.museum, 2, 'two museums in cell 3:6');
    eq(byCat.playground, 1, 'one playground in cell 3:6');

    const neighbour = r.rows.filter((x) => x.cell_lat_idx === 3 && x.cell_lng_idx === 5);
    eq(neighbour.length, 1, 'neighbouring cell 3:5 kept separate');
    eq(Number(neighbour[0].venue_count), 1, 'one museum in cell 3:5');
  });

  await test('G: excludes venues with no coordinates rather than mis-bucketing them', async () => {
    await q(`delete from venues`);
    await newVenue({ latitude: null, longitude: null });
    const r = await q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows.length, 0, 'no rows for coordinate-less venues');
  });

  await test('G: an uncategorised venue is counted with a NULL category_slug, never invented', async () => {
    await q(`delete from venues`);
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: null });
    const r = await q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows.length, 1, 'one row');
    eq(r.rows[0].category_slug, null, 'null category preserved');
    eq(Number(r.rows[0].venue_count), 1, 'still counted toward the cell');
  });

  await test('G: reports the most recent discovery timestamp for the cell', async () => {
    await q(`delete from venues`);
    await q(`delete from venue_discovery_candidates`);
    const museum = (await q(`select id from categories where slug='museum'`)).rows[0].id;
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: museum });
    await q(`insert into venue_discovery_candidates (latitude, longitude, created_at) values (52.5,-2.2,'2026-01-01T00:00:00Z')`);
    await q(`insert into venue_discovery_candidates (latitude, longitude, created_at) values (52.6,-2.3,'2026-06-01T00:00:00Z')`);
    const r = await q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows.length, 1, 'one row');
    eq(new Date(r.rows[0].last_discovered_at).toISOString(), '2026-06-01T00:00:00.000Z', 'newest timestamp in the cell');
  });

  await test('G: a cell never discovery-checked reports a NULL timestamp (not a fabricated one)', async () => {
    await q(`delete from venues`);
    await q(`delete from venue_discovery_candidates`);
    const museum = (await q(`select id from categories where slug='museum'`)).rows[0].id;
    await newVenue({ latitude: 55.5, longitude: -4.2, category_id: museum });
    const r = await q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows[0].last_discovered_at, null, 'null, not a default date');
  });

  await test('G: rejects a non-positive step rather than dividing by zero', async () => {
    await throws(q(`select * from enrichment_coverage_grid(0, 49.0, -8.7)`), /p_step_deg must be > 0/, 'zero step rejected');
    await throws(q(`select * from enrichment_coverage_grid(-1, 49.0, -8.7)`), /p_step_deg must be > 0/, 'negative step rejected');
  });

  await test('G: enrichment_coverage_grid is service_role only', async () => {
    const r = await q(`
      select has_function_privilege('anon', 'enrichment_coverage_grid(float, float, float)', 'execute') as anon_can,
             has_function_privilege('authenticated', 'enrichment_coverage_grid(float, float, float)', 'execute') as auth_can,
             has_function_privilege('service_role', 'enrichment_coverage_grid(float, float, float)', 'execute') as svc_can
    `);
    eq(r.rows[0].anon_can, false, 'anon denied');
    eq(r.rows[0].auth_can, false, 'authenticated denied');
    eq(r.rows[0].svc_can, true, 'service_role allowed');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  FAILED: ${f.name} — ${f.message}`);
    process.exit(1);
  }
}

await main();
