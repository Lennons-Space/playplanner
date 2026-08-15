// =============================================================================
// supabase/tests/061_enrichment_review_paths.mjs
//
// Behavioural database tests for migration 061 — pglite (in-process Postgres),
// no live Supabase, migration NOT applied to any real project.
//
// Covers:
//   B. auto_accept_candidate now REFUSES a single-source candidate, and the
//      old weaker two-argument signature is gone
//   C. resolve_discovery_candidate — the admin path for quarantined candidates
//   D. apply_booking_url_proposal — the admin path for a booking_url proposal
//   E. resolve_facility_conflict — the admin path for a facility conflict
//
// SQL is extracted from the real migration files, never hand-copied. 061 is
// loaded on top of a bootstrap that reproduces exactly the objects it depends
// on from 056/059/060, in real migration order.
//
// Run: node supabase/tests/061_enrichment_review_paths.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_056 = readFileSync(join(__dirname, '../migrations/056_venue_website_enrichment.sql'), 'utf8');
const MIGRATION_060 = readFileSync(join(__dirname, '../migrations/060_enrichment_2_1.sql'), 'utf8');
const MIGRATION_061 = readFileSync(join(__dirname, '../migrations/061_enrichment_review_paths.sql'), 'utf8');

function extract(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker);
  if (s === -1 || e === -1) {
    console.error(`FATAL: markers ${startMarker}/${endMarker} not found — did the file change shape?`);
    process.exit(1);
  }
  return src.slice(s, e + endMarker.length);
}
const SECTIONS_BC_060 = extract(MIGRATION_060, '-- ENRICHMENT_2_1_SECTIONS_BC_START', '-- ENRICHMENT_2_1_SECTIONS_BC_END');
const SECTIONS_DEFG_060 = extract(MIGRATION_060, '-- ENRICHMENT_2_1_SECTIONS_DEFG_START', '-- ENRICHMENT_2_1_SECTIONS_DEFG_END');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

// Reproduces only what 061 depends on from 001/049/050/059 — venue_discovery_
// candidates' real column set (059) matters most, since section B reads it.
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
    name text, category_id uuid references categories(id),
    address_line1 text, city text, postcode text, country text,
    latitude decimal(9,6), longitude decimal(9,6),
    description text, price_range text check (price_range in ('free','budget','moderate','premium')),
    website text, phone text, email text,
    is_published boolean default false, is_verified boolean default false,
    moderation_status text, discovery_approved boolean default false, data_source text,
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

  create table facilities (id uuid primary key default gen_random_uuid(), slug text unique, name text);
  create table venue_facilities (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    facility_id uuid references facilities(id) on delete cascade,
    notes text,
    unique (venue_id, facility_id)
  );

  -- Exactly migration 059's table definition (the columns 061 §A extends and §B reads).
  create table venue_discovery_candidates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    latitude decimal(9,6) not null,
    longitude decimal(9,6) not null,
    postcode text, address_line1 text, city text, phone text, website text,
    category_id uuid references categories(id),
    source text not null check (source in ('osm','geoapify')),
    source_id text not null,
    dedupe_decision text not null check (dedupe_decision in ('duplicate','possible_duplicate','distinct')),
    matched_venue_id uuid references venues(id),
    confidence_score smallint not null check (confidence_score between 0 and 100),
    has_family_relevant_category boolean not null default false,
    has_valid_uk_coordinates boolean not null default false,
    has_valid_address boolean not null default false,
    is_trusted_source boolean not null default false,
    official_verification boolean not null default false,
    has_closure_signal boolean not null default false,
    required_fields_complete boolean not null default false,
    status text not null default 'candidate'
      check (status in ('candidate','auto_accepted','quarantined','rejected','duplicate')),
    venue_id uuid references venues(id),
    evidence jsonb not null default '{}',
    reviewed_by uuid references profiles(id),
    reviewed_at timestamptz,
    review_notes text,
    discovered_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source, source_id)
  );

  insert into profiles (id, is_admin) values ('${ADMIN}', true), ('${USER}', false);
