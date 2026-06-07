// ─────────────────────────────────────────────────────────────────────────────
// lib/recommendations/recommendationExplanation.ts
//
// Generates a title + 1–5 honest, data-backed reasons explaining why a venue
// was recommended. Used by components/venues/RecommendationExplanation.tsx on
// the venue detail screen.
//
// DESIGN PRINCIPLES:
//   • Pure function — no React, no side effects, no logging, no network.
//   • Every reason is GATED on a real data condition — if the field is absent
//     or falsy, the reason is never added. Fabrication is structurally impossible.
//   • Titles are chosen by priority; the first condition that holds wins.
//   • Privacy-safe: no venue data is logged or persisted.
//
// Consumer: components/venues/RecommendationExplanation.tsx
// ─────────────────────────────────────────────────────────────────────────────

import type { Venue } from '@/types';
import { computeVenueIntelligence } from './venueIntelligence';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RecommendationExplanation {
  /** Short, human-readable label for the primary quality of this venue. */
  title: string;
  /**
   * 1–5 honest reasons backed by real venue data, priority-ordered.
   * Never empty — callers are guaranteed at least one reason when the result
   * is non-null.
   */
  reasons: string[];
}

// ── Slug normalisation ────────────────────────────────────────────────────────
// Copied from recommendationReasons.ts — keeps both files self-contained.

/** Normalise a slug: lowercase, collapse hyphens/underscores/spaces to hyphen. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[-_ ]+/g, '-');
}

// ── Facility helper ───────────────────────────────────────────────────────────
// Copied from recommendationReasons.ts — handles both the flat Facility[]
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
// Must stay in sync with recommendationReasons.ts. Any change there needs
// mirroring here, and vice versa.

/** Slugs that qualify for "Great For Toddlers" title (age check is separate). */
const TODDLER_SLUGS = new Set([
  'soft-play', 'sensory', 'baby-gym', 'toddler-group', 'library', 'playground',
]);

/** Indoor slugs — must stay in sync with INDOOR_SLUGS in lib/venueAttributes.ts. */
const INDOOR_SLUGS = new Set([
  'soft-play', 'indoor-play', 'swimming', 'trampoline', 'library',
  'arts', 'bowling', 'sensory', 'activity-centre', 'leisure-centre',
  'childrens-theatre', 'cinema',
]);

/** Slugs where kids burn real energy. */
const ENERGY_SLUGS = new Set([
  'soft-play', 'trampoline', 'swimming', 'park', 'outdoor-sports',
  'adventure-park', 'climbing', 'skating', 'sports-centre',
]);

/**
 * Outdoor/nature/park categories. Qualifies venue for "Outdoor Adventure" title
 * and "Outdoor space to explore" reason.
 */
const OUTDOOR_SLUGS = new Set([
  'park', 'playground', 'outdoor-sports', 'farm', 'zoo', 'nature-reserve',
  'garden', 'beach', 'woodland', 'trail', 'adventure-park',
]);

// ── Reason builders ───────────────────────────────────────────────────────────
// Each function returns a string when its data condition holds, or null when
// the data is absent/insufficient. This makes it impossible to fabricate a
// reason — null is the only alternative to a condition-verified string.

function reasonAgeRange(venue: Venue): string | null {
  // min_age / max_age are non-nullable numbers; 0 means "unset" per the type comment.
  // We only show an age reason when at least one is meaningfully set (> 0).
  const hasMin = venue.min_age > 0;
  const hasMax = venue.max_age > 0;
  if (!hasMin && !hasMax) return null;

  if (hasMin && hasMax) {
    return `Suitable for ages ${venue.min_age}–${venue.max_age}`;
  }
  if (hasMin) {
    return `Suitable from age ${venue.min_age}`;
  }
  // hasMax only
  return `Suitable up to age ${venue.max_age}`;
}

function reasonIndoor(slug: string): string | null {
  return INDOOR_SLUGS.has(slug) ? 'Indoor venue for rainy days' : null;
}

function reasonOutdoor(slug: string): string | null {
  return OUTDOOR_SLUGS.has(slug) ? 'Outdoor space to explore' : null;
}

function reasonEnergy(slug: string): string | null {
  return ENERGY_SLUGS.has(slug) ? 'Great for burning off energy' : null;
}

function reasonStrongReviews(venue: Venue): string | null {
  return venue.average_rating >= 4.5 && venue.review_count >= 10
    ? 'Strong family reviews'
    : null;
}

function reasonPopular(venue: Venue): string | null {
  return venue.review_count >= 20 ? 'Popular with local families' : null;
}

function reasonParentFacilities(venue: Venue): string | null {
  // Count distinct facility types present — requires at least 2 to show the reason.
  const hasToilet = hasFacility(venue, 'toilet', 'wc');
  const hasParking = hasFacility(venue, 'parking', 'car-park', 'car park');
  const hasCafe = hasFacility(venue, 'cafe', 'food', 'restaurant', 'kiosk');
  const hasBabyChange = hasFacility(venue, 'baby-change', 'baby_change');
  const hasAccessibility = hasFacility(
    venue, 'accessible', 'wheelchair', 'accessibility', 'step-free',
  );

  const count =
    (hasToilet ? 1 : 0) +
    (hasParking ? 1 : 0) +
    (hasCafe ? 1 : 0) +
    (hasBabyChange ? 1 : 0) +
    (hasAccessibility ? 1 : 0);

  return count >= 2 ? 'Parent-friendly facilities' : null;
}

