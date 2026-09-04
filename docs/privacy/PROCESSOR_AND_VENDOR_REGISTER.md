# Processor and Third-Party Vendor Register — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01, **substantially revised 2026-09-02** (Processor + International Transfer
Verification Pass) · Includes the Article 28 processor-contract audit (Liam's §5) as a column set
rather than a separate document, since every row needs the same assessment.

> **What changed on 2026-09-02.** The vendor rows were checked against the vendors' **own current
> published terms** for the first time, rather than against the 2026-06-08 DPIA's inherited assumptions.
> Three things moved:
> 1. **Google Maps was misclassified as a processor. It is an independent controller** — so Article 28 is
>    the wrong instrument for it entirely, and the claim that Google receives "only viewport/bounds, not
>    the user's position" was false in both halves.
> 2. **Supabase and Stripe firmed up** from "DPA exists — check acceptance" to **verified auto-incorporated
>    DPAs**. Chasing an "acceptance status" for either was a category error.
 > 3. **Expo's two questions were separated.** Its **transfer** position is *plausible* (it publicly claims
>    UK Extension DPF self-certification); its **Article 28** position is *unresolved* on specific,
>    identified grounds. These are different questions and must not be merged.
>
> Where a vendor's own document could not be read end-to-end, or the authoritative register was
> unfetchable (the DPF list), that is stated as a limit — **not** smoothed over.

> **Further corrections, 2026-09-02 (Vendor Compliance Correction Pass) — two of my own earlier findings
> were wrong and are withdrawn:**
> - **Supabase region is CONFIRMED: `eu-west-2` = LONDON, UNITED KINGDOM** (owner-checked). Not "unknown",
>   and not Ireland. The old DPIA's *"eu-west-2 Ireland"* was wrong on the label as well as unverified —
>   in AWS, `eu-west-1` is Ireland and `eu-west-2` is London.
> - **"Expo: EU SCCs only — no UK mechanism exists" was an OVERSTATEMENT and is withdrawn.** It was drawn
>   from the Terms of Service alone; Expo's **Privacy Policy** does claim **UK Extension** DPF
>   self-certification. The correct position is that participation is *stated but unverified*, pending the
>   official DPF list. **Never record `UK TRANSFER BLOCKED` without that register check.**
> - Likewise **Stripe's DTA §5** is no longer treated as an unresolved legal mechanism: Stripe's official
>   DPA FAQ independently confirms incorporation (see §2).
**Method:** every vendor below was confirmed as a real integration by direct code/config inspection this
session (`package.json`, `supabase/config.toml`, `eas.json`, `app.json`/`app.config.js`,
`supabase/functions/*`) — none are assumed from the privacy policy or from memory of past sessions.
**No DPA/hosting-region detail is invented** — where a fact isn't visible from the repo, it is marked
`UNKNOWN — MUST VERIFY`, not filled in with a plausible guess.

---

## How to read the Article 28 columns

- **PASS** — appropriate processor terms are confirmed in place and cover the required Art.28(3) content.
- **CONTRACT/DPA EXISTS — MANUAL ACCEPTANCE CHECK** — the vendor publishes a standard DPA that plausibly
  covers this, but nothing in the repo proves it has actually been accepted/executed for this account —
  someone needs to check the vendor's own dashboard/agreement status.
- **MISSING** — no evidence any processor agreement exists; this is a genuine gap.
- **UNKNOWN** — insufficient information to classify at all.

Two further states were added on 2026-09-02:

- **PUBLICLY VERIFIED — AUTO-INCORPORATED** — the vendor's own current terms incorporate the DPA by
  reference for every customer, so there is no separate acceptance artefact and none should be sought.
  (Supabase, Stripe.)
- **NOT APPLICABLE — CONTROLLER-TO-CONTROLLER** — the vendor is an independent controller, so Article 28
  does not govern the relationship at all. This is **not** a gap; it means the lawfulness question is a
  *disclosure* question (lawful basis + Art.13(1)(e) transparency) rather than a *contract* question.
  (Google Maps Platform.)

A **MISSING** classification for any vendor that actually receives personal data is a **production
blocker** per Liam's instruction. **None is MISSING.** Expo carries
**`OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED`** on Article 28 — a contract exists and asserts processor
status; what is unproven is whether its *content* meets Art.28(3) for the Push service (see §3a). That is
a weaker claim than MISSING, and deliberately so.

**Always keep these two apart** (collapsing them produced a wrong finding in an earlier draft):

- **Transfer mechanism** — is there a lawful route for the data to leave the UK? (adequacy, DPF, SCCs +
  UK Addendum, IDTA)
- **Article 28 processor contract** — does a binding contract contain the mandatory processor clauses?

**A DPF certification satisfies the first and does nothing at all for the second.**

---

## 1. Supabase — Postgres, Auth, Storage, Edge Functions

