# Phase 2B — Geoapify Enrichment (DESIGN ONLY)

> Status: **Design.** No code, no live API calls, no app wiring, no scaled writes.
> This document is the plan we review before building anything.
>
> Author: enrichment sprint • Date: 2026-06-07

---

## 0. The one thing you must understand first

**Geoapify's Places / Place Details data is itself built mostly from OpenStreetMap.**
So Geoapify is *not* a magically richer, independent source of truth. It is the **same
underlying OSM data, but:**

1. **Fresher** than our static archive (`scripts/data/raw/osm_archive_20260425`, snapshot
   from 2026-04-25). Geoapify queries a much more current OSM-derived database.
2. **More complete** — our local archive is a *partial extract*. The **47% archive-miss
   rate** is almost certainly venues whose `osm_id` simply isn't in our downloaded slice.
   Geoapify can see those venues.
3. **Parsed and normalised** — Geoapify gives structured `opening_hours`, clean
   `categories`, split contact fields, etc., that are painful to derive from raw tags.

**What this means for the recommendation (full version in §12):**
Geoapify's biggest win is **coverage of the 47% we currently can't see**, plus
opening hours + website + phone, which OSM-via-archive gives us almost nothing of.
It will **not** dramatically lift the *quality* of venues already well-tagged in OSM,
because for those it's the same data. Set expectations accordingly.

---

## 1. Architecture

Geoapify slots in as a **second enrichment source behind OSM**, never replacing it.
The existing three-layer model (migration 049) already reserves space for this —
`raw_geoapify jsonb`, `enrichment_sources text[]`, and per-field provenance live in
`venue_enrichment`. Nothing in the schema needs to change for Phase 2B.

```
                 ┌─────────────────────────────────────────────────────┐
                 │  BACKEND / SCRIPTS ONLY  (service_role, never client) │
                 └─────────────────────────────────────────────────────┘

  Supabase venues ──► enrichGeoapify.ts (new) ──► Geoapify API (rate-limited)
       │                     │                          │
       │                     │   1. match (Geocoding)   │
       │                     │   2. details (Place Det) │
       │                     ▼                          ▼
       │             raw_geoapify cache          confidence + match audit
       │                     │
       │                     ▼
       │             MERGE LAYER  (osm facts  ⊕  geoapify facts)
       │             rules in §7  — OSM explicit wins, Geoapify fills gaps
       │                     │
       ▼                     ▼
  venue_enrichment  ◄── upsert (DRY-RUN by default, --write gated like Phase 2A)
```

### Module layout (mirrors Phase 2A's clean separation)

| File | Responsibility | Pure? |
|---|---|---|
| `scripts/enrich/geoapifyClient.ts` | HTTP, auth, rate-limit, retry, cache I/O | No (I/O) |
| `scripts/enrich/geoapifyMatch.ts` | Decide if a Geoapify result *is* our venue | **Yes** |
| `scripts/enrich/geoapifyExtract.ts` | Geoapify feature → `RawFacts` (+ new fields) | **Yes** |
| `scripts/enrich/mergeFacts.ts` | Merge OSM facts ⊕ Geoapify facts per §7 | **Yes** |
| `scripts/enrich/enrichGeoapify.ts` | CLI orchestrator (dry-run/write, flags) | No |
| `scripts/enrich/__tests__/*` | Unit tests for every pure module | — |

The three **pure** modules (`Match`, `Extract`, `mergeFacts`) are independently
unit-testable with fixtures — no network — exactly like `osmExtract.ts` today. This is
how we validate matching/merge logic *before* spending a single live credit.

**Key principle:** the network layer and the decision layer are separate. We can run the
entire matching + merge + dry-run report against **cached JSON fixtures** and never call
Geoapify until we're confident.

---

## 2. API endpoint choice

