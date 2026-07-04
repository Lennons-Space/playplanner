# DPIA Addendum — Venue Website Enrichment

**Companion to:** `docs/DPIA.md` · **Feature spec:** `scripts/enrich/WEBSITE_ENRICHMENT_SPEC.md` (§16, §18)
**Status:** SIGNED OFF 2026-06-24 by Liam Evanson (data-protection owner). LIA recorded in master `docs/DPIA.md` §2.6.
**Update 2026-07-04:** migration 056 applied + verified in production (2026-06-28); gated pilot `--propose` run completed (2026-06-28, 17 pending proposals, no live fields changed); migration 057 (decision engine + write ledger + F3/F4 GDPR FK fixes) applied + verified in production (2026-07-04) — see §9.
**Scope of processing:** reading each venue's *own public website* to extract opening hours / contact /
facilities / a short description as **reviewable proposals**. No automatic changes to live data; a human
approves (and rewrites descriptions) before anything is written via the admin-only `apply_venue_proposal` RPC.

This is an addendum, not a new DPIA: it records the incremental processing this feature introduces and the
safeguards specific to it. Tie each item back to the master DPIA before sign-off.

---

## 1. Nature of the data
- [ ] **Public-source venue data.** Inputs are public business listings + the venue's own publicly published
      website. No scraping of third-party/aggregator sites; off-domain redirects are refused (verified:
      3 `skipped_redirect_offdomain` in the pilot dry-run).
- [ ] **Sole-trader contact information may be personal data.** Some venues are sole traders, so a business
      phone/email/`firstname.lastname@` address can be personal data. Treated as personal data for this addendum
      (the extractor flags personal-looking emails and caps them to `low` confidence).
- [ ] **Not special-category data.** No children's data, no health, no location-of-individuals. Venues are
      places, not people.

## 2. Lawful basis — legitimate interest (LIA summary)
- [ ] **Purpose:** improve the accuracy/completeness of a public venue directory for parents (correct opening
      hours, contact details, descriptions) — a clear benefit to users and to the venues themselves.
- [ ] **Necessity:** the data is already public on the venue's own site; reading it is the least intrusive way
      to keep listings current. No new collection from data subjects.
- [x] **Balancing test:** low impact — business contact details the venue chose to publish; no profiling, no
      automated decisions about individuals, no enrichment of *parent* accounts. Human-in-the-loop before any
      write. **Completed LIA recorded in master `docs/DPIA.md` §2.6 (added 2026-06-24, assessor: Liam Evanson)** —
      purpose, necessity and balancing tests all documented there; outcome = Art.6(1)(f) legitimate interests is
      appropriate and not overridden.
- [ ] **PECR / e-privacy:** read-only HTTP fetches of public pages; no cookies set, no marketing, no tracking.

## 3. Data minimisation
- [ ] Only the **seven enrichment fields** are extracted (description, price_range, website, booking_url,
      phone, email, opening_hours). No bulk page archiving into the DB.
- [ ] Evidence is bounded: `evidence_snippet` ≤ 512 chars, `evidence_raw` ≤ 2048 chars (DB CHECK constraints),
      PII-scrubbed by the extractor before insert.
- [ ] Heuristic `price_range` is suppressed; only explicit structured pricing is proposed (less guessing = less
      spurious data).
- [ ] Logs print counts/slugs/URLs only — **no** venue names/emails/phones (verified in run output).

## 4. Retention & deletion
- [x] Retention rule **defined and recorded** 2026-06-24 (master `docs/DPIA.md` §12; rule owner: **Liam Evanson**);
      enforced via a future cleanup job, **not** in migration 056:
      rejected proposals → delete after **90 days**; superseded → after **30 days**; applied → retained as the
      change **audit trail**.
- [x] `venue_enrichment_runs` is append-only fetch audit; **included in the retention schedule** (§12, retained as
      append-only audit; owner: Liam Evanson).
- [ ] Local fetch cache (`scripts/data/raw/website_cache/`) and report output (`scripts/enrich/out/`) are
      developer-local, git-ignored, and deletable (`rm -rf`) — confirm they are not shipped or committed.
- [ ] Data-subject rights: a venue/owner deletion cascades (`on delete cascade` on `venue_id`); document how an
      erasure/objection request removes related proposals + runs.

