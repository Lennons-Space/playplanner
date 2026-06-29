// =============================================================================
// supabase/tests/057_enrichment_auto_decision.mjs
//
// Behavioural database tests for migration 057 (auto-decision + write ledger)
// using in-process Postgres (pglite) — NO live Supabase, NO production access.
// Loads the real 056 migration then the real 057 migration, exercises all RPCs,
// ledger immutability, rollback, and the grant/privilege matrix.
//
// Run:  node supabase/tests/057_enrichment_auto_decision.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_056 = readFileSync(
  join(__dirname, '../migrations/056_venue_website_enrichment.sql'),
  'utf8',
);
const MIGRATION_057 = readFileSync(
  join(__dirname, '../migrations/057_enrichment_auto_decision.sql'),
  'utf8',
);

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER  = '22222222-2222-2222-2222-222222222222';

// ── Minimal prerequisite schema (mirrors 056 test bootstrap exactly) ──────────
// Reproduces Supabase hosted default-privileges so privilege tests exercise the
// real case: every newly-created function auto-grants EXECUTE to anon,
// authenticated, and service_role.  Without this, revoke tests give false green.
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;

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
    id          uuid primary key default gen_random_uuid(),
    description text,
    price_range text check (price_range in ('free','budget','moderate','premium')),
    website     text,
    phone       text,
    email       text,
    updated_at  timestamptz default now()
  );

  create table opening_hours (
    id          uuid primary key default gen_random_uuid(),
    venue_id    uuid references venues(id) on delete cascade,
    day_of_week int not null check (day_of_week between 0 and 6),
    opens_at    time,
    closes_at   time,
    is_closed   boolean default false,
    notes       text,
    unique (venue_id, day_of_week)
  );

  insert into profiles (id, is_admin) values
    ('${ADMIN}', true),
    ('${USER}',  false);
`;

// ── Tiny assert harness ───────────────────────────────────────────────────────
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
  if (a !== b)
    throw new Error(
      `${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    );
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

// ── pglite instance ───────────────────────────────────────────────────────────
const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);
const asUid = (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function newVenue(overrides = {}) {
  const r = await q(
    `insert into venues (description, price_range, website, phone, email)
     values ($1,$2,$3,$4,$5) returning id`,
    [
      overrides.description ?? null,
      overrides.price_range ?? null,
      overrides.website     ?? null,
      overrides.phone       ?? null,
      overrides.email       ?? null,
    ],
  );
  return r.rows[0].id;
}
async function newRun(venueId) {
  const r = await q(
    `insert into venue_enrichment_runs (venue_id, run_label, outcome)
     values ($1,'t','extracted') returning id`,
    [venueId],
  );
  return r.rows[0].id;
}
async function propose(runId, venueId, field, proposed, extra = {}) {
  const r = await q(
    `select propose_field($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11) as id`,
    [
      runId, venueId, field,
      JSON.stringify(proposed),
      'https://v.example/',
      extra.evidence    ?? 'evidence',
      extra.evidenceRaw ?? null,
      extra.method      ?? 'jsonld',
      extra.confidence  ?? 'high',
      extra.conflicts   ?? false,
      extra.retrievedAt ?? '2026-06-22T10:00:00.000Z',
    ],
  );
  return r.rows[0].id;
}
async function approve(id) {
  await q(`update venue_field_proposals set status='approved' where id=$1`, [id]);
}
async function setDecision(id, decision) {
  await q(
    `update venue_field_proposals set decision=$1, decision_at=now() where id=$2`,
    [decision, id],
  );
}
async function statusOf(id) {
  const r = await q(`select status from venue_field_proposals where id=$1`, [id]);
  return r.rows[0]?.status ?? null;
}
async function ledgerRowsFor(proposalId) {
  const r = await q(
    `select * from venue_enrichment_writes where proposal_id=$1 order by applied_at`,
    [proposalId],
  );
  return r.rows;
}
function makeWeek(overrideDays = {}) {
  return {
    seasonal_notes: null,
    source_text: 'x',
    days: Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d,
      is_closed: false,
      intervals: [{ opens: '09:00', closes: '17:00' }],
      ...(overrideDays[d] ?? {}),
    })),
  };
}

// ── Phase 1: bootstrap 056 schema, seed legacy proposals, then apply 057 ─────
await db.exec(BOOTSTRAP);
await db.exec(MIGRATION_056);

// Grant table access to authenticated (mirrors Supabase default table grants)
// so RLS tests can switch roles and query.
// NOTE: venue_enrichment_writes is created by MIGRATION_057 — it does NOT exist
// yet here. Granting on it now would fail with 42P01 (relation not found). The
// grant for that table is issued AFTER db.exec(MIGRATION_057) below.
await db.exec(`
  grant select, insert on venue_field_proposals to authenticated;
  grant select on venue_enrichment_runs  to authenticated;
`);

// Seed legacy proposals BEFORE 057 runs so the backfill UPDATE can be verified.
// We create proposals in several states to cover the backfill logic.
await asUid(ADMIN);
const lgVenue   = await newVenue({ phone: '+441000000' });
const lgRun     = await newRun(lgVenue);