| | |
|---|---|
| **Relationship** | **Processor** — Supabase processes personal data on PlayPlanner's documented instructions (this is the textbook processor relationship; not in doubt) |
| **Personal data received** | Effectively all of it — this is the primary datastore (see `ROPA.md`, every row) |
| **Processing purpose** | Hosting, authentication, database, file storage, serverless functions |
| **Primary processing location** | ✅ **CONFIRMED BY OWNER 2026-09-02 — `eu-west-2`, i.e. LONDON, UNITED KINGDOM.** Liam checked the live Supabase project. **The primary database, Auth and Storage for this project sit in the UK.** ⚠️ **Note the old DPIA was wrong twice over:** it said *"eu-west-2 Ireland, confirmed in app config"* — the region string was never in the repo config, **and `eu-west-2` is not Ireland.** In AWS, `eu-west-1` is Ireland and **`eu-west-2` is London**. The corrected answer happens to be *stronger* (UK-domestic, no restricted transfer for the primary store at all), but it was reached by checking, not by the old guess being lucky. |
| **Scope limit on that fact — do not overstate it** | A UK **primary region** does **not** prove that every Supabase subprocessor, support function, telemetry/logging system, email service or control-plane operation stays in the UK. Supabase's DPA expressly permits authorised subprocessors and carries international-transfer safeguards precisely because some processing occurs elsewhere. **Onward-transfer analysis stays separate and stays open** — see `INTERNATIONAL_TRANSFERS.md`. |
| **Sub-processors** | **PUBLICLY VERIFIED 2026-09-02.** Published list at `supabase.com/legal/customer-resources/subprocessor-list`, **updated 1 June 2026** (24 entities incl. AWS, Google LLC, Cloudflare, Fly.io, Vercel, Upstash, Sentry, GitHub, OpenAI LLC). Note the current PDF publishes **no country column** — entity locations are not stated on the list itself. |
| **DPA/Art.28 terms** | ✅ **PUBLICLY VERIFIED — AUTOMATICALLY INCORPORATED, NO SIGNATURE REQUIRED.** DPA at `supabase.com/legal/customer-resources/data-processing-addendum`, **Version 1, 1 August 2026**. It: (a) *"supplements and forms part of the Supabase Terms of Service"*; (b) is effective from the Agreement's Effective Date; (c) treats **Supabase as processor/service provider where PlayPlanner is controller**; (d) incorporates **EU SCC Modules 2 and 3** as appropriate; (e) incorporates the **UK Addendum** where UK data protection law applies; (f) **defines UK GDPR within its GDPR definition**; (g) **imposes written protections on authorised subprocessors**. ToS §7(b): *"The Parties agree to comply with the Data Processing Addendum, which is incorporated into this Agreement."* DPA §12.2: *"acceptance of the Agreement shall have the same effect as signing the SCCs."* **This is the strongest Art.28 position of any vendor in this register**, and **"DPA acceptance" is NOT an owner checkbox** — current terms require no separate act. |
| **Deletion/return obligations** | Per DPA: on termination the customer has 30 days to request a copy, after which Supabase deletes covered data. |
| **Security terms** | DPA specifies technical/organisational measures incl. AES-256 encryption, least-privilege access, daily backups, third-party penetration testing; incident notification *"without undue delay, and where feasible, within forty-eight (48) hours"*. |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` — **the primary store is UK-domestic, so no restricted transfer arises for it at all.** For whatever processing does occur outside the UK (subprocessors, support, telemetry, email, control plane), the DPA carries EU SCC Modules 2/3 **plus the UK Addendum**. |
| **Verification still required** | **Region: CLOSED.** **DPA acceptance: CLOSED** (not a separate act). What remains is the **onward-transfer/subprocessor accountability review** — mapping which of the 24 published subprocessors actually touch PlayPlanner data and where. That is an accountability exercise, not a missing safeguard. |

## 2. Stripe — payment processing

| | |
|---|---|
| **Relationship** | **PUBLICLY VERIFIED 2026-09-02 — dual role, now confirmed against Stripe's own DPA rather than assumed.** DPA §2: *"When Stripe Processes Personal Data as a Data Processor, it is acting as a Data Processor on behalf of User, the Data Controller"*; and as **independent controller** where it *"has the sole and exclusive authority to determine the purposes and means of Processing"* — for purposes including to *"monitor, prevent and detect fraudulent transactions"* and *"comply with Law, including applicable anti-money laundering screening and know-your-customer obligations"*. |
| **Personal data received** | Whatever Stripe Checkout itself collects (name, email, card details) — PlayPlanner's own server code only stores back `stripe_customer_id`/`stripe_subscription_id`, not card data |
| **Processing purpose** | Payment processing, subscription billing |
| **Contracting entity** | **PUBLICLY VERIFIED.** DPA §1: *"If User's Stripe Account is located in North America or South America, User enters this DPA with Stripe, LLC. If User's Stripe Account is located elsewhere, User enters this DPA with Stripe Payments Europe, Limited ('SPEL')."* A UK account therefore contracts with **SPEL (Ireland)**. Stripe Payments UK Ltd is only a conditional *additional* party under specific Financial Services Terms. |
| **Processing location(s)** | Transfers to **Stripe, LLC in the US** occur — DTA §3 expressly addresses data *"originating from the EEA, the UK or Switzerland to Stripe in the United States"*. |
| **Sub-processors** | **PUBLICLY VERIFIED** — `stripe.com/legal/service-providers`, updated **20 December 2025**; sections for sub-processors, service providers and affiliates. |
| **DPA/Art.28 terms** | **PUBLICLY VERIFIED — AUTO-INCORPORATED, NO SIGNATURE.** DPA at `stripe.com/legal/dpa`, **last updated 18 November 2025**: *"forms part of the Agreement"*; SSA §4.1: *"Each party will comply with the DPA, including the Data Transfers Addendum, which is incorporated into this Agreement by this reference."* |
| **Security terms** | Stripe holds PCI-DSS Level 1 certification generally — **not independently re-verified this session**; treat as widely-known industry fact, not as evidence gathered here. |
| **International transfer mechanism** | ✅ **SUBSTANTIALLY VERIFIED.** DTA (**18 Nov 2025**) §3 DPF + §4 EEA SCCs Modules 1/2/3 + §5 *"UK International Data Transfer Addendum"*. **The UK route is independently confirmed by Stripe's own official DPA FAQ**, retrieved verbatim 2026-09-02: *"For transfers of personal data from the UK, the UK International Data Transfer Addendum is incorporated into Stripe's [Data Transfers Addendum]."* <br><br>🔴 **Correction to the previous draft:** it treated §5's unreadable body text as an unresolved legal mechanism. **That overstated it.** The page truncation is a *retrieval* limitation, not a contractual gap — the official FAQ confirms incorporation independently. §5 is no longer an open blocker. |
| **Verification still required** | (a) **Account-specific:** this account's **Stripe Account Country** and therefore the applicable **contracting entity**; (b) **only if DPF specifically is to be relied upon**, confirm **Stripe, LLC**'s live status on `dataprivacyframework.gov` in a browser (the register is a JS app; **legacy privacyshield.gov records are NOT evidence** — that programme was invalidated in 2020). Note the UK route does not depend solely on DPF, since the UK IDTA is separately incorporated. |

## 3. Expo / EAS — build tooling and push notification relay

| | |
|---|---|
| **Relationship** | **Processor**, for two distinct things: (a) EAS build/deploy tooling (handles source code and build artifacts, not end-user personal data in the GDPR sense), and (b) the **Expo Push relay**, which at runtime receives a real end-user's device push token plus notification text (confirmed this session: `supabase/functions/notify-review-published/index.ts:188` posts to `https://exp.host/--/api/v2/push/send`) — **this second role is the one that actually matters for Art.28** |
| **Personal data received** | **More than "just a token" — established from our own code 2026-09-02.** `supabase/functions/notify-review-published/index.ts:177-192` sends `to` (the ExpoPushToken), `title`, `body: "Your review of ${venueName} is now live."` and `data: { venueId }`. So Expo receives a **device token linked to a named venue the user reviewed** — a behavioural inference about an identifiable device, not an opaque identifier. Tokens are also linked to identity in our own `push_tokens.user_id`. |
| **Payload handling** | Expo's own statements (`expo.dev/privacy-explained`): *"We do store end-user push tokens to make it possible to send notifications"*; the payload *"is never stored and we only handle that data as long as it takes to send the notification."* **This is Expo's self-representation and is not independently auditable.** |
| **Processing location(s)** | US. Legal entity **650 Industries, Inc.**; terms governed by California law. |
| **Sub-processors** | **PUBLICLY VERIFIED** — `expo.dev/privacy/subprocessors`, updated **17 August 2026**; includes **Google** and **Apple** expressly for *"push notifications"* (i.e. the FCM/APNs leg), all US except two EU entries. |
| **⚠️ Two separate questions — do not merge them** | **(A) International transfer mechanism** and **(B) Article 28 processor contract** are independent. An adequacy/DPF mechanism does **not** satisfy Art.28, and an Art.28 contract does not by itself legitimise a transfer. Expo's positions on the two differ sharply, and a previous draft of this register wrongly collapsed them. |
| **(A) Transfer mechanism — CORRECTED 2026-09-02** | Expo's **Privacy Policy** states verbatim: *"Expo complies with the EU-U.S. Data Privacy Framework, the UK Extension to the EU-U.S. Data Privacy Framework, and the Swiss-U.S. Data Privacy Framework as set forth by the U.S. Department of Commerce… We have self-certified to the U.S. Department of Commerce that we adhere to the EU-U.S. Data Privacy Framework Principles, the UK Extension…"* **Correct position: `Expo publicly states participation in the UK Extension; ACTIVE CERTIFICATION AND SCOPE MUST STILL BE VERIFIED AGAINST THE OFFICIAL DPF PARTICIPANT LIST BEFORE RELIANCE.`** <br><br>🔴 **A previous draft of this register said "no UK mechanism exists anywhere in Expo's terms". That was an overstatement and is withdrawn.** It was true only of the *Terms of Service* document; the UK Extension claim lives in the *Privacy Policy*, and concluding "no mechanism exists" from one document was wrong. **Do not mark this `UK TRANSFER BLOCKED — NO MECHANISM`** unless the official DPF list positively shows the certification inactive, expired, or not covering this processing. |
| **(B) Article 28 — clause-by-clause, corrected 2026-09-04 (Expo Article 28 Final Correction Pass)** | **`OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED`** — see the dedicated audit table in §3a below. Two things changed on top of the 2026-09-02 audit: (1) one of that audit's own conclusions — that Arts.35–36 assistance falls outside SCC Module Two — was itself wrong and is withdrawn (Commission Implementing Decision 2021/914 Art.1(2) states the SCCs collectively "set out the rights and obligations… with respect to the matters referred to in Article 28(3) and (4)", which includes (f)); (2) a **new, more fundamental threshold question**: §3.2 only applies "if and to the extent that the [EU] GDPR… applies", and PlayPlanner's UK-only processing does not clearly trigger EU GDPR Art.3(2) — so it is now genuinely unclear whether §3.2's processor terms, and the SCC Module 2 they incorporate, contractually engage **at all** for PlayPlanner's UK GDPR processing. See `UK ARTICLE 28 CONTRACTUAL COVERAGE — OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED` in §3a. |
| **DPF** | Self-declared (above). **NOT independently confirmed** — `dataprivacyframework.gov` returns only a 2,116-byte JavaScript shell to any automated fetch (re-attempted three ways this pass), so no participant record is retrievable. A legacy privacyshield.gov record for 650 Industries shows a recertification due date of **15 November 2024**; **Privacy Shield was invalidated in 2020 and that record is not evidence of current DPF standing either way.** |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` — **plausible via the UK Extension, pending register verification.** No longer described as the weakest transfer position. |
| **Verification still required** | Confirm the account plan; ask Expo whether a DPA is available on it and **whether it names the Push Notification Service**; verify **650 Industries, Inc.** on the official DPF list **in a browser**. |


## 3a. Expo Push — Article 28(3) clause-by-clause audit *(built 2026-09-02; corrected 2026-09-04 — Expo Article 28 Final Correction Pass; corrected again same day on the Services/Push point below)*

> **What changed 2026-09-04.** Liam identified one specific unsound conclusion and asked for the whole
> audit to be re-run under the corrected reasoning. Independently re-verified against Expo's live
> `expo.dev/terms` (fetched fresh this pass) and against the actual text of Commission Implementing
> Decision (EU) 2021/914, not against the 2026-09-02 draft's summary of either.
> 1. **Withdrawn:** the 2026-09-02 claim that Art.28(3)(f) (Arts 32–36 assistance) is a "genuine gap…
>    not an SCC Module Two obligation." **That reasoning was unsound.** Article 1(2) of Commission
>    Implementing Decision 2021/914 states verbatim: *"The standard contractual clauses also set out the
>    rights and obligations of controllers and processors with respect to the matters referred to in
>    Article 28(3) and (4) of Regulation (EU) 2016/679."* Art.28(3)(f) — assistance with Arts 32–36 — is
>    one of "the matters referred to in Article 28(3)". The Commission's own decision therefore treats
>    adoption of Module Two as addressing that matter as a whole, even though no single clause in Module
>    Two is titled "DPIA assistance". Reclassified below from 🔴 gap to 🟡 unclear-via-SCC — the same tier
>    as the other SCC-only elements — **not** promoted to VERIFIED, because no clause-level text was found
>    that specifically names Arts 35–36, and it has never been confirmed to apply operationally to Push.
> 2. **New finding, more consequential than anything in the 2026-09-02 audit:** §3.2 is scoped to
>    *"If and to the extent that the [EU] General Data Protection Regulation (EU) 2016/679… applies"* — a
>    defined term ("GDPR") tied to the **EU** Regulation specifically. PlayPlanner is UK-only; nothing in
>    this codebase or business model currently triggers EU GDPR Art.3(2) extraterritorial scope (no
>    targeting of, or monitoring, EU data subjects). **Whether §3.2 — and therefore the SCC Module 2 it
>    incorporates — contractually engages at all for PlayPlanner's UK GDPR processing is now the single
>    most important open question in this audit**, upstream of the Annex questions below. See §3a-0.
> 3. **Corrected again 2026-09-04 (same-day follow-up correction) — the first 2026-09-04 pass's reasoning
>    on this point was itself wrong and is withdrawn.** That pass treated the Services definition as
>    effectively exhaustive and read Push's absence from the named examples as evidence it sits outside
>    the Terms. **Wrong: the definition reads *"any products or services made available by Expo or its
>    affiliates, including without limitation EAS Build, EAS Update, EAS Submit, EAS Hosting and EAS
>    Workflows"* — "including without limitation" makes the named list explicitly non-exhaustive**, and
>    Expo's own current documentation names the relevant infrastructure the **"Expo Push Service"**.
>    **Expo Push appears capable of falling within the broad Services definition, but the public Terms do
>    not expressly identify Push in the processor/SCC processing description or provide clearly
>    Push-specific Annex I.B / Annex II detail.** That is the accurate, narrower finding — not that Push
>    sits outside the Terms.
> 4. **Confirmed, unchanged:** the Trust Center / security documentation is **hyperlinked from, not
>    incorporated into,** the Terms — no "forms part of" / "incorporated by reference" language attaches
>    to it, unlike Supabase's and Stripe's DPAs, which do use that language for their own linked documents.
>    Annex II's classification below reflects this on purpose.

### §3a-0. Threshold question: does §3.2 apply to PlayPlanner's UK GDPR processing at all?

**Verbatim, re-fetched 2026-09-04 from `expo.dev/terms`:**
> *"If and to the extent that the General Data Protection Regulation (EU) 2016/679 of the European
> Parliament and of the Council of 27 April 2016, as implemented and amended ('GDPR') applies to the
> processing of any personal data included in the User Content ('User Data')…"* — the processor
> undertaking, including the SCC Module 2 incorporation, follows only inside that conditional.

**What this does and doesn't settle:**
- "GDPR" is a defined term tied explicitly to **Regulation (EU) 2016/679** — the *EU* instrument. UK GDPR
  is a separate (if substantively near-identical) instrument under the Data Protection Act 2018 as amended
  post-Brexit — not an EU Regulation, and not obviously "GDPR… as implemented and amended" in the sense a
  drafter most likely meant by that phrase (EU member-state implementing legislation and subsequent EU
  amendments — not a third country's post-exit retained law).
- **Do not confuse this with the transfer-mechanism question.** A UK Extension DPF self-certification
  (§6 below / `INTERNATIONAL_TRANSFERS.md`) is about *lawful export* of data to the US. This is about
  whether a *processor contract* exists for UK GDPR purposes at all. They remain genuinely independent —
  the same discipline the 2026-09-02 pass applied to Supabase/Stripe, extended one level further for Expo.
- **This is not resolved either way by anything publicly available.** It is not correct to conclude
  "therefore no processor contract exists" — a UK regulator/court could plausibly read "GDPR… as
  implemented and amended" purposively. It is equally not correct to assume UK GDPR is covered.

# `UK ARTICLE 28 CONTRACTUAL COVERAGE — OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED`

This sits **above**, not instead of, the Annex-level findings below: even if this threshold question
resolves in PlayPlanner's favour, the Annex I.B/II findings still apply. If it resolves against, the Annex
questions become moot — there would be no incorporated content to assess. **Ask Expo this explicitly; do
not infer an answer from silence.**

### What the Terms actually say (re-verified 2026-09-04)

Re-fetched live, not read from a prior session's cached extract. ToS §3.2 (last updated 29 May 2025) —
unchanged in substance since 2026-09-02 — provides that PlayPlanner is Data Controller, that Expo, *if and
to the extent EU GDPR applies* (§3a-0), *"acts as a: processor when processing such User Data in the
context of the Services and with respect to such processing it complies with **module two of the standard
contractual clauses** … approved by the European Commission (C/2021/3972)"*, with clause options **9
(option 2, one week's subprocessor notice)**, **11 (not selected)**, **13 (depends on exporter location)**,
**17 (option 2)**, **18 (exporter's member-state courts)** specified, and — decisively for the Annex
questions — *"**the Annexes shall be deemed completed with the information in these Terms and any work
orders**"*.

**Corrected 2026-09-04:** Expo's Terms define **"Services"** — the term §3.2 gates the whole processor
undertaking to — as, verbatim, *"any products or services made available by Expo or its affiliates,
**including without limitation** EAS Build, EAS Update, EAS Submit, EAS Hosting and EAS Workflows."* The
phrase "including without limitation" makes this list **explicitly non-exhaustive** — the earlier framing
of Push's absence from the named examples as evidence it falls outside the Terms was wrong and is
withdrawn. Expo's own current documentation (`docs.expo.dev/push-notifications/overview/`) expressly names
the infrastructure the **"Expo Push Service"** and the **"Expo Push Service API"**. **Expo Push therefore
appears capable of falling within the broad Services definition; what remains true is that the public
Terms do not expressly identify Push in the §3.2 processor/SCC processing description, and provide no
clearly Push-specific Annex I.B or Annex II detail.**

**Also newly confirmed:** the Trust Center (`expo.dev/trust`) and Privacy Policy (`expo.dev/privacy`) are
**referenced by hyperlink only** in the Terms — no "forms part of", "incorporated by reference", or
equivalent binding language attaches to either, unlike Supabase's DPA (*"supplements and forms part of the
Supabase Terms of Service"*) or Stripe's (*"incorporated into this Agreement by this reference"*). A public
security webpage does not become contractual Annex II content by being merely linked.

### Method

Raw HTML of `expo.dev/terms` was fetched fresh this pass (2026-09-04) and searched for each Art.28(3)
element, the Services definition, and any UK/DPIA-adjacent language, rather than reusing the 2026-09-02
keyword counts. Findings below supersede that pass where they differ; unchanged where they don't.

### The audit — rebuilt treating incorporated Module Two as contractual content

Per Liam's instruction: a clause is not **MISSING** merely because it is absent from the Terms' own prose
if Module Two SCC text (incorporated by §3.2) supplies it. **VERIFIED** requires the content to be actually
present and unambiguous, whether in the Terms or the incorporated SCCs. **UNCLEAR** means present in
principle (via the SCC route or partial Terms language) but not confirmed to operate for Push specifically,
or contingent on the §3a-0 threshold question. **MISSING** is reserved for elements absent from *both* the
Terms and Module Two.

| Art.28(3) element | Terms (§3.2 prose) | Module Two SCC (incorporated) | Classification |
|---|---|---|---|
| Subject-matter, duration, nature/purpose, data types, data-subject categories (opening words + Annex I.B) | Not described; Push likely falls within the (non-exhaustive) Services definition but is not itself named or described | Annex I.B — deemed completed by "these Terms", which don't describe Push specifically | **UNCLEAR** — content route exists in principle, but nothing populates it for Push. Not MISSING (a mechanism for supplying it exists, and Push probably is a Service), not VERIFIED (nothing actually supplies Push-specific content) |
| (a) Documented instructions | "instructions" appears 0 times | SCC Clause 8.1 covers this | **UNCLEAR** — via SCC only, contingent on §3a-0 |
| (b) Confidentiality of personnel | 4 hits, none on-point (user's own credentials / third-party rights) | SCC Clause 8.x covers this | **UNCLEAR** — via SCC only, contingent on §3a-0 |
| (c) Security measures (Art.32) / Annex II | Not described anywhere in the Terms | SCC Clause 8.6 requires them **and refers to Annex II**, which the Terms deem "completed" by content that doesn't exist | **UNCLEAR-INSUFFICIENT** — the clause mechanism exists but the Annex it depends on is empty; Expo's public Trust Center/security pages are not contractually incorporated (see above) |
| (d) Subprocessor conditions | Never mentioned in prose, but §3.2 explicitly selects Clause 9 option 2 (general authorisation, 1 week notice) | SCC Clause 9 governs; option is actually selected in the Terms | **VERIFIED** — this is the one element the Terms address by explicit, unambiguous choice, contingent only on §3a-0 |
| (e) Assistance with data-subject rights | "data subject" appears 0 times | SCC Clause 10 covers it | **UNCLEAR** — via SCC only, contingent on §3a-0 |
| (f) Assistance with Arts 32–36 | "impact assessment" appears 0 times | Decision 2021/914 Art.1(2): the SCCs collectively "set out the rights and obligations… with respect to the matters referred to in Article 28(3) and (4)" — Art.28(3)(f) is one of those matters, even without a clause expressly naming Arts 35–36 | **UNCLEAR — RECLASSIFIED 2026-09-04, was wrongly marked a genuine gap.** Not MISSING (the Decision itself treats this as addressed by SCC adoption); not VERIFIED (no clause-level text specifically confirms DPIA/prior-consultation assistance, and it has never been confirmed to operate for Push) |
| (g) Deletion or return at end of provision | Terms give **Expo** the option to delete at its own discretion — opposite of controller-directed | SCC Clause 8.5 requires deletion/return | **UNCLEAR, and internally tense** — the Terms' own language pulls against the SCC clause it incorporates; unresolved which governs for Push specifically |
| (h) Audit / information rights | "audit" appears 0 times | SCC Clause 8.9 provides this | **UNCLEAR** — via SCC only, contingent on §3a-0 |

### Annex I.B — description of the processing

Per Liam's classification scheme: not "empty" merely because there's no separately titled annex — assessed
against whether the **standard, non-Enterprise contractual material** actually supplies enough to describe
PlayPlanner's real Push flow (ExpoPushToken; notification title/body; venue name in the body; `venueId` in
the data payload; forwarding via FCM/APNs).

# `UNCLEAR — VENDOR CONFIRMATION REQUIRED`

**Corrected 2026-09-04** — the previous `INSUFFICIENTLY SPECIFIED` verdict rested partly on treating the
Services definition as exhaustive and Push's absence from it as exclusion. That was wrong (see above): the
definition is explicitly non-exhaustive ("including without limitation"), and Expo's own documentation
calls the relevant infrastructure the "Expo Push Service". Recorded instead, as instructed:

**Expo Push appears capable of falling within the broad Services definition, but the public Terms do not
expressly identify Push in the processor/SCC processing description or provide clearly Push-specific
Annex I.B detail.**

Reasoning that still holds: the Annex is deemed completed by "these Terms and any work orders". The Terms
never use the words "push", "notification", or "token" anywhere, and contain no data-subject category,
frequency, retention-criteria, or purpose language for *any* service, let alone Push specifically. This is
not a case of information existing in an inconvenient location (e.g. only in the Privacy Policy) — the
Privacy Policy is not incorporated into the Terms either (see above), so it cannot supply Annex I.B content
even though it does describe Push in its own words (*"we do store end-user push tokens…"*) — that is Expo's
unincorporated self-representation, not contractual Annex content. **Classified UNCLEAR, not
INSUFFICIENTLY SPECIFIED**: Push is now believed likely to be *within scope* of §3.2 (subject to §3a-0),
which is a materially different, better position than "excluded" — the shortfall is that no Push-specific
Annex I.B content exists to describe *what* processing that scope covers, not that the scope itself
excludes Push.

### Annex II — technical and organisational measures

# `ANNEX II CONTRACTUAL DETAIL UNCLEAR/INSUFFICIENT`

Distinguishing what Liam asked to distinguish: Expo's **Terms** contain no security-measures language at
all. The **Privacy Policy**, **Trust Center**, and any security documentation are **referenced by hyperlink
only**, with no incorporation language — contrast Supabase's DPA, which explicitly states it *"forms part
of"* the Supabase Terms. The publicly known facts (SOC 2 Type 2, GCP hosting, encryption, device-token
encryption) are real and worth knowing, but **as a legal matter they are not shown to be part of the
binding Annex II** that SCC Clause 8.6 requires — Commission Decision 2021/914's own standard requires
Annex II measures to be *"described in specific (and not generic) terms"* **within the incorporated
document**, and a linked marketing/trust page reached by clicking through is not that. Not classified
outright `INSUFFICIENT` only because an **Enterprise-tier DPA**, if PlayPlanner were on one, could plausibly
supply a populated Annex II directly — which is why the owner checklist below asks whether such a DPA
exists on PlayPlanner's plan.

### Overall verdict — unchanged conclusion, corrected and sharpened reasoning

# `OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED`

Still not `MISSING` — a contract exists, asserts processor status, and (for subprocessors specifically)
makes an actual, unambiguous, contract-level choice (Clause 9 option 2). But the shortfalls are now
different in kind from the 2026-09-02 audit, and one of them is more fundamental:

1. 🔴 **NEW, most fundamental: `UK ARTICLE 28 CONTRACTUAL COVERAGE — OWNER/VENDOR/LEGAL CONFIRMATION
   REQUIRED`** (§3a-0). §3.2 only engages "if and to the extent" **EU** GDPR applies; PlayPlanner is
   UK-only. Whether the processor undertaking — and everything below it — contractually engages at all is
   unconfirmed, and this question is logically prior to every Annex question.
2. 🟡 **Annex I.B: `UNCLEAR — VENDOR CONFIRMATION REQUIRED`** (corrected 2026-09-04). Push appears capable
   of falling within the Services definition (it is explicitly non-exhaustive, "including without
   limitation") but is described nowhere in the incorporated document with any Push-specific detail.
3. 🟡 **Annex II: `UNCLEAR/INSUFFICIENT`.** Real security facts exist publicly but are not shown to be
   contractually incorporated; an Enterprise DPA, if one exists for this account, could resolve this
   directly.
4. 🟢 **WITHDRAWN as a listed gap: Arts 35–36 assistance.** Reclassified `UNCLEAR` alongside the other
   SCC-only elements per Decision 2021/914 Art.1(2) — this was the one specific correction Liam identified,
   and it is applied.
5. ✅ **One element actually VERIFIED, unchanged from 2026-09-02:** subprocessor conditions — §3.2 makes an
   explicit, contract-level choice (Clause 9, option 2, one week's notice), the strongest single data point
   in Expo's favour in this whole audit.

**What would resolve it** (updated): a written answer from Expo confirming (i) whether §3.2's processor
undertaking and the incorporated SCC Module 2 are intended to extend to **UK GDPR** processing, not only
EU GDPR processing; (ii) confirmation that the **Expo Push Service** is treated as within "Services" as
the Terms define it — likely but not expressly stated, since the definition is non-exhaustive; (iii) what
Annex I.B and Annex II are deemed to contain for Push if so;
(iv) whether an Art.35–36 (DPIA/prior consultation) assistance commitment is offered, separate from the
Decision-level characterisation. **Do not record any of this as `MISSING`** — a contract exists and
asserts processor status; the open question is its scope and content for this specific service and this
specific jurisdiction.

## 4. Geoapify — venue discovery/enrichment data provider

| | |
|---|---|
| **Relationship** | For the personal data PlayPlanner receives **from** Geoapify (e.g. a sole trader's business phone number surfaced via a places-data API), Geoapify is best understood as an **independent controller of the data it republishes** (it aggregates OSM and other public sources under its own terms), not a processor acting on PlayPlanner's instructions — **PlayPlanner is a downstream re-user/recipient of Geoapify's data product, not a data controller instructing Geoapify to process PlayPlanner's own data subjects' information**. This relationship runs in the opposite direction from a normal Art.28 processor and should not be forced into that framing. |
| **Personal data received** | None *sent* by PlayPlanner to Geoapify beyond query parameters (place-search terms, bounding boxes) that are not about PlayPlanner's own users — confirmed this session: Geoapify is called **only from offline/CLI enrichment scripts** (`scripts/enrich/geoapifyClient.ts`), never from the live mobile app or a user-facing Edge Function |
| **Processing purpose** | Sourcing venue/place data (business information, some of which may be sole-trader personal data) for the enrichment pipeline — **currently unapplied to production**, per the standing enrichment-gate status |
| **Relevant document** | This relationship is analysed in depth in `docs/DPIA_website_enrichment_addendum.md` and `docs/LIA_venue_enrichment.md` — do not duplicate that analysis here; this register only records that Geoapify is **not** a traditional Art.28 processor of PlayPlanner user data |
| **Article 28 classification** | **NOT APPLICABLE** — no PlayPlanner personal data flows to Geoapify; the DPA/security/deletion questions that matter here are about **Geoapify's own data as a source**, covered by the enrichment DPIA's provenance/attribution/Article 14 sections instead |
| **International transfer** | Also not a traditional "transfer" question — see `INTERNATIONAL_TRANSFERS.md`'s explicit note on inbound data sourcing vs. outbound transfer |

## 5. OpenStreetMap — geodata source

| | |
|---|---|
| **Relationship** | **Not a vendor relationship at all in the contractual sense.** Confirmed this session: OSM is accessed **directly** via the public Overpass API (`scripts/import/01_fetch_osm.js:60-61`, `https://overpass-api.de/api/interpreter`), **independently of Geoapify** — a separate data-sourcing path than previously assumed. OSM is a crowd-sourced, ODbL-licensed open dataset with no controller/processor relationship at all — PlayPlanner is a **licensee/re-user** of open data under the ODbL, and the relevant obligations are **attribution and share-alike licence terms**, not GDPR processor terms. |
| **Personal data received** | Whatever OSM's own contributors have tagged (e.g. a business's phone number on its map entry) — same downstream-recipient framing as Geoapify, and again covered by the enrichment DPIA's Article 14/provenance sections, not Art.28 |
| **Article 28 classification** | **NOT APPLICABLE — no processor relationship exists.** Do not add a DPA-chase action item for OSM; that would misunderstand the relationship. |
| **Relevant document** | `docs/DPIA_website_enrichment_addendum.md` §14 (attribution) covers OSM's actual obligation on PlayPlanner — a licensing/attribution matter, not a data-protection one |

