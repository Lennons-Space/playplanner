// =============================================================================
// supabase/tests/066_public_profiles_privileges.mjs
//
// Regression tests for:
//   066_restrict_public_profiles_privileges.sql
//
// WHY 066 EXISTS
// --------------
// Verification after 065 went live found that public.public_profiles still
// carried historical ALL privileges for the `authenticated` role. 065 granted
// SELECT on the view but never revoked what was already there, so `authenticated`
// retained INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on it. Production was
// corrected by hand; 066 is that exact correction captured as a migration so
// source control and production agree.
//
// These tests run in-process Postgres (pglite). NO live Supabase, NO production
// access, NO network.
//
// THE BASELINE IS THE BUG. The bootstrap deliberately reproduces the drifted
// state found in production (GRANT ALL on the view to authenticated) so that
// PART 0 fails-open BEFORE 066 and PART 1 proves 066 is what closes it. A
// fixture that started from the intended state would confirm the assumption
// rather than test it -- which is exactly how this class of defect reached
// production twice on this database.
//
// Run:  node supabase/tests/066_public_profiles_privileges.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readMigration = (f) => readFileSync(join(__dirname, '../migrations/', f), 'utf8');

// Applied from the REAL file -- never a paraphrase.
const MIGRATION_066 = readMigration('066_restrict_public_profiles_privileges.sql');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // show_in_search = true
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // show_in_search = false

// Every privilege has_table_privilege() understands for a relation.
const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

// -----------------------------------------------------------------------------
// Bootstrap: profiles + the 024 view + the DRIFTED grants found in production.
// -----------------------------------------------------------------------------
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  grant usage on schema auth to anon, authenticated, service_role;

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  -- 001:37-62 + 004:19-22 (only the columns these tests need to be faithful)
  create table public.profiles (
    id                      uuid primary key references auth.users(id) on delete cascade,
    username                text unique,
    full_name               text,
    avatar_url              text,
    bio                     text,
    is_business_owner       boolean default false,
    is_admin                boolean default false,
    children_ages           text[],
    postcode                text,
    stripe_customer_id      text unique,
    created_at              timestamptz default now(),
    show_in_search          boolean not null default false,
    show_reviews_publicly   boolean not null default true
  );
  alter table public.profiles enable row level security;

  -- 024:40-54 -- the view exactly as migration 024 defines it.
  create view public.public_profiles
    with (security_invoker = true, security_barrier = true)
  as
    select id, username, full_name, avatar_url, bio,
           is_business_owner, show_reviews_publicly, created_at
      from public.profiles
     where show_in_search = true;

  -- ===== THE DRIFT, reproduced =====
  -- This is the state production was actually in after 065: ALL privileges on
  -- the view held by authenticated, plus a stray anon grant.
  grant all privileges on public.public_profiles to authenticated;
  grant select, insert on public.public_profiles to anon;

  -- service_role's grant is separate and must SURVIVE 066.
  grant all privileges on public.public_profiles to service_role;

  -- ===== seed =====
  insert into auth.users (id, email) values
    ('${USER_A}','a@test'), ('${USER_B}','b@test');

  insert into public.profiles (id, username, full_name, children_ages, postcode,
                               stripe_customer_id, show_in_search)
    values ('${USER_A}','alice','Alice A', array['0-2'], 'SY13 1NX', 'cus_ALICE', true),
           ('${USER_B}','bob',  'Bob B',   array['6-8'], 'SW1A 1AA', 'cus_BOB',   false);
