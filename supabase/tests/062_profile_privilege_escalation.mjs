// =============================================================================
// supabase/tests/062_profile_privilege_escalation.mjs
//
// Behavioural database tests for migration 062 (PP-001 -- profile privilege
// escalation hotfix) using an in-process Postgres (pglite) -- NO live Supabase,
// NO production access, NO network.
//
// Loads a bootstrap that mirrors the REAL production shape of `profiles` at
// migration 058 (001's table + 004's three privacy columns, 001's
// touch_updated_at trigger, 001's is_admin(), 003's SELECT policy replacement,
// and 001's original UPDATE/DELETE policies), then applies the REAL migration
// file 062 from disk.
//
// Structure:
//   PART 0 -- REPRODUCTION: bootstrap only, no 062. Proves PP-001 is real:
//             an ordinary authenticated user sets is_admin = true on their own
//             row in one UPDATE, and is_admin() then returns true for them.
//   PART 1 -- FIX + full matrix: bootstrap + 062. Proves every privileged
//             column is refused, every user-editable column still works, the
//             trusted server paths still work, and updated_at is still
//             maintained despite not being granted.
//   PART 2 -- BACKSTOP ISOLATION: with 062 applied, deliberately re-grant
//             table-wide UPDATE (simulating a future accidental re-grant that
//             defeats LAYER 1) and prove the LAYER 2 trigger still blocks
//             escalation on its own. This is what makes it defence in depth
//             rather than two names for one control.
//   PART 3 -- ROLLBACK proof: apply the exact rollback SQL handed to Liam and
//             confirm it restores the ORIGINAL vulnerable behaviour byte-for-
//             byte (i.e. the rollback is a true restoration, not an
//             approximation). The fix is then re-applied so the script ends in
//             the intended final state (same convention as 057/058).
//
// Run:  node supabase/tests/062_profile_privilege_escalation.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_062 = readFileSync(
  join(__dirname, '../migrations/062_fix_profile_privilege_escalation.sql'),
  'utf8',
);

// The exact rollback SQL handed back to Liam (see the report). Kept as one
// literal string so PART 3 applies EXACTLY what he would paste, not a
// hand-retyped approximation.
const ROLLBACK_SQL = `
  BEGIN;

  DROP TRIGGER IF EXISTS profiles_enforce_privileged_columns ON public.profiles;
  DROP FUNCTION IF EXISTS public.enforce_profile_privileged_columns();

  GRANT UPDATE ON public.profiles TO authenticated;

  DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
  CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

  COMMIT;
`;

const ADMIN  = '00000000-0000-0000-0000-00000000000a';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Mirrors production's real `profiles` shape at migration 058: migration 001's
// CREATE TABLE (001:35-59) plus migration 004's three added columns
// (004:19-22), 001's touch_updated_at + profiles_updated_at trigger,
// 001's is_admin(), and the RLS policies as they actually stand at 058 --
// 003:64 replaced 001's SELECT policy; 001's UPDATE (426-427, the vulnerable
// one) and DELETE (432-433) policies were never replaced.
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  insert into auth.users (id) values ('${ADMIN}'), ('${USER_A}'), ('${USER_B}');

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  -- migration 001:35-59 + migration 004:19-22
  create table public.profiles (
    id                      uuid primary key references auth.users(id) on delete cascade,
    username                text unique,
    full_name               text,
    avatar_url              text,
    bio                     text,
    is_business_owner       boolean default false,
    is_admin                boolean default false,
    subscription_tier       text default 'free' check (subscription_tier in ('free', 'premium')),
    subscription_expires_at timestamptz,
    stripe_customer_id      text unique,
    children_ages           text[],
    marketing_consent       boolean default false,
    terms_accepted_at       timestamptz,
    created_at              timestamptz default now(),
    updated_at              timestamptz default now(),
    postcode                text,
    show_in_search          boolean not null default false,
    show_reviews_publicly   boolean not null default true
  );
  alter table public.profiles enable row level security;

  insert into public.profiles (id, is_admin, full_name)
    select id, (id = '${ADMIN}'), 'Initial Name' from auth.users;

  -- migration 001:319-331
  create or replace function public.touch_updated_at() returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$ language plpgsql;

  create trigger profiles_updated_at before update on public.profiles
    for each row execute function public.touch_updated_at();

  -- migration 001:396-403
  create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
  $$;

  -- RLS as it actually stands at 058:
  --   003:64 replaced 001's SELECT policy
  create policy "Users can view own profile" on public.profiles
    for select using (auth.uid() = id);
  --   001:426-427 -- the vulnerable UPDATE policy (no WITH CHECK)
  create policy "Users can update own profile" on public.profiles
    for update using (auth.uid() = id);
  --   001:432-433
  create policy "Users can delete own profile" on public.profiles
    for delete using (auth.uid() = id);
