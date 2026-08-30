// =============================================================================
// supabase/tests/20260830102402_privilege_hardening.mjs
//
// Behavioural database tests for the non-DML API privilege hardening, using
// in-process Postgres (pglite). NO live Supabase, NO production access.
//
// PART 0 reproduces the pre-fix weakness against a fixture that mirrors the live
// audit: Supabase-style ALTER DEFAULT PRIVILEGES granting the full table
// privilege set to anon/authenticated/service_role, so every table carries
// TRUNCATE / REFERENCES / TRIGGER / MAINTAIN. Those tests PASS only while the
// weakness is real, which is what makes the rest of the file meaningful.
//
// Structure:
//   PART 0 -- PRE-FIX: the four privileges are held, and RLS does not stop TRUNCATE
//   PART 1 -- POST-FIX: the four are gone for anon/authenticated, kept for service_role
//   PART 2 -- nothing else moved: column grants, PP-011, and ordinary DML
//   PART 3 -- FUTURE tables created after the migration fail safe
//   PART 4 -- function changes: trigger helpers and user_review_count_today
//   PART 5 -- CREATE TRIGGER is no longer possible for an API role
//   PART 6 -- default-privilege regression guard (runtime + source)
//   PART 7 -- idempotency, rollback fidelity, re-apply
//
// FIDELITY NOTES (disclosed, not hidden):
//   * pglite 0.5.3 is PostgreSQL 18.3; production is 17.6. MAINTAIN exists in
//     both (PG17+), so the version guard in the migration is exercised on its
//     TRUE branch here. The guard's false branch is reasoned, not executed.
//   * pglite has no PostGIS, so `location geography(Point,4326)` is modelled as
//     text and set_venue_location() writes a text value -- the same concession
//     migrations 063 and PP-011's suites make. Nothing under test here depends
//     on the geometry type.
//   * pglite is a single in-process backend; no test here claims anything about
//     multi-connection contention.
//
// Run:  node supabase/tests/20260830102402_privilege_hardening.mjs
//       (part of npm run test:db:security)
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../migrations');
const MIGRATION_PATH = join(MIG_DIR, '20260830102402_revoke_non_dml_api_privileges.sql');
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8');
const MIGRATION_PP011 = readFileSync(
  join(MIG_DIR, '20260829205506_venue_owner_update_boundary.sql'),
  'utf8',
);

// The rollback is extracted from the migration's own documented block, so the
// SQL tested is provably the SQL shipped. Throws if the block is removed.
function extractRollback(sql) {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) => l.trim() === '--   BEGIN;');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '--   COMMIT;');
  if (start < 0 || end < 0) throw new Error('documented ROLLBACK block not found in the migration');
  return lines.slice(start, end + 1).map((l) => l.replace(/^--\s?/, '')).join('\n');
}
const ROLLBACK = extractRollback(MIGRATION);

const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const FOUR = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const TRIGGER_HELPERS = [
  'public.set_venue_location()',
  'public.touch_updated_at()',
  'public.update_push_token_updated_at()',
  'public.mirror_facility_stats_to_venue_facilities()',
  'public.recompute_facility_stats()',
];

