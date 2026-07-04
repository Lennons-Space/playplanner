---
name: Next Session Reminder
description: Where to start the next PlayPlanner session
type: project
---

⏭ **START HERE (updated 2026-07-04, second session).** **THE ENTIRE MIGRATION THREAD IS CLOSED.**
057 was applied to production via the SQL Editor (runbook §3), all 13 post-apply verification blocks in
`scratchpad/apply_runbook_057_final.md` §4 passed, the 057 ledger repair was run and
`supabase migration list --linked` now shows **001–057 Local=Remote matched**. The 7 timestamp orphan rows
remain untouched by design. F3 (`venue_field_proposals.reviewed_by`) and F4
(`venue_enrichment_writes.applied_by`) are **FIXED in production** (both `ON DELETE SET NULL`).

**CURRENT STATE (post-057, branch `feat/website-enrichment-pr`):**
- Local repo made PR-ready 2026-07-04: 057 migration file verified byte-consistent with what was applied
  (BEGIN/COMMIT wrap, F3, F4, report_only status, venue_enrichment_writes, 14-arg propose_field, grant
  matrix). App/script integration for the 057 shape confirmed COMPLETE across enrichWebsites.ts CLI
  (passes p_decision/p_decision_reasons/p_decision_engine_version; downgrades auto_apply without
  --auto-apply-safe; never calls apply/rollback from service_role), hooks (useEnrichmentProposals,
  useEnrichmentBatch — all 6 auto-apply outcomes + 4 rollback outcomes handled), admin screen (4 tabs:
  Manual Review | Auto-Apply | Audit | Rollback; auto_reject/report_only never actionable), and
  types/enrichmentDecision.ts (single source of truth; no generated Supabase types exist in this repo).
- Gates all green 2026-07-04: test:db 37+50, targeted jest 462/462 (18 suites), FULL test:ci **1909/1909
  (100 suites)**, tsc 31 errors (= exact baseline, none in touched files), eslint 0 errors on touched files.
- DPIA updated: master §12 now includes venue_enrichment_writes retention; addendum §8 boxes closed
  (056 applied 2026-06-28, pilot done) + new §9 records 057 (decision engine, guarded auto-apply, ledger,
  F3/F4 SET NULL + accepted forensic-attribution trade-off).
- **NOTHING COMMITTED/PUSHED — awaiting Liam's explicit approval** (see final handoff report in the
  2026-07-04 second-session chat). Next human decisions: commit? push/update PR #1? on-device QA of the
  auto-apply/rollback tabs? deploy later?
- F1 (discovery_approved data drift, 3,258 venues) and F2 (systemic table ACL over-grant) remain DEFERRED —
  see [[deferred_security_remediation]]. Draft PR #2 (`feat/enrichment-exception-only`) decision still open.

(Everything below is HISTORICAL — the 057 apply path it describes was completed 2026-07-04.)

**RESUME — only remaining thread from this whole investigation:**
1. **The 057 apply path — LOCAL FILE + TESTS DONE, still NOT applied to prod.** `057_enrichment_auto_decision.sql`
   now has all 3 approved fixes (BEGIN/COMMIT wrap, F3 reviewed_by→SET NULL, F4 applied_by→SET NULL from
   creation). `supabase/tests/057_enrichment_auto_decision.mjs` has 10 new tests (50/50 pass, independently
   re-run twice). 056 suite still 37/37, tsc still 31/baseline. Independently reviewed by agent-arch,
   secom-reviewer (x2), and bughunter — all confirmed correct, ONE real gap found:
   - **MANDATORY pre-apply check (bughunter finding, not yet done):** the `DROP CONSTRAINT IF EXISTS
     venue_field_proposals_reviewed_by_fkey` name is inferred from Postgres auto-naming, never literally
     re-confirmed against live prod. If wrong, the DROP silently no-ops and a SECOND FK gets added — the
     original NO-ACTION constraint keeps blocking deletion, silently defeating the GDPR fix while tests
     stay green. MUST query `pg_constraint` on prod immediately before applying 057 and confirm exactly
     ONE FK row named `venue_field_proposals_reviewed_by_fkey` exists. This is now baked into the final
     preflight SQL (see the 2026-07-04 chat report / re-derive if needed).
   - Real locking risk (architecture review): section A's `ALTER TABLE ... DROP/ADD CONSTRAINT` on
     `venue_field_proposals` takes ACCESS EXCLUSIVE for the WHOLE transaction (single-tx apply) — apply
     during a low-traffic window; preflight must confirm no existing lock/long query on that table first.
   - `BEGIN;`/`COMMIT;` wrap is REQUIRED (not just prudent) since `CREATE POLICY` has no `IF NOT EXISTS`
     form — the one non-idempotent statement in 057.
   - Full preflight checklist, draft apply SQL, post-apply verification queries, and rollback plan were all
     produced in the 2026-07-04 chat session (supersedes the earlier `scratchpad/apply_plan_057.md`, which
     predates the F3/F4 code changes — treat that file as historical context only, not the current SQL).
   - **ALL 9 MANDATORY PREFLIGHT CHECKS RUN LIVE AGAINST PROD 2026-07-04 — ALL CLEAN.** Runbook:
     `scratchpad/apply_runbook_057_final.md` (§2). Results: (1) reviewed_by FK confirmed
     `venue_field_proposals_reviewed_by_fkey`, confdeltype='a', matches 057's DROP-target assumption exactly;
     (2) 17 rows total (12 applied/5 rejected/0 pending), matches known baseline, no unexpected statuses;
     (3) status check confirmed `venue_field_proposals_status_check`, still the 5 pre-057 values; (4)
     `propose_field` confirmed still the sole 11-arg overload; (5) `venue_enrichment_writes` confirmed does
     NOT exist yet; (6) the 5 new decision columns confirmed do NOT exist yet; (7) no locks/long queries on
     `venue_field_proposals`; (8) manually confirmed no admin using the review screen and the enrichment CLI
     script not running; (9) full pre-apply snapshot of all 17 `venue_field_proposals` rows saved by Liam as
     the backfill rollback reference.
   - **Nothing applied. Liam explicitly said STOP and wait for separate approval before running the apply
     step** — preflight-complete is NOT authorization to apply. Next session: wait for Liam's explicit
     go-ahead, then walk through §3 (apply strategy) and §4 (post-apply verification) of the runbook the
     same block-by-block way preflight was done.
