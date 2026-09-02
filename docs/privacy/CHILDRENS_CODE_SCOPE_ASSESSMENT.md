# ICO Children's Code (Age Appropriate Design Code) — Scope Assessment

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01 (§1.1 and §8 updated 2026-09-01, same day, during the "Privacy-Critical Engineering
Remediation Pass" — see the update note inline below; the overall scope conclusion in §3 is UNCHANGED by
that pass, as an engineering wording fix cannot resolve a legal-scope question)
**Prepared by:** development team, from a fresh read of the current product (not carried forward from
`docs/DPIA.md`'s 2026-06-08 conclusion — see §0 for why that conclusion is revisited here).
**Legal status of the underlying instrument:** the Children's Code is a **statutory code of practice**
issued by the ICO under DPA 2018 s.123 — it is LAW in the sense that a court/regulator must have regard
to it, not merely advisory guidance. **Not a substitute for solicitor/DPO review.**

---

## 0. Why this revisits, rather than accepts, the existing DPIA's conclusion

`docs/DPIA.md` (2026-06-08) rates every Children's Code standard "✅" on the reasoning that "the app
targets adults (parents) only" and that an 18+ self-declaration checkbox at signup closes Standard 4.
**That reasoning does not match current ICO guidance and should not be relied on as-is.**

**ICO's "likely to be accessed" test** (REGULATOR GUIDANCE, ico.org.uk, cross-verified via secondary
legal-commentary sources because ico.org.uk's own standards pages returned HTTP 403 to direct fetch this
session — substance is high-confidence, exact wording should be re-checked against the live page before
this document is finalised): the threshold is **"more probable than not,"** and a service can be in
scope **even where children are not the intended or target audience**, if in fact a significant number
access it. A stated age restriction in the Terms of Service, on its own, **does not exempt a provider**
if children in reality access the service anyway. Where a provider concludes children are unlikely to
access a service, ICO expects that conclusion to be **documented with evidence** — market research,
actual user-behaviour data, comparable-service demographics, or effectiveness testing of an access
restriction. **"We say adults only" is not that evidence.**

This document therefore does not ask "who is PlayPlanner designed for" (parents — not in dispute) but
"is there sufficient evidence that children are in fact unlikely to access it." Per Liam's explicit
instruction: **if there is insufficient evidence to conclude children are unlikely to access it, this
document fails cautiously rather than assuming out of scope.**

---

## 1. What the product actually does (evidence, not assumption)

### 1.1 Account creation — the actual gate, read from the current code

> **✅ UPDATE (2026-09-01, Privacy-Critical Engineering Remediation Pass):** the wording inconsistency
> described below has been FIXED. The checkbox at `app/(auth)/register.tsx:426` now reads **"I confirm I
> am 18 or over"** — the "or a parent/guardian using PlayPlanner for my family" carve-out has been
> removed, matching `docs/terms.html`'s flat 18+ requirement exactly. This confirms PlayPlanner's product
> intent (adult-only ACCOUNTS) but **does NOT resolve the Children's Code SCOPE question in §3 below** —
> a consistent account-creation gate says nothing about whether children access the unauthenticated
> browse/search/map experience, which requires no account at all. §3's "potentially in scope, proportionate
> compliance" conclusion is UNCHANGED by this fix. The original finding is preserved below for the record.

`app/(auth)/register.tsx` (as it read before the 2026-09-01 fix):
- Collects `fullName`, `email`, `password` only — no date of birth, no age field of any kind.
- Requires two separately-ticked, non-pre-ticked checkboxes before the "Create account" button enables
  (`canSubmit = termsAccepted && ageAffirmed && !loading`, line 277):
  - **Terms checkbox**: "I have read and accept the Terms of Service and Privacy Policy."
  - **Age-affirmation checkbox** (line 426, PRE-FIX): "I confirm I am 18 or over, or I am a parent/guardian
    using PlayPlanner for my family."
- `docs/terms.html:110-116` states flatly: "You must be 18 years of age or older to create a PlayPlanner
  account... If we discover that an account belongs to someone under 18, we will close it immediately."

**The internal inconsistency that existed here (now fixed)**: the in-app checkbox text was a
disjunction ("18+ **or** a parent/guardian... for my family") while the hosted Terms stated a flat 18+
requirement with no such carve-out. A literal reading of the old checkbox would have let a 16-year-old
caring for younger siblings tick it honestly. This was not itself a Children's-Code defect — ICO
explicitly accepts **self-declaration as a proportionate, low-friction age-assurance mechanism for a
low-risk service** (see §3, Standard 3) — but the two documents now say the same thing, closing a real
product/legal-text mismatch, not the Children's Code scope question.

