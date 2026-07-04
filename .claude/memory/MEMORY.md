# Shared Project Memory

This file is the index for shared memory across all Claude accounts working on this project.
Each entry links to a memory file with more detail.

**Important:** Always read this file at the start of a session. Always update it when progress is made.

---

## ⭐ CURRENT STATE / RESUME HERE (2026-06-29)

**Phase 4 of Website Enrichment DONE — admin UI automation layer built + all gates green.**
Branch: `feat/website-enrichment-pr`. NOTHING committed/pushed (per earlier safety rules; migration 057 still NOT applied).

Phase 4 files added/modified (DO NOT modify without approval):
- `hooks/useEnrichmentProposals.ts` — extended: ProposalRow now has Phase 4 cols (decision, decision_reasons, etc.), new hooks (useEnrichmentSummary, useAutoApplyCandidates, useAppliedWrites, useTerminalProposals, useEnrichmentRuns, useRunWrites, useRollbackRun)
- `hooks/useEnrichmentBatch.ts` — NEW: sequential guarded batch driver; ref-based idempotent guard (not setState); always stops on not_authorized or auth error; stale/validation_failed never counted as applied
- `components/admin/EnrichmentSummary.tsx` — NEW: summary chip strip above tabs
- `components/admin/AutoApplyBatchPanel.tsx` — NEW: preview → confirm → results batch panel
- `components/admin/EnrichmentAudit.tsx` — NEW: write history + engine decisions sub-tabs
- `components/admin/EnrichmentRollback.tsx` — NEW: run-selector → write preview → confirmed rollback
- `app/admin/enrichment.tsx` — REWRITTEN: 4-tab layout (review/auto-apply/audit/rollback); exception filter chips; description prefill for engine proposals (decision='manual_review'); reason chips (REASON_LABELS); char counter; ConfirmModalNewValue component
- `hooks/__tests__/useEnrichmentBatch.test.ts` — NEW: 27 tests (sequential, auth-stop, stale-not-applied, idempotent, batchOutcomeMessage)
- `app/admin/__tests__/enrichment.test.tsx` — EXTENDED: 42→63 tests (+21 Phase 4: tabs, filters, reason chips, description prefill, whitespace sanitization, char counter)

**Gate results (2026-06-29):**
- test:ci: **1894/1894** (98 suites) — up from 1691 baseline
- type-check: **31 errors, 0 new**
- ESLint on changed files: **0 errors, 0 warnings**

**Migration 057 NOT applied. No production contact. No commit/push. Draft PR still open.**
**NEXT: Liam provides the non-prod-apply approval sentence (see next_session_reminder.md) OR reviews Phase 4 UI manually.**

## ⭐ FORMER STATE / RESUME HERE (2026-06-27)

**MID-DIAGNOSIS of migration-history problems — nothing edited/applied/committed/pushed; prod READ-ONLY only.**
Two separate, fully-diagnosed issues on `feat/website-enrichment-pr`:
1. Local fresh replay fails at **migration 016** (NOT 013) — `venues_osm_id_unique` index (013) vs constraint
   (016) name collision (`42P07`). Prod fine (manual fix done out-of-band). Fix = prepend
   `DROP INDEX IF EXISTS venues_osm_id_unique;` to 016 — NOT yet applied.
2. **044–056 ledger drift** — prod ledger has 001–043 + 7 timestamp rows (=046,047,049,051,052,054,055);
   local 044,045,048,050,053 are unrecorded but their objects exist in prod. `db push` would try to re-apply
   ALL 044→056 to PROD → **must NOT run `db push`/`migration repair` without approval.** 056 not in prod (correct).
**⏭ Resume:** finish the drift workup (db push --dry-run readout, reconciliation table + ranked plan) then,
on approval, reconcile ledger → 016 fix → 056 non-prod validation. Full detail: `next_session_reminder.md` + `project_progress.md`.

## ⭐ Former state (2026-06-24 d)

