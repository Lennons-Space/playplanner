// =============================================================================
// supabase/tests/account_deletion_matrix.mjs
//
// Automates, for the FIRST time, the verification that migrations 051/052
// documented as manual/staging-only "VERIFICATION SQL" comments (both files
// explicitly say "run manually against a staging DB — requires real
// auth.users rows, so this cannot run inside jest/CI"). This test proves the
// same behaviour without a real Supabase project, using pglite — the actual
// `delete_own_account()` function body is copied verbatim from
// 052_account_deletion_claimed_by_cleanup.sql (the final, current live
// version — 052 does not itself redefine the function, only the FK; the body
// tested here is 051's, re-verified as still current by grepping every later
// migration for `delete_own_account` and confirming none redefine its body).
//
// Written during the 2026-09-01 "Privacy-Critical Engineering Remediation
// Pass" to build the explicit data-store deletion matrix Liam asked for.
// Table DDL is copied from the live migrations (001, 023, 035, 050,
// 051, 052) with `uuid_generate_v4()`/`gen_random_uuid()` normalised and
// PostGIS/spatial columns omitted (not relevant to deletion behaviour),
// following the same technique as 060_enrichment_2_1_facility_sync.mjs.
//
// Run: node supabase/tests/account_deletion_matrix.mjs
// =============================================================================

import { PGlite } from '@electric-sql/pglite';

const USER_A = '22222222-2222-2222-2222-222222222222'; // the user who deletes their account
const USER_B = '33333333-3333-3333-3333-333333333333'; // unrelated control user

const BOOTSTRAP = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  create table profiles (
    id uuid primary key references auth.users(id) on delete cascade
  );

  create table venues (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'Test Venue',
    submitted_by uuid references profiles(id) on delete set null,
    moderated_by uuid references profiles(id) on delete set null,
    claimed_by   uuid references profiles(id) on delete set null,
    is_published boolean default false
  );

  create table reviews (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    user_id uuid references profiles(id) on delete cascade,
    moderated_by uuid references profiles(id) on delete set null,
    body text
  );

  create table favourites (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id) on delete cascade,
    venue_id uuid references venues(id) on delete cascade
  );

  create table venue_facility_votes (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    facility_slug text
  );

  create table venue_photos (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    uploaded_by uuid references profiles(id) on delete set null,
    moderated_by uuid references profiles(id) on delete set null,
    status text not null default 'pending'
  );

  create table venue_claims (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    user_id uuid not null references profiles(id) on delete cascade,
    status text default 'pending'
  );

  create table business_subscriptions (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid references profiles(id) on delete cascade,
    venue_id uuid references venues(id) on delete cascade,
    stripe_customer_id text,
    plan text
  );

  create table push_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    token text
  );

  create table location_consent_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id) on delete set null, -- reflects the FIX drafted this pass
    consented_at timestamptz,
    consent_version text
  );

  create table gdpr_audit_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id) on delete set null,
    action text not null,
    performed_by uuid references profiles(id) on delete set null
  );

  -- delete_own_account() body copied verbatim from
  -- 051_account_deletion_photo_cleanup.sql:244-274 (the current live
  -- definition — no later migration redefines it).
  create or replace function delete_own_account()
  returns void as $$
  begin
    insert into gdpr_audit_log (user_id, action, performed_by)
    values (auth.uid(), 'account_deletion_requested', auth.uid());

    delete from public.venue_photos
    where uploaded_by = auth.uid() and status <> 'approved';

    delete from auth.users where id = auth.uid();
  end;
  $$ language plpgsql;
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