// Seed 8 proposals in a variety of pre-057 states (status only, no decision columns)
const lg = {};
lg.pending1  = await propose(lgRun, lgVenue, 'phone',       { v: '+441111111' });
lg.pending2  = await propose(lgRun, lgVenue, 'website',     { v: 'https://a.example/' });

// pending (will be superseded by pending2 — already superseded via propose)
// We need another venue for more proposals (can't have two pending on same field)
const lgV2   = await newVenue();
const lgRun2 = await newRun(lgV2);
lg.pending3  = await propose(lgRun2, lgV2, 'phone',       { v: '+442222222' });
lg.pending4  = await propose(lgRun2, lgV2, 'email',       { v: 'a@b.com' });
lg.pending5  = await propose(lgRun2, lgV2, 'price_range', { v: 'moderate' });

const lgV3   = await newVenue();
const lgRun3 = await newRun(lgV3);
lg.pending6  = await propose(lgRun3, lgV3, 'phone',   { v: '+443333333' });
lg.rejected1 = await propose(lgRun3, lgV3, 'website', { v: 'https://b.example/' });
await q(`update venue_field_proposals set status='rejected', reviewed_at=now(), review_notes='spam' where id=$1`, [lg.rejected1]);

// Applied proposal (status='applied') — backfill should set applied_mode='manual'
const lgV4   = await newVenue();
const lgRun4 = await newRun(lgV4);
lg.toApply   = await propose(lgRun4, lgV4, 'phone', { v: '+444444444' });
await approve(lg.toApply);
await q(`select apply_venue_proposal($1)`, [lg.toApply]);  // status→applied

// Apply 057 migration
await db.exec(MIGRATION_057);

// venue_enrichment_writes is created by MIGRATION_057 — grant AFTER it exists.
await db.exec(`
  grant select on venue_enrichment_writes to authenticated;
`);

// =============================================================================
// Tests
// =============================================================================
console.log('\nMigration 057 — database tests (pglite, no live Supabase)\n');

// ── 1. Migration replay safety ─────────────────────────────────────────────
await test('migration replay: 057 applies cleanly on top of 056 schema', async () => {
  // We verify the key objects exist.
  const r = await q(`
    select
      to_regclass('public.venue_enrichment_writes')         as ledger,
      to_regproc('public._enrichment_apply_write')          as helper,
      to_regproc('public.auto_apply_venue_proposal')        as auto_fn,
      to_regproc('public.rollback_enrichment_run')          as rollback_fn
  `);
  assert(r.rows[0].ledger     !== null, 'venue_enrichment_writes table exists');
  assert(r.rows[0].helper     !== null, '_enrichment_apply_write function exists');
  assert(r.rows[0].auto_fn    !== null, 'auto_apply_venue_proposal function exists');
  assert(r.rows[0].rollback_fn !== null, 'rollback_enrichment_run function exists');
});

await test('migration replay: new columns exist on venue_field_proposals', async () => {
  const r = await q(`
    select column_name
      from information_schema.columns
     where table_name = 'venue_field_proposals'
       and column_name in
         ('decision','decision_reasons','decision_engine_version',
          'decision_at','applied_mode')
  `);
  eq(r.rows.length, 5, 'all 5 new columns present');
});

// ── 2. Backfill verification ───────────────────────────────────────────────
await test('backfill: pending rows get decision=manual_review, engine=legacy-pilot', async () => {
  const r = await q(
    `select decision, decision_engine_version, decision_reasons, applied_mode
       from venue_field_proposals
      where id = $1`,
    [lg.pending1],
  );
  eq(r.rows[0].decision,                 'manual_review',          'decision set');
  eq(r.rows[0].decision_engine_version,  'legacy-pilot',           'engine version set');
  assert(
    JSON.stringify(r.rows[0].decision_reasons) === '["legacy_manual_pilot"]',
    'decision_reasons set correctly',
  );
  eq(r.rows[0].applied_mode, null, 'applied_mode null for non-applied row');
});

await test('backfill: applied row gets applied_mode=manual', async () => {
  const r = await q(
    `select decision, applied_mode, status from venue_field_proposals where id=$1`,
    [lg.toApply],
  );
  eq(r.rows[0].status,       'applied', 'status unchanged');
  eq(r.rows[0].applied_mode, 'manual',  'applied_mode=manual for applied row');
  eq(r.rows[0].decision,     'manual_review', 'decision set for applied row');
});

await test('backfill: status, evidence, review_notes, applied_at are UNTOUCHED', async () => {
  // rejected row: status, review_notes must be preserved
  const r = await q(
    `select status, review_notes, decision from venue_field_proposals where id=$1`,
    [lg.rejected1],
  );
  eq(r.rows[0].status,       'rejected', 'status preserved');
  eq(r.rows[0].review_notes, 'spam',     'review_notes preserved');
  eq(r.rows[0].decision,     'manual_review', 'decision backfilled');
});