**Website Enrichment feature COMMITTED + draft PR OPEN (do NOT merge).** Single clean commit `dd6ab8b`
on `feat/website-enrichment-pr` (cut from `origin/main`, 37 feature files); draft PR → `main` created on
the user's GitHub account. Checkpoint branch `feat/website-enrichment` = `15735bb` (untouched). `main` not
pushed; migration 056 NOT applied (latest = 055); **no `--propose`/`--apply` ever run; no prod touched.**
Gates at commit: full 1691, enrich 476, DB 27/27 (pglite), tsc 31, lint 0. secom CLEAN, bughunter justified
fixes applied. **NEXT (tomorrow, user-requested): rollout PREP readout only** — re-open the 056 apply
checklist + DPIA addendum and tell the user exactly which manual approvals/details they must supply before
056 can be applied; do NOT apply/propose/apply/deploy. Full plan: `next_session_reminder.md`.

## ⭐ Former state (2026-06-24 c)

**50-venue dry-run pilot DONE + graded + hardened. Awaiting user OK for a tiny (≤5) `--propose` pilot.**
First dry-run (network, £0, ~3.8s/venue): 50 processed, 84 proposals. Graded vs spec §12 — most gates
passed; failures caught: Torre Cider parked-domain CJK gambling-spam description, Cookie's Island
web-agency template (incl. a HIGH-conf wrong email), Lakeside=Irish-hotel wrong-venue, Holmside mangled
`tel:%20` phone, Holmside/AirHop duplicate-day opening-hours conflicts, unreliable heuristic price_range,
booking_url false-positives (photos/projects/offers). Then implemented a **hardening slice** (all
UNCOMMITTED): `openingHours.ts` overlap/conflict reject + schema midnight-00:00→24:00 + backward-interval
guard; `fields.ts` `normaliseTelHref` (percent-decode + strip `;ext=`), `isSaneDescription` (non-Latin
dominance + template/parked markers + low-letter-density), tightened `isLikelyBookingUrl`; `htmlExtract.ts`
numeric-HTML-entity decode + description sanity gate + REMOVED heuristic price_range. `secom-reviewer`
CLEAN; `bughunter` 1 orange + several yellow → applied justified ones (ext-strip, low-letter guard, marker
fragment removal, schema backward+midnight). Re-graded via `--cache-only` (£0): 84→71 proposals, **13 junk
removed, 0 good lost**; opening-hours structural correctness 50%→**100% of emitted weeks**; Torre now 0
proposals. Gates: jest scripts/enrich **470 pass**, full **1684 pass / 93**, tsc **31**, lint **0**.
NOTHING committed/proposed/applied; migration 056 NOT applied. **5 verified pilot venue IDs + exact
command in `next_session_reminder.md`.**

## ⭐ Former state (2026-06-24 b)

**Enrichment pilot: ALL 5 pre-scale fixes DONE. Ready for the user to approve the dry-run.**
#1 phone dedup ✅, #2 opening-hours guards ✅, #4 meaningful description ✅ (done earlier).
#3 robots timeout ✅ — **was actually already finished** (webClient.ts leaf-level Promise.race;
the "3 failing tests" note was stale). #5 category-stratified sampling ✅ DONE this session:
NEW pure helper `scripts/enrich/sampling.ts` (`stratifiedSample` = two-tier round-robin: outing
categories balanced first, childcare/unknown = filler only) + `__tests__/sampling.test.ts` (20 tests);
wired into `enrichWebsites.ts` `fetchPilotVenues` (now fetches ALL eligible paged, resolves
category_id→slug, stratifies; `--venue-id` + `pilot_venue_ids.json` still bypass sampling).
Verified REAL category slugs against live DB (NOT memory): outing slugs with eligible venues =
sports-activity 1533, museum 997, childcare(=filler) 786, park 750, attraction 243, playground 236,
soft-play 209, animal-attraction 162, theme-park 114, swimming 103, bowling 46, trampoline 18
(`farm`/`indoor-play` = 0 eligible). **The `--limit=50` sample = 50 venues, 0 childcare, balanced 5/5/5/5/5/5/4/4/4/4/4
across the 11 outing cats.** secom-reviewer: 0 Crit/High blocking — applied 2 justified guards
(empty-categories hard-fail; unmapped-category_id warning). Gates: jest scripts/enrich **440 pass**,
full **1655 pass / 93 suites**, tsc **31** (baseline), lint **0 err**. Dry-run only; NOTHING
committed/proposed/applied; migration 056 still NOT applied. **Exact approved command in
`next_session_reminder.md`.**

