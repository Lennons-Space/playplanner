/**
 * quickFilters.ts — parent-friendly quick filter presets for PlayPlanner.
 *
 * DESIGN RULES (read before changing anything):
 *   • Pure functions only — no React, no side effects, easily testable.
 *   • Never claim something is true when the data is missing or ambiguous.
 *     If a field is null → result is null (unknown), and we must not filter
 *     the venue OUT on a "positive" filter (we keep unknowns unless the filter
 *     is "hard" — i.e. a promise we must keep, like "Free entry").
 *   • Hard filters (isFreeEntry, hasParking, hasCafe, isAccessible) only
 *     SHOW venues if the relevant data is confirmed present.  They use strict
 *     "must be true to pass" — we never show "Accessible" if we just don't know.
 *   • Soft filters (rainyDay, toddlers, burnEnergy, outdoors, indoors,
 *     parentFriendly, under2Hours) re-rank without excluding unknowns, or
 *     apply a generous "might match" heuristic from category + name + age.
 *
 * Each QuickFilter has:
 *   id        — stable string, used as URL param and chip key
 *   label     — shown on the chip
 *   test(v)   — returns a MatchResult: { passes, confidence }
 *
 * Confidence:
 *   'certain' — data field directly confirms the filter
 *   'likely'  — inferred from category/name; shown with softer chip label if needed
 *   'none'    — does not match
 */

import type { Venue } from '@/types';
import { getVenueAttributes } from './venueAttributes';

// ── Facility slug helpers ─────────────────────────────────────────────────────
// Normalise slugs: lowercase, collapse hyphens/underscores.
function norm(s: string): string {
  return s.toLowerCase().replace(/[-_ ]+/g, '-');
}

function hasFacility(venue: Venue, ...targets: string[]): boolean {
  if (!venue.facilities || venue.facilities.length === 0) return false;
  return venue.facilities.some((f) => {
    const s = norm(f.slug ?? '');
    const n = (f.name ?? '').toLowerCase();
    return targets.some((t) => s.includes(norm(t)) || n.includes(t.toLowerCase()));
  });
}

// ── Category helpers ─────────────────────────────────────────────────────────

/** Categories that indicate a rainy-day suitable indoor venue. */
const RAINY_DAY_SLUGS = new Set([
  'soft-play', 'indoor-play', 'trampoline', 'museum', 'library',
  'swimming', 'bowling', 'sensory', 'arts', 'activity-centre',
  'leisure-centre', 'childrens-theatre', 'cinema',
]);

/** Categories that primarily attract toddlers (0–3). */
const TODDLER_SLUGS = new Set([
  'soft-play', 'indoor-play', 'library', 'sensory', 'farm', 'petting-zoo',
]);

/** Categories where kids genuinely burn energy. */
const ENERGY_SLUGS = new Set([
  'soft-play', 'indoor-play', 'trampoline', 'swimming', 'park', 'playground',
  'outdoor-sports', 'sports', 'activity-centre', 'adventure', 'leisure-centre',
]);

/** Categories that are primarily outdoors. */
const OUTDOOR_SLUGS = new Set([
  'park', 'outdoor-sports', 'playground', 'farm', 'nature-trail',
  'zoo', 'petting-zoo',
]);

/** Categories that are primarily indoors. */
const INDOOR_SLUGS = new Set([
  'soft-play', 'indoor-play', 'swimming', 'trampoline', 'library',
  'museum', 'cinema', 'arts', 'sensory', 'bowling', 'activity-centre',
  'leisure-centre', 'childrens-theatre',
]);

/**
 * Categories likely to be quick visits (under ~2 hours for most families).
 * These are small-footprint, non-day-trip venues.
 */
const QUICK_VISIT_SLUGS = new Set([
  'playground', 'library', 'park', 'sensory',
]);

// ── Match result ──────────────────────────────────────────────────────────────

export type FilterConfidence = 'certain' | 'likely' | 'none';

export interface FilterMatchResult {
  /** Does this venue pass this filter? */
  passes: boolean;
  /** How confident we are in the match. */
  confidence: FilterConfidence;
}

// ── Filter IDs ────────────────────────────────────────────────────────────────

export type QuickFilterId =
  | 'rainy-day'
  | 'free'
  | 'toddlers'
  | 'burn-energy'
  | 'outdoors'
  | 'indoors'
  | 'parent-friendly'
  | 'easy-parking'
  | 'has-cafe'
  | 'accessible'
  | 'under-2-hours';

