---
name: Deferred Security Remediation — public-schema table ACLs
description: Systemic least-privilege finding — Supabase default privileges grant ALL on public tables to anon/authenticated; needs a future hardening migration (do NOT touch during the migration-ledger investigation)
type: project
---

> **STATUS UPDATE 2026-07-04:** F3 and F4 are **FIXED IN PRODUCTION** — migration 057 (applied + verified
> 2026-07-04, ledger repaired) re-created `venue_field_proposals.reviewed_by` and created
> `venue_enrichment_writes.applied_by` with `ON DELETE SET NULL`. Post-apply check 4.1 confirmed both
> `confdeltype='n'` live. The accepted forensic-attribution trade-off is recorded in
> `docs/DPIA_website_enrichment_addendum.md` §9. **F1 (discovery_approved data drift) and F2 (systemic
> table-ACL over-grant) remain OPEN/DEFERRED** — they are the only live items left in this file.

## Finding (surfaced 2026-06-30 during migration 050 object verification)

Every table created in schema `public` inherits Supabase's platform **default privileges**:
`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated, service_role`.
So `anon` and `authenticated` hold the **full** table privilege set on these tables, not just the
narrow set the migrations intended.

Confirmed on `venue_facility_votes` + `venue_facility_stats` (migration 050):
- Owner `postgres`. Raw ACL on both =
  `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
  (`arwdDxtm` = INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN).
- `pg_default_acl` (owner postgres + supabase_admin, schema public, objtype `r`) carries the same default.
- Migration 050 granted only narrow rights (votes: S/I/U/D to authenticated; stats: SELECT to anon/authenticated)
  and **never revoked** the inherited defaults. Proof it's inherited: 050 granted only SELECT on `stats`, yet
  anon/authenticated also have INSERT/UPDATE/DELETE/TRUNCATE there.

**This is SYSTEMIC** — it applies to most/all `public` tables, not just the facility tables. Same root-cause
class as the function-EXECUTE defaults (service_role on `get_nearby_venues`; the documented 056 grant-hardening).

## Why it's (mostly) contained today
RLS still gates the real row operations: SELECT/INSERT/UPDATE/DELETE are row-policy enforced. PostgREST (the
anon/authenticated API surface) only issues SELECT/INSERT/UPDATE/DELETE/RPC — it does NOT expose TRUNCATE or DDL.
But RLS does NOT govern `TRUNCATE` (wipes all rows, bypasses RLS — the material risk), `REFERENCES`, `TRIGGER`,
`MAINTAIN`. So the extra privileges are a genuine least-privilege gap.

## Deferred remediation (do NOT start during the migration-ledger drift investigation)
1. Audit ALL public-schema tables created under these default privileges (full ACL inventory per role).
2. Determine the minimal required table grants per role (anon read-only where possible; authenticated narrow).
3. Consider a future explicit REVOKE/GRANT hardening migration (revoke the inherited ALL, re-grant only needed).
4. Consider tightening future default privileges WITHOUT breaking Supabase-managed behaviour.
5. Test every app/API flow before any privilege change (regression risk is high — RLS + grants interact).

---

## Finding 2 — venue_field_proposals.reviewed_by FK blocks account deletion (GDPR Art.17)

Surfaced 2026-06-30 by the 051/052 erasure-FK full sweep. Migration **056** created
`venue_field_proposals.reviewed_by` with an FK to `profiles(id)` on a DELETE-BLOCKING action
(NO ACTION/RESTRICT) — the exact class of bug 051/052 fixed everywhere else. It is a REGRESSION
introduced by 056, NOT a failure of 051/052.

Impact (confirmed against prod): `reviewed_by` is nullable; 17 proposal rows have a reviewer; all 17
reference exactly ONE distinct profile, which is an admin; 0 non-admin reviewers. So the live blocker
footprint = a single admin account (deleting it may FK-fail). Genuine + GDPR-relevant, but tiny footprint.

**CONFIRMED (was "suspected") 2026-07-04** during 056a object verification: `pg_constraint.confdeltype = 'a'`
(NO ACTION) on prod, definition `FOREIGN KEY (reviewed_by) REFERENCES profiles(id)` — matches the migration
source exactly (no `on delete` clause written → Postgres default). No longer a suspicion; this is the live state.

Deferred remediation (do NOT implement during the ledger investigation):
- Replace the constraint: `FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL`.
- Preserve proposal history — never delete or rewrite reviewed proposals.
- Verify app/API queries tolerate `reviewed_by = NULL`.
- Add an account-deletion regression test for the case where reviewed proposals exist.
Confirm the exact `confdeltype` when migration 056 is verified in this investigation.

---

## Finding 4 (F4) — venue_enrichment_writes.applied_by will have the SAME NO ACTION FK gap as F3

Surfaced 2026-07-04 during 057 apply-path planning (before any apply). Migration 057
(`supabase/migrations/057_enrichment_auto_decision.sql`, still fully unapplied) creates a NEW table
`venue_enrichment_writes` with `applied_by uuid references profiles(id)` — written with no `on delete`
clause, so it will default to NO ACTION once created, identical in class to F3.

Unlike F3 (an existing column, already live in prod with 17 rows of data), F4 is on a table that does
NOT exist yet — so the fix is free: edit the CREATE TABLE column definition to
`applied_by uuid references profiles(id) on delete set null` BEFORE the file is ever applied. No ALTER
needed later, no data migration, zero added risk.

Independent security review (secom-reviewer, 2026-07-04) confirmed SET NULL is appropriate for both F3
and F4, with a documentation note: losing the specific admin identity on account deletion is
GDPR-compliant, but assumes nobody later needs "who specifically applied this" for forensic/compliance
tracing on the immutable ledger — worth a short DPIA note, not a blocker.

**Also flagged (open design question, NOT a GDPR issue):** `venue_enrichment_writes`'s other 3 FKs
(`run_id`, `proposal_id`, `venue_id` NOT NULL, `reverts_write_id` self-FK) are also NO ACTION as authored.
None reference `profiles`, so no account-deletion angle — but nobody has explicitly decided whether
NO ACTION is the *correct* design for an immutable audit ledger (arguably yes — you don't want a venue
deletion to silently cascade-erase or orphan audit rows) versus an oversight. Flagged for a conscious
decision, not bundled into the F4 fix.

**DECISION MADE + IMPLEMENTED (local only, 057 still unapplied) 2026-07-04:** Liam approved folding both
in. `057_enrichment_auto_decision.sql` now: (a) wraps the whole file in `BEGIN;...COMMIT;`, (b) adds
`DROP CONSTRAINT IF EXISTS venue_field_proposals_reviewed_by_fkey` + re-`ADD CONSTRAINT ... ON DELETE SET
NULL` right after the status-check block (F3), (c) defines `venue_enrichment_writes.applied_by uuid
references profiles(id) on delete set null` directly (F4). 10 new pglite tests added to
`supabase/tests/057_enrichment_auto_decision.mjs` (50/50 pass, independently re-run), including 2
behavioural regression tests proving a deleted profile leaves `reviewed_by`/`applied_by` NULL with no FK
error. Independently reviewed by bughunter + secom-reviewer (both confirmed SET NULL correct for both
columns; secom found no other issue). **bughunter found one real pre-apply gap:** the `DROP CONSTRAINT IF
EXISTS venue_field_proposals_reviewed_by_fkey` name is inferred from Postgres's auto-naming convention,
never literally re-confirmed against prod. If prod's actual name differs, the DROP silently no-ops and the
ADD creates a SECOND FK — the original NO ACTION constraint would still block deletion, defeating the fix
while every test stays green (tests build from source, not live prod). **Mandatory pre-apply check added:**
query `pg_constraint` on prod immediately before applying 057 and confirm exactly one FK row named
`venue_field_proposals_reviewed_by_fkey`. Full plan + all SQL in `scratchpad/apply_plan_057.md` (superseded
by the newer report in this session — see `next_session_reminder.md`). 057 still NOT applied to prod.

Related: [[project-progress]] (2026-06-30 migration-ledger drift investigation), [[next-session-reminder]],
[[migration-drift-044-056-block2]].
