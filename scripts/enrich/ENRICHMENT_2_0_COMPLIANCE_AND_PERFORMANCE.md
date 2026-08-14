# Enrichment 2.0 — Compliance/Source Audit + Performance Findings

Written 2026-08-14 as part of the Enrichment 2.0 autonomous-build continuation
(Milestones A-F). Covers Phase I (compliance/source audit) and Phase J
(performance) from Liam's spec. No live crawling was performed to produce this
document — figures are either measured locally against synthetic data (zero
network) or clearly labelled projections.

## Phase I — Compliance / source audit

### Sources actually used by this codebase

| Source | What's collected | Why | Licence/terms | robots | Throttle | Attribution | Auto-publish safe? |
|---|---|---|---|---|---|---|---|
| OSM archive (`scripts/enrich/data/raw/osm_archive_20260425`) | Tags, coordinates, name, address fragments — a static extract already downloaded via `scripts/import/01_fetch_osm.js` (Overpass API) | Primary existing-venue enrichment source (Phase 2A) and this build's discovery candidate pool | ODbL-1.0 (Open Database Licence) | N/A — static file, no live requests made by discovery | N/A (no live requests) | Required; `venues.license='ODbL-1.0'` already set on OSM-sourced venues (`scripts/import/02_transform_osm.js`), ODbL notice already shown on Venue Detail (2026-07-09 session) | Yes, for enrichment; discovery candidates still gated by candidateAccept.ts before any publish |
| Geoapify (`scripts/enrich/geoapifyClient.ts`) | Business facts, opening hours, phone/website (OSM-derived + supplementary) | Fills gaps OSM misses (Phase 2B research, 2026-06-07) | Commercial API, free-tier terms accepted at signup; key never client-side (`scripts/.env`, backend-only) | N/A — API, not scraping | `minIntervalMs`/`dailyCreditBudget` enforced in `geoapifyClient.ts` (this build did not add a live category-search integration — see "Not built" below) | Not independently required (API terms, not ODbL) | Existing merge logic (`mergeFacts.ts`) never upgrades an OSM negative — safety-first |
| A venue's own official website (`scripts/enrich/web/webClient.ts`) | Structured facts (JSON-LD/microdata/meta), now also scanned for closure language (this build's `closureCheck.ts`) | Tier-1 (highest trust) corroboration for existing-venue enrichment | Implicit — public business website, fetched at low volume, robots-respecting | **Structural, non-bypassable**: single code path in `webClient.ts`, no `--ignore-robots` flag anywhere (verified: this build's `grep -i "google\|tripadvisor"` sweep of `scripts/enrich/**` returns only this document's own no-scrape list, confirming zero scraper code exists for either) | 3,000ms per-domain (`webClient.ts` `DEFAULTS.perDomainIntervalMs`) | N/A (first-party) | Never auto-publishes verbatim text — `description` field requires an admin-authored rewrite (`apply_venue_proposal`/`auto_apply_field_proposal` both enforce this; the latter additionally never auto-applies `description` at all, see `autoApplyPolicy.ts`) |

### No-scrape list — verified, not just declared

Per Part 2, this codebase must never scrape Google Maps/Search, TripAdvisor, or
any CAPTCHA/login-gated source. Verified this session via
`grep -riE "google\.com/maps|google\.com/search|tripadvisor|maps\.google" scripts/enrich` —
the only match is `sourceTrust.ts`'s own documentation of the no-scrape list
(names only, no client/URL). No HTTP client, fixture, or test anywhere under
`scripts/enrich/**` targets any of these sources. No proxy rotation or
CAPTCHA-bypass code exists anywhere in this codebase.

### GDPR / copyright / consumer-protection flags

- **Copyright**: `description` proposals can never auto-apply, and the human
  apply path (`apply_venue_proposal`) rejects a description that matches the
  scraped evidence verbatim (`description_not_rewritten` guard, migration 056)
  — an admin must always write an original summary. No scraped marketing copy
  can ever reach production automatically.
- **GDPR**: this pipeline only processes **business** facts (name, address,
  phone, hours, prices) about UK family venues — no personal data of any
  individual is collected, matching this repo's existing data-minimisation
  posture (CLAUDE.md). Closure-signal scanning only reads publicly-published
  business-status text; it does not retain full page HTML beyond the single
  in-memory pass (`captureHtml` is not persisted to disk or DB).