## 6. GitHub / GitHub Pages — hosting for privacy/terms pages

| | |
|---|---|
| **Relationship** | **Processor**, narrowly — GitHub Pages serves static HTML (`docs/privacy.html`, `docs/terms.html`) at `lennons-space.github.io/playplanner/`; the only personal data potentially "processed" here is incidental web-server access logs (IP addresses of visitors to the privacy policy page itself), which GitHub, not PlayPlanner, controls the retention of |
| **Personal data received** | Visitor IP/access logs only, at GitHub's infrastructure level — no PlayPlanner-collected personal data is sent to GitHub |
| **DPA/Art.28 terms** | **CONTRACT/DPA EXISTS — MANUAL ACCEPTANCE CHECK** — GitHub (Microsoft) publishes standard terms covering this; low materiality given the minimal data involved |
| **Verification still required** | Low priority given the minimal personal data at stake, but note for completeness |

## 7. Google — Maps SDK only

> **🔴 CORRECTED 2026-09-02 (Processor + International Transfer Verification Pass).** This row previously
> classified Google Maps Platform as a **processor** and asserted that Google receives only
> viewport/bounds and "not the user's exact position". **Both statements were wrong.** They were
> inherited from the 2026-06-08 DPIA and were never checked against Google's actual terms or against
> this app's actual map configuration. The corrected position is below; the old wording must not be
> reinstated.

