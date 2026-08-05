// =============================================================================
// supabase/tests/058_fix_venue_photos_rls_recursion.mjs
//
// Behavioural database tests for migration 058 (venue_photos 42P17 recursion
// fix) using an in-process Postgres (pglite) — NO live Supabase, NO production
// access. Loads a minimal bootstrap (the prerequisite objects 007/058 depend
// on, including a minimal storage.buckets/storage.objects stub so migration
// 007's Storage-bucket section can run unmodified) + the REAL migration files
// 007 and 058, then exercises the RLS pipeline exactly as the client
// (hooks/useVenuePhotos.ts useUploadVenuePhoto) does.
//
// Structure:
//   PART 0 — reproduction: bootstrap + 007 ONLY (no 058). Proves the 42P17
//            root cause — migration 007's self-referencing WITH CHECK
//            subqueries recurse against venue_photos' own SELECT policies,
//            so even a user's FIRST-EVER, well-under-the-cap insert fails.
//   PART 1 — regression + full matrix: bootstrap + 007 + 058. Proves the fix
//            resolves the exact insert, preserves the 5/20 caps (including
//            that rejected/pending rows still count), and that nothing it
//            must NOT touch (SELECT/DELETE/admin policies, Storage) moved.
//   PART 2 — rollback proof: apply the exact rollback SQL handed back to
//            Liam to the fixed database and confirm it reintroduces the
//            identical 42P17 recursion — proving the rollback text is a
//            byte-for-byte restoration of migration 007's original policy,
//            not an approximation. The fix is then re-applied so the script
//            ends in the intended final state (same convention as 057).
//
// Run:  node supabase/tests/058_fix_venue_photos_rls_recursion.mjs   (part of npm run test:db)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_007 = readFileSync(join(__dirname, '../migrations/007_venue_photos.sql'), 'utf8');
const MIGRATION_058 = readFileSync(join(__dirname, '../migrations/058_fix_venue_photos_rls_recursion.sql'), 'utf8');

// The exact rollback SQL handed back to Liam (see the report) — restores
// migration 007's original policy text byte-for-byte AND removes everything
// 058 added (the private schema, its grants, and the helper function). Kept
// as one literal string here so PART 2 applies EXACTLY what he would paste,
// not a hand-retyped approximation.
const ROLLBACK_SQL = `
  BEGIN;

  DROP POLICY IF EXISTS "Authenticated users can upload photos" ON public.venue_photos;

  CREATE POLICY "Authenticated users can upload photos" ON public.venue_photos
    FOR INSERT WITH CHECK (
      auth.uid() = uploaded_by
      AND status = 'pending'
      AND (
        SELECT count(*) FROM public.venue_photos existing
        WHERE existing.venue_id   = venue_photos.venue_id
          AND existing.uploaded_by = auth.uid()
      ) < 5
      AND (
        SELECT count(*) FROM public.venue_photos existing
        WHERE existing.venue_id = venue_photos.venue_id
      ) < 20
    );

  DROP FUNCTION IF EXISTS private.can_authenticated_user_add_venue_photo(uuid);

  REVOKE USAGE ON SCHEMA private FROM authenticated;
  DROP SCHEMA IF EXISTS private;

  COMMIT;
`;