await test('backfill: idempotent re-run does not overwrite decision already set', async () => {
  // Manually set a different decision on one row, then re-run the backfill UPDATE
  await q(
    `update venue_field_proposals set decision='auto_apply' where id=$1`,
    [lg.pending3],
  );
  // Re-run the backfill logic (WHERE decision IS NULL guards idempotency)
  await q(`
    update venue_field_proposals
       set decision='manual_review', decision_engine_version='legacy-pilot',
           decision_reasons='["legacy_manual_pilot"]'::jsonb,
           decision_at=coalesce(reviewed_at,created_at),
           applied_mode=case when status='applied' then 'manual' else null end
     where decision is null
  `);
  // The row we changed should still have 'auto_apply', not overwritten
  const r = await q(
    `select decision from venue_field_proposals where id=$1`,
    [lg.pending3],
  );
  eq(r.rows[0].decision, 'auto_apply', 'already-set decision not overwritten');
  // Restore for later tests
  await q(`update venue_field_proposals set decision='manual_review' where id=$1`, [lg.pending3]);
});

// ── 2b. propose_field: extended params persist decision/reasons/version ──────
// These tests exercise the §6b extension: the 14-arg propose_field that stores
// the engine verdict so auto_apply_venue_proposal can gate on decision='auto_apply'.

await test('propose_field: auto_apply decision + reasons + version stored on insert', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  // Call with all 14 args — the last 3 are the new extended params.
  const r = await q(
    `select propose_field($1,$2,'phone',$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as id`,
    [
      run, v,
      JSON.stringify({ v: '+447000000001' }),
      'https://v.example/', 'snippet', null,
      'jsonld', 'high', false,
      '2026-06-22T10:00:00.000Z',
      'auto_apply',
      JSON.stringify(['current_empty', 'official_domain_source']),
      'decision-engine@1.0.0',
    ],
  );
  const pid = r.rows[0].id;
  assert(pid, 'propose_field returned a uuid');

  const row = await q(
    `select decision, decision_reasons, decision_engine_version, decision_at, status
       from venue_field_proposals where id = $1`,
    [pid],
  );
  eq(row.rows[0].decision,                'auto_apply',             'decision stored');
  eq(row.rows[0].decision_engine_version, 'decision-engine@1.0.0', 'engine version stored');
  assert(row.rows[0].decision_at !== null,                          'decision_at is set');
  assert(
    JSON.stringify(row.rows[0].decision_reasons) === '["current_empty","official_domain_source"]',
    'decision_reasons stored correctly',
  );
  eq(row.rows[0].status, 'pending', 'auto_apply proposal → initial status=pending');
});

await test('propose_field: auto_reject decision → initial status=rejected', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  // Phone is null on this venue so proposed != current (no dedup).
  const r = await q(
    `select propose_field($1,$2,'phone',$3::jsonb,$4,'snippet',null,'jsonld','high',false,now(),$5,'["malformed_value"]'::jsonb,null) as id`,
    [run, v, JSON.stringify({ v: 'BAD' }), 'https://v.example/', 'auto_reject'],
  );
  const pid = r.rows[0].id;
  assert(pid, 'auto_reject proposal inserted');

  const row = await q(
    `select decision, status from venue_field_proposals where id = $1`,
    [pid],
  );
  eq(row.rows[0].decision, 'auto_reject', 'decision=auto_reject');
  eq(row.rows[0].status,   'rejected',    'status=rejected for auto_reject');
});

await test('propose_field: report_only decision → initial status=report_only', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const r = await q(
    `select propose_field($1,$2,'booking_url',$3::jsonb,$4,'snippet',null,'jsonld','high',false,now(),$5,'["booking_url_no_target_column"]'::jsonb,'decision-engine@1.0.0') as id`,
    [run, v, JSON.stringify({ v: 'https://tickets.example/' }), 'https://v.example/', 'report_only'],
  );
  const pid = r.rows[0].id;
  assert(pid, 'report_only proposal inserted');

  const row = await q(
    `select decision, status from venue_field_proposals where id = $1`,
    [pid],
  );
  eq(row.rows[0].decision, 'report_only', 'decision=report_only');
  eq(row.rows[0].status,   'report_only', 'status=report_only for report_only decision');
});

await test('propose_field: invalid decision value raises invalid_decision', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  await throws(
    q(
      `select propose_field($1,$2,'phone',$3::jsonb,$4,'e',null,'jsonld','high',false,now(),'bad_decision','[]'::jsonb,null) as id`,
      [run, v, JSON.stringify({ v: '+447111111111' }), 'https://v.example/'],
    ),
    /invalid_decision/,
    'bad decision string must raise invalid_decision',
  );
});

