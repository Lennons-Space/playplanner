// =============================================================================
// supabase/tests/059_enrichment_autonomy.mjs
//
// Behavioural database tests for migration 059 (Enrichment 2.0 autonomy layer)
// using an in-process Postgres (pglite) — NO live Supabase, NO production
// access, and migration 059 is NOT applied to any real project by this file.
// Loads a minimal bootstrap + the REAL 056 migration (059 alters/depends on
// objects 056 creates) + the REAL 059 migration file, then exercises the new
// RPCs, tables, and RLS/grants exactly like 056's own test file does.
//
// Run:  node supabase/tests/059_enrichment_autonomy.mjs
// (Not yet wired into package.json's "test:db" — see the final Enrichment 2.0
// report for why: migration 059 itself is still pending Liam's review/apply,
// so wiring it into the standard gate would make test:db depend on
// unreviewed/unapplied schema. Run this file directly until 059 is approved.)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_056 = readFileSync(join(__dirname, '../migrations/056_venue_website_enrichment.sql'), 'utf8');
const MIGRATION_059 = readFileSync(join(__dirname, '../migrations_drafts/059_enrichment_autonomy.sql'), 'utf8');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

// Minimal prerequisite schema — mirrors 056's own bootstrap, EXTENDED with the
// venues columns and categories table that 059's auto_accept_candidate insert
// touches. Deliberately omits PostGIS/location/slug/claimed_by/etc. — 059
// never reads or writes those, so they add nothing to this test's coverage
// (same "minimal, not full production schema" principle 056's own test uses).
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

  create table categories (
    id uuid primary key default gen_random_uuid(),
    name text unique not null,
    slug text unique not null
  );
  insert into categories (name, slug) values ('Animal Attractions', 'animal-attraction');

  create table venues (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'Test Venue',
    category_id uuid references categories(id),
    address_line1 text,
    city text,
    postcode text,
    country text default 'GB',
    latitude decimal(9,6) not null default 52.0,
    longitude decimal(9,6) not null default -1.0,
    description text,
    price_range text check (price_range in ('free','budget','moderate','premium')),
    website text, phone text, email text,
    is_published boolean default false,
    is_verified boolean default false,
    moderation_status text default 'pending' check (moderation_status in ('pending','approved','rejected')),
    moderation_notes text,
    discovery_approved boolean default true,
    data_source text,
    updated_at timestamptz default now()
  );

  create table opening_hours (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    day_of_week int not null check (day_of_week between 0 and 6),
    opens_at time, closes_at time, is_closed boolean default false, notes text,
    unique (venue_id, day_of_week)
  );

  insert into profiles (id, is_admin) values ('${ADMIN}', true), ('${USER}', false);