**No technical enforcement exists beyond this checkbox.** No date-of-birth collection, no
device-signal-based age estimation, no parental-consent flow. A child who ticks the box is not detected,
blocked, or flagged by anything in the current system.

### 1.2 What a child could plausibly do with the app

- **Discovery/search/map**: browsing venues, viewing photos, reading reviews — all readable
  unauthenticated (anon RLS grants confirmed elsewhere in this session's audits). **A child does not even
  need an account to use the core discovery/search/map features** — only account-gated actions (reviews,
  favourites, photo upload, venue submission, facility votes) require the 18+/guardian checkbox.
- **Content and design**: no gamification, no child-facing characters/mascots, no push notifications
  targeting age groups, no engagement-maximising mechanics (confirmed by `docs/DPIA.md §6.7` and this
  session's own review of the register/welcome screens — copy is consistently adult-directed: "Family
  days out, sorted by parents," "Join thousands of parents discovering great places").
- **Nothing in the product is designed to appeal to children directly** for their own engagement — this
  is a genuine, evidenced, positive factor (marketing/content-appeal is one of the EDPB/ICO-recognised
  indicators for "likely to be accessed," and it points away from scope here).

### 1.3 What data about children the app actually holds

- `profiles.children_ages text[]` and `reviews.children_ages text[]` — **coarse age-range strings** (e.g.
  `'3-5'`), entered by the **parent** about their own children as third parties, never by a child about
  themselves, never exact birthdates, never names. This is Art. 9-adjacent "data about children" but it
  is not data **from** a child data subject using the service, and it is not a child's own account.
- No child ever creates their own profile, account, or identity in this system as currently built.

---

## 2. A. Is PlayPlanner an "information society service" for Children's Code purposes?

**Yes, in substance.** It is a service normally provided for remuneration (freemium + a business
subscription tier), at a distance, by electronic means, at the individual request of a recipient of the
service — the standard ISS definition. This is not seriously contestable and is not the live question.

## 3. B. Is it likely to be accessed by a significant number of children under 18?

**UNCLEAR — insufficient evidence to conclude "no," so this assessment proceeds on a cautious,
proportionate-compliance basis rather than declaring the Code inapplicable.**

**Evidence pointing away from scope:**
- Marketing, copy, and design are consistently and exclusively adult/parent-directed.
- No content, mechanic, or feature is designed to appeal to a child using the app for their own purposes.
- An explicit age-affirmation gate exists on every account-creation path (imperfect, but present and
  UI-enforced, unlike having nothing at all).

**Evidence that does not support a confident "no," and which ICO would expect addressed with real
evidence rather than inference:**
- **No actual usage/demographic data exists to check against.** PlayPlanner collects no analytics
  whatsoever (confirmed repeatedly this session — zero analytics SDKs), which is excellent for data
  minimisation but means **there is no evidence base to demonstrate children are not, in fact, using the
  product** — the company could not currently produce the kind of evidence ICO's guidance expects if
  challenged.
- **The core browse/search/map surface requires no account at all**, so the age-affirmation gate does not
  even apply to the single largest plausible avenue of child access (an unauthenticated child looking up
  a venue, a park, an activity — precisely the content a child interested in days out might independently
  seek).
- **The account-side gate is self-declared and technically unenforceable**, and its own wording (§1.1)
  arguably invites a family member under 18 to use it "for the family."
- A directory of children's activity venues, aimed at organising children's days out, is a **plausible
  destination for a curious teenager** to browse directly (e.g. planning their own outing with friends),
  even though it is not designed for that use.

**Conclusion for this document:** treat PlayPlanner as **potentially in scope**, and apply the 15
standards proportionately to the actual, evidenced risk level (which is low-to-moderate, not
zero) rather than either (a) declaring full exemption on the existing DPIA's reasoning, or (b) over-engineering
invasive age verification the risk does not justify. This matches Liam's explicit instruction not to
introduce invasive age verification for a theoretical problem, while not assuming the problem away either.

## 4. C. Evidence supporting this answer

Summarised from §1–3 above: adult-only marketing and design (weighs against); zero usage-demographic
evidence to test the "no" conclusion (weighs against confident exemption); unauthenticated core browsing
surface with no gate at all (weighs against confident exemption); self-declared, unenforced account gate
with internally inconsistent wording (weighs against confident exemption, though the mechanism itself —
self-declaration — is an ICO-accepted proportionate response for a low-risk service, so this is a
*design-honesty* finding, not a *"you must add ID verification"* finding).

---

## 5. The 15 standards — current status against actual evidence

| # | Standard | Status | Evidence |
|---|---|---|---|
| 1 | Best interests of the child | 🟡 Partial | Moderation exists for UGC; no explicit "best interests" design principle documented anywhere beyond ad hoc DPIA narrative |
| 2 | DPIA | 🟡 Partial | `docs/DPIA.md` exists but pre-dates this scope re-assessment and asserts the Code is fully satisfied on reasoning this document revises; the enrichment DPIA addendum is far more rigorous but covers a different processing activity |
| 3 | Age-appropriate application | 🟡 Partial | Self-declaration checkbox is a proportionate mechanism for a low-risk service **in principle**, but see §1.1's wording inconsistency, and note the unauthenticated browse surface has no application of this standard at all |
| 4 | Transparency | 🟡 Partial | Privacy policy exists, plain-language, but (per `PRIVACY_NOTICE_GAP_ANALYSIS.md`) is not child-friendly in register and does not address the "you may be a child using this, here is what that means" case explicitly |
| 5 | Detrimental use of data | 🟢 Good | No profiling of children's data for anything beyond the user's own recommendation results; no advertising; no third-party sharing (confirmed — zero analytics/ad SDKs) |
| 6 | Policies and community standards | 🟡 Partial | Moderation policy exists operationally (pending-by-default UGC) but is not published as a standalone community-standards document a child/parent could read |
| 7 | Default settings | 🟢 Good | `show_in_search` defaults **false**; marketing consent defaults **false**; location defaults to no persistent grant and a non-identifying fallback location |
| 8 | Data minimisation | 🟢 Good | Age **ranges**, not birthdates; no exact child identity ever collected; `children_ages` never exposed via `public_profiles` view |
| 9 | Data sharing | 🟢 Good | No third-party data sharing found anywhere this session (see `PROCESSOR_AND_VENDOR_REGISTER.md`); `children_ages` never leaves the user's own account context |
| 10 | Geolocation | 🟡 Needs attention | See `LOCATION_MINIMISATION_REVIEW.md` — location is off by default and coarsened, which is directionally right, but there is no **specific, documented** geolocation policy that names children as a reason, and `ACCESS_FINE_LOCATION` is still declared (assessed separately) |
| 11 | Parental controls | ⚪ Not applicable as designed | The product model is "parents are the account holders," not "children have accounts parents supervise" — this standard's normal mechanics (parental dashboards, supervised accounts) don't map onto the current design. **This is only a safe "not applicable" if §3's scope conclusion is later firmed up to "unlikely to be accessed" with real evidence — until then, treat as open, not closed.** |
| 12 | Profiling | 🟢 Good | `familyScore.ts` personalises only the requesting user's own results from their own stated age ranges; no cross-user profiling; profiling-for-marketing does not exist |
| 13 | Nudge techniques | 🟢 Good | No dark patterns, no urgency language, no engagement-maximising mechanics identified anywhere in this session's or prior sessions' review of the auth/onboarding flows |
| 14 | Connected toys and devices | ⚪ Not applicable | PlayPlanner has no connected-device/IoT/toy integration of any kind |
| 15 | Online tools | 🟡 Partial | No dedicated in-app tool exists for a child (or anyone) to exercise privacy rights directly and simply; rights are exercised via account settings + email fallback (see `DATA_SUBJECT_RIGHTS_PROCEDURE.md`) |

**Legend:** 🟢 Good = evidenced and adequate for the current risk level · 🟡 Partial = a real control exists
but has a gap or lacks documentation · ⚪ Not applicable = genuinely doesn't map onto the current product
shape, flagged rather than silently assumed · nothing is marked 🔴 because no standard is currently
*absent* outright — but several 🟡 items are exactly the kind of gap ICO would expect closed once a
service is treated as potentially in scope.

## 6. Location — the standard requiring the most care

**LAW** (part of the statutory Code, not mere guidance): geolocation must be **off by default** unless a
compelling reason exists, having regard to the best interests of the child, and profiling based on
location must likewise default off.

PlayPlanner's current design **already does most of this by construction, for everyone, not
specifically because of children**: no location is requested at app start; the OS permission is only
triggered when a user actively opens the map; a non-identifying fallback location is used otherwise; no
location is persisted to the database (confirmed across multiple sessions' code review). This
**substantively satisfies the geolocation standard's outcome**, but it does so as a general privacy
default, not as a documented, deliberate Children's-Code-aware policy — worth stating explicitly rather
than leaving it implicit, given §3's "potentially in scope" conclusion. See `LOCATION_MINIMISATION_REVIEW.md`
for the separate, narrower question of whether `ACCESS_FINE_LOCATION` itself is justified.

> **✅ UPDATE (2026-09-01, Privacy-Critical Engineering Remediation Pass) — provisional engineering rule
> verified, and location minimisation strengthened:**
> 1. **Provisional rule verified true:** "non-essential geolocation is OFF by default and only activated
>    by a deliberate user action/permission" — traced this pass across every consumer of
>    `hooks/location/useLocation()` (Home tab, search, map, results, discover collections). Every one is
>    gated behind `useLocationConsent()`, which only ever *reads* a previously-stored yes/no decision and
>    **never itself triggers the OS permission dialog**. The OS prompt can only fire after a user has
>    already made a separate, deliberate consent decision elsewhere in the app. **Entering the map screen,
>    or opening the Home tab, does NOT by itself trigger the OS location prompt** — confirmed by reading
>    `app/(tabs)/index.tsx`'s own header comment ("This screen NEVER calls useLocation() itself... the ONLY
>    place that calls useLocation() [is gated so] the OS prompt can never fire pre-consent") and verifying
>    the same gating pattern in every other consumer. **No flag raised — this satisfies §6's requirement.**
> 2. **`ACCESS_FINE_LOCATION` has been removed** from `app.json` this pass (see
>    `LOCATION_MINIMISATION_REVIEW.md` for the full analysis and required real-device confirmation) —
>    strengthening this standard specifically, not just general privacy-by-design, since geolocation
>    precision is exactly this standard's own named subject matter.

---

## 7. Children + rights interaction (folds in Liam's §13)

Given §3's cautious "potentially in scope" conclusion, and given no child ever holds their own account in
the current design, the practical interaction is narrow:

- **Child-friendly privacy explanations**: not currently needed as a *separate* document, because no
  child is a direct account-holder data subject today — but the main privacy notice's language register
  should not assume only adult readers, given §3.
- **Child rights requests**: no distinct mechanism exists or is proposed here; the existing
  `DATA_SUBJECT_RIGHTS_PROCEDURE.md` applies to whoever holds an account, adult or not, without a special
  child-specific path — proportionate, given no child-specific account type exists.
- **Parent/guardian interactions**: not applicable in the "supervising a child's own account" sense — the
  parent **is** the account holder; this is the current design's main structural mitigation.
- **Age assurance proportionality**: current self-declaration checkbox is proportionate to the evidenced
  risk level (§3) — **do not escalate to ID verification, biometric age estimation, or other invasive
  measures**; that would be disproportionate to a low-risk directory service and is not recommended by
  this document.
- **High privacy defaults / location defaults / profiling / notifications / nudging**: all already
  addressed as general defaults (§5) — the finding here is that they exist for good general-privacy
  reasons and happen to also satisfy the Children's Code, which is worth documenting so it isn't lost or
  weakened in a future redesign that doesn't know it was doing double duty.

---

## 8. Recommendation

1. **Do not adopt the existing DPIA's "fully compliant, adults only" framing without revision** — replace
   `docs/DPIA.md §3` with a pointer to this document once reviewed.
2. **Align the checkbox wording and the Terms wording** (§1.1) so they say the same thing — a small,
   low-risk copy fix, not implemented in this pass per instructions (documentation-only).
3. **No invasive age-verification is recommended.** The self-declaration approach is proportionate; the
   gap is evidentiary (no usage data to confirm the "low risk" assumption), not mechanistic.
4. **Owner/legal decision needed:** formally adopt this document's "potentially in scope, proportionate
   compliance" posture, or commission the evidence (market research / comparable-service data) that would
   let a future revision confidently conclude "unlikely to be accessed."

**This document does not conclude the Children's Code definitely applies, nor that it definitely does
not. It concludes the evidence does not currently support a confident exemption, and recommends
proportionate compliance with the 15 standards while that evidentiary gap exists.**