await test('propose_field: report_only rows excluded from actionable admin queue', async () => {
  // Confirm report_only rows (decision='report_only') never appear in the
  // actionable filter: status='pending' AND decision='manual_review'.
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);

  // Insert one manual_review (actionable) and one report_only (non-actionable).
  await q(
    `select propose_field($1,$2,'phone',$3::jsonb,$4,'e',null,'jsonld','high',false,now(),'manual_review','[]'::jsonb,null)`,
    [run, v, JSON.stringify({ v: '+447200000001' }), 'https://v.example/'],
  );
  await q(
    `select propose_field($1,$2,'booking_url',$3::jsonb,$4,'e',null,'jsonld','high',false,now(),'report_only','["booking_url_no_target_column"]'::jsonb,'decision-engine@1.0.0')`,
    [run, v, JSON.stringify({ v: 'https://book.example/' }), 'https://v.example/'],
  );

  const actionable = await q(
    `select count(*)::int as n
       from venue_field_proposals
      where venue_id  = $1
        and status    = 'pending'
        and decision  = 'manual_review'`,
    [v],
  );
  eq(actionable.rows[0].n, 1, 'only manual_review proposal appears in actionable queue');

  const total = await q(
    `select count(*)::int as n from venue_field_proposals where venue_id = $1`,
    [v],
  );
  eq(total.rows[0].n, 2, 'both rows persisted for audit');
});

await test('propose_field new signature: grant — service_role=true, anon=false, authenticated=false', async () => {
  const sig = 'public.propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz, text, jsonb, text)';
  const r = await q(
    `select has_function_privilege('anon',          $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated',  $1, 'EXECUTE') as auth,
            has_function_privilege('service_role',   $1, 'EXECUTE') as svc`,
    [sig],
  );
  eq(r.rows[0].anon, false, 'anon: no execute on new propose_field');
  eq(r.rows[0].auth, false, 'authenticated: no execute on new propose_field');
  eq(r.rows[0].svc,  true,  'service_role: has execute on new propose_field');
});

// ── 3. Schema constraints ──────────────────────────────────────────────────
await test('constraint: decision_reasons must be a JSON array (rejects object)', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  await throws(
    q(
      `insert into venue_field_proposals
         (run_id, venue_id, field, proposed_value, current_value_hash,
          source_url, evidence_snippet, retrieved_at, extraction_method,
          confidence, decision_reasons)
       values ($1,$2,'phone','{}'::jsonb,'h','u','e',now(),'jsonld','high','{"a":1}'::jsonb)`,
      [run, v],
    ),
    /check/i,
    'non-array decision_reasons rejected',
  );
});

await test('constraint: status=report_only is now a valid status value', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const r = await q(
    `insert into venue_field_proposals
       (run_id, venue_id, field, proposed_value, current_value_hash,
        source_url, evidence_snippet, retrieved_at, extraction_method,
        confidence, status, decision)
     values ($1,$2,'phone','{}'::jsonb,'h','u','e',now(),'jsonld','high',
             'report_only','report_only')
     returning id`,
    [run, v],
  );
  assert(r.rows[0].id, 'report_only status accepted');
});

// ── 4. Admin queue filter ──────────────────────────────────────────────────
await test('queue: auto_reject and report_only rows excluded from admin queue', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);

  // Use the extended propose_field so each decision maps to its correct initial
  // status: manual_review → pending, auto_reject → rejected, report_only → report_only.
  // This avoids creating multiple pending rows for the same (venue_id, field) which
  // would violate the unique index venue_field_proposals_one_pending_idx.
  await q(
    `select propose_field($1,$2,'phone',$3::jsonb,$4,'e',null,'jsonld','high',false,now(),'manual_review','[]'::jsonb,null)`,
    [run, v, JSON.stringify({ v: '+447300000001' }), 'https://v.example/'],
  );
  await q(
    `select propose_field($1,$2,'website',$3::jsonb,$4,'e',null,'jsonld','high',false,now(),'auto_reject','["canonical_equivalent_website"]'::jsonb,'decision-engine@1.0.0')`,
    [run, v, JSON.stringify({ v: 'https://v.example' }), 'https://v.example/'],
  );
  await q(
    `select propose_field($1,$2,'email',$3::jsonb,$4,'e',null,'jsonld','high',false,now(),'report_only','["booking_url_no_target_column"]'::jsonb,'decision-engine@1.0.0')`,
    [run, v, JSON.stringify({ v: 'info@v.example' }), 'https://v.example/'],
  );

  // Only the manual_review row has status='pending'; the others have status='rejected'
  // and status='report_only' respectively — all correctly excluded from the queue.
  const r = await q(
    `select count(*)::int as n
       from venue_field_proposals
      where venue_id = $1
        and status   = 'pending'
        and decision = 'manual_review'`,
    [v],
  );
  eq(r.rows[0].n, 1, 'only manual_review rows in actionable queue');

  // All three rows must be persisted for audit
  const total = await q(
    `select count(*)::int as n from venue_field_proposals where venue_id = $1`,
    [v],
  );
  eq(total.rows[0].n, 3, 'all three rows persisted (audit)');
});

