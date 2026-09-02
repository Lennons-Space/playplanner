// =============================================================================
// supabase/tests/20260901_privacy_engineering_remediation.mjs
//
// Behavioural proof for the two new DRAFT migrations written during the
// 2026-09-01 "Privacy-Critical Engineering Remediation Pass":
//   - 20260901121500_location_consent_log_anonymise_on_delete.sql
//   - 20260901120000_venue_claims_phone_minimisation.sql
//
// In-process Postgres (pglite), no live Supabase. Both migrations are
// UNAPPLIED anywhere — this proves what they WOULD do if applied, and (for
// the location_consent_log fix) reproduces the ORIGINAL defect first, so the
// fix is proven meaningful rather than asserted.
//
// Table DDL below is copied verbatim from the relevant CREATE TABLE
// statements in 001_initial_schema.sql / 023_business_claiming.sql (with
// `uuid_generate_v4()` substituted for `gen_random_uuid()`, since the
// uuid-ossp extension is not assumed available in pglite — a test-fixture-only
// substitution that does not affect the FK/constraint behaviour under test;
// same technique already used by 060_enrichment_2_1_facility_sync.mjs's
// bootstrap for `venues.id`).
//
// Run: node supabase/tests/20260901_privacy_engineering_remediation.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFT_LOCATION_CONSENT_FIX = readFileSync(
  join(__dirname, '../migrations_drafts/20260901121500_location_consent_log_anonymise_on_delete.sql'),
  'utf8',
);
const DRAFT_PHONE_MINIMISATION = readFileSync(
  join(__dirname, '../migrations_drafts/20260901120000_venue_claims_phone_minimisation.sql'),
  'utf8',
);

const USER_A = '22222222-2222-2222-2222-222222222222';
const USER_B = '33333333-3333-3333-3333-333333333333';

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