function reasonPrice(venue: Venue): string | null {
  if (venue.price_range === 'free') return 'Free entry';
  if (venue.price_range === 'budget') return 'Budget-friendly day out';
  return null;
}

function reasonVerified(venue: Venue): string | null {
  return venue.is_verified === true ? 'Verified venue' : null;
}

// ── Title selector ────────────────────────────────────────────────────────────
// Returns the first title whose condition holds. Order is intentional — the
// most trust-signalling title wins over the most descriptive.

function selectTitle(
  venue: Venue,
  slug: string,
  reasons: string[],
): string {
  const intel = computeVenueIntelligence(venue);

  // 1. Family Favourite — highest bar; only when the venue genuinely earns it.
  if (
    intel.familyScore >= 70 &&
    venue.average_rating >= 4.5 &&
    venue.review_count >= 10
  ) {
    return 'Family Favourite';
  }

  // 2. Great For Toddlers — category-based ONLY (Discovery Sprint A, P2).
  //
  // We previously also required "confirmed age data" (min_age > 0 ||
  // max_age > 0) AND min_age <= 3. That looked like a safeguard, but it
  // isn't: catalogue-wide, min_age/max_age are OSM-import DEFAULTS set per
  // category slug (scripts/import/02_transform_osm.js SLUG_AGES) — e.g.
  // every 'attraction' venue defaults to 0–18, every 'animal-attraction' to
  // 0–18, etc. So "min_age <= 3" was satisfied by THOUSANDS of venues that
  // were never actually assessed for toddler suitability — including the
  // London Dungeon, SEA LIFE and Shrek's Adventure (all attraction/
  // animal-attraction, min_age=0). The category (venue TYPE) is the only
  // signal here we can trust. See lib/toddlerSafeCategories.ts.
  if (TODDLER_SLUGS.has(slug)) {
    return 'Great For Toddlers';
  }

  // 3. Rainy Day Winner — indoor slug is sufficient; the category itself IS the evidence.
  if (INDOOR_SLUGS.has(slug)) {
    return 'Rainy Day Winner';
  }

  // 4. Burn Energy Pick — active physical category.
  if (ENERGY_SLUGS.has(slug)) {
    return 'Burn Energy Pick';
  }

  // 5. Outdoor Adventure — outdoor/park/nature category.
  if (OUTDOOR_SLUGS.has(slug)) {
    return 'Outdoor Adventure';
  }

  // 6. Parent Friendly — >=2 supporting facilities (same condition as the reason).
  if (reasons.includes('Parent-friendly facilities')) {
    return 'Parent Friendly';
  }

  // 7. Budget Friendly — confirmed free or budget price range.
  if (venue.price_range === 'free' || venue.price_range === 'budget') {
    return 'Budget Friendly';
  }

  // Fallback: at least one reason exists (caller guarantees this), but no
  // category- or quality-specific title fires.
  return 'Worth a Visit';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a title and 1–5 honest, priority-ordered reasons explaining why
 * this venue was recommended.
 *
 * Returns null when no honest reason can be produced from the venue's data.
 * The UI must treat null as "hide this section entirely".
 *
 * Fabrication guarantee: every reason string is only added when a named
 * data condition holds on real Venue fields. The function has no fallback
 * strings that fire on missing data — the null path is the honest path.
 *
 * @param venue - The venue to evaluate. Must have at least `id` and `name`.
 * @returns RecommendationExplanation | null
 */
export function generateRecommendationExplanation(
  venue: Venue,
): RecommendationExplanation | null {
  const slug = norm(venue.category?.slug ?? '');

  // Build every candidate reason in priority order.
  // Only non-null values are collected — null means "condition not met".
  const candidates: (string | null)[] = [
    // 1. Age fit — most actionable for parents choosing by child age
    reasonAgeRange(venue),
    // 2. Indoor — highly actionable on a rainy day
    reasonIndoor(slug),
    // 3. Outdoor — highly actionable on a sunny day
    reasonOutdoor(slug),
    // 4. Energy — helps with the "they need to run around" decision
    reasonEnergy(slug),
    // 5. Strong reviews — strong trust signal
    reasonStrongReviews(venue),
    // 6. Popular — softer social proof
    reasonPopular(venue),
    // 7. Parent facilities — practical support
    reasonParentFacilities(venue),
    // 8. Price — always a key decision factor
    reasonPrice(venue),
    // 9. Verified — baseline trust
    reasonVerified(venue),
  ];

  // Filter out nulls, deduplicate, take the top 5.
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const candidate of candidates) {
    if (candidate !== null && !seen.has(candidate) && reasons.length < 5) {
      seen.add(candidate);
      reasons.push(candidate);
    }
  }

  // If no reason fired, there is nothing honest to show — return null.
  if (reasons.length === 0) return null;

  const title = selectTitle(venue, slug, reasons);

  return { title, reasons };
}
