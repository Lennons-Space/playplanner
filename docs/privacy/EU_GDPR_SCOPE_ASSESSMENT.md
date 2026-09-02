# EU GDPR Territorial-Scope Assessment (Article 3) — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01
**Interpretive baseline:** EDPB Guidelines 3/2018 on the territorial scope of the GDPR — confirmed this
session (legal research fork) as still current, with no superseding EDPB document found. **REGULATOR
GUIDANCE**, not itself binding law, but the standard interpretive framework regulators and courts use.

---

## The test, applied honestly

Article 3(1) (establishment) does not apply — PlayPlanner has no EU office, subsidiary, or stable
arrangement in any EU/EEA member state; it is a UK sole-trader operation. **Not seriously contestable.**

Article 3(2)(a) — "offering goods or services... to data subjects in the Union" — is the live question.
EDPB 3/2018's own framing, confirmed by this session's research: **mere accessibility of a website, an
email address, or contact details from the EU is explicitly stated as INSUFFICIENT on its own.** The test
looks for evidence of **intention to target** EU-based individuals specifically. Relevant factors EDPB
lists include: currency/language used (especially a language not used in the controller's home state, or
allowing EU-specific currency); mentioning EU-based users/customers; an EU top-level domain; delivery to
EU member states; running marketing/advertising directed at an EU audience.

## Applying this to PlayPlanner, factor by factor (evidence, not inference)

| Factor | Evidence | Points toward EU targeting? |
|---|---|---|
| EU establishment | None found anywhere in `app.json`, terms, or company registration references | No |
| Currency/pricing | `constants/pricing.ts` — `UNKNOWN — MUST VERIFY exact currency`, but every prior session's review of business pricing has referred to GBP context only; no EUR pricing tier found | No evidence of Yes |
| Language | English only, UK spelling/register throughout (`docs/terms.html`, `docs/privacy.html`, in-app copy) — not multi-language, not EU-market-localised | No |
| Domain | `.app` TLD, not an EU ccTLD | No |
| Explicit market statement | `docs/terms.html:118`: **"PlayPlanner is currently available to residents of the United Kingdom only. We will announce when we expand to other regions."** This is a direct, contemporaneous, documented statement **against** EU targeting — about as clean a piece of evidence as this kind of assessment ever gets. | **Strongly No** |
| Venue data scope | Every venue-data pipeline (import, enrichment, OSM/Geoapify queries) reviewed this session and in prior sessions concerns UK venues — no EU-venue coverage found | No |
| Marketing | No advertising spend, no EU-directed campaign, no localisation effort found anywhere in the repo | No |
| Delivery/fulfilment to EU | Not applicable — this is a directory/discovery app with UK business subscriptions, not a goods-delivery service | No |

**No factor points toward intentional EU targeting. One factor (the explicit "UK only" statement) points
directly and strongly against it.**

## Output

**`NO CURRENT EVIDENCE THAT ARTICLE 3(2) IS TRIGGERED — SUBJECT TO DISTRIBUTION/TARGETING VERIFICATION`**
(wording aligned 2026-09-01 — see the Conclusion section for the full restated form and the reason for
this phrasing)

This is a factual, evidence-based conclusion for the **current** product as inspected this session — it
is not a permanent architectural guarantee, and it would need to be revisited the moment any of the
following becomes true: EU pricing/currency is added; the app is localised into another EU language;
marketing is run toward an EU audience; the "UK only" statement is removed or changed; or venue coverage
is deliberately extended to EU countries.

**The mere accidental presence of an EU user does not, by itself, establish Art.3(2) targeting** (per
EDPB 3/2018, confirmed above) — so an EU tourist opening the app while in the UK, or a UK expat in the EU
still using their UK-registered account, does not change this conclusion.

---

## If Article 3(2) becomes applicable in future — design PlayPlanner to remain compatible now

Per Liam's instruction, this section prepares for that scenario **without claiming it currently applies**.

### Article 27 EU representative
**LAW**, with a narrow exemption under Art.27(2) — confirmed this session as a **cumulative three-part
test**: (a) the processing is **occasional**, (b) does not include large-scale special-category/criminal
data, and (c) is unlikely to result in a risk to data subjects' rights. **Regulatory interpretation treats
"occasional" narrowly — most regular commercial digital services would not qualify**, per this session's
research. **If Article 3(2) ever becomes applicable to PlayPlanner** (i.e., EU targeting begins), the
service would almost certainly need an **EU representative** rather than being able to rely on the
Art.27(2) exemption, given it would by then be a regular, ongoing commercial service to EU users, not an
occasional one-off processing activity. **This should not be treated as a foregone conclusion without
legal review at the time**, but the current default assumption should be "representative required," not
"exemption available."

### EU privacy-notice implications
If EU targeting begins, the privacy notice would need EU-specific content: the EU representative's
identity/contact, and any divergence between UK and EU rights mechanics (see Article 22 below) stated
clearly for EU data subjects specifically, not silently merged into UK-only language.

### EU supervisory-authority implications
An EU data subject would have the right to lodge a complaint with their own national supervisory
authority (or the lead authority, if PlayPlanner had an EU main establishment — which, per Article 3(1)
above, it would not, so the "one-stop-shop" lead-authority mechanism would likely not apply, and **each
national authority could potentially take an interest independently** — worth flagging as a real
complexity, not something the current UK-only single-authority relationship prepares for).

