# Article 14 Venue Data Notice — PlayPlanner

# 🔴 DRAFT — NOT FOR SENDING

**The underlying policy is now OWNER-APPROVED (2026-09-04). The notice text and the send mechanism are
NOT.** This document remains `DRAFT — NOT FOR SENDING UNTIL OWNER/LEGAL APPROVAL` **for the notice content
and the delivery workflow specifically** — those require the actual notice-workflow build (§7) and final
legal review before any real send. **What IS decided:** the release-one policy (§3), the timing rule (§4),
the engineering safety rule (§5), and the notice strategy (§6). Deciding a policy is not the same as
building or sending it — nothing in this document has been sent to any real venue operator, no notice
workflow exists, and no production venue was contacted, crawled, or notified in the preparation of this
document.
**Date:** 2026-09-04 · Citation Correction pass (this pass), correcting one legal citation on top of the
Owner Sign-Off Recording pass and the original preparation pass, both same-day.
**Builds on, does not replace:** `docs/DPIA_website_enrichment_addendum.md` §9, `docs/LIA_venue_enrichment.md`
§3, and `docs/privacy/RETENTION_SCHEDULE.md` (retention periods for the same data). Where those documents
already established a fact, it is cited, not re-derived.
**Legal baseline used:** UK GDPR Art.14, current in-force text, verified against `legislation.gov.uk` (two
independent fetches, this pass) — see §2 for the full quotation of the current Art.14(5)(e)/(f)/(6)/(7) text
and its statutory basis (Data (Use and Access) Act 2025, s.77, in force 5 February 2026 per S.I. 2026/82
reg.2(i)). **The disproportionate-effort exception is cited as Art.14(5)(e) throughout this document as the
current, primary citation — not as a footnote to an obsolete "Art.14(5)(b)".** Former Art.14(5)(b) is
mentioned only once, in §2, purely to explain the legislative history.

**Document map:** §2–§8 are this pass's new decision-recording content, read first. Appendices A–D (renamed
from the preparation pass's §6–§10, content otherwise unchanged) carry the underlying analysis those
decisions were made against.

---

## 2. Article 14 owner decision — disproportionate-effort exception

**Citation corrected 2026-09-04 (Citation Correction pass).** Current UK law, verified against
`legislation.gov.uk` (two independent fetches this pass, both converging): the **Data (Use and Access) Act
2025, section 77**, commenced **5 February 2026** (S.I. 2026/82, reg.2(i)), amended UK GDPR Article 14(5)
and inserted new paragraphs (6) and (7). **The current, correct citation is Article 14(5)(e) — this document
now cites it as the primary, live reference throughout, not as a footnote to an obsolete number.**

PlayPlanner will **NOT** rely on the disproportionate-effort exception for Release One.

# `ARTICLE 14(5)(e) DISPROPORTIONATE-EFFORT RELIANCE: NOT APPROVED FOR RELEASE ONE`

*(This is the same underlying policy decision as before this correction — only the citation changed. The
exception used to be discussed under the shorthand "Article 14(5)(b)" earlier in this project's history and
in this document's own preparation pass; that number is now **former** Article 14(5)(b) and is not the
current law. It is mentioned below only to explain the legislative history, not as an operative citation.)*

### The current statutory text — Article 14(5), (6), (7)

- **Art.14(5)(e):** the Art.14(1)–(2) notice duty does not apply to the extent that "providing the
  information is impossible or would involve a disproportionate effort."
- **Art.14(5)(f):** or to the extent that the duty "is likely to render impossible or seriously impair the
  achievement of the objectives of" the processing.
- **Art.14(6), new by DUAA 2025 s.77:** "For the purposes of paragraph 5(e), whether providing the
  information would involve a disproportionate effort depends on, among other things, **the number of data
  subjects, the age of the personal data and any appropriate safeguards applied to the processing.**"
- **Art.14(7), new by DUAA 2025 s.77:** "A controller relying on paragraph 5(e) or (f) must take appropriate
  measures to protect the data subject's rights, freedoms and legitimate interests, **including by making
  the information available publicly.**" — this is a **new statutory safeguard duty**, not merely ICO
  guidance: reliance on (5)(e)/(f) now carries a *legal*, not just best-practice, obligation to do something
  like Appendix B Option B's layered public page, even where individual notice is not given for a specific
  record.

**This sharpens, and does not soften, the "NOT APPROVED" decision above.** Art.14(6)'s named factors (number
of data subjects, age of the data, existing safeguards) are exactly the factors Appendix B, Option C already
assessed as pointing against reliance for Release One's population — the amendment gives those factors
statutory force but does not change the underlying weighing. Art.14(7)'s new public-availability safeguard
duty is, in substance, already satisfied by the layered notice §6 approves regardless of this decision — so
this decision does not leave PlayPlanner short of what (7) would require even in a hypothetical future where
(5)(e)/(f) were relied on.