async function main() {
  await db.exec(BOOTSTRAP);

  // ── Seed: user A does everything; user B is the untouched control ────────
  await q(`insert into auth.users (id) values ($1), ($2)`, [USER_A, USER_B]);
  await q(`insert into profiles (id) values ($1), ($2)`, [USER_A, USER_B]);

  const venueApproved = (await q(`insert into venues (submitted_by) values ($1) returning id`, [USER_A])).rows[0].id;
  const venueClaimed   = (await q(`insert into venues (claimed_by)   values ($1) returning id`, [USER_A])).rows[0].id;
  const venueModerated = (await q(`insert into venues (moderated_by) values ($1) returning id`, [USER_A])).rows[0].id;

  const reviewA = (await q(`insert into reviews (venue_id, user_id, body) values ($1, $2, 'great place') returning id`, [venueApproved, USER_A])).rows[0].id;
  const reviewModeratedByA = (await q(`insert into reviews (venue_id, user_id, moderated_by, body) values ($1, $2, $3, 'other review') returning id`, [venueApproved, USER_B, USER_A])).rows[0].id;

  const favId = (await q(`insert into favourites (user_id, venue_id) values ($1, $2) returning id`, [USER_A, venueApproved])).rows[0].id;
  const voteId = (await q(`insert into venue_facility_votes (venue_id, user_id, facility_slug) values ($1, $2, 'parking') returning id`, [venueApproved, USER_A])).rows[0].id;

  const photoApproved = (await q(`insert into venue_photos (venue_id, uploaded_by, status) values ($1, $2, 'approved') returning id`, [venueApproved, USER_A])).rows[0].id;
  const photoPending  = (await q(`insert into venue_photos (venue_id, uploaded_by, status) values ($1, $2, 'pending') returning id`, [venueApproved, USER_A])).rows[0].id;
  const photoModeratedByA = (await q(`insert into venue_photos (venue_id, uploaded_by, moderated_by, status) values ($1, $2, $3, 'approved') returning id`, [venueApproved, USER_B, USER_A])).rows[0].id;

  const claimId = (await q(`insert into venue_claims (venue_id, user_id) values ($1, $2) returning id`, [venueClaimed, USER_A])).rows[0].id;
  const subId = (await q(`insert into business_subscriptions (profile_id, venue_id, stripe_customer_id, plan) values ($1, $2, 'cus_test', 'pro') returning id`, [USER_A, venueClaimed])).rows[0].id;
  const tokenId = (await q(`insert into push_tokens (user_id, token) values ($1, 'expo-token-a') returning id`, [USER_A])).rows[0].id;
  const consentId = (await q(`insert into location_consent_log (user_id, consented_at, consent_version) values ($1, now(), 'v1.0') returning id`, [USER_A])).rows[0].id;

  // Control (user B) rows, must be untouched by A's deletion
  const venueB = (await q(`insert into venues (submitted_by) values ($1) returning id`, [USER_B])).rows[0].id;
  const favB = (await q(`insert into favourites (user_id, venue_id) values ($1, $2) returning id`, [USER_B, venueB])).rows[0].id;

  // ── Act: delete user A's account ──────────────────────────────────────────
  await q(`select set_config('test.uid', $1, false)`, [USER_A]);
  await q(`select delete_own_account()`);

  // ── Assert: the explicit data-store deletion matrix ───────────────────────
  await test('auth.users / profiles: HARD DELETED for the requesting user', async () => {
    const u = await q(`select count(*)::int as c from auth.users where id = $1`, [USER_A]);
    const p = await q(`select count(*)::int as c from profiles where id = $1`, [USER_A]);
    eq(u.rows[0].c, 0, 'auth.users row must be gone');
    eq(p.rows[0].c, 0, 'profiles row must be gone (cascades from auth.users)');
  });

  await test('reviews AUTHORED by the user: DELETED entirely (cascade), not anonymised', async () => {
    const r = await q(`select count(*)::int as c from reviews where id = $1`, [reviewA]);
    eq(r.rows[0].c, 0, "the user's own review must be gone entirely");
  });

  await test("reviews MODERATED by the user (someone else's review): SURVIVES, moderated_by anonymised", async () => {
    const r = await q(`select moderated_by, body from reviews where id = $1`, [reviewModeratedByA]);
    eq(r.rows.length, 1, "another user's review must survive");
    assert(r.rows[0].moderated_by === null, 'moderated_by must be anonymised');
    eq(r.rows[0].body, 'other review', 'content must be untouched');
  });

  await test('favourites: DELETED (cascade)', async () => {
    const r = await q(`select count(*)::int as c from favourites where id = $1`, [favId]);
    eq(r.rows[0].c, 0);
  });

  await test('venue_facility_votes: DELETED (cascade via auth.users)', async () => {
    const r = await q(`select count(*)::int as c from venue_facility_votes where id = $1`, [voteId]);
    eq(r.rows[0].c, 0);
  });

  await test('venue_photos (approved, own upload): SURVIVES, uploaded_by anonymised', async () => {
    const r = await q(`select uploaded_by, status from venue_photos where id = $1`, [photoApproved]);
    eq(r.rows.length, 1);
    assert(r.rows[0].uploaded_by === null);
    eq(r.rows[0].status, 'approved');
  });

  await test('venue_photos (pending, own upload): FULLY DELETED (pre-cascade cleanup)', async () => {
    const r = await q(`select count(*)::int as c from venue_photos where id = $1`, [photoPending]);
    eq(r.rows[0].c, 0);
  });

  await test("venue_photos moderated by the user (someone else's photo): SURVIVES, moderated_by anonymised", async () => {
    const r = await q(`select moderated_by from venue_photos where id = $1`, [photoModeratedByA]);
    eq(r.rows.length, 1);
    assert(r.rows[0].moderated_by === null);
  });

  await test('venues submitted/claimed/moderated by the user: SURVIVE, attribution anonymised', async () => {
    const s = await q(`select submitted_by from venues where id = $1`, [venueApproved]);
    const c = await q(`select claimed_by from venues where id = $1`, [venueClaimed]);
    const m = await q(`select moderated_by from venues where id = $1`, [venueModerated]);
    assert(s.rows[0].submitted_by === null, 'submitted_by must be anonymised');
    assert(c.rows[0].claimed_by === null, 'claimed_by must be anonymised (the claim reverts)');
    assert(m.rows[0].moderated_by === null, 'moderated_by must be anonymised');
  });

  await test('venue_claims: DELETED entirely (cascade) — the claim record itself does not survive', async () => {
    const r = await q(`select count(*)::int as c from venue_claims where id = $1`, [claimId]);
    eq(r.rows[0].c, 0, 'this is a genuine finding, not an assumption: a claim record is destroyed, not anonymised, unlike most other attribution links in this schema');
  });

  await test('business_subscriptions: DELETED entirely (cascade)', async () => {
    const r = await q(`select count(*)::int as c from business_subscriptions where id = $1`, [subId]);
    eq(r.rows[0].c, 0, 'the local subscription record is destroyed on account deletion (Stripe retains its own copy independently, per its own retention obligations)');
  });

  await test('push_tokens: DELETED entirely (cascade)', async () => {
    const r = await q(`select count(*)::int as c from push_tokens where id = $1`, [tokenId]);
    eq(r.rows[0].c, 0);
  });

  await test('location_consent_log (WITH THIS PASS’ FIX applied): SURVIVES, anonymised — not destroyed', async () => {
    const r = await q(`select user_id, consent_version from location_consent_log where id = $1`, [consentId]);
    eq(r.rows.length, 1, 'must survive for ICO accountability — this is the exact defect this pass found and fixed');
    assert(r.rows[0].user_id === null);
    eq(r.rows[0].consent_version, 'v1.0');
  });

  await test('gdpr_audit_log: the deletion request itself is logged, then anonymised', async () => {
    const r = await q(`select user_id, action, performed_by from gdpr_audit_log where action = 'account_deletion_requested'`);
    eq(r.rows.length, 1);
    assert(r.rows[0].user_id === null, 'anonymised after the cascade');
    assert(r.rows[0].performed_by === null);
  });

  await test("control user B's data: completely untouched by A's deletion", async () => {
    const u = await q(`select count(*)::int as c from auth.users where id = $1`, [USER_B]);
    const f = await q(`select count(*)::int as c from favourites where id = $1`, [favB]);
    eq(u.rows[0].c, 1, 'user B must still exist');
    eq(f.rows[0].c, 1, "user B's favourite must be untouched");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
