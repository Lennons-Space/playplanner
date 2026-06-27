// =============================================================================
// supabase/tests/056_venue_website_enrichment.mjs
//
// Behavioural database tests for migration 056 (website enrichment) using an
// in-process Postgres (pglite) — NO live Supabase, NO production access. Loads a
// minimal bootstrap (the prerequisite objects 056 depends on) + the REAL
// migration file, then exercises the RPCs and RLS.
//
// Run:  node supabase/tests/056_venue_website_enrichment.mjs   (npm run test:db)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(__dirname, '../migrations/056_venue_website_enrichment.sql'), 'utf8');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

// Minimal prerequisite schema that 056 depends on (mirrors the real objects).
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  -- Reproduce Supabase's hosted default privileges: on real Supabase, schema
  -- public is configured so EVERY newly-created function auto-grants EXECUTE to
  -- anon, authenticated AND service_role (see pg_default_acl). Without this line
  -- pglite would behave unlike production, and the grant tests below would give a
  -- false green (a revoke ... from public removes PUBLIC but not these named
  -- roles). Mirroring it here makes the privilege tests exercise the real case.
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
    description text,
    price_range text check (price_range in ('free','budget','moderate','premium')),
    website text, phone text, email text,
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

// helpers
async function newVenue(overrides = {}) {
  const r = await q(
    `insert into venues (description, price_range, website, phone, email)
     values ($1,$2,$3,$4,$5) returning id`,
    [overrides.description ?? null, overrides.price_range ?? null, overrides.website ?? null, overrides.phone ?? null, overrides.email ?? null],
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
    [runId, venueId, field, JSON.stringify(proposed), 'https://v.example/', extra.evidence ?? 'evidence', extra.evidenceRaw ?? null, extra.method ?? 'jsonld', extra.confidence ?? 'high', extra.conflicts ?? false, extra.retrievedAt ?? '2026-06-22T10:00:00.000Z'],
  );
  return r.rows[0].id;
}
async function approve(id) {
  await q(`update venue_field_proposals set status='approved' where id=$1`, [id]);
}
async function statusOf(id) {
  const r = await q(`select status from venue_field_proposals where id=$1`, [id]);
  return r.rows[0]?.status ?? null;
}

