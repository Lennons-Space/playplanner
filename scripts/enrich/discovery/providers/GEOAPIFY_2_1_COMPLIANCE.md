# Geoapify Places Discovery — Compliance Research (Enrichment 2.1 Phase D3)

Researched 2026-08-14 directly against Geoapify's own primary documentation
(not the pre-existing code's baked-in assumptions, per instruction). Sources
fetched live this session:

- https://www.geoapify.com/pricing/
- https://www.geoapify.com/terms-and-conditions/
- https://apidocs.geoapify.com/docs/places/

## Findings (primary source, quoted)

| Question | Answer | Source |
|---|---|---|
| Free-tier daily credit allowance | **3,000 credits/day** | pricing page |
| Rate limit | **5 requests/second** | pricing page |
| Cost per operation | **1 credit per 20 places returned** (Places API specifically) | apidocs.geoapify.com/docs/places |
| Attribution — OpenStreetMap | **"you must always provide OpenStreetMap attribution"** | terms-and-conditions |
| Attribution — Geoapify | **"Geoapify attribution is mandatory when using Free subscription plan"** | terms-and-conditions |
| Commercial use, free tier | **"commercial use of the Free-package is allowed in the development and, with some limitations, in the production phase"** — limitations not detailed on the page itself | terms-and-conditions |
| Storage/caching of results | **Not addressed in Geoapify's own terms-and-conditions page at all** — neither permitted nor prohibited explicitly | terms-and-conditions (absence confirmed by direct fetch, not inferred) |
| Bulk collection / anti-scraping | No explicit prohibition; a general clause bars "an unreasonable or disproportionately large load on Geoapify's infrastructure" | terms-and-conditions |
| Places API endpoint | `GET https://api.geoapify.com/v2/places` — category + circle/rectangle/geometry filter, `limit` up to 500, `offset` pagination | apidocs.geoapify.com/docs/places |

A third-party blog (not Geoapify's own site) claims free redistribution/storage
"without any additional limits" — **not corroborated by Geoapify's own terms
page**, which is silent on the question rather than affirmatively permissive.
Per instruction ("use primary Geoapify documentation/terms... do not rely
only on values baked into the old code"), the third-party claim is not
treated as authoritative here.

## Decision: DISABLED BY DEFAULT

Two genuine ambiguities, neither resolved by Geoapify's own published terms:

1. **"Some limitations" in production** — unspecified. PlayPlanner's discovery
   use (persistently storing normalized facts into `venue_discovery_candidates`
   / eventually `venues`) is unambiguously a "production" use once live, not
   development-only testing.
2. **Storage/caching silence** — the terms neither permit nor forbid storing
   Places results long-term in a third-party database. Silence is not
   permission, especially for a feature whose entire point is to publish
   Geoapify-derived facts into PlayPlanner's own public venue records.

Per instruction — *"If anything is uncertain: implement behind configuration
and DISABLE BY DEFAULT... Do not enable a provider when its terms are
ambiguous"* — the Geoapify Places discovery provider is **built, tested, and
wired into the provider architecture, but never included in
`autonomous.ts`'s active provider list by default.** It only activates when
both:

- `GEOAPIFY_DISCOVERY_ENABLED=true` is set in the environment, AND
- a valid `GEOAPIFY_API_KEY` is present (already required for the existing
  geocode/place-details client).

Neither condition is set by this build. **No live Geoapify Places call has
been made at any point in Enrichment 2.1** (only the existing, pre-2.1
geocode/place-details client had ever made live calls, in the 2026-06-07
research sessions — unrelated to this feature and not repeated here).

## Recommendation for Liam

Before enabling: either (a) email Geoapify support asking specifically
whether long-term storage of Places results in a public-facing venue
directory app counts as within the free "production phase... with some
limitations", or (b) budget for a paid plan if the answer is unfavourable or
unclear, or (c) leave discovery on the OSM-archive provider only (already
safe, already the default) and treat Geoapify as enrichment-only (its
existing, already-approved geocode/place-details use for filling gaps on
already-known venues, per the 2026-06-07 Phase 2B research — that use case
is unaffected by this finding and remains unchanged).

## Daily safe budget, if enabled

If Liam decides to proceed: `dailyCreditBudget` should stay well under the
3,000/day free allowance to leave headroom for the existing geocode/
place-details enrichment use on the same key. Suggested starting point: 300
credits/day for Places discovery specifically (≈6,000 places/day at the
documented 1-credit-per-20-places rate) — a deliberately conservative
fraction, not the full allowance, since both use cases share one account.
