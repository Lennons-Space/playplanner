// ─────────────────────────────────────────────────────────────────────────────
// lib/recommendations/familyScore.ts
//
// Deterministic Family Score and Recommendation Score for PlayPlanner venues.
//
// DESIGN PRINCIPLES:
//   • No AI, no external APIs, no randomness. Every number comes from real
//     fields the user could verify themselves.
//   • Missing data lowers CONFIDENCE, never disqualifies. A playground with
//     no description can still score 60+ — it lacks trust signals, not quality.
//   • Privacy-safe: we never log venue data. Scores are computed in memory only.
//   • Honest badges: every badge condition is documented and testable.
//
// WHY BAYESIAN DAMPENING for social proof:
//   A venue with one 5-star review should not beat a venue with 20 reviews at
//   4.5 stars. We pull each venue's raw rating toward the global average (3.5)
//   weighted by a "virtual" sample of 3 reviews. That way a single outlier
//   review cannot dominate the score — you need real volume to earn full credit.
// ─────────────────────────────────────────────────────────────────────────────

import type { Venue } from '@/types';

// ── Public context type ───────────────────────────────────────────────────────
// Fields are all optional so callers can pass whatever they have without
// having to fabricate data. Missing context just contributes 0 to the relevant
// dimension.
export interface RecommendationContext {
  /** Straight-line distance from the user's location to the venue, in km. */
  distanceKm?: number;
  /** Reserved for future weather-aware scoring (Open-Meteo WMO code). */
  weatherCode?: number;
  /** Time of day — for future "right-now" boosting. */
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  /** Children's ages for the family — for future personalisation. */
  childrenAges?: number[];
}

// ── Result shapes ────────────────────────────────────────────────────────────
export interface FamilyScoreResult {
  /** 0–100: how well this venue serves families with children. */
  familyScore: number;
  /** How much we trust the data behind the score. */
  confidence: 'low' | 'medium' | 'high';
  /** Human-readable explanations of why the score is what it is. */
  reasons: string[];
  /** Short, UI-friendly labels derived from the score. */
  badges: string[];
  /** The six raw dimension scores — exposed for debugging / testing. */
  _dimensions: {
    categoryFit: number;
    parentUsefulness: number;
    childSuitability: number;
    facilities: number;
    socialProof: number;
    trust: number;
  };
}

export interface RecommendationScoreResult {
  /** 0–100: personalised ranking score combining quality + context. */
  recommendationScore: number;
  /** Underlying family score (0–100). */
  familyScore: number;
  /** How much we trust the data. */
  confidence: 'low' | 'medium' | 'high';
  /** Explanations for the recommendation. */
  reasons: string[];
  /** UI badges. */
  badges: string[];
}

// ── Category slugs ───────────────────────────────────────────────────────────
// These sets are the single source of truth for category classification.
// We check both venue.category?.slug (joined Category object) and any slug
// from the category directly — different data sources use different slugs.

/** Strongly family-oriented categories. Score 20–25 in dimension 1. */
const HIGH_FAMILY_SLUGS = new Set([
  'playground', 'soft_play', 'soft-play', 'park', 'farm', 'zoo', 'museum',
  'swimming', 'library', 'trampoline_park', 'trampoline', 'theme_park',
  'leisure_centre', 'childrens_theatre', 'nature_trail', 'activity_centre',
  'indoor-play', 'play-area', 'children-centre', 'aquarium', 'petting-zoo',
]);

/** Moderately family-friendly. Score 10–18 in dimension 1. */
const MEDIUM_FAMILY_SLUGS = new Set([
  'sports', 'outdoor', 'outdoor-sports', 'sports-activity', 'heritage',
  'arts', 'attraction', 'bowling', 'adventure', 'leisure',
]);

/** Rainy-day appropriate indoor categories for the badge. */
const RAINY_DAY_SLUGS = new Set([
  'soft_play', 'soft-play', 'indoor-play', 'trampoline', 'trampoline_park',
  'museum', 'library', 'swimming', 'childrens_theatre', 'activity_centre',
  'bowling', 'leisure_centre',
]);

