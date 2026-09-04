# Retention Schedule — PlayPlanner

**Status:** **OWNER-APPROVED POLICY RECORDED, 2026-09-04 (Retention + Article 14 Owner Sign-Off Recording
Pass).** The periods and rules in this document reflect Liam's actual decisions as **controller policy —
necessity/storage-limitation choices, not statutory UK GDPR periods.** `OWNER APPROVED — NOT YET DEPLOYED`
means exactly that: approved as policy, **not implemented in production**. Nothing has been enforced,
scheduled, migrated, or granted. Two items remain explicitly provisional pending a further scoping pass —
marked `OWNER APPROVED IN PRINCIPLE — ENGINEERING SCOPING REQUIRED` — and one store (`pass_interest`) is
explicitly **not** approved a period at all, pending a purpose audit. See §1 for the store-by-store status.
**Date:** 2026-09-04 · Retention + Article 14 Owner Sign-Off Recording Pass (this pass) recording decisions
made on top of the 2026-09-04 Retention + Article 14 Enrichment Sign-Off Preparation Pass (prior pass).
**Built from:** direct inspection of `supabase/migrations/*.sql` (live schema), `supabase/migrations_drafts/*.sql`
(unapplied), `docs/privacy/ROPA.md`, `docs/DPIA.md`, `docs/DPIA_website_enrichment_addendum.md`,
`docs/LIA_venue_enrichment.md`, and the current privacy notices. No production database was queried —
row counts and "how much data actually exists" questions are marked `UNKNOWN — REQUIRES PRODUCTION QUERY`
where relevant, not guessed.
**Companion document:** `docs/privacy/ARTICLE_14_VENUE_DATA_NOTICE.md` (Article 14 notice content and
delivery-strategy options — kept separate because a retention period and a transparency obligation are
different questions, even for the same data).

---

## 0. Legal baseline — what is actually LAW here, and what is not

| Label | Meaning in this document |
|---|---|
| `LAW` | Primary legislation or directly-effective retained EU law, as currently in force in the UK |
| `ICO GUIDANCE` | The regulator's published interpretation — persuasive, must be "had regard to," not itself a statute |
| `OWNER POLICY DECISION` | A choice only Liam can make within the law's boundaries — this document proposes, never decides |
| `LEGAL ADVICE RECOMMENDED` | A point where solicitor/DPO input is genuinely warranted before relying on the position taken here |
| `ENGINEERING FACT` | Verified directly from code/schema this session, not asserted from memory |

### 0.1 Storage limitation — `LAW`

UK GDPR Art.5(1)(e), quoted verbatim from `legislation.gov.uk` (fetched this session):

> "kept in a form which permits identification of data subjects for no longer than is necessary for the
> purposes for which the personal data are processed"

**There is no statutory period.** Article 5(1)(e) does not say "90 days" or "3 years" anywhere. A longer
retention is permitted only "for archiving purposes in the public interest, scientific or historical
research purposes or statistical purposes" (Art.5(1)(e), Art.89(1) safeguards) — none of which describes
any store in this document. **Every period proposed below is an `OWNER POLICY DECISION` dressed as a
number, not a legal requirement dressed as a number.** The law requires the controller to (a) not keep
identifiable data longer than necessary, (b) be able to justify the period against the purpose, (c) define
standard periods where possible, (d) periodically review, and (e) erase or anonymise when no longer needed.
This document exists to let PlayPlanner satisfy (b)–(d) — it does not manufacture (a) into a fixed number
the law never specified.

### 0.2 Article 14 timing and exceptions — `LAW`

UK GDPR Art.14, quoted verbatim from `legislation.gov.uk` (verified via two independent fetches, Citation
Correction pass, 2026-09-04 — current in-force text):

- **Timing (Art.14(3)):** "within a reasonable period after obtaining the personal data, but at the latest
  within one month" — or at first communication with the data subject if earlier, or "at the latest, when
  the personal data are first disclosed" to another recipient, if earlier.
- **Source (Art.14(2)(f)):** the controller must state "from which source the personal data originate, and
  if applicable, whether it came from publicly accessible sources."
- **Exceptions (Art.14(5)):** apply "to the extent that" one of several conditions is met, including —
  **Art.14(5)(e)** "providing the information is impossible or would involve a disproportionate effort" and
  **Art.14(5)(f)** the obligation "is likely to render impossible or seriously impair the achievement of the
  objectives of the processing." **These are the current, correct citations — used as the primary reference
  throughout this document and its companion, `ARTICLE_14_VENUE_DATA_NOTICE.md`.**
- **Art.14(6), disproportionate-effort factors — NEW, statutory (not merely guidance):** "For the purposes
  of paragraph 5(e), whether providing the information would involve a disproportionate effort depends on,
  among other things, **the number of data subjects, the age of the personal data and any appropriate
  safeguards applied to the processing.**"
- **Art.14(7), required safeguards — NEW, statutory:** "A controller relying on paragraph 5(e) or (f) must
  take appropriate measures to protect the data subject's rights, freedoms and legitimate interests,
  **including by making the information available publicly.**"