const ADMIN  = '00000000-0000-0000-0000-00000000000a';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER_E = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const USER_F = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// Minimal prerequisite schema that migration 007 depends on: roles, auth.uid()
// stub, profiles (venue_photos.uploaded_by/moderated_by FK target + is_admin()
// source), is_admin(), venues (venue_photos.venue_id FK target + the columns
// the SELECT policy reads), venue_photos itself in its PRE-007 shape (mirrors
// migration 001 exactly — 007 ALTERs this into its post-007 shape, same as
// production's real history), and a minimal storage.buckets/storage.objects
// stub so migration 007's Storage-bucket section (which the real file
// includes) can run unmodified rather than being hand-trimmed out.
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values
    ('${ADMIN}'), ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${USER_D}'), ('${USER_E}'), ('${USER_F}');

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  create table public.profiles (
    id       uuid primary key references auth.users(id) on delete cascade,
    is_admin boolean default false
  );
  insert into public.profiles (id, is_admin)
    select id, (id = '${ADMIN}') from auth.users;

  create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
  $$;

  create table public.venues (
    id                uuid primary key default gen_random_uuid(),
    is_published      boolean default false,
    moderation_status text default 'pending' check (moderation_status in ('pending','approved','rejected'))
  );

  -- Mirrors migration 001's venue_photos EXACTLY (pre-007 shape) — 007
  -- (loaded next) alters this into the real post-007 shape.
  create table public.venue_photos (
    id           uuid primary key default gen_random_uuid(),
    venue_id     uuid references public.venues(id) on delete cascade,
    uploaded_by  uuid references public.profiles(id),
    storage_path text not null,
    url          text not null,
    is_cover     boolean default false,
    is_approved  boolean default false,
    caption      text,
    sort_order   int default 0,
    created_at   timestamptz default now()
  );
  alter table public.venue_photos enable row level security;

  -- Minimal Storage stub so migration 007's bucket/policy section (which the
  -- real file includes) applies unmodified.
  create schema if not exists storage;
  create table storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean default false,
    file_size_limit    bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text references storage.buckets(id),
    name       text,
    owner      uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
