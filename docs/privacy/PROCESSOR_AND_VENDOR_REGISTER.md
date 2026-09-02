# Processor and Third-Party Vendor Register — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED**
**Date:** 2026-09-01 · Includes the Article 28 processor-contract audit (Liam's §5) as a column set
rather than a separate document, since every row needs the same assessment.
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

A **MISSING** classification for any vendor that actually receives personal data is a **production
blocker** per Liam's instruction — none were found this session, but see the per-vendor notes for items
that are **UNKNOWN** rather than confirmed **PASS**, which still need closing out before this register can
honestly read all-green.

---

## 1. Supabase — Postgres, Auth, Storage, Edge Functions

| | |
|---|---|
| **Relationship** | **Processor** — Supabase processes personal data on PlayPlanner's documented instructions (this is the textbook processor relationship; not in doubt) |
| **Personal data received** | Effectively all of it — this is the primary datastore (see `ROPA.md`, every row) |
| **Processing purpose** | Hosting, authentication, database, file storage, serverless functions |
| **Processing location(s)** | `UNKNOWN — MUST VERIFY`. `docs/DPIA.md` (2026-06-08) asserts "AWS EU (eu-west-2 Ireland region, confirmed in app config)" — **this session's fresh audit of `supabase/config.toml` found no region string anywhere in it** (the file only configures Edge Function `verify_jwt` settings). This is either (a) configured only in the Supabase dashboard, not in this repo, or (b) a stale/unverifiable claim in the existing DPIA. **Do not repeat the "confirmed" framing until someone actually checks the live Supabase project settings.** |
| **Sub-processors** | Supabase's own sub-processor list (AWS, at minimum) — `UNKNOWN — MUST VERIFY` against Supabase's published sub-processor page |
| **DPA/Art.28 terms** | **CONTRACT/DPA EXISTS — MANUAL ACCEPTANCE CHECK.** Supabase publishes a standard DPA covering GDPR processor obligations for all customers on request/acceptance — whether PlayPlanner's account has actually accepted it is not visible from this repo |
| **Deletion/return obligations** | `UNKNOWN — MUST VERIFY` against Supabase's DPA terms and PlayPlanner's actual account tier |
| **Security terms** | Supabase publishes SOC 2 Type II attestations generally; whether this specific account's tier includes the relevant assurances is `UNKNOWN — MUST VERIFY` |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` — depends entirely on resolving the hosting-region question above first |
| **Verification still required** | Confirm actual project region in the Supabase dashboard; confirm DPA acceptance status; confirm sub-processor list |

## 2. Stripe — payment processing

| | |
|---|---|
| **Relationship** | For payment processing itself, Stripe is generally treated as an **independent controller** for its own regulatory (AML/KYC, tax reporting) purposes, while acting as a **processor** for the parts of the flow PlayPlanner instructs (e.g. Checkout Session configuration) — this dual role is standard for payment processors and should be confirmed against Stripe's own DPA framing rather than asserted here as settled |
| **Personal data received** | Whatever Stripe Checkout itself collects (name, email, card details) — PlayPlanner's own server code only stores back `stripe_customer_id`/`stripe_subscription_id`, not card data |
| **Processing purpose** | Payment processing, subscription billing |
| **Processing location(s)** | `UNKNOWN — MUST VERIFY` — Stripe is US-headquartered with global processing infrastructure; the specific entity/region handling UK transactions should be confirmed against Stripe's own documentation for UK merchants |
| **Sub-processors** | `UNKNOWN — MUST VERIFY` against Stripe's published sub-processor list |
| **DPA/Art.28 terms** | **CONTRACT/DPA EXISTS — MANUAL ACCEPTANCE CHECK** — Stripe's DPA is incorporated into its standard Services Agreement for all merchants; whether this needs a separate signature/acceptance step for this account is `UNKNOWN — MUST VERIFY` |
| **Deletion/return obligations** | `UNKNOWN — MUST VERIFY` |
| **Security terms** | Stripe holds PCI-DSS Level 1 certification generally (industry-standard, high confidence) — not independently re-verified this session |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` — **do not assume DPF coverage without checking Stripe, Inc.'s actual current certification status on the official DPF list** |
| **Verification still required** | Confirm Stripe's current DPF/UK Extension certification status directly on dataprivacyframework.gov; confirm DPA acceptance |

## 3. Expo / EAS — build tooling and push notification relay

| | |
|---|---|
| **Relationship** | **Processor**, for two distinct things: (a) EAS build/deploy tooling (handles source code and build artifacts, not end-user personal data in the GDPR sense), and (b) the **Expo Push relay**, which at runtime receives a real end-user's device push token plus notification text (confirmed this session: `supabase/functions/notify-review-published/index.ts:188` posts to `https://exp.host/--/api/v2/push/send`) — **this second role is the one that actually matters for Art.28** |
| **Personal data received** | Device push token (pseudonymous device identifier) + notification text (e.g. a review title) — not email, not account identity directly, but a push token is personal data where it can be linked to an individual via `push_tokens.user_id` |
| **Processing purpose** | Delivering push notifications |
| **Processing location(s)** | `UNKNOWN — MUST VERIFY` — Expo (650 Industries, Inc.) is a US company |
| **Sub-processors** | `UNKNOWN — MUST VERIFY` |
| **DPA/Art.28 terms** | **UNKNOWN** — not established this session whether Expo publishes/offers a standard DPA for the Push service specifically (as distinct from EAS build services) |
| **Deletion/return obligations** | `UNKNOWN — MUST VERIFY` |
| **Security terms** | `UNKNOWN — MUST VERIFY` |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` |
| **Verification still required** | Confirm whether Expo offers a DPA for the Push relay specifically; this is the one vendor in this register where even the *existence* of a processor agreement is unconfirmed, not just its acceptance status — **treat as the nearest thing to a MISSING finding in this register until checked** |

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

| | |
|---|---|
| **Relationship** | **Processor**, narrowly, for map-tile requests — confirmed this session (and in a prior pass): `react-native-maps` + API keys configured via `GOOGLE_MAPS_API_KEY_IOS`/`GOOGLE_MAPS_API_KEY_ANDROID` (`app.json`, `app.config.js`). No Firebase, no Play Billing, no Google Analytics, no Sign-in-with-Google found anywhere. |
| **Personal data received** | Map viewport/bounds for tile fetching — **not** the user's exact position in the request body (confirmed in the existing DPIA's technical description and not contradicted by anything found this session) |
| **DPA/Art.28 terms** | **CONTRACT/DPA EXISTS — MANUAL ACCEPTANCE CHECK** — Google Maps Platform's standard terms incorporate data-processing terms for all API customers |
| **International transfer mechanism** | See `INTERNATIONAL_TRANSFERS.md` |
| **Verification still required** | Confirm Google Maps Platform's current DPA acceptance status for this specific API key/account |

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

| Vendor | Personal data flows to them? | Art.28 classification | Action needed |
|---|---|---|---|
| Supabase | Yes — the primary datastore | CONTRACT/DPA EXISTS — MANUAL CHECK | Confirm region + DPA acceptance |
| Stripe | Yes — payment flow | CONTRACT/DPA EXISTS — MANUAL CHECK | Confirm DPF status + DPA acceptance |
| Expo (Push) | Yes — device token + notification text | **UNKNOWN — the weakest entry in this register** | Confirm whether a DPA even exists for the Push service |
| GitHub Pages | Minimal (visitor IP only) | CONTRACT/DPA EXISTS — MANUAL CHECK | Low priority |
| Google Maps | Marginal (viewport/bounds) | CONTRACT/DPA EXISTS — MANUAL CHECK | Confirm DPA acceptance |
| Geoapify | No (data flows inbound, not outbound) | NOT APPLICABLE | None — different legal question, covered in enrichment DPIA |
| OpenStreetMap | No (data flows inbound, not outbound) | NOT APPLICABLE | None — attribution/licence matter, not Art.28 |
| Apple | N/A — not integrated | N/A | None |
| Analytics/monitoring | N/A — not integrated | N/A | None |

**No vendor in this register is classified MISSING** (i.e. no vendor is confirmed to be receiving personal
data with *no* processor agreement of any kind) — but **Expo's Push relay is the one entry that could turn
out to be MISSING once actually checked**, since even the existence of an applicable DPA is unconfirmed
here, not just its acceptance status. This is the single highest-priority manual check in this register.

---

## Manual verification pack (new 2026-09-01, Privacy-Critical Engineering Remediation Pass)

Concrete, one-owner-action-each checklist — none of these were checked against live vendor
accounts/dashboards this pass (that access sits outside this repository entirely). **Do not mark any of
these PASS until the actual account/entity facts below are verified — a plausible assumption is not a
verified fact.**

### Supabase
- [ ] Actual project region (Supabase dashboard → Project Settings → General/Infrastructure) — resolves
      the single most consequential open question in `INTERNATIONAL_TRANSFERS.md`.
- [ ] Confirm the applicable Supabase DPA has actually been accepted for this account (not just that
      Supabase publishes one generally).
- [ ] Pull Supabase's current published sub-processor list and check it against this register.
- [ ] Confirm Supabase's stated international-transfer mechanism/terms for this account's region.

### Stripe
- [ ] Confirm the DPA is in place for this specific Stripe account (Stripe Dashboard → legal/compliance
      settings, or direct request to Stripe support).
- [ ] Identify the exact contracting entity (Stripe, Inc. vs. a regional Stripe entity — this affects
      which jurisdiction's terms actually govern).
- [ ] Check Stripe's current DPF **and** UK Extension certification status directly on
      dataprivacyframework.gov before relying on either for any transfer.
- [ ] Pull Stripe's current sub-processor list.

### Expo / EAS / Push
- [ ] Confirm whether an applicable DPA exists **at all** for the Expo Push relay specifically (as
      distinct from EAS build-tooling terms) — this is the weakest-evidenced vendor relationship in this
      entire register.
- [ ] Confirm whether Push-relay processing (device token + notification text) is covered by whatever DPA
      does exist, explicitly — don't assume a build-tooling DPA extends to the Push service.
- [ ] Confirm Expo/650 Industries, Inc.'s processing locations.
- [ ] Confirm Expo's sub-processor list and stated transfer mechanism.

### Google (Maps + any Play-related terms)
- [ ] Confirm Google Maps Platform's DPA acceptance status for the API key/account in use.
- [ ] Confirm Google's processor vs. controller role is understood correctly for each Google service
      actually used (Maps only, per this register — no Play Billing, no Firebase, no Analytics currently
      integrated, confirmed repeatedly this session).
- [ ] Confirm Google LLC's current DPF/UK Extension certification status if relied upon for any transfer
      mechanism, rather than assumed given the company's scale.

**Until every box above is checked, this register's overall verdict remains `MANUAL VERIFICATION
REQUIRED`, not `PASS` — consistent with the compliance gate's original verdict for this area.**