### EU Article 22 — confirmed distinct from the UK's 22A–22D model
**LAW.** Confirmed this session: EU GDPR's Article 22 is **unchanged** — a general **prohibition by
default** on solely-automated decisions with legal or similarly significant effect, subject to the
original narrow exceptions (contract necessity, authorisation by law, explicit consent). The UK's DUAA
2025 replaced the equivalent UK provision with **Articles 22A–22D** (in force 5 February 2026) — a
**permission-with-safeguards-by-default** model instead. **This is a genuine, confirmed divergence, not a
stale assumption**: an EU data subject retains a stricter, prohibition-based right than a UK data subject
does under the current UK regime. **Practical implication if EU scope is ever triggered:** the enrichment
architecture's Art.22A-22D analysis (`docs/DPIA_website_enrichment_addendum.md` §11) would need a
**separate EU-specific re-assessment against the stricter EU Article 22 test**, not an assumption that
"we already checked this for the UK, so we're fine for the EU too." The architecture's actual safeguards
(human-only publication, human-only confirmed closure) are strong enough that they would likely satisfy
either regime's test — but that is an assessment to make explicitly if the question ever becomes live, not
to assume now.

### EU international-transfer rules
If EU data subjects' data were ever processed, the transfer analysis in `INTERNATIONAL_TRANSFERS.md`
would need an EU-specific parallel track — EU SCCs (not just the UK IDTA/Addendum) for any EU-outbound
transfer to a non-adequate country, assessed under EU adequacy decisions, which are **not identical** to
the UK's adequacy list even though they substantially overlap (the EU-US DPF itself, for example, is a
separate EU Commission adequacy decision from the UK Extension, per the international-transfers register's
own findings).

---

## Conclusion

> **✅ WORDING UPDATE (2026-09-01, Privacy-Critical Engineering Remediation Pass):** the conclusion below
> is restated in the precise, appropriately-conditional form Liam specified, replacing the earlier
> unconditional phrasing. **The underlying evidence and analysis are UNCHANGED** — this is a wording
> correction for legal precision, not a re-assessment; nothing new was found this pass that bears on EU
> scope. Distribution/targeting facts (Play/App Store territories, any paid EEA marketing) have NOT been
> independently verified against the live store consoles by either pass — see the manual checklist below,
> which is new this pass.

**`NO CURRENT EVIDENCE THAT ARTICLE 3(2) IS TRIGGERED — SUBJECT TO DISTRIBUTION/TARGETING VERIFICATION`**

This is based on direct, current **code/content** evidence (explicit UK-only market statement in
`docs/terms.html`, UK-only language/currency/venue-coverage, no EU marketing or localisation found
anywhere in the repository). It is explicitly **not** an unconditional legal conclusion that EU GDPR can
never apply — it is conditional on the distribution and marketing facts actually matching what the code
and content suggest, which requires checking systems outside this repository (see the manual checklist
below). It should be re-run the moment any product decision touches EU market expansion, and the
divergences flagged above (Article 27, Article 22 vs 22A-22D, EU-specific transfer mechanisms) should
inform that expansion's design rather than being discovered after the fact.

---

## Manual distribution/targeting checklist (new 2026-09-01 — not independently verified this pass, per
instruction not to inspect Play Console without authorisation)

For Liam to check directly, each one a potential Article 3(2) factor if it turns out to contradict the
"UK only" conclusion above:

1. **Google Play distribution countries** — in Play Console, confirm the app's distribution is actually
   restricted to the UK (or at least excludes EEA member states), not defaulted to worldwide availability.
   A worldwide-available listing, even if unmarketed, is weaker evidence than an explicitly UK-restricted
   one — though per EDPB 3/2018, mere availability still does not by itself establish targeting.
2. **Apple App Store distribution territories** (if/when an iOS build is submitted) — same check, App
   Store Connect's territory availability settings.
3. **Website/service availability** — confirm `lennons-space.github.io/playplanner/*` (the hosted
   privacy/terms pages) carries no EU-specific content, language switcher, or currency selector.
4. **Paid marketing targeting EEA states** — check any ad platform account (Google Ads, Meta, etc., if any
   exist — none were found in this repo, but ad accounts live outside the codebase entirely) for EEA
   country targeting in campaign settings.
5. **Business signup availability to EEA businesses** — confirm the business/venue-owner subscription
   signup flow does not accept, e.g., an EEA business registration number or VAT format, and that Stripe
   Checkout isn't configured to accept EEA billing addresses as a matter of course.
6. **Currency/language localisation** — confirm no EEA currency (EUR) or non-English EU language is
   offered anywhere in the live app or store listings.
7. **EU venue coverage** — confirm the venue directory contains no EU-country venues (a UK-only venue
   database is strong evidence against Article 3(2) targeting; EU venues appearing would at minimum
   require asking why, even if the audience is still UK residents planning a trip).
8. **Monitoring/profiling of individuals located in the EEA** — confirm (as this document already found)
   that no analytics/tracking SDK exists that could constitute "monitoring behaviour" of anyone,
   EEA-located or otherwise (Article 3(2)(b)'s separate limb, distinct from the "offering goods/services"
   limb this document primarily analyses).

**None of these were checked against live systems this pass** (Play Console inspection was explicitly not
authorised) — they are the concrete, actionable list for whoever does have that access.