- **Consumer protection**: auto-applied fields are restricted to low-
  ambiguity, easily-correctable facts (phone/email/website/opening_hours) —
  never price or description — so an occasional wrong auto-apply cannot
  mislead a parent about cost or safety, only cause a minor inconvenience
  (wrong number/hours), self-correctable on the next enrichment pass.
- **Database-right**: ODbL requires attribution + share-alike for OSM-derived
  data; already satisfied by the existing Venue Detail ODbL notice and
  `license` column. No new database-right exposure introduced by this build.

### Not built in this pass (flagged, not silently dropped)

- Geoapify does not yet have a live "search by category across a region"
  integration — only single-venue geocode/match (`geoapifyClient.ts`,
  `geoapifyMatch.ts`) exists. Building and *testing* a new category-search
  surface against the real API would have required spending real API credits
  without Liam's explicit go-ahead for a live run, so `discoverFromElements`
  is written to accept ANY `RawOsmElement` source — Geoapify category search
  can be plugged in later as a second element source without changing the
  pipeline's shape.
- Official-site corroboration for brand-new discovery candidates (crawling a
  candidate's own website before deciding auto-accept) is out of scope —
  `discoverCandidates.ts`'s `officialVerification` is always `false`. This is
  why `scoreDiscoveryCandidate` is capped low enough that only a fully-tagged,
  fully-detailed OSM element can ever clear the 98-point auto-accept bar —
  everything else correctly lands in quarantine.

## Phase J — Performance

### Measured (2026-08-14, this machine, single-threaded Node, zero network)

Pure-function throughput — synthetic data, `npx tsx` benchmark, discarded
after producing these numbers (not committed as a script):

| Function | n=100 | n=1,000 | n=10,000 | Per-item |
|---|---|---|---|---|
| `classifyProposals` (confidence scoring + auto-apply policy) | 0.6ms | 1.5ms | 5.1ms | ~0.0005-0.006ms |
| `evaluateElement` (discovery: category match + dedupe + accept-gate, 500-venue existing pool) | 82.7ms | 659.0ms | 6,583.8ms | ~0.66-0.83ms |
| `dedupeAgainstExisting` alone (against the same 500-venue pool) | 155.7ms | 1,513.0ms | 15,083.0ms | ~1.5-1.6ms |

**Bottleneck identified, with numbers**: dedup dominates discovery cost, and it
is **linear in the existing-venue pool size** (`nearbyExisting`'s pre-filter in
`discoverCandidates.ts` is a `.filter()` over the FULL pool passed in — it
narrows the *comparison* set per candidate, but does not avoid scanning all
existing venues once per candidate to build that narrowed set). At 10,000
candidates against a 500-venue existing pool, dedup alone takes ~15 seconds
single-threaded. Classification and category matching are effectively free by
comparison (sub-millisecond even at 10k).

**Recommended fix before any nationwide discovery run** (not built this pass —
flagged as a genuine decision, not done silently): replace the in-memory
`existingVenues: DedupeExistingVenue[]` full-pool load with a bounding-box
query per Overpass cell (the existing `get_nearby_venues` PostGIS RPC the map
feature already uses is the natural fit — reusing an app-critical RPC for a
new purpose was deliberately not done in this build without Liam's sign-off).
This would turn an O(candidates × existing_venues) scan into
O(candidates × venues_in_that_cell), which for a 1°×1° UK grid cell is
typically tens of venues, not the full national count.

### Projected (network-bound, NOT measured — based on webClient.ts's existing, tested constants)

- Enrich-existing: `perDomainIntervalMs = 3,000ms` between requests to the
  same domain, up to `maxPages = 3` pages/venue ⇒ **~3-9 seconds/venue**
  sequential (this build's orchestrator processes venues sequentially, no
  concurrency — matches the existing `enrichVenues.ts` script's own
  sequential design). 20 venues (default `--limit`) ⇒ roughly 1-3 minutes.
  1,000 venues ⇒ roughly 1-2.5 hours. A future concurrency pool (bounded,
  respecting the per-domain — not global — throttle) is the natural next
  optimisation if Liam wants faster large-scale runs, not built here.
- Discovery: bounded by the OSM archive read (local disk, effectively
  instant at any realistic archive size) plus the dedup bottleneck above —
  no live network calls at all in this build's discovery mode (Geoapify
  category search isn't wired in, see Phase I).
