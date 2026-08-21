// =============================================================================
// supabase/tests/065_profile_read_exposure.mjs
//
// Behavioural database tests for the two-step profile read containment:
//   064_add_profile_self_read_rpcs.sql      (additive)
//   065_restrict_profile_read_exposure.sql  (restrictive)
// using in-process Postgres (pglite) -- NO live Supabase, NO production access.
//
//   PART 0 -- REPRODUCTION against the TRUE live baseline, verified read-only
//             against production 2026-08-18:
//               policy "Profiles are viewable by authenticated users"
//                 FOR SELECT USING (auth.uid() IS NOT NULL)
//               + table-level SELECT on profiles held by `authenticated`
//             062 IS applied (as in production); 003's own-row policy is NOT.
//   PART 1 -- ROLLOUT STATES 1-4. Proves there is no broken intermediate state.
//   PART 2 -- HOSTILE matrix after 065.
//   PART 3 -- THE BOUNDARY QUESTION, empirically: direct cross-user access to
//             the SAFE columns vs any SENSITIVE column.
//   PART 4 -- DATA EXPORT completeness + safety.
//   PART 5 -- LEGITIMATE flows after 065 (the regression surface).
//   PART 6 -- ROLLBACK fidelity, for each migration independently.
//
// FIDELITY NOTES (disclosed):
//   * The bootstrap reconstructs production's profiles/public_profiles state
//     from migrations 001/004/024 + the live policy set read back from
//     pg_policies. Migrations 062/064/065 are applied from their REAL files.
//   * PostgREST is absent, so its resource embedding is modelled as the
//     equivalent SQL join that PostgREST compiles to.
//
// Run:  node supabase/tests/065_profile_read_exposure.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readMigration = (f) => readFileSync(join(__dirname, '../migrations/', f), 'utf8');
const MIGRATION_062 = readMigration('062_fix_profile_privilege_escalation.sql');
const MIGRATION_064 = readMigration('064_add_profile_self_read_rpcs.sql');
const MIGRATION_065 = readMigration('065_restrict_profile_read_exposure.sql');

// Rollback SQL handed to Liam, kept literal so PART 6 applies exactly what he
// would paste. 065 and 064 roll back independently and in that order.
const ROLLBACK_065 = `
  BEGIN;

  DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
  DROP POLICY IF EXISTS "Public profiles are viewable" ON public.profiles;
  DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

  GRANT SELECT ON public.profiles TO authenticated;

  CREATE POLICY "Profiles are viewable by authenticated users" ON public.profiles
    for select using (auth.uid() is not null);

  COMMIT;
`;

const ROLLBACK_064 = `
  BEGIN;

  DROP FUNCTION IF EXISTS public.get_my_profile();
  DROP FUNCTION IF EXISTS public.get_my_profile_export();

  COMMIT;
`;

const ADMIN  = '00000000-0000-0000-0000-00000000000a';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';  // show_in_search = true
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';  // show_in_search = false
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';  // show_in_search = true

const SENSITIVE = [
  'children_ages', 'postcode', 'marketing_consent', 'terms_accepted_at',
  'stripe_customer_id', 'subscription_tier', 'subscription_expires_at', 'is_admin',
];

// The 8 columns public_profiles exposes, plus show_in_search (needed by the
// view's WHERE clause under security_invoker).
const SAFE = [
  'id', 'username', 'full_name', 'avatar_url', 'bio',
  'is_business_owner', 'show_reviews_publicly', 'created_at', 'show_in_search',
];