2. F1 (discovery_approved data drift, 3,258 venues) and F2 (systemic Supabase-default table-ACL over-grant) are
   DEFERRED, independent remediation items — not blocking 057, see [[deferred_security_remediation]].
3. Separately: Draft PR #2 (`feat/enrichment-exception-only`, 3 commits) is still open, unmerged, awaiting a
   decision independent of the ledger work.

(Everything below this point — the old 055a/056-verification/matrix-building steps and the F1/F2/F3 summary —
is now HISTORICAL; superseded by the completed work above. Full detail preserved in
[[migration-drift-044-056-block2]] and [[deferred_security_remediation]].)

Block 1 RESULT (confirmed): prod ledger = 001–043 + 7 timestamp rows (=046,047,049,051,052,054,055); NO ledger
row for 044,045,048,050,053,056,057 (out-of-band SQL-Editor applies). Block 2 proved every 044–055 schema object
PRESENT & CORRECT (objects fine; the drift is ledger-only on 044/045/048/050/053). After 056 → drift matrix →
reconciliation → safe 057 apply path (reviewed SQL txn, NOT db push) + deploy order vs Draft PR #2.

**Feature status (DONE, parked):** exception-only enrichment = 3 commits `1036d4e`/`90cf68f`/`94f2516` pushed to
`feat/enrichment-exception-only`; **Draft PR #2** open (Liam opened it in browser — gh acct TheDon92 is read-only
on the repo). Migration `057` committed but UNAPPLIED. Gates were all green (tsc 31/0-new · test:db 40/40 ·
test:ci 100/1909).
The 2026-06-28 block below is historical (the visual smoke test / pilot batch were completed in a later session).

---

⏭ **(historical) START HERE (updated 2026-06-28).** Branch `feat/website-enrichment-pr`. Strict SAFETY-FIRST session policy
in force (confirm before any prod/write/git-push/migration action; treat ambiguity as do-not-run; keep a
command audit log). PR **#1** OPEN, Ready-for-review (not draft), NOT merged, base `main`, **5 commits**, tip
**`2041ed8`**.