---

## ⭐ Former state (2026-06-23)

**Two big corrections vs older notes below:**

1. **The v2 DARK reskin was REVERTED.** Commit `7c17c1c` (2026-06-21) "roll back v2 dark
   redesign (restore light editorial at ba9342b)". The app is back to the **LIGHT editorial**
   look. `main` HEAD is now `1c302ea` (1 ahead of `origin/main`). All notes below about the
   dark reskin being merged/live are HISTORY — `HANDOFF_v2_reskin.md` is stale.

2. **Active thread = "Venue Website Enrichment"** (backend feature; spec
   `scripts/enrich/WEBSITE_ENRICHMENT_SPEC.md` v2, 2026-06-22). Reads each venue's OWN public
   website → extracts opening hours / price / contact / facilities as **reviewable proposals**
   (human approves before anything is written). Privacy-careful: robots honoured, SSRF guards,
   no auto-apply, GDPR legit-interest documented (spec §16). Migration `056` is written but
   **NOT applied** (latest applied = 055). All enrichment work is **UNCOMMITTED** by design.

**Build progress (spec §15):** steps 1–3 done earlier (migration SQL, `types/webEnrichment.ts`,
pure modules + fetch layer + tests). **This session (2026-06-23): step 4 done** — built the
dry-run orchestrator `scripts/enrich/enrichWebsites.ts` + DI core `scripts/enrich/web/orchestrate.ts`
+ run-level report renderers in `report.ts` + tests. Delegated to `elite-engineer`, reviewed by
`secom-reviewer` (ZERO Critical/High/Med/Low — all PASS). Gates green: **jest scripts/enrich 369
pass / 17 suites · tsc 31 (0 new) · lint 0 err**. Dry-run is DEFAULT and writes nothing; the only
DB writes (`venue_enrichment_runs` insert + `propose_field` RPC) are fenced behind `--propose`.

**⏭ NEXT (step 5 / pilot):** (a) before any `--propose`: apply migration 056 + DPIA addendum in
`docs/DPIA.md`; (b) run the dry-run pilot to grade quality:
`npx tsx scripts/enrich/enrichWebsites.ts --limit=50` (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
in `scripts/.env`, which exists). Pre-commit todo: add `scripts/enrich/out/` to `.gitignore`
(report output; the cache `scripts/data/` is already ignored). Then build `applyProposals.ts`.

**Other open Play-Store blockers (unchanged):** app icons (1024 + adaptive), hosted privacy-policy
URL, Data Safety form, production `.aab`.

---

## (HISTORY) ⭐ Former state (2026-06-20 c) — v2 dark reskin, since reverted

**`main` is the live line again — `ui-reskin` MERGED + PUSHED.** `origin/main` HEAD =
`47ff12d`. Fast-forward merge (no merge commit); local `main` == `origin/main`, in sync.
The full **v2 DARK editorial reskin is now on `main` and on GitHub.** Not tagged, no release.
*(Superseded: this was rolled back on 2026-06-21 — see CURRENT STATE above.)*

**This session (2026-06-20 c) — reskin landed + merged:**
- Committed the last two reskin checkpoints on `ui-reskin`:
  - `8bb3b26` style(ui): complete dark editorial secondary screens (auth: welcome/login/
    register/onboarding; profile secondary screens; consent prompt; ModerationBadge).
  - `47ff12d` style(ui): darken remaining live consumer flows (the 6 light leftovers).
- **Launch audit (read-only): NO functional blockers** (routes/buttons/empty/denied/no-photo
  states all OK). Found light screens left in the dark build because the reskin flips token
  VALUES in `constants/theme.ts` (so `Colors`/StyleSheet screens auto-darken) BUT
  `tailwind.config.js` stays light AND a few screens carried local light palettes.