`;

// ── Tiny assert harness (identical to 056's) ─────────────────────────────────
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
    return;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);
const asUid = (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);

async function newVenue(overrides = {}) {
  const r = await q(
    `insert into venues (name, website, phone, email, is_verified, postcode, city)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      overrides.name ?? 'Test Venue', overrides.website ?? null, overrides.phone ?? null,
      overrides.email ?? null, overrides.is_verified ?? false, overrides.postcode ?? null, overrides.city ?? null,
    ],
  );
  return r.rows[0].id;
}
async function newRun(venueId) {
  const r = await q(
    `insert into venue_enrichment_runs (venue_id, run_label, outcome) values ($1,'t','extracted') returning id`,
    [venueId],
  );
  return r.rows[0].id;
}
async function propose(runId, venueId, field, proposed, extra = {}) {
  const r = await q(
    `select propose_field($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11) as id`,
    [runId, venueId, field, JSON.stringify(proposed), 'https://v.example/', extra.evidence ?? 'evidence', extra.evidenceRaw ?? null, extra.method ?? 'jsonld', extra.confidence ?? 'high', extra.conflicts ?? false, extra.retrievedAt ?? '2026-08-14T10:00:00.000Z'],
  );
  return r.rows[0].id;
}
async function newCandidate(overrides = {}) {
  const r = await q(
    `insert into venue_discovery_candidates (
       name, latitude, longitude, postcode, city, source, source_id, dedupe_decision,
       confidence_score, has_family_relevant_category, has_valid_uk_coordinates,
       has_valid_address, is_trusted_source, official_verification, has_closure_signal,
       required_fields_complete
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [
      overrides.name ?? 'New Zoo', overrides.latitude ?? 52.1, overrides.longitude ?? -1.1,
      'postcode' in overrides ? overrides.postcode : 'AB1 2CD', overrides.city ?? 'Anytown', overrides.source ?? 'osm',
      overrides.source_id ?? `node/${Math.floor(Math.random() * 1e9)}`, overrides.dedupe_decision ?? 'distinct',
      overrides.confidence_score ?? 99, overrides.has_family_relevant_category ?? true,
      overrides.has_valid_uk_coordinates ?? true, overrides.has_valid_address ?? true,
      overrides.is_trusted_source ?? true, overrides.official_verification ?? false,
      overrides.has_closure_signal ?? false, overrides.required_fields_complete ?? true,
    ],
  );
  return r.rows[0].id;
}

async function main() {
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_056);
  await db.exec(MIGRATION_059);

  console.log('\nMigration 059 — database tests (pglite, no live Supabase, migration NOT applied to production)\n');

  // ── auto_apply_field_proposal ────────────────────────────────────────────
  await test('happy: auto-applies a high-confidence phone proposal, sets applied_by=system', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441234567890' });
    const res = await q(`select auto_apply_field_proposal($1, 90::smallint, 88::smallint) as r`, [id]);
    eq(res.rows[0].r.ok, true, 'auto-apply ok');
    const venue = await q(`select phone from venues where id=$1`, [v]);
    eq(venue.rows[0].phone, '+441234567890', 'phone written');
    const row = await q(`select status, applied_by, confidence_score from venue_field_proposals where id=$1`, [id]);
    eq(row.rows[0].status, 'applied', 'status applied');
    eq(row.rows[0].applied_by, 'system', 'applied_by system');
    eq(row.rows[0].confidence_score, 90, 'confidence_score persisted');
  });

  await test('rejects below-threshold score', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441' });
    await throws(q(`select auto_apply_field_proposal($1, 80::smallint, 88::smallint)`, [id]), /below_min_score/, 'below threshold rejected');
  });

  await test('never auto-applies price_range regardless of score', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'price_range', { v: 'moderate' });
    await throws(q(`select auto_apply_field_proposal($1, 100::smallint, 50::smallint)`, [id]), /field_never_auto_applies/, 'price_range blocked');
  });

  await test('never auto-applies description regardless of score', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'description', { v: 'A farm' }, { evidence: 'A farm with animals.' });
    await throws(q(`select auto_apply_field_proposal($1, 100::smallint, 50::smallint)`, [id]), /field_never_auto_applies/, 'description blocked');
  });

  await test('rejects a proposal that conflicts with an existing value', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://old.example/' });
    const run = await newRun(v);
    const id = await propose(run, v, 'website', { v: 'https://new.example/' }, { conflicts: true });
    await throws(q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [id]), /conflicts_existing_requires_human_review/, 'conflict blocked');
  });

  await test('stale current value blocks auto-apply just like the human path', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441' });
    await q(`update venues set phone='+449999' where id=$1`, [v]); // edited after snapshot
    await throws(q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [id]), /stale_current_value/, 'stale guard');
  });

  await test('rejects a non-pending proposal (already applied)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441' });
    await q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [id]);
    await throws(q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [id]), /not_pending/, 're-apply rejected');
  });

  await test('opening_hours clean week auto-applies', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const week = {
      seasonal_notes: null,
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, is_closed: d === 0, intervals: d === 0 ? [] : [{ opens: '09:00', closes: '17:00' }] })),
    };
    const id = await propose(run, v, 'opening_hours', week);
    await q(`select auto_apply_field_proposal($1, 95::smallint, 92::smallint)`, [id]);
    const rows = await q(`select day_of_week, is_closed from opening_hours where venue_id=$1 order by day_of_week`, [v]);
    eq(rows.rows.length, 7, '7 rows after auto-apply');
    eq(rows.rows[0].is_closed, true, 'Sunday closed');
  });

  await test('opening_hours with seasonal_notes requires human review, never auto-applies', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const week = {
      seasonal_notes: 'term-time only',
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] })),
    };
    const id = await propose(run, v, 'opening_hours', week);
    await throws(q(`select auto_apply_field_proposal($1, 95::smallint, 92::smallint)`, [id]), /seasonal_notes_require_human_review/, 'seasonal blocked');
  });

  await test('auth: auto_apply_field_proposal is service_role only (authenticated denied)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441' });
    await db.exec('set role authenticated');
    await throws(q(`select auto_apply_field_proposal('${id}', 95::smallint, 88::smallint)`), /permission denied/i, 'authenticated must not execute');
    await db.exec('reset role');
  });

  // ── Closure ladder ────────────────────────────────────────────────────────
  await test('system_flag_suspected_closure moves active -> suspected_closed', async () => {
    const v = await newVenue();
    await q(`select system_flag_suspected_closure($1, 'closure phrase detected')`, [v]);
    const r = await q(`select operating_status from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'suspected_closed', 'flagged');
  });

  await test('system_flag_suspected_closure is a no-op on an already-confirmed venue (additive-only)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    await q(`select confirm_venue_closure($1, 'confirmed by admin')`, [v]);
    await q(`select system_flag_suspected_closure($1, 'later signal')`, [v]);
    const r = await q(`select operating_status from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'confirmed_closed', 'stays confirmed, never downgraded');
  });

  await test('confirm_venue_closure is admin-only and hides the venue from discovery', async () => {
    const v = await newVenue();
    await db.exec('set role authenticated');
    await asUid(USER);
    await throws(q(`select confirm_venue_closure('${v}', 'x')`), /not_admin/, 'non-admin blocked');
    await db.exec('reset role');
    await asUid(ADMIN);
    await q(`select confirm_venue_closure($1, 'permanently shut')`, [v]);
    const r = await q(`select operating_status, discovery_approved from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'confirmed_closed', 'confirmed');
    eq(r.rows[0].discovery_approved, false, 'hidden from discovery');
  });

  await test('reactivate_venue is admin-only and resets to active', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    await q(`select confirm_venue_closure($1, 'x')`, [v]);
    await q(`select reactivate_venue($1)`, [v]);
    const r = await q(`select operating_status, discovery_approved from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'active', 'reactivated');
    eq(r.rows[0].discovery_approved, true, 'discoverable again');
  });

  await test('auth: system_flag_suspected_closure is service_role only', async () => {
    const v = await newVenue();
    await db.exec('set role authenticated');
    await throws(q(`select system_flag_suspected_closure('${v}', 'x')`), /permission denied/i, 'authenticated must not execute');
    await db.exec('reset role');
  });

  // ── Discovery candidates / auto_accept_candidate ─────────────────────────
  await test('happy: auto_accept_candidate publishes a new venue and marks the candidate', async () => {
    const c = await newCandidate();
    const res = await q(`select auto_accept_candidate($1) as r`, [c]);
    eq(res.rows[0].r.ok, true, 'accept ok');
    const venueId = res.rows[0].r.venue_id;
    const venue = await q(`select is_published, discovery_approved, moderation_status from venues where id=$1`, [venueId]);
    eq(venue.rows[0].is_published, true, 'published');
    eq(venue.rows[0].discovery_approved, true, 'discoverable');
    const cand = await q(`select status, venue_id from venue_discovery_candidates where id=$1`, [c]);
    eq(cand.rows[0].status, 'auto_accepted', 'candidate marked accepted');
    eq(cand.rows[0].venue_id, venueId, 'candidate linked to new venue');
  });

  await test('rejects a candidate below the default min score (98)', async () => {
    const c = await newCandidate({ confidence_score: 97 });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /below_min_score/, 'below 98 rejected');
  });

  await test('rejects a non-distinct dedupe decision', async () => {
    const c = await newCandidate({ dedupe_decision: 'possible_duplicate' });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /not_distinct/, 'possible_duplicate rejected');
  });

  await test('rejects when any accept-gate boolean is false', async () => {
    const c = await newCandidate({ is_trusted_source: false });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /accept_gate_not_satisfied/, 'gate failure rejected');
  });

  await test('rejects a candidate with a closure signal', async () => {
    const c = await newCandidate({ has_closure_signal: true });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /has_closure_signal/, 'closure signal blocks accept');
  });

  await test('rejects a candidate missing postcode/city', async () => {
    const c = await newCandidate({ postcode: null });
    await throws(q(`select auto_accept_candidate($1)`, [c]), /missing_required_venue_fields/, 'missing address blocked');
  });

  await test('is idempotent — cannot re-accept an already-accepted candidate', async () => {
    const c = await newCandidate();
    await q(`select auto_accept_candidate($1)`, [c]);
    await throws(q(`select auto_accept_candidate($1)`, [c]), /not_pending_candidate/, 're-accept blocked');
  });

  await test('auth: auto_accept_candidate is service_role only', async () => {
    const c = await newCandidate();
    await db.exec('set role authenticated');
    await throws(q(`select auto_accept_candidate('${c}')`), /permission denied/i, 'authenticated must not execute');
    await db.exec('reset role');
  });

  // ── RLS on the new tables ────────────────────────────────────────────────
  await test('rls: non-admin authenticated sees zero discovery candidates; admin sees them', async () => {
    await newCandidate();
    await db.exec(`grant select on venue_discovery_candidates to authenticated`);
    await asUid(USER);
    await db.exec('set role authenticated');
    const denied = await q(`select count(*)::int as n from venue_discovery_candidates`);
    await db.exec('reset role');
    eq(denied.rows[0].n, 0, 'non-admin sees zero rows (RLS)');

    await asUid(ADMIN);
    await db.exec('set role authenticated');
    const seen = await q(`select count(*)::int as n from venue_discovery_candidates`);
    await db.exec('reset role');
    assert(seen.rows[0].n > 0, 'admin sees rows');
  });

  await test('rls: non-admin authenticated sees zero closure signals; admin sees them', async () => {
    const v = await newVenue();
    await q(
      `insert into venue_closure_signals (venue_id, kind, source_url, evidence_snippet, source_tier, detected_at)
       values ($1, 'explicit_official_text', 'https://v.example/', 'we have closed', 1, now())`,
      [v],
    );
    await db.exec(`grant select on venue_closure_signals to authenticated`);
    await asUid(USER);
    await db.exec('set role authenticated');
    const denied = await q(`select count(*)::int as n from venue_closure_signals`);
    await db.exec('reset role');
    eq(denied.rows[0].n, 0, 'non-admin sees zero rows (RLS)');

    await asUid(ADMIN);
    await db.exec('set role authenticated');
    const seen = await q(`select count(*)::int as n from venue_closure_signals`);
    await db.exec('reset role');
    assert(seen.rows[0].n > 0, 'admin sees rows');
  });

  // ── Additive-only sanity check ────────────────────────────────────────────
  await test('056 apply_venue_proposal (human path) still works unchanged after 059 loads', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+440000' });
    await q(`update venue_field_proposals set status='approved' where id=$1`, [id]);
    await q(`select apply_venue_proposal($1)`, [id]);
    const venue = await q(`select phone from venues where id=$1`, [v]);
    eq(venue.rows[0].phone, '+440000', '056 human-apply path unaffected by 059');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
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