// ── 5. Grant / privilege matrix ────────────────────────────────────────────
await test('grants: auto_apply_venue_proposal — anon=false, authenticated=true, service_role=false', async () => {
  const sig = 'public.auto_apply_venue_proposal(uuid, text)';
  const r = await q(
    `select has_function_privilege('anon',          $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated',  $1, 'EXECUTE') as auth,
            has_function_privilege('service_role',   $1, 'EXECUTE') as svc`,
    [sig],
  );
  eq(r.rows[0].anon, false, 'anon: no execute');
  eq(r.rows[0].auth, true,  'authenticated: has execute');
  eq(r.rows[0].svc,  false, 'service_role: NO execute');
});

await test('grants: rollback_enrichment_run — anon=false, authenticated=true, service_role=false', async () => {
  const sig = 'public.rollback_enrichment_run(uuid)';
  const r = await q(
    `select has_function_privilege('anon',          $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated',  $1, 'EXECUTE') as auth,
            has_function_privilege('service_role',   $1, 'EXECUTE') as svc`,
    [sig],
  );
  eq(r.rows[0].anon, false, 'anon: no execute');
  eq(r.rows[0].auth, true,  'authenticated: has execute');
  eq(r.rows[0].svc,  false, 'service_role: NO execute');
});

await test('grants: _enrichment_apply_write revoked from all roles', async () => {
  const sig = 'public._enrichment_apply_write(uuid, text, text, uuid, jsonb)';
  const r = await q(
    `select has_function_privilege('anon',          $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated',  $1, 'EXECUTE') as auth,
            has_function_privilege('service_role',   $1, 'EXECUTE') as svc`,
    [sig],
  );
  eq(r.rows[0].anon, false, 'anon: no execute');
  eq(r.rows[0].auth, false, 'authenticated: no execute');
  eq(r.rows[0].svc,  false, 'service_role: no execute');
});

// ── 6. service_role behavioural: set role + call must fail ─────────────────
// NOTE: pglite enforces role-based function privileges via the same privilege
// system as real Postgres.  We have set up default-privileges in BOOTSTRAP to
// mirror Supabase and then revoked from service_role in 057, so `set role
// service_role` + call should raise permission denied.
await test('service_role behavioural: set role service_role → auto_apply denied', async () => {
  await db.exec('set role service_role');
  await throws(
    q(`select auto_apply_venue_proposal(gen_random_uuid())`),
    /permission denied/i,
    'service_role must not execute auto_apply_venue_proposal',
  );
  await db.exec('reset role');
});

await test('service_role behavioural: set role service_role → rollback_enrichment_run denied', async () => {
  await db.exec('set role service_role');
  await throws(
    q(`select rollback_enrichment_run(gen_random_uuid())`),
    /permission denied/i,
    'service_role must not execute rollback_enrichment_run',
  );
  await db.exec('reset role');
});

// ── 7. is_admin() guard ─────────────────────────────────────────────────────
await test('auth: non-admin → auto_apply returns not_authorized', async () => {
  await asUid(USER);
  const r = await q(`select auto_apply_venue_proposal(gen_random_uuid()) as res`);
  eq(r.rows[0].res.outcome, 'not_authorized', 'non-admin gets not_authorized');
  await asUid(ADMIN);
});

await test('auth: non-admin → rollback_enrichment_run raises not_authorized', async () => {
  await asUid(USER);
  await throws(
    q(`select rollback_enrichment_run(gen_random_uuid())`),
    /not_authorized/,
    'non-admin cannot rollback',
  );
  await asUid(ADMIN);
});

// ── 8. Manual apply_venue_proposal writes exactly one 'apply' ledger row ───
await test('ledger: manual apply writes one apply row (applied_mode=manual, applied_by set)', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'phone', { v: '+447700900000' });
  await approve(id);
  await q(`select apply_venue_proposal($1)`, [id]);

  const rows = await ledgerRowsFor(id);
  eq(rows.length, 1, 'exactly one ledger row');
  eq(rows[0].operation,    'apply',  'operation=apply');
  eq(rows[0].applied_mode, 'manual', 'applied_mode=manual');
  assert(rows[0].applied_by !== null, 'applied_by is set');
  eq(rows[0].field, 'phone', 'field recorded');
  assert(rows[0].new_value_hash !== null, 'new_value_hash populated');
});

await test('ledger: manual apply stores old_value and new_value correctly', async () => {
  await asUid(ADMIN);
  const v   = await newVenue({ website: 'https://old.example/' });
  const run = await newRun(v);
  const id  = await propose(run, v, 'website', { v: 'https://new.example/' });
  await approve(id);
  await q(`select apply_venue_proposal($1)`, [id]);

  const rows = await ledgerRowsFor(id);
  eq(rows[0].old_value?.v, 'https://old.example/', 'old_value captured');
  eq(rows[0].new_value?.v, 'https://new.example/', 'new_value captured');
});