// ── Filter definitions ────────────────────────────────────────────────────────

export interface QuickFilter {
  id: QuickFilterId;
  label: string;
  /** Short description — used in accessibility labels. */
  description: string;
  /**
   * Test a venue against this filter.
   * For hard filters (free, has-cafe, easy-parking, accessible):
   *   - passes=true only when data CONFIRMS the feature exists.
   *   - passes=false when data is absent or contradicted.
   * For soft filters (rainy-day, toddlers, burn-energy, etc.):
   *   - passes=true when category OR age range infers a good match.
   *   - confidence indicates how strong the inference is.
   */
  test: (venue: Venue) => FilterMatchResult;
}

// ── Individual filter implementations ────────────────────────────────────────

function testRainyDay(venue: Venue): FilterMatchResult {
  const attrs = getVenueAttributes(venue);
  const slug = venue.category?.slug ?? '';

  // Definite indoor (from venueAttributes): always passes with certainty.
  if (attrs.isIndoor === true) {
    return { passes: true, confidence: 'certain' };
  }
  // Known outdoor and nothing else suggests indoor: skip it.
  if (attrs.isOutdoor === true) {
    return { passes: false, confidence: 'none' };
  }
  // Category is in our rainy-day set (normalised lookup).
  if (RAINY_DAY_SLUGS.has(norm(slug))) {
    return { passes: true, confidence: 'certain' };
  }
  // No category data but name contains strong indoor indicators.
  const name = (venue.name ?? '').toLowerCase();
  const nameHints = ['soft play', 'indoor', 'museum', 'library', 'swimming', 'trampoline', 'bowling'];
  if (nameHints.some((h) => name.includes(h))) {
    return { passes: true, confidence: 'likely' };
  }
  return { passes: false, confidence: 'none' };
}

function testFree(venue: Venue): FilterMatchResult {
  // Hard filter: only show if we KNOW it's free. Missing data = not shown.
  const attrs = getVenueAttributes(venue);
  if (attrs.isFree === true) {
    return { passes: true, confidence: 'certain' };
  }
  return { passes: false, confidence: 'none' };
}

function testToddlers(venue: Venue): FilterMatchResult {
  const slug = venue.category?.slug ?? '';
  const attrs = getVenueAttributes(venue);

  // Explicit age data: max_age covers toddlers (up to 3).
  // min_age <= 3 means the venue accepts toddlers.
  // We require max_age > 0 to avoid matching venues where ages are 0/0.
  const minAgeOk = typeof venue.min_age === 'number' && venue.min_age <= 3;
  const maxAgeOk = typeof venue.max_age === 'number' && venue.max_age > 0;
  if (minAgeOk && maxAgeOk) {
    return { passes: true, confidence: 'certain' };
  }

  // Explicit toddler-friendly from venueAttributes.
  if (attrs.isToddlerFriendly === true) {
    return { passes: true, confidence: 'certain' };
  }

  // Category inferred.
  if (TODDLER_SLUGS.has(norm(slug))) {
    return { passes: true, confidence: 'likely' };
  }

  return { passes: false, confidence: 'none' };
}

function testBurnEnergy(venue: Venue): FilterMatchResult {
  const slug = venue.category?.slug ?? '';
  if (ENERGY_SLUGS.has(norm(slug))) {
    return { passes: true, confidence: 'certain' };
  }
  // Name-based fallback: trampolining / adventure / activity.
  const name = (venue.name ?? '').toLowerCase();
  const nameHints = ['trampoline', 'adventure', 'activity', 'sports centre', 'leisure centre', 'splash'];
  if (nameHints.some((h) => name.includes(h))) {
    return { passes: true, confidence: 'likely' };
  }
  return { passes: false, confidence: 'none' };
}

function testOutdoors(venue: Venue): FilterMatchResult {
  const attrs = getVenueAttributes(venue);
  if (attrs.isOutdoor === true) {
    return { passes: true, confidence: 'certain' };
  }
  const slug = venue.category?.slug ?? '';
  if (OUTDOOR_SLUGS.has(norm(slug))) {
    return { passes: true, confidence: 'certain' };
  }
  const name = (venue.name ?? '').toLowerCase();
  const nameHints = ['park', 'farm', 'nature', 'trail', 'zoo', 'garden'];
  if (nameHints.some((h) => name.includes(h))) {
    return { passes: true, confidence: 'likely' };
  }
  return { passes: false, confidence: 'none' };
}