`;

// A stand-in for migration 027's review_venue_claim(): a SECURITY DEFINER
// function owned by the bootstrap superuser that legitimately writes a
// server-owned column. Proves trusted RPC writes survive the trigger.
const TRUSTED_RPC = `
  create or replace function public.grant_business_owner(p_user uuid)
  returns void language plpgsql security definer set search_path = public as $$
  begin
    update public.profiles set is_business_owner = true where id = p_user;
  end;
  $$;
  grant execute on function public.grant_business_owner(uuid) to authenticated;
`;

// -- Tiny assert harness (same shape as the 056/057/058 test files) ------------
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
    if (re && !re.test(m)) throw new Error(`${msg || 'wrong error'}: got "${m}"`);
    return;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

function makeHelpers(db) {
  const q = (sql, params) => db.query(sql, params);
  async function asUser(uid) {
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    await db.exec('set role authenticated');
  }
  async function asServiceRole() {
    await db.exec('reset role');
    await db.exec('set role service_role');
  }
  async function reset() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  }
  const isAdminOf = async (uid) => {
    await reset();
    const r = await q(`select is_admin from public.profiles where id = $1`, [uid]);
    return r.rows[0].is_admin;
  };
  return { q, asUser, asServiceRole, reset, isAdminOf };
}

// =============================================================================
// PART 0 -- REPRODUCTION (bootstrap only, migration 062 NOT applied)
// =============================================================================
async function part0() {
  console.log('\nPART 0 -- reproduction: PP-001 on the production schema as it stands at 058');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  const { q, asUser, reset, isAdminOf } = makeHelpers(db);

  await test('PP-001 REPRO: ordinary user escalates to admin in a single UPDATE', async () => {
    eq(await isAdminOf(USER_A), false, 'precondition: USER_A is not an admin');
    await asUser(USER_A);
    await q(`update public.profiles set is_admin = true where id = $1`, [USER_A]);
    eq(await isAdminOf(USER_A), true, 'USER_A should now (vulnerably) be an admin');
  });

  await test('PP-001 REPRO: is_admin() then returns true, unlocking the admin surface', async () => {
    await asUser(USER_A);
    const r = await q(`select public.is_admin() as v`);
    eq(r.rows[0].v, true, 'is_admin() should return true for the escalated user');
    await reset();
  });

  await test('PP-001 REPRO: payment state is equally writable (subscription_tier)', async () => {
    await asUser(USER_B);
    await q(`update public.profiles set subscription_tier = 'premium' where id = $1`, [USER_B]);
    await reset();
    const r = await q(`select subscription_tier from public.profiles where id = $1`, [USER_B]);
    eq(r.rows[0].subscription_tier, 'premium', 'USER_B granted themselves premium');
  });

  await db.close();
}

// =============================================================================
// PART 1 -- FIX + full matrix (bootstrap + migration 062)
// =============================================================================
async function part1() {
  console.log('\nPART 1 -- migration 062 applied: privileged columns refused, legitimate edits preserved');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(TRUSTED_RPC);
  await db.exec(MIGRATION_062);
  const { q, asUser, asServiceRole, reset, isAdminOf } = makeHelpers(db);

  // -- the actual PP-001 exploit, now blocked ---------------------------------
  await test('BLOCKED: is_admin false -> true (the PP-001 exploit)', async () => {
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set is_admin = true where id = $1`, [USER_A]),
      /permission denied|is_admin is server-owned/i,
      'escalation must be refused',
    );
    eq(await isAdminOf(USER_A), false, 'USER_A must still not be an admin');
  });

  await test('BLOCKED: is_admin true -> false (admin cannot be stripped by a client)', async () => {
    await asUser(ADMIN);
    await throws(
      q(`update public.profiles set is_admin = false where id = $1`, [ADMIN]),
      /permission denied|is_admin is server-owned/i,
      'de-escalation must also be refused',
    );
    eq(await isAdminOf(ADMIN), true, 'ADMIN must still be an admin');
  });

  for (const [col, value] of [
    ['subscription_tier', `'premium'`],
    ['subscription_expires_at', `now() + interval '10 years'`],
    ['stripe_customer_id', `'cus_attacker'`],
    ['is_business_owner', `true`],
    ['created_at', `now() - interval '5 years'`],
  ]) {
    await test(`BLOCKED: ${col} is server-owned`, async () => {
      await asUser(USER_A);
      await throws(
        q(`update public.profiles set ${col} = ${value} where id = $1`, [USER_A]),
        /permission denied|server-owned|immutable/i,
        `${col} must be refused`,
      );
    });
  }

  await test('BLOCKED: user cannot mutate their own row id', async () => {
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set id = $1 where id = $2`, [USER_B, USER_A]),
      /permission denied|immutable|row-level security/i,
      'id must be immutable',
    );
  });

  await test("BLOCKED: user cannot update another user's profile", async () => {
    await asUser(USER_A);
    const r = await q(`update public.profiles set full_name = 'Hacked' where id = $1`, [USER_B]);
    eq(r.affectedRows ?? 0, 0, 'RLS must match zero rows for another user');
    await reset();
    const check = await q(`select full_name from public.profiles where id = $1`, [USER_B]);
    assert(check.rows[0].full_name !== 'Hacked', "USER_B's name must be unchanged");
  });

  await test('BLOCKED: escalation attempt bundled with a legitimate edit fails atomically', async () => {
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set full_name = 'Legit', is_admin = true where id = $1`, [USER_A]),
      /permission denied|is_admin is server-owned/i,
      'mixed update must be refused',
    );
    await reset();
    const r = await q(`select full_name, is_admin from public.profiles where id = $1`, [USER_A]);
    assert(r.rows[0].full_name !== 'Legit', 'the legitimate half must NOT have been applied');
    eq(r.rows[0].is_admin, false, 'is_admin must be unchanged');
  });

  // -- legitimate user editing must still work --------------------------------
  await test('ALLOWED: every user-editable column still updates (useProfile path)', async () => {
    await asUser(USER_A);
    await q(
      `update public.profiles set
         username = 'liam_a', full_name = 'Liam A', bio = 'hello',
         avatar_url = 'https://example.test/a.png',
         children_ages = array['0-2','3-5'], postcode = 'SY13 1NX',
         show_in_search = true, show_reviews_publicly = false,
         marketing_consent = true
       where id = $1`,
      [USER_A],
    );
    await reset();
    const r = await q(
      `select username, full_name, bio, avatar_url, children_ages, postcode,
              show_in_search, show_reviews_publicly, marketing_consent
         from public.profiles where id = $1`, [USER_A]);
    const row = r.rows[0];
    eq(row.username, 'liam_a', 'username');
    eq(row.full_name, 'Liam A', 'full_name');
    eq(row.bio, 'hello', 'bio');
    eq(row.postcode, 'SY13 1NX', 'postcode');
    eq(row.show_in_search, true, 'show_in_search');
    eq(row.show_reviews_publicly, false, 'show_reviews_publicly');
    eq(row.marketing_consent, true, 'marketing_consent');
  });

  await test('ALLOWED: children_ages-only update (useProfile.ts:235 path)', async () => {
    await asUser(USER_A);
    await q(`update public.profiles set children_ages = array['6-8'] where id = $1`, [USER_A]);
    await reset();
    const r = await q(`select children_ages from public.profiles where id = $1`, [USER_A]);
    eq(r.rows[0].children_ages[0], '6-8', 'children_ages should be updated');
  });

  await test('ALLOWED: registration sets terms_accepted_at when NULL (register.tsx:225)', async () => {
    await asUser(USER_B);
    await q(`update public.profiles set terms_accepted_at = now() where id = $1`, [USER_B]);
    await reset();
    const r = await q(`select terms_accepted_at from public.profiles where id = $1`, [USER_B]);
    assert(r.rows[0].terms_accepted_at !== null, 'terms_accepted_at should be set');
  });

  await test('BLOCKED: consent evidence cannot be rewritten once set', async () => {
    await asUser(USER_B);
    await throws(
      q(`update public.profiles set terms_accepted_at = now() + interval '1 day' where id = $1`, [USER_B]),
      /consent evidence/i,
      'terms_accepted_at must be set-once',
    );
  });

  await test('ALLOWED: updated_at is still auto-maintained despite NOT being granted', async () => {
    await reset();
    const before = await q(`select updated_at from public.profiles where id = $1`, [USER_A]);
    await new Promise((r) => setTimeout(r, 15));
    await asUser(USER_A);
    await q(`update public.profiles set bio = 'second edit' where id = $1`, [USER_A]);
    await reset();
    const after = await q(`select updated_at from public.profiles where id = $1`, [USER_A]);
    assert(
      new Date(after.rows[0].updated_at) > new Date(before.rows[0].updated_at),
      'touch_updated_at must still fire even though authenticated has no UPDATE grant on updated_at',
    );
  });

  await test('BLOCKED: user cannot set updated_at directly', async () => {
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set updated_at = now() - interval '1 year' where id = $1`, [USER_A]),
      /permission denied/i,
      'updated_at must not be directly writable',
    );
  });

  // -- trusted server paths must still work -----------------------------------
  await test('ALLOWED: service_role can write every privileged column (Stripe webhook path)', async () => {
    await asServiceRole();
    await q(
      `update public.profiles
          set subscription_tier = 'premium',
              subscription_expires_at = now() + interval '1 year',
              stripe_customer_id = 'cus_legit_123'
        where id = $1`, [USER_A]);
    await reset();
    const r = await q(
      `select subscription_tier, stripe_customer_id from public.profiles where id = $1`, [USER_A]);
    eq(r.rows[0].subscription_tier, 'premium', 'webhook must still set subscription_tier');
    eq(r.rows[0].stripe_customer_id, 'cus_legit_123', 'webhook must still set stripe_customer_id');
  });

  await test('ALLOWED: service_role can still grant admin (legitimate admin management)', async () => {
    await asServiceRole();
    await q(`update public.profiles set is_admin = true where id = $1`, [USER_B]);
    eq(await isAdminOf(USER_B), true, 'service_role must be able to manage admins');
    await asServiceRole();
    await q(`update public.profiles set is_admin = false where id = $1`, [USER_B]);
    eq(await isAdminOf(USER_B), false, 'and revoke again');
  });

  await test('ALLOWED: SECURITY DEFINER RPC still writes is_business_owner (027 path)', async () => {
    await asUser(USER_A);
    await q(`select public.grant_business_owner($1)`, [USER_A]);
    await reset();
    const r = await q(`select is_business_owner from public.profiles where id = $1`, [USER_A]);
    eq(r.rows[0].is_business_owner, true, 'review_venue_claim-style RPC must still work');
  });

  // -- the grant surface itself ------------------------------------------------
  await test('GRANTS: authenticated holds UPDATE on exactly the 10 user-editable columns', async () => {
    await reset();
    const r = await q(`
      select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'profiles'
         and grantee = 'authenticated' and privilege_type = 'UPDATE'
       order by column_name`);
    const cols = r.rows.map((x) => x.column_name);
    const expected = ['avatar_url', 'bio', 'children_ages', 'full_name', 'marketing_consent',
      'postcode', 'show_in_search', 'show_reviews_publicly', 'terms_accepted_at', 'username'];
    eq(JSON.stringify(cols), JSON.stringify(expected), 'exact granted column set');
  });

  await test('GRANTS: authenticated retains SELECT and DELETE (deletion path intact)', async () => {
    await reset();
    const r = await q(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'profiles'
         and grantee = 'authenticated' order by privilege_type`);
    const p = r.rows.map((x) => x.privilege_type);
    assert(p.includes('SELECT'), 'SELECT must be retained');
    assert(p.includes('DELETE'), 'DELETE must be retained (delete_own_account / Art.17)');
    assert(!p.includes('UPDATE'), 'table-wide UPDATE must be gone');
  });

  // -- EXECUTE revokes on the trigger function ---------------------------------
  // Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on new functions DIRECTLY
  // to anon/authenticated, so revoking PUBLIC alone leaves them able to call it.
  // Production verification on 2026-08-16 caught exactly this. The bootstrap
  // above reproduces Supabase's default-privilege behaviour, so these tests fail
  // if the anon/authenticated revokes are ever dropped from the migration.
  await test('GRANTS: anon cannot EXECUTE enforce_profile_privileged_columns()', async () => {
    await reset();
    const r = await q(`select has_function_privilege('anon',
      'public.enforce_profile_privileged_columns()', 'EXECUTE') as can_exec`);
    eq(r.rows[0].can_exec, false, 'anon_can_execute must be false (matches production)');
  });

  await test('GRANTS: authenticated cannot EXECUTE enforce_profile_privileged_columns()', async () => {
    await reset();
    const r = await q(`select has_function_privilege('authenticated',
      'public.enforce_profile_privileged_columns()', 'EXECUTE') as can_exec`);
    eq(r.rows[0].can_exec, false, 'authenticated_can_execute must be false (matches production)');
  });

  await test('GRANTS: revoking EXECUTE does NOT stop the trigger firing', async () => {
    // The safety property that makes the revokes safe: PostgreSQL does not
    // consult EXECUTE privilege when firing a trigger. If this ever regressed,
    // the backstop would be silently dead while still appearing installed.
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set is_admin = true where id = $1`, [USER_A]),
      /permission denied|is_admin is server-owned/i,
      'enforcement must survive the EXECUTE revokes',
    );
    eq(await isAdminOf(USER_A), false, 'USER_A must still not be an admin');
  });

  await test('RLS: the UPDATE policy now has an explicit WITH CHECK', async () => {
    await reset();
    const r = await q(`
      select with_check, roles from pg_policies
       where schemaname = 'public' and tablename = 'profiles'
         and policyname = 'Users can update own profile'`);
    assert(r.rows.length === 1, 'policy should exist');
    assert(r.rows[0].with_check !== null, 'WITH CHECK must be present');
    assert(String(r.rows[0].roles).includes('authenticated'), 'policy should be scoped TO authenticated');
  });

  await db.close();
}

// =============================================================================
// PART 2 -- BACKSTOP ISOLATION: prove LAYER 2 works without LAYER 1
// =============================================================================
async function part2() {
  console.log('\nPART 2 -- defence in depth: trigger still blocks escalation if column grants are lost');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_062);
  const { q, asUser, reset, isAdminOf } = makeHelpers(db);

  // Simulate a future migration or operator accidentally restoring table-wide
  // UPDATE, which fully defeats LAYER 1.
  await db.exec(`grant update on public.profiles to authenticated;`);

  await test('LAYER 1 is genuinely defeated by the re-grant (control assertion)', async () => {
    await reset();
    const r = await q(`
      select privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name='profiles'
         and grantee='authenticated' and privilege_type='UPDATE'`);
    assert(r.rows.length === 1, 'table-wide UPDATE should now be back');
  });

  await test('LAYER 2 alone still blocks the PP-001 exploit', async () => {
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set is_admin = true where id = $1`, [USER_A]),
      /is_admin is server-owned/i,
      'the trigger must refuse escalation on its own',
    );
    eq(await isAdminOf(USER_A), false, 'USER_A must still not be an admin');
  });

  await test('LAYER 2 alone still allows legitimate edits', async () => {
    await asUser(USER_A);
    await q(`update public.profiles set full_name = 'Still Works' where id = $1`, [USER_A]);
    await reset();
    const r = await q(`select full_name from public.profiles where id = $1`, [USER_A]);
    eq(r.rows[0].full_name, 'Still Works', 'legitimate edit must still succeed');
  });

  await db.close();
}

