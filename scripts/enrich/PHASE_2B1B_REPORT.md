# Phase 2B-1B — Popular-Venue Geoapify Confirmatory Test: Findings & Recommendation

> Research/validation only. 3 popular commercial venues, **6 credits spent** (cap
> was 8). No DB writes, no app wiring. Raw fixtures in
> `scripts/enrich/fixtures/geoapify-popular/`; machine data in
> `scripts/enrich/PHASE_2B1B_DATA.json`. Date: 2026-06-07.

## Venues tested

| # | Venue | Category | ID | Why chosen |
|---|---|---|---|---|
| 1 | Wacky Warehouse (Burton-on-Trent) | soft-play | `287abc1b-e36f-4308-9afe-29ff9a2f4ae8` | National soft-play **chain** — likely to have a corporate website/listing |
| 2 | Twycross Zoo | animal-attraction | `fb9ad746-37ab-4e8a-9d8b-2f45a75fb0a4` | Famous, large UK zoo — major commercial visitor attraction |
| 3 | National Sea Life Centre (Birmingham) | animal-attraction | `25adf478-89bc-4316-919b-efd6538f788a` | Major commercial attraction chain (museum/leisure-equivalent) — strong web presence expected |

All 3: `data_source='osm'`, valid `osm_id`/lat-long, **no enrichment row at all**
(sparse/null facilities) — so any Geoapify gain is directly visible, and the
test isn't muddied by pre-existing data.

## Match & circularity audit

| Venue | Match | Distance | Score | Geoapify place = our OSM object? |
|---|---|---|---|---|
| Wacky Warehouse | ACCEPT | 0 m | 1.00 | **No — independent record** |
| Twycross Zoo | ACCEPT | 9 m | 1.00 | **No — independent record** |
| National Sea Life Centre | ACCEPT | 7 m | 1.00 | **No — independent record** |

**This is the key structural difference from Phase 2B-1.** All 5 prior matches
were *circular* (Geoapify echoed our own OSM node/way back). Here, all 3
`place_id`s and `datasource.raw` blocks reference **different underlying
records**, not our `osm_id`s — these are genuinely independent Geoapify/Places
entries (popular commercial venues are indexed from multiple sources, not just
the single OSM object we hold).

## 1. Did Geoapify add parking / toilets / cafe / accessibility / opening hours?

**Partially — one real gain, everything else still empty.**

| Field | OSM (ours) | Geoapify | Verdict |
|---|---|---|---|
| parking | null ×3 | null ×3 | no gain |
| toilets | null ×3 | **true ×1** (Sea Life Centre) | **GAIN — 1/3** |
| cafe / food | null ×3 | null ×3 | no gain |
| baby change | null ×3 | null ×3 | no gain |
| wheelchair (structured field) | null ×3 | null ×3 | no gain (see note below) |
| opening hours | — ×3 | none ×3 | no gain |
| indoor/outdoor | null ×3 | "mixed" (Twycross), "indoor" (Sea Life) | gap-fill x2 (structural clue, not a facility) |

**Note on accessibility:** the Sea Life Centre's Geoapify record *did* carry an
accessibility signal — `wheelchair.yes` — but only inside its `categories[]`
array, not in the `properties.wheelchair` field our extractor reads. So Geoapify
held *a* signal here that our current extraction logic doesn't surface as
`wheelchair_accessible`. This is a narrow, single-venue observation — not strong
enough on its own to justify building a category-tag accessibility parser, but
worth knowing: Geoapify's richer commercial records *can* carry accessibility
hints in less-obvious places than OSM tags do.

## 2. Did it add website / phone / postcode?

**Yes for website (3/3) — a real, independent gain. No for phone. Postcode/address not re-tested here** (all 3 picks already had good postcodes, by design — the address-backfill question was already answered affirmatively in Phase 2B-1).

| Venue | Website (Geoapify) | Phone |
|---|---|---|
| Wacky Warehouse | `https://www.wackywarehouse.co.uk/mill-house-stretton/` | — |
| Twycross Zoo | `https://twycrosszoo.org/` | — |
| National Sea Life Centre | `https://visitsealife.com/birmingham/` | — |

