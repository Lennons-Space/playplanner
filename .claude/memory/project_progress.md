---
name: Project Progress
description: Current state, decisions made, and what needs to happen next for Play Planner
type: project
---

## Session: 2026-06-30 — Read-only PROD migration-ledger drift investigation (044–056). IN PROGRESS, paused mid-Block-2. NOTHING applied/written; prod read-only via SQL Editor only.

**Resume = run Block 2 section-by-section in Supabase SQL Editor (next up: 044a), I check each result before giving the next.** Strictly read-only. Prod is NOT reachable from the CLI here (Docker Desktop down → `supabase db dump --linked` fails before connecting), so all prod inspection is hand-run SQL the user pastes into the SQL Editor. Branch `feat/enrichment-exception-only`. **No migration applied, no db push, no migration repair, no ledger change, no code edit, no commit/push/merge/deploy.**

### Why this investigation
Draft **PR #2** (branch `feat/enrichment-exception-only`, 3 commits `1036d4e`/`90cf68f`/`94f2516`) holds the exception-only enrichment feature incl. migration **057** (unapplied). 057 must NOT be applied until we understand the 044–056 prod ledger-vs-schema drift and produce a safe 057 apply path. 057 depends on 056 (drops the 11-arg `propose_field` → creates 14-arg; adds decision cols + `venue_enrichment_writes` ledger + `auto_apply_venue_proposal`/`rollback_enrichment_run`).

### Block 1 (ledger) — RESULT CONFIRMED by Liam
Prod `supabase_migrations.schema_migrations` = sequential **001–043** + **7 timestamp rows** = local **046,047,049,051,052,054,055**. **NO ledger row** for local **044,045,048,050,053,056,057**. (056 was applied via SQL Editor 2026-06-28 → objects present but no ledger row, same as the other out-of-band applies; 053 self-documents its direct-prod apply.) → drift looks **ledger-only / mixed-version-format**, not schema-incomplete — but 044–056 schema effects still need object-level proof (Block 2). DANGER restated: remote uses 14-digit timestamp versions, local uses 3-digit → `supabase db push` would treat 044–057 as unapplied and try to re-run them (several non-idempotent: 049/056 lack IF NOT EXISTS on indexes/triggers/policies). DO NOT db push / migration repair.

### Block 2 (044–055 object verification) — READY, RUNNING NOW section-by-section
Finalised read-only SQL pack lives in the 2026-06-30 chat. Order: 044a (col) · 044b (gate idx) · 044c (backfill counts, to_jsonb text-compare, no ::boolean) · 045 (get_nearby_venues overloads + discovery_approved-in-body bool) · 046 (pass_interest policy) · 049a–d (table/RLS/6 idx/trigger/2 policies) · 050a–c (2 tables/RLS/3 triggers/policies) · 051+052 (7 FKs must be confdeltype='n' SET NULL) · 053 (reviews.tags) · 054 ("Users can write reviews" with_check references user_review_count_today) · 055 (partial approved-photo idx def). Robustness fixes already baked in: jsonb_typeof guard on stmt_count; `to_regclass` for tables but `pg_proc`/`pg_namespace` overload-count for functions (NOT `to_regproc`); catalog joins by name (no `'x'::regclass` literals).

### Blocks 3–7 (after Block 2) — already drafted in chat
3 = 056 tables/cols/constraints/indexes (incl. exact name of status CHECK constraint, critical for 057's DROP/ADD). 4 = 056/057 RLS/policies/triggers + table grants (relacl/aclexplode). 5 = AUTHORITATIVE fn signatures+ACLs via pg_proc.proacl+aclexplode (must confirm `propose_field` is the exact 11-arg form 057 drops, and 057's 3 fns are ABSENT). 6 = proposal/run data state + 057-column presence (status counts; decision via to_jsonb; information_schema for the 5 decision cols → expect 0). 7 = 057 prerequisite relations/columns (to_regclass tables + pg_proc fns + venues/opening_hours/profiles target cols).

### Then: Steps 4 & 7 of the task
Build the reconciliation matrix (one row per 044–056: local file ✓ / ledger row ✓ / expected vs actual objects / classification) → 056 contract verdict → whether 057 prereqs satisfied → safest evidence-backed 057 apply path (a reviewed SQL transaction in SQL Editor, NOT db push/repair) with preflight/verify/rollback + deployment order vs PR #2.

---

## Session: 2026-06-29 (d) — Phase 5 fixes EXECUTED + lead-verified, then feature COMMITTED in 3 clean commits. Pushed to branch `feat/enrichment-exception-only`; Draft PR #2 opened (by Liam in browser — gh CLI account TheDon92 is read-only on the repo). 057 not applied; prod untouched.