async function main() {
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);

  console.log('\nMigration 056 — database tests (pglite, no live Supabase)\n');

  // ── Happy paths ────────────────────────────────────────────────────────────
  await test('happy: apply a scalar (phone) writes venues + flips status', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441727822106' });
    assert(id, 'propose returned an id');
    await approve(id);
    const res = await q(`select apply_venue_proposal($1) as r`, [id]);
    eq(res.rows[0].r.ok, true, 'apply ok');
    const venue = await q(`select phone from venues where id=$1`, [v]);
    eq(venue.rows[0].phone, '+441727822106', 'phone written');
    eq(await statusOf(id), 'applied', 'status applied');
  });

  await test('happy: price_range valid bucket applies', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'price_range', { v: 'moderate' });
    await approve(id);
    await q(`select apply_venue_proposal($1)`, [id]);
    const r = await q(`select price_range from venues where id=$1`, [v]);
    eq(r.rows[0].price_range, 'moderate', 'price applied');
  });

  await test('happy: opening_hours replace-whole-week (split + closed day)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    await q(`insert into opening_hours (venue_id, day_of_week, opens_at, closes_at) values ($1, 6, '08:00','12:00')`, [v]); // stale Sat row
    const run = await newRun(v);
    const week = {
      seasonal_notes: 'term-time only',
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => {
        if (d === 0) return { day_of_week: 0, is_closed: true, intervals: [] };
        if (d === 1) return { day_of_week: 1, is_closed: false, intervals: [{ opens: '09:00', closes: '12:00' }, { opens: '14:00', closes: '17:00' }] };
        return { day_of_week: d, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] };
      }),
    };
    const id = await propose(run, v, 'opening_hours', week);
    await approve(id);
    await q(`select apply_venue_proposal($1)`, [id]);
    const rows = await q(`select day_of_week, is_closed, opens_at, closes_at, notes from opening_hours where venue_id=$1 order by day_of_week`, [v]);
    eq(rows.rows.length, 7, 'exactly 7 rows after replace');
    eq(rows.rows[0].is_closed, true, 'Sunday closed');
    eq(String(rows.rows[1].opens_at), '09:00:00', 'Mon envelope open');
    eq(String(rows.rows[1].closes_at), '17:00:00', 'Mon envelope close');
    assert(/Open 09:00-12:00 and 14:00-17:00/.test(rows.rows[1].notes), 'split recorded in notes');
    assert(/term-time only/.test(rows.rows[1].notes), 'seasonal recorded in notes');
    // the stale Saturday 08:00-12:00 row is gone (replaced with 09:00-17:00)
    eq(String(rows.rows[6].opens_at), '09:00:00', 'stale Sat row replaced');
  });

  await test('happy: description applies with an admin rewrite', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'description', { v: 'A working farm...' }, { evidence: 'A working farm with handcrafted play.' });
    await approve(id);
    await q(`select apply_venue_proposal($1,$2)`, [id, 'Family farm with indoor and outdoor play areas.']);
    const r = await q(`select description from venues where id=$1`, [v]);
    eq(r.rows[0].description, 'Family farm with indoor and outdoor play areas.', 'rewrite applied');
  });

  // ── Auth / RLS ─────────────────────────────────────────────────────────────
  await test('auth: non-admin apply raises not_admin', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441' });
    await approve(id);
    await asUid(USER);
    await throws(q(`select apply_venue_proposal($1)`, [id]), /not_admin/, 'should reject non-admin');
    await asUid(ADMIN);
  });

  await test('rls: non-admin authenticated sees no proposals; admin does', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    await propose(run, v, 'phone', { v: '+449' });
    // mirror Supabase default table grants to the api role
    await db.exec(`grant select, insert on venue_field_proposals to authenticated`);

    await asUid(USER);
    await db.exec('set role authenticated');
    const denied = await q(`select count(*)::int as n from venue_field_proposals`);
    await db.exec('reset role');
    eq(denied.rows[0].n, 0, 'non-admin sees zero rows (RLS)');

    await asUid(ADMIN);
    await db.exec('set role authenticated');
    const seen = await q(`select count(*)::int as n from venue_field_proposals`);
    await db.exec('reset role');
    assert(seen.rows[0].n > 0, 'admin sees rows');
  });

  await test('auth: propose_field execute is not granted to anon', async () => {
    await db.exec('set role anon');
    await throws(
      q(`select propose_field(gen_random_uuid(),gen_random_uuid(),'phone','{}'::jsonb,'u','e',null,'jsonld','high',false)`),
      /permission denied/i,
      'anon must not execute propose_field',
    );
    await db.exec('reset role');
  });

  // ── Supersede / duplicate pending ──────────────────────────────────────────
  await test('dup: second propose supersedes the first (one live pending)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id1 = await propose(run, v, 'phone', { v: '+441' });
    const id2 = await propose(run, v, 'phone', { v: '+442' });
    eq(await statusOf(id1), 'superseded', 'first superseded');
    eq(await statusOf(id2), 'pending', 'second pending');
    const n = await q(`select count(*)::int as n from venue_field_proposals where venue_id=$1 and field='phone' and status='pending'`, [v]);
    eq(n.rows[0].n, 1, 'exactly one pending');
  });

  await test('dup: partial-unique index blocks two manual pending rows', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const ins = (val) => q(
      `insert into venue_field_proposals (run_id, venue_id, field, proposed_value, current_value_hash, source_url, evidence_snippet, retrieved_at, extraction_method, confidence)
       values ($1,$2,'email',$3::jsonb,'h','u','e',now(),'jsonld','high')`,
      [run, v, JSON.stringify({ v: val })],
    );
    await ins('a@x.com');
    await throws(ins('b@x.com'), /unique|duplicate/i, 'second pending blocked');
  });

  await test('dedup: proposing the current value inserts nothing (returns null)', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ website: 'https://farm.example/' });
    const run = await newRun(v);
    const id = await propose(run, v, 'website', { v: 'https://farm.example/' });
    eq(id, null, 'dedup returns null');
    const n = await q(`select count(*)::int as n from venue_field_proposals where venue_id=$1`, [v]);
    eq(n.rows[0].n, 0, 'no row inserted');
  });

  // ── Stale apply ────────────────────────────────────────────────────────────
  await test('stale: value changed after propose → apply raises stale_current_value', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'phone', { v: '+441' });
    await approve(id);
    await q(`update venues set phone='+449999' where id=$1`, [v]); // edited after snapshot
    await throws(q(`select apply_venue_proposal($1)`, [id]), /stale_current_value/, 'stale guard');
  });

  // ── Invalid field / price / week / description ─────────────────────────────
  await test('invalid: field outside the allowlist is rejected (CHECK + propose guard)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    // The table CHECK constraint rejects a bad field on direct insert…
    await throws(
      q(
        `insert into venue_field_proposals (run_id, venue_id, field, proposed_value, current_value_hash, source_url, evidence_snippet, retrieved_at, extraction_method, confidence)
         values ($1,$2,'nonsense','{}'::jsonb,'h','u','e',now(),'jsonld','high')`,
        [run, v],
      ),
      /violates check constraint/i,
      'CHECK rejects bad field',
    );
    // …and propose_field rejects it too (defence in depth, via snapshot_current_value).
    await throws(propose(run, v, 'nonsense', { v: 'x' }), /invalid_field/, 'propose guard rejects bad field');
  });

  await test('invalid: bad price_range bucket raises invalid_enum_value on apply', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'price_range', { v: 'cheap' });
    await approve(id);
    await throws(q(`select apply_venue_proposal($1)`, [id]), /invalid_enum_value/, 'bad enum');
  });

  await test('invalid: opening_hours week with != 7 days raises incomplete_week', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const week = { seasonal_notes: null, source_text: 'x', days: Array.from({ length: 6 }, (_, d) => ({ day_of_week: d, is_closed: true, intervals: [] })) };
    const id = await propose(run, v, 'opening_hours', week);
    await approve(id);
    await throws(q(`select apply_venue_proposal($1)`, [id]), /incomplete_week/, '6-day week rejected');
  });

  await test('desc: applying text equal to the evidence raises description_not_rewritten', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'description', { v: 'x' }, { evidence: 'Verbatim marketing copy.' });
    await approve(id);
    await throws(q(`select apply_venue_proposal($1,$2)`, [id, 'Verbatim marketing copy.']), /description_not_rewritten/, 'no verbatim');
    await throws(q(`select apply_venue_proposal($1,$2)`, [id, '   ']), /description_text_required/, 'rewrite required');
  });

  // ── Reject / apply idempotency ─────────────────────────────────────────────
  await test('idempotency: re-applying an applied proposal raises not_approved', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'email', { v: 'a@x.com' });
    await approve(id);
    await q(`select apply_venue_proposal($1)`, [id]);
    await throws(q(`select apply_venue_proposal($1)`, [id]), /not_approved/, 'no double apply');
  });

  await test('idempotency: re-rejecting a rejected proposal raises not_pending', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'email', { v: 'b@x.com' });
    await q(`select reject_venue_proposal($1,$2)`, [id, 'spam']);
    eq(await statusOf(id), 'rejected', 'rejected');
    await throws(q(`select reject_venue_proposal($1,$2)`, [id, 'again']), /not_pending/, 'no double reject');
  });

  await test('booking_url has no target column → apply raises no_target_column', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'booking_url', { v: 'https://tickets.example/' });
    await approve(id);
    await throws(q(`select apply_venue_proposal($1)`, [id]), /no_target_column/, 'booking deferred');
  });

  // ── Atomicity / rollback safety ────────────────────────────────────────────
  await test('atomicity: a mid-apply failure rolls back the whole week delete', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    await q(`insert into opening_hours (venue_id, day_of_week, opens_at, closes_at) values ($1,1,'09:00','17:00')`, [v]);
    const run = await newRun(v);
    const badWeek = { seasonal_notes: null, source_text: 'x', days: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, is_closed: false, intervals: [{ opens: d === 3 ? '99:99' : '09:00', closes: '17:00' }] })) };
    const id = await propose(run, v, 'opening_hours', badWeek);
    await approve(id);
    await throws(q(`select apply_venue_proposal($1)`, [id]), /.*/, 'bad time should raise');
    const rows = await q(`select count(*)::int as n from opening_hours where venue_id=$1`, [v]);
    eq(rows.rows[0].n, 1, 'original opening_hours row preserved (delete rolled back)');
  });

  await test('supersede then apply the winning proposal', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    await propose(run, v, 'phone', { v: '+441' });
    const id2 = await propose(run, v, 'phone', { v: '+442' });
    await approve(id2);
    await q(`select apply_venue_proposal($1)`, [id2]);
    const r = await q(`select phone from venues where id=$1`, [v]);
    eq(r.rows[0].phone, '+442', 'winner applied');
    eq(await statusOf(id2), 'applied', 'winner applied status');
  });

  await test('opening_hours: 24:00 closing time round-trips', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const week = { seasonal_notes: null, source_text: 'x', days: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, is_closed: false, intervals: [{ opens: '00:00', closes: '24:00' }] })) };
    const id = await propose(run, v, 'opening_hours', week);
    await approve(id);
    await q(`select apply_venue_proposal($1)`, [id]);
    const r = await q(`select closes_at from opening_hours where venue_id=$1 and day_of_week=1`, [v]);
    eq(String(r.rows[0].closes_at), '24:00:00', '24:00 stored as end-of-day');
  });

  await test('reject works on an approved proposal (approved → rejected)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const id = await propose(run, v, 'email', { v: 'c@x.com' });
    await approve(id);
    await q(`select reject_venue_proposal($1,$2)`, [id, 'changed mind']);
    eq(await statusOf(id), 'rejected', 'approved → rejected');
  });

  await test('constraint: a null current_value_hash is rejected', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    await throws(
      q(
        `insert into venue_field_proposals (run_id, venue_id, field, proposed_value, current_value_hash, source_url, evidence_snippet, retrieved_at, extraction_method, confidence)
         values ($1,$2,'phone','{}'::jsonb,null,'u','e',now(),'jsonld','high')`,
        [run, v],
      ),
      /not.?null/i,
      'null hash rejected',
    );
  });

  await test('snapshot_current_value is not executable by authenticated (PII guard)', async () => {
    await db.exec('set role authenticated');
    await throws(
      q(`select snapshot_current_value(gen_random_uuid(),'phone')`),
      /permission denied/i,
      'authenticated cannot snapshot',
    );
    await db.exec('reset role');
  });

  await test('auth: anon cannot execute apply_venue_proposal or reject_venue_proposal', async () => {
    await db.exec('set role anon');
    await throws(
      q(`select apply_venue_proposal(gen_random_uuid())`),
      /permission denied/i,
      'anon must not execute apply_venue_proposal',
    );
    await throws(
      q(`select reject_venue_proposal(gen_random_uuid(),'x')`),
      /permission denied/i,
      'anon must not execute reject_venue_proposal',
    );
    await db.exec('reset role');
  });

  await test('grants: EXECUTE privilege matrix matches the design (anon/authenticated/service_role)', async () => {
    const sigs = {
      snapshot_current_value: 'public.snapshot_current_value(uuid, text)',
      propose_field: 'public.propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz)',
      apply_venue_proposal: 'public.apply_venue_proposal(uuid, text)',
      reject_venue_proposal: 'public.reject_venue_proposal(uuid, text)',
    };
    // expected EXECUTE = [anon, authenticated, service_role]
    const expected = {
      snapshot_current_value: [false, false, true],
      propose_field: [false, false, true],
      apply_venue_proposal: [false, true, true],
      reject_venue_proposal: [false, true, true],
    };
    for (const [fn, sig] of Object.entries(sigs)) {
      const r = await q(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [sig],
      );
      const got = [r.rows[0].anon, r.rows[0].auth, r.rows[0].svc];
      eq(got.join(','), expected[fn].join(','), `privilege matrix for ${fn}`);
    }
  });

  await test('hash is field-specific for null values', async () => {
    await asUid(ADMIN);
    const v = await newVenue(); // no phone, no website
    const ph = await q(`select snapshot_current_value($1,'phone')->>'hash' as h`, [v]);
    const wb = await q(`select snapshot_current_value($1,'website')->>'hash' as h`, [v]);
    assert(ph.rows[0].h !== wb.rows[0].h, 'null phone and null website hash differently');
  });

  await test('stale guard passes when the value is unchanged (success path)', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ phone: '+440000' });
    const run = await newRun(v);
    const id = await propose(run, v, 'website', { v: 'https://new.example/' });
    await approve(id);
    const res = await q(`select apply_venue_proposal($1) as r`, [id]); // phone untouched, website was null
    eq(res.rows[0].r.ok, true, 'applies cleanly when unchanged');
  });

  // ── M1 defence-in-depth: invalid email rejected by apply_venue_proposal ──────
  await test('invalid: malformed email proposal raises invalid_email, venue.email unchanged (M1)', async () => {
    await asUid(ADMIN);
    const v = await newVenue({ email: 'existing@example.com' });
    const run = await newRun(v);
    // Propose a value that is not a valid email address
    const id = await propose(run, v, 'email', { v: 'notanemail' });
    await approve(id);
    await throws(
      q(`select apply_venue_proposal($1)`, [id]),
      /invalid_email/,
      'apply must raise invalid_email for a non-email value',
    );
    // The pre-existing email must be untouched
    const r = await q(`select email from venues where id=$1`, [v]);
    eq(r.rows[0].email, 'existing@example.com', 'venue.email unchanged after invalid_email rejection');
  });

  // ── M3: duplicate day_of_week guard ──────────────────────────────────────────
  await test('invalid: opening_hours with duplicate day_of_week raises duplicate_day_of_week (M3)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    // 7 elements total but Monday (day_of_week=1) appears twice
    const dupWeek = {
      seasonal_notes: null,
      source_text: 'x',
      days: [
        { day_of_week: 0, is_closed: true,  intervals: [] },
        { day_of_week: 1, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 1, is_closed: false, intervals: [{ opens: '10:00', closes: '18:00' }] }, // duplicate Mon
        { day_of_week: 2, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 3, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 4, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 5, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
      ],
    };
    const id = await propose(run, v, 'opening_hours', dupWeek);
    await approve(id);
    await throws(
      q(`select apply_venue_proposal($1)`, [id]),
      /duplicate_day_of_week/,
      'duplicate day_of_week must raise duplicate_day_of_week',
    );
  });

  await test('atomicity: duplicate-day failure leaves pre-existing opening_hours rows unchanged (M3)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    // Pre-seed one row
    await q(
      `insert into opening_hours (venue_id, day_of_week, opens_at, closes_at) values ($1, 2, '09:00', '17:00')`,
      [v],
    );
    const run = await newRun(v);
    const dupWeek = {
      seasonal_notes: null,
      source_text: 'x',
      days: [
        { day_of_week: 0, is_closed: true,  intervals: [] },
        { day_of_week: 1, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 1, is_closed: false, intervals: [{ opens: '10:00', closes: '18:00' }] }, // duplicate Mon
        { day_of_week: 2, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 3, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 4, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
        { day_of_week: 5, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
      ],
    };
    const id = await propose(run, v, 'opening_hours', dupWeek);
    await approve(id);
    await throws(
      q(`select apply_venue_proposal($1)`, [id]),
      /duplicate_day_of_week/,
      'should raise',
    );
    // The guard fires BEFORE the DELETE so the pre-existing row must be intact
    const rows = await q(`select count(*)::int as n from opening_hours where venue_id=$1`, [v]);
    eq(rows.rows[0].n, 1, 'pre-existing opening_hours row untouched after duplicate-day rejection');
  });

  // ── Behavioural set-role propose_field permission check (not just has_function_privilege) ─
  await test('auth: set role authenticated then call propose_field → permission denied (M1 behavioural)', async () => {
    await db.exec('set role authenticated');
    await throws(
      q(
        `select propose_field(gen_random_uuid(),gen_random_uuid(),'phone','{}'::jsonb,'u','e',null,'jsonld','high',false)`,
      ),
      /permission denied/i,
      'authenticated role must not be able to execute propose_field',
    );
    await db.exec('reset role');
  });

  // ── CHECK constraint sizes ────────────────────────────────────────────────────
  await test('constraints: evidence_snippet > 512 chars rejected by DB CHECK', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const longSnippet = 'x'.repeat(513);
    await throws(
      q(
        `insert into venue_field_proposals
           (run_id, venue_id, field, proposed_value, current_value_hash,
            source_url, evidence_snippet, retrieved_at, extraction_method, confidence)
         values ($1,$2,'phone','{}'::jsonb,'h','u',$3,now(),'jsonld','high')`,
        [run, v, longSnippet],
      ),
      /check/i,
      'evidence_snippet longer than 512 chars must be rejected by CHECK constraint',
    );
  });

  await test('constraints: evidence_raw > 2048 chars rejected by DB CHECK', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const longRaw = 'y'.repeat(2049);
    await throws(
      q(
        `insert into venue_field_proposals
           (run_id, venue_id, field, proposed_value, current_value_hash,
            source_url, evidence_snippet, evidence_raw, retrieved_at, extraction_method, confidence)
         values ($1,$2,'phone','{}'::jsonb,'h','u','ok',$3,now(),'jsonld','high')`,
        [run, v, longRaw],
      ),
      /check/i,
      'evidence_raw longer than 2048 chars must be rejected by CHECK constraint',
    );
  });

  // ── Exact boundary: 512 / 2048 chars must be ACCEPTED ───────────────────────
  await test('constraints: evidence_snippet of exactly 512 chars is ACCEPTED (boundary)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const exactSnippet = 'x'.repeat(512);
    const r = await q(
      `insert into venue_field_proposals
         (run_id, venue_id, field, proposed_value, current_value_hash,
          source_url, evidence_snippet, retrieved_at, extraction_method, confidence)
       values ($1,$2,'phone','{}'::jsonb,'h','u',$3,now(),'jsonld','high')
       returning id`,
      [run, v, exactSnippet],
    );
    assert(r.rows[0]?.id, 'insert with exactly 512-char evidence_snippet must succeed');
  });

  await test('constraints: evidence_raw of exactly 2048 chars is ACCEPTED (boundary)', async () => {
    await asUid(ADMIN);
    const v = await newVenue();
    const run = await newRun(v);
    const exactRaw = 'y'.repeat(2048);
    const r = await q(
      `insert into venue_field_proposals
         (run_id, venue_id, field, proposed_value, current_value_hash,
          source_url, evidence_snippet, evidence_raw, retrieved_at, extraction_method, confidence)
       values ($1,$2,'phone','{}'::jsonb,'h','u','ok',$3,now(),'jsonld','high')
       returning id`,
      [run, v, exactRaw],
    );
    assert(r.rows[0]?.id, 'insert with exactly 2048-char evidence_raw must succeed');
  });

  await test('rollback: down-migration drops 056 objects, leaves base schema intact', async () => {
    await db.exec(`
      drop function if exists apply_venue_proposal(uuid, text);
      drop function if exists reject_venue_proposal(uuid, text);
      drop function if exists propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz);
      drop function if exists snapshot_current_value(uuid, text);
      drop table if exists venue_field_proposals;
      drop table if exists venue_enrichment_runs;
    `);
    eq((await q(`select to_regclass('public.venue_field_proposals') as t`)).rows[0].t, null, 'proposals table dropped');
    eq((await q(`select to_regclass('public.venue_enrichment_runs') as t`)).rows[0].t, null, 'runs table dropped');
    assert((await q(`select to_regclass('public.venues') as t`)).rows[0].t !== null, 'venues table intact');
    assert((await q(`select to_regclass('public.opening_hours') as t`)).rows[0].t !== null, 'opening_hours intact');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