**Any future reliance requires, before activation:**
- Documented evidence against the **Art.14(6) factors specifically** (number of data subjects, age of the
  personal data, safeguards applied) — the specific figures in Appendix B's Option C table,
  `UNKNOWN — REQUIRES PRODUCTION QUERY` items resolved, not waved through.
- A DPIA analysis specific to the actual population being relied on the exception for (not a general
  restatement of the existing enrichment DPIA).
- Documented safeguards, over and above what already exists, sufficient to satisfy Art.14(7)'s duty, not
  merely to look reasonable.
- **External legal review before activation** — this document's own "WEAK" assessment (Appendix B, Option
  C) is not a legal opinion, and does not become one by being restated here.

This decision closes the question for Release One. It does not close it permanently — a future release with
different facts (a much larger directory, a population with materially fewer reachable contacts) could
revisit it, subject to the same four preconditions.

---

## 3. Release-One Article 14 policy — APPROVED

**Approved, privacy-conservative, as Liam directed.** This replaces Appendix B's "recommended" framing —
the same policy, now decided.

### Non-personal venue facts

**May proceed through the existing enrichment safeguards, unchanged.** Examples of genuinely non-personal
facts: opening hours, generic venue attributes, price range, non-personal website/booking URLs, rewritten
factual descriptions, other objective venue facts. **Do not treat every business fact as personal data** —
most of the directory is not, and treating it as if it were would make enrichment unusable for no privacy
benefit.

### Clearly generic organisational contact data

**May only be treated as non-personal where that conclusion is reasonably supportable.** Do not assume every
`info@` address, business telephone number, or venue trading name is non-personal where the venue may be a
sole trader — this is Appendix A category B's known margin case, and the sole-trader signal (below) exists
specifically to catch it rather than let a keyword-level "looks generic" assumption wave it through.

### Likely personal / sole-trader data

At minimum, the following **must NOT be autonomously published**:
- A named proprietor/contact (Appendix A category D).
- A `firstname.lastname@` or otherwise personal-pattern email (category E).
- A personal email of any other identifiable form.
- A mobile/personal phone number presented as the primary contact route (category F).
- Other sole-trader-identifying contact data.
- Any other data clearly relating to an identifiable natural person.

**Named natural-person contacts: `NEVER AUTO-PUBLISH`.** No confidence score, no source-tier ranking, and no
"it was already public" reasoning overrides this — the same rule Appendix B's original release-one policy
already stated (there, as point 4); this section confirms it as approved, unconditional policy rather than
a recommendation.

**Operational mechanism (sole-trader signal), unchanged from Appendix B's original heuristic:** category
detected as a small independent business type (not a franchise/chain/local-authority facility) **AND**
(business name matches a personal-name pattern, **OR** proposed contact value is a mobile-format number,
**OR** proposed email is a `firstname.lastname@`/`firstname@` pattern). Tuned to over-flag, deliberately —
a false positive costs a human review; a false negative is the actual risk this policy exists to prevent.

---

## 4. Critical Article 14 timing correction

**This corrects the previous framing in Appendix B (point 7 of the original release-one policy), which said
notice can be sent "when a human approves the quarantined record." That is unsafe and is withdrawn.**

**Why it was wrong:** approval timing is an internal workflow event PlayPlanner controls. The Article 14
clock is not keyed to it. **The clock starts when PlayPlanner obtains the personal data** — i.e. when the
enrichment pipeline scrapes and writes the candidate/proposal row — not when a human later gets round to
reviewing it. If a record sits in quarantine for six weeks before a reviewer looks at it, the Article 14
deadline has already passed regardless of whether anything was published.

**Corrected workflow requirement — every likely-personal-data record must track:**

| Field | Meaning |
|---|---|
| `obtained_at` | When PlayPlanner's pipeline first collected this personal data (write time of the candidate/proposal row) |
| `article14_notice_due_at` | `obtained_at` + a period **no later than one month**, subject to being brought forward by an earlier statutory trigger |

**Earlier triggers that can bring the deadline forward, per Art.14(3):**
- **First communication with the data subject**, if that happens before one month is up (e.g. PlayPlanner
  emails a venue about an unrelated matter before the record would otherwise be due for notice) — notice
  must go with, or before, that communication.