### COMMITS (2026-06-29 (d), branch `feat/website-enrichment-pr`, NOT pushed)
- `1036d4e` **feat(enrichment): add deterministic decision engine** — 8 files: types/enrichmentDecision.ts, scripts/enrich/DECISION_CONTRACT.md, scripts/enrich/web/decision.ts (incl. Phase 5 A+D, inseparable new file), orchestrate.ts, report.ts, enrichWebsites.ts, web/__tests__/decision.test.ts (incl. Phase 5 regression), web/__tests__/runReport.test.ts.
- `90cf68f` **feat(enrichment): add guarded auto-apply and rollback ledger** — 3 files: supabase/migrations/057_enrichment_auto_decision.sql, supabase/tests/057_*.mjs, package.json (test:db script extended to run 057 — required to run the committed DB test).
- `94f2516` **feat(admin): add exception-only enrichment workflow** — 12 files: hooks/useEnrichmentProposals.ts (+Phase5 D-defense/E), useEnrichmentBatch.ts, both hook tests, components/admin/{EnrichmentSummary,AutoApplyBatchPanel(+F/G),EnrichmentAudit,EnrichmentRollback(+H)}.tsx, the 2 new component tests, app/admin/enrichment.tsx (+Phase5 B/C), app/admin/__tests__/enrichment.test.tsx.
- **Commit 4 (Phase 5) deliberately COLLAPSED into 1+3:** every Phase 5 fix lives in a NEW file (whole-feature) or interleaved in a tracked file with Phase 4; isolating it needed interactive `git add -p` (unavailable) or hand-edited patches (forbidden). Smallest honest boundary chosen per Liam's instruction. Each fix's host commit is annotated above.
- **Gates re-run against committed state — all green:** tsc 31/0-new · focused 179/179 · test:db 40/40 · test:ci 100 suites/1909 · eslint 12 committed source files 0-err/0-warn.
- **LEFT UNCOMMITTED (unrelated, untouched):** .claude/memory/*, docs/DPIA.md + addendum, MIGRATION_056_APPLY_CHECKLIST.md, collectGeoapify{Fixtures,Popular}.ts + enrichVenues.ts (import-order), claudedesign/, design_handoff/, scripts/verify/, supabase/.gitignore + config.toml.

### NEXT (await Liam)
NOT pushed. Decisions open: (1) push the 3 commits / PR; (2) 057 apply-to-prod path (still local-only); (3) the 044–056 prod ledger drift remains UNRESOLVED (do NOT db push / migration repair). NO push/apply until separately approved.

---

## Session: 2026-06-29 (d, pre-commit) — Phase 5 fix plan EXECUTED via MainCoder + lead-verified. ALL GATES GREEN.

**State:** The 7 confirmed-FIX bugs (A,B,C,D,E,F,H) from the (c) review were implemented by one MainCoder agent, then the lead independently inspected every edit site against the live code (did NOT trust the agent report) and re-ran ALL gates personally. Bug G honored as DOCUMENT-ONLY per Liam's explicit decision (one comment in AutoApplyBatchPanel beside the isRunningRef guard; NO lock, NO behavior change, NO fake test). I/K/J + 2 secom notes left untouched as accepted. **Nothing committed/pushed; migration 057 NOT applied; prod NOT contacted.** Branch `feat/website-enrichment-pr`.

### Reconciliation (resolved a count discrepancy first)
The (c) "EXACT EDITS" = 9 edits but only 7 distinct FIX bugs — because Fix D spans 3 edits (engine return + `.neq` defense + DECISION_CONTRACT.md). My earlier table said "8 bugs" — that was a miscount; correct = **7 fixes**. Bug G is a CONFIRMED-but-ACCEPT (document-only) finding, never one of the 9 edits.

### Files changed (11, all uncommitted) — each lead-verified at the edit site
- `scripts/enrich/web/decision.ts` — [A] L250 `if (looksPersonalEmail(singleEmail) || isFreeMailEmail(singleEmail))`; [D] L628 description final return `auto_apply`→`manual_review`, reasons `['description_facts_sufficient']`, keeps generatedText.
- `hooks/useEnrichmentProposals.ts` — [D-defense] L252 `.neq('field','description')` in `useAutoApplyCandidates`; [E] `invalidateAfterResolve` L446/448 adds `applied-writes` + `run-writes`.
- `app/admin/enrichment.tsx` — [B] L95 `intervals?:` optional + L1008/L1298 `|| !day.intervals` guard (+ `(day.intervals ?? []).map`); [C] L176 + L1095 discriminator → `decision_engine_version && !== 'legacy-pilot'` (matches the already-correct L882).
- `components/admin/AutoApplyBatchPanel.tsx` — [F] L148/L150 adds `pending-proposals` + `applied-writes`; [G] L138-142 document-only comment.
- `components/admin/EnrichmentRollback.tsx` — [H] L110 `venueName?` prop, L118 `venueName ?? id.slice(0,8)+'…'`, L145 `venueNameById` useMemo over writes, L315 passes prop.
- `scripts/enrich/DECISION_CONTRACT.md` — [D contract] §7 + §7a: description NEVER auto_apply.
- Tests: `decision.test.ts` (Case1+Case5 → manual_review; +T1,T2,Td), `enrichment.test.tsx` (+T3a,T3b,T4a,T4b), `useEnrichmentProposals.test.ts` (+T5,T6a-c), NEW `components/admin/__tests__/AutoApplyBatchPanel.test.tsx` (T-F ×2), NEW `components/admin/__tests__/EnrichmentRollback.test.tsx` (Fix H ×2). 15 new tests total.

### GATES (lead re-ran ALL independently — green; deltas reconcile)
- tsc **31 = baseline, 0 new**. · focused 6 suites **179/179**. · test:db **40/40**. · eslint 5 source files **0 err / 0 warn** (24 warnings are test-file-only: no-require-imports / import/first / display-name — pre-existing repo patterns). · **test:ci 100 suites / 1909** (was 98/1894 → +2 new suites, +15 new tests; math reconciles exactly, no test weakened/skipped/deleted).

### NEXT (await Liam)
Feature is GREEN and (per lead) commit-ready. Decisions still open: (1) commit boundaries for the whole exception-only feature; (2) 057 apply path to prod (still local-only); (3) the 044–056 prod ledger drift remains UNRESOLVED (do NOT db push / migration repair). NO commit/push/apply until separately approved.

---

## Session: 2026-06-29 (c) — Phase 5 review DONE (both reviewers returned); all findings VERIFIED against code; FIX PLAN locked. NO FIXES APPLIED YET. Resume = execute the fix plan below.

**State:** Two read-only reviewers ran in parallel. secom-reviewer = PASS, NO critical/high security findings.
bughunter = several correctness findings. Lead (me) independently re-read all cited code and verified each.
**Nothing edited/committed/pushed; 057 still local-only; prod untouched.** Branch `feat/website-enrichment-pr`.

### secom-reviewer verdict (all PASS)
service-role absent from client bundle (anon key only); RPC authz (is_admin + SECURITY DEFINER + fixed
search_path + authenticated-only grants on auto_apply/rollback); append-only ledger admin-SELECT-only RLS;
safe RN <Text> render; error-code-only logging; 057 idempotent; GDPR/Children's-Code OK. Two NOTES: (1) LOW
`Linking.openURL(source_url)` no render-time scheme guard (urlSafety.ts guards at extract time) — ACCEPT, not
fixing; (2) MEDIUM no composite (status,decision) index — ACCEPT for now (17-row dataset; 057 not applied).

### bughunter findings + MY VERDICTS (verified against code)
- **A [HIGH] CONFIRMED — FIX.** `decision.ts decideEmail` ~L259: a SINGLE free-mail email (info@gmail.com) with
  empty current → auto_apply (looksPersonalEmail `/^[a-z]+[._][a-z]+$/` misses `info`), even tagging
  'official_domain_source'. Should be manual_review.
- **B [MED→crash] CONFIRMED — FIX.** `app/admin/enrichment.tsx` L1008 & L1298: `day.is_closed || day.intervals.length`
  crashes if a day lacks `intervals` (valid per 056 apply coalesce). Crashes Review tab + Confirm modal.
- **C [MED] CONFIRMED — FIX.** enrichment.tsx `descriptionInitial` L176 + `isEngineDraft` L1095 discriminate on
  `decision==='manual_review'`, but 057 backfill sets LEGACY rows to that → legacy scraped text prefilled as
  "Engine draft". Correct discriminator already used at L882: `decision_engine_version && !== 'legacy-pilot'`.
- **D [MED→HIGH] CONFIRMED — FIX (engine).** `decision.ts decideDescription` L625-631 can emit description
  `auto_apply`. But 057 RPC ALWAYS returns validation_failed for description, AND the manual queue filters
  decision='manual_review' → a description auto_apply row is ORPHANED (not in batch result usefully, invisible in
  review). Fix = engine: description never auto_apply → manual_review (keep generatedText). Also add
  `.neq('field','description')` to useAutoApplyCandidates as defense-in-depth.
- **E [MED] CONFIRMED — FIX.** `useEnrichmentProposals.ts` `invalidateAfterResolve` L441-446 omits
  `['enrichment','applied-writes']` + `['enrichment','run-writes']` → Audit tab stale after manual apply.
- **F [MED] CONFIRMED — FIX.** `AutoApplyBatchPanel.tsx handleConfirmBatch` L136-144 omits
  `['enrichment','pending-proposals']` + `['enrichment','applied-writes']` → Review/Audit stale after batch
  (moved_to_manual_review items don't show).
- **H [LOW] CONFIRMED — FIX (cheap).** `EnrichmentRollback.tsx RollbackResultRow` L118 shows venue_id.slice(0,8)
  not name. Build venueNameById from `writes` (already has venues.name) and pass into the result rows.
- **G [LOW] ACCEPT (no fix).** Concurrent batch if user navigates away mid-batch + returns (per-instance useRef
  guard). DB stale-hash guard limits harm to a tiny window; cross-instance guard = added scope. Document only.
- **I [SUSPECTED MED] ACCEPT (no fix).** `central_vs_branch_conflict` reason code declared but never emitted;
  case still correctly → manual_review via `multiple_values_conflict`. Real detection needs orchestrator
  provenance = scope creep. Leave code in union (valid future code).
- **K [SUSPECTED LOW] ACCEPT (no fix).** hasHoursWarning broad phrases ('may vary' etc.) → at worst a valid
  hours row goes manual_review (errs SAFE). Speculative rate. Leave.
- **J CLEARED by bughunter** (opening-hours rollback key format matches 056 snapshot — opens_at/closes_at).

### EXACT EDITS TO MAKE (tomorrow)
1. `scripts/enrich/web/decision.ts` L249: `if (looksPersonalEmail(singleEmail))` → `if (looksPersonalEmail(singleEmail) || isFreeMailEmail(singleEmail))` (update comment L247-248 to mention free-mail). [Fix A]
2. `scripts/enrich/web/decision.ts` L625-631: change description final `decision: 'auto_apply'` → `'manual_review'`, reasons `['description_facts_sufficient']`, keep generatedText. [Fix D]
3. `app/admin/enrichment.tsx`: make `OpeningDayDisplay.intervals` optional (`intervals?:`); L1008 & L1298 add `|| !day.intervals` before `.length`. [Fix B]
4. `app/admin/enrichment.tsx` L176 `descriptionInitial`: condition → `if (proposal.decision_engine_version && proposal.decision_engine_version !== 'legacy-pilot')`. L1095 `isEngineDraft`: same discriminator. [Fix C]
5. `hooks/useEnrichmentProposals.ts` `invalidateAfterResolve`: add invalidate `['enrichment','applied-writes']` + `['enrichment','run-writes']`. [Fix E]
6. `hooks/useEnrichmentProposals.ts` `useAutoApplyCandidates`: add `.neq('field','description')`. [Fix D defense]
7. `components/admin/AutoApplyBatchPanel.tsx` `handleConfirmBatch`: add invalidate `['enrichment','pending-proposals']` + `['enrichment','applied-writes']`. [Fix F]
8. `components/admin/EnrichmentRollback.tsx`: build `venueNameById` (useMemo over `writes`), pass venueName into RollbackResultRow; show name ?? id.slice(0,8). [Fix H]
9. `scripts/enrich/DECISION_CONTRACT.md` §7 table + §7a: state description is NEVER auto_apply (manual_review max). [contract sync for D]

### EXISTING TESTS THAT WILL BREAK / NEED UPDATING (found via grep, MUST handle)
- `scripts/enrich/web/__tests__/decision.test.ts` L444 "Case 1: auto_apply when current empty and known
  category + city" and L490 "Case 5: auto_apply with Pattern B" — these assert description `auto_apply`; after
  Fix D they must assert `manual_review`. (Other auto_apply tests L200/216/307/343/388/584/783 are phone/email/
  generic — unaffected. L391 personal email → manual_review unaffected; L365 free-mail in MULTI-email unaffected.)
- `app/admin/__tests__/enrichment.test.tsx` Phase-4 prefill block L1556-1650: fixtures asserting prefill "when
  decision=manual_review" (L1564,1579,1609,1644) must ALSO set `decision_engine_version` non-legacy (e.g.
  'decision-engine@1.0.0') or they'll now return blank after Fix C. L1594 "does NOT prefill when decision null"
  still OK. L456 "renders description input (not prefilled)" — check its fixture's decision_engine_version (must
  be null/legacy to stay blank). L1337 fixture has `decision_engine_version: '1.0.0'`.

### NEW REGRESSION TESTS TO ADD (one per confirmed bug)
- decision.test.ts: T1 single free-mail (info@gmail.com, empty current) → manual_review, no 'official_domain_source';
  T2 single free-mail == current → auto_reject (equals_current); Td description empty+facts → manual_review (Fix D).
- enrichment.test.tsx: T3 opening_hours day missing `intervals` renders "Closed" no crash (FieldValueDisplay +
  ConfirmModalNewValue); T4 descriptionInitial legacy(version='legacy-pilot')→blank, engine(version=
  'decision-engine@1.0.0')→prefilled.
- useEnrichmentProposals/batch test: T5 description excluded from auto-apply candidates (assert .neq chain or
  filtered result); T6 invalidateAfterResolve invalidates applied-writes (spy invalidateQueries); T-F batch
  invalidates pending-proposals (spy).
- EnrichmentRollback test: rollback results show venue NAME when available.

### GATES baseline to re-hit after fixes
tsc 31/0-new · test:db 40/40 · decision 70/70 (will change count with new tests) · focused admin+batch 90/90 ·
eslint changed files 0-err · test:ci was 1894/1894 (98 suites) before fixes. Re-run ALL after edits.

---

## Session: 2026-06-29 (b) — Phase 4 exception-only admin layer BUILT + independently gate-verified. CHECKPOINT (uncommitted, nothing applied to prod).

**Re-ran Phase 4 via one focused elite-engineer agent (main working tree, no worktree this time → work persisted).** Lead
independently re-ran ALL gates (did not just trust the agent). Branch `feat/website-enrichment-pr`.

### Files (9) — all uncommitted
- Modified: `hooks/useEnrichmentProposals.ts`, `app/admin/enrichment.tsx`, `app/admin/__tests__/enrichment.test.tsx`.
- New: `hooks/useEnrichmentBatch.ts`, `hooks/__tests__/useEnrichmentBatch.test.ts`, `components/admin/{EnrichmentSummary,AutoApplyBatchPanel,EnrichmentAudit,EnrichmentRollback}.tsx`.
- The existing manual-review screen parts (ProposalCard, confirm/reject modals, per-field actions) were REUSED, not rebuilt.
- enrichment.tsx now tabbed: default `review` (manual_review cards only) + summary / apply-safe / audit / rollback tabs.

### Contract fidelity (lead-verified)
- Batch hook calls `auto_apply_venue_proposal({ p_proposal_id, p_applied_text: null })` — CORRECT 057 signature, NO hash
  param (the task prose's `expected_current_hash` was wrong; staleness is re-checked INSIDE the RPC). Sequential; stops on
  `not_authorized` (both as JSON outcome and as auth error code 42501/PGRST301/PGRST302); `stale`/`validation_failed`
  never counted as applied; ref-guarded against double-tap; authenticated client only; descriptions never auto-applied.

### GATES (lead re-ran independently — all green)
- tsc: **31 = baseline, 0 new**. · focused Phase 4: **90 passed** (27 batch + 63 admin). · test:db: **40/40**.
  · decision engine: **70/70**. · eslint changed files: **0 errors** (12 warnings, all test-file require()/display-name
  style — non-blocking, matches repo convention; agent's "0 warnings" was slightly off). · **test:ci: 1894/1894, 98 suites.**

### STILL NOT DONE (await Liam)
Phase 5 independent review (secom-reviewer / bughunter / sloppy-ai-code-detector) on the full feature was NOT yet run.
NO commit/push. Migration 057 still LOCAL-ONLY (not applied to prod). Prod (per Liam) = 12 applied / 5 rejected / 0
pending — not contacted this session. Recommended next: Phase 5 review → then decide commit boundaries / 057 apply path.

---

## Session: 2026-06-29 — Exception-only decision engine: Phases 1–3 PRESENT & PASSING; Phase 4 UI LOST in session reset. CHECKPOINT (nothing applied/committed).

**Context:** agented 5-phase build of the exception-only Website Enrichment decision engine. Session hit
its usage limit mid-flight; the Phase 4 UI agent's output did NOT survive the reset. This is a verified
checkpoint before deciding whether to re-run Phase 4. **Branch `feat/website-enrichment-pr`.**

### VERIFIED PRESENT (all uncommitted, working tree only)
- **Phase 1 contract:** `types/enrichmentDecision.ts` (EnrichmentDecision / ProposalStatus / AppliedMode /
  ReasonCode + REASON_LABELS / DECISION_ENGINE_VERSION='decision-engine@1.0.0' / RPC + FieldDecision +
  EnrichmentBatchSummary types) + `scripts/enrich/DECISION_CONTRACT.md` (markdown mirror, the SQL↔TS source of truth).
- **Phase 2 engine:** `scripts/enrich/web/decision.ts` (decision engine + deterministic description composer
  live INSIDE this file — no separate composer file). `orchestrate.ts`/`report.ts`/`enrichWebsites.ts` modified.
- **Phase 2 DB:** `supabase/migrations/057_enrichment_auto_decision.sql` + `supabase/tests/057_..mjs`.
  057 adds decision columns (decision/decision_reasons/decision_engine_version/decision_at/applied_mode),
  `venue_enrichment_writes` immutable ledger, `_enrichment_apply_write`, refactored `apply_venue_proposal`,
  NEW `auto_apply_venue_proposal(uuid,text)` (authenticated ONLY), NEW `rollback_enrichment_run(uuid)`
  (authenticated ONLY), extended `propose_field` (14-arg; 11-arg DROPped so no ambiguous overload).
  Backfill stamps ALL pre-057 rows decision='manual_review', engine_version='legacy-pilot', reason
  '["legacy_manual_pilot"]'. **057 NOT applied to prod (prod latest = 055/056-objects).**

### GATES VERIFIED THIS SESSION (integrated tree)
- `type-check` (tsc): **31 errors = baseline, 0 new** (contract + decision.ts clean).
- `test:db` (056 + 057 pglite): **40 passed, 0 failed** (auto-apply empty/non-empty/stale/invalid, rollback
  round-trip + duplicate + skipped_newer_change + scalar restore + mixed batch, ledger RLS, 056 compat).
- `decision.ts` unit tests: **70 passed, 0 failed** (phone/email/URL dedup, description→validation_failed,
  version stamping, pilot-derived cases).
- Reconciliation cross-check (done earlier in session, re-confirmed): TS↔SQL propose_field param names match
  (TS omits only p_retrieved_at = SQL default); decision/status/applied_mode CHECK strings mirror the contract;
  decision→status CASE matches DECISION_TO_INITIAL_STATUS; exactly one propose_field (no overload).

### LOST — Phase 4 admin UI (must be re-done if wanted)
The Phase 4 elite-engineer agent reported done, but NOTHING of its output is in the tree: `app/admin/enrichment.tsx`
is NOT modified (last change = committed ddeba68), no new screens/components/tests, no worktree/stash holds it.
The only stray branch `worktree-agent-a9b1c011` is unrelated pre-reskin cruft. **Treat Phase 4 as not started.**

### EXISTING COMMITTED UI = manual-review only (pre-decision-engine)
`app/admin/enrichment.tsx` (1167 ln) + `hooks/useEnrichmentProposals.ts` (223 ln) + test (1077 ln). Strong on:
per-proposal cards, evidence/source/retrieved display, conflict + low-confidence badges, two-step
approve→apply confirm modal, reject-with-note, description rewrite box, opening-hours 7-day + Alert, booking_url
NO-TARGET, approved-but-unapplied retry/return. MISSING (the exception-only Phase 4 scope): decision-based
filtering (hook filters status only, not decision='manual_review'), run summary counts, auto_apply batch
preview + "Apply N safe changes" driver, per-item batch success/failure, audit/history view, run-scoped rollback.
Hook imports `@/types/webEnrichment` only — does NOT yet import `types/enrichmentDecision.ts`.

### PROD STATE (per Liam, not re-verified this session — did NOT contact prod)
12 applied + 5 rejected + 0 pending (the 17 pilot proposals were resolved via the admin screen in a prior session).
No production data changed this session. **No commit, no push, no migration apply, no branch switch.**

### NEXT (await Liam)
Decide Phase 4: (option) re-run a focused UI agent to add exception-only layer ON TOP of the existing screen
(small/medium — extend hook + screen, do NOT rebuild the working manual-review parts), then Phase 5 review + gates.
Recommendation + coverage matrix delivered in chat 2026-06-29.

---

## Session: 2026-06-28 — 056 applied to prod (by Liam), 5-venue pilot → 17 PENDING proposals, admin review screen built+pushed. Pilot NOT yet human-reviewed.

**Strict safety-first policy throughout** (confirm before prod/write/push/migration; ambiguity=do-not-run; audit log every turn).

### Shipped & pushed to PR #1 (OPEN, ready-for-review, NOT merged; base main; 5 commits; tip `2041ed8`)
- `6fb727f` 016 fresh-replay fix · `ada6d66` 056 grant hardening (+tests) · `a8bef98` (amended from df1b320) review
  fixes M1–M5 · `2041ed8` **admin enrichment review screen**.
- Admin screen files: `app/admin/enrichment.tsx` (NEW), `hooks/useEnrichmentProposals.ts` (NEW),
  `app/admin/__tests__/enrichment.test.tsx` (NEW, 33 tests), nav link added to `app/admin/moderation.tsx`.
  Uses existing `useIsAdmin` + authenticated `supabase` client + RLS; calls only `apply_venue_proposal` /
  `reject_venue_proposal`; approve = client UPDATE status='approved' (admin RLS) then apply RPC; supports
  retry-apply + return-to-pending; booking_url has no Apply; description requires rewritten text (not prefilled);
  opening_hours 7-day render + confirm; reject requires a note. Gates: tsc 31 (0 in changed files), test:ci 94/1746.

### Production changes made this session (with Liam's explicit approval each)
- **056 applied to PROD** by Liam via SQL editor; verified (2 tables/0 rows, 4 RPCs, privilege matrix anon✗ /
  authenticated apply+reject / service_role all). (Earlier transient dashboard "no access" → Liam confirmed restored.)
- **5-venue pilot:** `npx tsx scripts/enrich/enrichWebsites.ts --limit=5` (dry run, 5/5 extracted, 0 writes) THEN
  `--limit=5 --propose` → inserted **5 `venue_enrichment_runs` + 17 `venue_field_proposals` (all PENDING)** in PROD.
  **No live venue fields changed.** Venues: Thacka Beck, Mary King's Close, Rascals Epsom, Hillview, Hollywood Bowl.
  Field mix: phone 4, email 4, description 5, booking_url 2, website 1, opening_hours 1. Hillview website =
  conflicts_existing; 2 booking_url = no target column (cannot apply).

### Where we stopped
On-device VISUAL smoke test of the admin screen (Expo running on :8081; Liam to open Expo Go on Android, sign in
as admin, verify the 17 render). **Visual pass NOT completed.** Dev server stopped at session end.

### NEXT
1. Finish on-device visual smoke test (report defects, fix-after-report).
2. Real admin-review batch via the SCREEN (authenticated admin only — SQL editor/service_role get not_admin):
   Liam's recorded decisions = 7 scalar approve+apply (Hillview email, Hollywood phone, Rascals phone, Thacka
   email+phone, Mary's email+phone) · 5 description approve+apply with provided rewritten text · 5 rejects with
   notes (Hillview website, Hollywood opening_hours, Rascals email, 2× booking_url). Stale-guarded; explicit go
   needed before resolving anything.

### Still open / gates (unchanged)
PROD ledger drift 044–056 UNRESOLVED (Plan B repair DECLINED). Do NOT db push / migration repair / merge PR /
deploy until separately approved.

---

## Session: 2026-06-27 (b) — 016 replay fix + 056 grant-hardening: validated end-to-end LOCALLY. PROD UNTOUCHED. Uncommitted.

**Scope:** strict safety-first session. ONLY 3 files changed (all local, uncommitted, NOT staged/pushed):
`supabase/migrations/016_osm_id_constraint.sql`, `supabase/migrations/056_venue_website_enrichment.sql`,
`supabase/tests/056_venue_website_enrichment.mjs`. Prod read-only at most; ledger NOT modified.

### Fix 1 — migration 016 fresh-replay (the 42P07 collision)
Prepended one line `DROP INDEX IF EXISTS venues_osm_id_unique;` immediately before 016's
`ALTER TABLE venues ADD CONSTRAINT venues_osm_id_unique UNIQUE (osm_id)`. This inlines the manual cleanup
016 already documented (lines 31-36). Idempotent; prod has 016 recorded so it NEVER re-runs there — only
unblocks fresh local/staging replay. 013 NOT touched.

### Fix 2 — migration 056 grant least-privilege hardening
ROOT CAUSE (proven via pg_default_acl on the live local stack): Supabase configures ALTER DEFAULT
PRIVILEGES granting EXECUTE on every new public function to anon, authenticated AND service_role. 056's
`revoke ... from public` removes only PUBLIC, NOT those named roles -> all 4 RPCs were callable by
anon+authenticated. Same behaviour WOULD occur on prod if 056 applied unchanged.
FIX: revoke EXECUTE from `public, anon, authenticated` on snapshot_current_value + propose_field, and from
`public, anon` on apply_venue_proposal + reject_venue_proposal (grants block unchanged). Test file: bootstrap
now reproduces the Supabase default privileges (so the pglite grant tests stop being a false-green), + added
an anon negative test for apply/reject + a full has_function_privilege matrix test. A/B demo (git show HEAD vs
working tree) confirmed: matrix FAILS pre-patch, PASSES post-patch.

### Local validation (Docker only, 127.0.0.1:54322; prod never contacted)
- `supabase start` then `supabase db reset`: full chain 001->056 replays CLEAN (016 + 056 both clean).
- Documented 056 rollback (drop 4 fns + 2 tables; indexes/policies/trigger cascade) verified: all 056 objects
  gone, shared fns (is_admin, touch_updated_at) + 001-055 objects intact.
- Reapplied 056 from file: clean. Final verify Q1-Q9 all pass; both tables 0 rows; 056 ledger row present x1.

### Final privilege matrix (verified live + in pglite)
| fn | anon | authenticated | service_role |
| snapshot_current_value | f | f | t |
| propose_field | f | f | t |
| apply_venue_proposal | f | t | t |
| reject_venue_proposal | f | t | t |

### Gates
test:db 29/29 pass; full test:ci 93 suites/1691 tests pass; tsc 31 errors (== baseline, 0 new, none in the 3
files); eslint on the test file 0 errors / 4 warnings (pre-existing no-console in the harness).

### STILL OPEN (unchanged)
- PROD migration-ledger drift (044-056: 7 timestamp rows + 5 missing 3-digit rows) REMAINS UNRESOLVED.
  Plan B (ledger-only repair) was explicitly DECLINED for now. Do NOT db push / migration repair.
- 056 NOT applied to prod. The 3 file changes are NOT committed/staged/pushed. No merge/deploy.
- Recommended commit boundaries: (1) 016 replay fix alone; (2) 056 grant hardening + its test changes.

---

## Session: 2026-06-26/27 — Migration-history DIAGNOSIS (local replay fails; 044–056 prod drift). DIAGNOSIS ONLY — nothing edited/applied/committed.

**Why:** before doing the non-prod "apply 056" validation, found `supabase start` fails locally.
Investigated two separate migration-history problems. NO migrations edited, NO push, prod read-only only.

### FINDING 1 — the "013 failure" is really a **016 collision** (root cause nailed)
- `supabase start` replays 001→… and ERRORS at **016**, not 013. Exact error:
  `ERROR: relation "venues_osm_id_unique" already exists (SQLSTATE 42P07)` at 016's FIRST statement
  `ALTER TABLE venues ADD CONSTRAINT venues_osm_id_unique UNIQUE (osm_id)`.
- Mechanism: **013** creates a partial unique INDEX named `venues_osm_id_unique`; **016** creates a
  CONSTRAINT of the SAME name before dropping anything → constraint's backing index name collides.
- 016 lines 31–36 DOCUMENT this and rely on a MANUAL one-off `DROP INDEX IF EXISTS venues_osm_id_unique;`
  that was run by hand on prod but never put in the file. Prod ledger shows 013 AND 016 applied → prod is
  fine; this is purely a FRESH-REPLAY defect (a non-replayable historical migration / duplicate object).
- **Fix (NOT yet done, needs go-ahead since it edits an old migration):** prepend
  `DROP INDEX IF EXISTS venues_osm_id_unique;` as 016's first statement. Idempotent; prod already has 016
  recorded so it will NEVER re-run there; only unblocks fresh local/staging replay.

### FINDING 2 — pglite `test:db` does NOT validate the full chain
- `supabase/tests/056_*.mjs` loads a hand-written minimal BOOTSTRAP (stripped venues/profiles/opening_hours
  + roles) then applies ONLY 056. So "27/27 green" proves 056 IN ISOLATION, never runs 001–055/013/016.
- **056 remains independently safe** (touches only its own new objects; nothing to do with osm_id). BUT you
  currently CANNOT stand up a fresh local/staging Supabase to validate 056 end-to-end because the stack dies
  at 016 first. Fixing 016 is a PREREQUISITE for that validation.

### FINDING 3 — 044–056 migration-history DRIFT (today's deep-dive, prod read-only)
Compared local files vs prod ledger (`supabase db dump --linked --data-only -s supabase_migrations`) and prod
live schema (`-s public`). Both dumps saved in scratchpad (remote_ledger.sql / remote_public_schema.sql).
- **Prod ledger** = 001–043 (3-digit) + **7 TIMESTAMP-versioned** rows (created_by = liam's email). Names map to:
  046, 047, 049, 051, 052, 054, 055. (versions 20260605211756/212043/20260606142242/20260607225234/225535/
  20260609004736/20260619200353.)
- **NOT in ledger** (no row): local **044, 045, 048, 050, 053** — applied direct-to-prod out-of-band.
  053 self-documents this ("Applied directly to prod 2026-06-09 via ALTER TABLE; this file records it").
- **Prod SCHEMA is COMPLETE through 055** — verified objects PRESENT: discovery_approved col+`venues_discovery_gate_idx`,
  get_nearby_venues (with discovery filter), is_admin, venue_enrichment (049), venue_facility_votes/stats +
  recompute/mirror fns+triggers (050), reviews.tags (053), user_review_count_today (054), venue_photos_venue_id_approved_idx (055).
- **056 objects ABSENT in prod** (venue_field_proposals / venue_enrichment_runs) — correct, not deployed.
- **DANGER:** remote ledger uses 14-digit TIMESTAMP versions; local uses 3-digit "044".."056". `db push`
  matches by version string → sees NONE of 044–056 as applied → would try to RE-APPLY all 044→056 to PROD.
  Non-idempotent statements (e.g. 049 has CREATE INDEX/TRIGGER/POLICY without IF NOT EXISTS) would ERROR on
  already-existing objects, AND it risks applying 056 to prod. **DO NOT run `supabase db push`.**

**⏭ NOT FINISHED (do tomorrow):** (a) `supabase db push --dry-run` (read-only) to capture exactly what it
lists [user interrupted before this ran]; (b) confirm 044/049 idempotency lines; (c) finalise reconciliation
table + ranked reconciliation plan; (d) decide order: reconcile drift FIRST, then the 016 one-line fix.
Reconciliation likely needs `supabase migration repair --status applied <versions>` to insert ledger rows for
044/045/048/050/053 + align the timestamp rows — but that is NOT YET decided/approved. Nothing applied.

**Env note:** Docker Desktop + local Supabase work now (`major_version=17`, untracked `supabase/config.toml`).
Local stack rolled itself back on the 016 error (it's down). CLI v2.84.2 linked to prod ref `iftiyxwacptsyachgdus`
(pooler eu-west-2), creds cached (read-only dumps work without prompting).

---

## Session: 2026-06-24 — Enrichment pilot smoke-tested + 5 pre-scale fixes audited (PAUSED mid-fix)

**Context:** continuing the Website Enrichment dry-run (UNCOMMITTED, dry-run only, no DB writes).
Ran a 5-venue smoke test `npx tsx scripts/enrich/enrichWebsites.ts --limit=5` — SAFE (0 wrong-domain,
robots honoured, £0) but all 5 were childcare/nurseries → only low-confidence emails + 1 description,
ZERO high-confidence/opening-hours. Too small + wrong category mix to grade vs spec §12 (needs 50–100,
stratified). User halted the `--limit=50` run and specified **5 required fixes before scaling.**

**Audited the 5 fixes against the code (this is the key deliverable):**
1. Phone dedup (GB +44 ≡ leading-0): ✅ DONE+wired — `fields.ts` `phoneDedupKey` → `proposals.ts:125`.
2. Opening-hours guards: ✅ DONE — `openingHours.ts` FIX 2a `closes_before_opens` (reject closes<opens
   unless 24:00/overnight) + FIX 2b `insufficient_week_evidence` (need ≥3 days; no closed-week from 1 day).
3. Robots timeout budget: ⚠️ IMPLEMENTED BUT BUGGY — **3 tests FAIL** (`webClient.test.ts:540/576/605`).
   Root cause: DI core doesn't self-bound a never-resolving injected `resolveDns`/`http`; deadline only
   checked AFTER `guardHop`/`throttle`. Diagnosed fix: LEAF-level timeout race (NOT whole-work
   Promise.race, which breaks the 417 passing happy-path/zero-budget tests because the virtual-clock
   `sleep` resolves in ~1 microtask). Full diagnosis in `next_session_reminder.md`.
4. Reject description == venue name: ✅ DONE+wired — `fields.ts` `isMeaningfulDescription` →
   `orchestrate.ts:287`.
5. Category-stratified 50-venue sample: ❌ NOT DONE — `enrichWebsites.ts` `fetchPilotVenues` still
   plain `.limit()`. Plan: round-robin across outing slugs (soft-play, farm, museum, attraction,
   animal-attraction, theme-park, indoor-play, trampoline, bowling, swimming); de-prioritise childcare.

**Gate baselines:** `jest scripts/enrich` = 417 pass / 3 fail / 420 · `tsc` = 31 (baseline, unrelated)
· lint 0 err on enrich files. `scripts/enrich/out/` already in `.gitignore` (line 46).

**PAUSED** before implementing Tasks A (FIX 3) + B (FIX 5). Nothing committed/proposed/applied.
**⏭ Next:** implement FIX 3 (leaf-level race) + FIX 5 (stratified sampling) → tests + tsc(31) + lint →
secom-reviewer → STOP and report the exact stratified 50-venue dry-run command (do NOT run it).

---

## Session: 2026-06-23 — Website Enrichment dry-run orchestrator built (UNCOMMITTED)

**Context correction first:** the v2 DARK reskin (sessions below) was **REVERTED** on 2026-06-21
(`7c17c1c` "roll back v2 dark redesign, restore light editorial at ba9342b"). App is LIGHT
editorial again; `main` HEAD `1c302ea`. Everything below about the dark reskin is history.

**Active thread = Venue Website Enrichment** (spec `scripts/enrich/WEBSITE_ENRICHMENT_SPEC.md` v2,
2026-06-22). Steps 1–3 (migration `056` SQL, `types/webEnrichment.ts`, pure + fetch modules + 131
tests) were already on disk, uncommitted. Migration 056 is **NOT applied** (latest applied = 055).

**This session — spec §15 step 4: the dry-run orchestrator.** Delegated the build to
`elite-engineer` with a precise interface brief; reviewed with `secom-reviewer`.
- **Created** `scripts/enrich/enrichWebsites.ts` (thin impure CLI: env + service-role client,
  flag parse, read-only pilot-venue SELECT + per-venue `opening_hours` SELECT → `CurrentVenueSnapshot`,
  builds a real `WebClient`, runs orchestration, writes JSON/CSV/HTML reports to `scripts/enrich/out/`).
- **Created** `scripts/enrich/web/orchestrate.ts` — DI/offline-testable core: `selectBestCandidates`
  (one-per-field by method rank jsonld>microdata>meta>heuristic, first-hit-wins), `discoverHintLinks`
  (same-registrable-domain + hint-path allowlist + `isSafeUrl`, cap 2), `orchestrateVenue`
  (landing fetch → hint pages ≤3 total → merge → buildProposals; per-page failure non-fatal; never
  throws), `runEnrichment` (+ summary counts).
- **Modified** `scripts/enrich/web/report.ts` — added `renderRunJson/renderRunCsv/renderRunHtml`
  (HTML-escapes every website-derived field; existing draft renderers untouched).
- **Created tests** `__tests__/orchestrate.test.ts` + `runReport.test.ts`.
- **Dry-run safety (verified by me, not just claimed):** the ONLY DB writes
  (`venue_enrichment_runs` insert + `propose_field` RPC) are entirely inside `if (flags.propose)`.
  Default path ends at "DRY RUN COMPLETE (no DB writes)". `--propose` is gated by `applyProposeGates`
  (needs `--limit` or `--venue-id`; refuses `> PROPOSE_LIMIT_CAP=100`). `--propose` NOT executed.
- **secom-reviewer:** ZERO Critical/High/Medium/Low. PASS on dry-run isolation, SSRF, robots
  no-bypass, XSS-escaped report, PII/secret logging, gated propose, GDPR. Only informational
  pre-production tasks (DPIA addendum, privacy-policy disclosure, CI grep, grade pilot). No code fix needed.
- **Gates (verified independently):** `jest scripts/enrich` **369 pass / 17 suites** · `tsc` **31
  (0 new)** · lint **0 err** on the new files.
- **Pre-commit todo:** add `scripts/enrich/out/` to `.gitignore` (report output). Cache
  `scripts/data/` already ignored. Nothing staged/committed/pushed — left uncommitted per instruction.

**⏭ Next:** to actually run it (dry-run, no writes): `npx tsx scripts/enrich/enrichWebsites.ts --limit=50`
(needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in `scripts/.env`, present). Then grade the report
(spec §12 thresholds). Only if it passes: apply migration 056 + DPIA, then `--propose`, then build
`applyProposals.ts` (step 5).

---

## Session: 2026-06-20 (c) — v2 DARK reskin COMMITTED, MERGED to main + PUSHED (LATER REVERTED 2026-06-21)

The reskin work that had been uncommitted across many sessions is now **committed, merged
to `main`, and pushed to GitHub.** `origin/main` HEAD = `47ff12d` (was `193dc55`). The
merge was a clean **fast-forward** (no merge commit); local `main` == `origin/main`.
Not tagged, no release created.

**Commits landed this session (on `ui-reskin`, then fast-forwarded onto `main`):**
- `8bb3b26` `style(ui): complete dark editorial secondary screens` — 15 files: auth
  (welcome/login/register/onboarding-1/2/3 + onboarding.test), profile secondary screens
  (`[id]`, children-ages, data-download, edit, my-reviews, my-venues), `components/consent/
  LocationConsentPrompt.tsx`, `components/profile/ModerationBadge.tsx`. The onboarding test
  was switched to `jest.requireActual('@/constants/theme')` so the reskinned screens' tokens
  resolve.
- `47ff12d` `style(ui): darken remaining live consumer flows` — 6 files (see below).

**Launch audit (read-only sweep) — verdict: NO functional launch blockers.** Routes all
resolve, no dead buttons, no missing screens, photo fallback chain solid (cover→Wikimedia→
CategoryPlaceholder), location consent-on-intent + dark map loading state, empty/error states
present (search + favourites). **Key structural finding:** the dark reskin works by swapping
token VALUES in `constants/theme.ts` in place (deprecated aliases like `Colors.slate` now
resolve dark), so every `Colors`/StyleSheet screen auto-darkened. The leftovers were screens
that (a) use NativeWind `className` (`tailwind.config.js` was deliberately left light) or
(b) carry their own local light palette objects.

**The 6 live consumer flows darkened (commit `47ff12d`):**
1. `app/profile/privacy-settings.tsx` — hardcoded light hex → `Colors` tokens; card
   drop-shadow → hairline `Colors.separator` border.
2. `app/venue/[id]/review.tsx` — local `pp` palette remapped in place.
3. `components/reviews/ReviewForm.tsx` — local `PP` palette remapped; dark-invisible
   `PP.ink` CTAs → `Colors.accent`; error `#D63031` → `Colors.error`.
4. `app/venue/plan-visit.tsx` — local `pp` palette remapped; `*Soft` washes → 12–14% rgba.
5. `app/venue/add.tsx` — `#fff` input/chip backgrounds → `Colors.surface`/`surface2`.
6. `app/(tabs)/search.tsx` — clear-filters chip ONLY: `#FFF0F0`/`#FF6B6B` → `rgba(255,107,107,
   0.12)` / `Colors.coral`. Nothing else in search.tsx touched.
   **Method that worked low-risk:** keep each local palette's KEYS, remap only the VALUES to
   dark `Colors` tokens — preserves every style reference and all behaviour. Remaining
   `color:'#fff'` hits are intended white-on-accent button text, not light panels.

**Verification:**
- Done by `Main-coder` agent, then re-checked independently. Scope confirmed = exactly the
  6 files, no deferred/memory/script files touched, all new tokens (`label2/label3/separator/
  fill/accentLight/accent`) exist in `constants/theme.ts`.
- **secom-reviewer focused pass on `privacy-settings.tsx`:** ZERO findings, safe to merge.
  Screen is informational (no mutations/consent writes), `getForegroundPermissionsAsync()`
  remains non-prompting (ICO Children's Code Std 10), no new logging, copy unchanged, routes
  (`/profile/data-download`, `/(auth)/privacy`) resolve. privacy-settings.test 8/8 green.
- **Device QA:** 5 screenshots reviewed (privacy-settings, write-review, plan-visit, add-venue,
  search) — all readable and consistent with the dark editorial palette.
- **Gates (run before each commit, before merge, and before push — all green):** test:ci
  **1406 pass / 80 suites** · tsc **31 == baseline (0 new)** · lint **0 err / 73 warn**.

**STILL DEFERRED — intentionally light, not converted (lower-traffic / paused):** privacy
POLICY `app/(auth)/privacy.tsx`, `terms.tsx`, `app/admin/moderation.tsx`, `components/venue/
VenuePhotoUpload.tsx`, `app/business/{dashboard,upgrade}.tsx` (B2B paused), `tailwind.config.js`.
Dead component `components/ui/VenueMini.tsx` (unused; NOT deleted per instruction).

**Tooling:** Installed **Playwright MCP** (`microsoft/playwright-mcp` → `@playwright/mcp@latest`),
local/project scope in `C:\Users\Liame\.claude-personal\.claude.json`, command
`cmd /c npx @playwright/mcp@latest`. Note: bare `npx` gets path-mangled by the Git Bash tool
(`/c`→`C:/`), so it was added via PowerShell. Health = Connected; `browser_*` tools surface
only after a Claude Code restart.

**⏭ NEXT MILESTONE: Preview build → full device smoke test → Play Store submission.** Open
Play-Store blockers carried forward: app icons (1024 + adaptive), privacy-policy URL, Data
Safety form, production `.aab`.

**Excluded-from-commit set (still uncommitted in working tree, by design):** `.claude/memory/*`,
`scripts/enrich/*`, `claudedesign/`, `scripts/verify/`, APKs/AABs.

---

## Session: 2026-06-20 (b) — "Play Planner v2" DARK reskin, Phases 1–3 (UNCOMMITTED)

Adopting the uploaded **`claudedesign/design_handoff/`** package (README + screens/*.png +
pp2-*.jsx) as the canonical UI. Authority order: live prototype → jsx → screenshots → README.
Branch `ui-reskin`, all UNCOMMITTED. Plan file: `C:\Users\Liame\.claude-work\plans\twinkly-knitting-riddle.md`.

**Confirmed decisions (user):** (1) DARK-only now (defer OS light toggle; don't convert 340 colour
refs — flip centrally). (2) Map → rebuild to v2 full-bleed but PRESERVE all logic. (3) Tabs =
Browse/Map/Saved/Profile; Discover removed from bar but routes KEPT. (4) Build directly, phased,
gates + on-device screenshots between phases, NO commits until final approval.

**✅ Phase 1 — dark foundation (DONE, verified on device).** Flipped `constants/theme.ts` `Colors`
(incl. deprecated aliases) to the dark palette in ONE file. `hooks/useAppTheme.ts`→'dark'.
`app/(tabs)/_layout.tsx`: StatusBar light, dark glass tab bar **Browse/Map/Saved/Profile**, global
`WeatherBackground mode="immersive" paletteMode="dark"`, added `app/(tabs)/map.tsx` (re-exports
`app/explore/map`), Discover/Search `href:null`. `components/ui/Icon.tsx` default colour→`Colors.label`.
Added `.eslintignore` (claudedesign/ was throwing 865 browser-global errors). **Bug fixed on device:**
cloudy/snow `dark` palettes in `lib/weatherTheme.ts` (`WEATHER_PALETTES_BY_MODE`) were reusing the
LIGHT palette → pale wash; gave them true near-black bases.

**✅ Phase 2 — Browse/Home (DONE, verified on device).** Rebuilt `app/(tabs)/index.tsx` to v2:
header, greeting+weather pill, search bar, intent chips, age chips, "Good for today"
SmartFeaturedCard, "Family favourites" VenueCard2 list (shuffle). New: `lib/homeIntents.ts`
(intents/age/smart-pick mapped to REAL data via collections+venueAttributes — nothing fabricated),
`hooks/location/useApproxCoords.ts` (no-prompt coarse coords, privacy-safe), `hooks/useFavourites.ts`
(saved-set + toggle), `components/home/{VenueCard2,IntentChips,AgeChips}.tsx`. Reworked
`SmartFeaturedCard.tsx` (radius 26, rating·type·distance row, why pills, save heart). Search field
uses `surface2`. Rewrote `app/(tabs)/__tests__/home.test.tsx`. Honest limits: venues w/o photo →
category placeholder; weather pill binary (rain=blue, else warm) so "Overcast"=warm.

**⏳ Phase 3 — full-bleed Map (CODE COMPLETE, NOT yet gate-verified / not screenshotted).**
pp2-map.jsx is an older feed variant NOT in the handoff → canonical Map = `screens/03-map-dark.png`
+ README (full-bleed). Rewrote the map-MODE return in `app/explore/map.tsx` to full-bleed: dark
`DARK_MAP_STYLE` (typed `MapStyleElement[]`), absolute-fill `ClusterMapView`, top glass postcode
search pill, glass filter-chips row (Filters + All + categories), right controls (recenter + "Browse
full venue list"), slide-up selected-venue card ("View venue →"), ODbL attribution. ALL logic kept
(consent gate, clustering, postcode geocode, weather, fetching, pin-tap). LIST mode unchanged (still
has the Map/List toggle pill to return). Removed now-orphaned: inner WeatherBackground, mini-map
radius ring, getGreetingWord, locationLabel, openVenueCount, weatherBadgeMap, getWeatherBadge, Svg
imports, Pressable import, venuesError. Updated `app/explore/__tests__/map.test.tsx`: map→list switch
now presses **'Browse full venue list'** (was 'List view'); "map shown" proxy now
'Browse full venue list' / `cluster-map-view` testid; toggle pill asserted in LIST mode only.

**⚠ RESUME HERE NEXT SESSION:**
1. Re-run gates after the last cleanup edits (interrupted before final check):
   `npx tsc --noEmit` (must be **31**, 0 new) · `npm run lint` (0 err) · `npm run test:ci`
   (watch `app/explore/__tests__/map.test.tsx` + `postcodeSearch.test.tsx`). Fix any fallout.
2. User reloads app (`npx expo start`, dev-client) → screenshot the **Map** tab vs 03-map-dark.png.
   Get approval, then continue: **Phase 4 Venue detail → 5 Saved → 6 Profile → 7 secondary sweep.**
3. Phase 6 Profile reconciliation: v2 shows a Business tab (claim/analytics) the app deliberately
   REMOVED for launch — build Parent tab faithfully, do NOT reintroduce removed flows (confirm with user).
4. NOTHING committed yet (user directive: no commits until final approval). `main` untouched.

---

## Session: 2026-06-20 — live data path verified (orientation only, no code change)

Short session. Reconciled stale memory against real git: branch `ui-reskin`,
HEAD `ba9342b`, **21 ahead of `main`**, not merged. Two commits past old notes:
`9232876` (migration **055** `venue_photos` index) + `ba9342b` (Android Maps key
via dynamic `app.config.js`/`eas.json`).

- **Ran `scripts/verify/checkLiveDataPath.mjs` (read-only, anon role):
  PASS.** Anon key (len 46, new `sb_publishable_` format) accepted,
  `get_nearby_venues` returns real venues, RLS/`is_admin` grant fine → the
  nearby/discovery journey works end-to-end against prod. The "is the data path
  broken?" worry is closed. (Minor: some venues have null `city`.)
- **Corrected two stale notes:** `FALLBACK_LOCATION` already correct (`52.8,-1.5`
  GB centroid, not London) — non-issue. The verify script exists + works but is
  **uncommitted** (worth committing — read-only, no secrets printed).
- **No code changed, nothing committed.** Remaining real Play-Store blockers: app
  icons (1024 + adaptive), privacy-policy URL, Data Safety form, prod `.aab`.
  User deferred choosing the next track ("continue tomorrow").

---

## Session: 2026-06-14 (day 2) — Home + cross-screen visual reskin (UNCOMMITTED)

Long visual/UI-only session via the `app-ui-director` skill, many stop-for-
screenshots passes on a physical Android dev build. Branch `ui-reskin`, all
UNCOMMITTED on top of `61ee92e`. Gates green throughout: **tsc 31 (baseline) ·
lint 0 err / 73 warn · test:ci 80 suites / 1404 pass.** NO data/query/Supabase/
RPC/ranking/collection-def/weather/location/consent/auth/analytics/data-model
changes — presentation only. Full detail + file list in
`next_session_reminder.md` (START HERE). Headlines:

- **Home → calm "hallway":** removed the venue hero, "Near You", mood/intent/age
  chips, OpenNowRow, and the bottom Discover footer. Home now = header · greeting ·
  "What's the plan today?" · ONE editorial **collection hero** (never a venue,
  needs no location) · "Continue exploring" (recently-viewed) only. New
  `EditorialHero.tsx` + `GoodForTodayFallback.tsx` (the hero card). Home no longer
  reads location/consent at all.
- **Status-bar fix (root cause):** no StatusBar anywhere + app.json
  `userInterfaceStyle:'automatic'` → OS drew light icons on the cream bg in device
  dark mode. Added global `<StatusBar style="dark" />` in `(tabs)/_layout.tsx`.
- **Bottom nav** warmed (`Colors.surface2`), height 64→58+inset.
- **Favourites empty state** → new `components/favourites/SavedEmptyState.tsx`
  (heart medallion + cream "Explore places →" CTA → /discover) + test; cream scrim
  softens the sunny weather circles (empty screen only).
- **Discover `CollectionCard`:** compact tiles → quiet "Explore →" link (pill kept
  on hero); hero hairline border + responsive title; do NOT change ExploreCard `md`
  (Discover `[collection]` uses it).
- **Profile** warmed (cards `#FBF7EF`, softer shadows, gutter 20) — rows/routes/
  GDPR-delete logic untouched.
- **Next:** confirm screenshots approved → commit the reskin (exclude memory/APK/
  enrich/profile-delete-test). `main` untouched, not merged.

---

## Session: 2026-06-14 — Discover landing COMMITTED (`61ee92e`) + LOCKED

Branch `ui-reskin`. Device-tested the Discover tab, fixed the real bug, polished,
then committed the whole rebuild as ONE checkpoint. `main` untouched (`193dc55`).

- **Android square-corner bug (root cause + fix):** the visible square layer was
  the `LinearGradient` — it had no radius and relied on the parent `Pressable`'s
  `overflow:'hidden'`, but that same Pressable also held `elevation`. On Android,
  `elevation` + `overflow:'hidden'` on one view breaks rounded child-clipping.
  **Fix = split-wrapper:** Pressable (press feedback only) → outer View (radius +
  shadow + elevation, overflow visible, bg = `def.gradient[0]`) → inner View
  (radius + `overflow:'hidden'`) → LinearGradient (radius too). Confirmed clean on
  device. **DO NOT touch this structure again** (user directive).
- **VIP polish passes (visual-only):** hero radius 60 / tile radius 56;
  near-invisible shadows (opacity 0.04, blur 48/40, elevation 4/3); muted
  magazine gradients on the 4 mosaic collections in `lib/collections.ts` (seasonal
  hero gradients untouched so hero stays dominant); calmer compact typography
  (title 16.5, cat line 11 @ rgba(28,20,8,0.48), Explore pill 12); organic tile
  heights `[182,140,156,174]`; gentle per-card illustration tilt.
- **Commit `61ee92e` `feat(discover): introduce editorial magazine experience`** —
  8 files only: `app/(tabs)/discover.tsx`, `app/(tabs)/_layout.tsx`,
  `app/discover/[collection].tsx`, `components/discover/*` (CollectionCard +
  illustrations/CollectionIllustration), `lib/collections.ts`, `lib/seasonalPicks.ts`,
  `lib/__tests__/seasonalPicks.test.ts`. Deliberately EXCLUDED: memory files,
  `next_session_reminder.md`, `build-preview.apk`, `profile.deleteAccount.test.tsx`,
  `scripts/enrich/*`, and the unrelated Home leftovers (`index.tsx`, `homeStyles.ts`,
  ExploreCard/OpenNowRow/RecentlyViewedRow). `.expo/types/router.d.ts` is gitignored
  (auto-regenerated) so nothing to stage there.
- **Gates:** test:ci **79 suites / 1406 pass** · tsc **31 (baseline, 0 new)** · lint
  **0 err / 73 warn**.
- **Dev-run note:** app runs via a `--dev-client` build on device. `Error loading
  app: timeout` was a first-bundle/Metro timeout (networking was fine — phone reached
  PC `192.168.1.252:8081`); retrying the connection / `expo start --dev-client -c`
  resolves it. Not a code issue.
- **⏭ NEXT PHASE = collection-page polish & depth** (`app/discover/[collection].tsx`),
  NOT the Discover landing page (now locked). Weekend Ideas deferred behind that.

---

## Session: 2026-06-13 (f) — Phase 1 Home reskin (pp2-home.jsx port, uncommitted)

Presentation-only port of the design handoff's Home screen
(`C:\Users\Liame\Downloads\design_handoff\pp2-home.jsx` + README +
`screens/01-home-dark.png`/`06-home-light.png`) into `app/(tabs)/index.tsx`.
**This is a different, newer handoff than the April 2026 redesign** — new
additive token system `Themes.dark/light` + `useAppTheme()` (separate from
`Colors`/`useWeatherTheme()`). Not committed — all changes in working tree on
`ui-reskin`.

- **New files:** `hooks/useAppTheme.ts`, `components/ui/PPBrandMark.tsx`
  (isometric cube app-icon mark), `components/home/SmartFeaturedCard.tsx`
  (380px hero card, glass pills via rgba views), `components/home/VenueCard2.tsx`
  (92x92 row card).
- **Rewritten:** `app/(tabs)/index.tsx` (full 9-section layout: header w/
  "YOUR AREA"+Bristol+chevD+brand mark, greeting+weather pill+two-line
  headline "What's the\nplan today?"+context line, search bar, intent chips,
  age chips w/ emoji+Clear pill, NearbyPreview/LocationNudge consent gate),
  `components/home/QuickPicks.tsx` (dropped `theme` prop, now `useAppTheme()`),
  `components/home/NearbyPreview.tsx` (dropped `theme` prop; renders
  SmartFeaturedCard + VenueCard2[] instead of old VenueCard; added refresh
  button wired to `refetch()`).
- **constants/theme.ts** — added `Themes.dark/light` + `ocean` accent (additive).
- **lib/weatherTheme.ts** — added `WEATHER_PALETTES_BY_MODE` +
  `resolveWeatherPalette()` for Home's immersive bg to vary by app-theme mode.
- **components/weather/WeatherBackground.tsx** — new optional `paletteMode`
  prop. **Compat-critical:** when unset (every screen except Home), immersive
  mode keeps the ORIGINAL `WEATHER_THEMES[atmosphere].palette` — zero change
  for venue detail/map. Only Home passes `paletteMode={mode}`.
- **components/ui/Icon.tsx** — added `'refresh'` icon (re-roll button).
- **Bug caught+fixed during verification:** initial `paletteMode = 'dark'`
  default broke 2 existing WeatherBackground tests by changing the rendered
  palette for ALL immersive callers, not just Home. Fixed by making
  `paletteMode` have no default (undefined → old cinematic behaviour).
- **Tests updated:** `home.test.tsx` (two-line heading), `QuickPicks.glass.test.tsx`
  (full rewrite, asserts `useAppTheme()` label colour flip dark/light),
  `NearbyPreview.test.tsx` (mocks retargeted `../SmartFeaturedCard`/`../VenueCard2`,
  preserves category-hydration + weather-badge-contains-"rain" + family-badges
  assertions).
- **Gates:** test:ci **1372/1372 pass, 73/73 suites** · tsc **31 (0 new)** ·
  lint **0 err** (71 pre-existing warnings).
- **Privacy/compliance:** consent gate structurally unchanged (NearbyPreview
  only mounts on `status === 'granted'`, LocationNudge otherwise — Home never
  triggers OS location prompt). No new logging, no fabricated venue data, no
  "North Bristol" (kept "Bristol"), no new native deps, no new Supabase
  queries. SmartFeaturedCard save/heart button omitted (no favourites hook
  exists yet) — top-right button opens venue detail instead.
- **Open for lead review:** light-mode on-device visual check not re-verified
  this session; age filter chips still display-only (pre-existing, not a
  regression).
- Full detail: `phase1_home_reskin_2026_06_13.md` (personal memory).

---

## Session: 2026-06-12 (e) — Fix: cinematic weather regression (COMMITTED 790f082)

Reported regression: Home looked flat/pale, "weather not rendering". Investigated full chain.
**Root cause:** NOT a mount/stack/overflow/opacity bug — background was always mounted. The
`resolveAtmosphere` `default` (null/unknown weather) branch returned `'sunny'` IGNORING time of
day. Coarse `useWeather(FALLBACK_LOCATION)` returns null while loading or on fetch failure, so at
night (screenshot was 23:23) Home resolved to the LIGHT sunny theme → pale bg + dark text instead
of deep-navy night. Both background AND `useWeatherTheme` chrome inherited it.

- **Fix 1 (the regression):** `resolveAtmosphere` default → `night ? 'night' : 'sunny'`.
- **Fix 2:** strengthened immersive sunny/cloudy/snow palettes (real gradient depth + visible
  glow; sunny got soft-blue-sky→warm-amber per original spec) so daytime atmosphere is noticeable;
  kept dark text readable. rain/night untouched (already dramatic).
- **Fix 3:** gentle warm depth on ambient `sunny` (WeatherLayer) so Search/Results/Map restrained
  wash isn't dead-flat.
- **Search verdict:** intentionally weather-aware but RESTRAINED (ambient mode), NOT neutral, NOT
  full cinematic. Kept restrained, only made visible. Did not force Home treatment onto it.
- **Tests added** (WeatherBackground.test + weatherTheme.test): time-aware fallback (null→night at
  night), immersive passes cinematic palette ≠ ambient, fetched condition flows through, reduced-
  motion keeps static gradient, background mounts full-bleed (pointerEvents none) behind content.
- **Gates:** test:ci **1372 / 73** · tsc **31 (0 new)** · lint 0 err. Files: `lib/weatherTheme.ts`,
  `components/weather/WeatherLayer.tsx`, + 2 test files. Memory files excluded from commit.
- **⚠ Not done:** real on-device visual verification (no display access in env) — user to confirm
  night=navy / day=sunny-glow on device.

---

## Session: 2026-06-12 (d) — Phase 6A.2: Venue Detail sub-component reskin (uncommitted)

Visual/design-system migration of the 3 on-screen components (closes the seam beside the
6A.1-migrated `[id].tsx`). No logic/props/copy/label changes. **Not committed.**

- `components/venue/FacilityChips.tsx` — removed local `pp` (teal); Nunito→FontFamily, teal chip
  fill→`Colors.accent`, radius→`BorderRadius.pill`. Filled-chip text white literal.
- `components/venues/RecommendationExplanation.tsx` — removed `pp`; Nunito→FontFamily,
  card→`Colors.surface`/`separator`/`BorderRadius.card`/`Shadow.md`. Kept star=`Colors.star`;
  positive green tick kept as `POSITIVE_GREEN='#5BC08A'` exception (mirrors 6A.1 green rule).
- `components/reviews/ReviewCard.tsx` — replaced hardcoded charcoal/grey hex + `fontWeight` with
  `Colors.label/label2/label3` + FontFamily tokens; card→`BorderRadius.card`+`CardBorder.standard`
  +`Shadow.sm`; stars→`Colors.coral`; pending badge→`Colors.surface2`/`separator`/`pill`.
- Checks: test:ci **73 suites / 1365 pass** (unchanged). tsc **31 (0 new)** — the ReviewCard.test
  TS2322 + facilities cast are pre-existing baseline errors. lint **0 err**.
- FacilityChips.test + ReviewCard.test are behavioural-only (no style asserts) → unaffected.
  RecommendationExplanation has no test. ReviewForm (has style asserts) NOT touched.
- Phase 6A.3 (structural polish of `[id].tsx`) is now safe — all on-screen pieces share the DS.

---

## Session: 2026-06-12 (c) — Phase 6A.1: Venue Detail token migration (uncommitted)

Pure design-system migration of `app/venue/[id].tsx` ONLY — no layout/logic change. The screen
was on old Phase 3 tokens (local `pp` palette, teal `sky #2FB8B0`, Nunito). Now joins Home/Search.
**Not committed.**

- Removed the local `pp` token blob → `Colors`/`FontFamily`/`BorderRadius`/`Shadow`/`CardBorder`.
  Teal accent → Ocean `Colors.accent`. Kept green open indicator `#3CAE6B` + featured text
  `#8B6A00` inline; `FEATURED_BG = '#FFF1C7'` kept as named non-token constant (no DS equivalent).
- Fonts: Nunito → Bricolage (`display`/`heading`) + Hanken (`body`/`bodyStrong`/`caption`).
  venueName lineHeight 30→34 (Bricolage taller, avoids clipping). Card radius mainCard 32→
  `BorderRadius.featured`; shadow → `Shadow.lg`; inner info tiles → `CardBorder.standard`.
- NO JSX reorder, NO component/hook/query/mutation/nav change. All accessibilityLabels preserved.
  Did NOT touch RecommendationExplanation, ReviewCard, FacilityChips, VenuePhotoUpload.
- Checks: test:ci **73 suites / 1365 pass** (unchanged → no behaviour change). tsc **31 (0 new)**.
  lint **0 err / 1 warn** (`_myReview` — pre-existing). The `[id].tsx:470` facilities-cast TS err
  is pre-existing (in baseline), untouched by this diff.
- Phase 6A.2 (sub-component re-skin) is now SAFE to start; still needs a decision on the two
  on-screen out-of-scope files (RecommendationExplanation in components/venues, ReviewCard).

---

## Session: 2026-06-12 (b) — Weather v2.1: full glass immersion on Home (uncommitted)

Pushed immersion further, Home-only. On rain/night the WHOLE Home now reads as one designed
environment, not "weather layer + white cards". **Not committed.**

- **Token refinements** (`lib/weatherTheme.ts`): LIGHT_TEXT now pure white primary `#FFFFFF` +
  `rgba(255,255,255,0.72)` / `0.55` (per brief). GLASS_CARD `rgba(255,255,255,0.12)` bg /
  `0.16` border.
- **`components/ui/VenueCard.tsx`** got an OPTIONAL `theme?: WeatherTheme` prop. When the theme
  is glass (rain/night) the card → frosted glass (glass bg/border, softer diffuse shadow,
  elevation 0) with white title + light secondary/muted text. Gated on `glass`; omitted/light
  theme = BYTE-IDENTICAL solid card, so Search/Results/Map/Venue (all render VenueCard) are
  untouched. Category/open/family chips kept branded (readable on glass).
- **`QuickPicks.tsx`**: optional `theme` → glass chips + white labels on dark; bright emoji
  boxes kept (instant weather read). Light/none = original paper chips.
- **`NearbyPreview.tsx`**: replaced earlier `headerColor`/`mutedColor` props with a single
  `theme?` (derives header/muted + forwards theme to each VenueCard).
- **`app/(tabs)/index.tsx`**: passes `theme` to QuickPicks + NearbyPreview; `LocationNudge`
  (pre-consent card) also goes glass on dark for coherence.
- **No new deps** — no backdrop blur lib installed, so glass = semi-transparent fills only
  (RN Views can't do true backdrop-filter without a native dep anyway).
- **Checks:** test:ci **73 suites / 1365 pass** (+ VenueCard.glass, QuickPicks.glass tests).
  tsc **31 (0 new)**. lint **0 err**. No DB/API changes.
- **Untouched (verified):** Search, Results, Map, Profile, Venue screens.

---

## Session: 2026-06-12 — Weather Background v2: cinematic themes (uncommitted)

Resolved the follow-up flagged below ("full navy needs chrome text to invert"). Weather
now drives a full **WeatherTheme**, not just a background layer. **Not committed** (user reviews).

- **New `lib/weatherTheme.ts`** (pure, tested): `Atmosphere` type + `resolveAtmosphere` +
  `isNightNow` moved here (canonical); `WEATHER_THEMES` (cinematic palette + `mode` dark/light
  + `text` colours + `card` solid/glass + glow/accent); `resolveWeatherTheme(condition)`.
  WeatherLayer re-exports `Atmosphere`/`WeatherPalette` for back-compat; WeatherBackground
  re-exports `resolveAtmosphere`.
- **New `hooks/useWeatherTheme.ts`**: coarse FALLBACK_LOCATION only (no useLocation), returns
  the resolved theme for Home chrome.
- **Two background modes:** `WeatherBackground` gained `mode='ambient'|'immersive'` (default
  ambient). Ambient = the existing pale `ATMOSPHERE` (Search/Results/Map BYTE-IDENTICAL, untouched).
  Immersive (Home only) = deep navy rain/night + warm golden sunny via `WEATHER_THEMES[atmo].palette`.
  The 5 atmosphere components now take an optional `palette` prop (default = ambient).
- **Home adapts chrome** (`app/(tabs)/index.tsx`): hero/greeting/location/search/pills read
  `theme.text.*` + `theme.card.*`. KEY: light-mode theme values are deliberately identical to
  existing Colors tokens → sunny/cloudy/snow look pixel-identical to before; only rain/night flip
  to light text + glass cards. `NearbyPreview` got optional `headerColor`/`mutedColor` props
  (default Colors) so its "Good for today" header stays readable on navy.
- **Scope:** v2 chrome adaptation is Home-only (per brief). QuickPicks chips + VenueCards left
  as solid white (readable on navy). LocationNudge left solid (readable).
- **Checks:** test:ci **71 suites / 1358 pass** (+17 new: `lib/__tests__/weatherTheme.test.ts`
  + reduced-motion `useLoop` test). tsc **31 (0 new)**. lint **0 err**. No DB/API/deps changes.
- **Next:** device QA of immersive rain/night on Home; consider extending immersive theme to
  other screens later; fresh preview APK.

---

## Session: 2026-06-11 — Ambient weather background (uncommitted)

New decorative feature on branch `ui-reskin`: ambient animated weather atmospheres
behind Home / Search / Results / Map. **Not yet committed** (user reviews first).

- **New:** `components/weather/` — `WeatherBackground` (entry: maps condition→atmosphere,
  gates on reduced-motion + AppState), `WeatherLayer` (palettes + motion hooks + seeded
  positions), and `Sunny/Cloudy/Rain/Snow/Night` backgrounds. Reanimated (first use in app;
  worklets already installed) + expo-linear-gradient. No Supabase/DB/API/deps changes.
- **Data:** reuses existing `useWeather` with coarse `FALLBACK_LOCATION` only — never calls
  `useLocation()`, so no OS prompt, works pre-consent. React Query dedupes across screens.
- **Mapping:** clear→sunny (or night 20:00–06:00); partly_cloudy/overcast/fog→cloudy;
  drizzle/rain/showers/thunderstorm→rain; snow→snow; null→sunny.
- **Design decision:** brief asked for deep-navy rain/night, but screen chrome text is
  near-black `#16151A` drawn on the bg → kept rain/night in a cooler dusky-but-LIGHT family
  so text stays readable (honours "content stays focus / cards readable"). Full navy would
  need chrome text to invert — flagged as a separate follow-up.
- **Test infra:** added `jest.setup.js` (wired via package.json `jest.setupFiles`) that
  **stubs `@/components/weather/WeatherBackground` to `() => null` globally** — it's decorative
  and its live fetch + Reanimated timers leaked open handles across the parallel suite.
  Dedicated suite `components/weather/__tests__/WeatherBackground.test.tsx` un-stubs and mounts
  the real impl with Reanimated + useWeather mocked locally (7 tests).
- **Gates:** tests **1341 pass** (was 1334 + 7 new), tsc **31 (0 new)**, lint **0 errors/83 warn**.
- Also in this branch (still uncommitted from prior session): Phase 5.1a/b token + home tweaks.

---

## ⭐ RESUME HERE (2026-06-08) — DPIA Written

**DPIA completed (2026-06-08).** Comprehensive Data Protection Impact Assessment written to
`docs/DPIA.md`. Verified all claimed compliance work against live codebase; documented 15
sections (processing description, lawful bases, ICO Children's Code, technical mitigations,
open actions). See summary below.

**Active thread (latest): Launch-readiness.** GDPR Art.17 deletion fix SHIPPED +
launch-readiness audit done + DPIA written. See "Session: 2026-06-07 (cont.) — Account deletion +
Launch readiness" near the bottom. Quick state:
- **Committed & pushed (`fd253e2`)** — account-deletion / right-to-erasure fix: migration
  `051_account_deletion_photo_cleanup.sql` (6 NO-ACTION FKs → ON DELETE SET NULL +
  rewritten `delete_own_account()`), client photo-storage cleanup in `app/(tabs)/profile.tsx`,
  privacy policy update, 5 tests. Gates green (1321 tests, tsc 0-new, lint 0, secret scan clean).
- **Migration 051 APPLIED to prod (2026-06-07) + verified via Supabase MCP.** Verification
  found a column 051 MISSED — `venues.claimed_by` still NO ACTION (blocks deletion for business
  owners who claimed a venue) → **migration 052 applied** (claimed_by → ON DELETE SET NULL).
  Post-fix sweep: ZERO profiles/auth.users FKs remain on NO ACTION/RESTRICT. Rolled-back e2e
  test of delete_own_account() passed (pending photo deleted; approved photo+venue kept &
  anonymised incl. claimed_by; profile+auth.users gone; gdpr audit row written+anonymised).
  `get_advisors(security)` = no regressions (delete_own_account SECURITY DEFINER warn is
  by-design). **⚠ TODO: commit `supabase/migrations/052_account_deletion_claimed_by_cleanup.sql`
  (applied to prod, NOT yet committed → repo/prod drift). 8ecfd37 = permission minimisation.**
- **Launch-readiness checklist → `docs/LAUNCH_READINESS.md`.** Blockers: 051 unapplied · no DPIA
  doc · Android `RECORD_AUDIO` perm w/ no audio feature (confirmed images-only) · iOS "Always"
  location but app is when-in-use only. Gaps: legacy Android storage perms, eas.json placeholder
  Apple creds, no age affirmation, store privacy disclosures unwritten. Next quick win = app.json
  permission minimisation (RECORD_AUDIO / location-Always / external-storage).

**Prior thread: Geoapify venue enrichment (Phase 2B).** Full session entries are at the
BOTTOM of this file; this is the quick-start.

- **Done & committed** — Phase 2A OSM enrichment; 2B design (`PHASE_2B_GEOAPIFY_DESIGN.md`);
  2B-0 no-network matching/merge foundation (commit `8c71dc0`):
  `scripts/enrich/{geoapifyMatch,geoapifyExtract,osmProvenance,mergeFacts}.ts` + types + 56 tests.
- **Done, NOT committed** — Phase 2B-1 real 5-venue fixture collection:
  `scripts/enrich/{geoapifyClient,collectGeoapifyFixtures}.ts`, report `PHASE_2B1_REPORT.md`,
  fixtures `scripts/enrich/fixtures/geoapify-real/`, data `scripts/enrich/PHASE_2B1_DATA.json`,
  plus `.eslintrc.js` fix (scripts override now covers `.ts`, disables `expo/no-dynamic-env-var`).
- **2B-1 verdict = B (limited value).** Geoapify is OSM-derived → **0/5 venues gained any
  parking/toilets/cafe/wheelchair/opening-hours/phone**. Only addresses improved (4/5: filled
  3 missing postcodes, fixed 1 junk city). Cost 2 credits/venue (~94k for full 46,906 catalogue).
  Matching 5/5 ACCEPT but circular (Geoapify returns our own OSM objects). **Do NOT build the
  full facility-merge pipeline** — it would be an expensive no-op.
- **2B-1B confirmatory test = STOP (DECISION MADE 2026-06-07).** Ran the same pipeline on 3
  POPULAR COMMERCIAL venues (Wacky Warehouse, Twycross Zoo, National Sea Life Centre Birmingham),
  6 credits, read-only, NOT committed. Results: matches now **non-circular (0/3)** = real
  structural win; **website 3/3 genuinely new**; but facilities still **1 gain in 24 chances**
  (toilets, Sea Life only) — parking/cafe/baby-change/wheelchair/opening-hours/phone all ZERO.
  Across both tests 7/8 target fields = 0 gain over 8 venues. **FINAL: do NOT build the Geoapify
  facility pipeline.** Files: `collectGeoapifyPopular.ts`, `PHASE_2B1B_REPORT.md`,
  `PHASE_2B1B_DATA.json`, `fixtures/geoapify-popular/`. Sea Life carried `wheelchair.yes` only
  inside `categories[]` (our extractor doesn't read that) — noted, not worth a parser.
- **⏭ REMAINING DECISIONS for the user:** (A) whether to do a narrow **address/postcode/website
  backfill** (the only proven Geoapify win — scope writes to postcode/city/formatted_address/
  website ONLY, never facility fields, its own credit budget); (B) whether to COMMIT the now-
  uncommitted 2B-1 + 2B-1B research files; (C) otherwise park Geoapify and move to launch
  checklist / discovery work.
- **Gates (2026-06-07):** 1251 tests pass · `tsc` 31==baseline (0 new) · `lint` 0 errors.
- **Secrets:** `GEOAPIFY_API_KEY` is in `scripts/.env` (gitignored, backend-only, never logged).
- **Paused thread:** "Better Than Google Maps" discovery sprint — Phases 2/3/5 not started
  (see the older session entries below + the auto-memory copy).

---

## Decisions Made

**Tech stack confirmed:**
- React Native + Expo SDK 51 + Expo Router v3 (file-based routing)
- Supabase (auth, database, storage, realtime) — NOT Firebase
- NativeWind v4 (Tailwind CSS for React Native)
- Zustand for state, TanStack Query for data fetching
- Stripe for payments
- Expo Notifications for push notifications
- Font: Nunito (must be downloaded and placed in assets/fonts/)

**Why:** Expo is the best choice for a first-time developer — it handles iOS/Android complexity, has great docs, and doesn't require native build tools to get started.

## What's Been Built (2026-04-08)

Foundation files created:
- `package.json` — all dependencies listed
- `app.json` — Expo config with permissions for location, camera, photos
- `tsconfig.json`, `tailwind.config.js`, `.gitignore`, `.env.example`
- `supabase/migrations/001_initial_schema.sql` — full Postgres schema with RLS, triggers, PostGIS
- `supabase/migrations/002_rpc_get_nearby_venues.sql` — PostGIS stored function for map queries
- `supabase/seed.sql` — 12 categories, 20 facilities
- `types/index.ts` — all TypeScript interfaces
- `lib/supabase.ts`, `lib/stripe.ts`
- `constants/theme.ts` — brand colours, fonts, spacing
- `store/authStore.ts`, `store/filterStore.ts`
- `hooks/useAuth.ts`, `hooks/useLocation.ts`, `hooks/useVenues.ts`
- `app/_layout.tsx` — root layout wiring Stripe, QueryClient, auth listener
- `app/(auth)/` — welcome, login, register screens
- `app/(tabs)/` — explore (map), search, favourites, profile tabs
- `app/venue/[id].tsx` — full venue detail screen
- `app/venue/add.tsx` — user venue submission form
- `app/business/dashboard.tsx` — business owner dashboard
- `app/admin/moderation.tsx` — admin approve/reject screen

## Session: 2026-04-09

### What happened this session
- Ran `/init` — CLAUDE.md updated: filled in real commands from `package.json`, removed placeholder text and stale "update this file" note at the bottom.
- Three custom agents created via `/agents` and saved to `C:\Users\Liame\.claude-work\agents\`:
  - `ux-wireframe-designer` — designs screens, wireframes, and user flows; checks ICO Children's Code compliance in every design
  - `fullstack-architect` — architectural guidance, folder structure, data flows, security-first implementation plans
  - `security-compliance-reviewer` — post-code-change reviews across security, UK/EU compliance, completeness, performance, and best practices
- Agent memory bootstrapped for all three agents at `C:\Users\Liame\.claude-work\agent-memory\<agent-name>\`:
  - `user_profile.md` — first-time developer profile
  - `project_playplanner.md` — PlayPlanner context tailored to each agent's focus
  - `MEMORY.md` — index file

### Real commands (confirmed from package.json)
- `npm test` — run tests in watch mode
- `npm run test:ci` — run tests non-interactively (for CI)
- `npm run lint` — check for code style errors
- `npm run lint:fix` — auto-fix code style errors
- `npm run type-check` — check TypeScript types (no output files)
- `npx expo start` — start the dev server (add `--android`/`--ios`/`--web` to target a platform)

## Tools & MCP Setup

**Context7 MCP (2026-04-08):**
- Added to local project config via: `claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp@latest`
- Config file: `C:\Users\Liame\.claude.json` (project: D:\PlayPlanner)
- Provides up-to-date library docs (Expo, Supabase, React Native, etc.) inside Claude Code
- After adding, Claude Code must be fully restarted for the MCP to appear under `/mcp`
- If `/mcp` still shows nothing after restart, run `claude doctor` to diagnose
- **Status check (2026-04-08):** `/mcp` showed "No MCP servers configured" — may need to be re-added or Claude Code restarted again

## Session: 2026-04-09 (continued)

### MCP Server Setup
- **context7**: Connected and working
- **Figma MCP**: Abandoned — requires Figma desktop app + Dev Mode (paid feature). Removed.
- **Supabase MCP**: Added (`https://mcp.supabase.com/mcp?project_ref=iftiyxwacptsyachgdus`) but shows "Needs authentication". OAuth flow not triggering from CLI. Next step: restart Claude Code and try using a Supabase tool in conversation to trigger OAuth browser popup.
- **Root issue**: All HTTP MCP servers require OAuth. CLI `claude mcp get` doesn't trigger browser. Browser itself works (`start` opens Chrome). OAuth may only trigger when tool is first used in a conversation.
- **Key rule saved**: Always check if a tool/feature requires payment before suggesting it.

## Session: 2026-04-09 (Schema Review & Fix)

### What SUCCEEDED
- **Full security + GDPR review** of `001_initial_schema.sql` completed (two passes: secom-reviewer agent + manual)
- **Schema fully rewritten and patched** — file is at `D:\PlayPlanner\supabase\migrations\001_initial_schema.sql` (831 lines)
- All critical issues fixed:
  - Moderation bypass closed: venues/reviews/photos now enforce `pending`/`false` on insert via RLS `WITH CHECK`
  - `children_ages` changed from `int[]` to `text[]` (age ranges, not exact ages — ICO data minimisation)
  - `SECURITY DEFINER` functions (`handle_new_user`, `is_admin`) now have locked `search_path`
  - Fake GDPR consent removed — `terms_accepted_at` no longer auto-set by trigger
  - Photos default to `is_approved = false` (not auto-approved)
  - Reviews default to `moderation_status = 'pending'` (not auto-approved)
  - RLS enabled on ALL tables including `categories` and `facilities`
  - All 8 tables that had RLS but no policies now have full working policies
  - Admin bypass policies added for venues, reviews, photos
  - Right to erasure: profile DELETE policy added
  - `gdpr_audit_log` table added (GDPR Art.5(2) accountability)
  - `location_consent_log` table added (GDPR Art.7 + ICO Standard 10)
  - `min_age <= max_age` constraint added
  - 4 missing indexes added
  - `business_subscriptions` updated_at trigger added

### What FAILED / Still Pending
- **Schema NOT yet run in Supabase** — this is the immediate next step
- **Supabase MCP auth** — still unresolved (OAuth not triggering). Not blocking.
- **Profile column exposure** — RLS can't restrict columns, only rows. `stripe_customer_id`, `is_admin`, `children_ages` etc. are visible to any authenticated user who queries another user's profile row. Fix is app-level: only ever select safe columns (`id, username, full_name, avatar_url, bio, is_business_owner`) when loading other users. Documented in schema comment block at bottom of file.
- **`terms_accepted_at` app fix** — `register.tsx` must explicitly set this when user ticks "I accept." Not done yet.

### Known limitation to fix later
- A `public_profiles` VIEW should be created to formally restrict which columns are visible to other users. Deferred to later phase.

## Session: 2026-04-10 — App Running

### What was completed this session

**Infrastructure — all done:**
- ✅ SQL migrations run in Supabase: `001_initial_schema.sql`, `002_rpc_get_nearby_venues.sql`, `seed.sql`
- ✅ Node.js installed
- ✅ `npm install` completed (`--legacy-peer-deps` required due to SDK version conflicts)
- ✅ Nunito fonts downloaded → `assets/fonts/`
- ✅ Google Maps API key obtained and added to `.env`
- ✅ `.env` file created with Supabase URL, anon key, and Google Maps keys
- ✅ Expo account logged in via SSO (`npx expo login --sso`)

**SDK upgrade — Expo SDK 51 → SDK 54:**
- ✅ Upgraded expo to `~54.0.33` (Expo Go on phone was SDK 54, project was SDK 51)
- ✅ Updated all package versions to SDK 54 compatible versions
- ✅ Updated devDependencies (`@types/react`, `eslint-config-expo`, `jest-expo`)
- ✅ Clean reinstall with `--legacy-peer-deps`

**New files created:**
- ✅ `babel.config.js` — minimal Expo babel config (no reanimated plugin — removed in Reanimated v4)
- ✅ `metro.config.js` — Expo default config + NativeWind v4 wiring
- ✅ `global.css` — Tailwind directives for NativeWind v4
- ✅ `assets/images/` — placeholder PNGs (icon, splash, adaptive-icon, favicon, notification-icon)

**Bug fixes:**
- ✅ `tsconfig.json` — fixed `@/` alias from `./src/*` → `./*` (project has no `src/` folder)
- ✅ `app/_layout.tsx` — added `import '../global.css'` for NativeWind
- ✅ Installed `expo-linking` (missing package required by expo-router v6)
- ✅ Installed `react-native-worklets` (required by Reanimated v4 plugin system)
- ✅ `types/index.ts` — `children_ages` type is `number[]` but DB schema uses `text[]` — **NOT YET FIXED** (deferred)

**App status:**
- ✅ **App is running on phone via Expo Go**
- Welcome screen renders with correct content (title, feature list, buttons)
- NativeWind styling not yet applied — screen renders unstyled (plain text, no layout/colours)

### Agent work completed this session
- **secom-reviewer** — reviewed `babel.config.js` and `package.json`: all clear, no issues
- **Archivist** — full folder structure analysis completed; proposed restructure documented below
- **secom-reviewer** — full compliance audit of codebase structure: 2 critical issues, 3 high, 4 medium, 2 low

## Session: 2026-04-11 — Location & Filtering Compliance Review

### Security & Compliance Review Completed

**Files reviewed (4 files, 1,182 lines total):**
1. `components/filters/FilterSheet.tsx` (684 lines) — category filter panel, fully functional
2. `app/(tabs)/index.tsx` (349 lines) — map screen with consent flow, location centering
3. `hooks/location/useLocation.ts` (86 lines) — location request hook (Accuracy.High change)
4. `app/(tabs)/_layout.tsx` (63 lines) — tab bar with safe area fix

**Review results:**
- ✅ No secrets or hard-coded credentials
- ✅ Consent gate is solid — location never accessed without explicit user agreement
- ✅ Coordinates properly rounded to 111m before storage (GDPR data minimisation)
- ✅ All type checks pass (tsc --noEmit)
- ✅ No lint errors in reviewed files

**Issues found:**

🔴 **CRITICAL (1):**
- Consent migration missing on auth: if user grants location consent pre-signup, it's never migrated to DB on registration/login (GDPR Art.7 violation)

🟡 **MEDIUM (3):**
- Accuracy.High + maximumAge:0 requests excessive GPS precision (should use Balanced + cached reads) — battery drain + data minimisation concern
- LocationConsentPrompt text "never stored" is incomplete (consent events are stored; fix phrasing)
- FilterSheet error message says "Pull to retry" with no retry button

🟢 **LOW (1):**
- useLocation.ts JSDoc misleading (claims it logs consent; it doesn't — parent is responsible)

**Positive patterns identified:**
- animateToRegion only called post-consent ✓
- Decline is session-only, not persisted ✓
- SecureStore for encrypted consent persistence ✓
- VenueMarker memoized for performance ✓
- Profile queries exclude sensitive columns ✓
- RLS correctly scoped ✓

**Compliance summary:**
- UK/EU GDPR: PARTIAL (consent migration missing)
- ICO Children's Code: PASS (with text improvement)
- EDPB guidance: PASS
- DPIA triggers: YES — geolocation and children's data processing

**Next steps (before merge):**
1. Fix consent migration in register.tsx and login.tsx (CRITICAL)
2. Create DPIA document (HIGH — compliance requirement)
3. Change Accuracy.Balanced + cache reads (MEDIUM)
4. Fix LocationConsentPrompt text accuracy (MEDIUM)
5. Clarify useLocation.ts JSDoc (LOW)

---

## Critical Compliance Issues to Fix Next Session

### 🔴 Critical
1. **Location consent never logged** — `useLocation.ts` requests permission but never writes to `location_consent_log` table. GDPR Art.7 violation.
2. **`children_ages` column exposed** — all authenticated users can query any profile and see children's ages. ICO Children's Code violation. Fix: audit all profile queries to only select safe columns (`id, username, full_name, avatar_url, bio, is_business_owner`).

### 🟠 High
3. No consent screen before location permission dialog (ICO Children's Code Standard 10)
4. No consent withdrawal UI (GDPR Art.7(3))
5. Stripe webhook handler doesn't exist (venues stay "premium" after subscription cancels)

### 🟡 Medium
6. All profile queries need auditing — `stripe_customer_id` and `subscription_tier` also exposed to other users
7. No consent history UI (GDPR Art.15)
8. No GDPR data subject request workflow (GDPR Arts.15–22)

### 🟢 Low
9. Minor memory leak in `useLocation.ts` — no AbortController on unmount
10. `children_ages` TypeScript type is `number[]` but DB schema is `text[]` — fix in `types/index.ts`

---

## Proposed Folder Restructure (Archivist — do next session)

Key additions (nothing in `app/` changes — routing untouched):
- `hooks/location/` — move `useLocation.ts` here + add `useLocationConsent.ts`, `useLocationPermission.ts`
- `services/consent/` — reusable consent record/withdraw functions
- `services/location/` — coordinate rounding, spoofing checks, consent logging
- `services/audit/` — single reusable GDPR audit log writer
- `components/consent/` — `ConsentCheckbox.tsx` + `LocationConsentPrompt.tsx`
- `constants/location.ts` — fallback coords, radius limits
- `constants/categories.ts` — missing file listed in CLAUDE.md

Only import change needed: `app/(tabs)/index.tsx` line 9 — update `useLocation` import path.

---

## Session: 2026-04-12 — Profile Screen Architecture & Security Review

### Tasks completed
- Full architectural plan for profile section (6 routes designed, build phases defined)
- Full UI design for all 5 profile screens (self-profile, edit, privacy settings, children's ages, public profile)
- Full security review of profile-related code

### Critical finding from security review
- No `public_profiles` database view exists — children_ages and is_admin are column-accessible to any authenticated user who queries another user's profiles row
- Fix: create `supabase/migrations/003_public_profiles_view.sql` before building any profile screens
- Full details: `.claude/memory/profile_architecture.md`

### Decisions made
- Postcode only on profiles (no GPS, no coordinates) — developer's explicit requirement
- children_ages is private to own user only — never in public_profiles view
- public_profiles view exposes only: id, username, full_name, avatar_url, bio, is_business_owner
- Edit profile fields: full_name, username, avatar_url, bio, postcode
- Privacy settings screen contains: location consent, children's ages link, profile visibility, marketing, GDPR rights
- New file needed: hooks/useProfile.ts (useUpdateProfile, usePublicProfile, useUpdateChildrenAges, useWithdrawLocationConsent)

## Session: 2026-04-12 (evening) — Styling fixed, DCG installed, DB confirmed

### Completed this session

**NativeWind styling FIXED ✅**
- Root cause: `SafeAreaView` from `react-native-safe-area-context` was used with `className` across all screens but was never registered with `cssInterop`. NativeWind v4 requires this for any third-party component.
- Fix: added `cssInterop(SafeAreaView, { className: 'style' })` to `app/_layout.tsx` (lines 3–8)
- Confirmed working on device — app now shows correct colours, layout, cards, fonts.
- NativeWind actual installed version is `4.2.3` (not 4.0.1 — the ^ range resolved higher). Fully compatible with RN 0.81.

**All database migrations confirmed applied ✅**
- Migration 003 (public_profiles view): APPLIED — confirmed via SQL query. View exposes only: id, username, full_name, avatar_url, bio, is_business_owner, show_reviews_publicly, created_at. Excludes children_ages, is_admin, stripe_customer_id. WHERE show_in_search = true.
- Migration 006 (GDPR audit log policies): APPLIED — 3 policies confirmed: Admins can view all audit logs, Users can log own audit events, Users can view own audit log.
- All 7 migrations/seeds now confirmed applied. Database is complete.

**Destructive Command Guard (DCG) installed ✅**
- Tool: github.com/Dicklesworthstone/destructive_command_guard v0.4.3
- Protects against accidental destructive commands (rm -rf, git reset --hard, git push --force, etc.)
- Wired into Claude Code as a PreToolUse hook via `dcg install`
- Binary at: /c/Users/Liame/.local/bin/dcg
- **Requires Claude Code restart to activate**
- Install required: MSYS2 + mingw-w64-gcc + mingw-w64-binutils (for dlltool.exe and gcc.exe — the install script forces the GNU Rust toolchain because it detects Git Bash as mingw64)

### Known open issues (carried forward)
- £9.99/mo on profile screen vs £2.99 on upgrade screen — decide correct price before launch
- location consent not logged to DB after permission granted (GDPR Art.7 — critical)
- children_ages TypeScript type is number[] but DB uses text[]
- profile.tsx: Alert.alert wrong argument count (line 83)
- LocationConsentPrompt "never stored" wording inaccurate
- app/profile/children-ages.tsx not built (linked from privacy settings)
- hooks/useProfile.ts missing: usePublicProfile, useUpdateChildrenAges, useWithdrawLocationConsent

## Session: 2026-04-13 — Review Flow Hardening (COMPLETE)

### What was completed
- **Review flow confirmed built** — ReviewForm, ReviewCard, review route screen and useReviews hooks were already in place from prior sessions
- **BODY_MAX confirmed at 500** (data minimisation, easier moderation)
- **Migration 009 written and applied** — `supabase/migrations/009_reviews_own_venue_policy.sql`
  - Closes HIGH: INSERT policy blocks own-venue reviews (NOT EXISTS on claimed_by + submitted_by)
  - Closes HIGH: UPDATE policy now has WITH CHECK — prevents editing approved reviews or status-downgrade attacks
- **3 new test files written:**
  - `components/reviews/__tests__/ReviewForm.test.tsx`
  - `components/reviews/__tests__/ReviewCard.test.tsx`
  - `app/venue/[id]/__tests__/review.test.tsx`
- **All mandatory checks PASS:** lint:fix ✓ type-check ✓ test:ci ✓ (254 tests, 22 suites)
- **secom-reviewer: APPROVED TO SHIP** — security, GDPR, ICO Children's Code all signed off

### Outstanding (carry forward)
- Rate limiting on reviews (MEDIUM) — 10/day server-side via migration 010
- DPIA note: if `children_ages` ever added to reviews (currently stubbed []), triggers ICO Children's Code DPIA — must run before activating

## Session: 2026-06-07 — Phase 2B Geoapify Enrichment (DESIGN ONLY, no build)

### What happened
- Phase 2A (OSM enrichment) is complete + validated. OSM-only coverage is weak:
  parent_convenience avg ~0.8, accessibility avg ~4.5, rainy_day avg ~21, 89% low
  confidence, **47% OSM archive-miss**, 0 parent_friendly/accessible/rainy_day/budget tags.
- Designed (NOT built) how Geoapify fills the gaps. Design doc:
  `scripts/enrich/PHASE_2B_GEOAPIFY_DESIGN.md`.

### Key design decisions
- **Critical insight:** Geoapify Places/Place Details is OSM-derived. It is NOT a quality
  multiplier on well-tagged venues. Real value = (1) the 47% archive-miss (Geoapify's live
  DB sees venues our static `osm_archive_20260425` extract doesn't), (2) opening_hours +
  website + phone (OSM archive gives almost none), (3) fresher snapshot.
- **Endpoints:** Geocoding API (matching, gives `rank.confidence`) → Place Details
  (facts). 2 credits/venue. Free tier = 3,000 credits/day shared, 5 rps.
- **Matching:** hard distance gate ≤150m + name_sim ≥0.50 + composite score ≥0.70 = ACCEPT.
  REVIEW band logged not written. Pure, fixture-testable matcher.
- **Merge precedence:** manually_curated > OSM explicit > Geoapify explicit > OSM inference
  > Geoapify inference > null. OSM explicit always wins; Geoapify only fills nulls.
  Accessibility NEVER upgraded over an OSM negative (safety).
- **Safety/limits:** backend-only, key in `scripts/.env` (GEOAPIFY_API_KEY) never client,
  cache raw in `venue_enrichment.raw_geoapify` (already exists) + on-disk fixtures,
  ≤500 credits/day budget, 1.2s spacing, dry-run default, Phase-2A-style --write gates.
- New fields (opening_hours/website/phone) captured in raw_geoapify first; columns added
  only in a LATER migration after the 20-venue dry-run proves value.
- **Recommendation:** qualified YES — build 2B-0→2B-2 (logic + fixtures + 20-venue
  dry-run, ~40 credits) then STOP and review footer stats before scaling.

### Explicitly NOT done (per sprint instruction)
- No implementation, no live Geoapify calls, no scaled OSM write, no app wiring.

## Session: 2026-06-07 (cont.) — Phase 2B-0 BUILT (no-network foundation)

Built the pure, no-network Geoapify foundation. **No live calls, no credits, no
DB writes, no app wiring** — all logic exercised against saved fixtures.

### Files added
- `types/enrichment.ts` — appended Geoapify types (GeoapifyResponse, VenueMatchInput,
  GeoapifyRawBundle [fixture/cache format], MatchResult, AnnotatedFacts + provenance,
  FieldConflict, MergeResult, GeoapifyExtras).
- `scripts/enrich/osmProvenance.ts` — `annotateOsmFacts(tags)`: reuses Phase 2A
  `extractRawFacts`, adds per-field explicit/inferred provenance (no logic duplication).
- `scripts/enrich/geoapifyExtract.ts` — raw GeoJSON feature → annotated facts + extras
  (opening_hours/website/phone/email captured, not yet a column).
- `scripts/enrich/geoapifyMatch.ts` — pure matcher: haversine, name normalise + Dice/
  Levenshtein similarity, composite score, ACCEPT/REVIEW/REJECT gates
  (DISTANCE_GATE_M=150, ACCEPT_SCORE=0.70, REVIEW_SCORE=0.55, NAME_FLOOR=0.50),
  non-family category demotion.
- `scripts/enrich/mergeFacts.ts` — `mergeAnnotatedFacts(osm,geo)`: precedence
  (OSM explicit > Geoapify explicit > OSM inferred > Geoapify inferred > null),
  conflict logging, accessibility guard (Geoapify NEVER overrides a non-null OSM
  wheelchair/baby-change value; fills nulls only), `emptyAnnotatedFacts()`.
- Fixtures: `scripts/enrich/__tests__/fixtures/geoapify/*.json` (+ README documenting the
  raw-response fixture format): willows (accept), wrong-name-same-coords (reject/name),
  far-away-same-name (reject/distance), borderline-review, category-collision (demote),
  no-candidates.
- Tests: geoapifyMatch / geoapifyExtract / mergeFacts test files (56 new tests).

### Checks (all green)
- enrich suite: 189 pass (133 prior + 56 new). Full project: **64 suites, 1251 tests pass.**
- Lint: clean on all new files.
- tsc: **0 new errors** — baseline 31 == after 31 (the 31 are pre-existing app-code
  errors in useVenues/useReviews/authStore/SkeletonLoader/useLocation/profile routes,
  NOT mine). Fixed one self-introduced cast in mergeFacts.ts (RawFacts→Record via unknown).

### NOT done (by instruction) + next
- No geoapifyClient.ts (the HTTP layer) yet — deliberately out of 2B-0 scope.
- NOT committed (user asked not to auto-commit).
- Next = 2B-1: one-time manual Geoapify call for ~5 venues to save REAL fixtures and
  eyeball the matcher, then 2B-2 the 20-venue dry-run. Needs GEOAPIFY_API_KEY in
  scripts/.env (backend only). Suggest delegating the build steps to Main-coder/elite-engineer.

## Session: 2026-06-07 (cont.) — Phase 2B-1 BUILT, BLOCKED on API key

Goal: collect 5 REAL Geoapify responses + compare vs OSM to decide if Geoapify is
worth implementing. Research/validation only — NO DB writes, NO app wiring.

### Built (all gates green, NOT committed)
- `scripts/enrich/geoapifyClient.ts` — backend-only HTTP client. Reads
  GEOAPIFY_API_KEY from env (never client, never logged — URL redacted). Rate
  limit 1.2s/req, retries+backoff on 429/5xx, daily credit budget guard,
  `geoapifyClientFromEnv()` throws clear instructions if key missing.
- `scripts/enrich/collectGeoapifyFixtures.ts` — reads 5 venues READ-ONLY,
  geocode→match→place-details, saves raw fixtures to
  `scripts/enrich/fixtures/geoapify-real/`, prints OSM-vs-Geoapify comparison +
  match audit + cost summary, writes `PHASE_2B1_DATA.json` for offline analysis.
  Requires key; refuses + exits cleanly without it (verified — no API call made).
- `.eslintrc.js` — extended the `scripts/**` override from `.js` to `.{ts,js}` and
  disabled `expo/no-dynamic-env-var` there (Expo app-bundle rule, inapplicable to
  backend scripts; also conflicts with TS noPropertyAccessFromIndexSignature).
  This ALSO fixed pre-existing lint errors in Phase 2A's enrichVenues.ts.

### 5 selected venues (real, OSM-enriched, mixed categories)
- playground: Kingsmill Road Play Area (006a4f51…, no postcode)
- soft-play: Tots & Dots Play Cafe (01144e3c…, MK11 1AQ)
- swimming: Phoenix Swimming Pool (0060d2e5…, no postcode)
- museum: Foyle Valley Railway Museum (02c755b7…, BT48 6SQ)
- zoo/farm: Porfell Wildlife Park & Sanctuary (00796cc5…, no postcode)
Note: existing OSM enrichment for these is mostly `low` confidence with null
facilities — the exact weakness we're testing Geoapify against.

### Gates (2026-06-07)
- npm test: 64 suites / 1251 pass. tsc: 31 == baseline (0 new). lint: 0 errors.
- Network to Geoapify confirmed reachable (got HTTP 401 to an invalid key).

### COMPLETED — live run done (key added by user, 10 credits spent)
- Report: `scripts/enrich/PHASE_2B1_REPORT.md`. Raw fixtures:
  `scripts/enrich/fixtures/geoapify-real/`. Data: `scripts/enrich/PHASE_2B1_DATA.json`.
- **Matching: 5/5 ACCEPT** (dist 0–8m, name_sim 1.0) — but CIRCULAR: Geoapify returned
  our exact OSM objects (Foyle museum place_id = `openstreetmap:venue:node/13705933001`
  = our osm_id). Validates matcher mechanics, not Geoapify as independent source.
- **Facilities/accessibility/hours: 0/5 gain.** No parking/toilets/cafe/baby-change/
  wheelchair/opening_hours/phone for ANY venue. Confirmed via `datasource.raw` — the
  OSM tags Geoapify uses are as sparse as ours. Geoapify IS OSM here.
- **Address/postcode: REAL gain (4/5).** 3/5 missing postcodes resolved (RG21 3LD,
  NR31 8JU, PL13 2RW), 1 junk city fixed (Foyle "BT48"→"Derry/Londonderry").
- **Cost: 2 credits/venue → 2,000/1k → ~93,812 for full 46,906 catalogue (~32 days
  free tier)** — a poor trade for 0 facility gain.
- **Enrichment confidence: NOT improved** (0 facility gap-fills).
- **RECOMMENDATION = B (limited value) for the facility-enrichment goal. Do NOT build
  the full Geoapify facility-merge pipeline** (would be an expensive no-op). Two smaller
  options offered (not actioned): (1) narrow address/postcode backfill using
  geoapifyClient — genuinely useful; (2) confirmatory test on 2-3 popular COMMERCIAL
  venues (~4-8 credits) before final no-go, since n=5 were all low-profile OSM venues.
- Gates green: 1251 tests, tsc 0-new, lint 0-errors. NO DB writes. NOT committed.
- Sample-bias caveat: all 5 were low-confidence OSM venues; popular commercial venues
  untested. Matcher's reject/discrimination + non-OSM venue matching also untested live.

## What Needs to Be Done Next

**Start of next session — pick up here:**
1. Fix location consent logging to DB (GDPR critical — `hooks/location/useLocation.ts`)
2. Fix `children_ages` type in `types/index.ts` (`number[]` → `string[]`)
3. Build `app/profile/children-ages.tsx` (missing screen)
4. Add missing hooks to `hooks/useProfile.ts` (`usePublicProfile`, `useUpdateChildrenAges`, `useWithdrawLocationConsent`)
5. Rate limit on review submissions — migration 010 (MEDIUM)

**Earlier outstanding items:**
1. Implement folder restructure (archivist's proposal in earlier session)

**Still to build:**
- `components/map/VenuePin.tsx`
- `app/business/upgrade.tsx` — Stripe subscription flow
- Venue photo upload (migration 007 applied, VenuePhotoUpload component + moderation tab needed)
- Geocoding (postcode → lat/lng via Google Geocoding API)
- Opening hours input in add venue form
- Facilities selector in add venue form
- Push notifications logic
- Social login (Google OAuth)
- Business claim listing flow
- Admin analytics view
- EAS Build / App Store setup
- GDPR data subject request workflow
- Consent history UI
- Groups/social features
- Facilities selector in add venue form

**Stripe webhooks (needed for subscriptions to work):**
- Supabase Edge Function to handle Stripe webhook events
- Update `venues.is_premium` when subscription goes active/cancelled
- Update `profiles.subscription_tier` when user premium changes

**Not yet started:**
- Push notifications logic
- Social login (Google OAuth)
- Business claim listing flow
- Admin analytics view
- App Store / Play Store setup (EAS Build)
- GDPR data subject request workflow
- Consent history UI
- Groups/social features (schema + UI + moderation)

---

## Session — 2026-06-13 (Discover tab rebuild) — UNCOMMITTED on `ui-reskin`

Built a new **Discover** tab (replaces visible Search; Search hidden via `href:null`,
still reachable from a top-right search icon → `/search`). Polished over many
visual passes into a premium editorial "magazine" experience.

New: `app/(tabs)/discover.tsx`, `app/discover/[collection].tsx` (one reusable
collection page — consent-gated, reuses cached `useNearbyVenues`, real predicates,
hides empty), `lib/collections.ts` (defs + `getSeasonalCollection` via existing
`getSeasonalTheme`, key `'seasonal'`), `components/discover/CollectionCard.tsx`
(hero/compact/default scales, floating bubbles), `components/discover/illustrations/
CollectionIllustration.tsx` (soft line-art via react-native-svg).
Changed: `_layout.tsx` (Search→Discover tab), `index.tsx` (removed Seasonal Picks
from Home). Deleted: `components/home/SeasonalPicksRow.tsx` + test (now unused).

Discover = Seasonal hero (rotates monthly) + COLLECTIONS 2-col mosaic
(burn-energy, rainy-day, free-days-out, hidden-gems). Honest predicates only
(hidden-gems = outdoor/nature slug AND review_count<=5; no fake popularity).
Clean type titles (no inline emoji); line-art carries personality.

Gates: tsc 31 (baseline) · lint 0 err / 73 warn · tests 79 suites / 1406 pass.
NOT committed — awaiting device screenshots. `main` untouched; not merged.

Strategy decided (Discover magazine): NEXT buildable = **Weekend Ideas**
(weather-aware collection, no new query). DELAY: Recently Added (RPC lacks
`created_at`) + Popular/Trending (no engagement analytics = fake risk). See
`next_session_reminder.md` for the full plan and verified data facts.
