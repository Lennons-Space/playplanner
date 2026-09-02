# Data Subject Rights Operating Procedure — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01 · Mapped directly to the actual current data stores identified in `ROPA.md`, not a
generic rights-request template.

---

## Rights covered and their general timeframe

Access, rectification, erasure, restriction, portability (where applicable), objection, and rights
related to automated decision-making — each generally to be responded to **within one month** of receipt
(extendable by two further months for complex/numerous requests, with the requester informed of the
extension and reason within the first month). **This one-month clock is separate from the s.164A
complaints clocks in `DATA_PROTECTION_COMPLAINTS_PROCEDURE.md`** — a rights request and a complaint are
different things even if they arrive in the same email.

---

## Access (Art.15)

- **Route today:** in-app data export exists per the existing DPIA's Art.15 reference; `UNKNOWN — MUST
  VERIFY` the exact current in-app screen/flow, since this document is being written without re-tracing
  that specific UI path this session — confirm before relying on this line as fully current.
- **What must be included:** all personal data held about the requester across every store in `ROPA.md`
  that actually names them as a data subject — profile, favourites, reviews (their own), votes, photos
  they uploaded, venue claims, subscription records, push tokens, consent-log entries, audit-log entries,
  any enrichment records that happen to name them as `reviewed_by`/`actor_id`/`applied_by` if they are an
  admin.
- **Not included:** other users' data, even where the requester's own record references them (e.g. a
  review's moderator identity is not the reviewer's own data to receive in full).

## Rectification (Art.16)

- **Profile fields** (`full_name`, `postcode`, `children_ages`, etc.): user can self-correct via their
  own profile settings for most fields — `UNKNOWN — MUST VERIFY` whether every relevant field has a
  self-service edit path or whether some require an email request.
- **Reviews/venue submissions the user authored:** editable by the author directly per existing app
  functionality.

## Erasure (Art.17) — mapped to what actually happens per store

**Account deletion already exists and is well-documented** (`delete_own_account()` RPC, `docs/DPIA.md`
§10) — this section restates the *rights* framing of that existing mechanism and extends it to the newer
findings from this governance pass, not duplicate the existing DPIA's technical description.

| Scenario | What happens | Lawful retention rationale, if any is retained |
|---|---|---|
| User deletes their account | `auth.users`/`profiles` deleted; favourites/facility-votes deleted (cascade); reviews deleted (cascade); pending/rejected photos deleted; **approved photos anonymised, not deleted** | Approved photos: anonymisation is treated as erasure-equivalent (GDPR recital 26) because the photo is community content with no remaining personal link — this rationale should be stated to the user, not just assumed |
| Venue operator asks to correct phone/email on their listing | No dedicated self-service claim/edit screen currently exists (`ROPA.md` row 10, `hooks/useVenueClaims.ts` has no user-facing consumer per an earlier audit this project has already recorded) — route today is the **suppression mechanism** built during the enrichment remediation pass (`venue_enrichment_suppressions`), operated by an **admin on the operator's behalf** after an email request, not by the operator directly | Not applicable — this is a correction, not a retained-data question |
| Sole trader objects to enrichment of a contact field | Admin creates a suppression record (venue+field scoped) — this is now **durable** per the R3 remediation (`docs/DPIA_website_enrichment_addendum.md` §10.1) — the field will not be re-proposed by future crawls | The suppression record itself is retained **deliberately and indefinitely by design** — it is the mechanism that prevents recreation, and deleting it would defeat its own purpose (see the retention/suppression-interaction principle below) |
| Operator asks that removed contact information not reappear | Same suppression mechanism, whole-venue or field-scoped as appropriate | As above |
| Review author requests erasure | Deleting their account deletes their reviews entirely (cascade) — **there is currently no way to erase a single review without deleting the whole account**, which is a proportionality gap worth flagging: a user who wants one review gone, not their whole history, has no such granular route today beyond the review's own existing delete function if one exists client-side (`UNKNOWN — MUST VERIFY` whether reviews have an independent delete path outside full account deletion) | n/a |
| Uploaded photo deletion | Pending/rejected: hard-deleted on request/account deletion. Approved: anonymised, not deleted (see above) — a user should be told this distinction plainly if they ask for a specific photo to be "deleted" | Community-content rationale, as above |
| Suppression record interaction | See below | See below |
| Immutable/audit records | `gdpr_audit_log`, `venue_operating_status_events`, `venue_enrichment_writes` — none of these are erasable on request; `user_id`/`actor_id` are anonymised (`SET NULL`) on the *acting* individual's own account deletion, but the event/record itself persists | Art.5(2) accountability requires demonstrable audit trails — the DPIA's own analysis (§8) already establishes this is a legitimate, documented retention rationale, not an oversight, though the *periods* for how long remain owner/legal sign-off items per that document |

**Do not treat "erasure" as meaning every audit row must always disappear** (Liam's explicit instruction,
restated here as the operating rule): an admin's decision record, a closure-event ledger entry, or a
write-ledger row documenting what was changed and why are accountability records with their own lawful
retention rationale, distinct from the personal data of the data subject the enrichment concerned. Where
retained, the *rationale* must be recorded and, per `ROPA.md`/the enrichment DPIA, subject to an eventual
approved retention period — not a silent "forever" default either.

### The retention/suppression interaction — restated as an operating rule for rights requests

**A suppression record is not itself something to erase on a later, unrelated "clean up old data" pass.**
This was proven during the enrichment remediation work (redline tests `L1`/`L2`: no retention/purge
function references the suppression table in any DELETE/UPDATE, and a suppression demonstrably survives
every purge function running back-to-back). **When actioning any future rights request that touches
enrichment data, check whether a suppression record exists for that venue/field before assuming "erasure"
means removing everything** — the suppression record's continued existence **is** the fulfilment of the
person's original objection, not a leftover to be tidied away.

## Restriction (Art.18)

`UNKNOWN — MUST VERIFY / NOT YET BUILT` — no dedicated "restrict processing" mechanism (as distinct from
full deletion or a field-level suppression) appears to exist for general account data. The enrichment
suppression mechanism is the closest analogue that exists today, but it is scoped to enrichment fields
specifically, not a general-purpose restriction flag across all processing activities. Flagged as a gap,
not silently assumed solved by the suppression mechanism's existence.

## Portability (Art.20)

Applies to data provided by the subject, processed by automated means, under consent or contract. The
existing data-export mechanism (per `docs/DPIA.md`) likely satisfies this for profile/review data — the
existing DPIA already claims "portability (Art.20)... implemented"; **not independently re-verified this
session**, marked here as `UNKNOWN — MUST VERIFY` rather than repeated as settled fact.

## Objection (Art.21)

- **To legitimate-interests processing generally:** no dedicated in-app "object" button exists; route
  today is the email channel, handled case by case.
- **To enrichment specifically:** the suppression mechanism is the durable, server-side answer — see
  above and the LIA's own discussion of this exact scenario.
- **To marketing:** `marketing_consent` can be toggled off directly by the user (consent withdrawal,
  functionally equivalent to an objection for this specific processing).

## Rights related to automated decision-making (Art.22 / UK 22A-22D)

Per `docs/DPIA_website_enrichment_addendum.md` §11, **no current path constitutes solely-automated
decision-making with legal or similarly-significant effect** — so there is currently no live "contest an
automated decision" scenario to build a procedure for. **If that assessment ever changes** (the two edge
cases flagged there — sole-trader auto-published contact details, a future consumer-visible closure
badge), this procedure would need a dedicated route for a data subject to request human review, express
their point of view, and contest the decision, per UK Art.22C's safeguard requirements — not built now
because the triggering scenario does not currently exist.

## Verification proportionate to the request

As with complaints (`DATA_PROTECTION_COMPLAINTS_PROCEDURE.md`), verify identity in proportion to
sensitivity — a request to correct a public review's typo needs less verification than a request to
export or delete an entire account's data.

## What this procedure does not assume

It does not assume every retained record must be deleted on request (see the audit-trail and suppression
discussions above), and it does not assume the current in-app mechanisms (export, deletion) are fully
verified as complete — several lines above are marked `UNKNOWN — MUST VERIFY` rather than copied forward
from the existing DPIA's more confident framing, consistent with this governance pass's instruction to
check every statement against current reality rather than accept prior documentation as settled.
