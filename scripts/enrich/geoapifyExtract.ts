// =============================================================================
// scripts/enrich/geoapifyExtract.ts
//
// Pure functions: a raw Geoapify GeoJSON response/feature -> Layer 1 facts
// (annotated with provenance) + capture-only extras (opening hours, contact).
//
// Design rules (same discipline as osmExtract.ts):
//   - No side effects, no I/O, no network. Input is already-fetched JSON.
//   - NULL means "Geoapify did not tell us". Never guess.
//   - 'explicit' = a structured Geoapify property (facilities.toilets,
//     contact.phone, wheelchair, ...). 'inferred' = derived only from the
//     category strings. The merge engine treats these tiers differently.
//   - Geoapify is OSM-derived, so its explicit values are about as trustworthy
//     as OSM's — but OSM *explicit* still wins on conflict (see mergeFacts.ts).
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import type {
  AnnotatedFacts,
  GeoapifyExtras,
  GeoapifyFeature,
  GeoapifyFeatureProperties,
  GeoapifyResponse,
  IndoorOutdoor,
  WheelchairAccess,
  ActivityLevel,
  FactProvenance,
} from '../../types/enrichment';

// ── Response helpers ────────────────────────────────────────────────────────

/** Return the first feature of a Geoapify response, or null if there are none. */
export function firstFeature(resp: GeoapifyResponse | null | undefined): GeoapifyFeature | null {
  if (!resp || !Array.isArray(resp.features) || resp.features.length === 0) return null;
  return resp.features[0] ?? null;
}

/** Convenience: first feature's properties, or null. */
export function firstProperties(
  resp: GeoapifyResponse | null | undefined,
): GeoapifyFeatureProperties | null {
  return firstFeature(resp)?.properties ?? null;
}

// ── Category heuristics (inferred-tier signals) ───────────────────────────────
// Geoapify categories are dot-separated, e.g. 'leisure.park',
// 'entertainment.museum', 'commercial.supermarket'. We only infer from them
// when we have nothing stronger; these are always 'inferred' provenance.

function categoriesOf(props: GeoapifyFeatureProperties): string[] {
  if (Array.isArray(props.categories) && props.categories.length > 0) return props.categories;
  return props.category ? [props.category] : [];
}

function anyCategoryMatches(cats: string[], needles: string[]): boolean {
  return cats.some((c) => needles.some((n) => c.includes(n)));
}

const INDOOR_CAT_HINTS = [
  'entertainment.museum', 'entertainment.aquarium', 'entertainment.cinema',
  'leisure.indoor', 'sport.fitness', 'sport.swimming_pool', 'commercial.indoor',
  'entertainment.bowling',
];
const OUTDOOR_CAT_HINTS = [
  'leisure.park', 'leisure.playground', 'leisure.garden', 'natural', 'national_park',
  'tourism.attraction.viewpoint', 'sport.pitch',
];
const MIXED_CAT_HINTS = ['entertainment.zoo', 'entertainment.theme_park', 'leisure.park.garden'];

const HIGH_ACTIVITY_CAT_HINTS = [
  'sport', 'leisure.playground', 'entertainment.activity_park', 'entertainment.bowling',
  'leisure.trampoline', 'leisure.swimming_pool',
];
const LOW_ACTIVITY_CAT_HINTS = ['entertainment.museum', 'entertainment.gallery', 'education.library'];

// ── Boolean facility helpers ──────────────────────────────────────────────────
// Geoapify exposes facilities/catering/parking as objects of boolean-ish values.

function truthy(v: boolean | string | undefined): boolean {
  return v === true || v === 'true' || v === 'yes';
}
function falsy(v: boolean | string | undefined): boolean {
  return v === false || v === 'false' || v === 'no';
}

// Helper mirroring osmProvenance.fv: null value => null provenance.
function fv<T>(value: T | null, provenance: FactProvenance): { value: T | null; provenance: FactProvenance | null } {
  return value === null ? { value: null, provenance: null } : { value, provenance };
}

// ── Field derivations ─────────────────────────────────────────────────────────

