# Geoapify fixture format (Phase 2B-0)

These JSON files are **saved/mock Geoapify responses**. They let us build and
test the matching + merge logic **with zero live API calls and zero credits**.
This is the documented shape that the real HTTP client (a later phase) and the
`venue_enrichment.raw_geoapify` cache column will both produce/store.

## One file = one venue (`GeoapifyRawBundle`)

```jsonc
{
  // Snapshot of OUR venue's matchable fields (VenueMatchInput).
  "venue": {
    "id": "uuid",
    "name": "Willows Activity Farm",
    "latitude": 51.7259,
    "longitude": -0.3361,
    "postcode": "AL2 1BB",
    "city": "St Albans",
    "category_slug": "farm"
  },

  // Raw Geoapify GEOCODING response (GeoJSON FeatureCollection).
  // Used by matchVenue() to decide accept / review / reject.
  // `rank.confidence` and `rank.match_type` come from the Geocoding API only.
  "geocode": {
    "type": "FeatureCollection",
    "features": [ { "type": "Feature", "properties": { ... }, "geometry": {...} } ]
  },

  // Raw Geoapify PLACE DETAILS response (GeoJSON FeatureCollection).
  // Only present once a match is ACCEPTed. Used by geoapifyExtract.ts to pull
  // facts (facilities, wheelchair, catering, parking) + extras (opening_hours,
  // website, phone, email). Optional — REJECT/REVIEW fixtures may omit it.
  "place_details": {
    "type": "FeatureCollection",
    "features": [ { "type": "Feature", "properties": { ... }, "geometry": {...} } ]
  }
}
```

## Rules
- **Real-shaped, fake data.** Coordinates/postcodes are realistic but invented;
  no real personal data. Geoapify responses carry many more fields in practice —
  we only include the ones our extractor reads, plus a couple of extras to prove
  unread fields are tolerated.
- **Geometry is `[lon, lat]`** (GeoJSON order), the opposite of `lat`/`lon`
  properties. The matcher reads `properties.lat/lon` first, geometry as fallback.
- Add a new fixture per scenario you want to lock in (accept, distance-reject,
  name-reject, review-band, category-collision, no-candidates, …).

## Current fixtures
| File | Scenario | Expected decision |
|---|---|---|
| `willows-activity-farm.json` | clean match, full details | **accept** |
| `wrong-name-same-coords.json` | shop at same coords | **reject** (name) |
| `far-away-same-name.json` | right name, >150 m away | **reject** (distance) |
| `borderline-review.json` | partial name, no postcode | **review** (score band) |
| `category-collision.json` | perfect score, supermarket category | **review** (demoted) |
| `no-candidates.json` | empty result set | **reject** |
