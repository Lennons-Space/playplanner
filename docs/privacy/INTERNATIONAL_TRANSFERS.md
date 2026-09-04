# International Transfer Register — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01 · UK and EU transfer regimes treated separately, as instructed.
**Legal framing:** UK IDTA and the UK Addendum to the EU SCCs are **LAW** (ICO-issued transfer
mechanisms, in force since 21 March 2022, still current as of Sept 2026 per this session's research —
though the ICO has signalled planned 2026 updates to both; current versions remain valid meanwhile). The
UK Extension to the EU-US Data Privacy Framework and the EU-US DPF adequacy decision are each **LAW**
(adequacy decisions) but with an **operational certification layer that is not itself law-by-default** —
see the critical caveat below.

---

## ⚠️ The one rule this whole document is built around

**A US vendor is not "DPF compliant" merely because it is a US company, or because "lots of companies use
the DPF."** Coverage requires, cumulatively:
1. The **specific receiving legal entity** is actively self-certified under the DPF (only FTC/DoT-regulated
   entities are even eligible) — checked against the official list at **dataprivacyframework.gov**, not
   inferred.
2. That same entity has **separately** opted into the **UK Extension** — confirmed this session (legal
   research fork): the ICO treats the UK Extension as an **independent UK adequacy arrangement**, distinct
   from the EU-US DPF adequacy decision, not automatically bundled with it.
3. The **specific transfer in question** falls within the scope the entity declared in its certification.

**None of the vendor rows below are marked as DPF-covered, because none of these three things have
actually been checked against the live DPF list this session.** Every US-vendor row is `UNKNOWN — MUST
VERIFY`, and that verification is a five-minute lookup per vendor, not a legal research project — it
should simply be done before this register is relied on.

---

## Per-vendor assessment