- **Darkened the 6 live consumer flows** (commit `47ff12d`): `app/profile/privacy-settings.tsx`,
  `app/venue/[id]/review.tsx`, `components/reviews/ReviewForm.tsx`, `app/venue/plan-visit.tsx`,
  `app/venue/add.tsx`, and the search clear-filters chip in `app/(tabs)/search.tsx`. **Pattern
  that worked:** keep each local `pp`/`PP` palette's KEYS, remap the VALUES to dark `Colors`
  tokens; pastel `*Soft`/`*Wash` washes → 12–14% rgba tints; dark-invisible `PP.ink` CTAs →
  `Colors.accent`. Verified on device (5 screenshots, all readable).
- **secom-reviewer pass on `privacy-settings.tsx`:** clean, ZERO findings, safe — informational
  screen, no mutations, non-prompting `getForegroundPermissionsAsync` read intact (ICO Std 10).
- **Merged → pushed:** ff merge `ui-reskin`→`main`, then `git push origin main` (`193dc55..47ff12d`).
- **Installed Playwright MCP** (`@playwright/mcp@latest`) — local/project scope in
  `C:\Users\Liame\.claude-personal\.claude.json`, command `cmd /c npx @playwright/mcp@latest`
  (Windows-safe; bare `npx` gets mangled by Git Bash → use PowerShell to add). Connected ✓.
  Tools (`browser_*`) appear only after a Claude Code restart.

- **Still DEFERRED (intentionally light, NOT converted):** privacy POLICY `app/(auth)/privacy.tsx`,
  `terms.tsx`, `app/admin/moderation.tsx`, `components/venue/VenuePhotoUpload.tsx`, `app/business/*`
  (B2B paused), and `tailwind.config.js`. Dead component `components/ui/VenueMini.tsx` (unused,
  left in place per instruction — do NOT delete).
- **Gates (last run, green on `main`):** test:ci **1406 pass / 80 suites** · tsc **31 == baseline
  (0 new)** · lint **0 err / 73 warn**.
- **⏭ NEXT MILESTONE:** **Preview build → full device smoke test → Play Store submission.**
  Open Play-Store blockers from before: app icons (1024 + adaptive), privacy-policy URL,
  Data Safety form, production `.aab`.
- **Reminder:** never stage/commit the memory files (`MEMORY.md`, `project_progress.md`),
  `scripts/enrich/*`, `claudedesign/`, `scripts/verify/`, or APKs.
- **Paused threads:** Geoapify venue enrichment (Phase 2B — decision was STOP); "Better Than
  Google Maps" discovery sprint.

---

## Deferred Security Remediation (2026-06-30)
- [Deferred Security Remediation](deferred_security_remediation.md) — Supabase default privileges grant ALL on public tables to anon/authenticated; systemic least-privilege gap; needs a future hardening migration. Do NOT touch during the migration-ledger investigation.

## Developer Profile
- [Developer Profile](user_profile.md) — First-time developer; use plain language and step-by-step guides

## Project Progress
- [Project Progress](project_progress.md) — Tech stack decisions, what's built, what's still to do, session log

## Profile Screen Plan (2026-04-12)
- [Profile Architecture](profile_architecture.md) — routes, data model, build phases, security findings

## Venue Photos Architecture (2026-04-13)
- Phase 2 design complete. Key decisions:
  - venue_photos table ALREADY EXISTS in migration 001 (is_approved bool, no status enum). Migration 007 ALTERS this table: adds `status` enum column (pending/approved/rejected), drops `is_approved`, adds `moderation_notes` and `moderated_by`. Also creates `venue-photos` storage bucket.
  - VenuePhoto type in types/index.ts must be updated: replace `is_approved: boolean` with `status: 'pending'|'approved'|'rejected'`, add `moderation_notes: string | null`, `moderated_by: string | null`.
  - useVenue hook in hooks/useVenues.ts must update its photo filter from `is_approved === true` to `status === 'approved'`.
  - EXIF stripping: use expo-image-manipulator (already a sub-dependency via expo-image-picker) to re-encode images before upload — this strips metadata including GPS.
  - Storage bucket name: `venue-photos` (hyphenated, not underscore — Supabase convention).
  - Storage path: `{venue_id}/{uuid}.jpg` — no user ID in path (GDPR data minimisation).
  - Upload flow: pick → strip EXIF → compress to JPEG → upload to storage → insert DB row (status=pending).
  - Moderation tab added to existing app/admin/moderation.tsx (tab switcher pattern).
  - Cover photo in venue detail: wire existing TODO comment at line 109 of app/venue/[id].tsx.