`;

// Migration 059's ORIGINAL two-argument auto_accept_candidate, so the test can
// prove 061 actually removes the weaker gate rather than leaving it callable.
const OLD_059_AUTO_ACCEPT = `
CREATE OR REPLACE FUNCTION auto_accept_candidate(p_candidate_id uuid, p_min_score smallint DEFAULT 98)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c venue_discovery_candidates%rowtype; v_venue_id uuid;
BEGIN
  SELECT * INTO c FROM venue_discovery_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF c.status <> 'candidate' THEN RAISE EXCEPTION 'not_pending_candidate:%', c.status; END IF;
  IF c.dedupe_decision <> 'distinct' THEN RAISE EXCEPTION 'not_distinct:%', c.dedupe_decision; END IF;
  IF c.confidence_score < p_min_score THEN RAISE EXCEPTION 'below_min_score'; END IF;
  INSERT INTO venues (name, is_published) VALUES (c.name, true) RETURNING id INTO v_venue_id;
  UPDATE venue_discovery_candidates SET status='auto_accepted', venue_id=v_venue_id WHERE id=p_candidate_id;
  RETURN jsonb_build_object('ok', true, 'venue_id', v_venue_id);
END; $$;
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

let candidateSeq = 0;
async function newCandidate(over = {}) {
  candidateSeq += 1;
  const f = {
    name: 'Twycross Zoo', latitude: 52.6, longitude: -1.6, postcode: 'CV9 3PX', city: 'Atherstone',
    source: 'osm', source_id: `node/${candidateSeq}`, dedupe_decision: 'distinct', confidence_score: 100,
    has_family_relevant_category: true, has_valid_uk_coordinates: true, has_valid_address: true,
    is_trusted_source: true, required_fields_complete: true, has_closure_signal: false,
    status: 'candidate', independent_identity_evidence_count: 2,
    identity_evidence_sources: ['osm', 'official_website'],
    ...over,
  };
  const r = await q(
    `insert into venue_discovery_candidates
      (name, latitude, longitude, postcode, city, source, source_id, dedupe_decision, confidence_score,
       has_family_relevant_category, has_valid_uk_coordinates, has_valid_address, is_trusted_source,
       required_fields_complete, has_closure_signal, status,
       independent_identity_evidence_count, identity_evidence_sources)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [f.name, f.latitude, f.longitude, f.postcode, f.city, f.source, f.source_id, f.dedupe_decision,
      f.confidence_score, f.has_family_relevant_category, f.has_valid_uk_coordinates, f.has_valid_address,
      f.is_trusted_source, f.required_fields_complete, f.has_closure_signal, f.status,
      f.independent_identity_evidence_count, f.identity_evidence_sources],
  );
  return r.rows[0].id;
}

async function newVenue(fields = {}) {
  const r = await q(
    `insert into venues (website, booking_url) values ($1,$2) returning id`,
    [fields.website ?? null, fields.booking_url ?? null],
  );
  return r.rows[0].id;
}
async function newRun(venueId) {
  const r = await q(`insert into venue_enrichment_runs (venue_id, run_label, outcome) values ($1,'t','extracted') returning id`, [venueId]);
  return r.rows[0].id;
}
async function proposeBooking(venueId, url) {
  const run = await newRun(venueId);
  const r = await q(
    `select propose_field($1,$2,'booking_url',$3::jsonb,$4,$5,$6,$7,$8,$9,$10) as id`,
    [run, venueId, JSON.stringify({ v: url }), 'https://v.example/', 'Book tickets online', null, 'heuristic', 'low', false, '2026-08-14T10:00:00.000Z'],
  );
  return r.rows[0].id;
}

async function main() {
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_056);
  await db.exec(APPLIED_BY_COLUMN);
  await db.exec(SECTIONS_BC_060);
  await db.exec(SECTIONS_DEFG_060);
  await db.exec(OLD_059_AUTO_ACCEPT);
  await db.exec(MIGRATION_061);

  console.log('\nMigration 061 — database tests (pglite, no live Supabase, migration NOT applied to production)\n');

  // ── B. the independence gate ──────────────────────────────────────────────
  await test('B: REFUSES a single-source candidate even at a perfect confidence score of 100', async () => {
    const c = await newCandidate({ confidence_score: 100, independent_identity_evidence_count: 1, identity_evidence_sources: ['osm'] });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /insufficient_independent_identity_evidence/, 'single source refused');
    const row = await q(`select status, venue_id from venue_discovery_candidates where id=$1`, [c]);
    eq(row.rows[0].status, 'candidate', 'status unchanged');
    eq(row.rows[0].venue_id, null, 'no venue created');
  });

  await test('B: ACCEPTS a candidate with two independent identity sources', async () => {
    const c = await newCandidate({ independent_identity_evidence_count: 2 });
    const res = await q(`select auto_accept_candidate($1) as r`, [c]);
    eq(res.rows[0].r.ok, true, 'accepted');
    const v = await q(`select is_published, moderation_status from venues where id=$1`, [res.rows[0].r.venue_id]);
    eq(v.rows[0].is_published, true, 'venue published');
    eq(v.rows[0].moderation_status, 'approved', 'moderation approved');
  });

  await test('B: evidence gate is independent of the score gate (low score still refused first)', async () => {
    const c = await newCandidate({ confidence_score: 50, independent_identity_evidence_count: 5 });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /below_min_score/, 'score still enforced');
  });

  await test('B: the OLD 059 two-argument auto_accept_candidate is GONE (weaker gate cannot survive)', async () => {
    const r = await q(`
      select count(*)::int as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='auto_accept_candidate' and p.pronargs = 2
    `);
    eq(r.rows[0].n, 0, 'two-argument overload dropped');
    const three = await q(`
      select count(*)::int as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='auto_accept_candidate' and p.pronargs = 3
    `);
    eq(three.rows[0].n, 1, 'three-argument version present');
  });

  await test('B: default evidence column value is the SAFE one (0 = refuse), not a permissive backfill', async () => {
    const r = await q(`
      select column_default from information_schema.columns
      where table_name='venue_discovery_candidates' and column_name='independent_identity_evidence_count'
    `);
    eq(String(r.rows[0].column_default).startsWith('0'), true, 'defaults to 0');
  });

  await test('B: auto_accept_candidate remains service_role only', async () => {
    const r = await q(`
      select has_function_privilege('anon','auto_accept_candidate(uuid,smallint,smallint)','execute') as a,
             has_function_privilege('authenticated','auto_accept_candidate(uuid,smallint,smallint)','execute') as b,
             has_function_privilege('service_role','auto_accept_candidate(uuid,smallint,smallint)','execute') as c
    `);
    eq(r.rows[0].a, false, 'anon denied');
    eq(r.rows[0].b, false, 'authenticated denied');
    eq(r.rows[0].c, true, 'service_role allowed');
  });

  // ── C. resolve_discovery_candidate ────────────────────────────────────────
  await test('C: an admin can APPROVE a quarantined single-source candidate (the human IS the evidence)', async () => {
    await asUid(ADMIN);
    const c = await newCandidate({ status: 'quarantined', independent_identity_evidence_count: 1 });
    const res = await q(`select resolve_discovery_candidate($1,'approve','looks legitimate') as r`, [c]);
    eq(res.rows[0].r.ok, true, 'approved');
    const row = await q(`select status, venue_id, reviewed_by, review_notes from venue_discovery_candidates where id=$1`, [c]);
    eq(row.rows[0].status, 'auto_accepted', 'terminal state reached');
    eq(row.rows[0].reviewed_by, ADMIN, 'human attributed');
    eq(row.rows[0].review_notes, 'looks legitimate', 'notes preserved');
    const v = await q(`select is_published from venues where id=$1`, [row.rows[0].venue_id]);
    eq(v.rows[0].is_published, true, 'venue published');
  });

  await test('C: an admin can REJECT and DISMISS, so nothing is stuck', async () => {
    await asUid(ADMIN);
    const rejected = await newCandidate({ status: 'quarantined' });
    await q(`select resolve_discovery_candidate($1,'reject','not a family venue')`, [rejected]);
    eq((await q(`select status from venue_discovery_candidates where id=$1`, [rejected])).rows[0].status, 'rejected', 'rejected');

    const dismissed = await newCandidate({ status: 'quarantined' });
    await q(`select resolve_discovery_candidate($1,'dismiss','already have it')`, [dismissed]);
    eq((await q(`select status from venue_discovery_candidates where id=$1`, [dismissed])).rows[0].status, 'duplicate', 'dismissed');
  });

  await test('C: a NON-admin cannot resolve a candidate', async () => {
    await asUid(USER);
    const c = await newCandidate({ status: 'quarantined' });
    await throws(q(`select resolve_discovery_candidate($1,'approve',null)`, [c]), /not_admin/, 'non-admin refused');
    await asUid(ADMIN);
  });

  await test('C: refuses an invalid decision, an already-terminal candidate, and a known duplicate', async () => {
    await asUid(ADMIN);
    const c = await newCandidate({ status: 'quarantined' });
    await throws(q(`select resolve_discovery_candidate($1,'banana',null)`, [c]), /invalid_decision/, 'bad decision');

    const done = await newCandidate({ status: 'rejected' });
    await throws(q(`select resolve_discovery_candidate($1,'approve',null)`, [done]), /not_resolvable/, 'terminal refused');

    const dup = await newCandidate({ status: 'quarantined', dedupe_decision: 'duplicate' });
    await throws(q(`select resolve_discovery_candidate($1,'approve',null)`, [dup]), /is_duplicate/, 'duplicate never published');
  });

  await test('C: an admin still cannot publish a candidate missing required venue fields', async () => {
    await asUid(ADMIN);
    const c = await newCandidate({ status: 'quarantined', city: null });
    await throws(q(`select resolve_discovery_candidate($1,'approve',null)`, [c]), /missing_required_venue_fields/, 'data quality still enforced');
  });

  // ── D. apply_booking_url_proposal ─────────────────────────────────────────
  await test('D happy: an admin can approve a THIRD-PARTY booking host that automation refused', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue.co.uk' });
    const id = await proposeBooking(v, 'https://bookwhen.com/venue');
    // Automation refuses this exact proposal...
    await throws(q(`select auto_apply_booking_url($1)`, [id]), /host_identity_mismatch/, 'automation refuses');
    // ...and the admin path is what resolves it.
    const res = await q(`select apply_booking_url_proposal($1,null,'verified by phone') as r`, [id]);
    eq(res.rows[0].r.ok, true, 'admin applied');
    eq((await q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, 'https://bookwhen.com/venue', 'written');
    const p = await q(`select status, applied_by, reviewed_by, review_notes from venue_field_proposals where id=$1`, [id]);
    eq(p.rows[0].status, 'applied', 'status applied');
    eq(p.rows[0].applied_by, 'admin', 'provenance says admin, not system');
    eq(p.rows[0].reviewed_by, ADMIN, 'audit trail records which admin');
    eq(p.rows[0].review_notes, 'verified by phone', 'notes preserved');
  });

  await test('D: a NON-admin cannot apply a booking_url proposal', async () => {
    await asUid(USER);
    const v = await newVenue({ website: 'https://venue2.co.uk' });
    const id = await proposeBooking(v, 'https://bookwhen.com/venue2');
    await throws(q(`select apply_booking_url_proposal($1,null,null)`, [id]), /not_admin/, 'non-admin refused');
    await asUid(ADMIN);
  });

  await test('D: enforces the stale-current-value guard', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue3.co.uk' });
    const id = await proposeBooking(v, 'https://bookwhen.com/venue3');
    await q(`update venues set booking_url='https://changed.example/' where id=$1`, [v]);
    await throws(q(`select apply_booking_url_proposal($1,null,null)`, [id]), /stale_current_value/, 'stale detected');
  });

  await test('D: enforces the expected-current-value guard when the caller asserts one', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue4.co.uk' });
    const id = await proposeBooking(v, 'https://bookwhen.com/venue4');
    await throws(
      q(`select apply_booking_url_proposal($1,'https://not-what-is-live.example/',null)`, [id]),
      /unexpected_current_value/, 'expected-value mismatch caught',
    );
    // NULL means "not asserted" and still applies.
    eq((await q(`select apply_booking_url_proposal($1,null,null) as r`, [id])).rows[0].r.ok, true, 'null assertion allowed');
  });

  await test('D: an admin still cannot apply an http:// or unparseable booking URL', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue5.co.uk' });
    const insecure = await proposeBooking(v, 'http://bookwhen.com/venue5');
    await throws(q(`select apply_booking_url_proposal($1,null,null)`, [insecure]), /insecure_or_invalid_scheme/, 'http refused for admins too');

    const v6 = await newVenue({ website: 'https://venue6.co.uk' });
    const disguised = await proposeBooking(v6, 'https://venue6.co.uk@evil.example/book');
    await throws(q(`select apply_booking_url_proposal($1,null,null)`, [disguised]), /unparseable_booking_host/, 'userinfo refused');
  });

  await test('D: refuses the wrong field and an already-applied proposal', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue7.co.uk' });
    const run = await newRun(v);
    const wrong = await q(
      `select propose_field($1,$2,'phone',$3::jsonb,$4,$5,$6,$7,$8,$9,$10) as id`,
      [run, v, JSON.stringify({ v: '01234567890' }), 'https://v.example/', 'e', null, 'jsonld', 'high', false, '2026-08-14T10:00:00.000Z'],
    );
    await throws(q(`select apply_booking_url_proposal($1,null,null)`, [wrong.rows[0].id]), /wrong_field/, 'wrong field');

    const id = await proposeBooking(v, 'https://bookwhen.com/venue7');
    await q(`select apply_booking_url_proposal($1,null,null)`, [id]);
    await throws(q(`select apply_booking_url_proposal($1,null,null)`, [id]), /not_pending/, 'double apply refused');
  });

  await test('D: reject_venue_proposal already closes a booking_url proposal (no change needed)', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://venue8.co.uk' });
    const id = await proposeBooking(v, 'https://bookwhen.com/venue8');
    const res = await q(`select reject_venue_proposal($1,'not the right venue') as r`, [id]);
    eq(res.rows[0].r.ok, true, 'rejected');
    eq((await q(`select status from venue_field_proposals where id=$1`, [id])).rows[0].status, 'rejected', 'terminal');
  });

  await test('D: apply_booking_url_proposal is not executable by anon', async () => {
    const r = await q(`select has_function_privilege('anon','apply_booking_url_proposal(uuid,text,text)','execute') as a`);
    eq(r.rows[0].a, false, 'anon denied');
  });

  // ── E. resolve_facility_conflict ──────────────────────────────────────────
  await test('E: an admin can remove an official-enrichment facility row to resolve a conflict', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const f = await q(`insert into facilities (slug, name) values ('parking','Parking') returning id`);
    await q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,'official-enrichment')`, [v, f.rows[0].id]);

    const res = await q(`select resolve_facility_conflict($1,'parking','remove_official','site says no parking') as r`, [v]);
    eq(res.rows[0].r.removed, 1, 'one row removed');
    eq((await q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v])).rows[0].n, 0, 'row gone');
  });

  await test('E: NEVER removes a parent-confirmed row — community evidence is protected', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const f = await q(`select id from facilities where slug='parking'`);
    await q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,'parent-confirmed')`, [v, f.rows[0].id]);

    const res = await q(`select resolve_facility_conflict($1,'parking','remove_official',null) as r`, [v]);
    eq(res.rows[0].r.removed, 0, 'nothing removed');
    eq((await q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v])).rows[0].n, 1, 'parent-confirmed row survives');
  });

  await test('E: NEVER removes an admin/import row (NULL notes)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const f = await q(`select id from facilities where slug='parking'`);
    await q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,null)`, [v, f.rows[0].id]);
    const res = await q(`select resolve_facility_conflict($1,'parking','remove_official',null) as r`, [v]);
    eq(res.rows[0].r.removed, 0, 'nothing removed');
  });

  await test("E: 'keep' is a real terminal outcome and removes nothing", async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const f = await q(`select id from facilities where slug='parking'`);
    await q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,'official-enrichment')`, [v, f.rows[0].id]);
    const res = await q(`select resolve_facility_conflict($1,'parking','keep',null) as r`, [v]);
    eq(res.rows[0].r.decision, 'keep', 'decision recorded');
    eq(res.rows[0].r.removed, 0, 'nothing removed');
    eq((await q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v])).rows[0].n, 1, 'row kept');
  });

  await test('E: a NON-admin cannot resolve a facility conflict, and an unknown slug is refused', async () => {
    await asUid(USER);
    const v = await newVenue();
    await throws(q(`select resolve_facility_conflict($1,'parking','remove_official',null)`, [v]), /not_admin/, 'non-admin refused');
    await asUid(ADMIN);
    await throws(q(`select resolve_facility_conflict($1,'no-such-slug','remove_official',null)`, [v]), /unknown_facility_slug/, 'unknown slug refused');
    await throws(q(`select resolve_facility_conflict($1,'parking','banana',null)`, [v]), /invalid_decision/, 'bad decision refused');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  FAILED: ${f.name} — ${f.message}`);
    process.exit(1);
  }
}

await main();