Geoapify free tier = **3,000 credits/day, shared pool across all APIs, 5 requests/sec**,
**1 credit per request** for Geocoding / Places / Place Details.
([pricing](https://www.geoapify.com/pricing/))

We use **two endpoints per venue**, in sequence:

### 2a. Geocoding API — *for matching* (1 credit)
`GET https://api.geoapify.com/v1/geocode/search`
- Input: our venue **name + postcode + city + country=GB** (structured query).
- Output we care about: `place_id`, `rank.confidence`, `rank.match_type`, `lat/lon`,
  formatted address, category.
- Purpose: find *which* Geoapify place is our venue, and **how sure** we are.

We use Geocoding (not Places) for matching because Geocoding returns a
**`rank.confidence` score and `match_type`** — purpose-built for "did this query match a
real place?" Places search is for "what's near here", which is a weaker matching signal.

### 2b. Place Details API — *for facts* (1 credit)
`GET https://api.geoapify.com/v2/place-details`
- Input: the `place_id` from step 2a (preferred) — exact, no ambiguity.
- Output: the rich feature — `opening_hours`, `contact.phone`, `website`, `email`,
  `wheelchair`, `facilities` (toilets, internet, air-con, outdoor seating), `catering`,
  `parking`, structured `categories`, full address.
  ([place-details docs](https://apidocs.geoapify.com/docs/place-details/))

**Cost = 2 credits per venue** (1 match + 1 details). At 3,000/day that's a safe ceiling
of ~1,500 venues/day *theoretically* — we will run **far** below that (see §8).

> We deliberately **do not** use Place Details by raw lat/lon, even though it's allowed.
> A point query returns "the feature at this point", which silently returns the *wrong*
> nearby building with no confidence signal. Matching via Geocoding first gives us a
> confidence number we can gate on. **Unknown is better than wrong.**

---

## 3. Request examples

> Illustrative only — these are **not** run in this phase. `${KEY}` is read from
> `scripts/.env` (`GEOAPIFY_API_KEY`), never hardcoded, never in client code.

### 3a. Match (Geocoding)
```
GET https://api.geoapify.com/v1/geocode/search
      ?text=Willows%20Farm%20Village%2C%20AL2%201BB%2C%20St%20Albans
      &filter=countrycode:gb
      &bias=proximity:-0.336,51.726        # our venue lon,lat → prefer near results
      &format=geojson
      &limit=5
      &apiKey=${KEY}
```
Response (trimmed):
```jsonc
{ "features": [{
  "properties": {
    "place_id": "51a8…b2",
    "name": "Willows Activity Farm",
    "postcode": "AL2 1BB",
    "lon": -0.3361, "lat": 51.7259,
    "category": "leisure.park",
    "rank": { "confidence": 0.95, "match_type": "full_match" }
  }
}]}
```

### 3b. Details (Place Details)
```
GET https://api.geoapify.com/v2/place-details
      ?id=51a8…b2
      &features=details,details.contact,details.facilities,details.catering
      &apiKey=${KEY}
```
Response (trimmed):
```jsonc
{ "features": [{ "properties": {
    "name": "Willows Activity Farm",
    "opening_hours": "Mo-Su 10:00-17:30",
    "contact": { "phone": "+441727822106", "website": "https://willowsactivityfarm.com" },
    "wheelchair": "yes",
    "facilities": { "toilets": true, "internet_access": true },
    "catering":   { "cafe": true },
    "parking":    { "surface": true },
    "categories": ["leisure.park","entertainment.activity_park"]
}}]}
```

---

## 4. Matching strategy (how we decide a result is *our* venue)

This is the highest-risk part. A wrong match writes a *plausible but false* phone number
or "wheelchair: yes" onto the wrong venue. The matcher is a **pure function** returning a
match decision + score, tested against fixtures before any live run.

We compute a **composite match score** and require it to clear a bar:

| Signal | Weight | How |
|---|---|---|
| **Distance** between our lat/lon and Geoapify lat/lon | gate | **Must be ≤ 150 m**, else auto-reject regardless of name |
| **Geoapify `rank.confidence`** | 0.35 | direct (0–1) |
| **Name similarity** | 0.45 | normalised token-set / Levenshtein ratio (0–1) |
| **Postcode exact match** | 0.20 | 1.0 if equal (whitespace/case-insensitive), else 0 |

```
match_score = 0.35*confidence + 0.45*name_sim + 0.20*postcode_match
ACCEPT  if  distance ≤ 150m  AND  match_score ≥ 0.70  AND  name_sim ≥ 0.50
REVIEW  if  distance ≤ 150m  AND  0.55 ≤ match_score < 0.70   (logged, not written)
REJECT  otherwise
```

Name normalisation before similarity: lowercase, strip `Ltd/Limited/The/&/punctuation`,
collapse whitespace. ("The Willows Farm Village Ltd" ≈ "Willows Activity Farm").

---

## 5. Avoiding wrong matches

Belt **and** braces:

1. **Hard distance gate (≤150 m).** A different business with a similar name across town
   is rejected on geometry alone. This is the single most important guard.
2. **Name floor (`name_sim ≥ 0.50`).** Stops "right location, totally different place"
   (e.g. our soft-play vs. the Tesco next door at the same coordinates).
3. **No silent point-lookups** (see §2) — always go through a confidence-scored geocode.
4. **REVIEW tier is never written.** Borderline matches are dumped to the dry-run report
   for a human, not auto-applied.
5. **Category sanity check (soft).** If Geoapify category is wildly off our venue's
   category family (e.g. ours=`soft-play`, theirs=`commercial.car`), demote to REVIEW
   even if score passes. Prevents coordinate collisions in dense retail parks.
6. **Every match decision is cached and auditable** — `raw_geoapify` stores the match
   score, distance, and which result index won, so a bad write is always traceable.

---

## 6. Field mapping table

`O?` = does OSM/Phase 2A already populate this? `New` = new column needed (NOT in this
phase — flagged for a future migration; Phase 2B writes only into existing columns +
`raw_geoapify`).

| Target field | Geoapify source | O? | Notes |
|---|---|---|---|
| `indoor_outdoor` | `categories` heuristic | yes | OSM explicit wins; Geoapify only fills `null` |
| `parking_available` | `parking.*` present → true | partial | fills OSM `null` |
| `cafe_available` | `catering.cafe` / category `catering.*` | partial | fills OSM `null` |
| `toilets_available` | `facilities.toilets` | partial | fills OSM `null` |
| `baby_change_available` | `facilities.changing_table` (rare) | partial | usually stays `null` — honest |
| `wheelchair_accessible` | `wheelchair` (`yes/limited/no`) | partial | OSM explicit wins; fills `null` |
| `visit_duration_mins` | — (not provided) | n/a | stays OSM estimate |
| `activity_level` | `categories` heuristic | yes | OSM wins |
| **opening_hours** | `opening_hours` (raw OSM syntax string) | **no** | **New column later** → big win |
| **website** | `contact.website` / `website` | **no** | **New column later** → big win |
| **phone** | `contact.phone` | **no** | **New column later** → big win |
| **email** | `contact.email` | **no** | optional |
| **category correction** | `categories[]` | n/a | *suggestion only*, never auto-applied |

**Important scope note:** the four "New column later" fields (opening_hours, website,
phone, email) require a **migration to add columns to `venue_enrichment`** — that is a
*separate, later* step. For Phase 2B's first test we will **capture them in
`raw_geoapify`** and *report* them in dry-run, proving the data exists, **before**
committing schema. This keeps Phase 2B's blast radius tiny.

Category correction is **advisory only**: we surface "Geoapify thinks this is X, we have
Y" in the report. We never rewrite a venue's category automatically — that's a curation
decision.

---

## 7. Confidence & merge model

Two confidences, kept distinct:

- **Match confidence** (§4) — "is this the right venue?" Gates whether we use *any*
  Geoapify data for that venue.
- **Field confidence** — "how sure are we about this specific fact?" Drives merge.

### Per-source field precedence (highest → lowest)

```
1. manually_curated row            → NEVER touched (skipped before processing)
2. OSM explicit tag                → e.g. wheelchair=yes, indoor=no, toilets=no
3. Geoapify explicit value         → e.g. facilities.toilets = true
4. OSM category inference          → e.g. leisure=park ⇒ outdoor
5. Geoapify category inference     → weakest
6. null / unknown                  → keep null (better than wrong)
```

### Merge rule (per field), implemented in `mergeFacts.ts`

```
if field is manually_curated:           keep existing            (never overwrite)
elif OSM has an EXPLICIT value:         keep OSM                 (rule: OSM explicit wins)
elif OSM value is null/unknown
     and Geoapify has explicit value:   take Geoapify  ── fills the gap ──►  source+=geoapify
elif both only category-inferred:       keep OSM, note Geoapify agreement raises confidence
else:                                    keep null
```

Resulting `enrichment_confidence` for the row is recomputed:
- `high`  — at least one explicit structural fact (from either source) **and** a confirmed
  facility, **and** match_score ≥ 0.80.
- `medium`— any explicit fact from either source, match_score ≥ 0.70.
- `low`   — only category inference, or match in REVIEW band.

`enrichment_sources` becomes e.g. `["osm_archive","geoapify"]` so every row records
exactly where its facts came from. Each field that Geoapify *changed* is listed in
`raw_geoapify.applied_fields[]` for audit.

---

## 8. Conflict rules

When OSM and Geoapify **disagree** on the same field:

| Case | Rule |
|---|---|
| OSM **explicit** vs Geoapify explicit, **disagree** | **OSM wins.** Log conflict in `raw_geoapify.conflicts[]`. Set field confidence to `medium` (not high) because sources disagree. |
| OSM **null** vs Geoapify explicit | Take Geoapify (this is the gap-fill we want). |
| OSM category-inferred vs Geoapify explicit, disagree | **Geoapify wins** (explicit beats inference) — but flag in conflicts and cap confidence at `medium`. |
| Both inferred, disagree | Keep OSM, confidence `low`, log. |
| `wheelchair`: OSM=`no` vs Geoapify=`yes` | **Keep OSM `no`.** Safety-conservative: never *upgrade* an accessibility claim on weaker authority. Log loudly. |

**Accessibility is special:** we never let Geoapify *upgrade* a wheelchair/baby-change
claim over an explicit OSM negative. Over-promising accessibility harms the exact families
we serve. Downgrades (OSM null → Geoapify `no`) are allowed.

---

## 9. Rate-limit plan

Free tier: **3,000 credits/day, 5 req/sec**. Each venue = **2 credits**.

We run **deliberately tiny and slow**, nowhere near the ceiling:

| Guard | Value | Why |
|---|---|---|
| Self-imposed req rate | **1 req / 1.2 s** (≈0.83 rps) | 6× under the 5 rps cap; polite |
| Daily run budget | **≤ 500 credits/day** (≈250 venues) | ~⅙ of free quota; leaves headroom |
| Per-run cap (mirrors Phase 2A) | `--limit` required, hard cap (start 20) | no accidental bulk spend |
| Credit counter | abort run if projected credits > budget | fail-fast before calling |
| 429 / quota response | exponential backoff, then **stop the run** | never hammer |
| Cache-first | skip venues already in `raw_geoapify` & fresh (< 90 days) | zero wasted credits on re-runs |

A real-time **credit ledger** is printed in every run header: "Budget 500 · estimated
this run 40 · used today (from a local counter file) 0".

---

## 10. Caching raw Geoapify responses

Two layers, so we **never pay twice** and can develop offline:

1. **On-disk fixture cache** (dev): `scripts/data/raw/geoapify_cache/<place_id>.json`
   and `<venue_id>.match.json`. The matcher/extractor/merge can run entirely from these
   — this is how we build and test logic with **zero live credits**.
2. **Database cache**: full raw response stored in `venue_enrichment.raw_geoapify` (jsonb,
   already exists). Includes: raw geocode result, raw place-details, match score,
   distance, applied_fields, conflicts, `fetched_at`. Re-runs check `fetched_at` and skip
   if < 90 days old (`--force` to override).

Caching means a re-run of the same 20 venues costs **0 credits**.

---

## 11. Dry-run report format

Default mode, exactly like Phase 2A. Per venue:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[VENUE] Willows Activity Farm (id: 1a2b…)
  our coords : 51.7259, -0.3361   postcode: AL2 1BB
  category   : farm

  MATCH (Geoapify Geocoding)
  ├─ candidate     : "Willows Activity Farm"  place_id 51a8…b2
  ├─ distance      : 12 m            ✅ (≤150m)
  ├─ name_sim      : 0.91
  ├─ postcode      : exact ✅
  ├─ confidence    : 0.95
  └─ match_score   : 0.92  →  ACCEPT ✅

  FIELD MERGE (osm ⊕ geoapify)
  field                  osm            geoapify      result        source
  ├─ wheelchair          null           yes           yes           geoapify  (gap filled)
  ├─ toilets_available   null           true          true          geoapify  (gap filled)
  ├─ parking_available   true(explicit) true          true          osm       (kept)
  ├─ cafe_available      null           true          true          geoapify  (gap filled)
  └─ indoor_outdoor      mixed(infer)   leisure.park  mixed         osm       (kept)

  NEW DATA (not yet a column — capture only)
  ├─ opening_hours : Mo-Su 10:00-17:30
  ├─ website       : https://willowsactivityfarm.com
  └─ phone         : +44 1727 822106

  CONFLICTS : none
  CATEGORY  : geoapify=leisure.park vs ours=farm  (advisory, no change)

  Confidence: medium → high   Sources: [osm_archive, geoapify]
  Credits used this venue: 2
  [DRY RUN — no database writes]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Run footer:
```
=== DRY RUN COMPLETE ===
Venues: 20 processed · 14 ACCEPT · 3 REVIEW · 3 REJECT
Gaps filled: wheelchair 9, toilets 11, cafe 7, parking 4
New data found: opening_hours 13, website 16, phone 15
Conflicts: 2 (logged)   Credits used: 40 / 500 budget
```

---

## 12. Implementation phases (when we get the go-ahead)

| Phase | What | Live credits |
|---|---|---|
| **2B-0** | Build `geoapifyClient/Match/Extract/mergeFacts` + tests against **hand-made fixtures** | **0** |
| **2B-1** | One-time **manual** Geoapify call for ~5 venues, save JSON as fixtures, validate matcher by eye | ~10 |
| **2B-2** | **Dry-run** over **20 venues** (this is the milestone you asked to scope) | ~40 |
| **2B-3** | Human review of dry-run; tune thresholds; re-run from cache | 0 |
| **2B-4** | Migration: add `opening_hours / website / phone` columns (separate review) | 0 |
| **2B-5** | `--write` over the same 20 (Phase-2A-style gates, curated rows skipped) | 0 (cached) |
| **2B-6** | Decide whether to scale; only then raise caps | TBD |

We **stop after 2B-2** to review, exactly as this sprint instructs.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Geoapify = OSM underneath**, adds little for well-tagged venues | High | Med | Target the 47% archive-miss + opening_hours/website/phone where it genuinely helps; measure gap-fill in dry-run before scaling |
| Wrong match writes false facts | Med | **High** | 150 m gate + name floor + REVIEW band + category sanity (§4–5) |
| API key leakage | Low | **High** | backend-only, `scripts/.env`, never client, never logged, gitignored |
| Free quota exhaustion / throttling | Low | Low | ≤500/day budget, 1.2 s spacing, cache-first, fail-fast ledger (§9) |
| Over-promising accessibility | Med | **High** | never upgrade wheelchair/baby-change over OSM negative (§8) |
| Schema creep before validation | Med | Med | capture new fields in `raw_geoapify` first; add columns only in 2B-4 |
| Stale Geoapify data (also OSM-lag) | Med | Low | store `fetched_at`; treat as a *source*, not gospel; manual curation always wins |
| Licensing/attribution (ODbL via OSM) | Low | Med | confirm Geoapify free-tier attribution terms before any user-facing display |

---

## 14. Final recommendation — worth building now?

**Qualified yes — build it, but scope it narrowly and for the right reason.**

- **The honest case against:** Geoapify is OSM-derived, so for venues already well-tagged
  in our archive it's mostly the *same data*. It is **not** a quality multiplier on top of
  good OSM.
- **The case for (this is the real value):**
  1. **The 47% archive-miss is the prize.** Our local extract is partial; Geoapify's live
     DB can see venues our archive can't. That's coverage we cannot get any other free way.
  2. **opening_hours / website / phone** — OSM-via-archive gives us almost none of these,
     and they are high-value for a parenting app ("is it open?", "can I call?"). Geoapify
     surfaces them cleanly.
  3. **It's free** at our volumes (≤500 of 3,000 daily credits), backend-only, and the
     `raw_geoapify` column already exists — near-zero schema risk for the first test.
- **Conditions:** strictly dry-run first, 20 venues, OSM-explicit-wins, accessibility
  never upgraded, new fields captured (not schema'd) until validated.

**Decision gate for *you*:** after the 20-venue dry-run (2B-2), look at the footer stats.
If "gaps filled" + "new data found" are high → proceed to columns + write. If they're
low → Geoapify isn't worth scaling and we stop, having spent ~40 credits to find out.

> Cheapest possible way to learn whether it's worth it: **the 20-venue dry-run.**
> That's the whole point of building 2B-0 → 2B-2 and stopping.

---

### Sources
- Geoapify pricing / free-tier limits — https://www.geoapify.com/pricing/
- Place Details API fields — https://apidocs.geoapify.com/docs/place-details/
- Places API — https://apidocs.geoapify.com/docs/places/
- Geocoding API — https://apidocs.geoapify.com/docs/geocoding/
