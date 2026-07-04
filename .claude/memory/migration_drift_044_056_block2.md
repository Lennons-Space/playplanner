---
name: Migration Drift Investigation — Block 2 object verification (044–056)
description: Read-only prod verification of migrations 044–056 (objects vs ledger). 044–055 DONE; 055a paste pending; 056 not started. Strictly read-only — no repair/db push/057/ledger edits.
type: project
---

# PROD migration-ledger drift — Block 2 (object-level verification)

Strictly READ-ONLY investigation. Prod inspected via hand-run SQL in the Supabase SQL Editor (CLI cannot
reach prod — Docker down). Branch `feat/website-enrichment-pr`. NOTHING applied/repaired/committed/pushed.
Goal: prove each migration 044–056's schema objects actually exist in prod, reconcile against the ledger,
then build a drift matrix and a safe 057 apply path. DO NOT propose/run any ledger repair until the full
matrix is reviewed + explicitly approved.

## Block 1 (ledger) — CONFIRMED
Prod `supabase_migrations.schema_migrations` = sequential 001–043 + 7 TIMESTAMP rows
(= local 046,047,049,051,052,054,055). NO ledger row for local 044,045,048,050,053,056,057.
Remote uses 14-digit timestamp versions; local uses 3-digit → `db push` would treat 044–057 as unapplied
and try to re-run them (several non-idempotent). DO NOT db push / migration repair.

Timestamp→migration map: 046=20260605211756, 047=20260605212043, 049=20260606142242,
051=20260607225234, 052=20260607225535, 054=20260609004736, 055=20260619200353.

## Block 2 — per-migration verdicts (verified against prod, hand-run SQL)

| Mig | Objects verified | Object verdict | Ledger row | Classification | Conf |
|-----|------------------|----------------|-----------|----------------|------|
| 044 | venues.discovery_approved col; venues_discovery_gate_idx | PRESENT & CORRECT | MISSING | present; ledger-only mismatch | HIGH |
| 045 | get_nearby_venues 11-arg + body discovery gate + grants | PRESENT & CORRECT (+extra service_role grant) | MISSING | present; minor priv diff; ledger-only | HIGH |
| 046 | get_nearby_venues search_path + update_push_token_updated_at; 6-fn execute revokes; pass_interest policy | PRESENT & CORRECT | PRESENT | present & matching | HIGH |
| 047 | PUBLIC revokes on 6 fns + 2 authenticated re-grants | PRESENT & CORRECT | PRESENT | present & matching | HIGH |
| 048 | is_admin() execute restored to anon+authenticated | PRESENT & CORRECT | MISSING | present; ledger-only mismatch | HIGH |
| 049 | venue_enrichment table (27 cols, PK, FK CASCADE, 11 CHECKs), 6 idx+pkey, trigger, RLS, 2 policies | PRESENT & CORRECT | PRESENT | present & matching | HIGH |
| 050 | venue_facility_votes + venue_facility_stats (cols/constraints/idx), 2 SECDEF fns, 3 triggers, RLS, 4 policies, seed | PRESENT & CORRECT | MISSING | present; ledger-only + systemic ACL diff | HIGH |
| 051 | 6 FKs→ON DELETE SET NULL; delete_own_account() rewrite | PRESENT & CORRECT | PRESENT | present & matching | HIGH |
| 052 | venues.claimed_by FK→ON DELETE SET NULL | PRESENT & CORRECT | PRESENT | present & matching | HIGH |
| 053 | reviews.tags text[] | PRESENT & CORRECT | MISSING | present; ledger-only (self-doc direct-to-prod) | HIGH |
| 054 | user_review_count_today() SECDEF; recursion-safe INSERT policy | PRESENT & CORRECT | PRESENT | present & matching | HIGH |
| 055 | venue_photos_venue_id_approved_idx: btree on venue_photos(venue_id, is_cover DESC, sort_order) WHERE status='approved'::photo_status | PRESENT & CORRECT (enum cast is expected, not a mismatch) | PRESENT | present & matching | HIGH |
| 056 | venue_field_proposals + venue_enrichment_runs + 4 RPCs + grants | **VERIFICATION IN PROGRESS (056a issued)** | MISSING | (pending) | — |

## Findings (carry forward)
- **F1 — discovery_approved data drift (044 side-finding):** 3,258 venues have discovery_approved=false while
  recommendation='discovery_approved' (approved+published). Operational drift from the non-atomic re-runnable
  scripts/venue-review/backfill.js (score upsert + venues propagation are separate steps), NOT a migration failure,
  NOT an exotic policy value (043 CHECK forbids it). DO NOT repair during this investigation.
- **F2 — systemic least-privilege ACL:** Supabase ALTER DEFAULT PRIVILEGES auto-GRANT ALL on new public tables to
  anon/authenticated/service_role. Confirmed via pg_default_acl. 050 (and others) never revoked it. RLS still gates
  row ops; TRUNCATE/REFERENCES/TRIGGER/MAINTAIN are outside RLS. See deferred_security_remediation.md (Finding 1).
- **F3 — 056 reviewed_by FK regression (account-deletion blocker):** venue_field_proposals.reviewed_by FK→profiles(id)
  on NO ACTION/RESTRICT (the bug 051/052 fixed). Footprint = 1 admin profile across 17 reviewed rows. GDPR Art.17
  relevant. Introduced by 056, NOT 051/052. See deferred_security_remediation.md (Finding 2). Confirm exact
  confdeltype during 056 verification.

