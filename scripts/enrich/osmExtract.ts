// =============================================================================
// scripts/enrich/osmExtract.ts
//
// Pure functions: OSM tags -> Layer 1 raw facts.
//
// Design rules:
//   - No side effects, no I/O, no imports beyond the enrichment types.
//   - Every function is independently testable.
//   - NULL means "not assessed". Use null, never guess.
//   - false means "confirmed absent via an explicit tag value".
//   - Category inference (tourism/leisure) is lower confidence than explicit
//     tags (indoor=yes, wheelchair=yes). The confidence scoring in enrichVenues.ts
//     distinguishes these two tiers.
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import type { RawFacts, IndoorOutdoor, WheelchairAccess, ActivityLevel } from '../../types/enrichment';

// ── Category classification sets ──────────────────────────────────────────────
// These mirror the category slugs used by PlayPlanner's import pipeline.
// When OSM uses tourism= or leisure= to classify a venue, we infer
// indoor_outdoor and activity_level from these sets.

const INDOOR_TOURISM = new Set([
  'museum', 'gallery', 'aquarium', 'zoo', 'theme_park',
]);

const INDOOR_LEISURE = new Set([
  'swimming_pool', 'indoor_swimming_pool', 'sports_centre',
  'fitness_centre', 'bowling_alley', 'trampoline_park', 'indoor_play',
]);

const OUTDOOR_LEISURE = new Set([
  'park', 'playground', 'pitch', 'garden', 'golf_course', 'nature_reserve',
]);

const OUTDOOR_TOURISM = new Set([
  'viewpoint', 'picnic_site', 'camp_site', 'caravan_site',
]);

// These venues have significant indoor AND outdoor areas -- return 'mixed'
const MIXED_TOURISM = new Set([
  'theme_park', 'zoo', 'farm',
]);

const HIGH_ACTIVITY = new Set([
  'sports_centre', 'fitness_centre', 'swimming_pool',
  'bowling_alley', 'pitch', 'playground', 'trampoline_park', 'indoor_play',
]);

// Sports played on outdoor pitches or courses. When a venue carries one of
// these sport= tags alongside leisure=sports_centre, classifying it as 'indoor'
// would be wrong — the clubhouse is inside but the game is outside. These
// venues are classified as 'mixed' instead. See deriveIndoorOutdoor().
const OUTDOOR_SPORTS = new Set([
  'cricket', 'rugby_union', 'rugby_league', 'rugby', 'football', 'soccer',
  'tennis', 'bowls', 'athletics', 'golf', 'hockey', 'field_hockey',
  'baseball', 'lacrosse', 'american_football', 'softball', 'cycling',
  'equestrian', 'horse_racing', 'shooting', 'archery', 'motorsport',
  'netball', 'rounders', 'croquet', 'polo',
]);

const LOW_ACTIVITY = new Set([
  'museum', 'gallery', 'library', 'aquarium',
]);