// What the OLD client does: a direct select of its own full profile row.
const LEGACY_OWN_PROFILE_SELECT = `
  select id, username, full_name, avatar_url, bio, is_business_owner, is_admin,
         subscription_tier, subscription_expires_at, children_ages,
         marketing_consent, postcode, show_in_search, show_reviews_publicly,
         terms_accepted_at, created_at, updated_at
    from public.profiles where id = $1`;

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;

  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  grant usage on schema auth to anon, authenticated, service_role;

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  -- 001:37-62 + 004:19-22
  create table public.profiles (
    id                      uuid primary key references auth.users(id) on delete cascade,
    username                text unique,
    full_name               text,
    avatar_url              text,
    bio                     text,
    is_business_owner       boolean default false,
    is_admin                boolean default false,
    subscription_tier       text default 'free' check (subscription_tier in ('free','premium')),
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
  grant select, insert, update, delete on public.profiles to anon, authenticated, service_role;

  create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
  $$;

  create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
  create trigger profiles_updated_at before update on public.profiles
    for each row execute function public.touch_updated_at();

  create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
    return new;
  end; $$;
  create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

  create or replace function public.delete_own_account() returns void
  language plpgsql security definer set search_path = public as $$
  begin
    delete from auth.users where id = auth.uid();
  end; $$;
  grant execute on function public.delete_own_account() to authenticated;

  create table public.reviews (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.profiles(id) on delete cascade,
    title text,
    moderation_status text default 'pending'
  );
  alter table public.reviews enable row level security;
  create policy "reviews readable" on public.reviews for select using (true);
  grant select on public.reviews to anon, authenticated;

  -- ===== THE LIVE POLICY SET (verified against production 2026-08-18) =====
  create policy "Profiles are viewable by authenticated users" on public.profiles
    for select using (auth.uid() is not null);
  create policy "Users can update own profile" on public.profiles
    for update using (auth.uid() = id);
  create policy "Users can delete own profile" on public.profiles
    for delete using (auth.uid() = id);

  -- 024:40-54
  create view public.public_profiles
    with (security_invoker = true, security_barrier = true)
  as
    select id, username, full_name, avatar_url, bio,
           is_business_owner, show_reviews_publicly, created_at
      from public.profiles
     where show_in_search = true;
  grant select on public.public_profiles to authenticated;
  revoke all on public.public_profiles from anon;

  -- ===== seed =====
  insert into auth.users (id, email) values
    ('${ADMIN}','admin@test'), ('${USER_A}','a@test'),
    ('${USER_B}','b@test'),    ('${USER_C}','c@test');

  update public.profiles set
    username='admin', full_name='Ada Admin', is_admin=true, show_in_search=false
   where id='${ADMIN}';

  update public.profiles set
    username='alice', full_name='Alice A', bio='hi', avatar_url='a.png',
    children_ages=array['0-2','3-5'], postcode='SY13 1NX',
    marketing_consent=true, terms_accepted_at=now(),
    subscription_tier='premium', subscription_expires_at=now()+interval '1 year',
    stripe_customer_id='cus_ALICE123', show_in_search=true
   where id='${USER_A}';

  update public.profiles set
    username='bob', full_name='Bob B',
    children_ages=array['6-8'], postcode='SW1A 1AA',
    marketing_consent=false, terms_accepted_at=now(),
    stripe_customer_id='cus_BOB456', show_in_search=false
   where id='${USER_B}';

  update public.profiles set
    username='cara', full_name='Cara C', show_in_search=true
   where id='${USER_C}';

  insert into public.reviews (user_id, title, moderation_status)
    values ('${USER_A}','Great soft play','approved'),
           ('${USER_B}','Hidden user review','pending');
`;

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
async function throws(promise, re, msg) {
  try { await promise; } catch (e) {
    const m = e?.message ?? String(e);
    if (re && !re.test(m)) throw new Error(`${msg || 'wrong error'}: got "${m}"`);
    return;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

function makeHelpers(db) {
  const q = (sql, params) => db.query(sql, params);
  async function asUser(uid) {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    await db.exec('set role authenticated');
  }
  async function asAnon() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role anon');
  }
  async function reset() {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  }
  return { q, asUser, asAnon, reset };
}

async function freshDb(...migrations) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const m of migrations) await db.exec(m);
  return db;
}

// =============================================================================
// PART 0 -- REPRODUCTION against the TRUE live baseline
// =============================================================================
async function part0() {
  console.log('\nPART 0 -- reproduction against the LIVE production baseline (062 applied)');
  const db = await freshDb(MIGRATION_062);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  await test('EXPOSED: an authenticated user reads ANOTHER user\'s ENTIRE profiles row', async () => {
    await asUser(USER_A);
    const r = await q(`select * from public.profiles where id = $1`, [USER_B]);
    await reset();
    eq(r.rows.length, 1, 'the whole row should (vulnerably) be readable');
    eq(r.rows[0].stripe_customer_id, 'cus_BOB456', 'including Stripe identifiers');
  });

  for (const col of SENSITIVE) {
    await test(`EXPOSED: cross-user read of ${col}`, async () => {
      await asUser(USER_A);
      const r = await q(`select ${col} from public.profiles where id = $1`, [USER_B]);
      await reset();
      eq(r.rows.length, 1, `${col} should (vulnerably) be readable cross-user`);
    });
  }

  await test('EXPOSED: children\'s ages + postcode of a HIDDEN user (show_in_search=false)', async () => {
    await asUser(USER_A);
    const r = await q(`select children_ages, postcode from public.profiles where id=$1`, [USER_B]);
    await reset();
    eq(JSON.stringify(r.rows[0].children_ages), JSON.stringify(['6-8']),
      'a user who opted OUT of search still leaks children\'s data');
    eq(r.rows[0].postcode, 'SW1A 1AA', 'and their home postcode');
  });

  await test('EXPOSED: the whole user base is enumerable in one query', async () => {
    await asUser(USER_A);
    const r = await q(`select count(*)::int c from public.profiles`);
    await reset();
    eq(r.rows[0].c, 4, 'every profile row is readable');
  });

  await test('CONTEXT: the public_profiles view itself is correctly hardened', async () => {
    await asUser(USER_A);
    const r = await q(`select * from public.public_profiles order by username`);
    await reset();
    eq(r.rows.length, 2, 'only opted-in users (alice, cara)');
    assert(!('children_ages' in r.rows[0]), 'the view never exposes children_ages');
  });

  await test('CONTEXT: anon is blocked by RLS today (but holds table SELECT)', async () => {
    await asAnon();
    const r = await q(`select count(*)::int c from public.profiles`);
    await reset();
    eq(r.rows[0].c, 0, 'the live policy requires auth.uid() IS NOT NULL');
  });

  // Pre-065 anon privilege baseline. No migration ever GRANTed anything on
  // profiles to anon -- these come from Supabase's ALTER DEFAULT PRIVILEGES.
  // 062 already removed UPDATE. INSERT and DELETE are still held, and are
  // inert only because there is NO INSERT policy and the DELETE policy needs
  // auth.uid() = id. That is protection by policy absence.
  await test('BASELINE: before 065, anon still holds SELECT, INSERT and DELETE on profiles', async () => {
    await reset();
    const r = await q(
      `select has_table_privilege('anon','public.profiles','SELECT') as sel,
              has_table_privilege('anon','public.profiles','INSERT') as ins,
              has_table_privilege('anon','public.profiles','UPDATE') as upd,
              has_table_privilege('anon','public.profiles','DELETE') as del`);
    eq(r.rows[0].sel, true,  'anon holds SELECT pre-065');
    eq(r.rows[0].ins, true,  'anon holds INSERT pre-065 -- latent');
    eq(r.rows[0].upd, false, '062 already removed UPDATE');
    eq(r.rows[0].del, true,  'anon holds DELETE pre-065 -- latent');
  });

  await test('BASELINE: there is NO INSERT policy on profiles (why anon INSERT is inert)', async () => {
    await reset();
    const r = await q(`select count(*)::int c from pg_policies
                        where schemaname='public' and tablename='profiles' and cmd='INSERT'`);
    eq(r.rows[0].c, 0, 'inserts are only ever made by the SECURITY DEFINER trigger');
  });

  await db.close();
}

// =============================================================================
// PART 1 -- ROLLOUT STATES. No broken intermediate state may exist.
// =============================================================================
async function part1() {
  console.log('\nPART 1 -- rollout states 1-4 (no broken intermediate state)');

  // --- STATE 1: current production DB + current client -----------------------
  {
    const db = await freshDb(MIGRATION_062);
    const { q, asUser, reset } = makeHelpers(db);

    await test('STATE 1 (live DB + OLD client): own-profile load works', async () => {
      await asUser(USER_A);
      const r = await q(LEGACY_OWN_PROFILE_SELECT, [USER_A]);
      await reset();
      eq(r.rows.length, 1);
      eq(r.rows[0].username, 'alice');
    });
    await db.close();
  }

  // --- STATE 2: DB after 064 only + current client ---------------------------
  {
    const db = await freshDb(MIGRATION_062, MIGRATION_064);
    const { q, asUser, reset } = makeHelpers(db);

    await test('STATE 2 (DB+064 + OLD client): legacy direct own-profile SELECT still works', async () => {
      await asUser(USER_A);
      const r = await q(LEGACY_OWN_PROFILE_SELECT, [USER_A]);
      await reset();
      eq(r.rows.length, 1, '064 must remove nothing');
      eq(r.rows[0].children_ages.length, 2);
    });

    await test('STATE 2: 064 changed no privilege -- authenticated still holds table SELECT', async () => {
      await reset();
      const r = await q(`select has_table_privilege('authenticated','public.profiles','SELECT') s`);
      eq(r.rows[0].s, true, '064 is purely additive');
    });

    await test('STATE 2: the broad policy is still present (untouched by 064)', async () => {
      await reset();
      const r = await q(`select count(*)::int c from pg_policies
                          where schemaname='public' and tablename='profiles'
                            and policyname='Profiles are viewable by authenticated users'`);
      eq(r.rows[0].c, 1);
    });
    await db.close();
  }

  // --- STATE 3: DB after 064 only + NEW client -------------------------------
  {
    const db = await freshDb(MIGRATION_062, MIGRATION_064);
    const { q, asUser, reset } = makeHelpers(db);

    await test('STATE 3 (DB+064 + NEW client): get_my_profile() works before 065', async () => {
      await asUser(USER_A);
      const r = await q(`select * from public.get_my_profile()`);
      await reset();
      eq(r.rows.length, 1);
      eq(r.rows[0].id, USER_A);
    });

    await test('STATE 3: get_my_profile_export() works before 065', async () => {
      await asUser(USER_A);
      const r = await q(`select stripe_customer_id from public.get_my_profile_export()`);
      await reset();
      eq(r.rows[0].stripe_customer_id, 'cus_ALICE123');
    });
    await db.close();
  }

  // --- STATE 4: DB after 064 + 065 + NEW client ------------------------------
  {
    const db = await freshDb(MIGRATION_062, MIGRATION_064, MIGRATION_065);
    const { q, asUser, reset } = makeHelpers(db);

    await test('STATE 4 (DB+064+065 + NEW client): own-profile load works', async () => {
      await asUser(USER_A);
      const r = await q(`select * from public.get_my_profile()`);
      await reset();
      eq(r.rows.length, 1);
      eq(r.rows[0].postcode, 'SY13 1NX');
    });

    await test('STATE 4: and the cross-user leak is closed', async () => {
      await asUser(USER_A);
      await throws(q(`select children_ages from public.profiles where id=$1`, [USER_B]),
        /permission denied/i);
      await reset();
    });

    // The documented hazard of the sequence, asserted rather than assumed:
    // after 065 an OLD client can no longer load a profile. This is why 065 is
    // applied only once a new build is live.
    await test('HAZARD CONFIRMED: after 065 the OLD client path fails (why 065 goes last)', async () => {
      await asUser(USER_A);
      await throws(q(LEGACY_OWN_PROFILE_SELECT, [USER_A]), /permission denied/i,
        'old builds must be retired before 065 is applied');
      await reset();
    });
    await db.close();
  }
}

// =============================================================================
// PART 2 -- HOSTILE matrix after 065
// =============================================================================
async function part2() {
  console.log('\nPART 2 -- hostile reads refused after 065');
  const db = await freshDb(MIGRATION_062, MIGRATION_064, MIGRATION_065);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  await test('BLOCKED: SELECT * on another user\'s profiles row', async () => {
    await asUser(USER_A);
    await throws(q(`select * from public.profiles where id = $1`, [USER_B]), /permission denied/i);
    await reset();
  });

  for (const col of SENSITIVE) {
    await test(`BLOCKED: cross-user read of ${col}`, async () => {
      await asUser(USER_A);
      await throws(q(`select ${col} from public.profiles where id = $1`, [USER_B]),
        /permission denied/i);
      await reset();
    });
  }

  await test('BLOCKED: sensitive columns unreadable even for the CALLER\'S OWN row', async () => {
    await asUser(USER_A);
    await throws(q(`select children_ages from public.profiles where id = $1`, [USER_A]),
      /permission denied/i);
    await reset();
  });

  await test('BLOCKED: hidden (show_in_search=false) users are refused by RLS', async () => {
    await asUser(USER_A);
    const r = await q(`select id, username, full_name from public.profiles where id = $1`, [USER_B]);
    await reset();
    eq(r.rows.length, 0, 'opted-out users must not be readable cross-user at all');
  });

  await test('BLOCKED: no enumeration -- only self + opted-in users are visible', async () => {
    await asUser(USER_A);
    const r = await q(`select id from public.profiles`);
    await reset();
    const ids = r.rows.map((x) => x.id).sort();
    eq(JSON.stringify(ids), JSON.stringify([USER_A, USER_C].sort()),
      'admin and the hidden user must not appear');
  });

  await test('BLOCKED: anon cannot SELECT profiles AT ALL (privilege layer, not just RLS)', async () => {
    await asAnon();
    await throws(q(`select id from public.profiles`), /permission denied/i);
    await reset();
  });

  await test('BLOCKED: anon cannot read the public_profiles view', async () => {
    await asAnon();
    await throws(q(`select id from public.public_profiles`), /permission denied/i);
    await reset();
  });

  await test('BLOCKED: anon cannot execute get_my_profile()', async () => {
    await asAnon();
    await throws(q(`select * from public.get_my_profile()`), /permission denied/i);
    await reset();
  });

  await test('BLOCKED: anon cannot execute get_my_profile_export()', async () => {
    await asAnon();
    await throws(q(`select * from public.get_my_profile_export()`), /permission denied/i);
    await reset();
  });

  await test('REGRESSION (062): privilege escalation via UPDATE is still blocked', async () => {
    await asUser(USER_A);
    await throws(q(`update public.profiles set is_admin = true where id = $1`, [USER_A]),
      /permission denied|not permitted|privileged/i);
    await reset();
  });

  // ---------------------------------------------------------------------------
  // ANON POSTURE: after 065, anon must hold ZERO privileges on profiles --
  // not merely be blocked by RLS. This is broader than SELECT and deliberate.
  // ---------------------------------------------------------------------------
  await test('ANON: holds ZERO table privileges on profiles (every privilege type)', async () => {
    await reset();
    const r = await q(
      `select has_table_privilege('anon','public.profiles','SELECT')     as sel,
              has_table_privilege('anon','public.profiles','INSERT')     as ins,
              has_table_privilege('anon','public.profiles','UPDATE')     as upd,
              has_table_privilege('anon','public.profiles','DELETE')     as del,
              has_table_privilege('anon','public.profiles','REFERENCES') as refs,
              has_table_privilege('anon','public.profiles','TRIGGER')    as trg,
              has_table_privilege('anon','public.profiles','TRUNCATE')   as trunc`);
    for (const [k, v] of Object.entries(r.rows[0])) {
      eq(v, false, `anon must not hold ${k.toUpperCase()} on profiles`);
    }
  });

  await test('ANON: information_schema shows no profiles grant of any kind', async () => {
    await reset();
    const r = await q(`select privilege_type from information_schema.table_privileges
                        where table_schema='public' and table_name='profiles' and grantee='anon'`);
    eq(r.rows.length, 0, 'anon must appear nowhere in the grant list');
  });

  await test('ANON: no column-level privilege survives either', async () => {
    await reset();
    const r = await q(
      `select count(*)::int c from information_schema.columns col
        where col.table_schema='public' and col.table_name='profiles'
          and (has_column_privilege('anon','public.profiles',col.column_name,'SELECT')
            or has_column_privilege('anon','public.profiles',col.column_name,'INSERT')
            or has_column_privilege('anon','public.profiles',col.column_name,'UPDATE'))`);
    eq(r.rows[0].c, 0, 'REVOKE ALL must leave no column-level residue');
  });

  await test('ANON: the latent INSERT/DELETE removed by 065 really are gone', async () => {
    await asAnon();
    await throws(q(`insert into public.profiles (id) values ('99999999-9999-9999-9999-999999999999')`),
      /permission denied/i, 'no longer relying on the absence of an INSERT policy');
    await throws(q(`delete from public.profiles where id = $1`, [USER_A]),
      /permission denied/i);
    await reset();
  });

  await db.close();
}

// =============================================================================
// PART 3 -- THE BOUNDARY, MEASURED. What is actually enforced?
// =============================================================================
async function part3() {
  console.log('\nPART 3 -- the boundary measured: direct safe-column vs sensitive-column access');
  const db = await freshDb(MIGRATION_062, MIGRATION_064, MIGRATION_065);
  const { q, asUser, reset } = makeHelpers(db);

  await test('MEASURED: direct cross-user query of ALL 9 safe columns on an opted-in user SUCCEEDS', async () => {
    await asUser(USER_A);
    const r = await q(`select ${SAFE.join(', ')} from public.profiles where id = $1`, [USER_C]);
    await reset();
    eq(r.rows.length, 1, 'this succeeds -- the view is not the only physical path');
    eq(r.rows[0].username, 'cara');
    eq(Object.keys(r.rows[0]).length, SAFE.length);
  });

  await test('MEASURED: ...and it returns EXACTLY what public_profiles already exposes', async () => {
    await asUser(USER_A);
    const direct = await q(
      `select id, username, full_name, avatar_url, bio, is_business_owner,
              show_reviews_publicly, created_at
         from public.profiles where id = $1`, [USER_C]);
    const view = await q(`select * from public.public_profiles where id = $1`, [USER_C]);
    await reset();
    eq(JSON.stringify(direct.rows[0]), JSON.stringify(view.rows[0]),
      'equivalent access path, not an escalation');
  });

  // Each sensitive column, added to an otherwise-safe query, must fail the whole
  // statement -- no partial row, no leaked subset.
  for (const col of ['postcode', 'children_ages', 'is_admin', 'stripe_customer_id']) {
    await test(`MEASURED: safe columns + ${col} fails ATOMICALLY (no partial row)`, async () => {
      await asUser(USER_A);
      await throws(
        q(`select ${SAFE.join(', ')}, ${col} from public.profiles where id = $1`, [USER_C]),
        /permission denied/i, `${col} must poison the whole statement`);
      await reset();
    });
  }

  await test('MEASURED: a sensitive column in a WHERE clause is refused too', async () => {
    await asUser(USER_A);
    await throws(q(`select id from public.profiles where postcode = 'SY13 1NX'`),
      /permission denied/i, 'no oracle via predicates');
    await reset();
  });

  await test('MEASURED: aggregate over a sensitive column is refused', async () => {
    await asUser(USER_A);
    await throws(q(`select count(children_ages)::int from public.profiles`),
      /permission denied/i);
    await reset();
  });

  await test('MEASURED: the safe-subset path still cannot reach a HIDDEN user', async () => {
    await asUser(USER_A);
    const r = await q(`select ${SAFE.join(', ')} from public.profiles where id = $1`, [USER_B]);
    await reset();
    eq(r.rows.length, 0, 'RLS still gates the rows');
  });

  await db.close();
}

// =============================================================================
// PART 4 -- DATA EXPORT completeness and safety
// =============================================================================
async function part4() {
  console.log('\nPART 4 -- data export: completeness and safety');
  const db = await freshDb(MIGRATION_062, MIGRATION_064, MIGRATION_065);
  const { q, asUser, asAnon, reset } = makeHelpers(db);

  await test('EXPORT COMPLETENESS: the RPC returns EVERY column of the profiles table', async () => {
    await reset();
    const tableCols = (await q(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='profiles'
        order by column_name`)).rows.map((r) => r.column_name);
    const rpcCols = (await q(
      `select p.proname, pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='get_my_profile_export'`)).rows[0].result;
    const missing = tableCols.filter((c) => !new RegExp(`\\b${c}\\b`).test(rpcCols));
    eq(JSON.stringify(missing), '[]',
      `export RPC omits profile columns: ${missing.join(', ')}`);
  });

  await test('EXPORT: includes stripe_customer_id (data held about the user)', async () => {
    await asUser(USER_A);
    const r = await q(`select stripe_customer_id from public.get_my_profile_export()`);
    await reset();
    eq(r.rows[0].stripe_customer_id, 'cus_ALICE123');
  });

  await test('EXPORT: includes subscription tier and expiry', async () => {
    await asUser(USER_A);
    const r = await q(`select subscription_tier, subscription_expires_at
                         from public.get_my_profile_export()`);
    await reset();
    eq(r.rows[0].subscription_tier, 'premium');
    assert(r.rows[0].subscription_expires_at !== null, 'expiry must be present');
  });

  await test('EXPORT: includes postcode, children_ages, marketing_consent, terms_accepted_at', async () => {
    await asUser(USER_A);
    const r = await q(`select postcode, children_ages, marketing_consent, terms_accepted_at
                         from public.get_my_profile_export()`);
    await reset();
    eq(r.rows[0].postcode, 'SY13 1NX');
    eq(JSON.stringify(r.rows[0].children_ages), JSON.stringify(['0-2','3-5']));
    eq(r.rows[0].marketing_consent, true);
    assert(r.rows[0].terms_accepted_at !== null);
  });

  await test('EXPORT: includes the account identifier', async () => {
    await asUser(USER_A);
    const r = await q(`select id from public.get_my_profile_export()`);
    await reset();
    eq(r.rows[0].id, USER_A);
  });

  await test('EXPORT SAFETY: the export RPC takes NO argument -- no UUID can be supplied', async () => {
    await reset();
    const r = await q(`select p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and p.proname='get_my_profile_export'`);
    eq(r.rows.length, 1, 'exactly one overload must exist');
    eq(r.rows[0].pronargs, 0, 'zero parameters');
  });

  await test('EXPORT SAFETY: passing another user\'s UUID is rejected (no such function)', async () => {
    await asUser(USER_A);
    await throws(q(`select * from public.get_my_profile_export($1)`, [USER_B]),
      /does not exist|function/i);
    await reset();
  });

  await test('EXPORT SAFETY: the RPC follows auth.uid(), returning the CALLER\'s row only', async () => {
    await asUser(USER_B);
    const r = await q(`select id, stripe_customer_id from public.get_my_profile_export()`);
    await reset();
    eq(r.rows[0].id, USER_B, 'must follow the caller');
    eq(r.rows[0].stripe_customer_id, 'cus_BOB456', 'and never another user\'s');
  });

  await test('EXPORT SAFETY: an unauthenticated caller gets NO row even if EXECUTE were held', async () => {
    // Belt and braces: anon is already refused EXECUTE (PART 2). With no
    // auth.uid() set, the predicate itself matches nothing.
    await reset();
    const r = await q(`select count(*)::int c from public.get_my_profile_export()`);
    eq(r.rows[0].c, 0, 'no auth.uid() => no row');
  });

  await test('LEAST PRIVILEGE: get_my_profile() does NOT return stripe_customer_id', async () => {
    await asUser(USER_A);
    const r = await q(`select * from public.get_my_profile()`);
    await reset();
    assert(!('stripe_customer_id' in r.rows[0]),
      'payment identifiers must not enter ordinary app state');
  });

  await test('LEAST PRIVILEGE: the two RPCs differ ONLY by stripe_customer_id', async () => {
    await reset();
    const rows = (await q(
      `select p.proname, pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('get_my_profile','get_my_profile_export')`)).rows;
    const cols = (name) => {
      const src = rows.find((r) => r.proname === name).result;
      return (src.match(/\b[a-z_]+\b(?=\s+(uuid|text|boolean|timestamp))/g) || []).sort();
    };
    const only = cols('get_my_profile_export').filter((c) => !cols('get_my_profile').includes(c));
    eq(JSON.stringify(only), JSON.stringify(['stripe_customer_id']),
      'the export superset must be exactly one column wider');
  });

  await test('BOTH RPCs: SECURITY DEFINER with a locked search_path', async () => {
    await reset();
    const r = await q(
      `select p.proname, p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('get_my_profile','get_my_profile_export')
        order by p.proname`);
    eq(r.rows.length, 2);
    for (const row of r.rows) {
      eq(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
      assert((row.proconfig || []).some((c) => /^search_path=/.test(c)),
        `${row.proname} must pin search_path`);
    }
  });

  await test('BOTH RPCs: EXECUTE granted to authenticated only', async () => {
    await reset();
    const r = await q(
      `select p.proname,
              has_function_privilege('anon',          p.oid,'EXECUTE') as anon_exec,
              has_function_privilege('authenticated', p.oid,'EXECUTE') as auth_exec
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('get_my_profile','get_my_profile_export')
        order by p.proname`);
    for (const row of r.rows) {
      eq(row.anon_exec, false, `${row.proname}: anon must not execute`);
      eq(row.auth_exec, true,  `${row.proname}: authenticated must execute`);
    }
  });

  await db.close();
}