| | |
|---|---|
| **Relationship** | **INDEPENDENT CONTROLLER — NOT an Article 28 processor.** Verified 2026-09-02 from three independent official sources: (1) Maps Platform EEA ToS §4.5 — *"Google and Customer agree to the then-current Google Controller-Controller Data Protection Terms at https://business.safety.google/controllerterms/"*; (2) those terms, **Version 11, effective 7 May 2026**, state *"each party: (a) is an independent controller of Controller Personal Data; (b) will individually determine the purposes and means of its processing"*; (3) Google's own service-classification page (`business.safety.google/services/`, **last update 27 April 2026**) lists **"Google Maps APIs" under Controller Services** and **not** in the Data Processing (Article 28) Services table. There is therefore **no Article 28(3) processor relationship for Maps Platform**, and PlayPlanner cannot and does not instruct Google on the purposes or means of its processing. |
| **Integration** | `react-native-maps` with `provider={PROVIDER_GOOGLE}` (`app/explore/map.tsx:1433`); API keys via `GOOGLE_MAPS_API_KEY_IOS`/`GOOGLE_MAPS_API_KEY_ANDROID` (`app.json`, `app.config.js`). No Firebase, no Play Billing, no Google Analytics, no Sign-in-with-Google. |
| **Personal data received** | **Google's own terms settle this, and they contradict the old entry.** Maps Platform ToS §4.4(a): *"To provide the Services through the Customer Application(s), Google collects and receives data from Customer and End Users … including **search terms, IP addresses, and latitude/longitude coordinates**. Customer acknowledges and agrees that Google and its Affiliates may use and retain this data to provide and improve Google products and services…"* The EEA ToS §4.4 is near-identical. Google's Maps FAQ adds that the Maps SDKs *"use cookies … such as calculating daily and 7-day active users and service abuse prevention"* — i.e. Google processes end-user data **for its own purposes**.<br><br>PlayPlanner's own configuration is consistent with that: `app/explore/map.tsx:1437` sets `showsUserLocation={trackLocation}`, and `trackLocation` is `true` whenever the consented map renders (`MapWithLocation`, `map.tsx:1800-1820`), which instructs the **native Google Maps SDK** to obtain and display the device position from the OS. **`coarsenCoordinates()`'s 3dp rounding applies only to coordinates held in React state for the PostGIS query — it does not constrain what the Maps SDK receives.** |
| **Can we prove Google does not transmit coordinates?** | **No.** Whether the SDK sends the device position to Google's servers is not determinable from this repo's source. Per the standing evidence rule, the conservative truthful formulation is recorded rather than a convenient negative. **Do not restore any claim that Google cannot receive user location.** |
| **DPA/Art.28 terms** | **NOT APPLICABLE — the relationship is controller-to-controller.** Chasing a "Maps DPA acceptance status" is a category error and was removed from the manual-verification pack. What *is* required instead is a lawful basis and transparency for disclosing user location to Google as an independent controller (Art.13(1)(e) recipients disclosure), which the in-app notice does not currently make. |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` — controller SCCs / DPF, with **Google Ireland Limited** as European End Controller and **Google LLC** named for UK transfers. |
| **Verification still required** | Confirm the Google Cloud billing account's contracting entity and jurisdiction (owner check). **The Art.28 acceptance check previously recorded here is withdrawn as inapplicable.** |

## 8. Apple — ruled out

Confirmed this session: **no** Apple Pay merchant ID, **no** Sign in with Apple, **no** other Apple-service
integration found anywhere in `app.json`/`app.config.js`/`package.json` (targeted grep, zero hits). **Not
a vendor relationship at all currently** — recorded here only to show the check was actually performed,
not skipped.

## 9. Email-sending service — none found beyond Supabase's built-in Auth email

Confirmed this session: no third-party transactional email API (SendGrid, Postmark, Mailgun, Resend, a
raw SMTP client) exists anywhere in the repo. Signup confirmation and password-reset emails are presumed
to run through **Supabase Auth's own built-in email sending**, which is a Supabase-dashboard-level
setting, not visible in this repo. This folds into the Supabase row above rather than being a separate
vendor — but note for the international-transfer register that Supabase's own email-sending infrastructure
may have a different processing location than the database itself, and that is `UNKNOWN — MUST VERIFY`
separately if Liam wants that level of granularity.

## 10. Push notification service — Expo (see row 3, not a separate FCM/APNs integration)

No direct Firebase Cloud Messaging or Apple Push Notification service integration exists — Expo's Push
service abstracts both. Recorded here to close out the "push-notification provider" checklist item
explicitly, not left implicit inside row 3.

## 11. Analytics / logging / monitoring — confirmed absent

Re-confirmed this session (third time across this project's history of audits): **zero** analytics,
crash-reporting, or monitoring SDKs (Sentry, Bugsnag, Crashlytics, Firebase, Amplitude, Mixpanel, Segment,
PostHog, Datadog, LogRocket — all checked, all absent from `package.json`). **This is a genuinely strong,
repeatedly-verified finding, not an assumption carried forward** — no vendor register entry is needed
because no such vendor exists.

---

## Article 28 gaps — summary

*Rebuilt 2026-09-02 (Processor + International Transfer Verification Pass) against primary vendor sources.*

| Vendor | Personal data flows to them? | Art.28 classification | Action needed |
|---|---|---|---|
| Supabase | Yes — the primary datastore | ✅ **DPA AUTO-INCORPORATED (verified)** — v1, 1 Aug 2026; ToS §7(b); §12.2 makes acceptance equal to signing the SCCs; UK GDPR within its GDPR definition | ✅ **Region CLOSED — `eu-west-2` London, UK.** Onward-transfer/subprocessor review remains |
| Stripe | Yes — payment flow | ✅ **DPA AUTO-INCORPORATED (verified)** — 18 Nov 2025; SSA §4.1. Dual role confirmed: processor + independent controller for fraud/AML | Account country → contracting entity. DPF check **only if DPF is relied on** |
| Expo (Push) | Yes — device token **+ venue the user reviewed** | 🟠 **Art.28: `OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED`** (see §3a, corrected 2026-09-04) — threshold question: §3.2 only engages "if and to the extent EU GDPR applies" and PlayPlanner is UK-only (`UK ARTICLE 28 CONTRACTUAL COVERAGE` unresolved); **Annex I.B is `UNCLEAR — VENDOR CONFIRMATION REQUIRED`** (Push likely falls within the non-exhaustive "Services" definition, but is nowhere described with Push-specific detail); **Annex II is `UNCLEAR/INSUFFICIENT`** (Trust Center is linked, not incorporated). Arts 35–36 assistance is **no longer a listed gap** — reclassified via Decision 2021/914 Art.1(2). Transfer: **UK Extension claimed, unverified** | Plan; **does §3.2 extend to UK GDPR processing**; confirm Expo Push Service is within scope; what the Annexes contain; **verify 650 Industries on the official DPF list** |
| GitHub Pages | Minimal (visitor IP only) | CONTRACT/DPA EXISTS — MANUAL CHECK | Low priority |
| **Google Maps** | **Yes — search terms, IP addresses and latitude/longitude, per Google's own ToS §4.4(a)** | ⚪ **NOT APPLICABLE — INDEPENDENT CONTROLLER, NOT A PROCESSOR** (verified: Controller-Controller Terms v11, 7 May 2026; Maps APIs listed as a *Controller Service* on `business.safety.google/services/`, 27 Apr 2026) | **Not an Art.28 item at all.** Needs a lawful basis + Art.13(1)(e) recipient transparency instead |
| Geoapify | No (data flows inbound, not outbound) | NOT APPLICABLE | None — different legal question, covered in enrichment DPIA |
| OpenStreetMap | No (data flows inbound, not outbound) | NOT APPLICABLE | None — attribution/licence matter, not Art.28 |
| Apple | Indirectly — as an Expo Push **sub-processor** (APNs) | Flows through the Expo relationship | Covered by the Expo item |
| Analytics/monitoring | N/A — not integrated | N/A | None |

**Two classifications changed materially this pass, in opposite directions:**

1. **Google Maps moved OUT of the Art.28 frame entirely.** It was previously recorded as a processor with
   "marginal (viewport/bounds)" data. Both halves were wrong. It is an **independent controller** that, by
   its own terms, receives **search terms, IP addresses and latitude/longitude coordinates**. This does not
   make it *worse* in Art.28 terms — it makes Art.28 the **wrong instrument**. What it needs instead is a
   lawful basis for the disclosure and honest recipient transparency, neither of which currently exists.
2. **Supabase and Stripe firmed up from "manual acceptance check" to VERIFIED auto-incorporation.** Two of
   the four "acceptance status" chases in the old checklist were **category errors** — neither vendor has a
   separate acceptance artefact to produce, because acceptance is the ToS click itself.

**Expo is the only vendor receiving personal data without a verified Article 28 basis** — and as of the
2026-09-04 correction pass, the reason is more fundamental than the 2026-09-02 draft understood. The
sharpest open question is no longer just "are the Annexes populated" — it is **whether §3.2's processor
undertaking (and the SCC Module 2 it incorporates) contractually engages at all for PlayPlanner's UK-only
processing**, since §3.2 is scoped to "if and to the extent EU GDPR applies" (§3a-0). Layered under that:
**Annex I.B** is `UNCLEAR — VENDOR CONFIRMATION REQUIRED` (Push likely falls within the Terms' broad,
non-exhaustive "Services" definition — Expo's own documentation calls it the "Expo Push Service" — but is
described nowhere with Push-specific detail) and **Annex II** is `UNCLEAR/INSUFFICIENT` (security detail
exists publicly but is not contractually incorporated). The **Art.35–36 assistance** item from the
2026-09-02 draft was itself an overstatement and
is withdrawn — Commission Implementing Decision 2021/914 Art.1(2) treats that matter as addressed by SCC
Module 2 adoption as a whole. See §3a for the full clause-by-clause audit. It is **not MISSING** — a
contract exists and asserts processor status, and makes one unambiguous choice (subprocessor Clause 9
option 2). **This remains the single highest-priority manual check in this register.**

**Expo's transfer position was corrected in the other direction.** An earlier draft recorded "no UK
mechanism exists"; Expo's Privacy Policy in fact claims **UK Extension** DPF self-certification. That claim
is unverified, not absent. **Two lessons worth keeping: read every vendor document before concluding a
negative, and never let a transfer finding and an Article 28 finding contaminate each other.**

---

## Manual verification pack (new 2026-09-01, Privacy-Critical Engineering Remediation Pass)

Concrete, one-owner-action-each checklist — none of these were checked against live vendor
accounts/dashboards this pass (that access sits outside this repository entirely). **Do not mark any of
these PASS until the actual account/entity facts below are verified — a plausible assumption is not a
verified fact.**

> **Revised 2026-09-02.** Four boxes below were **closed by public-source verification** and four were
> **withdrawn as category errors** (chasing an "acceptance status" for a DPA that is auto-incorporated, or
> an Art.28 DPA for a controller-to-controller service). What remains is genuinely account-specific.

### Supabase
- [ ] **Actual project region** — the single most consequential open question in
      `INTERNATIONAL_TRANSFERS.md`. Still open, and only Liam can answer it.
- [x] ~~Confirm the DPA has been accepted~~ — **WITHDRAWN as a category error.** DPA §12.2: *"acceptance of
      the Agreement shall have the same effect as signing the SCCs."* There is no separate acceptance
      artefact to produce. If an auditor wants paper, request a countersigned copy from privacy@supabase.io.
- [x] ~~Pull the sub-processor list~~ — **DONE:** 24 entities, updated 1 June 2026.
- [x] ~~Confirm the transfer mechanism~~ — **DONE:** EU SCCs Modules Two/Three + UK Addendum (Schedule 2).

### Stripe
- [x] ~~Confirm the DPA is in place for this account~~ — **WITHDRAWN as a category error.** SSA §4.1
      incorporates it by reference for every merchant.
- [ ] **Confirm this account's Stripe Account Country** — it determines the contracting entity. A UK
      account gives **Stripe Payments Europe, Limited**.
- [ ] **Check Stripe, LLC's live DPF + UK Extension status** on `dataprivacyframework.gov`. Requires a real
      browser (JS app). **Do not accept a privacyshield.gov record as evidence** — that programme was
      invalidated in 2020.
- [ ] **Read DTA §5 "UK International Data Transfer Addendum"** in a browser — the page truncates on
      automated fetch, confirmed twice independently.
- [x] ~~Pull the sub-processor list~~ — **DONE:** `stripe.com/legal/service-providers`, 20 Dec 2025.

### Expo / EAS / Push — 🔴 highest priority
- [ ] **NEW 2026-09-04, most fundamental: ask Expo whether §3.2's processor undertaking — scoped to "if
      and to the extent [EU] GDPR… applies" — is intended to extend to processing governed by **UK GDPR**
      where EU GDPR is not otherwise triggered.** This is upstream of every other Expo item below; see
      §3a-0. Do not assume either answer.
- [ ] **NEW 2026-09-04, corrected: ask Expo to confirm the Expo Push Service is treated as within
      "Services" as the Terms define the term.** The definition is non-exhaustive ("including without
      limitation EAS Build, EAS Update, EAS Submit, EAS Hosting and EAS Workflows"), so Push is likely
      already covered — but it is not expressly named, so ask for confirmation rather than assuming either
      way.
- [ ] **Confirm the Expo account plan** (free / Starter / Production / Enterprise).
- [ ] **Ask Expo directly, in writing: is a DPA available on our plan, and does it name the Expo Push
      Notification Service in its scope or annexes?** Public sources answer neither. A "yes" on plan
      availability is not a "yes" on Push coverage — ask both, explicitly.
- [ ] **Ask Expo what UK transfer mechanism applies.** Their terms reference only EU GDPR and EU
      Commission SCCs, with **no UK Addendum, IDTA or UK Extension wording anywhere in the Terms**
      (the Privacy Policy separately claims UK Extension DPF — keep that a separate question, §6). For a
      UK-only product this is worth putting to them directly.
- [ ] Check **650 Industries, Inc.** on `dataprivacyframework.gov` (the legacy Privacy Shield record shows
      a recertification due date of 15 Nov 2024 — expired and not evidence of current standing).
- [x] ~~Confirm processing locations / sub-processor list~~ — **DONE:** US; list updated 17 Aug 2026,
      naming Google and Apple expressly for push.

### Google (Maps)
- [x] ~~Confirm Maps DPA acceptance status~~ — **WITHDRAWN as a category error.** Maps Platform is
      **controller-to-controller**; there is no Art.28 DPA to accept. Verified from three official sources.
- [x] ~~Confirm processor vs controller role~~ — **DONE, and the previous answer was wrong.** Google is an
      **independent controller**.
- [ ] **Confirm the Google Cloud billing account's contracting entity.** Note the three-way split: the
      Agreement entity for a UK customer falls under *"EMEA except France, Italy and Poland → Google Cloud
      EMEA Limited"*, while the **UK End Controller is Google LLC** and the **EEA End Controller is Google
      Ireland Limited**. These are three different answers to three different questions — do not collapse
      them.
- [ ] **Product decision, not a vendor check:** decide whether to keep `showsUserLocation` on the map. It
      is what grants Google the device position. If it stays, the privacy notice must disclose Google as a
      recipient of location data (Art.13(1)(e)).

**Until every box above is checked, this register's overall verdict remains `MANUAL VERIFICATION
REQUIRED`, not `PASS` — consistent with the compliance gate's original verdict for this area.**

---

## 📋 OWNER CHECKLIST — four things only Liam can do (added 2026-09-02)

No legal knowledge needed. Each item says exactly where to click and what to write down. Everything else
in this register has now been verified from the vendors' own published terms.

### ~~1. Supabase — which region?~~ ✅ **DONE 2026-09-02 — nothing further needed**

**Answer: `eu-west-2` — London, United Kingdom.** The primary database, Auth and Storage sit in the UK, so
for the main datastore there is **no international transfer at all**. Better than the previously assumed
"Ireland", and now a checked fact rather than a guess.

**You do NOT need to find a signed DPA.** Supabase's DPA applies automatically when you accepted the
terms — its §12.2 says accepting the agreement has the same effect as signing. There is no separate
document to hunt for. If an auditor ever insists on paper, email **privacy@supabase.io** and ask for a
countersigned copy.

*One thing that is **not** closed:* a UK primary region does not mean *everything* Supabase does stays in
the UK — support tools, logging, email and backups may involve other countries via their published
subprocessors. Their contract covers that with UK-approved safeguards, so it is a tidy-up task, not a
risk. No action from you.

### 2. Expo — what plan are we on, and does any agreement cover push? 🔴 *(most important)*

1. Go to **expo.dev** and sign in → your account/organisation → **Settings** or **Billing** to see the
   **plan name** (Free, Starter, Production, Enterprise). Write it down.
2. Then **email Expo support / sales** and ask these questions, word for word:
   > 1. **Your Terms' processor clause (§3.2) applies "if and to the extent" the EU GDPR (Regulation (EU)
   >    2016/679) applies. We are a UK-only service and do not target or monitor EU users, so EU GDPR
   >    Article 3(2) may not be triggered for us. Does §3.2's processor undertaking, and the SCC Module 2
   >    it incorporates, extend to processing governed by UK GDPR in that situation?**
   > 2. **Your Terms define "Services" to include, without limitation, EAS Build, EAS Update, EAS Submit,
   >    EAS Hosting and EAS Workflows. Can you confirm the Expo Push Service is included within
   >    "Services" for the purposes of §3.2, even though it isn't one of the named examples?**
   > 3. Your Terms say the SCC Annexes are "deemed completed with the information in these Terms".
   >    **What are Annex I.B (description of the processing) and Annex II (technical and organisational
   >    security measures) deemed to contain for the Push service?**
   > 4. Do you offer any commitment to assist with **data protection impact assessments and prior
   >    consultation (UK/EU GDPR Articles 35–36)**?
   > 5. Is a separate Data Processing Agreement available on our plan, and does it cover Push?

3. **Separately, verify their transfer certification yourself** — open **dataprivacyframework.gov** in a
   normal browser, search participants for **650 Industries** (that is Expo's legal name), and check it is
   listed as **Active** and that the **UK Extension** is included.

**Why these are the right questions:** Expo's Terms *do* say it acts as a processor and *do* pull in an
EU-approved clause set — so this is **not** "there's no agreement". Question 1 is now the most important:
it's about whether that agreement applies to us at all, since it is contractually gated to EU GDPR
specifically. Question 2 is a confirmation, not a challenge — the Services definition is non-exhaustive
("including without limitation"), so Push is likely already in scope, but it isn't named, so it's worth
asking rather than assuming. Questions 3–4 are the annex-content questions from before — still open, but
they only matter once 1–2 are answered. (Question 4's underlying legal point — Article 32–36 assistance — is technically already
addressed by the incorporated SCC clause set as a matter of EU law; asking Expo directly is still worth
doing for certainty, but do not treat silence on it as a standalone missing clause the way the earlier
draft of this register did.)

**On the UK transfer question:** Expo's Privacy Policy already claims **UK Extension** certification, so
this is likely fine — it just needs confirming on the official register (step 3). An earlier draft of this
register wrongly said no UK mechanism existed; that has been withdrawn.

### 3. Stripe — which country is the account set to?

1. Go to **dashboard.stripe.com** → **Settings** → **Business details** (or **Account details**).
2. **Write down the account's country.** If it says United Kingdom, your data-protection contract is with
   **Stripe Payments Europe, Limited** in Ireland — that is the expected, normal answer.

**You do NOT need to find or sign a Stripe DPA** — it is built into the Stripe Services Agreement you
already accepted.

**The UK transfer question for Stripe is now closed** — no action needed. Stripe's own official DPA FAQ
states: *"For transfers of personal data from the UK, the UK International Data Transfer Addendum is
incorporated into Stripe's [Data Transfers Addendum]."* An earlier draft treated this as unresolved
because a web page kept truncating; that was a tool limitation, not a legal gap.

*Optional, only if you ever want to rely on the Data Privacy Framework specifically rather than the UK
Addendum:* open **dataprivacyframework.gov**, search for **"Stripe, LLC"**, and check it says **Active**.
⚠️ If you land on **privacyshield.gov**, that is the old scheme scrapped in 2020 — it does not count.

### 4. Google Maps — billing account details *(lowest urgency)*

1. Go to **console.cloud.google.com** → the project holding the Maps API keys → **Billing** →
   **Account management**. Note the **billing account country** and the entity name shown.

**Do NOT go looking for a "Google Maps DPA" — there isn't one, and that is not a problem.** Google Maps
runs on controller-to-controller terms, meaning Google is its own data controller rather than working
under our instructions. That is simply a different legal arrangement, not a missing one.

**But there is a decision for you here, and it is a product decision, not a paperwork one:** our map
currently switches on `showsUserLocation`, which is what hands Google the device's position. Either
(a) keep it, and add Google to the privacy notice as a recipient of location data — **already done in
`docs/privacy.html` this pass, pending your review**; or (b) turn it off, losing the blue "you are here"
dot on the map.