// ── Visit duration estimates (minutes) by OSM type ────────────────────────────
// These are conservative estimates based on typical family visit length.
// When multiple tags match, the first match wins (tourism > leisure).
const DURATION_HINTS: Record<string, number> = {
  theme_park:      360,
  zoo:             240,
  farm:            180,
  aquarium:        120,
  museum:           90,
  gallery:          60,
  sports_centre:    90,
  playground:       60,
  park:            120,
  swimming_pool:    90,
  bowling_alley:    90,
  fitness_centre:   60,
  trampoline_park:  90,
  indoor_play:      60,
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Given a raw OSM tags object, derive all Layer 1 facts.
 *
 * The caller is responsible for providing the correct tags for the venue's
 * osm_id. This function never makes network requests.
 *
 * Each field is either:
 *   - A value:  derived from an explicit tag or category inference.
 *   - null:     could not be determined — the enrichment script records this
 *               as "not assessed", not as "absent".
 */
export function extractRawFacts(tags: Record<string, string>): RawFacts {
  return {
    indoor_outdoor:        deriveIndoorOutdoor(tags),
    parking_available:     deriveParking(tags),
    cafe_available:        deriveCafe(tags),
    toilets_available:     deriveToilets(tags),
    baby_change_available: deriveBabyChange(tags),
    wheelchair_accessible: deriveWheelchair(tags),
    visit_duration_mins:   deriveDuration(tags),
    activity_level:        deriveActivityLevel(tags),
  };
}

// ── Internal derivation functions ─────────────────────────────────────────────
// Each function answers a single question about the venue using the OSM tags.
// Ordered from highest-confidence signal (explicit tag) to lowest (building tag).

function deriveIndoorOutdoor(tags: Record<string, string>): IndoorOutdoor | null {
  // Explicit indoor= tag is the highest-confidence signal.
  // Mappers only add this when the distinction matters, so trust it directly.
  if (tags['indoor'] === 'yes') return 'indoor';
  if (tags['indoor'] === 'no')  return 'outdoor';

  const leisure = tags['leisure'] ?? '';
  const tourism = tags['tourism'] ?? '';
  const amenity = tags['amenity'] ?? '';
  const sport   = tags['sport']   ?? '';

  // Mixed: significant indoor AND outdoor areas. Check before pure-indoor sets
  // because theme_park and zoo appear in both MIXED_TOURISM and INDOOR_TOURISM.
  if (MIXED_TOURISM.has(tourism)) return 'mixed';

  // Outdoor sports at a sports_centre → mixed, not indoor.
  // Cricket clubs, rugby grounds, and football clubs all carry leisure=sports_centre
  // for their clubhouse, but the primary activity is on an outdoor pitch.
  // Classifying them as 'indoor' would wrongly exclude them from sunny-day filters
  // and include them in rainy-day results where they do not belong.
  // Note: explicit indoor=yes (checked above) still overrides this rule.
  if (OUTDOOR_SPORTS.has(sport) && INDOOR_LEISURE.has(leisure)) return 'mixed';

  // Reliably indoor by category
  if (INDOOR_TOURISM.has(tourism)) return 'indoor';
  if (INDOOR_LEISURE.has(leisure)) return 'indoor';
  if (amenity === 'library' || amenity === 'cinema') return 'indoor';

  // Reliably outdoor by category
  if (OUTDOOR_LEISURE.has(leisure)) return 'outdoor';
  if (OUTDOOR_TOURISM.has(tourism)) return 'outdoor';

  // building= is a weaker signal: the building might be on a site that is
  // predominantly outdoor (e.g. a visitor centre inside a nature reserve).
  // Only use it when no stronger classification is available.
  if (tags['building'] && tags['building'] !== 'no') return 'indoor';

  return null; // genuinely unknown -- do not guess
}

function deriveParking(tags: Record<string, string>): boolean | null {
  // Explicit 'no' is a confirmed absence.
  if (tags['parking'] === 'no') return false;

  // Any parking= value other than 'no', or an amenity=parking tag, confirms presence.
  if (
    tags['amenity'] === 'parking'    ||
    tags['parking'] === 'surface'    ||
    tags['parking'] === 'multi-storey' ||
    tags['parking'] === 'underground' ||
    tags['parking'] === 'yes'
  ) return true;

  // IMPORTANT: Absence of a parking tag does NOT mean no parking.
  // Most OSM surveyors simply omit the tag when parking exists but is not
  // a notable feature. Return null to avoid false negatives.
  return null;
}

function deriveCafe(tags: Record<string, string>): boolean | null {
  // These amenity values confirm food/drink is available on site.
  if (
    tags['amenity'] === 'cafe'       ||
    tags['amenity'] === 'restaurant' ||
    tags['amenity'] === 'fast_food'  ||
    tags['amenity'] === 'food_court'
  ) return true;

  // No negative signal in OSM for "no cafe" -- return null not false.
  return null;
}

function deriveToilets(tags: Record<string, string>): boolean | null {
  if (tags['toilets'] === 'yes' || tags['amenity'] === 'toilets') return true;
  if (tags['toilets'] === 'no') return false;

  // IMPORTANT: Most surveyors omit toilets= entirely even when toilets exist.
  // Returning null here avoids incorrectly marking venues as toilet-free.
  return null;
}

function deriveBabyChange(tags: Record<string, string>): boolean | null {
  // changing_table= is the canonical OSM key for nappy changing facilities.
  if (tags['changing_table'] === 'yes') return true;
  if (tags['changing_table'] === 'no')  return false;

  // toilets:changing_table is a secondary key used by some mappers
  if (tags['toilets:changing_table'] === 'yes') return true;
  if (tags['toilets:changing_table'] === 'no')  return false;

  return null;
}

function deriveWheelchair(tags: Record<string, string>): WheelchairAccess | null {
  // wheelchair= is a standardised OSM key with well-defined values.
  // We do not set 'unknown' here -- that value is reserved for the caller
  // to use when they have explicitly assessed the venue but found the source
  // ambiguous (e.g. conflicting tags from different surveys).
  switch (tags['wheelchair']) {
    case 'yes':     return 'yes';
    case 'limited': return 'limited';
    case 'no':      return 'no';
    default:        return null;
  }
}

function deriveDuration(tags: Record<string, string>): number | null {
  const tourism = tags['tourism'] ?? '';
  const leisure = tags['leisure'] ?? '';

  // Tourism takes priority over leisure when both are present (e.g. a zoo
  // tagged as both tourism=zoo and leisure=park).
  return DURATION_HINTS[tourism] ?? DURATION_HINTS[leisure] ?? null;
}

function deriveActivityLevel(tags: Record<string, string>): ActivityLevel | null {
  const leisure = tags['leisure'] ?? '';
  const tourism = tags['tourism'] ?? '';
  const sport   = tags['sport'] ?? '';

  if (HIGH_ACTIVITY.has(leisure)) return 'high';

  // Any sport= tag implies the venue is used for physical activity,
  // regardless of the specific sport. This is intentionally broad.
  if (sport !== '') return 'high';

  if (LOW_ACTIVITY.has(tourism) || LOW_ACTIVITY.has(leisure)) return 'low';

  // Mixed-type venues (theme parks, zoos, farms) have varied activity --
  // walking around but not sustained physical exertion.
  if (
    tourism === 'theme_park' ||
    tourism === 'zoo'        ||
    tourism === 'farm'
  ) return 'medium';

  return null;
}