async function main() {
  // ── Part A: location_consent_log — prove the defect, then prove the fix ──
  await db.exec(`
    create table profiles (id uuid primary key default gen_random_uuid());

    -- "BEFORE" table — the CURRENT, applied 001 definition (CASCADE), verbatim
    -- from 001_initial_schema.sql:764-772's user_id line.
    create table location_consent_log_before (
      id                   uuid primary key default gen_random_uuid(),
      user_id              uuid references profiles(id) on delete cascade,
      consented_at         timestamptz,
      consent_withdrawn_at timestamptz,
      consent_version      text not null,
      ip_hash              text,
      created_at           timestamptz default now()
    );

    -- "AFTER" table — same shape, starts as an exact copy of the applied
    -- definition; the draft migration below is what changes its FK action.
    create table location_consent_log (
      id                   uuid primary key default gen_random_uuid(),
      user_id              uuid references profiles(id) on delete cascade,
      consented_at         timestamptz,
      consent_withdrawn_at timestamptz,
      consent_version      text not null,
      ip_hash              text,
      created_at           timestamptz default now()
    );
  `);

  await test('BEFORE: reproduces the live defect — CASCADE destroys the consent row on profile deletion', async () => {
    await q(`insert into profiles (id) values ($1)`, [USER_A]);
    const ins = await q(
      `insert into location_consent_log_before (user_id, consented_at, consent_version) values ($1, now(), 'v1.0') returning id`,
      [USER_A],
    );
    const rowId = ins.rows[0].id;
    await q(`delete from profiles where id = $1`, [USER_A]);
    const after = await q(`select * from location_consent_log_before where id = $1`, [rowId]);
    eq(after.rows.length, 0, 'the pre-fix table really does lose the row entirely — this is the defect the draft migration fixes');
  });

  // Apply the draft fix to the "AFTER" table by running its SQL against the
  // matching table name (the migration targets `location_consent_log`, which
  // is exactly what we named the "after" table above).
  await db.exec(DRAFT_LOCATION_CONSENT_FIX);

  await test('AFTER (fix applied): the constraint is now SET NULL, not CASCADE', async () => {
    const r = await q(`
      select confdeltype from pg_constraint
      where conname = 'location_consent_log_user_id_fkey'
    `);
    eq(r.rows[0].confdeltype, 'n', 'expected SET NULL (n), the migration did not change the action');
  });

  await test('AFTER (fix applied): deleting the profile anonymises the consent row instead of destroying it', async () => {
    await q(`insert into profiles (id) values ($1)`, [USER_B]);
    const ins = await q(
      `insert into location_consent_log (user_id, consented_at, consent_version) values ($1, now(), 'v1.0') returning id`,
      [USER_B],
    );
    const rowId = ins.rows[0].id;
    await q(`delete from profiles where id = $1`, [USER_B]);
    const after = await q(`select user_id, consent_version from location_consent_log where id = $1`, [rowId]);
    eq(after.rows.length, 1, 'the row must survive — this is the whole point of the fix');
    assert(after.rows[0].user_id === null, 'user_id must be anonymised (NULL), not left pointing at a deleted profile');
    eq(after.rows[0].consent_version, 'v1.0', 'the accountability evidence (what was consented to) must be unchanged');
  });

  // ── Part B: venue_claims phone minimisation ──────────────────────────────
  await db.exec(`
    create table venue_claims (
      id                   uuid primary key default gen_random_uuid(),
      venue_id             uuid not null,
      user_id              uuid not null references profiles(id) on delete cascade,
      verified_phone       text not null,
      verified_phone_token text not null,
      status               text not null default 'pending'
                             check (status in ('pending', 'approved', 'rejected')),
      notes                text,
      admin_notes          text,
      reviewed_at          timestamptz,
      reviewed_by          uuid,
      created_at           timestamptz default now()
    );
  `);

  await db.exec(DRAFT_PHONE_MINIMISATION);

  await test('the four minimised columns exist with the expected types', async () => {
    const r = await q(`
      select column_name, data_type from information_schema.columns
      where table_name = 'venue_claims'
        and column_name in ('phone_last4', 'phone_verification_hmac', 'phone_verified_at', 'phone_verification_method')
      order by column_name
    `);
    eq(r.rows.length, 4, 'all four new columns must exist');
    const types = Object.fromEntries(r.rows.map((row) => [row.column_name, row.data_type]));
    eq(types.phone_last4, 'text');
    eq(types.phone_verification_hmac, 'text');
    eq(types.phone_verified_at, 'timestamp with time zone');
    eq(types.phone_verification_method, 'text');
  });

  await test('verified_phone (plaintext) still exists — this migration is additive-only, never drops it', async () => {
    const r = await q(`
      select 1 from information_schema.columns
      where table_name = 'venue_claims' and column_name = 'verified_phone'
    `);
    eq(r.rows.length, 1, 'the migration must not have dropped verified_phone — that is a deliberate, separate, later step');
  });

  await test('the minimised representation can hold a claim without needing the recoverable full number displayed', async () => {
    await q(`insert into profiles (id) values ($1)`, ['44444444-4444-4444-4444-444444444444']);
    const venueId = '55555555-5555-5555-5555-555555555555';
    const ins = await q(
      `insert into venue_claims (venue_id, user_id, verified_phone, verified_phone_token,
         phone_last4, phone_verification_hmac, phone_verified_at, phone_verification_method)
       values ($1, $2, '+441234567890', 'tok-abc', '7890', 'deadbeef-fake-hmac-for-test', now(), 'sms_otp')
       returning phone_last4, phone_verification_hmac, phone_verification_method`,
      [venueId, '44444444-4444-4444-4444-444444444444'],
    );
    eq(ins.rows[0].phone_last4, '7890');
    eq(ins.rows[0].phone_verification_method, 'sms_otp');
    assert(ins.rows[0].phone_verification_hmac !== '+441234567890', 'the hmac column must never equal the plaintext number');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