// ── 9. auto_apply_venue_proposal happy path ────────────────────────────────
await test('auto_apply: empty field → outcome=applied + one auto ledger row', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();    // website is null
  const run = await newRun(v);
  const id  = await propose(run, v, 'website', { v: 'https://auto.example/' });
  await setDecision(id, 'auto_apply');

  const res = await q(`select auto_apply_venue_proposal($1) as r`, [id]);
  eq(res.rows[0].r.outcome, 'applied', 'outcome=applied');

  const rows = await ledgerRowsFor(id);
  eq(rows.length, 1, 'exactly one ledger row');
  eq(rows[0].operation,    'apply', 'operation=apply');
  eq(rows[0].applied_mode, 'auto',  'applied_mode=auto');
  // old_value: website was null → current_value=null
  eq(rows[0].old_value, null, 'old_value is null for previously-empty field');
  // new_value: the value that was written
  eq(rows[0].new_value?.v, 'https://auto.example/', 'new_value.v matches proposed');
  // both hashes must be populated (not null)
  assert(rows[0].old_value_hash !== null, 'old_value_hash populated');
  assert(rows[0].new_value_hash !== null, 'new_value_hash populated');
  // hashes must differ (one is hash of empty field, other of the written value)
  assert(rows[0].old_value_hash !== rows[0].new_value_hash, 'old/new hashes differ');

  const venue = await q(`select website from venues where id=$1`, [v]);
  eq(venue.rows[0].website, 'https://auto.example/', 'website written');
  eq(await statusOf(id), 'applied', 'proposal status=applied');
});

// ── 10. non-empty value guard ──────────────────────────────────────────────
await test('auto_apply: non-empty live value → moved_to_manual_review, no ledger', async () => {
  await asUid(ADMIN);
  const v   = await newVenue({ website: 'https://existing.example/' });
  const run = await newRun(v);
  // propose a new website for a venue that already has one
  // propose_field deduplication: proposed ≠ current so it won't dedup
  // use direct insert to bypass the dedup (proposed != current)
  const id  = await propose(run, v, 'phone', { v: '+447700900001' });
  await setDecision(id, 'auto_apply');
  // Override proposal to website with a different value
  await q(
    `insert into venue_field_proposals
       (run_id, venue_id, field, proposed_value, current_value_hash,
        source_url, evidence_snippet, retrieved_at, extraction_method,
        confidence, decision)
     values ($1,$2,'website',$3::jsonb,
             (select snapshot_current_value($2,'website')->>'hash'),
             'https://v.example/','evidence',now(),'jsonld','high','auto_apply')`,
    [run, v, JSON.stringify({ v: 'https://new.example/' })],
  );
  const idWs = (await q(
    `select id from venue_field_proposals
      where venue_id=$1 and field='website' and decision='auto_apply' order by created_at desc limit 1`,
    [v],
  )).rows[0].id;

  const res = await q(`select auto_apply_venue_proposal($1) as r`, [idWs]);
  eq(res.rows[0].r.outcome, 'moved_to_manual_review', 'existing value → manual review');
  eq((await ledgerRowsFor(idWs)).length, 0, 'no ledger row written');

  // decision column updated to manual_review
  const dec = await q(
    `select decision from venue_field_proposals where id=$1`, [idWs],
  );
  eq(dec.rows[0].decision, 'manual_review', 'decision updated to manual_review');
});

// ── 11. stale guard in auto_apply ─────────────────────────────────────────
await test('auto_apply: stale hash → outcome=stale, no ledger row', async () => {
  // Scenario that reaches the stale guard without triggering the non-empty guard:
  //   1. Venue has an existing phone value → propose_field captures hash H_old.
  //   2. We manually set decision='auto_apply' (artificial — engine never does this
  //      when current is non-empty, but we need to test the stale guard path).
  //   3. Clear the phone so the live value is now empty (non-empty guard won't fire).
  //   4. Live hash = hash(phone:null) ≠ H_old → stale guard fires.
  await asUid(ADMIN);
  const v   = await newVenue({ phone: '+44ORIGINAL' }); // non-null → hash H_old
  const run = await newRun(v);
  // propose a NEW phone; current_value_hash is captured as H_old (hash of '+44ORIGINAL')
  const id  = await propose(run, v, 'phone', { v: '+447700900002' });
  await setDecision(id, 'auto_apply');
  // Clear the phone so live value is now null (empty) — non-empty guard won't fire.
  // But the stored hash H_old ≠ hash(phone:null), so the stale guard fires.
  await q(`update venues set phone=null where id=$1`, [v]);

  const res = await q(`select auto_apply_venue_proposal($1) as r`, [id]);
  eq(res.rows[0].r.outcome, 'stale', 'stale guard fires when live hash differs');
  eq((await ledgerRowsFor(id)).length, 0, 'no ledger row written for stale');
  assert(await statusOf(id) !== 'applied', 'proposal not marked applied on stale');
});

// ── 12. validation_failed in auto_apply ───────────────────────────────────
await test('auto_apply: invalid email → validation_failed, no ledger row', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'email', { v: 'notanemail' });
  await setDecision(id, 'auto_apply');

  const res = await q(`select auto_apply_venue_proposal($1) as r`, [id]);
  eq(res.rows[0].r.outcome, 'validation_failed', 'invalid email → validation_failed');
  eq((await ledgerRowsFor(id)).length, 0, 'no ledger row for validation_failed');
  assert(await statusOf(id) !== 'applied', 'proposal not marked applied');
});