**SHIPPED & PUSHED (all on the remote feature branch / PR #1):**
- `6fb727f` 016 fresh-replay fix; `ada6d66` 056 grant least-privilege hardening (+pglite tests); `df1b320`→
  amended `a8bef98` review fixes M1–M5 (email normalise+DB guard, CSV formula-injection, duplicate-day guard,
  +tests); `2041ed8` **admin enrichment review screen** (`app/admin/enrichment.tsx`,
  `hooks/useEnrichmentProposals.ts`, `app/admin/__tests__/enrichment.test.tsx`, nav link in
  `app/admin/moderation.tsx`). Gates at last check: tsc **31** (baseline, 0 in changed files), focused 33/33,
  **test:ci 94 suites/1746**, lint 0 err.
- 056 IS APPLIED IN PROD (Liam applied via SQL editor + verified: 2 tables/0 rows, 4 RPCs, privilege matrix
  correct). Prod dashboard had a transient "no access" scare → Liam confirmed access restored.
- **PILOT DONE:** read-only dry run (5/5 extracted) THEN `--propose --limit=5` ran against PROD → **17 PENDING
  proposals** now live in `venue_field_proposals` (5 runs in `venue_enrichment_runs`). NO live venue fields were
  changed. Distribution: phone 4, email 4, description 5, booking_url 2, website 1, opening_hours 1. Hillview
  `website` flagged conflicts_existing; the 2 booking_url have no target column (cannot apply).

**WHERE WE STOPPED:** doing a LOCAL on-device visual smoke test of the admin screen. `npx expo start` was
running (Metro on :8081) for Liam to open Expo Go on Android, sign in as admin, and visually verify the 17
proposals render (grouping, badges, conflict warning, booking_url "NO TARGET COLUMN", description Apply
disabled until rewrite, Hollywood 7-day hours, reject-requires-note). **The visual pass was NOT completed yet.**
(The dev server was stopped at end of session — restart with `npx expo start` to resume.)

**NEXT:** (1) finish the on-device visual smoke test (Liam drives; report defects, fix-after-report). (2) THEN
the real admin-review batch: Liam's decisions are recorded in the 2026-06-28 chat — 7 scalars approve+apply,
5 descriptions approve+apply with rewritten text, 5 rejects with notes — to be executed THROUGH THE NEW ADMIN
SCREEN by an authenticated admin (NOT raw SQL, NOT service_role — both fail is_admin()). Each apply is
stale-guarded. Get explicit go before resolving any proposal.

**STILL OPEN / GATES (unchanged):** PROD migration-ledger drift (044–056: 7 timestamp rows + 5 missing 3-digit
rows) UNRESOLVED; Plan B (ledger-only `migration repair`) DECLINED. Do NOT `supabase db push` / migration
repair / merge PR / deploy until separately approved. The 4 governance doc edits + 3 import-order script edits
remain uncommitted/out of scope.

--- (historical, pre-fix diagnosis below) ---

We were mid-DIAGNOSIS of migration-history problems on branch
`feat/website-enrichment-pr`. **Nothing has been edited/applied/committed/pushed.** Prod accessed READ-ONLY only.
Do NOT: edit/rename old migrations, run `supabase db push`, use `migration repair`, apply 056, run
`--propose`/`--apply`, merge, deploy, or commit — until Liam approves a specific plan.

## THE BIG PICTURE (two separate problems, both DIAGNOSED)
1. **Local fresh replay fails at migration 016** (NOT 013, as the old note said). 013 makes a partial unique
   INDEX `venues_osm_id_unique`; 016 makes a CONSTRAINT of the same name first → `42P07 already exists`.
   Prod has both applied (manual DROP INDEX done out-of-band, never put in the file). Fresh-replay-only bug.
   **Fix (approved? NO):** prepend `DROP INDEX IF EXISTS venues_osm_id_unique;` to 016. Safe (prod won't re-run 016).
2. **044–056 ledger drift.** Prod ledger = 001–043 + 7 TIMESTAMP rows (= local 046,047,049,051,052,054,055).
   Local **044,045,048,050,053** have NO ledger row but their objects DO exist in prod (applied direct-to-prod).
   056 not in prod (correct). Prod schema complete through 055. Because remote uses 14-digit versions and local
   uses "044".."056", **`db push` would try to re-apply ALL of 044→056 to PROD and break / risk pushing 056.**

(Full detail incl. the 7 version→name mappings and the verified-present object list is in [[project-progress]]
under "Session: 2026-06-26/27".)

## RESUME EXACTLY HERE (the user interrupted just before these)
- [ ] Run **`supabase db push --dry-run`** (READ-ONLY, does not push) and capture the exact list it would apply.
- [ ] Confirm idempotency of 044 (`ADD COLUMN`?) and 049 (`CREATE INDEX/TRIGGER/POLICY` lack `IF NOT EXISTS`).
- [ ] Finalise the reconciliation TABLE (local | remote version | equivalent? | object present in prod? | db-push risk).
- [ ] Produce the ranked **reconciliation plan**. Leading candidate: `supabase migration repair --status applied
      <the 5 missing 3-digit versions + reconcile the 7 timestamp rows>` so the ledger matches reality WITHOUT
      re-running SQL — then 016 one-line fix can be handled separately. NEEDS LIAM APPROVAL before running anything.
- [ ] Decide order: reconcile ledger FIRST, then 016 replay fix, then (separate gate) the 056 non-prod validation.

## STILL-PENDING GATES (unchanged, all still require Liam's explicit go)
- Migration 056 NOT applied anywhere. The non-prod "apply 056 for validation" approval sentence is still the
  eventual gate — but BLOCKED until (a) 016 replay fix + (b) ledger drift are resolved so a clean env can exist.
- The 4 governance doc edits (DPIA §2.6 LIA + §12 retention; addendum signed-off; checklist §9 box) remain
  UNCOMMITTED. The 3 import-order script edits remain uncommitted (not part of PR).
- The 5-venue `--propose` pilot is a separate, still-unauthorised gate.

## ENV / TOOLING (working now)
- Docker Desktop + WSL OK. `supabase start` reproduces the 016 error then auto-stops the stack.
- CLI v2.84.2, linked to prod `iftiyxwacptsyachgdus` (pooler aws-1-eu-west-2). Read-only `supabase db dump
  --linked` works without a password prompt (creds cached). Scratchpad has remote_ledger.sql + remote_public_schema.sql.
- pglite `test:db` only tests 056 on a bootstrap — it is NOT a full-chain validator. 056 is independently safe.
