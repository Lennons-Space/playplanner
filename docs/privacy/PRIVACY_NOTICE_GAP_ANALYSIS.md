# Privacy Notice Gap Analysis — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01 · Compares `docs/privacy.html` (live, fetched and confirmed reachable in an earlier
session this pass builds on) and `app/(auth)/privacy.tsx` (in-app content) against the DPIA, LIA, ROPA,
and processor register produced in this governance pass. **This document does NOT rewrite or deploy the
live page** — it identifies exactly what is missing/outdated, per instructions.

---

## Confirmed content already present (not gaps — stated so nothing is duplicated)

From the live fetch: controller identity ("Liam Evanson trading as PlayPlanner, UK"), contact
(`privacy@playplanner.app`), location processing description ("rounded to approximately 100 metres,"
"not stored... after the query completes"), retention periods per data type (though see gaps below for
which ones are actually accurate in operation), and the ICO complaint route.

## Gaps — exact missing/outdated statements

### 1. Enrichment / public-source venue data processing — **entirely absent**
Confirmed by direct fetch: the live privacy page has **zero mention** of enrichment, public-source data
collection, or third-party providers (Geoapify, OpenStreetMap). This is the single largest gap and is
already flagged as remediation item **R8** in `docs/DPIA_website_enrichment_addendum.md` §16 — this
document does not duplicate that analysis, only confirms it is still open and cross-references it.
**Needed additions:** a new section covering source categories (venues' own websites; Geoapify/OSM),
lawful basis (legitimate interests, summarising the LIA), purposes, the honest current retention position
(see gap 3), objection/correction route (the suppression mechanism, described in plain language), and the
existing safeguards (fill-if-empty, human-only new-venue publication, human-only confirmed closure)
stated at the same honesty level the DPIA itself uses.

### 2. The "3 years then deleted automatically" claim — **false in current operation**
`app/(auth)/privacy.tsx:181-183` states location-consent and GDPR audit-log entries are "kept for 3 years
then deleted automatically." Confirmed again this session: **no scheduled job actually does this.** A
purge-function *mechanism* now exists (built during the enrichment remediation pass) but is deliberately
unarmed pending sign-off — see `docs/DPIA_website_enrichment_addendum.md` §8.3. **This is a live,
user-facing transparency failure, unrelated to enrichment, and arguably more urgent to fix than the
enrichment-specific gaps** because it is a promise being actively broken today, not a future risk.
**Fix options (not implemented here):** (a) correct the wording to something accurate ("we aim to delete...
periodically reviewed") until the purge functions are actually scheduled, or (b) schedule the functions
first, then the statement becomes true. Either is Liam's call.

### 3. Retention periods more broadly — several stated or implied, not all accurate
`ROPA.md` identifies several stores with `NO RETENTION MECHANISM FOUND` (business claims, push tokens,
`pass_interest` waitlist entries, `venue_field_proposals` despite a documented-but-unbuilt intent) that
the current privacy notice does not itemise at all — a general retention statement exists, but it is not
granular enough to reflect what `ROPA.md` actually found. This is lower priority than gaps 1-2 but should
be folded into the same eventual rewrite pass.

### 4. Complaints procedure — the escalation line exists, the procedure itself does not
The live page already states the right to complain to the ICO. It does **not** describe **PlayPlanner's
own complaints-handling procedure** (the 30-day acknowledgement commitment, etc.) — see
`DATA_PROTECTION_COMPLAINTS_PROCEDURE.md`'s recommended addition.

### 5. Suppression mechanism — not mentioned, and it's a genuine positive to disclose
The privacy notice should describe, in plain language, that an operator who objects to their contact
information being enrichment-sourced has a durable route to stop it (the suppression mechanism) — this is
a real, tested capability (`docs/DPIA_website_enrichment_addendum.md` §10.1) and is worth stating
explicitly as part of the objection-rights section, not left implicit.

### 6. Automated processing — the notice does not currently describe *any* automated processing
Given enrichment is not yet live, this is currently a forward-looking gap rather than a live
inaccuracy — but per Art.13/14's requirement to describe automated decision-making where it exists, the
notice will need this section the moment 059/060/061 are ever applied (which remains BLOCKED regardless
of this document).

### 7. Processor/vendor transparency
The existing notice references Supabase/Stripe/Google Maps generally (per prior sessions' review) but
does not name Expo's Push relay or GitHub Pages hosting explicitly. Given `PROCESSOR_AND_VENDOR_REGISTER.md`
found Expo's Push relay to be the vendor with the weakest confirmed contractual picture, it is also the
one most worth being transparent about in the notice itself, separate from fixing the underlying DPA
question.

### 8. Children's Code framing
Given `CHILDRENS_CODE_SCOPE_ASSESSMENT.md`'s cautious "potentially in scope" conclusion (revising the
existing DPIA's more confident "adults only" framing), the privacy notice's language register should not
assume every reader is an adult — a minor, non-substantive wording review, not a structural change.

### 9. Data residency claim
`docs/DPIA.md`'s "AWS eu-west-2 Ireland, confirmed in app config" claim could not be re-verified from the
current repo this session (see `PROCESSOR_AND_VENDOR_REGISTER.md`, `INTERNATIONAL_TRANSFERS.md`). If the
live privacy notice makes a similar residency claim anywhere, **it should not be repeated with confidence
until the hosting region is actually confirmed** — check the exact current wording of the live page
against this finding before any future edit.

---

## Priority ranking for a future rewrite pass (not undertaken here)

1. **Gap 2** (the false 3-year deletion claim) — live, active, user-facing inaccuracy, unrelated to
   enrichment being blocked, fixable independently and quickly.
2. **Gap 1** (enrichment processing entirely undisclosed) — required before enrichment can legitimately
   go live at all (already tracked as DPIA R8/R5).
3. **Gap 9** (residency claim) — should be resolved (verify or soften) before it's repeated further.
4. Gaps 4, 5, 7, 8 — lower urgency, good-practice completeness items.
5. Gap 6 — not urgent while enrichment remains blocked; becomes urgent exactly when it stops being blocked.

**This document intentionally stops at identifying and prioritising gaps — the actual rewrite of
`docs/privacy.html` is separate, deliberate work requiring the governance facts in this pass to be
settled (and, for gap 1, the enrichment DPIA's own remaining sign-off items resolved) first.**