`;

// -----------------------------------------------------------------------------
// Tiny harness (same shape as 062/065 tests)
// -----------------------------------------------------------------------------
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (e) { failures.push({ name, message: e?.message ?? String(e) });
              console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function freshDb(...migrations) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const m of migrations) await db.exec(m);
  return db;
}

const priv = async (db, role, p) => {
  const r = await db.query(
    `select has_table_privilege($1, 'public.public_profiles', $2) as ok`, [role, p]);
  return r.rows[0].ok;
};

const viewOptions = async (db) => {
  const r = await db.query(`
    select coalesce(array_to_string(c.reloptions, ','), '') as opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'public_profiles'`);
  return r.rows[0].opts;
};

// A stable fingerprint of every profile row, used to prove 066 touches no data.
const profileFingerprint = async (db) => {
  const r = await db.query(`
    select md5(string_agg(t.row_text, '|' order by t.row_text)) as fp,
           count(*)::int as n
      from (select p::text as row_text from public.profiles p) t`);
  return { fp: r.rows[0].fp, n: r.rows[0].n };
};

// =============================================================================
// PART 0 -- the drifted baseline really is broken (the fixture tests, not assumes)
// =============================================================================
async function part0() {
  console.log('\nPART 0 -- BASELINE: the drift 066 exists to correct');
  const db = await freshDb(); // no 066

  await test('BASELINE: authenticated holds write privileges on the view (the defect)', async () => {
    for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      eq(await priv(db, 'authenticated', p), true,
        `baseline should hold ${p} -- if not, the fixture is not reproducing the drift`);
    }
  });

  await test('BASELINE: anon holds privileges on the view (the defect)', async () => {
    eq(await priv(db, 'anon', 'SELECT'), true, 'baseline anon SELECT');
    eq(await priv(db, 'anon', 'INSERT'), true, 'baseline anon INSERT');
  });

  await db.close();
}

// =============================================================================
// PART 1 -- 066 closes it, and closes ONLY it
// =============================================================================
async function part1() {
  console.log('\nPART 1 -- AFTER 066');
  const db = await freshDb();
  const before = await profileFingerprint(db);
  await db.exec(MIGRATION_066);

  await test('authenticated HAS SELECT on public_profiles', async () => {
    eq(await priv(db, 'authenticated', 'SELECT'), true, 'authenticated SELECT');
  });

  for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    await test(`authenticated does NOT have ${p} on public_profiles`, async () => {
      eq(await priv(db, 'authenticated', p), false, `authenticated ${p}`);
    });
  }

  await test('authenticated holds SELECT and nothing else (exhaustive)', async () => {
    const held = [];
    for (const p of ALL_PRIVS) if (await priv(db, 'authenticated', p)) held.push(p);
    eq(held.join(','), 'SELECT', 'exact privilege set for authenticated');
  });

  await test('anon has NO privileges on public_profiles (exhaustive)', async () => {
    const held = [];
    for (const p of ALL_PRIVS) if (await priv(db, 'anon', p)) held.push(p);
    eq(held.join(','), '', 'anon must hold nothing');
  });

  await test('PUBLIC has no privileges on public_profiles', async () => {
    const r = await db.query(`
      select coalesce(array_to_string(c.relacl, ','), '') as acl
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='public_profiles'`);
    // A PUBLIC grant appears as a leading "=" entry with no grantee name.
    const acl = r.rows[0].acl;
    assert(!/(^|,)=/.test(acl), `PUBLIC still holds privileges: ${acl}`);
  });

  await test('service_role is NOT revoked by 066', async () => {
    for (const p of ALL_PRIVS) {
      eq(await priv(db, 'service_role', p), true,
        `service_role must retain ${p} -- 066 must not touch server-side paths`);
    }
  });

  await test('view remains security_invoker = true', async () => {
    assert(/security_invoker=true/.test(await viewOptions(db)),
      `reloptions were ${await viewOptions(db)}`);
  });

  await test('view remains security_barrier = true', async () => {
    assert(/security_barrier=true/.test(await viewOptions(db)),
      `reloptions were ${await viewOptions(db)}`);
  });

  await test('no profile rows are modified by 066', async () => {
    const after = await profileFingerprint(db);
    eq(after.n, before.n, 'profile row count changed');
    eq(after.fp, before.fp, 'profile row contents changed');
  });

  await test('066 is idempotent -- re-applying changes nothing', async () => {
    const fpBefore = await profileFingerprint(db);
    await db.exec(MIGRATION_066);
    const held = [];
    for (const p of ALL_PRIVS) if (await priv(db, 'authenticated', p)) held.push(p);
    eq(held.join(','), 'SELECT', 'privilege set after second apply');
    eq((await profileFingerprint(db)).fp, fpBefore.fp, 'data changed on re-apply');
  });

  await db.close();
}

// =============================================================================
// PART 2 -- the view still WORKS, and still hides what it must
// =============================================================================
async function part2() {
  console.log('\nPART 2 -- the view still functions after 066');
  const db = await freshDb();
  await db.exec(MIGRATION_066);

  // The view is security_invoker, so profiles RLS applies as the caller. Give
  // the caller the same row access 065 grants, so this part tests 066 alone.
  await db.exec(`
    create policy "Public profiles are viewable" on public.profiles
      for select to authenticated using (show_in_search = true);
    grant select (id, username, full_name, avatar_url, bio,
                  is_business_owner, show_reviews_publicly, created_at,
                  show_in_search) on public.profiles to authenticated;
  `);

  await test('authenticated can still read the view (SELECT survives)', async () => {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', $1, false)`, [USER_A]);
    await db.exec('set role authenticated');
    const r = await db.query('select id, username from public.public_profiles order by username');
    await db.exec('reset role');
    eq(r.rows.length, 1, 'only the show_in_search = true profile should be visible');
    eq(r.rows[0].username, 'alice', 'wrong row returned');
  });

  await test('authenticated cannot write through the view', async () => {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', $1, false)`, [USER_A]);
    await db.exec('set role authenticated');
    let threw = false;
    try {
      await db.query(`update public.public_profiles set full_name = 'HACKED' where username = 'alice'`);
    } catch (e) {
      threw = /permission denied/i.test(e?.message ?? '');
    }
    await db.exec('reset role');
    assert(threw, 'UPDATE through the view should be denied');
  });

  await test('the view still exposes exactly its 8 intended columns', async () => {
    const r = await db.query(`
      select string_agg(column_name, ',' order by ordinal_position) as cols
        from information_schema.columns
       where table_schema='public' and table_name='public_profiles'`);
    eq(r.rows[0].cols,
      'id,username,full_name,avatar_url,bio,is_business_owner,show_reviews_publicly,created_at',
      'public_profiles column list drifted');
  });

  await db.close();
}

// =============================================================================
(async function main() {
  console.log('='.repeat(78));
  console.log('066_restrict_public_profiles_privileges.sql -- regression tests');
  console.log('='.repeat(78));

  await part0();
  await part1();
  await part2();

  console.log('\n' + '='.repeat(78));
  console.log(`PASSED: ${passed}   FAILED: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
  console.log('='.repeat(78));
})();