/** Outdoor nature/play categories for the badge. */
const OUTDOOR_PLAY_SLUGS = new Set([
  'park', 'playground', 'farm', 'nature_trail', 'outdoor', 'play-area',
]);

/**
 * Categories confirmed toddler-appropriate by venue TYPE — used (alongside
 * `lib/recommendations/recommendationReasons.ts` TODDLER_SLUGS, which this
 * mirrors) to gate the 'Great For Toddlers' badge.
 *
 * WHY category-only, not min_age: catalogue-wide, `min_age` is an OSM-import
 * DEFAULT (scripts/import/02_transform_osm.js SLUG_AGES sets attraction,
 * animal-attraction, swimming, family-restaurant etc. to min_age=0 with no
 * real assessment). Trusting `min_age <= 2` as a positive toddler signal
 * surfaced attractions like the London Dungeon, Big Ben, SEA LIFE and
 * Shrek's Adventure as "Great For Toddlers" — a trust/safety embarrassment
 * for a children's app. The category (venue TYPE) is the only reliable
 * signal we have. See lib/toddlerSafeCategories.ts for fuller rationale.
 */
const TODDLER_BADGE_SLUGS = new Set([
  'soft-play', 'sensory', 'baby-gym', 'toddler-group', 'library', 'playground',
]);

// ── Keyword lists ────────────────────────────────────────────────────────────
const CHILD_NAME_KEYWORDS = [
  'play', 'kids', 'children', 'farm', 'zoo', 'museum',
  'park', 'adventure', 'splash', 'bounce',
] as const;

const FACILITY_FRIENDLY_SLUGS = [
  'toilet', 'toilets', 'baby_change', 'baby-change', 'baby changing',
  'parking', 'cafe', 'food', 'restaurant',
  'accessible', 'accessibility', 'wheelchair',
] as const;

// ── Globals used in Bayesian dampening ───────────────────────────────────────
// Prior: assume a brand-new venue sits at a 3.5-star baseline (the midpoint of
// a 1–5 scale, slightly above neutral). Virtual sample size of 3 reviews means
// you need at least ~10 real reviews before the prior stops mattering much.
const BAYES_PRIOR_RATING = 3.5;
const BAYES_VIRTUAL_COUNT = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a slug for comparison: lowercase, collapse hyphens/underscores. */
function normSlug(s: string): string {
  return s.toLowerCase().replace(/[-_ ]+/g, '-');
}

/**
 * Check whether a slug string matches a known set, using normalised comparison.
 * We normalise both sides so "soft_play", "soft-play", and "Soft Play" all match.
 */
function slugMatchesSet(slug: string | undefined | null, set: Set<string>): boolean {
  if (!slug) return false;
  const n = normSlug(slug);
  // Direct hit
  if (set.has(n)) return true;
  // Also check raw slug (set may contain either format)
  if (set.has(slug.toLowerCase())) return true;
  return false;
}

/** Resolve the venue's category slug from either the joined Category or raw id. */
function getCategorySlug(venue: Venue): string | null {
  return venue.category?.slug ?? null;
}

// ── Dimension 1: Category fit (0–25) ─────────────────────────────────────────
function scoreCategoryFit(venue: Venue): { score: number; reason: string | null } {
  const slug = getCategorySlug(venue);
  const name = venue.name?.toLowerCase() ?? '';

  if (slugMatchesSet(slug, HIGH_FAMILY_SLUGS)) {
    return { score: 25, reason: 'Core family category' };
  }

  // Some venues have no joined category but the name is a dead giveaway.
  // We give them a slightly lower score than a fully categorised venue.
  const nameImpliesFamily = CHILD_NAME_KEYWORDS.some((kw) => name.includes(kw));
  if (nameImpliesFamily && !slug) {
    return { score: 15, reason: 'Name suggests family venue' };
  }

  if (slugMatchesSet(slug, MEDIUM_FAMILY_SLUGS)) {
    return { score: 13, reason: 'Family-adjacent category' };
  }

  if (!slug) {
    return { score: 5, reason: null }; // no category at all — low but not zero
  }

  // Explicitly non-family slugs
  const nonFamilySlugs = ['nightlife', 'gambling', 'adult', 'bar', 'pub', 'casino'];
  if (nonFamilySlugs.some((s) => (slug ?? '').toLowerCase().includes(s))) {
    return { score: 0, reason: null };
  }

  // Unknown category — small neutral score
  return { score: 4, reason: null };
}

