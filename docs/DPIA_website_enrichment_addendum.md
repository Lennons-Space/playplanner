# DPIA Addendum — Venue Website Enrichment

**Companion to:** `docs/DPIA.md` · **Feature spec:** `scripts/enrich/WEBSITE_ENRICHMENT_SPEC.md` (§16, §18)
**Status:** DRAFT — must be reviewed and **signed off before the first `--propose` run.**
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
- [ ] **Balancing test:** low impact — business contact details the venue chose to publish; no profiling, no
      automated decisions about individuals, no enrichment of *parent* accounts. Human-in-the-loop before any
      write. Record the completed LIA in the master DPIA and reference it here.
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
- [ ] Define and record the retention rule (spec §16/§18; enforce via a future cleanup job, **not** in migration 056):
      rejected proposals → delete after **90 days**; superseded → after **30 days**; applied → retained as the
      change **audit trail**.
- [ ] `venue_enrichment_runs` is append-only fetch audit; include it in the retention schedule.
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
- [ ] DPIA addendum reviewed against master `docs/DPIA.md`; LIA recorded.
- [ ] Migration 056 applied + verified (see `scripts/enrich/MIGRATION_056_APPLY_CHECKLIST.md` §9).
- [ ] Retention rule scheduled/owned (even if the cleanup job is built later).
- [ ] **Data-protection owner sign-off:** name __________  date __________
- [ ] Only then run the gated tiny pilot (§10 of the migration checklist).
