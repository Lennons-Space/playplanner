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
- **Destination jurisdiction(s):** `UNKNOWN — MUST VERIFY`. As recorded in `PROCESSOR_AND_VENDOR_REGISTER.md`,
  the existing DPIA's claim of "AWS eu-west-2 Ireland, confirmed in app config" could **not** be
  re-verified from the current repo this session — `supabase/config.toml` contains no region string.
  **If the project is genuinely hosted in the EU/EEA (Ireland), this is not an international transfer
  requiring any UK-outbound mechanism at all** — UK-to-EEA transfers are not restricted (the EU forms
  part of the UK's adequacy regulations). **If it turns out to be hosted in the US or elsewhere, the
  analysis below for a non-adequate destination would apply instead.** This single unresolved fact
  changes the entire shape of this register's most important row — resolve it first.
- **Adequacy available?** Yes, if EEA-hosted (EU/EEA is UK-adequate). `UNKNOWN — MUST VERIFY` otherwise.
- **DPF/UK Extension applicable?** Not applicable if EEA-hosted; `UNKNOWN — MUST VERIFY` if US-hosted.
- **UK IDTA / Addendum to EU SCCs required?** Not if EEA-hosted. `UNKNOWN — MUST VERIFY` otherwise.
- **Subprocessors causing onward transfer?** `UNKNOWN — MUST VERIFY` against Supabase's published
  sub-processor list — AWS itself operates globally, and even an EEA *primary* region does not
  automatically rule out an onward transfer via a sub-processor elsewhere.
- **Action:** **Resolve the hosting region first** (check the live Supabase project dashboard, not this
  repo) — everything else in this row depends on that one fact.

### Stripe
- **Originating jurisdiction:** UK
- **Destination jurisdiction(s):** `UNKNOWN — MUST VERIFY` — Stripe, Inc. is US-headquartered; UK/EU
  merchants are typically served by a Stripe European entity for much of the processing, with some
  onward flow to the US parent for certain functions. The exact split is Stripe's to document, not
  something to assume here.
- **Adequacy available?** Only for the EU-based portion, if any.
- **EU-US DPF applicable? UK Extension applicable?** `UNKNOWN — MUST VERIFY` — check Stripe, Inc.'s actual
  current certification status directly on dataprivacyframework.gov before relying on this.
- **UK IDTA / Addendum required?** `UNKNOWN — MUST VERIFY` — depends on the DPF check above; if DPF/UK
  Extension coverage is not confirmed for the relevant entity and transfer, an IDTA or the UK Addendum to
  the EU SCCs would be the fallback mechanism, which Stripe would need to offer as part of its DPA.
- **Transfer-risk assessment required?** Yes, if relying on SCCs/IDTA rather than adequacy/DPF — not yet
  done.
- **Action:** Check Stripe's current DPF/UK Extension certification; obtain/confirm Stripe's DPA and its
  stated transfer mechanism for UK merchants.

### Expo (EAS build tooling + Push relay)
- **Originating jurisdiction:** UK
- **Destination jurisdiction(s):** `UNKNOWN — MUST VERIFY` — 650 Industries, Inc. is a US company
- **DPF/UK Extension applicable?** `UNKNOWN — MUST VERIFY` — check the official list directly
- **UK IDTA / Addendum required?** `UNKNOWN — MUST VERIFY`, contingent on the above
- **Action:** As noted in the processor register, this is the vendor with the least established
  contractual picture at all — resolve the Art.28 question there before or alongside this transfer
  question, since they're the same underlying investigation (check Expo's actual DPA/terms for the Push
  service specifically)

### GitHub Pages
- **Originating jurisdiction:** UK (visitors to the privacy/terms pages)
- **Destination jurisdiction(s):** `UNKNOWN — MUST VERIFY` — GitHub is a Microsoft subsidiary, US-based,
  with global CDN infrastructure for Pages
- **Materiality:** Low — the only personal data at stake is incidental visitor access-log data, which
  GitHub controls, not PlayPlanner-collected personal data being sent to GitHub. **Not a priority
  verification item** relative to Supabase/Stripe/Expo, but recorded for completeness.

### Google (Maps SDK)
- **Originating jurisdiction:** UK
- **Destination jurisdiction(s):** `UNKNOWN — MUST VERIFY` — Google LLC is US-based with global
  infrastructure; Google Maps Platform's own terms should state the applicable transfer mechanism
- **DPF/UK Extension applicable?** `UNKNOWN — MUST VERIFY` — Google LLC's DPF status should be checked
  directly rather than assumed given its scale/prominence
- **Materiality:** Low-to-moderate — only map viewport/bounds data is sent, not exact user location in
  the request body (per the existing DPIA's technical finding, not contradicted this session)

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

| Vendor | Destination confirmed? | Mechanism status | Blocks anything today? |
|---|---|---|---|
| Supabase | **No — resolve first** | Depends entirely on the unresolved region question | Not currently, since no real production personal-data processing is paused on this — but should be resolved before any confident public claim about data residency is made |
| Stripe | No | `UNKNOWN — MUST VERIFY` | No — existing live payment flow already runs; this is an accountability gap to close, not something currently unlawful, since Stripe's own compliance programme very likely covers this — it just isn't *verified* here |
| Expo | No | `UNKNOWN — MUST VERIFY`, weakest entry | No — same reasoning as Stripe |
| GitHub Pages | No | Low priority | No |
| Google Maps | No | `UNKNOWN — MUST VERIFY` | No |
| Geoapify / OSM | N/A | **Not a transfer question at all** | No — governed by the enrichment DPIA/LIA instead |

**None of these gaps are assessed as blocking synthetic-data staging** (no real personal data moves
anywhere in that scenario) **or current production operation** (the existing vendor relationships
predate this audit and are already running — this register's job is to close the accountability gap, not
to imply the current live payment/hosting flow is itself unlawful). They **should** be closed out before
any formal DPIA/LIA sign-off that relies on "our transfers are properly documented" as a stated fact,
since right now that fact is mostly `UNKNOWN — MUST VERIFY`, not confirmed either way.