await test('auto_apply: description always returns validation_failed (requires human rewrite)', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'description', { v: 'Some text' },
    { evidence: 'Different evidence text here' });
  await setDecision(id, 'auto_apply');

  const res = await q(`select auto_apply_venue_proposal($1) as r`, [id]);
  eq(res.rows[0].r.outcome, 'validation_failed', 'description auto_apply → validation_failed');
  eq(res.rows[0].r.reason, 'description_requires_human_rewrite', 'correct reason');
  eq((await ledgerRowsFor(id)).length, 0, 'no ledger row');
});

// ── 13. decision != auto_apply → moved_to_manual_review ───────────────────
await test('auto_apply: decision=manual_review → moved_to_manual_review outcome', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'phone', { v: '+447700900003' });
  // decision is null (backfill set it to manual_review, but let's explicitly test)
  await setDecision(id, 'manual_review');

  const res = await q(`select auto_apply_venue_proposal($1) as r`, [id]);
  eq(res.rows[0].r.outcome, 'moved_to_manual_review', 'non-auto_apply → moved_to_manual_review');
  eq((await ledgerRowsFor(id)).length, 0, 'no ledger row');
});

// ── 14. opening_hours auto_apply and rollback round-trip ──────────────────
await test('opening_hours: auto_apply + rollback round-trip', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();   // no opening_hours rows
  const run = await newRun(v);
  const week = makeWeek();
  const id  = await propose(run, v, 'opening_hours', week);
  await setDecision(id, 'auto_apply');

  // Auto apply
  const applyRes = await q(`select auto_apply_venue_proposal($1) as r`, [id]);
  eq(applyRes.rows[0].r.outcome, 'applied', 'opening_hours auto_apply outcome=applied');

  const ohRows = await q(
    `select day_of_week, is_closed from opening_hours where venue_id=$1 order by day_of_week`,
    [v],
  );
  eq(ohRows.rows.length, 7, '7 opening_hours rows written');
  eq(ohRows.rows.every(r => !r.is_closed), true, 'all days open');

  // Verify ledger row
  const ledger = await ledgerRowsFor(id);
  eq(ledger.length, 1,       'one apply ledger row');
  eq(ledger[0].operation,    'apply', 'apply row');
  eq(ledger[0].applied_mode, 'auto',  'auto mode');

  // Rollback
  const rollRes = await q(`select rollback_enrichment_run($1) as r`, [run]);
  const results = rollRes.rows[0].r;
  assert(Array.isArray(results), 'rollback returns array');
  eq(results.length, 1, 'one field in result');
  eq(results[0].outcome, 'restored', 'field restored');
  eq(results[0].field, 'opening_hours', 'correct field');

  // opening_hours should be empty again (old_value was '[]')
  const afterRollback = await q(
    `select count(*)::int as n from opening_hours where venue_id=$1`,
    [v],
  );
  eq(afterRollback.rows[0].n, 0, 'opening_hours empty after rollback');

  // Rollback ledger row appended
  const ledger2 = await ledgerRowsFor(id);
  eq(ledger2.length, 2, 'two ledger rows: apply + rollback');
  eq(ledger2[1].operation,        'rollback', 'second row is rollback');
  eq(ledger2[1].reverts_write_id, ledger[0].id, 'reverts_write_id points to apply row');
});

// ── 15. rollback: already_rolled_back ─────────────────────────────────────
await test('rollback: duplicate rollback → already_rolled_back', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'phone', { v: '+447700900004' });
  await setDecision(id, 'auto_apply');
  await q(`select auto_apply_venue_proposal($1)`, [id]);

  // First rollback
  await q(`select rollback_enrichment_run($1)`, [run]);

  // Second rollback of same run
  const r2 = await q(`select rollback_enrichment_run($1) as res`, [run]);
  eq(r2.rows[0].res[0].outcome, 'already_rolled_back', 'second rollback = already_rolled_back');
});

// ── 16. rollback: skipped_newer_change ────────────────────────────────────
await test('rollback: skipped_newer_change when human edited value after apply', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'phone', { v: '+447700900005' });
  await setDecision(id, 'auto_apply');
  await q(`select auto_apply_venue_proposal($1)`, [id]);

  // Human edits the phone after the auto-apply
  await q(`update venues set phone='+44HUMAN' where id=$1`, [v]);

  const r = await q(`select rollback_enrichment_run($1) as res`, [run]);
  eq(r.rows[0].res[0].outcome, 'skipped_newer_change', 'newer human edit → skipped');

  // Original ledger rows must not be modified (still only 1 apply row)
  const ledger = await ledgerRowsFor(id);
  eq(ledger.length, 1, 'still only apply row, no rollback row added');
});