// =============================================================================
// PART 5 -- LEGITIMATE flows after 065
// =============================================================================
async function part5() {
  console.log('\nPART 5 -- legitimate flows preserved after 065');
  const db = await freshDb(MIGRATION_062, MIGRATION_064, MIGRATION_065);
  const { q, asUser, reset } = makeHelpers(db);

  await test('ALLOWED: own full profile via get_my_profile()', async () => {
    await asUser(USER_A);
    const r = await q(`select * from public.get_my_profile()`);
    await reset();
    eq(r.rows.length, 1);
    eq(r.rows[0].id, USER_A);
    eq(JSON.stringify(r.rows[0].children_ages), JSON.stringify(['0-2','3-5']));
    eq(r.rows[0].postcode, 'SY13 1NX');
    eq(r.rows[0].subscription_tier, 'premium');
    eq(r.rows[0].is_admin, false);
  });

  await test('ALLOWED: profile editing still works (062 grants intact)', async () => {
    await asUser(USER_A);
    await q(`update public.profiles
                set full_name='Alice Updated', bio='new bio', children_ages=array['3-5'],
                    postcode='SY13 2AA', marketing_consent=false, show_in_search=true
              where id=$1`, [USER_A]);
    const r = await q(`select full_name, children_ages, marketing_consent from public.get_my_profile()`);
    await reset();
    eq(r.rows[0].full_name, 'Alice Updated');
    eq(JSON.stringify(r.rows[0].children_ages), JSON.stringify(['3-5']));
    eq(r.rows[0].marketing_consent, false);
  });

  await test('ALLOWED: children-ages setting round-trips', async () => {
    await asUser(USER_B);
    await q(`update public.profiles set children_ages=array['9-11'] where id=$1`, [USER_B]);
    const r = await q(`select children_ages from public.get_my_profile()`);
    await reset();
    eq(JSON.stringify(r.rows[0].children_ages), JSON.stringify(['9-11']));
  });

  await test('ALLOWED: public_profiles still exposes opted-in users cross-user', async () => {
    await asUser(USER_B);
    const r = await q(`select username from public.public_profiles order by username`);
    await reset();
    eq(JSON.stringify(r.rows.map((x) => x.username)), JSON.stringify(['alice','cara']));
  });

  await test('ALLOWED: public_profiles exposes ONLY its 8 intended safe columns', async () => {
    await asUser(USER_A);
    const r = await q(`select * from public.public_profiles limit 1`);
    await reset();
    eq(JSON.stringify(Object.keys(r.rows[0]).sort()), JSON.stringify([
      'avatar_url','bio','created_at','full_name','id','is_business_owner',
      'show_reviews_publicly','username',
    ]));
  });

  await test('ALLOWED: hidden users stay hidden in public_profiles', async () => {
    await asUser(USER_A);
    const r = await q(`select count(*)::int c from public.public_profiles where id in ($1,$2)`,
                      [USER_B, ADMIN]);
    await reset();
    eq(r.rows[0].c, 0);
  });

  await test('ALLOWED: the view keeps security_invoker=true AND security_barrier=true', async () => {
    await reset();
    const r = await q(`select c.reloptions from pg_class c
                        join pg_namespace n on n.oid=c.relnamespace
                       where n.nspname='public' and c.relname='public_profiles'`);
    const opts = (r.rows[0].reloptions || []).join(',');
    assert(/security_invoker=true/.test(opts), `security_invoker missing: ${opts}`);
    assert(/security_barrier=true/.test(opts), `security_barrier missing: ${opts}`);
  });

  await test('ALLOWED: reviewer display join (useReviews.ts) still resolves', async () => {
    await asUser(USER_C);
    const r = await q(`select r.title, p.username from public.reviews r
                         join public.public_profiles p on p.id = r.user_id
                        where r.moderation_status='approved'`);
    await reset();
    eq(r.rows.length, 1);
    eq(r.rows[0].username, 'alice');
  });

  await test('ALLOWED: admin moderation attribution works, INCLUDING hidden users', async () => {
    await asUser(ADMIN);
    const r = await q(`select p.username, p.full_name from public.reviews r
                         join public.profiles p on p.id = r.user_id
                        where r.moderation_status='pending'`);
    await reset();
    eq(r.rows.length, 1);
    eq(r.rows[0].username, 'bob');
  });

  await test('ALLOWED: admin sees every profile ROW...', async () => {
    await asUser(ADMIN);
    const r = await q(`select count(*)::int c from public.profiles`);
    await reset();
    eq(r.rows[0].c, 4);
  });

  await test('...but admin still CANNOT read sensitive COLUMNS through the table', async () => {
    await asUser(ADMIN);
    await throws(q(`select children_ages from public.profiles where id=$1`, [USER_B]),
      /permission denied/i);
    await reset();
  });

  await test('ALLOWED: registration still provisions a profile row', async () => {
    await reset();
    const NEW = '11111111-2222-3333-4444-555555555555';
    await q(`insert into auth.users (id, email) values ($1,'new@test')`, [NEW]);
    const r = await q(`select count(*)::int c from public.profiles where id=$1`, [NEW]);
    eq(r.rows[0].c, 1, 'handle_new_user trigger must still fire');
  });

  // Registration must not depend on anon holding anything. Asserting the anon
  // privilege set is empty AT THE MOMENT the sign-up happens is the point:
  // handle_new_user() is SECURITY DEFINER, so it runs as its owner.
  await test('ALLOWED: registration succeeds while anon holds ZERO profiles privileges', async () => {
    await reset();
    const priv = await q(
      `select count(*)::int c from information_schema.table_privileges
        where table_schema='public' and table_name='profiles' and grantee='anon'`);
    eq(priv.rows[0].c, 0, 'precondition: anon has nothing');

    const NEW2 = '22222222-3333-4444-5555-666666666666';
    await q(`insert into auth.users (id, email) values ($1,'new2@test')`, [NEW2]);
    const r = await q(`select count(*)::int c from public.profiles where id=$1`, [NEW2]);
    eq(r.rows[0].c, 1, 'the trusted trigger context is what creates the row');
  });

  await test('ALLOWED: handle_new_user is SECURITY DEFINER (why the above holds)', async () => {
    await reset();
    const r = await q(`select p.prosecdef from pg_proc p
                         join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and p.proname='handle_new_user'`);
    eq(r.rows[0].prosecdef, true, 'must run as owner, not as the caller');
  });

  await test('REGRESSION (062): authenticated UPDATE column grants are EXACTLY intact', async () => {
    await reset();
    const r = await q(
      `select string_agg(c.column_name, ',' order by c.column_name) as cols
         from information_schema.columns c
        where c.table_schema='public' and c.table_name='profiles'
          and has_column_privilege('authenticated','public.profiles', c.column_name,'UPDATE')`);
    eq(r.rows[0].cols,
      'avatar_url,bio,children_ages,full_name,marketing_consent,postcode,' +
      'show_in_search,show_reviews_publicly,terms_accepted_at,username',
      '065 must not disturb 062\'s UPDATE column set');
  });

  await test('ALLOWED: registration still records terms_accepted_at', async () => {
    const NEW = '11111111-2222-3333-4444-555555555555';
    await asUser(NEW);
    await q(`update public.profiles set terms_accepted_at = now() where id=$1`, [NEW]);
    const r = await q(`select terms_accepted_at from public.get_my_profile()`);
    await reset();
    assert(r.rows[0].terms_accepted_at !== null);
  });

  await test('ALLOWED: account deletion (GDPR Art.17) still works', async () => {
    await asUser(USER_C);
    await q(`select public.delete_own_account()`);
    await reset();
    const r = await q(`select count(*)::int c from public.profiles where id=$1`, [USER_C]);
    eq(r.rows[0].c, 0);
  });

  await test('ALLOWED: service_role retains full access (server/import paths)', async () => {
    await reset();
    await db.exec('set role service_role');
    const r = await q(`select stripe_customer_id from public.profiles where id=$1`, [USER_A]);
    await reset();
    eq(r.rows[0].stripe_customer_id, 'cus_ALICE123');
  });

  await test('NO 42P17: the admin policy does not recurse into profiles RLS', async () => {
    await asUser(ADMIN);
    const r = await q(`select count(*)::int c from public.profiles`);
    await reset();
    assert(r.rows[0].c >= 1, 'is_admin() is SECURITY DEFINER, so no recursion');
  });

  await db.close();
}