## Review Flow Architecture (2026-04-13)
All three core files are already built and wired together:
- `components/reviews/ReviewForm.tsx` — complete (star selector, title, body, visit date, privacy disclosure, submit with moderation_status=pending)
- `components/reviews/ReviewCard.tsx` — complete (respects show_reviews_publicly, initials avatar, pending badge, helpful count)
- `app/venue/[id]/review.tsx` — route screen, auth gate, duplicate gate (useMyReview), renders ReviewForm
- `app/venue/[id].tsx` — wired (useVenueReviews, ReviewCard list, "Write a review" navigates to /venue/[id]/review)
- `hooks/useReviews.ts` — complete (useVenueReviews, useMyReview, useSubmitReview, usePublicProfileReviews)

Key constraints already enforced:
- RLS: only approved reviews visible to non-owners (DB policy + client filter in useVenueReviews)
- One review per user per venue: DB unique(venue_id, user_id) + 23505 error translated to friendly message + useMyReview UI gate
- Own-venue check NOT yet in UI (venue.user_id check missing from review.tsx — see open risk below)
- Body max=1000 chars in form (task spec says 500 — MISMATCH to resolve before build)
- visit_date is optional; children_ages stubbed as [] (not collected yet)
- Privacy disclosure on form (GDPR Art.13)
- No sensitive data logged

Outstanding gaps to build next:
1. Own-venue prevention: add `venue.claimed_by !== user.id` check in app/venue/[id]/review.tsx
2. BODY_MAX discrepancy: form uses 1000, task spec says 500 — confirm with product owner
3. Tests: no tests yet for ReviewForm, ReviewCard, or the review route screen
4. secom-reviewer agent review (mandatory after build)
5. "Comment optional" in spec vs "body required" in form — confirm intended behaviour

## Agents
Three custom agents created (2026-04-09) — files at `C:\Users\Liame\.claude-work\agents\`:
- `Ui-agent` — screen wireframes, user flows, ICO-compliant UX design
- `Main-coder` — architecture, folder structure, data flows, security-first planning
- `secom-reviewer` — post-change code review: security, GDPR/ICO, completeness, performance
Each agent has bootstrapped memory at `C:\Users\Liame\.claude-work\agent-memory\<agent-name>\`

## Moderation approve silent-failure fix (2026-04-16)
Root cause: `supabase.update(...).eq('id', id)` without a chained `.select()`
uses `Prefer: return=minimal`, so PostgREST returns 204 No Content even when
RLS filtered the write down to zero rows. The venue/review stays `pending`,
no error is thrown, and the admin sees nothing happen ("approve is broken").

Fixes landed:
- `app/admin/moderation.tsx` moderateVenue + bulkApprove now chain `.select('id')`,
  throw a clear error when zero rows come back, log code/message/hint only
  (never the row — privacy), and invalidate `['venues']` so the public map
  refreshes immediately on approve. Bulk approve now reports the exact count.
- `hooks/useReviews.ts` useModerateReview — same `.select('id')` pattern,
  same zero-row guard, also invalidates `['myReview']` so the reviewer sees
  the rejection note (GDPR Art.13) immediately.
- Pending reviews query switched the join hint from
  `public_profiles!reviews_user_id_fkey` to `profiles!reviews_user_id_fkey`.
  The FK actually targets `profiles`; using the view hint was silently dropping
  reviewers whose `show_in_search = false` (default). Only username/full_name
  selected — no sensitive columns leak.
- Reviews tab now renders an error state instead of a false "all caught up"
  when the query fails. All 342 tests pass, type-check clean.