## 5. Human review before any change (no automated decision-making)
- [ ] **No auto-apply.** Default run mode is dry-run; `--propose` only inserts `pending` rows; `apply_venue_proposal`
      is admin-only and stale-guarded. Nothing reaches `venues`/`opening_hours` without a named admin action.
- [ ] Confidence is advisory triage only — it never triggers a write.
- [ ] Pilot is tiny (≤ 5 verified venues) and the cap is 100 per run.

## 6. Copyright / description rewrite rule
- [ ] Descriptions must be an **original rewrite**, never the site's verbatim text — enforced in the DB:
      `apply_venue_proposal` raises `description_not_rewritten` if the applied text equals the captured
      evidence. The dry-run also rejects parked-domain spam / agency-template descriptions before they
      become proposals.
- [ ] Reviewer guidance: treat every `description` proposal as rewrite-required (capped at `medium`).

## 7. Security safeguards & audit trail
- [ ] **RLS admin-only** on both tables (`runs_admin_all`, `proposals_admin_all`) — proposals (which may carry
      business-contact PII) are never readable by anon/authenticated users.
- [ ] **Least-privilege grants:** public has none; `snapshot_current_value`/`propose_field` → `service_role`;
      `apply_/reject_` → admins via `authenticated` self-gated by `is_admin()`.
- [ ] **SSRF / fetch safety:** URL safety guard, robots.txt always honoured (no bypass flag), off-domain redirect
      refusal, size/timeout caps, fail-closed on unreachable robots.
- [ ] **Audit trail:** every fetch attempt → `venue_enrichment_runs`; every applied change keeps the pre-apply
      `current_value` + reviewer + timestamp on the proposal row.
- [ ] **Secrets:** service-role key from `scripts/.env`, never logged; no secrets in code or reports.

## 8. Required sign-off BEFORE `--propose`
- [x] DPIA addendum reviewed against master `docs/DPIA.md`; LIA recorded (master DPIA §2.6).
- [x] Migration 056 applied + verified (see `scripts/enrich/MIGRATION_056_APPLY_CHECKLIST.md` §9). — **DONE 2026-06-28 (applied via SQL Editor by Liam Evanson; objects, RPCs and privilege matrix verified).**
- [x] Retention rule scheduled/owned (owner: Liam Evanson; rule in master DPIA §12 — cleanup job to be built later).
- [x] **Data-protection owner sign-off:** name **Liam Evanson**  date **2026-06-24**
- [x] Only then run the gated tiny pilot (§10 of the migration checklist). — **DONE 2026-06-28 (read-only dry run, then `--propose --limit=5`: 17 pending proposals inserted; no live venue fields changed).**

## 9. Migration 057 — decision engine, write ledger, and erasure fixes (added 2026-07-04)

Migration 057 was applied + verified in production on 2026-07-04 (all 13 post-apply checks passed;
migration ledger reconciled). Incremental processing changes it introduces:

- **Deterministic decision engine (no AI, no profiling).** Every proposal is stamped with a rule-based
  routing verdict (`auto_apply` / `manual_review` / `auto_reject` / `report_only`), typed reason codes and
  an engine version. Decisions are about *venue listing fields*, never about individuals — no change to the
  "no automated decision-making about individuals" position in §2 / master DPIA §2.6.
- **Guarded auto-apply is NOT unattended automation.** `auto_apply_venue_proposal` is admin-only
  (`is_admin()`; no service_role grant), only ever fills **empty** fields (a non-empty live value re-routes
  to manual review), is stale-guarded, and never applies descriptions (human rewrite still required). A
  named admin initiates every batch from the in-app screen.
- **`venue_enrichment_writes` ledger.** Append-only audit of every applied/rolled-back change. It stores
  `applied_by` (the acting admin's profile UUID — personal data of staff, not of venues or parents).
  Admin-only SELECT via RLS; no client role can INSERT/UPDATE/DELETE. Retention: retained as the change
  audit trail (same class as `venue_enrichment_runs`; master DPIA §12).
- **Erasure (Art.17) fixes — F3/F4.** `venue_field_proposals.reviewed_by` and
  `venue_enrichment_writes.applied_by` are now `ON DELETE SET NULL`, so deleting an admin account no longer
  FK-fails; the review/write history survives with the reviewer/applier anonymised. **Accepted trade-off
  (recorded per security review 2026-07-04):** after an admin account is deleted, the ledger can no longer
  attribute *which specific admin* performed a given apply/review — GDPR-compliant by design, at the cost of
  named forensic attribution for deleted accounts.
