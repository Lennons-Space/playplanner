# Legitimate Interests Assessment — Venue Enrichment, Discovery & Closure Automation

**Companion to:** `docs/DPIA_website_enrichment_addendum.md` v2.1 · `docs/DPIA.md`
**Version:** 1.1 (updates §3.5/§3.6 for the 2026-09-01 pre-staging remediation pass — R1/R2/R3 fixed, R5
still open; see those sections)
**Date:** 2026-09-01
**Status:** DRAFT — **still not signed off.** Prepared by the development team from the certified
architecture at commit `8a097b7`, cross-referenced against the DPIA addendum. **Not a substitute for
solicitor/DPO review.** Where the addendum and this document disagree, the addendum's file:line-cited
technical facts are authoritative; this document supplies the UK GDPR Art. 6(1)(f) three-part-test
reasoning built on those facts.

**Scope:** this LIA covers the lawful basis for all three enrichment activities — existing-venue field
enrichment, new-venue discovery, and closure detection — insofar as they process **personal data**. Most
`venues` rows are ordinary business data (companies, trusts, local-authority facilities) and fall outside
UK GDPR entirely. This LIA exists because **a minority of venues are sole traders**, and for those,
contact details, a proprietor's name, or a `firstname.lastname@` address are personal data. **We cannot
reliably distinguish sole-trader venues from others** (see DPIA §2 — the `looksPersonalEmail` heuristic is
a confidence hint, not a personal-data filter), so this assessment is written as if any given contact
field might be personal data, because it might be.

Do not read "publicly available" anywhere in this document as meaning UK GDPR does not apply. Publicly
accessible information about an identifiable individual is still personal data; publication by us is a
new processing activity requiring its own lawful basis, independent of how the venue operator originally
published it.

---

## 1. Purpose test — why PlayPlanner enriches venue information

**Stated purpose:** to keep a public directory of family-friendly venues accurate, specifically: correct
opening hours, working contact details (phone/email/website), accessibility and family facilities, and
whether a venue is still trading.

**Why this is a legitimate interest:**
- Parents making a same-day decision about a venue with young children rely on the listed opening hours,
  facilities (baby-change, parking) and phone number being current. Stale data has a real consequence —
  DPIA §4.3 names it directly: a wrong opening-hours value "sends a family with small children to a
  locked door."
- A venue directory that silently rots (dead phone numbers, wrong hours, closed venues still listed) loses
  the trust that is the product's entire value proposition. Keeping it current is not incidental to the
  business — it is close to the whole of it.
- The interest is PlayPlanner's own (accurate product) and, secondarily, the venue's (a correct listing
  that fill-if-empty can only add to, never overwrite — DPIA §4.1) and the parent-user's (safe to rely on).

**Is the purpose real, specific and legitimate?** Yes. It is not a pretext for a different purpose (e.g.
building a marketing-contact database, or profiling individuals) — no path in the certified architecture
uses enriched contact data for anything other than populating the `venues` listing itself. If PlayPlanner
ever repurposes enriched contact data for direct marketing, lead generation, or sale to a third party, this
LIA is void for that purpose and a fresh assessment is required before it happens.

---

## 2. Necessity test — is this processing needed, and is there a less intrusive way?

**Is enrichment necessary to achieve the purpose?** Reasonably yes, for three sub-activities with
different necessity profiles:

1. **Existing-venue field enrichment** (reading a venue's own site for opening hours/phone/email/website).
   Necessary because there is no other route to keep ~tens of thousands of venue listings current at this
   scale without either (a) manual staff re-verification of every venue on a cycle, which is not
   operationally realistic at current headcount, or (b) leaving listings to go stale, which defeats the
   purpose. **Less intrusive alternative considered and adopted where it fits:** fill-if-empty — the
   system only ever completes a gap the venue's own site already states, never overwrites what a human
   reviewer or the venue operator has already provided (DPIA §4.1; the one current exception,
   `opening_hours`, is a defect under remediation — DPIA §4.3/R1, not a designed feature).
2. **New-venue discovery** (querying Geoapify/OSM for places not yet listed). Necessary to grow directory
   coverage without relying solely on venues finding and submitting themselves, which under-serves smaller
   and less web-savvy operators — including, notably, sole traders, who are least likely to self-submit.
   **Less intrusive alternative:** the pipeline is structurally incapable of auto-publishing a discovered
   venue — the strongest form of "least intrusive" available, since no unattended process can act on a
   candidate beyond quarantining it for a human (DPIA §5.1).
3. **Closure detection** (flagging that a listed venue may have shut). Necessary because a listed venue
   that has actually closed is worse than no listing — it actively misleads a parent. **Less intrusive
   alternative:** automation may only reach `suspected_closed`, an internal state with no current
   user-facing effect (DPIA §6); confirmation and delisting require a named human admin.

**Could this be achieved without processing personal data at all?** Partially. For a limited-company or
local-authority venue, none of this is personal data and no balancing test is needed. The necessity
question that matters is narrower: *given that we cannot reliably tell sole-trader venues apart from
others in advance (DPIA §2), is it necessary to process the contact fields of ALL venues, knowing some
are personal data, in order to keep the directory accurate for the venues that are not?* Answer: yes,
because pre-filtering would require exactly the identification capability we do not have, and excluding
all venues that might plausibly be sole-run (soft-play cafés, children's activity providers — a large and
policy-relevant segment of this directory) would defeat the purpose for the population it matters to most.

**Data minimisation applied:** the field allowlist (website/phone/email/opening_hours/description/
booking_url only — DPIA §4.1), the refusal to ever auto-apply `price_range` (§4.1), robots.txt/SSRF/
throttling limits restricting fetch scope to the venue's own site only (§13), and PII-scrubbing of
`evidence_snippet` (though not `evidence_raw` — a gap noted in DPIA §7) are all necessity-reducing design
choices, not just security ones.

---

## 3. Balancing test — do PlayPlanner's interests override the individual's?

### 3.1 Reasonable expectations
A sole trader who publishes their phone number, email and hours on their own business website has a
reasonable expectation that this information is intended for potential customers to find and use — that
is the purpose they published it for. Republishing the same facts, unaltered, in a directory serving the
same audience (parents looking for the venue) is close to that expectation. It is **further** from
reasonable expectation for:
- **Discovery of a venue that has never engaged with PlayPlanner at all** (DPIA §3: "no relationship, no
  account, no notice") — the venue does not expect to appear in a service they have never heard of. This
  is the single fact that drives the Article 14 analysis (DPIA §9) rather than settling it here.
- **Any contact field NOT already published by the venue itself** — fill-if-empty means we never add
  facts the venue did not itself state publicly, which keeps this element of the balance stable.
- **A "suspected closed" flag ever becoming consumer-visible** without the operator's involvement (DPIA
  §6's trigger condition) — that would be a PlayPlanner statement about a business's trading status made
  without the operator's knowledge, and reasonable expectation weighs against it until (if ever) that
  ships, at which point this LIA must be revisited.

### 3.2 Sensitivity and nature of the data
Business contact details are low on the sensitivity spectrum — not special-category data, not financial,
not health. For a sole trader, a personal mobile number or a `firstname.lastname@` address is more
identifying than a generic `info@` mailbox, but it is data the individual chose to make the public contact
point for their business. **Not sensitive**, but **not weightless** — republishing increases the number of
places the data appears and the volume of contact PlayPlanner's audience may generate for that individual,
which the DPIA (§11) already flags as "arguably approaching similarly significant" for a sole trader before
concluding it sits just below the Art. 22A automated-decision bar.

### 3.3 Impact on the individual
- **Positive:** accurate listing likely to drive custom, at no effort or cost to the venue.
- **Negative:** unsolicited appearance in a directory the operator did not choose to join; volume of
  contact (calls/messages via the published number) that the operator did not size for; a wrong
  auto-applied fact if a safeguard fails (the very live defects DPIA §4.3/§5.3 exist to close); and, most
  seriously, **no reliable way today to object, correct durably, or be suppressed from future re-enrichment**
  (DPIA §10) — a corrected or objected-to fact can be silently reinstated by the next crawl. **This gap is
  the most significant weight against PlayPlanner's interest in this balance**, and it is why the DPIA's
  overall verdict is BLOCKED rather than a plain legitimate-interests pass: a lawful basis is not enough
  on its own if the rights that basis is supposed to coexist with cannot be honoured in practice.

### 3.4 Safeguards actually in place (weighed in PlayPlanner's favour)
- Fill-if-empty for all four auto-apply fields, including `opening_hours` as of the 2026-09-01 R1 fix
  (§4.3); allowlist exclusions for
  `price_range` and (for automation) `description`/`booking_url` beyond narrow validated rules (§4.1).
- Immutable, non-deletable write ledger with old/new value and evidence, enabling audit and rollback in
  principle (§4.2), even though the rollback path currently lacks a UI caller.
- Structural (not conventional) prevention of unattended publication of new venues, and of unattended
  confirmed closure (§5.1, §6) — the two most consequential actions are reserved to a named, accountable
  human by database constraint, not by policy.
- Robots.txt compliance, SSRF protection, throttling, and same-site-only fetching (§13) limit collection to
  what the venue itself has chosen to publish, on its own site, at a rate that does not burden it.
- No affiliate tracking, paid ranking, or sponsorship distorting how a venue (or its contact routing) is
  presented (§13) — the enrichment is genuinely in service of accuracy, not monetisation of the venue's
  visibility.

### 3.5 Safeguards required before this balance can be relied on

**UPDATE (2026-09-01, pre-staging remediation pass):** R1, R2 and R3 below are now **implemented and
tested** (DPIA §16). This is an engineering-blockers update, **not** a legal conclusion that the balancing
test now passes outright — see the revised §3.6. R5 remains open and is not something engineering work
can close.

- **R2 — ✅ FIXED.** Discovery rejection is now durable: `upsert_discovery_candidate` refuses to reopen a
  terminal candidate, and the runtime now routes through it exclusively (`service_role` holds no direct
  table privilege at all). A venue operator's objection, expressed by a human admin rejecting a discovered
  candidate, now survives every subsequent rediscovery. See DPIA §5.3.
- **R3 — ✅ FIXED.** A durable, server-side suppression mechanism (`venue_enrichment_suppressions`) now
  exists, enforced inside `propose_field`, `auto_apply_field_proposal` and `upsert_discovery_candidate` —
  none of which branch on caller role. A corrected/blanked field, once suppressed, is no longer
  re-proposed by the next crawl. See DPIA §10.1.
- **R1 — ✅ FIXED.** The `opening_hours` overwrite gap (a data-integrity issue, not personal-data-specific,
  but one that increased the "negative impact" side of this balance for every venue) is closed. See DPIA
  §4.3.
- **R5 (no privacy notice) — STILL OPEN.** The balancing test assumes the data subject would, if asked,
  find the processing broadly within expectation; that assumption remains untested because **no notice
  has ever been given** to any enriched venue. This is unchanged by R1/R2/R3 — none of them give a venue
  operator a way to know they were enriched in the first place, only a way for an *admin who already
  knows about a complaint* to make the objection stick. **This LIA remains provisional until R5 is
  delivered**, and, ideally, until PlayPlanner has evidence (even informal) that the assumption holds.

### 3.6 Result of the balancing test

**UPDATE (2026-09-01):** condition (a) below is now met. Condition (b) is not. The overall result is
therefore **still a conditional pass, not an unconditional one** — one of the two preconditions closing
does not discharge the other.

For the specific processing this DPIA/LIA pair describes — narrow, fact-only, fill-if-empty field
completion; discovery limited to human-gated quarantine; closure limited to an internal, non-public flag;
robots/SSRF/throttle-respecting collection; immutable audit trail — PlayPlanner's interest is capable of
outweighing the impact on a sole trader's personal data, **provided**:
(a) ✅ **R2 and R3 are implemented so an objection or correction is actually durable** — done, 2026-09-01,
tested (DPIA §16, redline Parts H/J/L); and
(b) ⬜ **R5 (a public enrichment notice, plus Art. 14 individual notice where reasonably practicable) is
delivered** so the "reasonable expectation" limb of this test is not merely asserted but supported by an
actual, checkable notice — **not done.**

**Until (b) is also true, this legitimate-interests basis should still not be relied upon for live
processing of personal data.** This is consistent with — and remains the lawful-basis-side justification
for — the DPIA's overall verdict staying short of PASS even though its engineering blockers R1/R2/R3/R4
(mechanism)/R6 are now resolved (DPIA §16, §17).

---

## 4. What this LIA does not decide

- **It does not decide Article 14 timing/content or the disproportionate-effort exception.** See DPIA §9;
  that is a distinct obligation that exists even where Art. 6(1)(f) is the correct lawful basis, and it is
  marked `LEGAL/OWNER DECISION REQUIRED` there, not here.
- **It does not decide Article 22A/DUAA questions.** See DPIA §11; a positive legitimate-interests balance
  for the *lawful basis* of publishing a fact says nothing about whether the *process that decided to
  publish it* engages the automated-decision-making regime. Both must be satisfied independently.
- **It does not extend to any future repurposing** of enriched contact data (marketing, lead-gen, resale,
  analytics). Any such use requires a fresh Art. 6(1)(f) assessment (most likely failing it) or a different
  lawful basis entirely (most likely consent, which is not realistic to obtain from a data subject who does
  not know they are in the system).
- **It does not cover ordinary business data.** For venues that are not sole traders, this LIA is
  informative context only — UK GDPR does not apply to that processing in the first place.

## 5. Sign-off

- [ ] Reviewed against `docs/DPIA_website_enrichment_addendum.md` v2.1 for consistency of factual claims
- [x] R2 and R3 implementation confirmed (2026-09-01, redline Parts H/J/L) — required before this LIA is
      relied upon for live processing; now satisfied
- [ ] R5 (enrichment notice) confirmed published before this LIA is relied upon for live processing —
      still required, still open
- [ ] **Data-protection owner sign-off:** name __________ date __________
- [ ] **Legal review** by a qualified UK practitioner: name __________ date __________