function deriveIndoorOutdoor(cats: string[]): IndoorOutdoor | null {
  // Mixed first (zoo/theme_park) so it isn't swallowed by indoor/outdoor hints.
  if (anyCategoryMatches(cats, MIXED_CAT_HINTS)) return 'mixed';
  if (anyCategoryMatches(cats, INDOOR_CAT_HINTS)) return 'indoor';
  if (anyCategoryMatches(cats, OUTDOOR_CAT_HINTS)) return 'outdoor';
  return null;
}

function deriveActivityLevel(cats: string[]): ActivityLevel | null {
  if (anyCategoryMatches(cats, HIGH_ACTIVITY_CAT_HINTS)) return 'high';
  if (anyCategoryMatches(cats, LOW_ACTIVITY_CAT_HINTS)) return 'low';
  return null;
}

function deriveWheelchair(props: GeoapifyFeatureProperties): WheelchairAccess | null {
  switch (props.wheelchair) {
    case 'yes':
    case 'designated': return 'yes';
    case 'limited':    return 'limited';
    case 'no':         return 'no';
    default:           return null;
  }
}

function deriveParking(props: GeoapifyFeatureProperties, cats: string[]): boolean | null {
  if (props.parking && Object.keys(props.parking).length > 0) return true;
  if (truthy(props.facilities?.['parking'])) return true;
  if (falsy(props.facilities?.['parking'])) return false;
  if (anyCategoryMatches(cats, ['parking'])) return true;
  return null;
}

function deriveCafe(props: GeoapifyFeatureProperties, cats: string[]): boolean | null {
  if (props.catering && Object.keys(props.catering).length > 0) {
    if (truthy(props.catering['cafe']) || truthy(props.catering['restaurant'])) return true;
  }
  if (anyCategoryMatches(cats, ['catering.cafe', 'catering.restaurant', 'catering.fast_food'])) {
    return true;
  }
  // No reliable negative signal for "no cafe".
  return null;
}

function deriveToilets(props: GeoapifyFeatureProperties): boolean | null {
  if (truthy(props.facilities?.['toilets'])) return true;
  if (falsy(props.facilities?.['toilets'])) return false;
  return null;
}

function deriveBabyChange(props: GeoapifyFeatureProperties): boolean | null {
  const f = props.facilities ?? {};
  if (truthy(f['changing_table']) || truthy(f['baby_changing'])) return true;
  if (falsy(f['changing_table']) || falsy(f['baby_changing'])) return false;
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Derive AnnotatedFacts from a single Geoapify feature's properties.
 *
 * Structured fields (facilities/catering/parking/wheelchair) are 'explicit'.
 * Category-derived fields (indoor_outdoor, activity_level) are 'inferred'.
 * visit_duration_mins is always null — Geoapify does not provide it.
 */
export function extractGeoapifyAnnotatedFacts(
  props: GeoapifyFeatureProperties,
): AnnotatedFacts {
  const cats = categoriesOf(props);

  return {
    indoor_outdoor:        fv<IndoorOutdoor>(deriveIndoorOutdoor(cats), 'inferred'),
    parking_available:     fv<boolean>(deriveParking(props, cats),      'explicit'),
    cafe_available:        fv<boolean>(deriveCafe(props, cats),         'explicit'),
    toilets_available:     fv<boolean>(deriveToilets(props),            'explicit'),
    baby_change_available: fv<boolean>(deriveBabyChange(props),         'explicit'),
    wheelchair_accessible: fv<WheelchairAccess>(deriveWheelchair(props), 'explicit'),
    visit_duration_mins:   fv<number>(null,                             'inferred'),
    activity_level:        fv<ActivityLevel>(deriveActivityLevel(cats), 'inferred'),
  };
}

/**
 * Pull the capture-only extras (no DB column yet — Phase 2B-4) from a feature.
 * These prove the data exists in the dry-run report before we commit schema.
 */
export function extractGeoapifyExtras(props: GeoapifyFeatureProperties): GeoapifyExtras {
  return {
    opening_hours: props.opening_hours ?? null,
    website:       props.contact?.website ?? props.website ?? null,
    phone:         props.contact?.phone ?? null,
    email:         props.contact?.email ?? null,
    categories:    categoriesOf(props),
  };
}