// ── Dimension 2: Parent usefulness (0–20) ────────────────────────────────────
function scoreParentUsefulness(venue: Venue): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (venue.opening_hours && venue.opening_hours.length > 0) {
    score += 5;
    reasons.push('Opening hours listed');
  }

  if (venue.price_range) {
    score += 5;
    reasons.push('Price info available');
  }

  if (venue.website || venue.phone) {
    score += 5;
    reasons.push('Contact details available');
  }

  // Coordinates: Venue type has latitude/longitude as required numbers,
  // but we guard for NaN/0 since raw data can have corrupt values.
  const hasCoords =
    Number.isFinite(venue.latitude) &&
    Number.isFinite(venue.longitude) &&
    !(venue.latitude === 0 && venue.longitude === 0);
  if (hasCoords) {
    score += 3;
  }

  const hasApprovedPhoto =
    venue.photos && venue.photos.some((p) => p.status === 'approved');
  const hasCoverPhoto = !!venue.cover_photo_url;
  if (hasApprovedPhoto || hasCoverPhoto) {
    score += 2;
    reasons.push('Has photos');
  }

  return { score: Math.min(score, 20), reasons };
}

// ── Dimension 3: Child suitability (0–20) ────────────────────────────────────
function scoreChildSuitability(venue: Venue): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const hasMin = typeof venue.min_age === 'number' && venue.min_age >= 0;
  const hasMax = typeof venue.max_age === 'number' && venue.max_age >= 0;

  // Age range covering children (up to 16)
  if (hasMin && hasMax && venue.max_age <= 16) {
    score += 8;
    reasons.push(`Age range ${venue.min_age}–${venue.max_age}`);
  } else if (hasMin || hasMax) {
    score += 4;
  }

  // Name contains family-friendly keywords
  const nameLower = venue.name?.toLowerCase() ?? '';
  const nameHasKidWord = CHILD_NAME_KEYWORDS.some((kw) => nameLower.includes(kw));
  if (nameHasKidWord) {
    score += 6;
    reasons.push('Name suggests family focus');
  }

  // Category clearly implies children
  const slug = getCategorySlug(venue);
  if (slugMatchesSet(slug, HIGH_FAMILY_SLUGS)) {
    score += 6;
    // Reason added in category dimension; avoid duplication here
  }

  return { score: Math.min(score, 20), reasons };
}

// ── Dimension 4: Facilities / parent comfort (0–15) ──────────────────────────
function scoreFacilities(venue: Venue): { score: number; reasons: string[] } {
  if (!venue.facilities || venue.facilities.length === 0) {
    return { score: 0, reasons: [] };
  }

  let hits = 0;
  const reasons: string[] = [];

  for (const facility of venue.facilities) {
    const slug = normSlug(facility.slug ?? '');
    const name = (facility.name ?? '').toLowerCase();
    const matched = FACILITY_FRIENDLY_SLUGS.some(
      (target) => slug.includes(normSlug(target)) || name.includes(target),
    );
    if (matched) {
      hits += 1;
      reasons.push(facility.name ?? facility.slug);
    }
  }

  const score = Math.min(hits * 3, 15);
  return { score, reasons: score > 0 ? [`Facilities: ${reasons.slice(0, 3).join(', ')}`] : [] };
}

// ── Dimension 5: Social proof (0–10) — Bayesian dampened ─────────────────────
function scoreSocialProof(venue: Venue): { score: number; effectiveRating: number; reasons: string[] } {
  const reviewCount = venue.review_count ?? 0;
  const rawRating = venue.average_rating ?? 0;

  if (reviewCount === 0) {
    // No reviews at all — prior only, no score credit
    return { score: 0, effectiveRating: 0, reasons: [] };
  }

  // Bayesian weighted average: pull toward the prior when review count is low.
  // With 3 virtual reviews at 3.5, you need ~10 real reviews for the prior
  // to contribute less than 25% of the weight.
  const effectiveRating =
    (reviewCount * rawRating + BAYES_VIRTUAL_COUNT * BAYES_PRIOR_RATING) /
    (reviewCount + BAYES_VIRTUAL_COUNT);

  const score = Math.round((effectiveRating / 5) * 10 * 100) / 100;

  const reasons: string[] =
    effectiveRating >= 4.5
      ? ['Highly rated']
      : effectiveRating >= 4.0
        ? ['Well reviewed']
        : [];

  return { score: Math.min(score, 10), effectiveRating, reasons };
}