All 3 websites are **genuinely new** — none were duplicates of OSM (OSM held no
website tag for any of these 3, unlike the one duplicate in Phase 2B-1). This is
the clearest positive signal in this test: for popular commercial venues,
Geoapify's broader index does carry business URLs that bare OSM tags miss.
Phone numbers, however, were absent for all 3 — Geoapify did not outperform OSM
there either.

## 3. Was anything meaningfully better than OSM (vs the prior n=5 result)?

**Yes — modestly, and in a different way than hoped.**

- **Independent matching** (the structural finding): unlike the prior 5/5
  circular matches, all 3 here resolved to **different underlying records**,
  proving Geoapify *can* serve non-circular data for popular venues. This
  partially answers the open "is matching against Geoapify for non-OSM-derived
  content even possible" question from 2B-1's risk list — though it's still not
  a test against *our* non-OSM (manually-added/business-submitted) venues.
- **Websites (3/3 new)**: a real content gain not seen at all in the prior test
  (which found only 1 duplicate website). For popular commercial brands,
  Geoapify clearly indexes business URLs OSM lacks.
- **One toilets gap-fill** (Sea Life Centre): the *first* facility-field gain
  across both tests (0/5 + 1/3 = 1/8 total). A single data point — not a trend —
  but it shows facility data is not *categorically* absent from Geoapify, just
  rare, and concentrated in larger commercial venues.
- **Still no gain on**: parking, cafe, baby-change, wheelchair (structured),
  opening hours, phone — the core "parent-facing" fields the whole 2B
  hypothesis was about. 7 of 8 target fields remain at zero gain even for
  flagship commercial attractions.

**Bottom line on the hypothesis ("low-profile sample bias explains the 2B-1
result"):** **partially confirmed, partially refuted.** Popular venues *do*
unlock some independent data (websites, one facility field, non-circular
matching) that low-profile venues didn't — so sample bias was real. But the
**core parent-facing facility/hours dataset the project actually needs remains
almost entirely absent even for famous national attractions**. Geoapify is not
secretly holding a rich opening-hours/accessibility/parking dataset that a
bigger sample would unlock — 7/8 target fields stayed at zero across 8 venues
total (5 low-profile + 3 popular).

## 4. FINAL DECISION

**STOP — do not build the full Geoapify facility-merge pipeline.**

The original 2B hypothesis (Geoapify fills missing parent-facing intelligence:
parking, toilets, cafe, baby-change, wheelchair, opening hours) is **not
supported** even by famous national venues: across **8 venues total** (5 + 3),
only **1** ever gained a target facility field (toilets, Sea Life Centre once).
Opening hours, phone, parking, cafe, baby-change and structured wheelchair data
remained at **zero** across the board. A full-catalogue pass would cost
~94,000 credits (≈32 days of free-tier quota) for what this confirmatory run
shows would likely be a near-zero facility yield at scale.

**Narrow exception worth pursuing separately (per the user's stated fallback
rule): a postcode/address/website backfill — NOT the facility pipeline.**

- Phase 2B-1 already showed strong postcode/address gains (4/5 improved).
- This test adds **website** to that narrow list: 3/3 new, genuine gains, no
  duplicates — popular commercial venues in particular benefit.
- A scoped, one-off pass that **only writes `postcode` / `city` /
  `formatted_address` / `website`** (never facility fields, never via the
  full merge-conflict machinery) would be a legitimate, low-risk, low-cost
  improvement — primarily useful for venues whose import left these blank.
- Recommend scoping that as its own small task with its own credit budget and
  its own narrow write-allowlist (excluding all facility/accessibility fields),
  if/when prioritised. **Not actioned here — read-only test only.**

## Cost report

| Metric | Value |
|---|---|
| Credits spent this run | **6** (cap was 8; 3 venues × 2 = 6 as predicted) |
| Cumulative spend (2B-1 + 2B-1B) | 16 credits across 8 venues |
| Match outcome | 3/3 ACCEPT, 0 reject/review |
| Circularity | 0/3 circular — all independent records (contrast: 5/5 circular in 2B-1) |

No database writes were performed at any point. Nothing was committed.