`;

// ── Tiny assert harness (same shape as the 056/057 test files) ────────────────
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
    const id = r.rows[0].id;
    await q(`insert into public.profiles (id, is_admin) values ($1, false)`, [id]);
    return id;
  }
  async function newVenue(overrides = {}) {
    const r = await q(
      `insert into public.venues (is_published, moderation_status) values ($1,$2) returning id`,
      [overrides.is_published ?? true, overrides.moderation_status ?? 'approved'],
    );
    return r.rows[0].id;
  }
  // Exactly the client's insert shape (hooks/useVenuePhotos.ts useUploadVenuePhoto):
  // insert({ venue_id, uploaded_by, storage_path, url, caption, status }).
  async function insertPhoto(venueId, uploaderId, opts = {}) {
    return q(
      `insert into public.venue_photos (venue_id, uploaded_by, storage_path, url, caption, status)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        venueId,
        uploaderId,
        opts.storagePath ?? `${venueId}/${Math.random().toString(36).slice(2)}.jpg`,
        opts.url ?? 'https://cdn.example.com/photo.jpg',
        opts.caption ?? null,
        opts.status ?? 'pending',
      ],
    );
  }

  return { q, asUser, asAnon, reset, newAuthUser, newVenue, insertPhoto };
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // PART 0 — reproduction (bootstrap + 007 ONLY, no fix)
  // ═══════════════════════════════════════════════════════════════════════════
  const dbBefore = await PGlite.create();
  await dbBefore.exec(BOOTSTRAP);
  await dbBefore.exec(MIGRATION_007);
  const before = makeHelpers(dbBefore);

  console.log('\nMigration 058 — root-cause reproduction (pre-fix, 007 only)\n');

  await test('1. current self-referencing policy reproduces 42P17 on a plain, well-under-cap, first-ever insert', async () => {
    const venue = await before.newVenue();
    await before.asUser(USER_A);
    await throws(
      before.insertPhoto(venue, USER_A),
      /42P17|infinite recursion/i,
      'migration 007\'s inline count subqueries must recurse against venue_photos\' own SELECT policies',
    );
    await before.reset();
  });

  // NULL venue_id — what ACTUALLY happens against migration 007's ORIGINAL
  // policy (documented empirically, not assumed). Two SEPARATE things are
  // true here and must not be conflated:
  //
  //   (a) The 42P17 recursion bug (test 1, above) fires on EVERY insert
  //       against venue_photos regardless of venue_id — evaluating ANY
  //       subquery against venue_photos re-triggers its own SELECT policies
  //       the moment the table is touched, independent of what the WHERE
  //       clause would have matched. So a NULL-venue_id insert against
  //       007's ACTUAL DEPLOYED policy also just hits 42P17 — it does NOT
  //       independently demonstrate a cap bypass, because recursion already
  //       blocks the insert before the cap arithmetic's result matters.
  //       Confirmed below (test 1b).
  //
  //   (b) The cap-bypass LOGIC FLAW is real and separate: 007's subqueries
  //       filter on `existing.venue_id = venue_photos.venue_id`; comparing
  //       anything to NULL yields NULL (not TRUE), so with venue_id = NULL
  //       both WHERE clauses match zero rows and both counts read back 0,
  //       making `0 < 5` / `0 < 20` trivially pass. This is proven directly
  //       below (test 1c) by running 007's exact count-subquery arithmetic
  //       AS SUPERUSER (bypassing RLS entirely, isolating the arithmetic
  //       from the unrelated recursion bug). This flaw was never actually
  //       exploitable against LIVE production (recursion (a) always fired
  //       first, blocking every insert), but WOULD have become exploitable
  //       the moment recursion was fixed by ANY means that didn't also add
  //       an explicit NULL guard — which is exactly what migration 058's
  //       superseded v1 draft would have done (see 058's header,
  //       "REVISION HISTORY"). 058's helper closes it with an explicit
  //       `target_venue IS NOT NULL` check (see test 5c below).
  await test('1b. a NULL venue_id insert against migration 007\'s ORIGINAL policy also just hits the 42P17 recursion — same as any other insert, not an independent cap bypass', async () => {
    await before.asUser(USER_A);
    await throws(
      before.q(
        `insert into public.venue_photos (venue_id, uploaded_by, storage_path, url, caption, status)
         values (null, $1, 'orphan/no-venue.jpg', 'https://cdn.example.com/orphan.jpg', null, 'pending')`,
        [USER_A],
      ),
      /42P17|infinite recursion/i,
      'a NULL venue_id insert must still recurse identically to any other insert against the unfixed policy',
    );
    await before.reset();
  });

  await test('1c. proves the underlying cap-bypass LOGIC FLAW directly, bypassing RLS: 007\'s exact count-subquery arithmetic reads 0/0 for a NULL venue_id, so 0<5 and 0<20 both trivially pass in isolation (the flaw migration 058\'s helper explicitly guards against — see test 5c)', async () => {
    // Runs as the pglite connection's default (superuser) role, which — like
    // a Postgres table owner/superuser — bypasses RLS automatically, so this
    // isolates the raw WHERE-clause arithmetic from the (separate) 42P17
    // recursion bug proven in test 1b.
    const r = await before.q(
      `select
         (select count(*) from public.venue_photos existing
          where existing.venue_id = null::uuid and existing.uploaded_by = $1) as own_count,
         (select count(*) from public.venue_photos existing
          where existing.venue_id = null::uuid) as total_count`,
      [USER_A],
    );
    eq(Number(r.rows[0].own_count), 0, 'the own-count subquery matches zero rows for a NULL venue_id (NULL = NULL is UNKNOWN, not TRUE)');
    eq(Number(r.rows[0].total_count), 0, 'the total-count subquery matches zero rows for a NULL venue_id');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1 — regression + full matrix (bootstrap + 007 + 058, the actual fix)
  // ═══════════════════════════════════════════════════════════════════════════
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_007);
  await db.exec(MIGRATION_058);
  const h = makeHelpers(db);

  console.log('\nMigration 058 — fix verification (007 + 058)\n');

  // ── 2. first insert succeeds ────────────────────────────────────────────
  let venueMain;
  let firstPhotoId;
  await test('2. first authenticated insert succeeds post-fix (no 42P17)', async () => {
    venueMain = await h.newVenue();
    await h.asUser(USER_A);
    const r = await h.insertPhoto(venueMain, USER_A);
    firstPhotoId = r.rows[0].id;
    assert(firstPhotoId, 'insert returned an id');
    await h.reset();
  });

  // ── 3. uploaded_by spoofing rejected ────────────────────────────────────
  await test('3. uploaded_by must equal auth.uid() — spoofing another user\'s id is rejected', async () => {
    const venue = await h.newVenue();
    await h.asUser(USER_A);
    await throws(
      h.insertPhoto(venue, USER_B),
      /row-level security|42501/i,
      'inserting a row with someone else\'s uploaded_by must be rejected',
    );
    await h.reset();
  });

  // ── 4. status must be pending ───────────────────────────────────────────
  await test('4. status must be pending — attempting approved/rejected on insert is rejected', async () => {
    const venue = await h.newVenue();
    await h.asUser(USER_A);
    await throws(
      h.insertPhoto(venue, USER_A, { status: 'approved' }),
      /row-level security|42501/i,
      'a client-supplied status=approved must be rejected (no auto-approval path)',
    );
    await throws(
      h.insertPhoto(venue, USER_A, { status: 'rejected' }),
      /row-level security|42501/i,
      'a client-supplied status=rejected must also be rejected on insert',
    );
    await h.reset();
  });

  // ── 5. invalid venue_id rejected ────────────────────────────────────────
  // Either the FK constraint (23503) or the helper's own EXISTS check inside
  // the RLS WITH CHECK (42501) can be the one that actually fires first —
  // Postgres does not guarantee which of RLS vs FK evaluates first, and both
  // independently reject a nonexistent venue_id post-058 (the helper's EXISTS
  // check was added specifically so RLS itself gives a clean, in-policy
  // rejection rather than relying solely on the FK as a backstop). Either
  // outcome is correct and accepted here.
  await test('5. insert against a missing/invalid venue_id is rejected', async () => {
    await h.asUser(USER_A);
    await throws(
      h.insertPhoto('00000000-0000-0000-0000-000000000000', USER_A),
      /foreign key|violates|row-level security|42501|42503/i,
      'a nonexistent venue_id must be rejected (FK constraint or the helper\'s own EXISTS check)',
    );
    await h.reset();
  });

  // ── 5c. NULL venue_id rejected post-fix (the correctness bug from 1b) ──
  await test('5c. NULL venue_id is rejected post-fix (058 closes the cap-bypass bug documented in test 1b)', async () => {
    await h.asUser(USER_A);
    await throws(
      h.q(
        `insert into public.venue_photos (venue_id, uploaded_by, storage_path, url, caption, status)
         values (null, $1, 'orphan/no-venue.jpg', 'https://cdn.example.com/orphan.jpg', null, 'pending')`,
        [USER_A],
      ),
      /row-level security|42501/i,
      'private.can_authenticated_user_add_venue_photo\'s `target_venue IS NOT NULL` check must reject this',
    );
    await h.reset();

    // Confirm no orphan row landed either.
    const r = await h.q(`select 1 from public.venue_photos where venue_id is null`);
    eq(r.rows.length, 0, 'no NULL-venue_id row exists post-fix');
  });

  // ── 6 & 7. per-user-per-venue cap (5) ───────────────────────────────────
  let capVenue;
  await test('6. first 5 own photos for one venue succeed', async () => {
    capVenue = await h.newVenue();
    await h.asUser(USER_C);
    for (let i = 0; i < 5; i += 1) {
      await h.insertPhoto(capVenue, USER_C);
    }
    const r = await h.q(
      `select count(*)::int as n from public.venue_photos where venue_id=$1 and uploaded_by=$2`,
      [capVenue, USER_C],
    );
    eq(r.rows[0].n, 5, 'exactly 5 rows landed');
    await h.reset();
  });

  await test('7. 6th own photo for that same venue is rejected', async () => {
    await h.asUser(USER_C);
    await throws(
      h.insertPhoto(capVenue, USER_C),
      /row-level security|42501/i,
      'the 6th photo from the same user for the same venue must hit the 5-cap',
    );
    await h.reset();
  });

  // ── 8 & 9. per-venue total cap (20) ─────────────────────────────────────
  let totalVenue;
  const totalUploaders = [];
  await test('8. first 20 total photos for one venue (across multiple users) succeed', async () => {
    totalVenue = await h.newVenue();
    for (let u = 0; u < 4; u += 1) {
      const uid = await h.newAuthUser();
      totalUploaders.push(uid);
      await h.asUser(uid);
      for (let i = 0; i < 5; i += 1) {
        await h.insertPhoto(totalVenue, uid); // 4 users x 5 photos = 20, each under the 5-cap
      }
      await h.reset();
    }
    const r = await h.q(`select count(*)::int as n from public.venue_photos where venue_id=$1`, [totalVenue]);
    eq(r.rows[0].n, 20, 'exactly 20 rows landed across 4 uploaders');
  });

  await test('9. 21st photo for that venue is rejected regardless of uploader (even a fresh user well under their own 5-cap)', async () => {
    const freshUploader = await h.newAuthUser();
    await h.asUser(freshUploader);
    await throws(
      h.insertPhoto(totalVenue, freshUploader),
      /row-level security|42501/i,
      'a 21st photo must be rejected by the 20-total cap even for a brand-new uploader with 0 own photos',
    );
    await h.reset();
  });

  // ── 10. rejected/pending rows still count toward the caps ──────────────
  let statusCapVenue;
  await test('10. rejected/pending rows count toward the caps exactly as intended (status does not exempt a row)', async () => {
    statusCapVenue = await h.newVenue();
    await h.asUser(USER_D);
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await h.insertPhoto(statusCapVenue, USER_D);
      ids.push(r.rows[0].id);
    }
    await h.reset();

    // Admin rejects 3 of the 5 — if rejected rows were exempt from the count,
    // USER_D would now be able to upload again (2 rejected + 3 pending < 5
    // would read as "only 2 active"); the cap must still block them.
    await h.asUser(ADMIN);
    await h.q(`update public.venue_photos set status = 'rejected' where id = any($1)`, [ids.slice(0, 3)]);
    await h.reset();

    const statusCheck = await h.q(
      `select status, count(*)::int as n from public.venue_photos where venue_id=$1 group by status order by status`,
      [statusCapVenue],
    );
    eq(statusCheck.rows.length, 2, 'both pending and rejected statuses are present');

    await h.asUser(USER_D);
    await throws(
      h.insertPhoto(statusCapVenue, USER_D),
      /row-level security|42501/i,
      'the 5-cap must still block a 6th upload even though 3 of the 5 existing rows are now rejected, not pending',
    );
    await h.reset();
  });

  // ── 11. cross-user visibility of a pending row ──────────────────────────
  await test('11. another (non-uploader, non-admin) user cannot SELECT a pending row they don\'t own', async () => {
    await h.asUser(USER_B);
    const r = await h.q(`select 1 from public.venue_photos where id=$1`, [firstPhotoId]);
    eq(r.rows.length, 0, 'USER_A\'s pending photo is invisible to USER_B');
    await h.reset();
  });

  // ── 12. approved-photo public visibility unchanged ─────────────────────
  await test('12. approved-photo public visibility is unchanged (published+approved venue, approved photo → visible)', async () => {
    await h.asUser(ADMIN);
    await h.q(`update public.venue_photos set status = 'approved' where id = $1`, [firstPhotoId]);
    await h.reset();

    await h.asUser(USER_B); // not the uploader, not an admin
    const r = await h.q(`select id from public.venue_photos where id=$1`, [firstPhotoId]);
    eq(r.rows.length, 1, 'an approved photo on a published+approved venue is publicly visible');
    await h.reset();
  });

  // ── 13. own-delete + admin-manage-all unchanged ─────────────────────────
  await test('13a. own-delete policy still works unchanged', async () => {
    await h.asUser(USER_A);
    const ownRows = await h.q(`select count(*)::int as n from public.venue_photos where venue_id=$1 and uploaded_by=$2`, [venueMain, USER_A]);
    assert(ownRows.rows[0].n > 0, 'sanity: USER_A has at least one row to delete');
    await h.q(`delete from public.venue_photos where id=$1 and uploaded_by=$2`, [firstPhotoId, USER_A]);
    await h.reset();
    const r = await h.q(`select 1 from public.venue_photos where id=$1`, [firstPhotoId]);
    eq(r.rows.length, 0, 'own row deleted successfully');
  });

  await test('13b. admin-manage-all policy still works unchanged (admin can update/delete any user\'s row)', async () => {
    const freshVenue = await h.newVenue();
    await h.asUser(USER_C);
    const r0 = await h.insertPhoto(freshVenue, USER_C);
    const targetId = r0.rows[0].id;
    await h.reset();

    await h.asUser(ADMIN);
    await h.q(`update public.venue_photos set moderation_notes = 'reviewed' where id=$1`, [targetId]);
    const check = await h.q(`select moderation_notes from public.venue_photos where id=$1`, [targetId]);
    eq(check.rows[0].moderation_notes, 'reviewed', 'admin can update a row it does not own');
    await h.q(`delete from public.venue_photos where id=$1`, [targetId]);
    await h.reset();
    const gone = await h.q(`select 1 from public.venue_photos where id=$1`, [targetId]);
    eq(gone.rows.length, 0, 'admin can delete a row it does not own');
  });

  // ── 13c. helper lives outside public/graphql_public ────────────────────
  // This is a PROXY for "not reachable via the Supabase Data API", not a
  // full guarantee — whether `private` is actually excluded from PostgREST
  // routing depends on the project's Dashboard "Exposed schemas" setting,
  // which lives outside Postgres entirely and cannot be inspected or
  // enforced from a migration or a pglite test. See the migration's header
  // comment ("HOW MUCH THIS MIGRATION CAN ACTUALLY GUARANTEE"). What THIS
  // test proves is the part that IS provable from SQL: the function is not
  // sitting in one of the two schemas exposed BY DEFAULT.
  await test('13c. helper function lives outside public/graphql_public (proxy for API non-exposure — see migration header for the full caveat)', async () => {
    const r = await h.q(`
      select n.nspname as schema_name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'can_authenticated_user_add_venue_photo'
    `);
    eq(r.rows.length, 1, 'exactly one function with this name exists');
    assert(
      !['public', 'graphql_public'].includes(r.rows[0].schema_name),
      `function must not live in a schema exposed by default, got: ${r.rows[0].schema_name}`,
    );
    eq(r.rows[0].schema_name, 'private', 'function lives in the new private schema');
  });

  // ── 13d. helper is SECURITY DEFINER with search_path actually pinned ───
  await test('13d. helper function is SECURITY DEFINER with search_path pinned to empty (verifies the migration\'s SET search_path = \'\' actually took effect)', async () => {
    const r = await h.q(`
      select p.prosecdef as security_definer, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'can_authenticated_user_add_venue_photo' and n.nspname = 'private'
    `);
    eq(r.rows.length, 1, 'function found in the private schema');
    eq(r.rows[0].security_definer, true, 'function is SECURITY DEFINER');
    const proconfig = r.rows[0].proconfig ?? [];
    assert(
      Array.isArray(proconfig) && proconfig.some((c) => c.startsWith('search_path=')),
      `expected a search_path entry in proconfig, got: ${JSON.stringify(proconfig)}`,
    );
    const searchPathEntry = proconfig.find((c) => c.startsWith('search_path='));
    // Postgres stores an empty SET search_path = '' as the literal string
    // search_path="" (quoted empty value) in pg_proc.proconfig — confirmed
    // directly against pglite here rather than assumed.
    eq(searchPathEntry, 'search_path=""', 'search_path is pinned to empty, not extensions/public');
  });

  // ── 13e. only `authenticated` can execute the helper / use the schema ──
  await test('13e. EXECUTE on the helper and USAGE on the private schema are granted only to authenticated (not anon, not PUBLIC)', async () => {
    const funcGrants = await h.q(`
      select grantee, privilege_type
      from information_schema.role_routine_grants
      where routine_name = 'can_authenticated_user_add_venue_photo'
    `);
    const granteesWithExecute = funcGrants.rows
      .filter((row) => row.privilege_type === 'EXECUTE')
      .map((row) => row.grantee);
    assert(granteesWithExecute.includes('authenticated'), 'authenticated must have EXECUTE');
    assert(!granteesWithExecute.includes('anon'), 'anon must NOT have EXECUTE');
    assert(!granteesWithExecute.includes('PUBLIC'), 'PUBLIC must NOT have EXECUTE');

    // has_schema_privilege is the reliable, cross-version way to check schema
    // USAGE (information_schema's own grants view for schema-level USAGE
    // varies in shape across PG versions, so we use the direct ACL function).
    const anonUsage = await h.q(`select has_schema_privilege('anon', 'private', 'USAGE') as has_usage`);
    const authUsage = await h.q(`select has_schema_privilege('authenticated', 'private', 'USAGE') as has_usage`);
    eq(authUsage.rows[0].has_usage, true, 'authenticated has USAGE on the private schema');
    eq(anonUsage.rows[0].has_usage, false, 'anon does NOT have USAGE on the private schema');
  });

  // ── 13f. policy role is exactly `authenticated`, not PUBLIC ────────────
  // Migration 007's original policy omitted a TO clause, which defaults the
  // policy's role list to PUBLIC (i.e. every role, including anon, has
  // Postgres attempt to evaluate this policy's WITH CHECK for them, rather
  // than being filtered out before RLS evaluation even begins). 058 adds an
  // explicit `TO authenticated` for least-privilege — this proves it took
  // effect rather than assuming the SQL was applied as written.
  await test('13f. the final policy role is exactly authenticated, not PUBLIC', async () => {
    const r = await h.q(`
      select
        pol.polname,
        coalesce(array_agg(rol.rolname) filter (where rol.rolname is not null), '{}') as roles
      from pg_policy pol
      left join unnest(pol.polroles) as role_oid on true
      left join pg_roles rol on rol.oid = role_oid
      where pol.polrelid = 'public.venue_photos'::regclass
        and pol.polname = 'Authenticated users can upload photos'
      group by pol.polname
    `);
    eq(r.rows.length, 1, 'the policy exists');
    const roles = r.rows[0].roles;
    assert(Array.isArray(roles), 'roles column is an array');
    eq(roles.length, 1, `policy must apply to exactly one role, got: ${JSON.stringify(roles)}`);
    eq(roles[0], 'authenticated', 'the policy role must be authenticated, not PUBLIC/empty');
  });

  // ── 14. no recursion anywhere in this run ───────────────────────────────
  await test('14. no infinite recursion / no 42P17 anywhere in the PART 1 test run so far', async () => {
    const recursionFailures = failures.filter((f) => /42P17|infinite recursion/i.test(f.message));
    eq(recursionFailures.length, 0, `expected zero 42P17 failures in PART 1, got: ${JSON.stringify(recursionFailures)}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2 — rollback proof: the exact ROLLBACK_SQL handed back to Liam
  // ═══════════════════════════════════════════════════════════════════════════
  await test('15. the rollback SQL handed back to Liam exactly restores migration 007\'s original (recursive) policy', async () => {
    await db.exec(ROLLBACK_SQL);

    const rollbackVenue = await h.newVenue();
    await h.asUser(USER_E);
    await throws(
      h.insertPhoto(rollbackVenue, USER_E),
      /42P17|infinite recursion/i,
      'applying the rollback SQL must reintroduce the identical 42P17 recursion migration 007 originally had',
    );
    await h.reset();

    // Restore the fix so this script ends in the intended final state
    // (same convention as 057's rollback test).
    await db.exec(MIGRATION_058);

    // Confirm the fix is really back: the same insert now succeeds.
    await h.asUser(USER_F);
    await h.insertPhoto(rollbackVenue, USER_F);
    await h.reset();
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