// ── Dimension 6: Trust / data confidence (0–10) ──────────────────────────────
function scoreTrust(venue: Venue): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (venue.is_verified) {
    score += 4;
    reasons.push('Verified venue');
  }

  const hasDescription =
    typeof venue.description === 'string' && venue.description.length > 50;
  if (hasDescription) {
    score += 2;
    reasons.push('Has description');
  }

  // venue_review_scores trust_score — this field is not on the Venue type today.
  // We guard safely so it works now and auto-activates if the field is added later.
  const maybeTrustScore = (venue as unknown as Record<string, unknown>)['trust_score'];
  if (typeof maybeTrustScore === 'number' && maybeTrustScore > 0) {
    // Scale: trust_score is 0–100, we want 0–2 contribution
    score += Math.round((maybeTrustScore / 100) * 2);
    reasons.push('Trust score available');
  }

  const hasApprovedPhoto =
    (venue.photos && venue.photos.some((p) => p.status === 'approved')) ||
    !!venue.cover_photo_url;
  if (hasApprovedPhoto) {
    score += 2;
  }

  return { score: Math.min(score, 10), reasons };
}

// ── Badge derivation ──────────────────────────────────────────────────────────
function deriveBadges(
  venue: Venue,
  familyScore: number,
  facilityScore: number,
  effectiveRating: number,
  reviewCount: number,
): string[] {
  const badges: string[] = [];
  const slug = getCategorySlug(venue);

  if (familyScore >= 70) badges.push('Family Friendly');

  // Category-based ONLY — see TODDLER_BADGE_SLUGS comment for why we no
  // longer trust `min_age <= 2` (it's an untrusted OSM-import default that
  // falsely flagged attractions like the London Dungeon and SEA LIFE).
  if (slugMatchesSet(slug, TODDLER_BADGE_SLUGS)) {
    badges.push('Great For Toddlers');
  }

  if (slugMatchesSet(slug, RAINY_DAY_SLUGS)) {
    badges.push('Rainy Day Potential');
  }

  if (slugMatchesSet(slug, OUTDOOR_PLAY_SLUGS)) {
    badges.push('Outdoor Play');
  }

  if (facilityScore >= 9) badges.push('Parent Friendly');

  if (venue.price_range === 'free' || venue.price_range === 'budget') {
    badges.push('Budget Friendly');
  }

  // "Good Reviews": effective rating >= 8 out of 10 ≈ 4+ stars with real volume
  // We require at least 5 reviews so a brand-new venue cannot earn this badge
  if (effectiveRating >= 4.0 && reviewCount >= 5) {
    badges.push('Good Reviews');
  }

  // 'Needs More Info' badge REMOVED (Discovery Sprint A, P3): a 2026-06
  // measurement found it fired on 200/200 (100%) of a live RPC sample,
  // because trust signals (is_verified, description>50, photo, trust_score)
  // are near-zero catalogue-wide. A badge that appears on every venue
  // carries zero decision value for parents and just adds visual noise —
  // worse, it reads as a subtle "don't trust this" stamp on virtually the
  // whole catalogue, which undermines confidence in the app rather than
  // helping anyone choose. Once real trust signals exist at meaningful
  // density, a differentiating badge could be reconsidered from scratch.

  return badges;
}

// ── Confidence classification ─────────────────────────────────────────────────
function classifyConfidence(
  familyScore: number,
  trustScore: number,
): 'low' | 'medium' | 'high' {
  if (familyScore >= 65 && trustScore >= 6) return 'high';
  if (familyScore >= 40 || trustScore >= 4) return 'medium';
  return 'low';
}