// =============================================================================
// PART 6 -- ROLLBACK fidelity, per migration
// =============================================================================
async function part6() {
  console.log('\nPART 6 -- rollback fidelity (065 and 064 roll back independently)');
  const db = await freshDb(MIGRATION_062, MIGRATION_064, MIGRATION_065);
  const { q, asUser, reset } = makeHelpers(db);

  await test('pre-rollback: cross-user read blocked', async () => {
    await asUser(USER_A);
    await throws(q(`select children_ages from public.profiles where id=$1`, [USER_B]),
      /permission denied/i);
    await reset();
  });

  await test('065 rollback applies cleanly', async () => {
    await reset();
    await db.exec(ROLLBACK_065);
  });

  await test('post-065-rollback: previous behaviour restored, and the RPCs SURVIVE', async () => {
    await asUser(USER_A);
    const leak = await q(`select children_ages from public.profiles where id=$1`, [USER_B]);
    eq(JSON.stringify(leak.rows[0].children_ages), JSON.stringify(['6-8']),
      'rollback restores exactly what was there before');
    const rpc = await q(`select id from public.get_my_profile()`);
    await reset();
    eq(rpc.rows[0].id, USER_A, 'a new client keeps working after a 065-only rollback');
  });

  await test('post-065-rollback: 062 is still in force (rollback is scoped)', async () => {
    await asUser(USER_A);
    await throws(q(`update public.profiles set is_admin=true where id=$1`, [USER_A]),
      /permission denied|not permitted|privileged/i);
    await reset();
  });

  // DELIBERATE ASYMMETRY, asserted so it can never be mistaken for an omission.
  // The rollback is FUNCTIONAL (it restores authenticated client profile
  // loading), not a byte-for-byte privilege-state restore. anon's pre-065
  // SELECT/INSERT/DELETE are NOT given back, because anon needs none of them
  // and handing latent write privileges back to an unauthenticated role to
  // achieve rollback symmetry would be a worse outcome than the asymmetry.
  await test('post-065-rollback: anon deliberately stays at ZERO privileges', async () => {
    await reset();
    const r = await q(
      `select has_table_privilege('anon','public.profiles','SELECT') as sel,
              has_table_privilege('anon','public.profiles','INSERT') as ins,
              has_table_privilege('anon','public.profiles','DELETE') as del`);
    eq(r.rows[0].sel, false, 'not restored, by design');
    eq(r.rows[0].ins, false, 'not restored, by design');
    eq(r.rows[0].del, false, 'not restored, by design');
  });

  await test('post-065-rollback: PUBLIC is also deliberately not re-granted', async () => {
    await reset();
    const r = await q(`select has_table_privilege('public','public.profiles','SELECT') as sel`);
    eq(r.rows[0].sel, false, 'PUBLIC never held it via Supabase defaults; not restored');
  });

  await test('post-065-rollback: registration still works with anon at zero', async () => {
    await reset();
    const NEW3 = '33333333-4444-5555-6666-777777777777';
    await q(`insert into auth.users (id, email) values ($1,'new3@test')`, [NEW3]);
    const r = await q(`select count(*)::int c from public.profiles where id=$1`, [NEW3]);
    eq(r.rows[0].c, 1, 'the asymmetric rollback breaks nothing');
  });

  await test('064 rollback applies cleanly and removes both RPCs', async () => {
    await reset();
    await db.exec(ROLLBACK_064);
    const r = await q(`select count(*)::int c from pg_proc p
                         join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public'
                          and p.proname in ('get_my_profile','get_my_profile_export')`);
    eq(r.rows[0].c, 0);
  });

  await test('post-full-rollback: the original legacy client path works again', async () => {
    await asUser(USER_A);
    const r = await q(LEGACY_OWN_PROFILE_SELECT, [USER_A]);
    await reset();
    eq(r.rows.length, 1, 'we are back to the pre-064 baseline exactly');
  });

  await test('re-apply 064+065: contained again, ending in the intended secure state', async () => {
    await reset();
    await db.exec(MIGRATION_064);
    await db.exec(MIGRATION_065);
    await asUser(USER_A);
    await throws(q(`select children_ages from public.profiles where id=$1`, [USER_B]),
      /permission denied/i);
    const own = await q(`select id from public.get_my_profile()`);
    await reset();
    eq(own.rows[0].id, USER_A);
  });

  await db.close();
}

// =============================================================================
const started = Date.now();
console.log('065_profile_read_exposure -- pglite behavioural tests (no live DB)');
await part0();
await part1();
await part2();
await part3();
await part4();
await part5();
await part6();

console.log(`\n${passed} passed, ${failures.length} failed  (${Date.now() - started}ms)`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