**Authoritative basis for (5)(e)/(f)/(6)/(7):** **Data (Use and Access) Act 2025, section 77**, which
amended Art.14(5) (substituting "do not apply to the extent that" for the prior "shall not apply where and
insofar as," and inserting the (e)/(f) exceptions) and inserted new paragraphs (6) and (7). **Commenced 5
February 2026**, per **S.I. 2026/82, regulation 2(i)**.

**⚠️ Numbering history, corrected again this pass — do not retain an obsolete primary citation.** An earlier
pass's `RETENTION_SCHEDULE.md` used Art.14(5)(e) as the current citation but preserved a companion document's
owner-decision heading verbatim as **"Art.14(5)(b)"** with a resolving footnote. **That was itself an
error this pass corrects**: `docs/DPIA_website_enrichment_addendum.md` §9 and `docs/LIA_venue_enrichment.md`
both still cite the disproportionate-effort exception as **former Art.14(5)(b)** — mentioned here only to
explain the legislative history, not as a live citation. Both are historical DPIA/LIA artefacts, not live
notices, so they are not edited this pass; any live document (this one, and `ARTICLE_14_VENUE_DATA_NOTICE.md`)
must cite **Art.14(5)(e)** as the operative reference, full stop, with no footnoted alternative kept as if
it were still current.

### 0.3 What is now LAW, not just guidance — `LAW`, superseding the prior `ICO GUIDANCE` framing

**Corrected this pass.** The prior version of this section attributed the disproportionate-effort
proportionality-balance factors (number of data subjects, age/nature of the data, safeguards) to `ICO
GUIDANCE` alone. **That is no longer the full picture: Art.14(6) now states the number-of-subjects/age/
safeguards factors as statute**, and **Art.14(7) now imposes a statutory duty** to take appropriate
protective measures, expressly including public availability of the information, when relying on (5)(e) or
(f). ICO guidance still adds interpretive detail beyond the bare statutory text (e.g. the general expectation
that a DPIA is carried out and a documented proportionality balance exists) — that residual guidance-level
content is `ICO GUIDANCE`, not `LAW`, and is treated as such throughout. But **the core factors themselves
are now `LAW`, not merely persuasive guidance** — which is exactly why §2 of `ARTICLE_14_VENUE_DATA_NOTICE.md`
lists them as statutory preconditions for any future reliance, not as best-practice recommendations.

---

## 0.4 Owner sign-off record — 2026-09-04

**Every period below is a `PlayPlanner controller policy decision`, made under the necessity/storage-limitation
duty in Art.5(1)(e) (§0.1) — none is a statutory period, and this document must never be read to imply
one is.** Liam approved the specific rules recorded in §1–§5 on 2026-09-04. Deployment status is tracked
separately from approval status throughout — **an approved period that is not yet enforced in production
is `OWNER APPROVED — NOT YET DEPLOYED`, never `DEPLOYED`.**

---

## 1. Retention decision register

**Columns:** Table/system · Personal data? · Data subjects · Purpose · Lawful basis · Clock starts · Proposed
period · Action at expiry · Purge capability exists? · Deployed/scheduled? · Owner sign-off.

**Sign-off legend used from here on:** ✅ `OWNER APPROVED — NOT YET DEPLOYED` · 🟡 `OWNER APPROVED IN
PRINCIPLE — ENGINEERING SCOPING REQUIRED` · 🔴 `NOT APPROVED — PURPOSE AUDIT REQUIRED FIRST` · ✅ `Already
live/approved` (pre-existing, unaffected by this pass).

### 1.1 Core account data

| Store | Personal data? | Data subjects | Purpose | Lawful basis | Clock starts | Owner-approved period | Action at expiry | Purge exists? | Deployed? | Sign-off |
|---|---|---|---|---|---|---|---|---|---|---|
| `auth.users` / `profiles` | Yes | Account holders | Authentication, identity | Contract | N/A | **Until account deletion** — no time-based expiry | User-initiated: DELETE (hard) | N/A — deletion is user-triggered, not age-triggered | Live (`delete_own_account()`) | ✅ Already live/approved |
| `location_consent_log` — **current/active record** (append-only table, verified: `services/consent/locationConsent.ts` INSERTs a new row per grant/denial and UPDATEs `consent_withdrawn_at` on the most recent open row — there is a genuine "current record" concept per user, not a flat list of interchangeable rows) | Yes, while account exists | Account holders | Art.7 consent evidence | Legitimate Interests (accountability) | N/A — this is a state, not an age | **Keep for as long as it remains the current/active consent state** — never purged merely for being old. **⚠️ The existing `purge_expired_location_consent_log(days)` function, as built, does NOT implement this** — it deletes purely by `created_at` age with no "is this the current row for this user" check, so it would incorrectly delete a still-current consent given >3 years ago. **This is a required engineering change, not just a scheduling decision — see §11.** | No action while current | ❌ Existing function is the wrong shape for this rule | N/A | 🟡 **OWNER APPROVED IN PRINCIPLE — ENGINEERING SCOPING REQUIRED** |
| `location_consent_log` — **superseded record** (a prior row for a user who has since granted/withdrawn again, i.e. no longer the current state) | Yes, until the account link is removed | Account holders | As above, historical | As above | Point of supersession (when the newer row was created) OR account-deletion event, whichever triggers first | **3 years from supersession**, with the account link removed at whichever of (a) supersession or (b) account deletion happens first — per §3.1, applying the SET NULL fix as part of this same decision | DELETE at 3 years post-supersession | ❌ Needs a rewritten function (see §11) — the existing one has no supersession concept at all | ❌ Not deployed | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `gdpr_audit_log` | Yes, until account link removed (already `SET NULL` live) | Account holders | Art.5(2) accountability | Legal Obligation/LI | `created_at` (each row is a standalone event — no "current state" concept, unlike consent log) | **3 years after the relevant event/closure**, **unless a complaint, data-subject-rights matter, regulatory investigation, or legal dispute creates a documented retention hold** on the specific row(s) concerned | DELETE, except rows under an active hold | ✅ `purge_expired_gdpr_audit_log(days DEFAULT 1095)` — **but has no hold-checking logic at all**; needs extending, see §11 | ❌ Built, un-granted | ✅ **OWNER APPROVED — NOT YET DEPLOYED** (hold mechanism itself is 🟡, see §11) |
| Session/auth tokens (SecureStore, device-side) | Yes | Account holders | Stay signed in | Contract | N/A | Until sign-out or expiry | Removed from device on sign-out (verified: `purgeLocalAuthSession()` runs unconditionally) | N/A — device-local | Already live | ✅ Already live |

### 1.2 User-generated content

| Store | Personal data? | Data subjects | Purpose | Lawful basis | Clock starts | Owner-approved period | Action at expiry | Purge exists? | Deployed? | Sign-off |
|---|---|---|---|---|---|---|---|---|---|---|
| `reviews` | Yes (author + incidental third parties in free text) | Review authors | Community feedback | Contract/LI + Consent (`children_ages`) | N/A | **No time-based expiry** — unchanged, not addressed by this owner decision set | Account deletion: DELETE (cascade, verified — not anonymised) | N/A | Already live | ✅ Already live |
| Pending `venue_photos` | Yes (uploader) | Uploaders | Moderation queue | Contract/LI | `created_at` | **Maximum ordinary unresolved window: 90 days.** A photo still `pending` at 90 days must be actioned (moderated or escalated for review) — it is not left indefinitely | Reviewed/actioned at 90 days — exact mechanism (auto-flag vs. auto-reject) is an engineering decision, not decided here | ❌ **Missing engineering task** — no age-based check exists today; current behaviour is deletion only on account deletion or an explicit moderation decision, never on staleness | ❌ Not deployed | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| Rejected `venue_photos` | Yes (uploader) | Uploaders | Moderation queue (post-decision) | Contract/LI | Moderation-rejection timestamp | **Delete file/data 30 days after rejection**, unless an active moderation dispute requires a temporary hold | DELETE (file + row) at 30 days post-rejection | ⚠️ **`UNKNOWN — ENGINEERING VERIFICATION REQUIRED`**: this session could not confirm from the repo whether an ordinary (non-account-deletion) moderation rejection already deletes the row/file immediately or leaves it sitting at `status='rejected'` indefinitely — the account-deletion path is confirmed (deletes pending/rejected on deletion), but the *ordinary* rejection path's current behaviour independent of account deletion was not verified this pass | ❌ Not deployed | ✅ **OWNER APPROVED — NOT YET DEPLOYED**, engineering must first confirm current behaviour before building the 30-day rule |
| Approved `venue_photos` after account deletion | No (anonymised) | N/A post-anonymisation | Public venue content | Contract/LI (original), now anonymous | Account deletion event | **Indefinite, anonymised** — unchanged, already the erasure-equivalent state | `uploaded_by`/`moderated_by` → NULL (already live) | N/A | Already live | ✅ Already live |
| `favourites` | Yes | Account holders | Saved venues | Contract | N/A | Until user removes or account deleted — unchanged | DELETE (cascade) | N/A | Already live | ✅ Already live |
| `venue_facility_votes` | Yes | Voting users | Crowdsourced amenity data | LI | N/A | Until account deleted — unchanged | DELETE (cascade) | N/A | Already live | ✅ Already live |
| Venue submissions (`venues.submitted_by`) | Yes (attribution only) | Submitting users | Directory growth | LI | Account deletion event | Attribution anonymised; venue data itself unchanged | `submitted_by` → NULL (already live); venue row survives | N/A | Already live | ✅ Already live |
| Venue claims (`venue_claims`) — **resolved/rejected claim evidence** | Yes | Claiming users (may be sole traders) | Ownership verification record | Contract | `reviewed_at` / final resolution | **24 months after final resolution** — explicitly **provisional owner policy**; verification data (see verified-phone row below) should be minimised earlier wherever its purpose has already ended, rather than waiting the full 24 months by default | DELETE or minimise, pending the scoping pass below | ❌ **Missing engineering task** | ❌ Not deployed | 🟡 **OWNER APPROVED IN PRINCIPLE — ENGINEERING SCOPING REQUIRED**, per Liam's own instruction: "a targeted engineering/data-purpose pass is still required before this rule is implemented" |
| Verified-phone metadata (`venue_claims.verified_phone` legacy plaintext + draft minimised columns) | Yes — directly identifying (a phone number) | Claiming users | Fraud/repeat-claim detection only | Contract (verification) / LI (fraud detection) | `phone_verified_at` | **The full plaintext `verified_phone` value must not be retained as long-term verification evidence.** Owner-confirmed direction: once verification succeeds, only the minimised representation (`phone_last4`, `phone_verification_hmac`, `phone_verified_at`, `phone_verification_method`) should serve as ongoing evidence — the recoverable plaintext has no long-term purpose beyond the verification moment itself | Backfill minimised columns → verify → DROP `verified_phone`/`verified_phone_token` (destructive, deliberately a separate future migration) | ⚠️ Backfill script designed, not built as a callable function; DROP not executed | ❌ Draft only | 🟡 **OWNER APPROVED IN PRINCIPLE — ENGINEERING SCOPING REQUIRED** — a minimisation project, not a routine purge; scoped together with the `venue_claims` row above |

### 1.3 Moderation and support

| Store | Personal data? | Data subjects | Purpose | Lawful basis | Clock starts | Owner-approved period | Action at expiry | Purge exists? | Deployed? | Sign-off |
|---|---|---|---|---|---|---|---|---|---|---|
| `venue_reports` (moderation) | Yes (reporter; incidental in free text) | Reporters | Abuse handling | LI | N/A | No fixed expiry — unchanged, moderation history has ongoing accountability value | `reported_by` → NULL on account deletion (live); redaction trigger also nulls free-text `notes` | N/A for the report row itself | Already live | ✅ Already live |
| `pass_interest` (waitlist) | Yes (email) | Anyone who submits, even unauthenticated | Future-product interest capture | Consent (weak — see ROPA's INSERT-policy finding) | `created_at` | **No period approved this pass.** The prior 90-day proposal is **withdrawn as a proposal, not adopted** — Liam's instruction is explicit: this table's actual purpose has never been proven, and a retention period should not be assigned until a purpose audit happens first. Also relevant, unresolved: the RLS `INSERT ... WITH CHECK (true)` finding (`ROPA.md` §13) means this table's *lawfulness*, not just its retention, is an open question | Not proposed | ❌ No purge function exists | N/A | 🔴 **NOT APPROVED — PURPOSE AUDIT REQUIRED FIRST** (see §9 report item) |

### 1.4 Business/payment

**Not addressed by the owner's 2026-09-04 decision set — unchanged from the preparation pass.**

| Store | Personal data? | Data subjects | Purpose | Lawful basis | Clock starts | Proposed period | Action at expiry | Purge exists? | Deployed? | Sign-off |
|---|---|---|---|---|---|---|---|---|---|---|
| `business_subscriptions` / `profiles.stripe_customer_id` | Yes | Business subscribers | Paid features | Contract + Legal Obligation | Subscription end | **`UNKNOWN — MUST VERIFY`** against actual UK tax/bookkeeping retention obligations before proposing a number; provisionally ~7 years is the commonly-cited figure for financial records under UK tax law, but this is `LEGAL ADVICE RECOMMENDED`, not confirmed here | Not proposed — genuinely needs an accountant/solicitor answer, not an engineering guess | ❌ None | N/A | 🔴 STILL OPEN — no owner decision requested or given on this row this pass |

### 1.5 Enrichment (all currently BLOCKED for real data — see §13)

| Store | Personal data? | Data subjects | Purpose | Lawful basis | Clock starts | Owner-approved period | Action at expiry | Purge exists? | Deployed? | Sign-off |
|---|---|---|---|---|---|---|---|---|---|---|
| `venue_enrichment_runs` | No (process metadata about a venue, not a person) | N/A | Run bookkeeping | N/A | `created_at` | 12 months where all child proposals are terminal — unchanged, not addressed explicitly by the owner but non-personal and low-risk | DELETE | ❌ Not built — explicitly deferred as narrower/lower-priority | N/A | 🟡 Low priority, non-personal, not formally revisited this pass |
| `venue_field_proposals` (rejected/superseded/report_only) | Possible — `proposed_value`/`current_value` can hold `phone`/`email` field values | Venue operators, some sole traders | Track proposed automated changes | LI (see LIA) | `decision_at`/`updated_at` | Rejected: **90 days.** Superseded/report-only: **30 days.** — owner-confirmed | DELETE (never touches `applied`/`pending`) | ✅ `purge_old_field_proposals(rejected_days, superseded_days)` | ❌ Un-granted | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `venue_field_proposals` (applied) | Possible, as above | As above | Record of what actually changed a live venue field | LI | `decision_at` | **Retain full decision/evidence detail for 24 months after final application. Then minimise/delete evidence and personal fields where no longer required. A minimal non-personal audit skeleton may survive where operationally justified.** — owner-confirmed, and note this now applies the SAME evidence-nulling shape to the *proposal* row as to the *write* row below, rather than the earlier "review trigger" framing this pass replaces | Evidence/personal fields NULL at 24 months; skeleton (what/when/mode/venue/field/status) survives | ❌ No function built yet that nulls *this* table's evidence fields (the existing function only handles `rejected`/`superseded`/`report_only` deletion — a new NULL-not-DELETE path is needed for `applied` rows specifically) | ❌ Not deployed | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `venue_enrichment_writes` (evidence columns) | Possible — `old_value`/`new_value`/`evidence_snapshot` | As above | Audit/rollback evidence for applied changes | LI | `applied_at` | **24 months, then null/remove copied evidence/personal content. Keep only minimum audit facts genuinely required.** — owner-confirmed, unchanged from the prior pass's proposal | NULL IDENTIFYING FIELDS (`evidence_snapshot`, `old_value`, `new_value`); skeleton (what/when/mode/venue/field) survives | ✅ `purge_old_enrichment_write_evidence(days)` | ❌ Un-granted | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `venue_discovery_candidates` (rejected/dismissed/duplicate) | Yes — `phone`/`website`/`address_line1` of a candidate place, which may be a sole trader | Candidate venue operators | Deduplication/discovery review record | LI | `reviewed_at` | **90 days, then null/delete personal contact information.** Owner explicit: do not retain personal contact data merely because the non-personal candidate provenance remains useful — the decision skeleton (status, resolved_mode, reviewer, reasons, seen_count) is the thing worth keeping, not the contact fields | NULL `phone`/`website`/`address_line1`; decision skeleton survives | ✅ `purge_old_discovery_candidate_contact_data(days)` | ❌ Un-granted | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `venue_discovery_candidates` (approved) | N/A once matched | N/A | Audit trail for a now-live venue | LI | N/A | **No expiry** — unchanged, this is the provenance record for a published venue | Never purged by any function (verified: the purge function explicitly excludes `approved`) | N/A | N/A | ✅ Deliberate exclusion, already correct |
| `venue_closure_signals` | Possible — `evidence_snippet` (≤512 chars, could quote text naming a person, e.g. an operator's own retirement announcement) | Venue operators | Evidence a closure may have occurred | LI | `detected_at`, criteria-linked to the venue's operating-status resolution | **Retain until resolved, plus 90 days. Then delete/null evidence and personal content.** — owner-confirmed, replacing the earlier flat-180-day proposal with the shorter, criteria-based figure this document had itself recommended | DELETE (or null the `evidence_snippet` specifically, if the row otherwise has residual non-personal value — owner's wording allows either; treat as DELETE by default, consistent with the existing function's shape, unless engineering scoping finds a reason to null instead) | ✅ `purge_old_closure_signals(days)` — **but is a flat age-from-`detected_at` function, not a "resolved + 90d" criteria function** — needs the criteria-based variant, see §11 | ❌ Un-granted | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `venue_operating_status_events` — **Tier 1: non-personal skeleton** (`venue_id`, `from_status`, `to_status`, `mode`, `created_at`, `discovery_approved_before/after`) | ⚠️ **Correction this pass: do not assume this is anonymous.** Per Liam's explicit instruction, a skeleton is only "non-personal" where re-identification is genuinely not reasonably possible — for a venue that is itself a sole trader, `venue_id` (linkable to a public listing naming that person's business) plus a status-transition fact **can still indirectly identify and say something about that individual**, even with no name, no free text, and no actor. **Treat this tier as minimised/pseudonymised, not anonymous, for any venue in category C/D/E/F/G of `ARTICLE_14_VENUE_DATA_NOTICE.md` §6** | Deciding admins (indirectly, via the fact of a decision existing); venue operators (the status fact itself) | Append-only decision ledger, venue-history integrity | LI + accountability | N/A — a state/history record, not aged | **May be retained indefinitely where it is genuinely anonymous/non-personal** (i.e. the venue is not a sole-trader-identifying entity) **and is useful for venue-history integrity.** Where the venue IS a sole-trader-identifying entity, this tier remains personal data indefinitely under the current design and should be revisited alongside the Tier 2 removal below, not treated as automatically safe | No action while genuinely non-personal and useful; for sole-trader venues, review alongside Tier 2's 365-day point | ❌ No mechanism distinguishes "genuinely non-personal" venues from sole-trader ones at the retention layer — **this is a new, harder engineering/policy question this pass surfaces, not previously identified** | N/A | 🟡 **OWNER APPROVED IN PRINCIPLE for the genuinely-non-personal case — the sole-trader-venue case needs further scoping, flagged new this pass** |
| `venue_operating_status_events` — **Tier 2: personal layer** (`actor_id`, `evidence`, `reason`, `closure_signal_id`, `source`) | Yes — `actor_id` identifies the deciding admin; `evidence`/`reason` may contain operator-supplied personal facts | Deciding admins (identity); venue operators (incidentally, in free text) | As above | As above | `created_at` | **Maximum ordinary retention: 365 days. Then remove/minimise.** — owner-confirmed | `actor_id` → NULL; `reason`/`evidence` → NULL or `'{}'` at 365 days | ✅ `purge_expired_operating_status_events(days)`, floor-guarded at 365 — **but deletes the whole row, not just Tier 2** — needs rewriting to NULL Tier 2 while preserving Tier 1, see §11 | ❌ Un-granted | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |
| `venue_enrichment_suppressions` | Minimal — keyed by venue/field or source/source_id, NOT by the objecting individual's identity; `reason`/`notes` free text could incidentally name someone | Objecting/correcting individuals (indirectly, via venue/field) | Durable objection/correction record | Art.21 objection-honouring + LI (integrity of the enrichment pipeline) | N/A | **Retain while the relevant venue/source remains in scope, including indefinitely where necessary to honour an objection/correction and prevent re-collection. Minimise aggressively — prefer venue/source identifier, affected field, suppression state/reason code, and timestamp; avoid retaining copied phone, copied email, named person's details, or unnecessary free-text objection content. Review orphaned suppression records periodically.** — owner-confirmed, matching the prior pass's recommendation, with two additions: an explicit minimisation preference for a **coded reason** over free text, and a **periodic orphan-review process** (not a deletion rule — see below) | No deletion; periodic review only | N/A — already deliberately un-purged; the new "review orphaned records" action is a process task, not a database function | N/A | ✅ **OWNER APPROVED** (already-live design, no deployment needed for the core rule; the coded-reason preference and orphan-review process are new process items, see §11) |
| Local enrichment caches/reports (filesystem, not DB) | Possible — cached fetched pages could contain scraped personal data before extraction | N/A (transient) | Reduce redundant fetching; audit trail of a run | N/A | Cache/report write time | **Default: 30 days, unless a specific artefact has a documented shorter/longer operational requirement. No indefinite local evidence archives.** — owner-confirmed, generalising and simplifying the prior pass's split proposal (TTL-based page cache eviction at run start remains the mechanism for pages specifically, but the 30-day figure is now the explicit default for reports and any other local artefact absent a documented exception) | Deletion, filesystem-level | ❌ Not built — filesystem-side, not a database function | N/A | ✅ **OWNER APPROVED — NOT YET DEPLOYED** |

---

## 2. Reassessment of previously-proposed periods

> **✅ Superseded by owner decision, 2026-09-04.** Every row below was a *reassessment recommendation* from
> the preparation pass. Liam has now reviewed and approved specific figures for each (§1 above carries the
> final approved numbers, which match this section's recommendations in every case except that "applied
> proposals" now gets the same evidence-nulling shape as `venue_enrichment_writes` rather than a separate
> "review at 24 months" concept, and closure signals are explicitly "resolved + 90 days" rather than the
> more abstractly-worded "criteria-based ~90 days" this section proposed). **This section is retained as
> the reasoning record — read §1 for the current approved figures, this section for why.**

Every period below was proposed in an earlier pass (`DPIA_website_enrichment_addendum.md` §8.2). Re-evaluated
here against purpose, necessity, sensitivity, reversibility, audit need, rights impact, debugging need, and
the risk on both sides of getting the number wrong.

| Proposal | Verdict | Reasoning |
|---|---|---|
| Rejected field proposals: 90 days | **KEEP** | A rejected proposal has no ongoing purpose once the decision is made — it is not applied, so it has no audit-of-what-changed value. 90 days is enough for a moderator to revisit a recent rejection (e.g. "did we reject that too hastily?") without indefinitely holding a scraped phone/email that will never be used. Shortening below ~30 days risks losing legitimate short-term review value; lengthening past 90 has no offsetting benefit since `applied` rows already carry the actual audit trail. |
| Superseded/report-only: 30 days | **KEEP** | These are proposals that were overtaken by a newer proposal for the same field, or generated for reporting only. Even shorter-lived purpose than "rejected" — 30 days is proportionate. No reason to lengthen; a superseded row's information is, by definition, already captured in whichever proposal superseded it. |
| Applied proposals: retained, reviewed at 24 months | **REPLACE WITH CRITERIA-BASED RETENTION** | "Reviewed at 24 months" is not itself a retention action — nothing currently *does* anything at 24 months; it is a calendar reminder with no mechanism. Recommend: keep the row indefinitely (it is the actual record of what changed a live, published fact about a venue — deleting it would remove the only evidence a change was ever justified), but couple it to `venue_enrichment_writes`' own 24-month evidence-nulling (below) rather than inventing a second, redundant "review" concept for the same underlying fact. The proposal *row* survives as the skeleton; the *evidence* it's built on ages out via the writes-ledger rule. Simpler, same protection, one fewer moving part to get wrong. |
| Enrichment-write evidence: 24 months then minimise/null | **KEEP** | This is the right shape: keep the fact (what changed, when, which mode), null the raw evidence (old/new value, scraped snapshot) once it has served its rollback/audit purpose. 24 months covers a full operating cycle plus a reasonable dispute window; nothing about this data needs multi-year raw retention once no active dispute exists. |
| Rejected/duplicate candidate contact data: 90 days then null | **KEEP** | Same reasoning as rejected field proposals — the contact data (phone/website/address of a candidate that turned out to be a duplicate or was dismissed) has no purpose once the decision is final. 90 days for a "did we dismiss the right one?" review window is proportionate; nulling rather than deleting the whole row preserves the decision skeleton for pipeline-quality audits without keeping the personal data. |
| Closure signals: 180 days after resolution | **SHORTEN, with a criteria change** — see §4 for the full reasoning. Recommend **90 days after the venue's operating-status transition, floor-guarded, criteria-based (not purely calendar)** rather than a flat 180. A closure signal's evidentiary value is highest immediately around the decision it informed; 180 days of raw evidence retention (which can include a snippet quoting a real person's own words) is longer than the purpose plausibly requires once a human has already made and logged the actual decision in `venue_operating_status_events`. |
| Operating-status events: ≥365 days, "potentially longer if justified" | **REPLACE WITH CRITERIA-BASED RETENTION** — see §4. A flat "≥365 days, maybe longer" is not a policy, it is a placeholder. §4 proposes a concrete two-tier approach: keep the skeleton (status transition, timestamps, mode) indefinitely as a minimised audit trail, but remove the `actor_id`/human-identifying link and free-text `reason`/`evidence` content after a bounded period once the transition itself is no longer operationally live. |
| Location consent logs: target 3 years | **KEEP** — see §3 for the full defensibility analysis. |
| GDPR audit logs: target 3 years | **KEEP** — see §3 for the full defensibility analysis. |

---

## 3. Special review — accountability logs (`location_consent_log`, `gdpr_audit_log`)

> **✅ Owner decision, 2026-09-04, adding two mechanisms this section's original analysis did not have:**
> 1. **`location_consent_log` is append-only** (`ENGINEERING FACT`, confirmed this pass by reading
>    `services/consent/locationConsent.ts`: a new row is INSERTed on every grant/denial, and `UPDATE` only
>    ever sets `consent_withdrawn_at` on the most recent open row). This means a user can have several
>    historical rows, one of which is the **current** consent state. **Liam's instruction is explicit and
>    changes the mechanism, not just the number:** keep the current/latest record for as long as it remains
>    the active consent state, **regardless of its age** — do not delete a 4-year-old row just because it is
>    old, if it is still the user's current answer. Once a record is **superseded** (a newer grant/withdrawal
>    exists) or the **account relationship ends** (account deleted), the account link is removed where
>    appropriate and the now-historical record is kept as a **minimised accountability record for 3 years**
>    from the point of supersession/account-end, then deleted. **The existing `purge_expired_location_consent_log`
>    function does not implement this — see §11.**
> 2. **`gdpr_audit_log` gets an explicit hold exception**: 3 years after the relevant event/closure, **unless
>    a complaint, data-subject-rights matter, regulatory investigation, or legal dispute creates a documented
>    retention hold** on the specific row(s) concerned. No hold mechanism exists in the current purge function
>    — see §11.

**Is 3 years defensible?**

# `3 YEARS REASONABLE`

**Reasoning, evidence-based, not asserted:**
- **Proving consent (Art.7(1)):** the controller must be able to demonstrate consent was given. A dispute
  about historical consent realistically surfaces within the relationship's lifetime or shortly after — 3
  years comfortably covers the plausible window for "did I actually consent to this" to be raised, without
  manufacturing an indefinite audit trail for its own sake.
- **UK GDPR accountability (Art.5(2)):** no fixed period is specified by law; ICO guidance on record-keeping
  generally treats a multi-year window as reasonable for this kind of low-sensitivity, high-volume
  operational log, provided the controller has a stated, documented reason (which this section is).
- **Complaints/disputes:** the ICO's own complaint-handling window and the general civil limitation period
  for most UK claims (6 years for simple contract/tort, though data-protection-specific claims can run
  differently) both suggest 3 years is on the shorter, more conservative side rather than excessive — it is
  not being used to justify an unusually long retention.
- **Regulatory queries:** an ICO investigation into historical practice could plausibly look back further
  than 3 years in a serious case, but that is a low-probability, high-severity scenario better mitigated by
  *documenting the retention decision itself* (this section) than by keeping every consent log forever "just
  in case" — indefinite retention "just in case a regulator asks" is precisely the reasoning Art.5(1)(e)
  exists to prevent.
- **Do NOT treat 3 years as statutory** — as instructed, and as §0.1 establishes, it is an `OWNER POLICY
  DECISION` this document proposes, not a legal minimum or maximum.

**Verdict: 3 years is a defensible, proportionate, evidence-based choice — recommend keeping the existing
target rather than changing it.** The actual problem (§1.1, already flagged in `PRIVACY_NOTICE_GAP_ANALYSIS.md`
and the prior privacy-notice passes) is not the *period* but that **nothing currently enforces it** — the
purge functions exist, un-granted, and the public promise ("kept for 3 years... periodically reviewed for
deletion" as now honestly worded) is aspirational, not operative.

### 3.1 CASCADE vs. SET NULL on account deletion — which is preferable?

**Current production (`ENGINEERING FACT`, verified this session):** `location_consent_log.user_id` is
`ON DELETE CASCADE` — deleting an account **destroys** the consent history immediately, not just the link
to the account. `gdpr_audit_log.user_id` is `ON DELETE SET NULL` — the equivalent audit trail **survives**,
anonymised.

**Draft, unapplied:** `supabase/migrations_drafts/20260901121500_location_consent_log_anonymise_on_delete.sql`
changes `location_consent_log` to match `gdpr_audit_log`'s `SET NULL` pattern.

**Is the intended future anonymised-retention behaviour preferable? Yes, clearly.** Reasoning:
- **Accountability:** the whole stated purpose of this table is "proves consent was valid if the ICO ever
  asks" (the table's own header comment). CASCADE defeats that purpose at precisely the moment it might
  matter most — a dispute arising at or after account deletion is exactly when the evidence currently
  vanishes.
- **Minimisation is not compromised by the switch:** SET NULL does not retain *more* personal data than
  CASCADE — it retains the *same* non-identifying facts (a consent event happened, when, under which
  version) while removing the identifying link, which is the anonymisation-as-erasure pattern (GDPR
  recital 26) already used consistently elsewhere in this schema (`gdpr_audit_log`, approved photos, venue
  submission attribution). It is not "retaining more" — it is "retaining the same evidentiary value in a
  form that is no longer personal data about the deleted account," which is a *stronger* minimisation
  position than destroying a row that was created specifically to serve an accountability purpose.
- **Consistency:** two tables built for the identical purpose (accountability logging) currently behave
  inconsistently on account deletion for no documented reason — that inconsistency is itself a minor
  accountability gap (Art.5(2) requires being able to explain your own processing, and "we don't know why
  these two logs behave differently" is not an explanation).

**✅ Owner-approved, 2026-09-04: the draft CASCADE→SET NULL migration remains the preferred future design**,
confirmed explicitly by Liam. Deploy alongside the retention-period implementation, not separately — a
consent log that anonymises on deletion but never otherwise expires is not the target state either. **Not
deployed in this pass**, per instructions — remains `supabase/migrations_drafts/20260901121500_location_consent_log_anonymise_on_delete.sql`,
unapplied.

---

## 4. Special review — operating-status event ledger (`venue_operating_status_events`)

**Could entries contain sole-trader/personal information?** Yes, in two ways: (1) `actor_id` directly names
the admin who made a manual decision (personal data about PlayPlanner's own staff/admin, not the venue
operator); (2) `reason`/`evidence` (free text/jsonb) could reference facts an operator told PlayPlanner
directly (e.g. "operator confirmed by phone the business had closed"), which is personal data about the
venue operator, incidentally.

**How long is rollback/dispute evidence actually useful?** A closure/reactivation decision is operationally
live for as long as the venue's current status is being relied on by users browsing the app — realistically
weeks to a few months after the transition, not years. A dispute about *whether the decision was correct*
(an operator saying "you wrongly marked me closed") would surface quickly, since the operator would notice
their listing status changing near-immediately, not years later.

**Can actor identifiers be removed earlier than operational event facts?** Yes — this is the key design
insight this review adds. The *fact* that a transition happened (from-status, to-status, timestamp, mode)
has indefinite audit value as a minimised skeleton (it explains the venue's current state and how it got
there) without needing to keep *who* decided it or *why* in prose, once the decision is no longer
operationally contestable.

**Is an anonymised event skeleton sufficient after a period?** Owner-corrected, 2026-09-04: **only where it
genuinely is anonymous.** "Do not call a skeleton anonymous unless re-identification is genuinely not
reasonably possible" — Liam's own instruction, and it catches a real overstatement in this section's
original framing. `venue_id`, even stripped of `actor_id`/`reason`/`evidence`, can still indirectly identify
a natural person where the venue itself is a sole trader (the venue's public listing names them, and a
status-transition fact about "this venue" is then a status-transition fact about *that person's business*).
**The skeleton is anonymous, and safe to keep indefinitely without further thought, only for venues that are
not themselves personal-data-bearing entities** (limited companies, local-authority facilities, chains —
category A/H/most-of-B in `ARTICLE_14_VENUE_DATA_NOTICE.md` §6). For a sole-trader venue (category
C/D/E/F/G), the "skeleton" remains **minimised, not anonymous**, and the indefinite-retention default does
not apply without further scoping — see the table row in §1.5.

### Owner-approved concrete policy, 2026-09-04

**Two-tier, criteria-based, not purely age-based — confirmed by Liam with the anonymity correction above:**

1. **Tier 1 (retained where genuinely non-personal; minimised, not automatically indefinite, for sole-trader
   venues):** `venue_id`, `from_status`, `to_status`, `mode`, `created_at`, `discovery_approved_before/after`.
2. **Tier 2 (bounded, then removed): `actor_id`, `reason`, `evidence`, `closure_signal_id`, `source` — maximum
   ordinary retention 365 days, then remove/minimise** (`actor_id` → NULL, `reason`/`evidence` → NULL or
   `'{}'`), the floor the purge function already enforces, unless the venue has had a *further* status
   transition in that window (in which case the earlier event's Tier-2 fields age out on the same clock from
   its own `created_at`, not reset by the later event — no reason to extend retention of an *old* decision's
   reasoning just because a *newer* decision happened).

**This is NOT "fixed retention," NOT "indefinite audit log," and NOT purely age-based deletion of the whole
row** — it is the criteria-based approach the task asked to consider, applied as a split between the
non-personal skeleton (kept) and the personal reasoning/actor data (aged out). **Do not use "it's an audit
log" alone as a reason for indefinite retention of the personal fields** — the skeleton already carries the
accountability value that matters for the venue's own history; the personal fields carry the accountability
value that matters for *reviewing the admin's individual decision*, which has a naturally shorter useful
life.

**Engineering note:** the current `purge_expired_operating_status_events(days)` function **deletes the
whole row**, not a split NULL-then-skeleton operation. **This is a missing engineering task** — see §11 —
not something this pass builds.

---

## 5. Special review — suppression records (`venue_enrichment_suppressions`)

**The tension, as posed:** deleting a suppression too early risks the same objected-to data being
re-collected on the next crawl; but the suppression record itself could carry personal/source identifiers.

**Resolution, evidenced from the actual schema (`ENGINEERING FACT`):** this tension is largely already
resolved by the table's own design, not something a retention *period* needs to fix. The suppression is
keyed by **`venue_id`+`field`** or **`source`+`source_id`** — i.e. by *what is being suppressed*, not by
*who objected*. There is no column recording the objecting individual's name, phone, or email anywhere in
this table. The only personal data it holds is: (a) `created_by`/`removed_by` — the **acting admin's**
identity (PlayPlanner's own staff, an accountability record of who actioned the objection, not the
objector's personal data), and (b) free-text `reason`/`notes`, which *could* incidentally name the objecting
individual if an admin typed something like "Jane from the venue called to ask for this removed" — a
minimisation practice issue (document a house style: describe the objection by field/reason category, not
by transcribing the caller's name), not a retention-period issue.

**Owner-approved policy, 2026-09-04:**

- **`is_permanent = true` suppressions: remain indefinitely while the underlying venue/source identifier
  remains relevant** (i.e. while the venue still exists in the directory, or the source_id could still
  recur). Confirmed — the whole point is durability against re-creation, and the record itself carries
  minimal personal data by design (see above).
- **`is_permanent = false` (time-bound) suppressions: expire on their own `expires_at`**, already built into
  the schema — no new mechanism needed.
- **Minimisation preference, sharpened by Liam's instruction:** prefer a **coded reason** (e.g. a fixed
  `reason_code` enum — "operator objection", "correction requested", "phone removed at operator request" —
  rather than open free text) over `reason`/`notes` prose wherever the objection fits a standard category.
  Free text remains available for genuinely unusual cases, but the coded-reason path should be the default
  UI affordance an admin reaches for first — this reduces the personal-data risk in the free text at the
  point of creation, not just as after-the-fact guidance. **Avoid retaining copied phone, copied email, or a
  named person's details anywhere in this table** — none of the current columns are designed to hold them,
  and this must stay true of any future column added to this table.
- **New process item: periodically review orphaned suppression records** — a suppression whose `venue_id` no
  longer exists in the directory (venue permanently removed) or whose `source`/`source_id` has not recurred
  in a long period. This is a **review**, not a deletion rule: an orphaned suppression may still matter if
  the venue/source could plausibly reappear (re-discovery, a venue re-added later). The review's job is to
  confirm the suppression is still meaningful, not to age it out automatically — automatic expiry remains
  explicitly rejected, below.
- **Do not add an expiry to permanent suppressions.** Doing so would recreate exactly the risk the task
  warns about — a suppressed contact detail silently becoming re-collectable again after some arbitrary
  number of months, defeating the objection it exists to honour.

**Verdict:** the existing "no purge function touches this table, ever" design (confirmed by the R3/R4
remediation's own redline tests, `L1`/`L2`) is already the right answer for the *venue_id/field/source*
identity — it should stay unpurged. The only action item is the free-text minimisation practice above,
which is a process/training note, not an engineering or retention-schedule change.

---

## 11. Purge function mapping

> **Updated 2026-09-04 for owner-approved figures.** All seven functions live in the same unapplied draft,
> `supabase/migrations_drafts/059_enrichment_autonomy.sql`. **None has `EXECUTE` granted to any role. None
> is scheduled. Nothing below is being changed, migrated, or deployed by this pass.**

| Function | Table/data affected | Default period | Matches proposed policy? | Safe/idempotent? | Deletes or anonymises? | Minimum floor | Evidence/relationships survive appropriately? | Current `EXECUTE` state | Proposed future scheduling identity | Proposed cadence |
|---|---|---|---|---|---|---|---|---|---|---|
| `purge_expired_location_consent_log(days DEFAULT 1095)` | `location_consent_log` | 1095d (3y) | ✅ Yes — §3 keeps 3 years | Yes — age-bounded `DELETE`, re-running is a no-op on already-purged rows | Deletes (whole row) — **note:** this still deletes rather than anonymising; §3.1's SET NULL fix is a *separate* migration on the FK, not this function — once applied, an account-deleted user's row already has `user_id = NULL` and this function still correctly ages it out by `created_at` regardless | 365 days (hard-coded `IF ... < 365 THEN RAISE`) | N/A — no downstream FK depends on this table | REVOKED from all | A dedicated low-privilege `retention_purger` role, or a scoped `service_role` invocation from a signed, logged ops script — **not** a broad `service_role` grant | Daily or weekly `pg_cron` job, once `EXECUTE` is granted — cadence itself is an `OWNER POLICY DECISION`, not proposed as final here |
| `purge_expired_gdpr_audit_log(days DEFAULT 1095)` | `gdpr_audit_log` | 1095d (3y) | ✅ Yes — §3 | Yes, same shape as above | Deletes (whole row, already-`SET NULL`-anonymised rows included) | 365 days | N/A | REVOKED from all | Same as above | Same as above |
| `purge_old_field_proposals(rejected_days, superseded_days)` | `venue_field_proposals` (rejected/superseded/report_only only) | No default — both args required | ✅ Yes — §2 keeps 90d/30d | Yes | Deletes | 30d (rejected), 7d (superseded) | Never touches `applied`/`pending` — verified in the function body | REVOKED from all | Same role model as above | Weekly is proportionate — this table is lower-volume/lower-urgency than the two audit logs |
| `purge_old_enrichment_write_evidence(days)` | `venue_enrichment_writes` (evidence columns only) | No default | ✅ Yes — §2 keeps 24 months | Yes — the `WHERE evidence_snapshot IS NOT NULL` guard makes re-runs genuinely idempotent, not just harmless | **Anonymises** (NULLs `evidence_snapshot`/`old_value`/`new_value`), keeps skeleton | 365 days | Skeleton (what/when/mode/venue/field) survives by design | REVOKED from all | Same role model | Monthly is proportionate given the 24-month window |
| `purge_old_discovery_candidate_contact_data(days)` | `venue_discovery_candidates` (terminal non-approved rows) | No default | ✅ Yes — §2 keeps 90d | Yes, same NOT-NULL guard pattern as above | **Anonymises** (NULLs `phone`/`website`/`address_line1`), keeps decision skeleton | 30 days | `approved` rows explicitly and permanently excluded — verified | REVOKED from all | Same role model | Weekly |
| `purge_old_closure_signals(days)` | `venue_closure_signals` | No default | 🟡 **Partial** — **owner-approved policy is "resolved + 90 days" (§1.5)**; the function itself only supports a flat age cutoff from `detected_at`, not a "status settled" criterion | Yes | Deletes | 30 days | N/A | REVOKED from all | Same role model | **Needs a function change (task B/2), not just a scheduling decision** |
| `purge_expired_operating_status_events(days)` | `venue_operating_status_events` | No default | ❌ **Does not match §4's owner-approved two-tier policy** — the function deletes the whole row past the floor; owner-approved policy NULLs `actor_id`/`reason`/`evidence`/`source` (Tier 2) at 365 days while keeping the Tier-1 skeleton, itself only "indefinite" where genuinely non-personal | Yes, for what it does today | **Deletes** (whole row) — owner-approved policy wants **anonymise/minimise**, not delete | 365 days (hard floor) | The append-only trigger's GUC-gated exemption is scoped correctly to this one function | REVOKED from all | Same role model, but **not usable as-is** | **Needs a function rewrite before scheduling (task A/1)** |

### Missing retention engineering — exact tasks, owner-approved figures now attached

**Lettered (A–H) to match Liam's own "Retention Engineering Plan" request; cross-referenced to the detailed
numbered items that carry the full reasoning.**

**A. Operating-status events — rewrite from row-DELETE to Tier-2-NULL-plus-Tier-1-skeleton** *(= item 1
below)*. Matches §4's owner-approved two-tier policy, **with the added sole-trader-venue nuance**: the
rewrite must be able to distinguish a genuinely non-personal venue (Tier 1 safe to keep indefinitely) from a
sole-trader-identifying venue (Tier 1 itself remains minimised personal data, not automatically indefinite)
— this classification does not exist anywhere in the schema today and is itself a new, harder sub-task, not
just "add a NULL path." The append-only trigger's GUC exemption currently only ever performs a `DELETE`; a
guarded `UPDATE` path needs to be added deliberately (currently "`UPDATE` is never exempted, under any
setting" is an intentional integrity guarantee — changing it is a reviewable schema change).

**B. Closure signals — criteria-based purge at resolved + 90 days** *(= item 2 below)*. Owner-approved
figure locks this in: "N days after the venue's operating-status last resolved," not a flat
age-from-`detected_at`. The existing flat-age function can remain as a fallback for signals that never led
to a status change at all.

**C. `venue_claims` — purge/minimisation capability** *(= item 3 below)*. No function exists at all today.
Needs building on the same `SECURITY DEFINER`/floor-guarded/revoked pattern as the other seven, but **is
provisional** (§1.2) pending the scoping pass in D below — do not build C's period logic (24 months) as
final until D resolves what "minimise earlier wherever the purpose ends" concretely means for this table.

**D. Verified-phone backfill/minimisation/drop sequence** *(= item 4 below)*. One-off project, not a
recurring purge function — backfill `phone_last4`/`phone_verification_hmac` from the legacy plaintext,
verify a sample, then drop `verified_phone`/`verified_phone_token` in a separate, later, deliberately
destructive migration. This is the scoping pass C is waiting on.

**E. Pending-photo 90-day / rejected-photo 30-day cleanup** *(= item 5 below, revised figures)*. Two
distinct rules now, not one: pending photos need an action-forcing check at 90 days (not indefinite
staleness); rejected photos need a 30-day post-rejection deletion, **but engineering must first confirm
whether ordinary (non-account-deletion) rejection already deletes the row today** — this session could not
verify that specific path and it is a precondition for scoping E correctly, not an assumption to build on.

**F. `pass_interest` — purpose/retention audit BEFORE any retention period is assigned** *(= item 6 below,
materially changed)*. **Do not build a purge function for this table yet.** The prior pass's 90-day proposal
is withdrawn as a proposal — Liam's instruction is to establish the table's actual purpose first (and
separately, per `ROPA.md` §13, its `WITH CHECK (true)` insert policy is a live lawfulness question, not just
a retention one). This is the one item in this whole plan that is genuinely blocked on a decision *before*
engineering, not blocked on engineering before a decision.

**G. Local cache/report 30-day eviction** *(= item 7 below)*. Filesystem-level, not a database migration —
TTL-based page/robots cache eviction at run start, 30-day default deletion for report files and any other
local artefact absent a documented exception.

**H. Consent/audit-log purge semantics that preserve a current relevant consent record** *(= new this pass,
§3's mechanism)*. **`purge_expired_location_consent_log` needs a rewrite, not just a scheduling decision**:
it must exclude, per `user_id`, whichever row is currently the active/most-recent consent state (the
highest `created_at` for that user, or more precisely the most recent row with `consent_withdrawn_at IS
NULL` if one exists, else the most recent row overall) regardless of that row's own age, and apply the
3-year clock only to rows that have been *superseded* — measured from the supersession event, not from
their own original `created_at`. **`purge_expired_gdpr_audit_log` needs a hold-check added**: a row under an
active complaint/rights-request/investigation/dispute hold must not be purged even past 3 years, and no
"hold" flag or table exists anywhere in the schema today to record one — this is a new column/table design
question, not a one-line change to the existing function.

---

Full numbered detail (referenced by letter above):

1. **`venue_operating_status_events`: rewrite the purge function from row-DELETE to column-NULL-plus-skeleton**
   — see A above for the sole-trader-venue nuance this pass adds.
2. **`venue_closure_signals`: add a criteria-based variant** — see B above; owner-approved figure is now
   "resolved + 90 days," locking in the number this task builds against.
3. **`venue_claims`: no purge/anonymisation function exists at all** — see C above; provisional pending D.
4. **`venue_claims.verified_phone` legacy plaintext: needs a one-off backfill-then-drop project** — see D
   above.
5. **Pending/rejected `venue_photos`: two distinct rules, not one** — see E above; the rejected-photo rule
   specifically needs a current-behaviour verification step before it can be scoped.
6. **`pass_interest`: ON HOLD pending purpose audit** — see F above; do not build this yet.
7. **Local enrichment caches/reports: filesystem-level eviction** — see G above.
8. **NEW — accountability-log purge semantics** — see H above; two distinct sub-tasks (current-record
   awareness for consent log; hold-mechanism for audit log), neither of which the existing functions do
   today.

---

## 12. Decisions recorded, 2026-09-04

**Liam has now decided every row below except where marked still-open.** This table replaces the prior
pass's "recommend, don't decide" framing — see §1 for the operative figures.

| Decision | Outcome | Legal-review need | Blocks synthetic staging? | Blocks real-data enrichment? | Blocks production launch? |
|---|---|---|---|---|---|
| Location consent log retention shape | **DECIDED** — current record kept while active; superseded/account-ended records minimised, 3 years, then deleted (§3) | Low | No | No | **Yes** — live notice promises this, unenforced |
| GDPR audit log retention period | **DECIDED** — 3 years after event/closure, subject to a documented hold exception (§3) | Low | No | No | **Yes**, same reason |
| Location-consent-log CASCADE → SET NULL fix | **DECIDED** — preferred future design, confirmed; deploy alongside retention implementation (§3.1) | Low | No | No | Recommended, not strictly blocking |
| `venue_field_proposals` (rejected/superseded), `venue_enrichment_writes`, `venue_discovery_candidates` periods | **DECIDED** — 90d/30d/24mo as recorded in §1.5 | Low | No | **Yes, indirectly** | No |
| `venue_closure_signals` period | **DECIDED** — resolved + 90 days (§1.5, §2) | Low | No | Yes, indirectly | No |
| `venue_operating_status_events` retention shape | **DECIDED IN PRINCIPLE, one open sub-question** — two-tier confirmed; the sole-trader-venue Tier-1-anonymity question (§4, §1.5) is new and unresolved | Low-medium | No | No | No, but resolve before closure/reactivation is relied on at scale |
| `venue_enrichment_suppressions` retention | **DECIDED** — no expiry for permanent suppressions; coded-reason preference + periodic orphan review added (§5) | Low | No | Yes, indirectly | No |
| `venue_claims` resolved-claim retention | **DECIDED IN PRINCIPLE, ENGINEERING SCOPING REQUIRED** — 24 months provisional, pending the verified-phone minimisation scoping pass (§1.2) | Low-medium | No | No | No |
| Verified-phone long-term evidence | **DECIDED** — full plaintext must not be retained as long-term verification evidence; minimised columns only (§1.2) | Low | No | No | No |
| Pending/rejected photo cleanup | **DECIDED**, engineering must first verify current rejection behaviour (§1.2) | Low | No | No | No |
| `pass_interest` retention | **NOT DECIDED — DELIBERATELY.** Purpose audit required first; no period assigned (§1.3) | Low, but see the separate `WITH CHECK (true)` lawfulness question | No | No | No |
| Business subscription retention (`business_subscriptions`) | **STILL OPEN** — not addressed this pass, needs accountant/solicitor input | **High** | No | No | No |
| Article 14 notice strategy | **DECIDED** — Individual notice + layered public transparency, approved (see `ARTICLE_14_VENUE_DATA_NOTICE.md` §6) | Still recommend solicitor/DPO input on the notice text itself | No | **Yes — precondition for real-data enrichment** | Only if enrichment is in launch scope |
| Disproportionate-effort exception (Art.14(5), current letter (e)) reliance | **DECIDED — NOT APPROVED for Release One** (see `ARTICLE_14_VENUE_DATA_NOTICE.md` §2) | **High** — required before any future reliance | No | No (closes an open question rather than blocking) | No |
| Sole-trader auto-publication policy | **DECIDED** — never auto-publish a named natural-person contact; quarantine likely-personal data (see `ARTICLE_14_VENUE_DATA_NOTICE.md` §3) | Medium | No | **Yes — release-one's actual operating rule** | No |
| Article 14 delivery mechanism | **DECIDED** — 4-layer architecture, see `ARTICLE_14_VENUE_DATA_NOTICE.md` §6 | High | No | Yes | No |

---

## 13. Synthetic staging boundary — reconfirmed

**Question:** can synthetic-only PostGIS staging proceed before the owner decisions above are made?

**Reasoning:** the retention/Article 14 questions in this document are entirely about **real venue/data-subject
enrichment data** — a real sole trader's real phone number, scraped from a real website, held in
`venue_field_proposals`/`venue_discovery_candidates`/etc. None of that exists, or would be created, by
synthetic data flowing through the same schema for testing purposes. **However**, per the instruction not to
claim "no personal data exists anywhere": a cloud-hosted staging environment still involves **ordinary
developer/account/operational metadata** — who has console access, Supabase's own operational logs, CI
service-account activity, and so on. That is genuine personal data processing (about PlayPlanner's own
developers/operators, governed by Supabase's terms as PlayPlanner's processor), but it is categorically
different from, and does not require resolving, the enrichment-specific retention/Article 14 questions this
document addresses.

# `SYNTHETIC ENRICHMENT STAGING STILL PERMISSIBLE`

**Distinguish:** "no real venue/data-subject enrichment data" (true, and the thing that actually matters for
this document's scope) from "no personal data exists anywhere" (false, and not being claimed). Synthetic
staging does not touch any of the retention periods, purge functions, or Article 14 questions above, because
none of the rows it creates describe a real natural person obtained from a source other than themselves.

**Real-data enrichment remains a separate question, unaffected by the staging verdict above:**

# `REAL-DATA ENRICHMENT REMAINS BLOCKED`

Not newly blocked by this pass — it was already blocked (per the standing enrichment-gate verdict). What
changed this pass: retention periods are now **owner-approved** (§1–§5, no longer merely proposed), and the
Article 14 notice strategy is now **decided** (companion document). What remains, as concrete preconditions,
not paperwork:

1. **Retention implementation for the processed stores** — §11's engineering backlog (A–H) is approved but
   unbuilt; none of the seven purge functions is granted or scheduled, and two (`venue_operating_status_events`,
   `location_consent_log`) need rewrites, not just scheduling, before they correctly implement the
   owner-approved policy.
2. **An Article 14 deadline/notice mechanism for likely-personal data, OR a release-one design that
   technically prevents retaining such data past a safe pre-notice window** — see
   `ARTICLE_14_VENUE_DATA_NOTICE.md` §4's engineering safety rule; neither exists today.
3. **Final privacy-notice/public venue-data transparency ready for activation** — the layered structure is
   decided (companion document §6) but not built or linked anywhere.
4. **Remaining legal review** — §12's still-`High`-marked rows (Article 14 notice text, sole-trader
   auto-publication policy, delivery mechanism) genuinely warrant solicitor/DPO input before real data flows,
   even though the *product* decisions themselves are now made.

**None of these four are resolved by this pass** — this pass records decisions and specifications; it does
not build, migrate, grant, schedule, or send anything.