// ── Reason assembly ───────────────────────────────────────────────────────────
function assembleReasons(parts: (string | null | undefined)[]): string[] {
  // Flatten, deduplicate, and keep up to 5 readable reasons
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.slice(0, 5);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calculate a deterministic Family Score (0–100) for a venue.
 *
 * The score is the sum of six dimensions:
 *   1. Category fit           0–25
 *   2. Parent usefulness      0–20
 *   3. Child suitability      0–20
 *   4. Facilities             0–15
 *   5. Social proof           0–10
 *   6. Trust / data quality   0–10
 *
 * TOTAL MAX: 100
 *
 * Missing data reduces the trust dimension and confidence level only.
 * A venue with no description but good category, hours, and location
 * can still score 60–75 with confidence 'medium'.
 */
export function calculateFamilyScore(venue: Venue): FamilyScoreResult {
  const categoryResult    = scoreCategoryFit(venue);
  const usefulnessResult  = scoreParentUsefulness(venue);
  const suitabilityResult = scoreChildSuitability(venue);
  const facilitiesResult  = scoreFacilities(venue);
  const socialResult      = scoreSocialProof(venue);
  const trustResult       = scoreTrust(venue);

  const familyScore = Math.round(
    categoryResult.score +
    usefulnessResult.score +
    suitabilityResult.score +
    facilitiesResult.score +
    socialResult.score +
    trustResult.score,
  );

  const clamped = Math.max(0, Math.min(100, familyScore));

  const confidence = classifyConfidence(clamped, trustResult.score);

  const reasons = assembleReasons([
    categoryResult.reason,
    ...usefulnessResult.reasons,
    ...suitabilityResult.reasons,
    ...facilitiesResult.reasons,
    ...socialResult.reasons,
    ...trustResult.reasons,
  ]);

  const badges = deriveBadges(
    venue,
    clamped,
    facilitiesResult.score,
    socialResult.effectiveRating,
    venue.review_count ?? 0,
  );

  return {
    familyScore: clamped,
    confidence,
    reasons,
    badges,
    _dimensions: {
      categoryFit:       categoryResult.score,
      parentUsefulness:  usefulnessResult.score,
      childSuitability:  suitabilityResult.score,
      facilities:        facilitiesResult.score,
      socialProof:       socialResult.score,
      trust:             trustResult.score,
    },
  };
}

/**
 * Calculate a Recommendation Score (0–100) that blends the Family Score with
 * contextual signals (distance, time, personalisation).
 *
 * Formula:
 *   recommendation_score =
 *     family_score        * 0.60
 *     + data_confidence   * 0.20   (trust dimension 0–10 → mapped to 0–20)
 *     + distance_score    * 0.10   (0 when no context)
 *     + context_score     * 0.10   (0 when no context — reserved for future use)
 *
 * WHY we keep 60% weight on family_score:
 *   The venue's intrinsic quality should dominate. Context (distance, weather)
 *   should personalise the ranking at the margin, not override it. A great venue
 *   3 km away should beat a mediocre venue next door.
 */
export function calculateRecommendationScore(
  venue: Venue,
  context?: RecommendationContext,
): RecommendationScoreResult {
  const familyResult = calculateFamilyScore(venue);

  // Data confidence: trust dimension (0–10) mapped to 0–20 for this component
  const dataConfidenceComponent = familyResult._dimensions.trust * 2;

  // Distance score: placeholder for future use. When context.distanceKm is
  // provided we can score it — for now we return 0 as the spec requires.
  // Implementation note: when adding this, use coarse bucketing (< 1km = 10,
  // < 3km = 8, < 10km = 5, etc.) rather than a raw linear decay, so results
  // feel stable as GPS accuracy fluctuates.
  const distanceScore = 0; // reserved

  // Context score: personalisation based on childrenAges, timeOfDay etc.
  // Reserved for future use — see RecommendationContext fields.
  const contextScore = 0; // reserved

  const rawScore =
    familyResult.familyScore * 0.60 +
    dataConfidenceComponent  * 0.20 +
    distanceScore            * 0.10 +
    contextScore             * 0.10;

  const recommendationScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    recommendationScore,
    familyScore:         familyResult.familyScore,
    confidence:          familyResult.confidence,
    reasons:             familyResult.reasons,
    badges:              familyResult.badges,
  };
}
