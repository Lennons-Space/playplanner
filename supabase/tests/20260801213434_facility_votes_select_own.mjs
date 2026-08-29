// =============================================================================
// supabase/tests/20260801213434_facility_votes_select_own.mjs
//
// Behavioural database tests for migration 20260801213434 (facility-vote 42501 fix) using
// an in-process Postgres (pglite) — NO live Supabase, NO production access.
// Loads a minimal bootstrap (the prerequisite objects 050/20260801213434 depend on) +
// the REAL migration files 050 and 20260801213434, then exercises the RLS/trigger
// pipeline exactly as the client (hooks/useFacilities.ts) does.
//
// Structure:
//   PART 0 — reproduction: bootstrap + 050 ONLY (no 20260801213434). Proves the 42501
//            root cause — the client's upsert().select('id') fails because
//            venue_facility_votes has no SELECT policy, while the identical
//            write WITHOUT the RETURNING/select chain succeeds.
//   PART 1 — regression + full matrix: bootstrap + 050 + 20260801213434. Proves the fix
//            resolves the exact client operation, and that nothing it must
//            NOT touch (grants, other policies, SECURITY DEFINER triggers,
//            aggregate-table privacy) was disturbed.
//
// Run:  node supabase/tests/20260801213434_facility_votes_select_own.mjs   (part of npm run test:db)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_050 = readFileSync(join(__dirname, '../migrations/050_parent_facility_votes.sql'), 'utf8');
const MIGRATION_FACILITY_VOTES = readFileSync(join(__dirname, '../migrations/20260801213434_facility_votes_select_own.sql'), 'utf8');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OWNER  = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Minimal prerequisite schema that 050/20260801213434 depend on (mirrors the real
// objects: roles, auth.uid() stub, venues/facilities/venue_facilities from
// migration 001, and the same default-privilege parity trick used by the
// 056 test file — Supabase auto-grants table privileges to anon/authenticated
// on every new public table, which is why production shows broad grants on
// venue_facility_stats/venue_facilities even though no migration explicitly
// GRANTs them).
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  create or replace function touch_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end; $$;

  -- Mirrors migration 001's venues (only the columns 050's RLS/mirror path touches).
  create table public.venues (
    id                uuid primary key default gen_random_uuid(),
    is_published      boolean default false,
    moderation_status text default 'pending' check (moderation_status in ('pending','approved','rejected')),
    claimed_by        uuid
  );

  -- Mirrors migration 001's facilities exactly enough for 050's seed INSERT to work.
  create table public.facilities (
    id   uuid primary key default gen_random_uuid(),
    name text not null unique,
    slug text not null unique,
    icon text not null
  );

  -- Mirrors migration 001's venue_facilities table + its two RLS policies verbatim
  -- (this is the mirror trigger's write target — needed to prove it still works
  -- and that nothing broadens direct client access to it).
  create table public.venue_facilities (
    venue_id    uuid references public.venues(id) on delete cascade,
    facility_id uuid references public.facilities(id) on delete cascade,
    notes       text,
    primary key (venue_id, facility_id)
  );
  alter table public.venue_facilities enable row level security;

  create policy "Venue facilities are public for approved venues" on public.venue_facilities
    for select using (
      exists (
        select 1 from public.venues
        where venues.id = venue_facilities.venue_id
          and venues.is_published = true
          and venues.moderation_status = 'approved'
      )
    );

  create policy "Owners can manage own venue facilities" on public.venue_facilities
    for all using (
      exists (
        select 1 from public.venues
        where venues.id = venue_facilities.venue_id
          and venues.claimed_by = auth.uid()
      )
    );