// =============================================================================
// PART 3 -- ROLLBACK proof
// =============================================================================
async function part3() {
  console.log('\nPART 3 -- rollback restores the original (vulnerable) behaviour exactly');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_062);
  const { q, asUser, reset, isAdminOf } = makeHelpers(db);

  await test('pre-rollback: escalation is blocked', async () => {
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set is_admin = true where id = $1`, [USER_A]),
      /permission denied|is_admin is server-owned/i,
    );
  });

  await test('rollback SQL applies cleanly', async () => {
    await reset();
    await db.exec(ROLLBACK_SQL);
  });

  await test('post-rollback: the original PP-001 vulnerability is restored (proves fidelity)', async () => {
    await asUser(USER_A);
    await q(`update public.profiles set is_admin = true where id = $1`, [USER_A]);
    eq(await isAdminOf(USER_A), true, 'rollback must restore the exact original behaviour');
  });

  await test('re-apply 062: escalation blocked again, ending in the intended state', async () => {
    await reset();
    // Reset the escalation the rollback proof deliberately created.
    await q(`update public.profiles set is_admin = false where id = $1`, [USER_A]);
    await db.exec(MIGRATION_062);
    await asUser(USER_A);
    await throws(
      q(`update public.profiles set is_admin = true where id = $1`, [USER_A]),
      /permission denied|is_admin is server-owned/i,
    );
    eq(await isAdminOf(USER_A), false, 'final state must be secure');
  });

  await db.close();
}

// =============================================================================
const started = Date.now();
console.log('062_profile_privilege_escalation -- pglite behavioural tests (no live DB)');
await part0();
await part1();
await part2();
await part3();

console.log(`\n${passed} passed, ${failures.length} failed  (${Date.now() - started}ms)`);
if (failures.length) {
  for (const f of failures) console.log(`  FAILED: ${f.name}\n          ${f.message}`);
  process.exit(1);
}
