# Record of Processing Activities (ROPA) — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01 · **Legal basis for this document:** Article 30 UK GDPR (record of processing
activities). **Not a substitute for solicitor/DPO review.**
**Built from:** direct inspection of `supabase/migrations/*.sql` (live schema) and app code this session
— not carried forward from `docs/DPIA.md`'s 2026-06-08 table without re-verification. Where a fact could
not be verified this session, it is marked `UNKNOWN — MUST VERIFY`, not silently assumed.

---

## Controller identity and contact

| | |
|---|---|
| **Controller** | Liam Evanson, trading as PlayPlanner, United Kingdom (per `docs/terms.html:95`, `docs/privacy.html`) |
| **Contact** | `privacy@playplanner.app` (per live-fetched `docs/privacy.html`, confirmed reachable this session in an earlier pass) |
| **DPO** | Not appointed — see `DPO` assessment in the governance-pass final report. Operational data-protection accountability currently rests with the controller personally (sole developer). |
| **ICO registration number** | `UNKNOWN — MUST VERIFY` (not visible from the repo; check the ICO register directly) |

---

## Processing activities

Each row: purpose · data subjects · categories of data · source · lawful basis · special-category
possibility · storage · recipients · processor · international transfer · retention · rights.

### 1. Account authentication
- **Purpose:** create and authenticate user accounts
- **Data subjects:** all app users
- **Data categories:** email, hashed password (Supabase-managed), full name, `terms_accepted_at`
- **Source:** directly from the data subject at signup
- **Lawful basis:** Contract (Art.6(1)(b)) — account creation is necessary to provide the service
- **Special category/criminal data:** none
- **Storage:** `auth.users` (Supabase-managed) + `profiles` table
- **Recipients:** none beyond the controller
- **Processor:** Supabase (see `PROCESSOR_AND_VENDOR_REGISTER.md`)
- **International transfer:** see `INTERNATIONAL_TRANSFERS.md` — Supabase hosting region `UNKNOWN — MUST VERIFY` (no region string found in `supabase/config.toml`; `docs/DPIA.md`'s claim of "eu-west-2 Ireland, confirmed in app config" could **not** be independently re-verified from current repo config this session — treat as unconfirmed until checked directly in the Supabase dashboard)
- **Retention:** until account deletion (`delete_own_account()` RPC); no auto-expiry
- **DPIA reference:** `docs/DPIA.md` §1, §10
- **Privacy-notice reference:** `docs/privacy.html` (account section)
- **Automated processing:** none
- **Children's data:** no child account type exists (see `CHILDRENS_CODE_SCOPE_ASSESSMENT.md`)

### 2. Profile information
- **Purpose:** identity for venue claims, reviews, personalisation
- **Data subjects:** account holders
- **Data categories:** `username`, `full_name`, `avatar_url`, `bio`, `postcode` (approximate), `children_ages text[]` (coarse ranges, about the user's own children as third parties), `is_business_owner`, `subscription_tier`
- **Source:** directly from the data subject
- **Lawful basis:** Contract (core profile) + Consent (Art.6(1)(a), for `children_ages` specifically — user opts to provide it for personalisation)
- **Special category/criminal data:** `children_ages` is Art.9-adjacent (data concerning a child, held by the parent) — see the DPIA's existing position that ranges-only, non-identifying data mitigates but does not eliminate this
- **Storage:** `profiles` table (`001_initial_schema.sql:35-59`)
- **Recipients:** other users can see a restricted public subset via the `public_profiles` VIEW, which explicitly **excludes** `children_ages`, `is_admin`, `subscription_tier`, `marketing_consent`, `terms_accepted_at`, `postcode`, `stripe_customer_id` (`004_profile_privacy_columns.sql:45-56`)
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** until account deletion; anonymised, not deleted, for FKs held by *other* records (see rows below)
- **⚠️ Historical note for accountability:** production previously (before migration `065_restrict_profile_read_exposure.sql`) let any authenticated user read every column of every other user's profile, including `children_ages` and `stripe_customer_id`. Fixed and verified; recorded here because Art.30/accountability records should note material past exposure, not just current state.
- **Automated processing:** none affecting the data subject directly
- **Children's data:** yes — see above

### 3. Location + location consent
- **Purpose:** show nearby venues; record consent for Art.7 accountability
- **Data subjects:** app users (location coordinates); consent-log rows are about the same subjects
- **Data categories:** device-derived coordinates (session-only, never persisted); `location_consent_log`: `user_id`, `consented_at`, `consent_withdrawn_at`, `consent_version`, `ip_hash`
- **Source:** directly from the data subject's device
- **Lawful basis:** Consent (Art.6(1)(a)) for location use itself; the consent-log entries are Legitimate Interests (Art.6(1)(f), accountability) for the log's own existence
- **Special category/criminal data:** none
- **Storage:** coordinates — in-memory/session only, never written to a database; consent decisions — `location_consent_log` (`001_initial_schema.sql:764-772`)
- **Recipients:** none
- **Processor:** Supabase (for the consent log only — coordinates never reach any processor's storage)
- **International transfer:** as row 1, for the consent-log rows only
- **Retention:** consent-log rows — **no retention mechanism currently implemented** in code (a `purge_expired_location_consent_log` function was built during the enrichment remediation pass but is deliberately un-granted pending sign-off — see the enrichment DPIA addendum §8.3); the in-app privacy notice's wording was corrected 2026-09-01 to stop asserting automatic deletion that doesn't yet run (see `PERSONAL_DATA_BREACH_RESPONSE.md`-adjacent honesty principle applied here — was previously "kept for 3 years then deleted automatically," now describes this as a target with in-progress automation)
- **⚠️ Finding this session (2026-08-31 governance pass):** `location_consent_log.ip_hash` is a live column that **is never actually written by any code path** (confirmed by repo-wide search) — the schema anticipated recording a hashed IP for the consent-log but this was never implemented. Not a risk in itself (less data collected than the schema allows for), but the column should either be populated as designed or dropped — leaving an unused column implies a control that isn't there. **Not fixed this pass.**
- **🔴 SEPARATE, MORE SERIOUS FINDING (2026-09-01, Privacy-Critical Engineering Remediation Pass):**
  `location_consent_log.user_id` (`001_initial_schema.sql:766`) was found to be **`ON DELETE CASCADE`**,
  not `SET NULL` like the otherwise-equivalent `gdpr_audit_log.user_id`. This meant `delete_own_account()`
  **permanently destroyed** a user's entire consent-log history immediately on account deletion — directly
  defeating the table's own stated purpose ("proves consent was valid if the ICO ever asks") at exactly
  the moment it might matter most, and making the "3 years" retention promise doubly untrue (the record
  could vanish on day one, not just lack a 3-year cutoff). **✅ FIXED this pass**: a new draft migration
  (`supabase/migrations_drafts/20260901121500_location_consent_log_anonymise_on_delete.sql`, UNAPPLIED)
  changes the FK to `SET NULL`, matching `gdpr_audit_log`. Proven with a pglite test that first reproduces
  the original CASCADE-destroys-the-row defect, then proves the fix (`supabase/tests/20260901_privacy_engineering_remediation.mjs`, 6/6 green). **Still unapplied to production** — this is a draft, like everything else in `migrations_drafts/`.
- **DPIA reference:** `docs/DPIA.md` §7, and `docs/DPIA_website_enrichment_addendum.md` §8.3 for the purge-function status
- **Automated processing:** none
- **Children's data:** possible if the account holder is a child (see Children's Code assessment) — no different handling exists for that case today

### 4. Favourites / saved venues
- **Purpose:** let users save venues for later
- **Data subjects:** account holders
- **Data categories:** `user_id`, `venue_id`, `list_name`
- **Source:** directly from the data subject
- **Lawful basis:** Contract (core account feature)
- **Special category:** none
- **Storage:** `favourites` table, fully RLS-private to the owner
- **Recipients:** none
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** until user deletes the favourite or the account; no separate expiry
- **Automated processing:** none · **Children's data:** no

### 5. Recent/local search history
- **Purpose:** convenience — recently viewed venues
- **Data subjects:** app users
- **Data categories:** venue id/name/photo/category/rating (about the **venue**, not the user) — capped at 10 entries
- **Source:** derived from the user's own browsing
- **Lawful basis:** not applicable — **this is device-local only** (`AsyncStorage`, key `playplanner.recentlyViewed.v1`), confirmed by an explicit code comment ("LOCAL ONLY... No backend, no Supabase table, no analytics, no network," `lib/recentlyViewed.ts:1-25`). No server-side processing occurs, so this is outside Article 30's scope as a controller processing activity — recorded here for completeness only.
- **Retention:** device-local, capped at 10 entries, cleared with app data/uninstall

### 6. Reviews
- **Purpose:** community feedback on venues
- **Data subjects:** review authors (and incidentally, anyone named in free-text review content)
- **Data categories:** `rating`, `title`, `body` (free text — may contain personal data the author chooses to include), `visit_date`, `children_ages text[]`, `is_anonymous`, `tags` (fixed-list, no free text)
- **Source:** directly from the data subject
- **Lawful basis:** Contract/Legitimate Interests (Art.6(1)(f) — community value of reviews) for the review itself; Consent for `children_ages`
- **Special category:** `children_ages` as row 2; free-text `body` could incidentally contain special-category data about a third party if a reviewer chooses to write it — no technical control against this beyond moderation
- **Storage:** `reviews` table
- **Recipients:** public, if `is_anonymous=false` and `show_reviews_publicly=true` and moderation-approved; moderators always see the true author regardless of anonymity (documented project decision — lawful purpose)
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** indefinite while the account exists; on account deletion, reviews are **deleted** (not anonymised — `reviews.user_id` has `ON DELETE CASCADE`), while `moderated_by` (the admin's own attribution) is separately anonymised via `SET NULL`
- **Automated processing:** none · **Children's data:** yes (age ranges, as row 2)

### 7. Review votes / helpfulness / flags / facility votes
- **Purpose:** crowd-sourced signal on review usefulness and venue facilities; abuse reporting
- **Data subjects:** voting/reporting users
- **Data categories:** `review_helpful` (review_id, user_id only); `review_flags` (reason, free-text notes, `reported_by`); `venue_facility_votes` (venue_id, user_id, facility_slug fixed-enum, boolean)
- **Source:** directly from the data subject
- **Lawful basis:** Legitimate Interests (Art.6(1)(f) — content quality/moderation)
- **Special category:** none, except free-text `review_flags.reason`/`notes` could incidentally contain sensitive content about a third party (a dedicated redaction trigger nulls this on the reporter's account deletion — see below)
- **Storage:** respective tables; public aggregate is `venue_facility_stats` (counts only, explicitly documented as containing "nothing that could single out who voted")
- **Recipients:** aggregate facility stats are public; individual votes/flags are not
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** `venue_facility_votes.user_id` cascades on account deletion (explicit GDPR Art.17 comment in the migration); `review_flags.reported_by` is `ON DELETE SET NULL` from creation, **and** a dedicated trigger (`redact_venue_report_notes_on_profile_delete`) additionally NULLs the free-text `notes` field on the reporter's account deletion — a deliberate defence against personal data lingering in free text after the FK is already severed
- **Automated processing:** none · **Children's data:** no

### 8. Photos/uploads
- **Purpose:** visual documentation of venues; user avatars
- **Data subjects:** uploaders
- **Data categories:** image files; `venue_photos`: `uploaded_by`, `storage_path`, `caption`; `avatars` bucket keyed by user id
- **Source:** directly from the data subject
- **Lawful basis:** Contract/Legitimate Interests
- **Special category:** photos could incidentally contain images of children or identifiable third parties — moderation is the control, not a technical filter
- **Storage:** Supabase Storage — `avatars` bucket (public) and `venue-photos` bucket (private; made private specifically to reduce exposure); the venue-photos storage path deliberately excludes the user id ("avoids an unnecessary linkage")
- **Recipients:** approved venue photos are public; avatars are public by bucket design
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** pending/rejected photos are **hard-deleted** on account deletion; **approved** photos are **kept but anonymised** (`uploaded_by`/`moderated_by` set to NULL) — a documented GDPR recital 26 "anonymisation is erasure-equivalent" position, not a retained personal-data position
- **Automated processing:** none beyond moderation queue routing (human-decided) · **Children's data:** possible (incidental, in image content) — no technical control beyond moderation

### 9. Venue submissions
- **Purpose:** expand the venue directory via user contribution
- **Data subjects:** submitting users
- **Data categories:** `submitted_by`, plus the venue's own factual data (not personal to the submitter)
- **Source:** directly from the data subject
- **Lawful basis:** Legitimate Interests (directory growth)
- **Special category:** none
- **Storage:** `venues` table, `moderation_status='pending'` until approved; heavily rate-limited and column-restricted per migration 063
- **Recipients:** public once approved
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** `submitted_by` anonymised (`SET NULL`) on account deletion; the venue data itself persists (factual, not personal to the submitter, by design)
- **Automated processing:** rate-limit/quota enforcement is automated but does not itself decide venue publication (moderation is human) · **Children's data:** no

### 10. Business claims
- **Purpose:** let a venue operator claim and manage their listing
- **Data subjects:** claiming users (venue operators, who may be sole traders — see the enrichment LIA's discussion of this population)
- **Data categories:** `venue_claims`: `user_id`, `status`, `notes`, `admin_notes`, plus (as of the schema change below) `phone_last4`, `phone_verification_hmac`, `phone_verified_at`, `phone_verification_method`. The legacy `verified_phone` (plaintext) and `verified_phone_token` columns still exist in the live database (see below).
- **Source:** directly from the data subject (phone number provided for verification)
- **Lawful basis:** Contract (claim verification is necessary to grant claim rights)
- **Special category:** none, but see the finding below
- **Storage:** `venue_claims` table
- **⚠️ Finding (2026-08-31 governance pass), STATUS UPDATE (2026-09-01, Privacy-Critical Engineering
  Remediation Pass):** `venue_claims.verified_phone` was found stored as **plaintext**, inconsistent with
  the companion OTP mechanism (`otp_attempts`, which correctly stores only `phone_hash`/`code_hash`).
  Traced this pass: the ONLY consumer of the plaintext value is `app/admin/moderation.tsx`'s pending-claims
  queue, which already only ever *displayed* a masked form — the full value never needed to leave the
  database for any actual product purpose. The claim-submission UI itself is currently REMOVED from the
  app (`app/(tabs)/profile.tsx:486-489`, "being redesigned for security before re-launch"), so no new
  plaintext rows are being created today; existing rows remain.
  **✅ Minimised schema DESIGNED and DRAFTED** (`supabase/migrations_drafts/20260901120000_venue_claims_phone_minimisation.sql`,
  UNAPPLIED, additive-only): `phone_last4` (display), `phone_verification_hmac` (keyed HMAC-SHA256, for
  repeat-claim fraud detection only — never a bare/unsalted hash), `phone_verified_at`,
  `phone_verification_method`. Application code (`hooks/useVenueClaims.ts`, `types/index.ts`,
  `app/admin/moderation.tsx`) updated this pass to select/display only `phone_last4` — the admin queue no
  longer receives the full number over the wire at all, not just displays it masked. **The plaintext
  column itself has NOT been dropped** (a live production column drop is a separate, deliberate,
  later step, deliberately not bundled into the additive migration — see the migration file for the full
  backfill/redaction plan for existing rows, none of it executed). **Related, unfixed finding**:
  `otp_attempts.phone_hash`/`.code_hash` use a PLAIN unsalted SHA-256 (not this pass's named scope, but the
  same anti-pattern Liam explicitly ruled out — flagged in the migration file for future attention).
- **Recipients:** admin reviewers only (now receiving only `phone_last4`, not the full number)
- **Processor:** Supabase
- **International transfer:** as row 1
- **Retention:** `NO RETENTION MECHANISM FOUND` for approved/rejected claim rows independent of account deletion; `user_id` cascades (deletes, not anonymises) the claim row if the claimant deletes their account, but a claim that predates deletion and is never revisited has no time-based expiry
- **Automated processing:** OTP verification is automated; claim approval is human · **Children's data:** no

### 11. Business subscriptions / payment
- **Purpose:** paid business-tier features for venue owners
- **Data subjects:** subscribing business users
- **Data categories:** `stripe_subscription_id`, `stripe_customer_id`, `plan`, `status`, billing period dates — **no card data held by PlayPlanner directly** (Stripe Checkout handles card capture)
- **Source:** directly from the data subject via Stripe Checkout; IDs written back by the Stripe webhook
- **Lawful basis:** Contract (Art.6(1)(b)); Legal Obligation (Art.6(1)(c)) for the retention of financial records
- **Special category:** none
- **Storage:** `business_subscriptions` table, `profiles.stripe_customer_id`
- **Recipients:** Stripe (see `PROCESSOR_AND_VENDOR_REGISTER.md`)
- **Processor:** Stripe (independent controller for payment processing/regulatory obligations — see the processor register for the controller/processor classification discussion)
- **International transfer:** see `INTERNATIONAL_TRANSFERS.md` — Stripe is a US-headquartered company; transfer mechanism `UNKNOWN — MUST VERIFY` (Stripe's own DPA/SCC status must be checked directly, not assumed)
- **Retention:** `UNKNOWN — MUST VERIFY` — no retention job found in this repo; financial-record retention is typically ~7 years under UK tax law, per the existing DPIA's Art.6(1)(c) note, but this should be confirmed against Stripe's own retention practice and PlayPlanner's own bookkeeping obligations, not assumed
- **Automated processing:** Stripe webhook processing is automated (subscription state sync); no decision with legal/significant effect is made about the individual by this automation · **Children's data:** no (business subscribers are, by definition, adults operating a business)

### 12. Push notification tokens
- **Purpose:** send opt-in notifications (e.g., "your review was published")
- **Data subjects:** users who have granted notification permission
- **Data categories:** `push_tokens`: `user_id`, `token`, `platform`
- **Source:** directly from the device, with permission
- **Lawful basis:** Consent (Art.6(1)(a) — notification permission)
- **Special category:** none
- **Storage:** `push_tokens` table (FK to `auth.users`, cascade)
- **Recipients:** Expo's push relay (`https://exp.host/--/api/v2/push/send`) receives the device token and notification text at send time
- **Processor:** Expo (see `PROCESSOR_AND_VENDOR_REGISTER.md`)
- **International transfer:** see `INTERNATIONAL_TRANSFERS.md` — Expo is a US company
- **Retention:** `NO RETENTION MECHANISM FOUND` for stale/uninstalled-app tokens beyond account deletion cascade — the migration's own comment notes this as a "future cleanup job if needed," not yet built
- **Automated processing:** notification sending is automated but is not a decision about the individual with legal/significant effect
- **Children's data:** no direct token-to-child link (tokens belong to whoever holds the account)

### 13. Support / waitlist (`pass_interest`)
- **Purpose:** capture interest in a future premium "pass" product
- **Data subjects:** anyone who submits the form, authenticated or not
- **Data categories:** `email`, `source`
- **Source:** directly from the data subject
- **Lawful basis:** Consent (the act of submitting an email to express interest) — **but see the finding below**
- **⚠️ Finding this session:** the INSERT policy on `pass_interest` is `WITH CHECK (true)` — **anyone, including an unauthenticated `anon` role, can insert an arbitrary email address**, and **no SELECT/DELETE policy exists for the submitter to view or remove their own entry**. This means (a) the table could be seeded with someone else's email without their knowledge, and (b) there is no self-service Art.17/Art.15 route for this specific data — a person can only exercise rights over it via the general email-based rights process (see `DATA_SUBJECT_RIGHTS_PROCEDURE.md`), not in-app.
- **Storage:** `pass_interest` table
- **Retention:** `NO RETENTION MECHANISM FOUND`
- **Automated processing:** none · **Children's data:** possible, unverifiable — no age gate applies to this form at all

### 14. Moderation / venue reports
- **Purpose:** content moderation, abuse handling
- **Data subjects:** reporters, and (incidentally) the subjects of reports
- **Data categories:** `venue_reports`: `reported_by`, `reason` (fixed enum), `notes` (free text, ≤2000 chars)
- **Source:** directly from the reporting user
- **Lawful basis:** Legitimate Interests (safety/moderation)
- **Storage:** `venue_reports` table; `moderation_status`/`moderated_by` columns are embedded on `venues`/`reviews`/`venue_photos` directly rather than a separate log table
- **Retention:** `reported_by` is `ON DELETE SET NULL` from creation; the redaction trigger (row 7) additionally clears free-text `notes` on the reporter's account deletion
- **Automated processing:** none (human moderation) · **Children's data:** possible incidentally in free text

### 15. Security / GDPR audit log
- **Purpose:** Art.5(2) accountability — record consent and rights-exercise events
- **Data subjects:** the account holder the event concerns
- **Data categories:** `action` (from a restricted, allow-listed set for client-writable values), `table_name`, `record_id`, `performed_by`
- **Source:** system-generated, triggered by the data subject's own actions
- **Lawful basis:** Legal Obligation / Legitimate Interests (Art.5(2) accountability)
- **Storage:** `gdpr_audit_log`
- **Retention:** the live privacy policy states 3 years then automatic deletion; **this is not currently implemented** (a purge function exists, un-granted, from the enrichment remediation pass — see row 3's finding, same issue applies here); `user_id` is anonymised (`SET NULL`) on account deletion but the audit row itself is retained, by design, for accountability
- **Automated processing:** none · **Children's data:** possible if the account holder is a child

### 16. Enrichment — existing-venue fields (LIVE)
- **Purpose:** keep venue listings (opening hours, contact details) accurate
- **Data subjects:** venue operators, some of whom are sole traders (personal data); the majority are not personal data at all (limited companies, local-authority facilities)
- **Data categories:** proposed field values, evidence snippets (PII-scrubbed for the snippet, **not** for `evidence_raw`), source URLs
- **Source:** the venue's own public website (not obtained from the data subject)
- **Lawful basis:** Legitimate Interests — see `docs/LIA_venue_enrichment.md` for the full three-part test
- **Special category:** none directly, but see the enrichment DPIA's sole-trader personal-data discussion
- **Storage:** `venue_field_proposals`, `venue_enrichment_writes`
- **Retention:** documented-but-**not-implemented** target periods (90/30 days for rejected/superseded); a mechanism now exists (post-remediation) but is un-granted pending sign-off — see the enrichment DPIA addendum §8
- **Automated processing:** yes, within narrow, safeguarded bounds — see `docs/DPIA_website_enrichment_addendum.md` §4, §11 for the full Art.22A-22D analysis
- **Children's data:** no
- **DPIA reference:** `docs/DPIA_website_enrichment_addendum.md`; **LIA reference:** `docs/LIA_venue_enrichment.md`

### 17. Enrichment — discovery, closure, suppression (DRAFTED, **NOT YET APPLIED TO PRODUCTION**)
- **Purpose:** discover new venues from third-party providers; detect possible closures; honour objections durably
- **Data subjects:** as row 16
- **Data categories:** `venue_discovery_candidates` (name, coordinates, address, phone, website of a *candidate place*); `venue_closure_signals`; `venue_operating_status_events` (references the deciding admin's `actor_id`); `venue_enrichment_suppressions` (`created_by`/`removed_by` reference the acting admin)
- **Source:** third-party providers (Geoapify, over OpenStreetMap data) — not obtained from the data subject; this is exactly why Article 14 is the sharpest obligation in the enrichment DPIA
- **Lawful basis:** Legitimate Interests, conditional on the DPIA/LIA's remaining sign-off items (see those documents — **this row's processing is currently BLOCKED for real data**, per the standing enrichment-gate verdict)
- **Storage:** as named, all in `supabase/migrations_drafts/059_enrichment_autonomy.sql` — **confirmed this session: not present in `supabase/migrations/`, i.e. not live in production**
- **Automated processing:** yes — see the enrichment DPIA's Art.22A-22D table; human-only publication and human-only confirmed closure are structural, not conventional
- **Children's data:** no
- **Status: not yet live — recorded here for completeness of the processing-activity record, not as current-state processing.**

---

## Summary table (quick reference)

| Activity | Lawful basis | Special category possible | International transfer | Retention defined? |
|---|---|---|---|---|
| Account auth | Contract | No | Supabase — region `UNKNOWN — MUST VERIFY` | Until deletion |
| Profile | Contract + Consent | Yes (`children_ages`) | as above | Until deletion |
| Location + consent | Consent + LI | No | as above | **Not implemented** despite a live promise |
| Favourites | Contract | No | as above | Until deletion |
| Recent views | n/a (local-only) | No | n/a | Device-local, capped |
| Reviews | Contract/LI + Consent | Yes (`children_ages`) | as above | Deleted on account deletion |
| Votes/flags | LI | No (incidental in free text) | as above | Cascades + redaction trigger |
| Photos | Contract/LI | Possible (incidental) | as above | Delete-or-anonymise split |
| Venue submissions | LI | No | as above | Submitter anonymised, data kept |
| Business claims | Contract | No (but see plaintext-phone finding) | as above | **`NO RETENTION MECHANISM FOUND`** |
| Subscriptions | Contract + Legal Obligation | No | Stripe — `UNKNOWN — MUST VERIFY` | `UNKNOWN — MUST VERIFY` |
| Push tokens | Consent | No | Expo — US | **`NO RETENTION MECHANISM FOUND`** |
| Waitlist (`pass_interest`) | Consent | No | Supabase | **`NO RETENTION MECHANISM FOUND`** |
| Moderation/reports | LI | Possible (incidental) | Supabase | Cascades + redaction trigger |
| Audit log | Legal Obligation/LI | No | Supabase | **Not implemented** despite a live promise |
| Enrichment (live) | LI (see LIA) | Yes (sole traders) | n/a (no live external transfer) | **Not implemented**, mechanism built, unarmed |
| Enrichment (drafted) | LI, conditional | Yes (sole traders) | n/a | **BLOCKED** — not yet applied |

**This ROPA should be re-run whenever a new table/processing activity is added — it is a live document,
not a one-time artefact.**

---

## Appendix: account-deletion data-store matrix (verified 2026-09-01)

Built during the Privacy-Critical Engineering Remediation Pass by tracing `delete_own_account()`'s actual
current body (`051_account_deletion_photo_cleanup.sql`, confirmed unmodified by any later migration) and
proving it end-to-end with a new pglite test (`supabase/tests/account_deletion_matrix.mjs`, 15/15 green —
the first automated test of this flow; migrations 051/052 had previously documented this as
manual/staging-only verification). This is BOTH a privacy record (UK GDPR Art.17) and a **Google Play
account-deletion-route readiness item** — Play requires a working, discoverable account-deletion path for
apps that allow account creation; the mechanism below is that path's actual behaviour, verified, not
merely asserted.

| Data store | Mechanism | Verified this pass? |
|---|---|---|
| `auth.users` / `profiles` | **Hard DELETE** — the identity itself is genuinely deleted, not deactivated | ✅ |
| Reviews the user **authored** | **DELETE** (cascade) — entire review gone, not anonymised | ✅ |
| Reviews the user **moderated** (someone else's) | **SURVIVES**, `moderated_by` → NULL | ✅ |
| Favourites | **DELETE** (cascade) | ✅ |
| Facility votes | **DELETE** (cascade via `auth.users`) | ✅ |
| Photos (approved, own upload) | **SURVIVES**, `uploaded_by` → NULL | ✅ |
| Photos (pending/rejected, own upload) | **DELETE** (explicit pre-cascade step in the RPC body) | ✅ |
| Photos the user **moderated** (someone else's) | **SURVIVES**, `moderated_by` → NULL | ✅ |
| Venues submitted/claimed/moderated by the user | **SURVIVE**, attribution → NULL | ✅ |
| Business claims (`venue_claims`) | **DELETE** (cascade) — the claim record itself is destroyed, not anonymised (a genuine asymmetry vs. most other attribution links in this schema, worth the owner knowing about even though it isn't wrong) | ✅ |
| Business subscriptions | **DELETE** (cascade) — the LOCAL record only; Stripe retains its own copy under its own retention obligations, independent of this | ✅ |
| Push tokens | **DELETE** (cascade) | ✅ |
| Location consent log | **SURVIVES, anonymised** (`user_id` → NULL) — **only true after this pass's fix** (see the Row 3 finding above); before the fix, this row was destroyed entirely | ✅ (with the draft fix applied — the fix itself remains unapplied to production) |
| GDPR audit log | **SURVIVES, anonymised** — the deletion request itself is the first thing logged, then anonymised by the same mechanism | ✅ |
| Another user's data (control) | **Completely untouched** | ✅ |

**Nothing tested this pass contradicts `docs/DPIA.md`'s existing description of this flow** — the matrix
confirms it, with one addition (the location-consent-log CASCADE defect, now separately documented and
fixed as a draft) that the original 2026-06-08 DPIA audit did not catch, because it was checking whether
deletion *succeeds*, not whether it does the *right thing* for every table — a distinction worth carrying
forward into future account-deletion-adjacent audits.
