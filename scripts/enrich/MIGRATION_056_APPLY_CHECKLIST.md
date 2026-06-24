# Migration 056 — Apply Checklist (Website Enrichment)

**Status:** NOT APPLIED. Latest applied migration = `055`. This is a gated, manual,
human-approved procedure. Do **not** run `--propose` / `--apply` at any point during
migration validation — proposal-writing is a *separate* step that happens only after
this checklist and the DPIA sign-off are both complete.

Migration file: `supabase/migrations/056_venue_website_enrichment.sql`
Down/rollback: see §8 (drop statements) — purely additive + isolated, no existing object altered.
DB behavioural tests: `supabase/tests/056_venue_website_enrichment.mjs` (`npm run test:db`, 27 tests,
runs on in-process **pglite** — no Supabase, no production).

---

## 0. Scope / what 056 creates
- **2 tables:** `venue_enrichment_runs` (append-only audit), `venue_field_proposals` (reviewable proposals).
- **8 indexes** + **1 unique partial index** (`venue_field_proposals_one_pending_idx` — one live pending per venue+field).
- **1 trigger:** `venue_field_proposals_updated_at` → `touch_updated_at()`.
- **RLS:** enabled on both tables; admin-only policies `runs_admin_all`, `proposals_admin_all`.
- **4 RPCs:** `snapshot_current_value`, `propose_field`, `apply_venue_proposal`, `reject_venue_proposal`.
- **Grants:** revoke-all-from-public; `snapshot_current_value`+`propose_field` → `service_role`;
  `apply_venue_proposal`+`reject_venue_proposal` → `authenticated`, `service_role`.
- **No change** to `venues` / `opening_hours` shape. The ONLY path that writes to those tables is the
  admin-only, stale-guarded `apply_venue_proposal` RPC — never the migration itself.

---

## 1. Pre-apply backup & environment checks
- [ ] Confirm the target environment (echo the project ref / DB host) — must be the intended one, NOT prod for the first apply.
- [ ] Take a fresh database backup / confirm Supabase PITR is enabled and a restore point exists.
- [ ] Record current schema version: latest applied migration = `055` (verify in `supabase_migrations` / your tracker).
- [ ] Confirm no other migration is mid-flight and the branch is clean.
- [ ] Confirm Postgres version ≥ 14 (Supabase = PG15) — `sha256()` / `gen_random_uuid()` are core, **no extension** required.

## 2. Migration ordering & checksum
- [ ] `056` is the next sequential migration after `055` (no gap, no duplicate number).
- [ ] Record the file checksum so the applied file == the reviewed file:
  ```bash
  sha256sum supabase/migrations/056_venue_website_enrichment.sql
  ```
- [ ] Diff the file against the last reviewed version (git) — **no** unreviewed edits.

## 3. Required dependencies exist (run read-only, BEFORE apply)
```sql
-- prerequisite objects 056 depends on
select to_regclass('public.venues')        is not null as has_venues,
       to_regclass('public.opening_hours') is not null as has_opening_hours,
       to_regclass('public.profiles')      is not null as has_profiles,
       to_regproc('public.is_admin')       is not null as has_is_admin,        -- migration 001
       to_regproc('public.touch_updated_at') is not null as has_touch_updated; -- migration 001
-- expect all TRUE
```
- [ ] All five prerequisites present.

## 4. Apply to a NON-production / local environment first
- [ ] Run the full pglite behavioural suite (applies the REAL migration in-process, exercises RPCs + RLS + rollback):
  ```bash
  npm run test:db   # expect: 27 passed, 0 failed
  ```
- [ ] (Optional, recommended) Apply `056` to a staging/branch Supabase and repeat §6 verification there.
- [ ] **No `propose_field` / `apply_venue_proposal` calls** during this validation.

## 5. Run all 27 DB behavioural tests
- [ ] `npm run test:db` → **27 passed, 0 failed**. Covers: happy-path scalar/price/opening-hours/description apply,
      non-admin `not_admin`, RLS visibility, anon-no-execute, supersede + one-pending uniqueness, dedup-null-return,
      stale-current-value guard, invalid field / enum / incomplete week, description-not-rewritten,
      re-apply not_approved, booking_url no_target_column, 24:00 round-trip, mid-apply rollback, and the
      **down-migration drops 056 objects leaving base schema intact**.