function testIndoors(venue: Venue): FilterMatchResult {
  const attrs = getVenueAttributes(venue);
  if (attrs.isIndoor === true) {
    return { passes: true, confidence: 'certain' };
  }
  const slug = venue.category?.slug ?? '';
  if (INDOOR_SLUGS.has(norm(slug))) {
    return { passes: true, confidence: 'certain' };
  }
  const name = (venue.name ?? '').toLowerCase();
  const nameHints = ['soft play', 'indoor', 'museum', 'library', 'trampoline', 'bowling', 'cinema'];
  if (nameHints.some((h) => name.includes(h))) {
    return { passes: true, confidence: 'likely' };
  }
  return { passes: false, confidence: 'none' };
}

function testParentFriendly(venue: Venue): FilterMatchResult {
  // Look for a cluster of parent-useful facilities: toilets + at least one more.
  const hasToilets   = hasFacility(venue, 'toilet', 'toilets', 'wc');
  const hasCafeFood  = hasFacility(venue, 'cafe', 'food', 'restaurant', 'kiosk');
  const hasParking   = hasFacility(venue, 'parking', 'car park', 'car-park');
  const hasBaby      = hasFacility(venue, 'baby', 'baby-change', 'baby changing', 'nappy');
  const hasAccess    = hasFacility(venue, 'accessible', 'accessibility', 'wheelchair');

  const score =
    (hasToilets ? 2 : 0) +
    (hasCafeFood ? 1 : 0) +
    (hasParking ? 1 : 0) +
    (hasBaby ? 2 : 0) +
    (hasAccess ? 1 : 0);

  // "Parent Friendly" requires toilets OR baby change PLUS at least one more signal.
  if ((hasToilets || hasBaby) && score >= 3) {
    return { passes: true, confidence: 'certain' };
  }
  if (score >= 3) {
    return { passes: true, confidence: 'likely' };
  }
  return { passes: false, confidence: 'none' };
}

function testEasyParking(venue: Venue): FilterMatchResult {
  // Hard: only show if parking is confirmed in facilities.
  if (hasFacility(venue, 'parking', 'car park', 'car-park')) {
    return { passes: true, confidence: 'certain' };
  }
  return { passes: false, confidence: 'none' };
}

function testHasCafe(venue: Venue): FilterMatchResult {
  // Hard: only show if cafe/food/restaurant is confirmed in facilities.
  if (hasFacility(venue, 'cafe', 'food', 'restaurant', 'kiosk', 'snack')) {
    return { passes: true, confidence: 'certain' };
  }
  return { passes: false, confidence: 'none' };
}

function testAccessible(venue: Venue): FilterMatchResult {
  // Hard: only show if accessibility is confirmed in facilities.
  if (hasFacility(venue, 'accessible', 'accessibility', 'wheelchair', 'disabled')) {
    return { passes: true, confidence: 'certain' };
  }
  return { passes: false, confidence: 'none' };
}

function testUnder2Hours(venue: Venue): FilterMatchResult {
  const slug = venue.category?.slug ?? '';
  if (QUICK_VISIT_SLUGS.has(norm(slug))) {
    return { passes: true, confidence: 'likely' };
  }
  // Small venues inferred from name.
  const name = (venue.name ?? '').toLowerCase();
  const nameHints = ['park', 'library', 'playground'];
  if (nameHints.some((h) => name.includes(h))) {
    return { passes: true, confidence: 'likely' };
  }
  return { passes: false, confidence: 'none' };
}

// ── Exported filter catalogue ─────────────────────────────────────────────────