// ── Pre-fix baseline: mirrors the live audit ─────────────────────────────────
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;

  create schema private;
  revoke all on schema private from public;
  revoke all on schema private from anon;
  grant usage on schema private to authenticated;
  create or replace function private.current_uid() returns uuid
  language sql security definer stable set search_path = '' as $$ select auth.uid() $$;
  revoke execute on function private.current_uid() from public;
  grant execute on function private.current_uid() to authenticated;

  -- Supabase's ALTER DEFAULT PRIVILEGES: the source of the whole problem.
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;

  -- Mirrors migration 062: these are the ONLY columns authenticated may UPDATE.
  create table profiles (
    id uuid primary key,
    is_admin boolean default false,
    is_business_owner boolean default false,
    username text, full_name text, bio text, avatar_url text,
    children_ages int[], postcode text,
    show_in_search boolean default true, show_reviews_publicly boolean default true,
    marketing_consent boolean default false, terms_accepted_at timestamptz,
    updated_at timestamptz default now());

  create or replace function is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce((select is_admin from profiles where id = auth.uid()), false);
  $$;

  create table venues (
    id uuid primary key default gen_random_uuid(),
    name text not null, slug text unique, description text,
    category_id uuid, address_line1 text, address_line2 text,
    city text not null, postcode text, country text default 'GB',
    latitude decimal(9,6) not null, longitude decimal(9,6) not null,
    location text,
    phone text, email text, website text,
    price_range text, min_age int default 0, max_age int default 12,
    is_published boolean default false, is_verified boolean default false,
    claimed_by uuid references profiles(id), submitted_by uuid references profiles(id),
    moderation_status text default 'pending', moderation_notes text,
    moderated_by uuid references profiles(id), moderated_at timestamptz,
    is_premium boolean default false, featured_until timestamptz,
    review_count int default 0, average_rating decimal(3,2) default 0,
    data_source text default 'manual', license text, osm_id text unique,
    discovery_approved boolean not null default true,
    image_url text, image_attribution text,
    created_at timestamptz default now(), updated_at timestamptz default now());

  create table reviews (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    user_id uuid references profiles(id),
    rating int not null, body text,
    moderation_status text default 'pending',
    created_at timestamptz default now(), updated_at timestamptz default now());

  create table favourites (
    user_id uuid references profiles(id), venue_id uuid references venues(id),
    primary key (user_id, venue_id));

  create table venue_photos (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    uploaded_by uuid references profiles(id),
    status text default 'pending');

  create table push_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references profiles(id), token text,
    updated_at timestamptz default now());

  create table venue_facility_votes (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    user_id uuid references profiles(id),
    facility_slug text, has_it boolean,
    unique (venue_id, user_id, facility_slug));

  create table venue_facility_stats (
    venue_id uuid references venues(id) on delete cascade,
    facility_slug text, yes_votes int default 0, no_votes int default 0,
    primary key (venue_id, facility_slug));

  -- Migration 057: append-only enrichment ledger. INSERT/UPDATE/DELETE are
  -- revoked from EVERY role including service_role -- writes happen only via
  -- SECURITY DEFINER _enrichment_apply_write running as the function owner.
  create table venue_enrichment_writes (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id), field text, applied_mode text,
    created_at timestamptz default now());

  create table venue_facilities (
    venue_id uuid references venues(id) on delete cascade,
    facility_slug text, primary key (venue_id, facility_slug));

  -- ── trigger helper functions, exactly as production defines them ──────────
  create or replace function public.set_venue_location() returns trigger
  language plpgsql set search_path = extensions, public as $$
  begin new.location = '(' || new.longitude || ',' || new.latitude || ')'; return new; end $$;
  create trigger venue_location_trigger before insert or update of latitude, longitude
    on venues for each row execute function public.set_venue_location();

  create or replace function public.touch_updated_at() returns trigger
  language plpgsql set search_path = extensions, public as $$
  begin new.updated_at = now(); return new; end $$;
  create trigger venues_updated_at before update on venues
    for each row execute function public.touch_updated_at();
  create trigger profiles_updated_at before update on profiles
    for each row execute function public.touch_updated_at();
  create trigger reviews_updated_at before update on reviews
    for each row execute function public.touch_updated_at();

  create or replace function public.update_push_token_updated_at() returns trigger
  language plpgsql set search_path = extensions, public as $$
  begin new.updated_at = now(); return new; end $$;
  create trigger push_tokens_updated_at before update on push_tokens
    for each row execute function public.update_push_token_updated_at();

  create or replace function public.recompute_facility_stats() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare v_venue uuid; v_slug text;
  begin
    v_venue := coalesce(new.venue_id, old.venue_id);
    v_slug  := coalesce(new.facility_slug, old.facility_slug);
    insert into venue_facility_stats (venue_id, facility_slug, yes_votes, no_votes)
    select v_venue, v_slug,
           count(*) filter (where has_it), count(*) filter (where not has_it)
      from venue_facility_votes where venue_id = v_venue and facility_slug = v_slug
    on conflict (venue_id, facility_slug) do update
       set yes_votes = excluded.yes_votes, no_votes = excluded.no_votes;
    return coalesce(new, old);
  end $$;
  revoke execute on function public.recompute_facility_stats() from public;
  create trigger facility_votes_recompute after insert or update or delete
    on venue_facility_votes for each row execute function public.recompute_facility_stats();

  create or replace function public.mirror_facility_stats_to_venue_facilities() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
  begin
    if new.yes_votes > new.no_votes then
      insert into venue_facilities (venue_id, facility_slug)
      values (new.venue_id, new.facility_slug) on conflict do nothing;
    end if;
    return new;
  end $$;
  revoke execute on function public.mirror_facility_stats_to_venue_facilities() from public;
  create trigger facility_stats_mirror after insert or update
    on venue_facility_stats for each row execute function public.mirror_facility_stats_to_venue_facilities();

  create or replace function public.update_venue_rating() returns trigger
  language plpgsql set search_path = public as $$
  begin
    update venues set review_count = (select count(*) from reviews
                                       where venue_id = coalesce(new.venue_id, old.venue_id)
                                         and moderation_status='approved'),
                      updated_at = now()
     where id = coalesce(new.venue_id, old.venue_id);
    return coalesce(new, old);
  end $$;
  create trigger review_rating_trigger after insert or update or delete on reviews
    for each row execute function public.update_venue_rating();

  -- ── 054: the review rate-cap helper, with PUBLIC EXECUTE as live ──────────
  create or replace function public.user_review_count_today() returns bigint
  language sql security definer stable set search_path = public as $$
    select count(*) from public.reviews
     where user_id = auth.uid() and created_at > now() - interval '24 hours';
  $$;

  -- ── RLS + policies ────────────────────────────────────────────────────────
  alter table profiles              enable row level security;
  alter table venues                enable row level security;
  alter table reviews               enable row level security;
  alter table favourites            enable row level security;
  alter table venue_photos          enable row level security;
  alter table push_tokens           enable row level security;
  alter table venue_facility_votes  enable row level security;
  alter table venue_facility_stats  enable row level security;
  alter table venue_facilities      enable row level security;

  create policy "Approved venues are public" on venues
    for select using (is_published = true and moderation_status = 'approved');
  create policy "Owners can view own venues" on venues
    for select using (auth.uid() = submitted_by or auth.uid() = claimed_by);
  create policy "Admins can view all venues" on venues for select using (is_admin());
  create policy "Authenticated users can submit venues" on venues
    for insert to authenticated with check (
      auth.uid() = submitted_by and moderation_status = 'pending'
      and is_published = false and is_verified = false);
  create policy "Owners can update claimed venue" on venues
    for update using (auth.uid() = claimed_by);
  create policy "Admins can update any venue" on venues for update using (is_admin());

  create policy "Users can write reviews" on reviews
    for insert to authenticated with check (
      auth.uid() = user_id and moderation_status = 'pending'
      and user_review_count_today() < 10);
  create policy "Users read own reviews" on reviews for select using (auth.uid() = user_id);
  create policy "Users update own reviews" on reviews for update using (auth.uid() = user_id);
  create policy "Users delete own reviews" on reviews for delete using (auth.uid() = user_id);

  create policy "own favourites" on favourites for all using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  create policy "own photos ins" on venue_photos for insert to authenticated
    with check (auth.uid() = uploaded_by and status = 'pending');
  create policy "own photos sel" on venue_photos for select using (auth.uid() = uploaded_by);
  create policy "own photos upd" on venue_photos for update using (auth.uid() = uploaded_by);
  create policy "own push" on push_tokens for all using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  create policy "own votes ins" on venue_facility_votes for insert to authenticated
    with check (auth.uid() = user_id);
  create policy "own votes sel" on venue_facility_votes for select to authenticated
    using (auth.uid() = user_id);
  create policy "own votes upd" on venue_facility_votes for update to authenticated
    using (auth.uid() = user_id);
  create policy "stats public" on venue_facility_stats for select using (true);
  create policy "facilities public" on venue_facilities for select using (true);

  -- ── 062/063-style column-level grants that must SURVIVE this migration ────
  revoke insert on public.venues from public, anon, authenticated;
  -- Migration 063 grants EXACTLY these 15 columns -- its own header says so twice.
  grant insert (name, description, category_id, address_line1, city, postcode,
                latitude, longitude, phone, website, min_age, max_age,
                submitted_by, moderation_status, is_published)
    on public.venues to authenticated;
  revoke update on public.profiles from public, anon, authenticated;
  grant update (username, full_name, bio, avatar_url, children_ages, postcode,
                show_in_search, show_reviews_publicly, marketing_consent,
                terms_accepted_at)
    on public.profiles to authenticated;

  revoke insert, update, delete on venue_enrichment_writes
    from public, anon, authenticated, service_role;

  insert into profiles (id, is_admin) values
    ('${OWNER}', false), ('${OTHER}', false), ('${ADMIN}', true);