- **First disclosure to another recipient**, if earlier — for PlayPlanner, "recipient" includes its own app
  users once the fact goes live on a public venue page. **If a human approves and publishes a quarantined
  record before the one-month `article14_notice_due_at`, notice must be sent before that publication where
  Article 14 requires the earlier timing** — i.e. early approval does not grant extra time; if anything, it
  can shorten the effective deadline to the point of publication.

**If the record remains quarantined, unreviewed, past one month:** the Article 14 deadline still exists and
has been missed. **Quarantine does NOT pause the Article 14 clock.** A record cannot be left in limbo
indefinitely on the theory that "it hasn't been published yet, so there's no rush" — the obligation attaches
at collection, not at publication. See §5 and §8 for the engineering consequence of this.

---

## 5. Release-one engineering safety rule

**Until an operational Article 14 notice workflow exists (§7):**

# `DO NOT ENABLE REAL-DATA AUTOMATED ENRICHMENT THAT RETAINS LIKELY PERSONAL CONTACT DATA BEYOND A SAFE PRE-NOTICE REVIEW WINDOW`

**Choose one of:**

**Option A — detect and discard.** For Release One, likely-personal contact data (the sole-trader signal in
§3) is detected at collection time and **not ingested/retained at all** — the pipeline observes that a field
looks like a natural person's contact detail and simply does not write it to `venue_field_proposals`/
`venue_discovery_candidates`, logging only that a personal-data-shaped field was skipped (a non-personal
fact about the pipeline's own behaviour, not the individual). Simplest to build, no deadline-tracking
machinery needed, but discards data that a fully-built notice workflow could otherwise have used.

**Option B — short quarantine with guaranteed human handling before the Article 14 deadline.** The data is
retained, quarantined per §3, but the workflow in §7 **guarantees** (not merely intends) that every
quarantined likely-personal record is either notice-sent-and-resolved or force-escalated to a human well
before `article14_notice_due_at` — requires the full queue/deadline-guard machinery in §7–§8 to exist and be
operating correctly before any real data flows through this path.

**This document does not pick between A and B — that remains Liam's call, informed by how much of the
directory the sole-trader signal is expected to catch (currently `UNKNOWN — REQUIRES PRODUCTION QUERY`,
same gap as Appendix B, Option C's evidence table).** What is decided is the constraint both options must
satisfy: **no personal-data backlog whose Article 14 deadlines cannot be met is permitted.** For any record
that is retained under Option B, a deadline safety mechanism (§8) must exist so a record cannot quietly
remain past its due date with nobody accountable for it.

---

## 6. Article 14 notice strategy — APPROVED

# `INDIVIDUAL NOTICE + LAYERED PUBLIC TRANSPARENCY`

**Not passive website notice alone** — Appendix B, Option B already established that putting information on
a page nobody is directed to does not satisfy Article 14 on its own; that finding stands and is the reason
this decision combines both rather than choosing one.

### Architecture — four layers

**Layer 1 — main PlayPlanner privacy notice.** A short paragraph (added only once enrichment actually goes
live — see Appendix D) explaining, in general terms, that some venue information is sourced automatically
from public listings.

**Layer 2 — dedicated Venue Data / Public Sources privacy page.** The full Article 14 information (Appendix
C's draft content), published as its own page, focused on the actual affected population (venue operators)
rather than buried in the consumer-facing policy.

**Layer 3 — individual Article 14 notice.** Sent to affected identifiable natural persons where required —
i.e. the category C–F population from Appendix A, on the timing rule in §4, through the workflow in §7.

**Layer 4 — just-in-time links.** Surfaced from the venue-owner claim/correction/objection flow and from
each enriched venue's own listing page, pointing to Layer 2 — this is what makes Layer 2 "actively made
aware" rather than a page nobody finds (Appendix B, Option B's "active awareness" requirement).

**The dedicated public page (Layer 2) is a complement to individual notice (Layer 3), never a substitute for
it where individual notice is required.** Layers 1, 2 and 4 apply to the whole enriched population
regardless of category; Layer 3 applies specifically where Article 14 requires it and is not satisfied by
the other three alone.

---

## 7. Notice delivery specification — design only, nothing built or sent

**This is a specification for future engineering work. No queue, table, or send mechanism exists yet. This
section does not send anything and is not itself an implementation.**

**⚠️ This is a privacy/compliance communication, not a marketing system.** No promotional language, no
engagement optimisation, no "re-engagement" sends, no unsubscribe-and-suppress-as-a-marketing-preference
model — an Article 14 notice is a legal disclosure obligation to a specific individual about specific
personal data PlayPlanner holds about them, not an opt-in relationship to cultivate. The design below
reflects that throughout.

### Proposed queue record shape

| Field | Purpose |
|---|---|
| `record_id` | The `venue_field_proposals`/`venue_discovery_candidates` row this notice concerns |
| `obtained_at` | When the personal data was collected (§4) |
| `notice_due_at` | `obtained_at` + ≤1 month, or an earlier statutory trigger date if one applies (§4) |
| `notice_sent_at` | When notice was actually dispatched — **null does not mean "not required," it means "not yet sent"** |
| `delivery_channel` | e.g. email |
| `delivery_address` | The specific contact point notice was sent to (itself personal data — subject to its own minimal retention, not addressed further in this design-only spec) |
| `delivery_result` | Sent / bounced / rejected / no valid address found |
| `retry_state` | Attempt count, next retry time, backoff — bounded, not infinite |
| `notice_version` | Which version of the notice text (Appendix C) was sent — notices are not silently edited after sending without the version being tracked |
| `source` | Which provider/pipeline produced the personal data this notice concerns (`osm`/`geoapify`/own-site scrape) |
| `fields_categories` | Which Appendix A categories/fields this specific notice covers (a record could involve more than one) |
| `objection_correction_link` | The specific, working route the recipient can use to object or correct — not a generic "contact us," but a link/reference tied to this record |
| `suppression_integration` | Whether an objection received against this record has been translated into a `venue_enrichment_suppressions` row (§8 makes this mandatory, not optional) |

### What this specification deliberately does not include

A "campaign," a subject-line A/B test, a send-time-optimisation feature, or any field implying the recipient
is being marketed to. If a future build accidentally reaches for marketing-email infrastructure to implement
this, that is the wrong tool — a compliance notice queue and a marketing queue should not share
infrastructure, list-management concepts, or unsubscribe semantics (an Article 14 objection is a
`venue_enrichment_suppressions` event, not a marketing-list opt-out).

---

## 8. Article 14 deadline guards — fail-closed specification

**Design only. No implementation in this pass.**

- **Likely-personal data cannot be publicly published before required Article 14 handling.** A record
  flagged by the sole-trader signal (§3) must be blocked from the auto-apply/publish path structurally
  (a database constraint or equivalent gate), not merely by convention — the same "structural, not
  conventional" principle the existing DPIA already applies to new-venue publication and closure
  confirmation.
- **Overdue-notice records cannot progress through autonomous publication.** If `notice_due_at` has passed
  without a corresponding `notice_sent_at`, the record must not be eligible for any automated action that
  would disclose it further — it should be forced into a human-attention state, not silently held in the
  same quarantine it was already in.
- **Failure to send does not silently count as notice.** A `delivery_result` of "bounced"/"rejected"/"no
  valid address" must not be treated as equivalent to "notice given" anywhere in the workflow — the absence
  of a bounce is not proof of delivery either, and the deadline guard logic must treat "unconfirmed" as
  "not yet satisfied," not optimistically as "probably fine."
- **Permanent delivery failure routes to human review**, not to silent abandonment or to publication as if
  notice had succeeded. A record that cannot be notified (no reachable address at all) is exactly the
  scenario Appendix B's Option C (disproportionate effort) was built to assess — routing it to a human means
  someone actually applies that assessment to the specific record, rather than the system assuming an
  outcome.
- **Objections immediately invoke suppression.** Any objection received against a record (via the
  objection/correction link in §7, or by any other route) must create or update the corresponding
  `venue_enrichment_suppressions` row **before** any further automated processing of that field/venue/source
  can occur — no processing window between "objection received" and "suppression active."
- **Correction requests prevent stale value from being re-enriched.** A correction is not just a one-time
  fix to the current value — it must also register (via suppression or an equivalent mechanism) that the
  *old*, now-corrected value should not be silently reintroduced by a future crawl finding the same stale
  fact at the original source.

---

## Appendix A: The actual data subject population *(unchanged from the preparation pass — was §6)*

**Do not assume every venue row is personal data.** Estimated from schema/field characteristics, without
querying production (per instructions) — this is a categorisation framework, not a headcount.

| Category | Description | Personal data? | Article 14 applies? |
|---|---|---|---|
| **A. Ordinary incorporated-company / generic venue facts** | Name, address, opening hours, category of a limited company, local authority facility, national chain, etc. | ❌ No — a company is not a natural person | No |
| **B. Generic business contact details** | `info@`, `hello@`, `enquiries@`, a generic switchboard number, a company-branded website | ❌ Generally no, even for a sole trader, if the address/number is genuinely generic and not personally identifying (e.g. `bookings@thefarmshop.co.uk`) | No, or `LEGAL ADVICE RECOMMENDED` at the margin — a generic-looking address can still be personal data if it is in practice a single sole trader's only inbox |
| **C. Sole-trader business details that identify a natural person** | A business name that is itself the trader's own name, or contact details clearly tied to one identifiable individual running the business | ✅ Yes | **Yes** |
| **D. Named proprietor/contact-person details** | "Contact: Jane Smith" on a venue's own website, an "About the owner" page | ✅ Yes, directly | **Yes** |
| **E. Personal business email such as `firstname.lastname@`** | `jane.smith@littleplaygroup.co.uk` | ✅ Yes | **Yes** |
| **F. Personal/mobile phone number** | A mobile number given as the primary contact route, especially for a sole trader with no landline/office | ✅ Yes | **Yes** |
| **G. Data about closure/status that could relate to a sole trader** | An automated "suspected closed" signal, or a confirmed-closure decision, where the "business" and "the person" are functionally the same entity | ✅ Yes, when it is | **Yes** — and see the DPIA's separate, stricter human-only-confirmation safeguard for this exact reason |
| **H. Purely non-personal venue facts** | Postcode, latitude/longitude, category, price range, facility flags (toilets/parking/baby-change) | ❌ No | No |

### Which sources create the highest Article 14 risk

- **`venue_discovery_candidates` (new-venue discovery from Geoapify/OSM):** highest risk category — these
  are places PlayPlanner has **never had any relationship with**, discovered entirely from third-party data.
  Per `docs/LIA_venue_enrichment.md` §3.1, this is "the single fact that drives the Article 14 analysis" —
  a venue that has never engaged with PlayPlanner has no reason to expect its details (and, if it is a sole
  trader, the operator's own contact details) to appear in a directory it has never heard of.
- **`venue_field_proposals`/`venue_enrichment_writes` for existing venues:** lower risk *for auto-apply
  purposes* than discovery, because the venue is already in the directory and fill-if-empty means only
  facts the venue itself already published are ever added — but the *individual's* Article 14 rights are
  the same regardless of whether the venue was previously listed; existing listing does not itself satisfy
  Article 14 for a newly-added personal contact field.
- **`venue_closure_signals`/`venue_operating_status_events` for sole traders (category G):** a distinct,
  narrower risk — not about contact data, but about a status claim ("closed") being published about an
  identifiable individual's livelihood without their direct involvement. This is why the DPIA already
  requires a human to confirm any closure, never automation alone.

### Which fields should never auto-apply without stronger safeguards

**Recommendation, feeding directly into §3's approved release-one policy:** `phone` and `email` fields should never
auto-apply for a venue whose category/name pattern suggests a sole trader (category C/D/E/F above) without
either (a) Article 14 notice already having been given for that specific record, or (b) the field being
manually reviewed by a human who can make the category C-vs-B judgement call a keyword rule cannot reliably
make. **`description`, `booking_url`, `price_range`, `opening_hours` for a venue that is clearly not a sole
trader (a leisure centre, a museum, a national chain) carry materially lower Article 14 risk** and are
already excluded from full automation or auto-applied narrowly, per the DPIA's existing safeguards — this
document does not propose loosening those.

---

## Appendix B: Notice approach — three options assessed *(unchanged from the preparation pass — was §7; §6 above records the decision this analysis fed into)*

### Option A — Individual notice

**Mechanism:** email/contact the venue proprietor directly where a reachable contact exists; give full
Article 14 information; explain source/category/purpose/lawful basis; provide a correction/objection route.

**Assessment:**
- **Operational cost:** moderate-to-high per record — requires a real send pipeline, a template, a
  deliverability strategy (SPF/DKIM, bounce handling), and a route for replies (which itself creates new
  processing — see below).
- **Email deliverability:** unverified — no assessment of actual open/deliverability rates for scraped
  business addresses exists; `UNKNOWN — REQUIRES A SMALL PILOT TO ESTIMATE`, not assumed.
- **Volume:** `docs/LIA_venue_enrichment.md` §9 (Art.14 discussion) describes the directory as "in the low
  thousands" — a volume where individual notice is **operationally feasible**, unlike the web-scale
  scraping scenarios ICO guidance usually discusses the disproportionate-effort exception against. This
  materially weakens any future argument that individual notice is too costly to attempt at all.
- **Risk of nuisance/confusion:** real — an unsolicited "we've listed your business" email from a service
  the recipient has never heard of can read as spam, a scam, or a data-broker approach, and may itself
  generate complaints if not carefully worded. The draft notice in §9 is written with this risk in mind
  (plain, low-pressure, clearly names the source and gives an easy opt-out).
- **Does notice itself create additional data processing?** Yes — sending an email requires processing the
  recipient's email address for that purpose, and any reply-handling creates a support-style processing
  activity that does not currently exist in this project's stores (see `RETENTION_SCHEDULE.md` §1.3's
  `pass_interest` entry for the closest existing analogue, which is not fit for this purpose as-is).

**Verdict:** feasible for the population size involved, but not a "flip a switch" option — it requires new
operational tooling and a support-reply path that does not exist today.

### Option B — Layered / public notice + active awareness

**Mechanism:** a dedicated Venue Data / Public Sources privacy page, linked prominently from venue pages and
the owner-claim flow, plus just-in-time disclosure where practical (e.g. a small "Where this information
comes from" note visible on a venue's own page).

**Be precise, as instructed:** **putting information on a website alone does not satisfy Article 14.** ICO
guidance is explicit that a controller must **actively provide** privacy information or **actively make
individuals aware of it** — passive publication that a data subject would have to go looking for, without
any indication they should, does not discharge the Art.14(1)–(2) duty on its own. A dedicated page that
nobody is ever pointed to is not "layered notice," it is "notice that technically exists and that no
affected individual will ever encounter."

**What DOES make this option genuinely "active," and therefore worth combining with something else:**
- A visible, plain-language note **on every enriched venue's own public page** ("Some information on this
  page was sourced automatically from public listings — see how" with a link) is closer to active
  awareness than a footer link, because it appears at the exact point a data subject (searching for their
  own business, as people commonly do) would encounter it.
- Prominent linking from the **owner-claim flow** specifically reaches the one moment a real operator is
  most likely to be actively engaging with their own listing — this is a strong, low-cost complement to
  Option A, not a substitute for it.

**Verdict:** **necessary but not sufficient on its own.** Recommend as a permanent, always-on layer
regardless of which other option is chosen — see §3 (approved policy) and §6 (approved notice strategy, Layer 2/4).

### Option C — Disproportionate-effort exception (Art.14(5)(e))

**Assessment against the evidence factors, built rather than asserted:**

| Factor | Assessment |
|---|---|
| Number of affected data subjects | Low thousands (directory-wide), and materially smaller once category A/B/H (non-personal) rows are excluded — likely a few hundred sole-trader-category records, not thousands, though `UNKNOWN — REQUIRES PRODUCTION QUERY` for an exact figure |
| Number with contact details readily available | Likely high, for the subset that is personal data at all — by definition, a sole trader's business needs a way for customers to reach them, so a reachable address commonly exists precisely where Article 14 risk is highest |
| Cost/time of notification | Moderate, not prohibitive, for a population this size (Option A, above) |
| Sensitivity of the personal data | Low (ordinary business contact details, not special category) |
| Source already being deliberately public | Yes — the venue published it on its own website for the purpose of being found by customers |
| Reasonable expectations | Mixed — see `LIA_venue_enrichment.md` §3.1: closer to reasonable for an *existing, previously-engaged* venue; further from reasonable for a *never-engaged, freshly-discovered* venue, which is exactly the population where notice matters most |
| Risk of harm | Low-to-moderate — unwanted contact volume and an incorrect auto-applied fact are the realistic harms, not anything approaching special-category-level risk |
| Safeguards | Meaningful ones already exist or are proposed: fill-if-empty, human-only new-venue publication, human-only closure confirmation, durable suppression (see `RETENTION_SCHEDULE.md` §5) |
| Can public notice compensate? | Partially (Option B, above), but not fully, per the "active awareness" requirement above |
| Are sole traders particularly identifiable/reachable? | Yes — by definition, more identifiable and more reachable than a large organisation's generic contact, which cuts *against* relying on the exception for exactly this subpopulation |
| Are records published to users? | Yes, prominently — the data is shown to every app user searching for that venue, which raises (not lowers) the case for transparency to the subject |
| Documentation/DPIA requirement | Already substantially underway (`DPIA_website_enrichment_addendum.md`, `LIA_venue_enrichment.md`); this document and `RETENTION_SCHEDULE.md` extend it further |

# `WEAK`

**Reasoning:** the exception is not implausible in the abstract, but the specific facts here point against
relying on it for the general population — a directory "in the low thousands" with commonly-available
contact routes is the opposite of the web-scale scenario the exception is usually invoked for, and the
population where the exception would matter most (freshly-discovered, never-engaged sole traders) is
precisely the population with the **weakest** reasonable-expectation and **highest** identifiability
factors. **`LEGAL REVIEW REQUIRED` before relying on this for any subset, even a narrow one** — this
document does not approve the exception, and per instructions, is not treating the assessment as compelling
enough to approve internally.

---

## Appendix B (continued): Original release-one policy recommendation *(superseded by §3 above, which is now the approved policy — was §8, kept for the reasoning trail; §3 is the operative version)*

**Preference is privacy-conservative, as instructed.** Recommended concrete rule (as originally drafted):

1. **Category A/B/H data (non-personal venue facts, generic contact details) — automated enrichment may
   process this under legitimate interests, as it does today (subject to the existing DPIA safeguards).**
   No Article 14 individual-notice precondition, since it is not personal data (A/H) or presents the
   weakest personal-data case (B).
2. **Category C/D/E/F data (likely natural-person/sole-trader contact data) — quarantined, manual-review-only,
   until Article 14 handling is resolved for that record.** Concretely: a proposed `phone`/`email`/`description`
   field value that matches a sole-trader signal (see below) is written to `venue_field_proposals` with
   `status = 'pending'` as today, but is **excluded from any current or future auto-apply path** regardless
   of confidence score, and is flagged for a human reviewer who can apply the Article 14 gate (has notice
   been given for this venue? is it a category the layered notice/individual notice already covers?) before
   approving.
3. **Objection/correction suppression is always honoured**, unconditionally — already the case per
   `RETENTION_SCHEDULE.md` §5's confirmation that no purge function ever touches suppression records, and
   this document adds nothing new here.
4. **No human-named contact is auto-published merely because it appears publicly.** A named proprietor
   (category D) or a `firstname.lastname@` address (category E) found on a venue's own site is **never**
   auto-applied, full stop, regardless of source confidence — it always routes to the manual-review queue
   in (2), because the identifying element itself (not just "is this fact correct") is the thing Article 14
   governs.
5. **Sole-trader signal, for triage purposes (not a legal test, an operational heuristic):** category
   detected as a small independent business type (not a franchise/chain/local-authority facility) **AND**
   (business name matches a personal-name pattern, **OR** proposed contact value is a mobile-format number,
   **OR** proposed email is a `firstname.lastname@`/`firstname@` pattern). A heuristic will both over- and
   under-flag — that is acceptable and intentional for a release-one policy that is meant to be
   conservative; a false positive costs a human review, a false negative is the actual risk this rule exists
   to reduce, so the heuristic should be tuned to over-flag rather than under-flag.
6. **The layered public notice (Appendix B Option B, now §6's Layers 1/2/4) is always-on for every enriched venue, regardless of category** —
   cheap, always correct to have, and narrows (without eliminating) the transparency gap for the categories
   that don't get individual notice under this release-one policy.
7. ~~**Individual notice (§7A) is sent for category C–F records specifically, at the point a human reviewer
   approves the record for publication**~~ — **🔴 WITHDRAWN, 2026-09-04 — see §4 above.** This point keyed
   the notice deadline to human approval timing, which is unsafe: the Article 14 clock starts at
   `obtained_at` (collection), not at approval, and can require notice well before any human reviews the
   record at all. §4's `obtained_at`/`notice_due_at` tracking replaces this point entirely — read §4, not
   this line, for the operative timing rule.

**Why this doesn't make enrichment unusable:** the overwhelming majority of venue rows (leisure centres,
museums, chains, local-authority facilities — category A/H, and most of category B) are entirely
unaffected and continue through the existing automated pipeline unchanged. Only the genuinely
personal-data-bearing subset is slowed down, and only until the one-time individual-notice step for that
specific record has happened — after which it behaves like any other approved fact.

---

## Appendix C: Draft Article 14 venue-data notice content *(unchanged from the preparation pass — was §9; this is the notice text §7's queue would eventually send, still draft, still not for sending)*

**🔴 DRAFT TEXT ONLY — NOT SENT, NOT APPROVED, NOT LINKED FROM ANY LIVE PAGE.** Plain English, covering
every element Art.14(1)–(2) requires.

> ### How PlayPlanner sources some venue information
>
> **Who we are.** PlayPlanner is run by Liam Evanson, trading as PlayPlanner, based in the United Kingdom.
> If you have any questions about this notice, contact `privacy@playplanner.app`.
>
> **Why you're seeing this.** Some of the information on your venue's PlayPlanner listing — such as opening
> hours, a contact number, or a website link — was added automatically from information your business has
> already published, such as your own website. We're telling you this because UK data protection law
> requires us to, whenever we hold information about a person that we didn't get directly from them.
>
> **What we collected.** [Populated per-record — e.g.: "your business's phone number, as published on
> `[source URL]`, on `[date]`."]
>
> **Where it came from.** Publicly available information already published by your business on its own
> website, or via a third-party places-data provider that aggregates such public listings (Geoapify,
> drawing in part on OpenStreetMap). We did not obtain this from you directly, and we did not obtain it from
> any private or non-public source.
>
> **Why we do this.** To keep venue listings in our directory accurate and useful for parents looking for
> family activities. We rely on our **legitimate interests** in running an accurate, useful directory — not
> your consent, and not a contract with you. We only ever add facts your business has already chosen to
> publish; we don't invent or guess information about you.
>
> **What we don't do.** We don't use this information for advertising, don't sell it, and don't share it
> with anyone except to run the directory service itself (see "Who else sees this," below).
>
> **Who else sees this.** The information appears on your venue's public PlayPlanner listing, visible to
> app users. Our hosting/database provider (Supabase, UK-hosted) processes it on our behalf as required to
> run the service — see our main privacy policy for the full list of providers.
>
> **International transfers.** [Populated per-record if applicable — for most records: "This information is
> stored on UK servers; no international transfer of this specific data occurs."]
>
> **How long we keep it.** See our retention schedule summary at `[link]` — in short: proposed information
> that we decide not to use is deleted or stripped of identifying detail within a matter of weeks to months;
> information we do use to update your listing is kept, together with a record of where it came from, for
> as long as your listing needs it, with the underlying evidence minimised after a fixed period.
>
> **Automated decisions.** No decision about you or your business is made by a computer alone without a
> person able to review it — see our full enrichment privacy notes at `[link]` for the specific safeguards
> (a human always approves publishing a brand-new venue, and a human always confirms if we ever mark a
> venue as closed).
>
> **Your rights.** You can ask us to:
> - **Correct** any information about your business that's wrong.
> - **Object** to us using information from a public source about your business — if you object, we will
>   stop, and we will not re-collect the same information again even if a future update to our sources
>   would otherwise surface it.
> - **See a copy** of what we hold about your business.
> - **Ask us to delete** information we hold, where it applies.
>
> To exercise any of these, email `privacy@playplanner.app`. We'll respond without undue delay and within
> one month.
>
> **If you're not satisfied**, you can complain to the Information Commissioner's Office: `ico.org.uk` or
> 0303 123 1113.

---

## Appendix D: Website/app transparency implementation plan *(unchanged from the preparation pass — was §10; §6 above is the decided version of the layered structure this plan describes)*

**Reviewed, not edited this pass** (per instructions — no factual contradiction was found requiring an
immediate fix): `docs/privacy.html` and `app/(auth)/privacy.tsx` currently contain **no mention of
enrichment, public-source venue data, or third-party data providers at all** — confirmed again this
session, consistent with `PRIVACY_NOTICE_GAP_ANALYSIS.md` gap 1, which already flagged this as the single
largest gap in the main notice. This is not a contradiction to fix (there is nothing false being said,
since enrichment is not live) — it is an absence, and absences are correctly out of scope for a
"factual contradiction" edit.

### Recommended structure: layered, not single-document

**Neither "cram it into the main policy" nor "one obscure standalone page" is right.** Recommend:

1. **A short, permanent paragraph in the main privacy notice** (`docs/privacy.html` / `app/(auth)/privacy.tsx`),
   added **only once enrichment actually goes live** (adding it now, while the feature is blocked, would
   itself be a minor inaccuracy — describing a live practice that isn't). The paragraph should: name that
   some venue information is sourced automatically from public listings, name the source categories
   (venues' own websites; Geoapify/OpenStreetMap), state the legitimate-interests basis in one sentence, and
   link to (2).
2. **A dedicated `ARTICLE_14_VENUE_DATA_NOTICE`-derived public page** (the venue-facing content in §9,
   published as an actual page, not this internal draft file) — this is where the full detail lives, kept
   separate from the main consumer-facing privacy policy so that (a) parents using the app aren't shown
   enrichment mechanics irrelevant to them, and (b) venue operators specifically looking for this
   information find a focused, complete answer rather than a paragraph buried in a long consumer notice.
3. **Just-in-time, on-page disclosure** (Appendix B Option B; now §6's Layer 4) linking to (2) from every enriched venue's own listing page
   and from the owner-claim flow — this is the "active awareness" layer that makes (2) more than a page
   nobody finds.

**This is "both, layered," not "either/or"** — the main policy's short paragraph satisfies the general
transparency expectation every user reasonably has; the dedicated page satisfies Article 14's specific
content requirements for the actual affected population (venue operators); the on-page link satisfies the
"actively made aware" standard for the individuals Article 14 exists to protect. **None of this is built or
linked in this pass** — it is a plan, contingent on enrichment being unblocked in the first place.