## Drift-matrix categories so far (user's 5 buckets)
1. Physically present & correct: 044,045,046,047,048,049,050,051,052,053,054 (+055 expected). All objects present.
2. Present but definition differs: none material — only privilege diffs (045 extra service_role; 050 broad ACL).
3. Physically missing: NONE so far.
4. Ledger-only mismatch (objects present, no ledger row): 044,045,048,050,053 (and 056 pending).
5. Safest next action per migration: TBD after 056 + full matrix review (then reconciliation plan → 057 path).

## RESUME (next session)
1. ~~Run 055a (index check)~~ DONE 2026-07-04 — 055 CLOSED, PRESENT & CORRECT (see table above).
2. Verify 056 (the only one left): venue_field_proposals + venue_enrichment_runs tables, columns, the status CHECK
   constraint name (critical for 057's DROP/ADD), 4 RPCs (incl. exact propose_field signature 057 drops), RLS,
   grants, triggers. CONFIRM the reviewed_by FK confdeltype (F3). 056 ledger row = MISSING.
   **056a DONE 2026-07-04 — PASS.** Both tables physically present (venue_enrichment_runs 10 cols,
   venue_field_proposals 21 cols), RLS enabled/not forced on both, column lists match migration exactly.
   F3 UPGRADED from suspected to CONFIRMED: `reviewed_by` FK confdeltype = 'a' (NO ACTION), matches source
   (no `on delete` clause written).
   **056b DONE — PASS.** 2 PKs (id on both tables), 4 FKs (venue_enrichment_runs.venue_id→venues CASCADE;
   venue_field_proposals.run_id→venue_enrichment_runs CASCADE; .venue_id→venues CASCADE; .reviewed_by→profiles
   NO ACTION), 7 CHECK constraints (outcome 10-value, field 7-value, evidence_snippet ≤512, evidence_raw
   null-or-≤2048, extraction_method 4-value, confidence 3-value, status 5-value) — all match migration exactly;
   status check constraint name captured for 057 DROP/ADD compatibility.
   **056c DONE — PASS.** 10 indexes total (4 on venue_enrichment_runs incl. pkey; 6 on venue_field_proposals
   incl. pkey, partial pending_idx, unique partial one_pending_idx) — all present, uniqueness/predicates match.
   **056d DONE — PASS.** 2 RLS policies (`runs_admin_all`, `proposals_admin_all`, both cmd=ALL, using+with_check
   = `is_admin()`, no extra broad policies), 1 trigger (`venue_field_proposals_updated_at`, enabled, BEFORE
   UPDATE ROW → `touch_updated_at()`) — all match migration exactly.
   **056e DONE — PASS. MIGRATION 056 CLOSED.** All 4 RPCs present with correct signatures (propose_field
   confirmed as the sole 11-arg overload, no ambiguity), plpgsql, SECURITY DEFINER, search_path=public;
   snapshot_current_value STABLE, other 3 VOLATILE; execute grants exactly as intended (service_role-only on
   snapshot_current_value/propose_field; authenticated+service_role on apply/reject; zero anon/PUBLIC exposure).
   **Status CHECK constraint name CONFIRMED 2026-07-04 (re-queried directly):** `venue_field_proposals_status_check`,
   definition `CHECK ((status = ANY (ARRAY['pending'::text,'approved'::text,'rejected'::text,'applied'::text,
   'superseded'::text])))`. 057 can safely target this exact name in its DROP/ADD CONSTRAINT statements. Gap CLOSED.

**BLOCK 2 (044–056 object verification) — COMPLETE 2026-07-04.** See consolidated drift matrix in
project_progress.md "Session: 2026-07-04" entry (or ask to regenerate).

## LEDGER RECONCILIATION — EXECUTED 2026-07-04 (Option A)

Written plan: `scratchpad/ledger_reconciliation_plan_044_056.md`. Fresh preflight re-confirmed the plan was
still current (project ref `iftiyxwacptsyachgdus` matched; 6 gaps + 7 timestamp orphans unchanged; 057
confirmed absent; CI/CD check found nothing that could auto-race a repair). Liam approved Option A explicitly.

**Command run (real prod write, ledger table only):**
`supabase migration repair --status applied --linked 044 045 046 047 048 049 050 051 052 053 054 055 056`
→ succeeded, no errors: `Repaired migration history: [044...056] => applied`.

**Post-repair `supabase migration list --linked` verified:** 044–056 now show Local=Remote matched (e.g.
`044 | 044`); 057 still shows Local=057/Remote=blank (correctly untouched, not applied); the 7 timestamp
orphan rows (20260605211756, 20260605212043, 20260606142242, 20260607225234, 20260607225535, 20260609004736,
20260619200353) still present unchanged, as intended by Option A (append-only, nothing reverted/deleted).

**RESULT: the 044–056 prod ledger drift is FULLY RECONCILED.** `supabase db push` will no longer treat
044–056 as unapplied. Nothing else was touched — no schema/data change (repair only mutates the
`supabase_migrations.schema_migrations` bookkeeping table), no db push, 057 not applied, nothing committed/
pushed/merged/deployed.

**NEXT (separate, not yet started):** the 057 apply path is now the only remaining open thread from the
whole migration-drift investigation. It needs its own separately-approved plan (057 depends on 056's objects,
already proven correct; needs the `venue_field_proposals_status_check` constraint name — already confirmed —
plus a decision on whether F3's `reviewed_by` SET NULL fix rides along in 057 or ships as its own migration).
F1 (data drift) and F2 (systemic ACL) remain deferred, independent remediation items, not blocking.
3. Build consolidated drift matrix (the 5 buckets) → review with Liam → ONLY THEN discuss reconciliation + safe
   057 apply path. NO ledger repair / db push / 057 apply until the matrix is approved.

Related: [[deferred_security_remediation]], [[project-progress]], [[next-session-reminder]].