`;


// ── Phase 12: forbidden-grant source scanner ─────────────────────────────────
// Fails if a migration hands TRUNCATE / REFERENCES / TRIGGER / MAINTAIN (or ALL,
// which contains them) to anon or authenticated -- whether through a direct GRANT
// or through ALTER DEFAULT PRIVILEGES.
//
// Deliberately NOT a naive grep. It strips full-line SQL comments first, so a
// migration that DOCUMENTS forbidden syntax -- notably the SECURITY-DEGRADING
// rollback blocks, which legitimately contain GRANT TRUNCATE -- does not trip it.
// It then parses each statement into (privileges, roles) rather than matching the
// keywords anywhere in the text, so a table called trigger_log or a
// GRANT EXECUTE on a trigger-returning function is not a false positive.
export function scanForForbiddenGrants(sql) {
  const offenders = [];
  const code = sql.split(String.fromCharCode(10))
    .filter((l) => !/^\s*--/.test(l))
    .join(String.fromCharCode(10));
  for (const raw of code.split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    if (!/\bgrant\b/i.test(stmt)) continue;      // REVOKE-only statements ignored
    const g = stmt.toLowerCase().lastIndexOf("grant");
    const after = stmt.slice(g + 5);
    const onAt = after.toLowerCase().search(/\bon\b/);
    if (onAt < 0) continue;
    const privs = after.slice(0, onAt).toUpperCase();
    const toAt = after.toLowerCase().lastIndexOf(" to ");
    if (toAt < 0) continue;
    const roles = after.slice(toAt + 4).toLowerCase();
    const badPriv = /\bALL\b|\bTRUNCATE\b|\bREFERENCES\b|\bTRIGGER\b|\bMAINTAIN\b/.test(privs);
    const badRole = /\banon\b|\bauthenticated\b/.test(roles);
    if (badPriv && badRole) {
      offenders.push(`GRANT${privs.length > 40 ? privs.slice(0, 40) + "..." : privs} -> ${roles.trim()}`);
    }
  }
  return offenders;
}
// ── Tiny assert harness (same shape as the other supabase/tests files) ───────
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (e) {
    failures.push({ name, message: e?.message ?? String(e) });
    console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function throws(promise, re, msg) {
  try { await promise; } catch (e) {
    const m = e?.message ?? String(e);
    if (re && !re.test(m)) throw new Error(`${msg || 'wrong error'}: ${m}`);
    return m;
  }
  throw new Error(msg || `expected a throw matching ${re}`);
}

function makeHelpers(db) {
  const q = (sql, params) => db.query(sql, params);
  const asUser = async (uid) => {
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    await db.exec('set role authenticated');
  };
  const asAnon = async () => {
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role anon');
  };
  const asService = async () => {
    await db.query(`select set_config('test.uid', '', false)`);
    await db.exec('set role service_role');
  };
  const reset = async () => {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false)`);
  };
  // How many public BASE tables does `role` hold `priv` on?
  const countPriv = async (role, priv) => {
    const r = await q(
      `select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p')
          and has_table_privilege($1, c.oid, $2)`, [role, priv]);
    return r.rows[0].c;
  };
  const totalTables = async () => {
    const r = await q(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
                        where n.nspname='public' and c.relkind in ('r','p')`);
    return r.rows[0].c;
  };
  const newVenue = async (owner = OWNER) => {
    await reset();
    const r = await q(
      `insert into venues (name, city, postcode, latitude, longitude, submitted_by, claimed_by,
                           is_published, moderation_status)
       values ($1,'Bath','BA1 1AA',51.38,-2.36,$2,$2,true,'approved') returning id`,
      [`V-${Math.random().toString(36).slice(2, 9)}`, owner]);
    return r.rows[0].id;
  };
  return { q, asUser, asAnon, asService, reset, countPriv, totalTables, newVenue };
}

// =============================================================================
async function part0() {
  console.log('\nPART 0 -- pre-fix: the four privileges are held, and RLS does not stop TRUNCATE\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  const h = makeHelpers(db);
  const total = await h.totalTables();

  await test('1. PRE-FIX: anon holds TRUNCATE on every public table', async () => {
    eq(await h.countPriv('anon', 'TRUNCATE'), total,
      'the fixture must reproduce the live audit, or nothing below means anything');
  });

  await test('2. PRE-FIX: authenticated holds TRUNCATE on every public table', async () => {
    eq(await h.countPriv('authenticated', 'TRUNCATE'), total);
  });

  await test('2b. PRE-FIX: anon and authenticated also hold REFERENCES / TRIGGER / MAINTAIN', async () => {
    for (const p of ['REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      eq(await h.countPriv('anon', p), total, `anon ${p}`);
      eq(await h.countPriv('authenticated', p), total, `authenticated ${p}`);
    }
  });

  await test('3. PRE-FIX: RLS does NOT save a table from TRUNCATE', async () => {
    const v = await h.newVenue(OWNER);
    await h.q(`insert into reviews (venue_id, user_id, rating) values ($1,$2,5)`, [v, OWNER]);
    await h.reset();
    eq((await h.q(`select count(*)::int c from reviews`)).rows[0].c, 1);
    // OTHER can see none of these rows under RLS...
    await h.asUser(OTHER);
    eq((await h.q(`select count(*)::int c from reviews`)).rows[0].c, 0,
      'RLS must hide the row from this user');
    // ...and yet truncates the whole table.
    await h.q(`truncate table reviews cascade`);
    await h.reset();
    eq((await h.q(`select count(*)::int c from reviews`)).rows[0].c, 0);
    assert(true, 'truncate succeeded for a user who could not see a single row');
  });

  await test('3b. PRE-FIX: anon can TRUNCATE too, seeing nothing at all', async () => {
    const v = await h.newVenue(OWNER);
    await h.q(`insert into venue_photos (venue_id, uploaded_by) values ($1,$2)`, [v, OWNER]);
    await h.reset();
    eq((await h.q(`select count(*)::int c from venue_photos`)).rows[0].c, 1);
    await h.asAnon();
    await h.q(`truncate table venue_photos cascade`);
    await h.reset();
    eq((await h.q(`select count(*)::int c from venue_photos`)).rows[0].c, 0);
  });

  await test('3c. PRE-FIX: user_review_count_today() is callable by anon (PUBLIC EXECUTE)', async () => {
    await h.reset();
    eq((await h.q(`select has_function_privilege('anon','public.user_review_count_today()','EXECUTE') as x`))
      .rows[0].x, true);
  });

  await test('3d. PRE-FIX: the trigger helpers are callable by anon/authenticated', async () => {
    await h.reset();
    for (const fn of TRIGGER_HELPERS) {
      const r = await h.q(`select has_function_privilege('authenticated',$1,'EXECUTE') as x`, [fn]);
      eq(r.rows[0].x, true, `${fn} should be callable pre-fix`);
    }
  });

  await db.close();
}

// =============================================================================
async function part1() {
  console.log('\nPART 1 -- post-fix: the four are gone for the API roles, kept for service_role\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);
  const total = await h.totalTables();

  for (const [n, priv] of [[4, 'TRUNCATE'], [6, 'REFERENCES'], [7, 'TRIGGER'], [8, 'MAINTAIN']]) {
    await test(`${n}. anon holds ${priv} on ZERO public tables`, async () => {
      eq(await h.countPriv('anon', priv), 0);
    });
    await test(`${n}b. authenticated holds ${priv} on ZERO public tables`, async () => {
      eq(await h.countPriv('authenticated', priv), 0);
    });
  }

  await test('9. service_role keeps all four on every table', async () => {
    for (const p of FOUR) eq(await h.countPriv('service_role', p), total, `service_role ${p}`);
  });

  await test('9b. an authenticated TRUNCATE is now refused', async () => {
    const v = await h.newVenue(OWNER);
    await h.q(`insert into reviews (venue_id, user_id, rating) values ($1,$2,5)`, [v, OWNER]);
    await h.asUser(OTHER);
    await throws(h.q(`truncate table reviews cascade`), /permission denied/i);
    await h.reset();
    eq((await h.q(`select count(*)::int c from reviews`)).rows[0].c, 1, 'the row must survive');
  });

  await test('9c. an anon TRUNCATE is now refused', async () => {
    await h.asAnon();
    await throws(h.q(`truncate table venue_photos cascade`), /permission denied/i);
    await h.reset();
  });

  await db.close();
}

// =============================================================================
async function part2() {
  console.log('\nPART 2 -- nothing else moved: column grants, PP-011, ordinary DML\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION_PP011);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('10. venues column-level INSERT grants are unchanged', async () => {
    const r = await h.q(
      `select column_name from information_schema.column_privileges
        where table_schema='public' and table_name='venues'
          and grantee='authenticated' and privilege_type='INSERT' order by column_name`);
    eq(r.rows.length, 15, 'migration 063 grants EXACTLY 15 columns -- all must survive');
    for (const c of ['name','description','category_id','address_line1','city','postcode',
                     'latitude','longitude','phone','website','min_age','max_age',
                     'submitted_by','moderation_status','is_published']) {
      assert(r.rows.some((x) => x.column_name === c), `063 column ${c} must still be granted`);
    }
    for (const c of ['is_verified','claimed_by','data_source','review_count']) {
      assert(!r.rows.some((x) => x.column_name === c), `${c} must NOT be grantable`);
    }
  });

  await test('11. profiles column-level UPDATE grants are unchanged', async () => {
    const r = await h.q(
      `select column_name from information_schema.column_privileges
        where table_schema='public' and table_name='profiles'
          and grantee='authenticated' and privilege_type='UPDATE'`);
    eq(r.rows.length, 10, 'migration 062 grants EXACTLY 10 user-editable columns');
    for (const c of ['username','full_name','bio','avatar_url','children_ages','postcode',
                     'show_in_search','show_reviews_publicly','marketing_consent',
                     'terms_accepted_at']) {
      assert(r.rows.some((x) => x.column_name === c), `062 column ${c} must still be granted`);
    }
    for (const c of ['is_admin','is_business_owner','id']) {
      assert(!r.rows.some((x) => x.column_name === c), `${c} must NOT be grantable`);
    }
  });

  await test('11b. table-level SELECT/INSERT/UPDATE/DELETE are untouched for the API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      const r = await h.q(
        `select has_table_privilege($1,'public.reviews','SELECT') s,
                has_table_privilege($1,'public.reviews','INSERT') i,
                has_table_privilege($1,'public.reviews','UPDATE') u,
                has_table_privilege($1,'public.reviews','DELETE') d`, [role]);
      assert(r.rows[0].s && r.rows[0].i && r.rows[0].u && r.rows[0].d,
        `${role} must keep its DML on reviews -- this migration does not touch DML`);
    }
  });

  await test('11c. service_role DML is complete EXCEPT the deliberate 057 ledger exception', async () => {
    // 057 revokes INSERT/UPDATE/DELETE on venue_enrichment_writes from every
    // role including service_role: it is an append-only ledger written only
    // through SECURITY DEFINER _enrichment_apply_write. A blanket "service_role
    // has all DML everywhere" assertion is WRONG and would mask this contract.
    const r = await h.q(
      `select c.relname, p.p as priv, has_table_privilege('service_role', c.oid, p.p) as held
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
         cross join (values ('INSERT'),('UPDATE'),('DELETE')) p(p)
        where n.nspname='public' and c.relkind='r'`);
    const missing = r.rows.filter((x) => !x.held);
    assert(missing.every((x) => x.relname === 'venue_enrichment_writes'),
      `service_role DML missing somewhere unexpected -> ${JSON.stringify(missing)}`);
    eq(missing.length, 3, 'exactly INSERT/UPDATE/DELETE on venue_enrichment_writes');
  });

  await test('12. PP-011 owner-update boundary still blocks trust-field escalation', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OWNER);
    await throws(h.q(`update venues set is_verified = true where id=$1`, [v]),
      /42501|may not change/i);
    await h.reset();
    eq((await h.q(`select is_verified from venues where id=$1`, [v])).rows[0].is_verified, false);
  });

  await test('12b. PP-011 still allows the owner allowlist', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OWNER);
    await h.q(`update venues set description='owner edit' where id=$1`, [v]);
    await h.reset();
    eq((await h.q(`select description from venues where id=$1`, [v])).rows[0].description, 'owner edit');
  });

  await test('13. admin moderation still works', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(ADMIN);
    await h.q(`update venues set moderation_status='approved', is_published=true,
                                 moderated_by=$2, moderated_at=now() where id=$1`, [v, ADMIN]);
    await h.reset();
    eq((await h.q(`select moderated_by from venues where id=$1`, [v])).rows[0].moderated_by, ADMIN);
  });

  await test('14. add-venue INSERT still works (the real client column set)', async () => {
    await h.asUser(OTHER);
    await h.q(
      `insert into venues (name, description, city, postcode, latitude, longitude, phone,
                           website, min_age, max_age, submitted_by, moderation_status, is_published)
       values ('New Soft Play','desc','Bath','BA1 1AA',51.4,-2.3,'0123','https://x',0,12,$1,'pending',false)`,
      [OTHER]);
    await h.reset();
    eq((await h.q(`select count(*)::int c from venues where name='New Soft Play'`)).rows[0].c, 1);
  });

  await test('15. reviews INSERT / UPDATE / DELETE still work', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OTHER);
    const rev = (await h.q(
      `insert into reviews (venue_id, user_id, rating, moderation_status)
       values ($1,$2,4,'pending') returning id`, [v, OTHER])).rows[0].id;
    await h.q(`update reviews set rating = 5 where id=$1`, [rev]);
    await h.q(`delete from reviews where id=$1`, [rev]);
    await h.reset();
    eq((await h.q(`select count(*)::int c from reviews where id=$1`, [rev])).rows[0].c, 0);
  });

  await test('16. favourites INSERT / DELETE still work', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OTHER);
    await h.q(`insert into favourites (user_id, venue_id) values ($1,$2)`, [OTHER, v]);
    await h.q(`delete from favourites where user_id=$1 and venue_id=$2`, [OTHER, v]);
    await h.reset();
  });

  await test('17. venue_photos INSERT / UPDATE still work', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OTHER);
    const p = (await h.q(
      `insert into venue_photos (venue_id, uploaded_by) values ($1,$2) returning id`, [v, OTHER]))
      .rows[0].id;
    await h.q(`update venue_photos set status='pending' where id=$1`, [p]);
    await h.reset();
  });

  await test('18. facility-vote upsert still works, and the stats triggers still fire', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OTHER);
    await h.q(
      `insert into venue_facility_votes (venue_id, user_id, facility_slug, has_it)
       values ($1,$2,'parking',true)
       on conflict (venue_id, user_id, facility_slug) do update set has_it = excluded.has_it`,
      [v, OTHER]);
    await h.reset();
    const s = await h.q(`select yes_votes from venue_facility_stats
                          where venue_id=$1 and facility_slug='parking'`, [v]);
    eq(s.rows.length, 1, 'recompute_facility_stats must still have fired');
    eq(s.rows[0].yes_votes, 1);
    const f = await h.q(`select count(*)::int c from venue_facilities
                          where venue_id=$1 and facility_slug='parking'`, [v]);
    eq(f.rows[0].c, 1, 'mirror_facility_stats_to_venue_facilities must still have fired');
  });

  await db.close();
}

// =============================================================================
async function part3() {
  console.log('\nPART 3 -- tables created AFTER the migration fail safe\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('19. a NEW public table can be created after the migration', async () => {
    await h.reset();
    await h.q(`create table public.t_future (id int primary key, payload text)`);
  });

  for (const [n, role] of [[20, 'anon'], [21, 'authenticated']]) {
    await test(`${n}. ${role} does NOT inherit TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on it`, async () => {
      for (const p of FOUR) {
        const r = await h.q(`select has_table_privilege($1,'public.t_future',$2) as x`, [role, p]);
        eq(r.rows[0].x, false, `${role} must not inherit ${p} on a new table`);
      }
    });
  }

  await test('22. expected DML defaults on the new table are UNCHANGED', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const r = await h.q(`select has_table_privilege($1,'public.t_future',$2) as x`, [role, p]);
        eq(r.rows[0].x, true, `${role} must still inherit ${p} -- DML defaults are out of scope`);
      }
    }
  });

  await test('23. service_role keeps its expected defaults on the new table', async () => {
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', ...FOUR]) {
      const r = await h.q(`select has_table_privilege('service_role','public.t_future',$1) as x`, [p]);
      eq(r.rows[0].x, true, `service_role must still inherit ${p}`);
    }
  });

  await db.close();
}

// =============================================================================
async function part4() {
  console.log('\nPART 4 -- function changes\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('24a. user_review_count_today: anon EXECUTE is denied', async () => {
    await h.reset();
    eq((await h.q(`select has_function_privilege('anon','public.user_review_count_today()','EXECUTE') as x`))
      .rows[0].x, false);
  });

  await test('24b. user_review_count_today: PUBLIC no longer holds EXECUTE', async () => {
    await h.reset();
    const r = await h.q(
      `select exists (select 1 from pg_proc p
                        join pg_namespace n on n.oid=p.pronamespace,
                      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       where n.nspname='public' and p.proname='user_review_count_today'
                         and g.grantee=0 and g.privilege_type='EXECUTE') as x`);
    eq(r.rows[0].x, false);
  });

  await test('24c. user_review_count_today: authenticated CAN still execute it', async () => {
    await h.reset();
    eq((await h.q(`select has_function_privilege('authenticated','public.user_review_count_today()','EXECUTE') as x`))
      .rows[0].x, true);
  });

  await test('24d. user_review_count_today: result is still self-scoped', async () => {
    const v = await h.newVenue(OWNER);
    await h.reset();
    await h.q(`insert into reviews (venue_id, user_id, rating) values ($1,$2,5)`, [v, OWNER]);
    await h.q(`insert into reviews (venue_id, user_id, rating) values ($1,$2,4)`, [v, OTHER]);
    await h.asUser(OWNER);
    eq(Number((await h.q(`select public.user_review_count_today() as c`)).rows[0].c), 1,
      'the caller must only ever see their own count');
    await h.asUser(OTHER);
    eq(Number((await h.q(`select public.user_review_count_today() as c`)).rows[0].c), 1);
    await h.reset();
  });

  await test('24e. user_review_count_today: search_path is now pinned to empty', async () => {
    await h.reset();
    const r = await h.q(`select array_to_string(proconfig, ',') as cfg, prosecdef
                          from pg_proc where proname='user_review_count_today'`);
    eq(r.rows[0].cfg, 'search_path=""',
      'search_path must be pinned to the empty string');
    eq(r.rows[0].prosecdef, true, 'it must remain SECURITY DEFINER');
  });

  await test('24f. the reviews rate-cap policy still works (it calls the hardened function)', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OTHER);
    await h.q(`insert into reviews (venue_id, user_id, rating, moderation_status)
               values ($1,$2,5,'pending')`, [v, OTHER]);
    await h.reset();
    eq((await h.q(`select count(*)::int c from reviews where venue_id=$1 and user_id=$2`,
      [v, OTHER])).rows[0].c, 1,
      'the INSERT policy calls user_review_count_today(); it must still be satisfiable');
  });

  await test('25a. every changed trigger helper: direct EXECUTE denied to all API roles', async () => {
    await h.reset();
    for (const fn of TRIGGER_HELPERS) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const r = await h.q(`select has_function_privilege($1,$2,'EXECUTE') as x`, [role, fn]);
        eq(r.rows[0].x, false, `${role} must not hold EXECUTE on ${fn}`);
      }
      const pub = await h.q(
        `select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
                        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         where (n.nspname||'.'||p.proname||'()') = $1
                           and g.grantee=0 and g.privilege_type='EXECUTE') as x`, [fn]);
      eq(pub.rows[0].x, false, `PUBLIC must not hold EXECUTE on ${fn}`);
    }
  });

  await test('25b. set_venue_location still fires (location derived on insert)', async () => {
    const v = await h.newVenue(OWNER);
    const r = await h.q(`select location from venues where id=$1`, [v]);
    assert(r.rows[0].location && r.rows[0].location.length > 0,
      'the location trigger must still populate the column');
  });

  await test('25c. touch_updated_at still fires on an authenticated update', async () => {
    const v = await h.newVenue(OWNER);
    const before = (await h.q(`select updated_at from venues where id=$1`, [v])).rows[0].updated_at;
    await h.asUser(OWNER);
    await h.q(`update venues set description='x' where id=$1`, [v]);
    await h.reset();
    const after = (await h.q(`select updated_at from venues where id=$1`, [v])).rows[0].updated_at;
    assert(after >= before, 'updated_at must still be stamped');
  });

  await test('25d. update_push_token_updated_at still fires', async () => {
    await h.reset();
    const id = (await h.q(`insert into push_tokens (user_id, token) values ($1,'t') returning id`,
      [OWNER])).rows[0].id;
    const before = (await h.q(`select updated_at from push_tokens where id=$1`, [id])).rows[0].updated_at;
    await h.asUser(OWNER);
    await h.q(`update push_tokens set token='t2' where id=$1`, [id]);
    await h.reset();
    const after = (await h.q(`select updated_at from push_tokens where id=$1`, [id])).rows[0].updated_at;
    assert(after >= before);
  });

  await test('25e. recompute + mirror triggers still fire for an authenticated writer', async () => {
    const v = await h.newVenue(OWNER);
    await h.asUser(OTHER);
    await h.q(`insert into venue_facility_votes (venue_id, user_id, facility_slug, has_it)
               values ($1,$2,'baby-change',true)`, [v, OTHER]);
    await h.reset();
    eq((await h.q(`select yes_votes from venue_facility_stats
                    where venue_id=$1 and facility_slug='baby-change'`, [v])).rows[0].yes_votes, 1);
    eq((await h.q(`select count(*)::int c from venue_facilities
                    where venue_id=$1 and facility_slug='baby-change'`, [v])).rows[0].c, 1);
  });

  await test('25f. a trigger helper cannot be called directly even by the owner role', async () => {
    await h.reset();
    await throws(h.q(`select public.touch_updated_at()`), /trigger/i,
      'a trigger-returning function is not callable as an ordinary function -- so it was never an RPC');
  });

  await db.close();
}

// =============================================================================
async function part5() {
  console.log('\nPART 5 -- CREATE TRIGGER is no longer available to an API role\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('26. authenticated cannot CREATE TRIGGER on venues (TRIGGER privilege is gone)', async () => {
    await h.reset();
    await h.q(`create or replace function public.attacker_fn() returns trigger
               language plpgsql security invoker as $$ begin return new; end $$`);
    await h.q(`grant execute on function public.attacker_fn() to authenticated`);
    await h.asUser(OTHER);
    await throws(
      h.q(`create trigger attacker_trigger after insert on public.venues
           for each row execute function public.attacker_fn()`),
      /permission denied|must be owner/i,
      'without TRIGGER, a non-owner cannot attach a trigger');
    await h.reset();
  });

  await test('26b. and anon cannot either', async () => {
    await h.asAnon();
    await throws(
      h.q(`create trigger attacker_trigger2 after insert on public.venues
           for each row execute function public.attacker_fn()`),
      /permission denied|must be owner/i);
    await h.reset();
  });

  await db.close();
}

// =============================================================================
async function part6() {
  console.log('\nPART 6 -- default-privilege regression guard\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);

  await test('GUARD (runtime): postgres/public TABLE defaults grant none of the four to the API roles', async () => {
    await h.reset();
    const r = await h.q(
      `select coalesce(string_agg(distinct g.grantee::regrole::text || ':' || g.privilege_type, ', '), '') as bad
         from pg_default_acl d, lateral aclexplode(d.defaclacl) g
        where d.defaclobjtype='r'
          and d.defaclnamespace='public'::regnamespace::oid
          and d.defaclrole='postgres'::regrole
          and g.grantee in ('anon'::regrole,'authenticated'::regrole)
          and g.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')`);
    eq(r.rows[0].bad, '',
      `a default-privilege grant has come back: ${r.rows[0].bad}`);
  });

  await test('GUARD (runtime): the DML defaults are still present (we did not over-revoke)', async () => {
    await h.reset();
    const r = await h.q(
      `select count(*)::int c
         from pg_default_acl d, lateral aclexplode(d.defaclacl) g
        where d.defaclobjtype='r'
          and d.defaclnamespace='public'::regnamespace::oid
          and d.defaclrole='postgres'::regrole
          and g.grantee in ('anon'::regrole,'authenticated'::regrole)
          and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`);
    eq(r.rows[0].c, 8, 'both roles must retain all four DML defaults (2 roles x 4 privileges)');
  });

  await test('GUARD (source): no migration grants the four to anon/authenticated', async () => {
    // Covers BOTH direct GRANT and ALTER DEFAULT PRIVILEGES, across every
    // migration -- structural, not a snapshot of today\u2019s tables.
    const offenders = [];
    for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
      for (const o of scanForForbiddenGrants(readFileSync(join(MIG_DIR, f), 'utf8'))) {
        offenders.push(`${f}: ${o}`);
      }
    }
    eq(offenders.length, 0,
      `a migration grants a non-DML table privilege to an API role -> ${offenders.join(' | ')}`);
  });

  await test('GUARD (scanner self-test): flags what it must flag', async () => {
    const mustFlag = [
      ['direct GRANT TRUNCATE',   'GRANT TRUNCATE ON public.venues TO anon;'],
      ['direct GRANT TRIGGER',    'GRANT TRIGGER ON TABLE public.venues TO authenticated;'],
      ['direct GRANT REFERENCES', 'GRANT REFERENCES ON public.venues TO anon, authenticated;'],
      ['direct GRANT MAINTAIN',   'GRANT MAINTAIN ON public.venues TO authenticated;'],
      ['GRANT ALL (contains all four)', 'GRANT ALL ON TABLE public.venues TO anon;'],
      ['GRANT ALL PRIVILEGES',    'GRANT ALL PRIVILEGES ON public.x TO authenticated;'],
      ['ON ALL TABLES form',      'GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO anon;'],
      ['ALTER DEFAULT PRIVILEGES','ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;'],
      ['inside a DO/EXECUTE',     "DO $$ BEGIN EXECUTE 'GRANT MAINTAIN ON ALL TABLES IN SCHEMA public TO authenticated'; END $$;"],
    ];
    for (const [label, sql] of mustFlag) {
      assert(scanForForbiddenGrants(sql).length > 0, `scanner MISSED: ${label}`);
    }
  });

  await test('GUARD (scanner self-test): does NOT flag what it must not', async () => {
    const mustNotFlag = [
      ['a REVOKE',               'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;'],
      ['a commented rollback',   '--   GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public\n--     TO anon, authenticated;'],
      ['prose describing it',    '-- Do not GRANT TRUNCATE ON public.venues TO anon; it bypasses RLS.'],
      ['GRANT EXECUTE on a fn',  'GRANT EXECUTE ON FUNCTION public.update_venue_rating() TO authenticated;'],
      ['ordinary DML grant',     'GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;'],
      ['column-level grant',     'GRANT UPDATE (username, full_name) ON public.profiles TO authenticated;'],
      ['service_role only',      'GRANT TRUNCATE, REFERENCES, TRIGGER ON public.venues TO service_role;'],
      ['schema USAGE',           'GRANT USAGE ON SCHEMA private TO authenticated;'],
      ['a table named trigger_log', 'GRANT SELECT ON public.trigger_log TO anon;'],
    ];
    for (const [label, sql] of mustNotFlag) {
      const hits = scanForForbiddenGrants(sql);
      eq(hits.length, 0, `scanner FALSE POSITIVE on ${label}: ${JSON.stringify(hits)}`);
    }
  });
  await db.close();
}

