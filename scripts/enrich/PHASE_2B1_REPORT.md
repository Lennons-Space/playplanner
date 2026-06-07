# Phase 2B-1 — Real Geoapify Fixture Collection: Findings & Recommendation

> Research/validation only. 5 real venues, 10 credits spent. No DB writes, no app
> wiring. Raw fixtures in `scripts/enrich/fixtures/geoapify-real/`; machine data in
> `scripts/enrich/PHASE_2B1_DATA.json`. Date: 2026-06-07.

## TL;DR

**Recommendation: B — limited value *for the stated goal* (facility / accessibility
/ opening-hours enrichment).** Across all 5 venues Geoapify returned **zero** new
parking, toilets, cafe, baby-change, wheelchair, or opening-hours data — because
Geoapify is OSM-derived and OSM itself has no such tags for these venues. It *did*
provide good **address/postcode normalization** (4/5 improved), which is a different,
narrower use case worth considering separately. **Do not build the full Geoapify
facility-merge pipeline now.**

---

## 1. Fixture collection summary

| # | Venue | Category | Match | Dist | name_sim | score | Geoapify place = our OSM object? |
|---|---|---|---|---|---|---|---|
| 1 | Kingsmill Road Play Area | playground | ACCEPT | 2 m | 1.00 | 0.80 | yes (same node) |
| 2 | Tots & Dots Play Cafe | soft-play | ACCEPT | 0 m | 1.00 | 1.00 | yes |
| 3 | Phoenix Swimming Pool | swimming | ACCEPT | 4 m | 1.00 | 0.80 | yes |
| 4 | Foyle Valley Railway Museum | museum | ACCEPT | 0 m | 1.00 | 0.84 | **yes — place_id = `openstreetmap:venue:node/13705933001` = our osm_id** |
| 5 | Porfell Wildlife Park & Sanctuary | zoo/farm | ACCEPT | 8 m | 1.00 | 0.80 | yes |

All 5 matched with high confidence. **But the match is partly circular**: Geoapify
returned the *same OSM object* we already hold (verified by `datasource.raw` and, for
the museum, an exact `osm_id` match in the place_id). So "5/5 accept" validates the
matcher's mechanics, not Geoapify as an independent source.

## 2. Venue-by-venue comparison (OSM vs Geoapify)

Facilities/accessibility/hours — the fields 2B is meant to fill:

| Field | OSM (ours) | Geoapify | Verdict |
|---|---|---|---|
| parking | null ×5 | **null ×5** | no gain |
| toilets | null ×5 | **null ×5** | no gain |
| cafe / food | null ×5 | **null ×5** | no gain |
| baby change | null ×5 | **null ×5** | no gain |
| wheelchair | null ×5 | **null ×5** | no gain |
| opening hours | — ×5 | **none ×5** | no gain |
| phone | — ×5 | **none ×5** | no gain |
| website | 1/5 (in OSM) | 1/5 (Porfell) | duplicate |
| indoor/outdoor clue | from OSM tag | category (duplicates OSM) | duplicate; Tots & Dots returned `categories: []` — **worse** than our OSM `leisure` tag |
| category info | OSM tag | structured `leisure.playground` etc. | duplicate, slightly cleaner |
| coordinates | OSM | same point (0–8 m) | no gain (same source) |
| **address / postcode** | **3/5 missing, 1/5 junk** | **full postcode+street+town 5/5** | **REAL GAIN (4/5 improved)** |

Address detail (the one place Geoapify helped):

| Venue | Our DB | Geoapify |
|---|---|---|
| Kingsmill Road Play Area | postcode —, city — | **RG21 3LD**, Midlane Close, Basingstoke |
| Phoenix Swimming Pool | postcode —, city — | **NR31 8JU**, Widgeon Close, Great Yarmouth |
| Porfell Wildlife Park | postcode —, city — | **PL13 2RW**, Stonerush Lakes, Lanreath |
| Foyle Valley Railway Museum | BT48 6SQ, city "BT48" (junk) | BT48 6SQ, **"Derry/Londonderry", Foyle Road** |
| Tots & Dots Play Cafe | MK11 1AQ, Milton Keynes | same + house number "56 High Street" |

## 3. New data discovered

- **Address/postcode/street/town** for venues our import left blank — 3/5 had **no
  postcode at all**, now resolved; 1/5 had a junk city ("BT48") now corrected.
- **Formatted display address** + **timezone** for all 5.
- **1 website** (Porfell — and that came from an OSM `website` tag, so technically
  duplicate of OSM, just surfaced).

## 4. Duplicate data discovered