### Supabase
- **Originating jurisdiction:** UK (PlayPlanner's own operation)
- **Destination jurisdiction — ✅ RESOLVED 2026-09-02 (owner-checked):** the PlayPlanner project's region
  is **`eu-west-2`, which is LONDON, UNITED KINGDOM.** The primary Postgres database, Auth service and
  Storage objects are therefore **UK-domestic**, and **no restricted transfer arises for the primary
  datastore at all** — this is the strongest possible answer for a UK controller.
  ⚠️ **The previous DPIA claim was wrong on two counts**, and both are worth recording so the error is not
  repeated: it asserted *"eu-west-2 Ireland, confirmed in app config"* when (i) no region string has ever
  existed in `supabase/config.toml`, and (ii) **`eu-west-2` is not Ireland** — in AWS, `eu-west-1` is
  Ireland and **`eu-west-2` is London**. The right answer was reached by checking the live project, not
  by the old guess turning out lucky.
- **🔴 Do not overstate this.** A UK **primary region** does **not** establish that every Supabase
  subprocessor, support function, telemetry/logging pipeline, email service or control-plane operation
  stays in the UK. Supabase's DPA expressly permits authorised subprocessors and carries
  international-transfer safeguards precisely because some processing happens elsewhere.
  **The onward-transfer analysis below is a separate question and remains open.**
- **Legal entity (PUBLICLY VERIFIED 2026-09-02):** **Supabase Pte. Ltd.** (Singapore, 65 Chulia Street
  #38-02/03, OCBC Centre) is the ToS/DPA contracting party. The Privacy Policy and SLA name
  **Supabase, Inc.** (Delaware, USA). These are two different entities in two different documents —
  do not collapse them.
- **Role:** Processor (Art.28), auto-incorporated. Not in doubt.
- **Adequacy available?** Yes, if EEA-hosted (EU/EEA is UK-adequate). `UNKNOWN — MUST VERIFY` otherwise.
- **Transfer mechanism (PUBLICLY VERIFIED):** DPA Schedule 2 §1.1 applies **EU SCCs Module Two**
  (controller→processor) and **Module Three** (processor→processor); Schedule 2 §2 adds a **UK Addendum**
  covering transfers where UK data protection law applies to the exporter. *(Reported as the ICO template
  version B.1.0 under s.119A(1) DPA 2018 — the presence of a UK Addendum was confirmed by two independent
  reads, but I could not reproduce the version string verbatim, so treat "B.1.0" as reported-not-verified.)*
  **This is a materially better position than the previous `UNKNOWN` implied: a UK mechanism exists in the
  contract regardless of which region the project sits in.**
- **DPF/UK Extension applicable?** Not needed if EEA-hosted. Supabase's own Transfer Impact Assessment
  (14 Mar 2025) discusses DPF adequacy and lists per-subprocessor DPF status — but it is **unsigned and
  stale** relative to the June 2026 subprocessor list, so use it for reasoning, not as a current roster.
- **Subprocessors causing onward transfer?** **PUBLICLY VERIFIED** — 24 entities (1 June 2026) incl. AWS,
  Google LLC, Cloudflare, Fly.io, Vercel, Upstash, OpenAI LLC. ⚠️ **The published list has no country
  column**, so onward-transfer destinations cannot be read off it. Even an EEA *primary* region does not
  rule out onward transfer via a subprocessor elsewhere.
- **Regional nuance worth knowing before checking (from Supabase's docs):** *"General regions deploy to
  an available AWS region within that broader area, which may not match a specific jurisdiction"*, and the
  "Europe" grouping **includes London and Zurich — neither of which is an EU member state**. So "Europe"
  in the dashboard is **not** the same answer as "the EU". Both are UK-adequate, but record the specific
  region, not the grouping.
- **Action:** ✅ Region resolved. ✅ DPA basis verified. **Remaining:** an accountability review mapping
  which of the 24 published subprocessors actually touch PlayPlanner data, and where they operate — the
  published list carries no country column, so that cannot be read off it. **Documented safeguards exist;
  this is an accountability exercise, not a missing mechanism.**

### Stripe
- **Originating jurisdiction:** UK
- **Legal entity (PUBLICLY VERIFIED 2026-09-02):** DPA §1 — *"If User's Stripe Account is located in North
  America or South America, User enters this DPA with Stripe, LLC. If User's Stripe Account is located
  elsewhere, User enters this DPA with Stripe Payments Europe, Limited ('SPEL')."* A UK account →
  **SPEL (Ireland)**. Stripe Payments UK Ltd only becomes an additional party under specific Financial
  Services Terms.
- **Role (PUBLICLY VERIFIED):** **Both.** Processor for instructed payment processing; **independent
  controller** for fraud detection and AML/KYC (DPA §2). The controller leg is Stripe's own processing —
  PlayPlanner cannot contract it away, and it must be disclosed as such, not described as "our processor".
- **Destination jurisdiction(s) (PUBLICLY VERIFIED):** UK → Ireland (SPEL), with onward transfer to
  **Stripe, LLC in the United States** — DTA §3 expressly covers data *"originating from the EEA, the UK
  or Switzerland to Stripe in the United States"*.
- **Adequacy available?** UK→Ireland is UK-adequate. The US leg needs a mechanism.
- **Transfer mechanism — ✅ SUBSTANTIALLY VERIFIED (corrected 2026-09-02):** Data Transfers Addendum
  (**18 Nov 2025**) §3 = **DPF** (*"Stripe, LLC is self-certified under the Data Privacy Framework"*),
  §4 = **EEA SCCs Modules 1, 2 and 3**, §5 = **"UK International Data Transfer Addendum"**.
  **The UK route is independently confirmed by Stripe's own official DPA FAQ**, retrieved verbatim this
  pass: *"On 21 March 2022, the Information Commissioner's Office's International Data Transfer Agreement
  and the amended Addendum to the SCCs ('UK International Data Transfer Addendum') came into force in the
  UK. **For transfers of personal data from the UK, the UK International Data Transfer Addendum is
  incorporated into Stripe's** [Data Transfers Addendum]."*
  🔴 **Correction:** the previous entry treated §5's unreadable body text as a live legal gap. **That was
  wrong** — the truncation is a retrieval limitation of automated fetching, and the FAQ confirms
  incorporation independently. **This is no longer an open blocker.**
- **DPF status — stated, not independently verified.** Stripe's policy page (effective 28 Apr 2026) states
  Stripe, LLC complies with the EU-US DPF, the **UK Extension** and the Swiss-US DPF. The authoritative
  register cannot be fetched programmatically. **This matters less than it did**, because the UK route
  does **not** depend solely on DPF — the UK IDTA is separately incorporated (above). **Verify DPF only if
  reliance on DPF specifically is proposed.**
- **Onward subprocessors:** published list, updated **20 December 2025**.
- **Action:** Confirm the account's **Stripe Account Country** → contracting entity. That is the only
  genuinely account-specific item left.

### Expo (EAS build tooling + Push relay)
- **Originating jurisdiction:** UK
- **Legal entity (PUBLICLY VERIFIED 2026-09-02):** **650 Industries, Inc.**, terms governed by California
  law. US destination.
- **Scope note:** **EAS Update is NOT in use** — no `updates`, `runtimeVersion` or `channel` configuration
  exists in `app.json`/`eas.json` (verified this pass). Only **EAS Build** and the **Push relay** are live,
  and only the Push relay touches end-user personal data.
- **What actually transfers (from our own code):** `notify-review-published/index.ts:177-192` sends the
  ExpoPushToken plus `"Your review of ${venueName} is now live."` and `{ venueId }`. Expo states it
  **stores tokens** and that payloads are *"never stored… only handle that data as long as it takes to
  send the notification"* — Expo's own representation, not independently auditable.
- **Transfer mechanism — 🔴 CORRECTED 2026-09-02. The previous entry here was an overstatement and is
  withdrawn.** It read *"THE WEAKEST ROW IN THE REGISTER… no UK Addendum, no IDTA, no UK Extension… a
  concrete, identified gap"*. That conclusion was drawn from the **Terms of Service alone**. Expo's
  **Privacy Policy** states verbatim: *"Expo complies with the EU-U.S. Data Privacy Framework, **the UK
  Extension to the EU-U.S. Data Privacy Framework**, and the Swiss-U.S. Data Privacy Framework… We have
  self-certified to the U.S. Department of Commerce that we adhere to the EU-U.S. Data Privacy Framework
  Principles, the UK Extension…"*
  **Correct current position:** `Expo publicly states participation in the UK Extension; ACTIVE
  CERTIFICATION AND SCOPE MUST STILL BE VERIFIED AGAINST THE OFFICIAL DPF PARTICIPANT LIST BEFORE
  RELIANCE.` **Do not mark `UK TRANSFER BLOCKED — NO MECHANISM`** unless the official list positively
  shows the certification inactive, expired, or not covering this processing.
  *(Also noted in the Privacy Policy: Expo says that where it must transfer data to provide a Service it
  *"may rely on the derogation 'transfer necessary for the performance of a contract', as permitted by
  law"* — a derogation, not a primary mechanism, and not something to lean on.)*
- **DPF — STATED BUT NOT VERIFIED.** `dataprivacyframework.gov` returns only a **2,116-byte JavaScript
  shell** to any automated request (three different endpoints attempted this pass), so no participant
  record is retrievable programmatically. The **legacy** Privacy Shield record for 650 Industries shows
  *"Next Certification Due: November 15, 2024"*, but **Privacy Shield was invalidated in 2020 and that
  record is evidence of nothing, in either direction.** A browser check is required.
- **⚠️ Keep this separate from Article 28.** An active UK Extension certification would satisfy the
  *transfer* question and would do **nothing** for the *processor-contract* question — see
  `PROCESSOR_AND_VENDOR_REGISTER.md` §3a, which remains
  `OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED` on specific, identified grounds.
- **Onward subprocessors (PUBLICLY VERIFIED):** list updated **17 August 2026**, naming **Google** and
  **Apple** expressly for *"push notifications"* — i.e. the FCM/APNs leg is a documented onward transfer,
  also to the US.
- **Action:** (1) **Verify 650 Industries, Inc. on the official DPF list in a browser** — that closes the
  transfer question either way. (2) Separately, ask Expo what the SCC **Annexes** are deemed to contain for
  Push, and whether Arts 35–36 assistance is offered — that is the Article 28 question, and it is the one
  with no public answer.

### GitHub Pages
- **Originating jurisdiction:** UK (visitors to the privacy/terms pages)
- **Destination jurisdiction(s):** `UNKNOWN — MUST VERIFY` — GitHub is a Microsoft subsidiary, US-based,
  with global CDN infrastructure for Pages
- **Materiality:** Low — the only personal data at stake is incidental visitor access-log data, which
  GitHub controls, not PlayPlanner-collected personal data being sent to GitHub. **Not a priority
  verification item** relative to Supabase/Stripe/Expo, but recorded for completeness.

### Google (Maps SDK) — **role corrected 2026-09-02**
- **Originating jurisdiction:** UK
- **Role (PUBLICLY VERIFIED — CORRECTED):** **Independent controller, not a processor.** Maps Platform ToS
  §4.4(b)/EEA §4.5 bind both parties to the **Google Controller-Controller Data Protection Terms**
  (**v11, 7 May 2026**), which state *"each party: (a) is an independent controller of Controller Personal
  Data"*. Google's service-classification page (27 Apr 2026) lists **Google Maps APIs as a Controller
  Service** and not among the Article 28 Data Processing Services. This is a **disclosure to a separate
  controller**, not a processor transfer — which changes what makes it lawful.
- **Entity structure (PUBLICLY VERIFIED — a three-way split, do not collapse it):**
  - Agreement contracting entity for a UK customer: **Google Cloud EMEA Limited** (*"EMEA except France,
    Italy and Poland"*).
  - **UK** End Controller under the Controller Terms: **Google LLC** (§5.2 — *"Partner as data exporter
    will be deemed to have entered into the Controller SCCs with Google LLC… as data importer"*).
  - **EEA** End Controller: **Google Ireland Limited**.
- **Transfer mechanism:** Google's own **Controller SCCs**, plus DPF — *"The Data Privacy Framework will
  apply to any Restricted European Transfer to a certified Google entity in the US."* Note the Controller
  Terms contain **no "UK Addendum" or "IDTA" wording**; the UK route runs through the Controller SCCs with
  Google LLC. Google's DPF certification status still warrants a live check rather than assumption.
- **Onward subprocessors:** **Not applicable** — the word "subprocessor" appears **zero times** in the
  Controller-Controller Terms. Under controller-to-controller terms there is no processor→subprocessor
  chain to disclose. Google's published subprocessor list covers only its Article 28 services.
- **🔴 Materiality — CORRECTED, was understated.** The previous entry said *"only map viewport/bounds data
  is sent, not exact user location"*. **Google's own ToS §4.4(a) contradicts this:** *"Google collects and
  receives data from Customer and End Users… including **search terms, IP addresses, and
  latitude/longitude coordinates**."* And our own map sets `showsUserLocation` (`map.tsx:1437`), handing
  the native SDK the device position outside our coarsening pipeline. **Materiality is moderate-to-high,
  not low**, and it is the transfer with the weakest *transparency* position — the in-app notice does not
  name Google as a recipient of location data at all.

### Geoapify and OpenStreetMap — **not international transfers in the Article 44 sense**

**This is the most important structural clarification in this register.** Both Geoapify and OpenStreetMap
are **sources PlayPlanner receives data from**, not destinations PlayPlanner sends personal data to (see
`PROCESSOR_AND_VENDOR_REGISTER.md` rows 4-5 — confirmed this session that Geoapify is called only from
offline enrichment scripts, and OSM is accessed directly via the Overpass API, independently of Geoapify).

**UK/EU GDPR's international-transfer restrictions (Art.44 UK GDPR / Chapter V EU GDPR) govern a
controller/processor established in the UK/EU *exporting* personal data to a third country — they do not
apply to importing/collecting data from a third-country source.** Receiving a sole trader's business
contact details from a US- or EU-hosted API is a **collection** question (governed by lawful basis,
Article 14 transparency, and data minimisation — all already covered in
`docs/DPIA_website_enrichment_addendum.md` and `docs/LIA_venue_enrichment.md`), not a **transfer**
question requiring an IDTA, SCCs, or a DPF check.

**Do not require an international-transfer mechanism for Geoapify or OSM — that would be solving the
wrong problem.** The right document for these two is the enrichment DPIA/LIA, not this register.

---

## Summary table

*Rebuilt 2026-09-02 from primary vendor sources. "Publicly verified" means I read it in the vendor's own
current terms; "account-specific" means only Liam can confirm it.*

*Rebuilt again 2026-09-02 (Vendor Compliance Correction Pass). **Transfer mechanism and Article 28 are
tracked as separate columns on purpose** — merging them produced a wrong finding in the previous draft.*

| Vendor | Entity / role | Destination | **Transfer mechanism** | **Art.28 contract** | Still account-specific |
|---|---|---|---|---|---|
| **Supabase** | Supabase Pte. Ltd. (SG) contracts; Supabase, Inc. (DE, US) in privacy policy · **processor** | ✅ **`eu-west-2` — LONDON, UK.** Primary store is UK-domestic | ✅ **No restricted transfer for the primary store.** For anything outside the UK: EU SCCs **M2+M3 + UK Addendum**; UK GDPR is within the DPA's GDPR definition | ✅ **VERIFIED** — DPA v1 (1 Aug 2026) auto-incorporated; written protections on subprocessors | Onward-transfer/subprocessor accountability review |
| **Stripe** | **SPEL (Ireland)** for a UK account · **processor + independent controller** (fraud, AML/KYC) | Ireland → **Stripe, LLC (US)** | ✅ **VERIFIED** — DTA §3 DPF, §4 EEA SCCs M1/2/3, **§5 UK IDTA, confirmed by Stripe's official DPA FAQ** | ✅ **VERIFIED** — DPA (18 Nov 2025) auto-incorporated via SSA §4.1 | **Account Country → contracting entity.** DPF check only if DPF is relied on |
| **Expo** | 650 Industries, Inc. (US) · processor per its own ToS §3.2 | US, onward to **Google + Apple** for push | 🟡 **STATED, UNVERIFIED** — Expo's Privacy Policy claims **UK Extension** DPF self-certification. **Verify on the official list before reliance. Do NOT record as blocked.** | 🟠 **`OWNER/VENDOR/LEGAL CONFIRMATION REQUIRED`** — SCC M2 incorporated but **Annex I.B + Annex II unpopulated**, Push never named, **no Art.35–36 assistance** | DPF register check; Annex contents for Push; plan |
| **Google Maps** | Agreement: **Google Cloud EMEA Ltd** · UK End Controller: **Google LLC** · EEA: **Google Ireland Ltd** · ⚪ **independent controller** | US / global | ✅ Google **Controller SCCs** + DPF (Controller Terms v11, 7 May 2026) | ⚪ **N/A — controller-to-controller.** Art.28 is the wrong instrument | Billing-account contracting entity |
| GitHub Pages | Microsoft/GitHub (US) | US/global CDN | Low materiality — visitor access logs only | Low priority | Low priority |
| Geoapify / OSM | N/A — **inbound sources** | N/A | **Not a transfer question at all** | N/A | None — enrichment DPIA/LIA governs |

**What changed, and why it matters:**

- **Supabase is now the strongest row in the register, not the most uncertain one.** The primary store is
  in the UK; the contract carries a UK Addendum for everything else. What remains is bookkeeping.
- **Stripe's UK route is closed.** The earlier "§5 unreadable" caveat was a tooling artefact, not a gap.
- **Expo's two questions now point in different directions** — its *transfer* position is probably fine
  (pending a register check), while its *Article 28* position has specific, named shortfalls. **An
  adequacy or DPF mechanism does not satisfy Article 28, and never will.** Neither finding should be used
  to argue the other.
- **Google Maps remains outside the Art.28 frame** and is still the transfer with the weakest
  **transparency** rather than contractual position — the mechanism is sound; users were simply never told
  Google receives their location. That is being fixed in the notices, not in a contract.

**None of these gaps are assessed as blocking synthetic-data staging** (no real personal data moves
anywhere in that scenario) **or current production operation** (the existing vendor relationships
predate this audit and are already running — this register's job is to close the accountability gap, not
to imply the current live payment/hosting flow is itself unlawful). They **should** be closed out before
any formal DPIA/LIA sign-off that relies on "our transfers are properly documented" as a stated fact,
since right now that fact is mostly `UNKNOWN — MUST VERIFY`, not confirmed either way.