## 6. Post-apply structural verification (read-only)
Run after applying to the target env. Expected results in comments.
```sql
-- 6a. Tables (expect 2 rows)
select table_name from information_schema.tables
 where table_schema='public' and table_name in ('venue_enrichment_runs','venue_field_proposals');

-- 6b. Indexes (expect the 9 named indexes, incl. the partial unique)
select indexname from pg_indexes
 where schemaname='public' and tablename in ('venue_enrichment_runs','venue_field_proposals')
 order by indexname;
-- includes: venue_field_proposals_one_pending_idx (UNIQUE, WHERE status='pending')

-- 6c. RLS enabled (expect both relrowsecurity = true)
select relname, relrowsecurity from pg_class
 where relname in ('venue_enrichment_runs','venue_field_proposals');

-- 6d. Policies (expect runs_admin_all, proposals_admin_all)
select tablename, policyname, cmd from pg_policies
 where tablename in ('venue_enrichment_runs','venue_field_proposals');

-- 6e. All 4 RPCs present
select proname from pg_proc
 where proname in ('snapshot_current_value','propose_field','apply_venue_proposal','reject_venue_proposal')
 order by proname;

-- 6f. Grants: public has NONE; service_role/authenticated as designed
select routine_name, grantee, privilege_type
 from information_schema.role_routine_grants
 where routine_name in ('snapshot_current_value','propose_field','apply_venue_proposal','reject_venue_proposal')
 order by routine_name, grantee;
-- expect: snapshot_current_value -> service_role ; propose_field -> service_role ;
--         apply_venue_proposal -> authenticated, service_role ; reject_venue_proposal -> authenticated, service_role ;
--         NO 'public' grantee anywhere.

-- 6g. Trigger present
select tgname from pg_trigger where tgname = 'venue_field_proposals_updated_at';

-- 6h. CONFIRM nothing was written (must be zero before any propose run)
select (select count(*) from venue_enrichment_runs)  as runs,
       (select count(*) from venue_field_proposals)  as proposals;
-- expect: 0, 0
```
- [ ] 6a tables ✓  6b indexes (9) ✓  6c RLS on ✓  6d policies ✓  6e 4 RPCs ✓  6f grants exact + no public ✓  6g trigger ✓  6h counts 0/0 ✓

## 7. Negative / safety spot-checks (read-only or as a non-admin role)
- [ ] As `anon`/`authenticated` (non-admin): `select * from venue_field_proposals` returns **0 rows** (RLS).
- [ ] As `anon`: `propose_field(...)` is **not executable** (no grant).
- [ ] `apply_venue_proposal` on a non-approved row raises `not_approved` (covered by test 5; re-confirm if applied to staging).

## 8. Rollback procedure (verify BEFORE you need it)
Down statements (purely additive migration → reversible, no base-table data loss):
```sql
drop function if exists reject_venue_proposal(uuid, text);
drop function if exists apply_venue_proposal(uuid, text);
drop function if exists propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz);
drop function if exists snapshot_current_value(uuid, text);
drop table if exists venue_field_proposals;   -- cascades its trigger + indexes
drop table if exists venue_enrichment_runs;
```
- [ ] The pglite test "rollback: down-migration drops 056 objects, leaves base schema intact" passes (§5).
- [ ] Confirm the down SQL above matches the objects created (no stray object left behind).
- [ ] Note: `venues` / `opening_hours` are untouched by the migration, so rollback loses no app data.

## 9. EXPLICIT production approval gate
- [ ] Migration reviewed (SQL) and §1–§8 all green on local/staging.
- [ ] DPIA addendum (see `docs/DPIA_website_enrichment_addendum.md`) signed off.
- [ ] **Named human approval to apply `056` to production** recorded here:
      approver: __________  date: __________
- [ ] Apply to production.
- [ ] Re-run §6 verification queries on production (expect identical results, counts 0/0).

## 10. After this checklist (still NOT in this step)
Proposal-writing is the next, separate, gated action — only after §9 + DPIA sign-off:
```
npx tsx scripts/enrich/enrichWebsites.ts --propose --limit=5
```
(uses `scripts/enrich/pilot_venue_ids.json` = the 5 verified venues; cap is 100; descriptions stay
`medium` = manual review / rewrite-required on apply).