- Name, coordinates, category, indoor/outdoor clue, and the underlying OSM tags are
  **the same data we already have** — Geoapify served our exact OSM objects.

## 5. Coverage analysis

- **A. What new info did Geoapify provide?** Address normalization (postcode, street,
  town, formatted) for 4/5. Nothing else.
- **B. What duplicated OSM?** Name, coords, category, indoor/outdoor, website — all
  OSM-sourced and identical.
- **C. What was missing from both?** The entire parent-facing layer: toilets, parking,
  cafe, baby-change, wheelchair/accessibility, opening hours, phone. Absent in OSM,
  therefore absent in Geoapify.
- **D. Did Geoapify recover OSM archive misses?** For **addresses**, yes (filled
  postcodes our import dropped). For **facilities**, no — and note this sample used
  venues that *already* have enrichment rows, so it did not directly test archive-miss
  recovery for facility tags. Not meaningfully demonstrated.
- **E. Did Geoapify materially improve enrichment confidence?** **No.** Our confidence
  model is driven by facility/structural facts; with 0 facility gap-fills, confidence
  would not rise for any of the 5. (Address quality improved, but that is not part of
  the confidence model.)

## 6. Match quality report

- 5/5 ACCEPT; distances 0–8 m; name_sim 1.00 across the board; scores 0.80–1.00.
- Postcode match contributed only where we had a postcode (Tots, Foyle); the three
  postcode-less venues still scored 0.80 on name + confidence + proximity alone.
- **False-match risk — untested in the dangerous direction.** Because Geoapify echoed
  our own OSM objects, the matcher never had to *reject* a near-miss here. The real
  risk (a same-named or same-coordinate *different* business) is exercised only by the
  2B-0 synthetic fixtures, not by live data yet. Matching against Geoapify for
  **non-OSM** venues (manually added, business-submitted, no osm_id) is **completely
  untested** and is where false matches would actually occur.

## 7. Cost report

| Metric | Value |
|---|---|
| Credits / venue | **2** (1 geocode + 1 place-details) |
| Credits / 100 venues | 200 |
| Credits / 1,000 venues | 2,000 |
| Full OSM catalogue (46,906 venues) | **~93,812 credits ≈ 32 days** at 3,000/day free |
| This run | 10 credits |

Free tier remains **viable** for small/targeted runs, but a full-catalogue facility
pass would take ~32 days of the free quota — a poor trade for **0 facility gain**.

## 8. Risks

| Risk | Note |
|---|---|
| **Geoapify ≈ OSM** | Confirmed empirically — same objects, same sparse tags. No independent facility data. |
| Sample bias (n=5) | All 5 are low-profile, low-confidence OSM venues. A popular commercial chain *might* carry richer Geoapify business data (hours/phone). Not tested. |
| Circular matching | High match scores here don't prove the matcher discriminates; non-OSM venues untested. |
| Wasted spend | A full facility pass costs ~94k credits for ~0 facility value. |
| Category regression | Geoapify returned `categories: []` for Tots & Dots — Geoapify can be *worse* than our OSM category. |

## 9. Final recommendation — **B: limited value (for the facility goal)**

The Phase 2B hypothesis — "Geoapify fills missing parent-facing intelligence (parking,
toilets, cafe, accessibility, opening hours)" — is **not supported** by 5 real venues:
**0/5 gained any of those fields.** Geoapify is OSM-derived; it cannot supply facility
data that OSM lacks, and OSM lacks it for exactly the venues that most need enrichment.

**Do not build the full Geoapify facility-merge pipeline.** The 2B-0 merge engine,
applied to this data, produced 0 gap-fills — it would be an expensive no-op at scale.

**Two concrete, smaller alternatives (your call — not actioned):**
1. **Address/geocoding backfill (worth a look).** Geoapify clearly helps here: 3/5
   missing postcodes resolved, 1 junk city corrected. A *narrow* one-off pass using the
   `geoapifyClient` we built — to fill missing `postcode`/`city`/`formatted_address`
   only — is a legitimate, cheap improvement (postcodes matter for search/filtering).
2. **Confirmatory test before any final no-go (≈4–8 credits).** Run the same collector
   on 2–3 *popular commercial* venues (a known soft-play chain, a big attraction) to
   check whether Geoapify carries hours/phone for high-profile places. If it doesn't
   even for those, the no-go on facilities is conclusive.

**Bottom line:** for parent-facing facility/accessibility/hours enrichment, Geoapify
is not worth implementing. For address/postcode backfill, it is genuinely useful and
could justify a separate, much narrower task.