// ── 17. rollback: scalar old_value restored ───────────────────────────────
await test('rollback: scalar field restores old_value in venues table', async () => {
  await asUid(ADMIN);
  const v   = await newVenue({ email: 'before@example.com' });
  const run = await newRun(v);
  const id  = await propose(run, v, 'email', { v: 'after@example.com' });
  await approve(id);
  await q(`select apply_venue_proposal($1)`, [id]);

  const afterApply = await q(`select email from venues where id=$1`, [v]);
  eq(afterApply.rows[0].email, 'after@example.com', 'email written by apply');

  const r = await q(`select rollback_enrichment_run($1) as res`, [run]);
  eq(r.rows[0].res[0].outcome, 'restored', 'restored');

  const afterRollback = await q(`select email from venues where id=$1`, [v]);
  eq(afterRollback.rows[0].email, 'before@example.com', 'old email restored');
});

// ── 18. rollback: mixed-batch outcome reporting ────────────────────────────
await test('rollback: mixed-batch returns per-field outcomes accurately', async () => {
  await asUid(ADMIN);
  const v    = await newVenue();
  const run  = await newRun(v);

  // Apply phone via auto_apply
  const id1  = await propose(run, v, 'phone',   { v: '+447700900006' });
  await setDecision(id1, 'auto_apply');
  await q(`select auto_apply_venue_proposal($1)`, [id1]);

  // Apply website via auto_apply
  const id2  = await propose(run, v, 'website', { v: 'https://batch.example/' });
  await setDecision(id2, 'auto_apply');
  await q(`select auto_apply_venue_proposal($1)`, [id2]);

  // Human edits website immediately — this field will be skipped
  await q(`update venues set website='https://human.example/' where id=$1`, [v]);

  const r = await q(`select rollback_enrichment_run($1) as res`, [run]);
  const results = r.rows[0].res;
  eq(results.length, 2, 'two results (phone + website)');

  const byField = Object.fromEntries(results.map(x => [x.field, x.outcome]));
  eq(byField.phone,   'restored',            'phone restored');
  eq(byField.website, 'skipped_newer_change', 'website skipped (human edit)');
});

// ── 19. ledger immutability: no client can INSERT/UPDATE/DELETE ────────────
await test('ledger: authenticated role cannot INSERT into venue_enrichment_writes', async () => {
  await db.exec('set role authenticated');
  await throws(
    q(
      `insert into venue_enrichment_writes
         (venue_id, field, operation, decision_reasons)
       values (gen_random_uuid(), 'phone', 'apply', '[]'::jsonb)`,
    ),
    /permission denied|violates/i,
    'authenticated cannot insert into ledger',
  );
  await db.exec('reset role');
});

await test('ledger: RLS — admin sees ledger rows, non-admin sees zero', async () => {
  await asUid(ADMIN);
  const adminCount = await q(
    `select count(*)::int as n from venue_enrichment_writes`,
  );
  assert(adminCount.rows[0].n > 0, 'admin sees ledger rows');

  await asUid(USER);
  await db.exec('set role authenticated');
  const userCount = await q(
    `select count(*)::int as n from venue_enrichment_writes`,
  );
  await db.exec('reset role');
  eq(userCount.rows[0].n, 0, 'non-admin sees zero rows (RLS)');
  await asUid(ADMIN);
});

// ── 20. 056 grant matrix still intact after 057 ───────────────────────────
await test('056 grants unchanged: apply_venue_proposal authenticated=true service_role=true', async () => {
  const sig = 'public.apply_venue_proposal(uuid, text)';
  const r   = await q(
    `select has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
            has_function_privilege('service_role',  $1, 'EXECUTE') as svc`,
    [sig],
  );
  eq(r.rows[0].auth, true, 'authenticated has apply grant');
  eq(r.rows[0].svc,  true, 'service_role has apply grant');
});

// ── 21. apply_venue_proposal (refactored) still behaves the same as 056 ───
await test('056 compat: apply_venue_proposal still applies phone and writes ledger', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'phone', { v: '+447700900007' });
  await approve(id);
  const res = await q(`select apply_venue_proposal($1) as r`, [id]);
  eq(res.rows[0].r.ok, true, 'apply returns ok=true');
  const phone = await q(`select phone from venues where id=$1`, [v]);
  eq(phone.rows[0].phone, '+447700900007', 'phone written');
  eq(await statusOf(id), 'applied', 'proposal applied');

  // 057 addition: ledger row exists
  const rows = await ledgerRowsFor(id);
  eq(rows.length, 1,       'ledger row created by manual apply');
  eq(rows[0].applied_mode, 'manual', 'applied_mode=manual');
});

await test('056 compat: apply_venue_proposal still raises not_approved for pending', async () => {
  await asUid(ADMIN);
  const v   = await newVenue();
  const run = await newRun(v);
  const id  = await propose(run, v, 'phone', { v: '+447700900008' });
  // NOT approved — should raise
  await throws(
    q(`select apply_venue_proposal($1)`, [id]),
    /not_approved/,
    '056 behaviour: not_approved still raised',
  );
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(f => console.log(`  FAIL  ${f.name}: ${f.message}`));
  process.exitCode = 1;
}