`;

// ── Tiny assert harness (same shape as the 056 test file) ─────────────────────
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

// ── Per-database helpers ───────────────────────────────────────────────────────
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
  async function reset() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  }
  async function newAuthUser() {
    const r = await q(`insert into auth.users (id) values (gen_random_uuid()) returning id`);
    return r.rows[0].id;
  }
  async function newVenue(overrides = {}) {
    const r = await q(
      `insert into public.venues (is_published, moderation_status, claimed_by) values ($1,$2,$3) returning id`,
      [overrides.is_published ?? true, overrides.moderation_status ?? 'approved', overrides.claimed_by ?? null],
    );
    return r.rows[0].id;
  }
  // Exactly the client's mutationFn shape (hooks/useFacilities.ts useCastFacilityVote):
  // upsert onConflict (venue_id,user_id,facility_slug), then .select('id') —
  // i.e. INSERT ... ON CONFLICT DO UPDATE ... RETURNING id.
  async function castVoteSql(venueId, slug, uid, present = true) {
    return q(
      `insert into public.venue_facility_votes (venue_id, user_id, facility_slug, present)
       values ($1, $2, $3, $4)
       on conflict (venue_id, user_id, facility_slug) do update set present = excluded.present
       returning id`,
      [venueId, uid, slug, present],
    );
  }
  // Same upsert shape, no RETURNING — isolates whether RETURNING specifically
  // is required, or whether ON CONFLICT DO UPDATE alone needs SELECT.
  async function castVoteSqlNoReturning(venueId, slug, uid, present = true) {
    return q(
      `insert into public.venue_facility_votes (venue_id, user_id, facility_slug, present)
       values ($1, $2, $3, $4)
       on conflict (venue_id, user_id, facility_slug) do update set present = excluded.present`,
      [venueId, uid, slug, present],
    );
  }
  // A genuinely plain INSERT — no ON CONFLICT clause at all, no RETURNING.
  // This is the true control: it isolates the base INSERT/WITH CHECK path
  // from the ON CONFLICT DO UPDATE mechanism entirely.
  async function castVoteInsertOnly(venueId, slug, uid, present = true) {
    return q(
      `insert into public.venue_facility_votes (venue_id, user_id, facility_slug, present) values ($1, $2, $3, $4)`,
      [venueId, uid, slug, present],
    );
  }

  return { q, asUser, asAnon, reset, newAuthUser, newVenue, castVoteSql, castVoteSqlNoReturning, castVoteInsertOnly };
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // PART 0 — reproduction (bootstrap + 050 ONLY, no fix)
  // ═══════════════════════════════════════════════════════════════════════════
  const dbBefore = await PGlite.create();
  await dbBefore.exec(BOOTSTRAP);
  await dbBefore.exec(MIGRATION_050);
  const before = makeHelpers(dbBefore);

  console.log('\nMigration 20260801213434 — root-cause reproduction (pre-fix, 050 only)\n');

  let repro_venue;
  await test('REPRO: exact client operation (upsert + .select("id")) throws 42501 on a user\'s FIRST-EVER vote', async () => {
    repro_venue = await before.newVenue();
    await before.asUser(USER_A);
    await throws(
      before.castVoteSql(repro_venue, 'toilets', USER_A),
      /row-level security|42501/i,
      'expected the RETURNING clause to be blocked by the missing SELECT policy',
    );
    await before.reset();
  });

  await test('REPRO control: a plain INSERT with no ON CONFLICT clause and no RETURNING succeeds — the base write/WITH CHECK path was never broken', async () => {
    await before.asUser(USER_A);
    await before.castVoteInsertOnly(repro_venue, 'baby-change', USER_A);
    await before.reset();
    // Confirm the row really landed, bypassing RLS as the pglite bootstrap superuser.
    const r = await before.q(
      `select present from public.venue_facility_votes where venue_id=$1 and user_id=$2 and facility_slug='baby-change'`,
      [repro_venue, USER_A],
    );
    eq(r.rows[0]?.present, true, 'row was written by a plain INSERT even with zero SELECT policy');
  });

  await test('REPRO: ON CONFLICT DO UPDATE requires SELECT even with NO RETURNING and NO actual conflict — refines the diagnosis', async () => {
    // repro_venue/USER_B/'parking' has never been voted on — there is no
    // pre-existing row for the ON CONFLICT arbiter to actually collide with.
    // This still throws, proving the SELECT requirement is triggered by the
    // mere presence of ON CONFLICT DO UPDATE, not by RETURNING and not by a
    // real conflict occurring — Postgres must be able to read a potential
    // conflicting row to decide whether to update it.
    await before.asUser(USER_B);
    await throws(
      before.castVoteSqlNoReturning(repro_venue, 'parking', USER_B),
      /row-level security|42501/i,
      'ON CONFLICT DO UPDATE needs SELECT to check for a conflicting row, independent of RETURNING',
    );
    await before.reset();
  });

  await test('REPRO: re-voting via the real client upsert shape (actual conflict + RETURNING) fails identically', async () => {
    // Seed the first vote via a plain insert (bypasses the ON CONFLICT wall
    // above, so we can reach a genuine conflict for this test).
    await before.asUser(USER_B);
    await before.castVoteInsertOnly(repro_venue, 'parking', USER_B);
    await before.reset();
    await before.asUser(USER_B);
    await throws(
      before.castVoteSql(repro_venue, 'parking', USER_B),
      /row-level security|42501/i,
      'the update-via-upsert path fails identically to the fresh-insert-via-upsert path',
    );
    await before.reset();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1 — regression + full matrix (bootstrap + 050 + 20260801213434, the actual fix)
  // ═══════════════════════════════════════════════════════════════════════════
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_050);
  await db.exec(MIGRATION_FACILITY_VOTES);
  const h = makeHelpers(db);

  console.log('\nMigration 20260801213434 — fix verification (050 + 20260801213434)\n');

  let venue;
  await test('setup: create a published/approved test venue', async () => {
    venue = await h.newVenue();
    assert(venue, 'venue created');
  });

  // ── 1. own-select ────────────────────────────────────────────────────────
  await test('1. authenticated user can read their own facility vote', async () => {
    await h.asUser(USER_A);
    const ins = await h.castVoteSql(venue, 'toilets', USER_A);
    eq(ins.rows.length, 1, 'the exact client upsert+select now returns the row (THE FIX)');
    const r = await h.q(
      `select present, user_id from public.venue_facility_votes where venue_id=$1 and facility_slug='toilets'`,
      [venue],
    );
    eq(r.rows.length, 1, 'own vote is visible via SELECT');
    eq(r.rows[0].user_id, USER_A, 'row belongs to the caller');
    await h.reset();
  });

  // ── 2. cross-user select ────────────────────────────────────────────────
  await test('2. authenticated user cannot read another user\'s vote', async () => {
    await h.asUser(USER_B);
    await h.castVoteSql(venue, 'parking', USER_B);
    const r = await h.q(`select user_id, facility_slug from public.venue_facility_votes`);
    assert(r.rows.length > 0, 'B sees at least their own row');
    assert(r.rows.every((row) => row.user_id === USER_B), 'B never sees a row belonging to A');
    assert(!r.rows.some((row) => row.facility_slug === 'toilets'), 'A\'s toilets vote is invisible to B');
    await h.reset();
  });

  // ── 3. anon select ───────────────────────────────────────────────────────
  await test('3. unauthenticated (anon) user cannot read any private vote rows', async () => {
    await h.asAnon();
    const r = await h.q(`select * from public.venue_facility_votes`);
    eq(r.rows.length, 0, 'anon sees zero vote rows despite existing votes and a table-level SELECT grant');
    await h.reset();
  });

  // ── 4. insert-own ────────────────────────────────────────────────────────
  await test('4. authenticated insert-own still succeeds (plain insert, no conflict)', async () => {
    await h.asUser(USER_A);
    await h.castVoteSqlNoReturning(venue, 'baby-change', USER_A);
    const r = await h.q(
      `select present from public.venue_facility_votes where venue_id=$1 and user_id=$2 and facility_slug='baby-change'`,
      [venue, USER_A],
    );
    eq(r.rows[0]?.present, true, 'plain insert-own unaffected by the fix');
    await h.reset();
  });

  // ── 5. update/upsert-own (the actual regression test for the bug) ──────────
  await test('5. authenticated update/upsert-own succeeds via the exact client statement shape', async () => {
    await h.asUser(USER_A);
    // USER_A already has a 'toilets' row from test 1 — this exercises the
    // ON CONFLICT DO UPDATE path with RETURNING, the precise statement that
    // used to throw 42501 on every re-vote.
    const upd = await h.castVoteSql(venue, 'toilets', USER_A, true);
    eq(upd.rows.length, 1, 'upsert-own update path returns the row');
    await h.reset();
  });

  // ── 6. delete/toggle-own ────────────────────────────────────────────────
  await test('6. authenticated user can delete (toggle off) their own vote', async () => {
    await h.asUser(USER_A);
    const del = await h.q(
      `delete from public.venue_facility_votes where venue_id=$1 and user_id=$2 and facility_slug='baby-change'`,
      [venue, USER_A],
    );
    eq(del.affectedRows ?? del.rows.length ?? 1, del.affectedRows ?? del.rows.length ?? 1, 'delete executed'); // pglite always reports success via no throw
    const r = await h.q(
      `select 1 from public.venue_facility_votes where venue_id=$1 and user_id=$2 and facility_slug='baby-change'`,
      [venue, USER_A],
    );
    eq(r.rows.length, 0, 'own row is gone after self-delete');
    await h.reset();
  });

  // ── 7. cross-user update/delete rejected ────────────────────────────────
  let aVoteId;
  await test('setup: fetch A\'s toilets vote id (as superuser, bypassing RLS) for the cross-user tests', async () => {
    const r = await h.q(`select id from public.venue_facility_votes where venue_id=$1 and user_id=$2 and facility_slug='toilets'`, [venue, USER_A]);
    aVoteId = r.rows[0].id;
    assert(aVoteId, 'A\'s toilets vote exists');
  });

  await test('7a. cross-user UPDATE on another user\'s vote row is rejected (zero rows affected, no error)', async () => {
    await h.asUser(USER_B);
    const r = await h.q(`update public.venue_facility_votes set present = false where id = $1`, [aVoteId]);
    eq(r.rows.length, 0, 'RLS USING clause silently filters out the row — 0 rows updated');
    await h.reset();
    const check = await h.q(`select present from public.venue_facility_votes where id=$1`, [aVoteId]);
    eq(check.rows[0].present, true, 'A\'s row is unchanged after B\'s rejected update attempt');
  });

  await test('7b. cross-user DELETE on another user\'s vote row is rejected (zero rows affected, no error)', async () => {
    await h.asUser(USER_B);
    const r = await h.q(`delete from public.venue_facility_votes where id = $1`, [aVoteId]);
    eq(r.rows.length, 0, 'RLS USING clause silently filters out the row — 0 rows deleted');
    await h.reset();
    const check = await h.q(`select 1 from public.venue_facility_votes where id=$1`, [aVoteId]);
    eq(check.rows.length, 1, 'A\'s row still exists after B\'s rejected delete attempt');
  });

  // ── 8. invalid venue/facility combinations ──────────────────────────────
  await test('8a. invalid facility_slug is rejected by the CHECK constraint', async () => {
    await h.asUser(USER_A);
    await throws(
      h.castVoteSqlNoReturning(venue, 'sauna', USER_A),
      /check/i,
      'unsupported facility slug must be rejected',
    );
    await h.reset();
  });

  await test('8b. nonexistent venue_id is rejected by the foreign key constraint', async () => {
    await h.asUser(USER_A);
    await throws(
      h.castVoteSqlNoReturning('00000000-0000-0000-0000-000000000000', 'toilets', USER_A),
      /foreign key|violates/i,
      'nonexistent venue must be rejected',
    );
    await h.reset();
  });

  // ── 9 & 10. aggregate + mirror triggers still work end-to-end ──────────────
  let aggVenue;
  await test('9&10. setup: 5 distinct users vote on a fresh venue/facility (4 yes, 1 no)', async () => {
    aggVenue = await h.newVenue();
    const voters = [];
    for (let i = 0; i < 5; i += 1) voters.push(await h.newAuthUser());
    for (let i = 0; i < 4; i += 1) {
      await h.asUser(voters[i]);
      await h.castVoteSqlNoReturning(aggVenue, 'parking', voters[i], true);
    }
    await h.asUser(voters[4]);
    await h.castVoteSqlNoReturning(aggVenue, 'parking', voters[4], false);
    await h.reset();
  });

  await test('9. recompute_facility_stats trigger produces the correct aggregate (4 yes / 1 no / high confidence)', async () => {
    const r = await h.q(
      `select yes_count, no_count, total_votes, confidence, present from public.venue_facility_stats where venue_id=$1 and facility_slug='parking'`,
      [aggVenue],
    );
    eq(r.rows.length, 1, 'aggregate row exists — the AFTER trigger fired');
    eq(r.rows[0].yes_count, 4, 'yes_count');
    eq(r.rows[0].no_count, 1, 'no_count');
    eq(r.rows[0].total_votes, 5, 'total_votes');
    eq(r.rows[0].confidence, 'high', 'confidence tier (total>=5, agreement 0.8>=0.75)');
    eq(r.rows[0].present, true, 'majority verdict present=true');
  });

  await test('10. mirror trigger writes exactly one parent-confirmed row, scoped to the correct venue AND facility', async () => {
    const r = await h.q(
      `select vf.notes from public.venue_facilities vf
       join public.facilities f on f.id = vf.facility_id
       where vf.venue_id=$1 and f.slug='parking'`,
      [aggVenue],
    );
    eq(r.rows.length, 1, 'exactly one mirrored row for (aggVenue, parking)');
    eq(r.rows[0].notes, 'parent-confirmed', 'tagged as parent-confirmed, not overwriting an unrelated notes value');

    const other = await h.q(
      `select vf.notes from public.venue_facilities vf
       join public.facilities f on f.id = vf.facility_id
       where vf.venue_id=$1 and f.slug='toilets'`,
      [aggVenue],
    );
    eq(other.rows.length, 0, 'no stray mirror row created for a facility nobody voted on at this venue');
  });

  // ── 11. no direct client write access to aggregate/mirror tables ─────────
  await test('11a. authenticated cannot directly INSERT into venue_facility_stats', async () => {
    await h.asUser(USER_A);
    await throws(
      h.q(
        `insert into public.venue_facility_stats (venue_id, facility_slug, yes_count, no_count, total_votes, confidence, present)
         values ($1, 'toilets', 99, 0, 99, 'high', true)`,
        [venue],
      ),
      /row-level security|permission denied|42501/i,
      'clients must never be able to fabricate a confidence verdict directly',
    );
    await h.reset();
  });

  await test('11b. authenticated cannot directly INSERT into venue_facilities for a venue they do not own', async () => {
    const notOwned = await h.newVenue({ claimed_by: OWNER });
    const facilityId = (await h.q(`select id from public.facilities where slug='toilets'`)).rows[0].id;
    await h.asUser(USER_A); // USER_A is not OWNER
    await throws(
      h.q(`insert into public.venue_facilities (venue_id, facility_id, notes) values ($1,$2,'fabricated')`, [notOwned, facilityId]),
      /row-level security|permission denied|42501/i,
      'non-owner must not be able to write venue_facilities directly',
    );
    await h.reset();

    // Control: the pre-existing (migration 001) owner-write policy is untouched —
    // the actual owner CAN still manage their own venue's facilities directly.
    await h.asUser(OWNER);
    await h.q(`insert into public.venue_facilities (venue_id, facility_id, notes) values ($1,$2,'owner-added')`, [notOwned, facilityId]);
    await h.reset();
    const check = await h.q(`select notes from public.venue_facilities where venue_id=$1 and facility_id=$2`, [notOwned, facilityId]);
    eq(check.rows[0].notes, 'owner-added', 'the untouched owner-write policy from migration 001 still works');
  });

  // ── Rollback safety ────────────────────────────────────────────────────────
  await test('rollback: dropping the new policy re-breaks the exact client upsert (proves it was the fix) but leaves plain insert-own and grants untouched', async () => {
    await db.exec(`DROP POLICY IF EXISTS "venue_facility_votes_select_own" ON public.venue_facility_votes;`);

    await h.asUser(USER_A);
    const afterDrop = await h.q(`select * from public.venue_facility_votes where venue_id=$1 and user_id=$2`, [venue, USER_A]);
    eq(afterDrop.rows.length, 0, 'select-own access is gone once the policy is dropped (proves the policy, not something else, was granting it)');
    await h.reset();

    // The client's real call shape (upsert via ON CONFLICT DO UPDATE) breaks
    // again immediately — this IS the regression proof that 20260801213434 is what fixes it.
    await h.asUser(USER_A);
    await throws(
      h.castVoteSqlNoReturning(venue, 'parking', USER_A, true),
      /row-level security|42501/i,
      'dropping the select-own policy reintroduces the exact 42501 this migration fixes',
    );
    await h.reset();

    // A plain INSERT (no ON CONFLICT) — the base write mechanism from
    // migration 050 — is unaffected by the drop.
    await h.asUser(USER_B);
    await h.castVoteInsertOnly(venue, 'baby-change', USER_B, true);
    await h.reset();
    const stillThere = await h.q(
      `select 1 from public.venue_facility_votes where venue_id=$1 and user_id=$2 and facility_slug='baby-change'`,
      [venue, USER_B],
    );
    eq(stillThere.rows.length, 1, 'insert-own policy from migration 050 survives the rollback');

    // Restore the fix so this script ends in the intended final state.
    await db.exec(MIGRATION_FACILITY_VOTES);
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
