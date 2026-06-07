// ─────────────────────────────────────────────────────────────────────────────
// lib/recommendations/recommendationReasons.ts
//
// Generates up to 3 human-readable reason strings for why a venue is recommended.
// Used by CuratedResult (results screen) and NearbyPreview (home screen) to
// surface honest, data-backed context alongside each venue card.
//
// DESIGN PRINCIPLES:
//   • Pure function — no React, no side effects, no logging, no network.
//   • Priority-ordered: the most compelling reason comes first.
//   • Honest: never claims something without data to back it up.
//   • Privacy-safe: no venue data is logged or persisted.
//
// Consumer: app/explore/results.tsx (CuratedResult), components/home/NearbyPreview.tsx
// ─────────────────────────────────────────────────────────────────────────────

import type { Venue } from '@/types';

// ── Slug normalisation ────────────────────────────────────────────────────────

/** Normalise a slug: lowercase, collapse hyphens/underscores/spaces to hyphen. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[-_ ]+/g, '-');
}

// ── Facility helper ───────────────────────────────────────────────────────────
// Copied verbatim from lib/quickFilters.ts — handles both the flat Facility[]
// shape (direct facilities query) and the nested { facility: Facility }[] shape
// (via venue_facilities join). Different hooks return different shapes.

function hasFacility(venue: Venue, ...targets: string[]): boolean {
  if (!venue.facilities || venue.facilities.length === 0) return false;
  return venue.facilities.some((facilityRow) => {
    const obj =
      (facilityRow as unknown as { facility?: Record<string, unknown> }).facility ??
      (facilityRow as unknown as Record<string, unknown>);
    const s = norm((obj.slug as string | undefined) ?? '');
    const n = ((obj.name as string | undefined) ?? '').toLowerCase();
    return targets.some((t) => s.includes(norm(t)) || n.includes(t.toLowerCase()));
  });
}

// ── Category slug sets ────────────────────────────────────────────────────────

/** Slugs that qualify for "Great For Toddlers" via category (min_age check is separate). */
const TODDLER_SLUGS = new Set([
  'soft-play', 'sensory', 'baby-gym', 'toddler-group', 'library', 'playground',
]);

/**
 * Indoor slugs — must stay in sync with INDOOR_SLUGS in lib/venueAttributes.ts.
 * Qualifies venue for "Rainy Day Winner".
 */
const INDOOR_SLUGS = new Set([
  'soft-play', 'indoor-play', 'swimming', 'trampoline', 'library',
  'arts', 'bowling', 'sensory', 'activity-centre', 'leisure-centre',
  'childrens-theatre', 'cinema',
]);

/** Slugs where kids burn real energy. Qualifies for "Burn Energy". */
const ENERGY_SLUGS = new Set([
  'soft-play', 'trampoline', 'swimming', 'park', 'outdoor-sports',
  'adventure-park', 'climbing', 'skating', 'sports-centre',
]);

/** Full-day destination categories. Qualifies for "Full Day Adventure". */
const FULL_DAY_SLUGS = new Set([
  'theme-park', 'zoo', 'farm', 'adventure-park', 'aquarium', 'safari', 'wildlife-park',
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate up to 3 honest, priority-ordered reasons why this venue is recommended.
 *
 * Reasons are checked in priority order; the first 3 that fire are returned.
 * Missing data never falsely triggers a reason — every condition requires
 * confirmed field values or category data.
 *
 * @param venue - The venue to evaluate. Must have at least `id` and `name`.
 * @returns Array of 0–3 short reason strings, highest priority first.
 */
export function generateRecommendationReasons(venue: Venue): string[] {
  const reasons: string[] = [];
  const slug = norm(venue.category?.slug ?? '');

  // 1. Family Favourite — real social proof: highly rated with enough reviews to trust.
  if (venue.average_rating >= 4.5 && venue.review_count >= 10) {
    reasons.push('Family Favourite');
  }
  if (reasons.length >= 3) return reasons;

  // 2. Great For Toddlers — category-based ONLY.
  //
  // WHY we no longer trust `min_age <= 2` as a positive signal:
  // catalogue-wide, min_age is an OSM-import DEFAULT (see
  // scripts/import/02_transform_osm.js SLUG_AGES), not a confirmed fact.
  // ~41% of approved venues carry min_age=0 purely because nobody ever
  // assessed age-suitability — including attractions like the London
  // Dungeon, Big Ben, SEA LIFE and Shrek's Adventure (all min_age=0,
  // category=attraction/animal-attraction). Surfacing those as
  // "Great For Toddlers" is a trust and safety embarrassment for a
  // children's app. The venue TYPE (category) is the only reliable signal
  // here — see lib/toddlerSafeCategories.ts for the fuller rationale.
  const toddlerByCategory =
    slug !== '' && TODDLER_SLUGS.has(slug);
  if (toddlerByCategory) {
    reasons.push('Great For Toddlers');
  }
  if (reasons.length >= 3) return reasons;

  // 3. Rainy Day Winner — confirmed indoor category.
  if (slug !== '' && INDOOR_SLUGS.has(slug)) {
    reasons.push('Rainy Day Winner');
  }
  if (reasons.length >= 3) return reasons;

  // 4. Burn Energy — active physical category.
  if (slug !== '' && ENERGY_SLUGS.has(slug)) {
    reasons.push('Burn Energy');
  }
  if (reasons.length >= 3) return reasons;

  // 5. Parent Friendly — facilities that make life easier for parents.
  //    Passes if: (has toilet AND has baby-change) OR (toilet + baby-change + parking >= 3).
  const hasToilet    = hasFacility(venue, 'toilet', 'wc');
  const hasBabyChange = hasFacility(venue, 'baby-change', 'baby_change');
  const hasParking   = hasFacility(venue, 'parking', 'car-park', 'car park');
  const facilityScore =
    (hasToilet ? 1 : 0) + (hasBabyChange ? 1 : 0) + (hasParking ? 1 : 0);
  if ((hasToilet && hasBabyChange) || facilityScore >= 3) {
    reasons.push('Parent Friendly');
  }
  if (reasons.length >= 3) return reasons;

  // 6. Budget Friendly — confirmed free or budget price range.
  if (venue.price_range === 'free' || venue.price_range === 'budget') {
    reasons.push('Budget Friendly');
  }
  if (reasons.length >= 3) return reasons;

  // 7. Full Day Adventure — destinations that fill the whole day.
  if (slug !== '' && FULL_DAY_SLUGS.has(slug)) {
    reasons.push('Full Day Adventure');
  }

  return reasons.slice(0, 3);
}