export const QUICK_FILTERS: QuickFilter[] = [
  {
    id: 'rainy-day',
    label: 'Rainy Day',
    description: 'Indoor venues that work when the weather is bad',
    test: testRainyDay,
  },
  {
    id: 'free',
    label: 'Free Entry',
    description: 'Only venues confirmed as free to enter',
    test: testFree,
  },
  {
    id: 'toddlers',
    label: 'Toddlers',
    description: 'Good for children aged 0–3',
    test: testToddlers,
  },
  {
    id: 'burn-energy',
    label: 'Burn Energy',
    description: 'Active venues where kids can run around',
    test: testBurnEnergy,
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    description: 'Parks, farms, nature, outdoor play',
    test: testOutdoors,
  },
  {
    id: 'indoors',
    label: 'Indoors',
    description: 'Soft play, museums, swimming pools, libraries',
    test: testIndoors,
  },
  {
    id: 'parent-friendly',
    label: 'Parent Friendly',
    description: 'Has toilets, baby change, parking or cafe',
    test: testParentFriendly,
  },
  {
    id: 'easy-parking',
    label: 'Easy Parking',
    description: 'Only venues with confirmed on-site parking',
    test: testEasyParking,
  },
  {
    id: 'has-cafe',
    label: 'Has Cafe',
    description: 'Only venues with confirmed cafe or food',
    test: testHasCafe,
  },
  {
    id: 'accessible',
    label: 'Accessible',
    description: 'Only venues with confirmed accessibility features',
    test: testAccessible,
  },
  {
    id: 'under-2-hours',
    label: 'Under 2 Hours',
    description: 'Shorter, lighter visits — parks, libraries, local spots',
    test: testUnder2Hours,
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up a filter by its ID. Returns undefined if not found — callers must
 * handle this gracefully (e.g. URL param was tampered with).
 */
export function getQuickFilter(id: string): QuickFilter | undefined {
  return QUICK_FILTERS.find((f) => f.id === id);
}

/**
 * Apply one or more quick filters to a venue list.
 *
 * Logic:
 *   - "Hard" filters (free, easy-parking, has-cafe, accessible) require
 *     passes=true to keep the venue. Venues without the data are excluded.
 *   - "Soft" filters keep a venue if passes=true. If no venue passes, we
 *     fall through gracefully and return all venues (never an empty screen
 *     due to over-filtering).
 *
 * Multiple filters are AND-ed: a venue must satisfy ALL selected filters.
 *
 * @param venues   Full venue list from useNearbyVenues.
 * @param filterIds The selected quick filter IDs (empty array = no filtering).
 */
export function applyQuickFilters(venues: Venue[], filterIds: QuickFilterId[]): Venue[] {
  if (filterIds.length === 0) return venues;

  const filters = filterIds
    .map((id) => getQuickFilter(id))
    .filter((f): f is QuickFilter => f !== undefined);

  if (filters.length === 0) return venues;

  const filtered = venues.filter((venue) =>
    filters.every((filter) => filter.test(venue).passes),
  );

  // Safety net: if the combination filtered everything out, return the full
  // list rather than a blank screen. This protects against bad data coverage.
  return filtered.length > 0 ? filtered : venues;
}

/**
 * Derive venue card badges from the family score and venue data.
 * Returns at most 2 badges. Never claims something without data support.
 *
 * Badge rules:
 *   "Family Favourite"     — recommendationScore >= 70 (see familyScore.ts)
 *   "Great for Toddlers"   — min_age <= 2 and max_age > 0
 *   "Rainy Day Spot"       — isIndoor === true or RAINY_DAY_SLUGS category
 *   "Outdoor Play"         — isOutdoor === true or OUTDOOR_SLUGS category
 *   "Free Entry"           — price_range === 'free'
 */
export function deriveVenueBadges(
  venue: Venue,
  recommendationScore: number,
): string[] {
  const badges: string[] = [];
  const attrs = getVenueAttributes(venue);
  const slug = venue.category?.slug ?? '';

  // Badge 1: Family Favourite — based on recommendation score quality signal.
  if (recommendationScore >= 70) {
    badges.push('Family Favourite');
  }

  // Badge 2 (earliest slot available): Toddler-friendly.
  if (
    badges.length < 2 &&
    typeof venue.min_age === 'number' &&
    venue.min_age <= 2 &&
    typeof venue.max_age === 'number' &&
    venue.max_age > 0
  ) {
    badges.push('Great for Toddlers');
  }

  // Badge 3: Rainy Day.
  if (
    badges.length < 2 &&
    (attrs.isIndoor === true || RAINY_DAY_SLUGS.has(norm(slug)))
  ) {
    badges.push('Rainy Day Spot');
  }

  // Badge 4: Outdoor Play.
  if (
    badges.length < 2 &&
    (attrs.isOutdoor === true || OUTDOOR_SLUGS.has(norm(slug)))
  ) {
    badges.push('Outdoor Play');
  }

  // Badge 5: Free Entry — only when we KNOW it's free.
  if (badges.length < 2 && attrs.isFree === true) {
    badges.push('Free Entry');
  }

  return badges.slice(0, 2);
}

/**
 * Validate a quick filter ID from a URL param.
 * Returns null if the value is not a known filter ID (tamper protection).
 */
export function parseQuickFilterId(raw: string | string[] | undefined): QuickFilterId | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const found = QUICK_FILTERS.find((f) => f.id === v);
  return found ? found.id : null;
}