// =============================================================================
async function part7() {
  console.log('\nPART 7 -- idempotency, rollback fidelity, re-apply\n');
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  const h = makeHelpers(db);
  const total = await h.totalTables();

  await test('27. IDEMPOTENT: applying the migration a second time succeeds', async () => {
    await h.reset();
    await db.exec(MIGRATION);
  });

  await test('27b. IDEMPOTENT: the resulting privilege state is identical', async () => {
    for (const p of FOUR) {
      eq(await h.countPriv('anon', p), 0);
      eq(await h.countPriv('authenticated', p), 0);
      eq(await h.countPriv('service_role', p), total);
    }
  });

  await test('28. ROLLBACK (from the migration\'s own block) restores the previous privileges', async () => {
    await h.reset();
    await db.exec(ROLLBACK);
    for (const p of FOUR) {
      eq(await h.countPriv('anon', p), total, `anon ${p} must be restored`);
      eq(await h.countPriv('authenticated', p), total, `authenticated ${p} must be restored`);
    }
    eq((await h.q(`select has_function_privilege('anon','public.user_review_count_today()','EXECUTE') as x`))
      .rows[0].x, true, 'PUBLIC EXECUTE restored');
    for (const fn of TRIGGER_HELPERS) {
      const r = await h.q(`select has_function_privilege('authenticated',$1,'EXECUTE') as x`, [fn]);
      eq(r.rows[0].x, true, `${fn} EXECUTE must be restored`);
    }
    const r = await h.q(`select proconfig::text as cfg from pg_proc where proname='user_review_count_today'`);
    assert(/search_path=public/.test(r.rows[0].cfg), 'the 054 search_path must be restored');
  });

  await test('28b. ROLLBACK restores the default privileges too', async () => {
    await h.reset();
    await h.q(`create table public.t_after_rollback (id int primary key)`);
    for (const p of FOUR) {
      const x = await h.q(`select has_table_privilege('anon','public.t_after_rollback',$1) as x`, [p]);
      eq(x.rows[0].x, true, `a new table must inherit ${p} again after rollback`);
    }
  });

  await test('29. ROLLBACK is SECURITY-DEGRADING: TRUNCATE works again', async () => {
    const v = await h.newVenue(OWNER);
    await h.q(`insert into reviews (venue_id, user_id, rating) values ($1,$2,5)`, [v, OWNER]);
    await h.reset();
    await h.asUser(OTHER);
    await h.q(`truncate table reviews cascade`);
    await h.reset();
    eq((await h.q(`select count(*)::int c from reviews`)).rows[0].c, 0,
      'this is exactly why the rollback is labelled degrading');
  });

  await test('30. re-applying after rollback ends in the secure state', async () => {
    await h.reset();
    await db.exec(MIGRATION);
    for (const p of FOUR) {
      eq(await h.countPriv('anon', p), 0);
      eq(await h.countPriv('authenticated', p), 0);
    }
    await h.q(`create table public.t_reapplied (id int primary key)`);
    for (const p of FOUR) {
      const x = await h.q(`select has_table_privilege('authenticated','public.t_reapplied',$1) as x`, [p]);
      eq(x.rows[0].x, false, `a new table must fail safe again for ${p}`);
    }
  });

  await db.close();
}

// =============================================================================
async function main() {
  console.log('Privilege hardening -- non-DML API privileges');
  console.log(`migration: ${MIGRATION_PATH.replace(/\\/g, '/').split('/').slice(-1)[0]}`);

  await part0();
  await part1();
  await part2();
  await part3();
  await part4();
  await part5();
  await part6();
  await part7();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
