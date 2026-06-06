// =============================================================================
// scripts/enrich/intelligence.ts
//
// Pure scoring functions: RawFacts + Venue data -> Layer 2 intelligence scores,
// Layer 3 recommended_for tags, and a score_breakdown for audit.
//
// Design rules:
//   - No side effects, no I/O, no network calls.
//   - Every scorer returns { score, breakdown } so the breakdown can be stored
//     in score_breakdown JSONB for auditing formula changes.
//   - All scores clamped to 0-100.
//   - NULL facts contribute 0, never crash.
//   - The recommended_for threshold is 65 for score-based tags.
//
// No '@/' path alias -- this file runs outside the Expo app bundle.
// =============================================================================

import type {
  RawFacts,
  IntelligenceScores,
  ScoreBreakdown,
  RecommendedForTag,
} from '../../types/enrichment';

// ── Minimal venue shape needed for scoring ────────────────────────────────────
// We only select these columns from Supabase, so we define the shape here
// rather than importing the full Venue type (which has React Native dependencies
// pulled in through '@/types').
export interface VenueForScoring {
  id:          string;
  name:        string;
  osm_id:      string | null;
  data_source: string | null;
  price_range: string | null;
  min_age:     number;
  max_age:     number;
  is_verified: boolean;
  description: string | null;
  category?:   { slug: string } | null;
}

// ── Category slug sets ────────────────────────────────────────────────────────

const ACTIVE_SLUGS = new Set([
  'soft-play', 'soft_play', 'indoor-play', 'trampoline', 'trampoline_park',
  'bowling', 'swimming', 'sports', 'outdoor-sports', 'playground', 'park',
]);

const EDUCATIONAL_SLUGS = new Set([
  'museum', 'library', 'science-centre', 'science_centre', 'farm',
  'zoo', 'aquarium', 'nature', 'botanical', 'heritage', 'gallery',
]);

// ── Scorer result type ────────────────────────────────────────────────────────

interface ScorerResult {
  score:     number;
  breakdown: Record<string, number>;
}

// ── Helper: clamp a number to [0, 100] ────────────────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// ── Score 1: Parent Convenience (0-100) ───────────────────────────────────────
// How practical is this venue for parents? Focuses on physical amenities
// that reduce friction during a family visit.

export function scoreParentConvenience(facts: RawFacts): ScorerResult {
  const breakdown: Record<string, number> = {};
  let score = 0;

  if (facts.toilets_available === true) {
    breakdown['toilets_available'] = 25;
    score += 25;
  }
  if (facts.baby_change_available === true) {
    breakdown['baby_change_available'] = 20;
    score += 20;
  }
  if (facts.parking_available === true) {
    breakdown['parking_available'] = 20;
    score += 20;
  }
  if (facts.cafe_available === true) {
    breakdown['cafe_available'] = 20;
    score += 20;
  }
  if (facts.wheelchair_accessible === 'yes') {
    breakdown['wheelchair_accessible_yes'] = 15;
    score += 15;
  } else if (facts.wheelchair_accessible === 'limited') {
    breakdown['wheelchair_accessible_limited'] = 8;
    score += 8;
  }

  return { score: clamp(score), breakdown };
}

// ── Score 2: Rainy Day (0-100) ────────────────────────────────────────────────
// How suitable is this venue when the weather is bad? Indoor venues with
// amenities score highest.

export function scoreRainyDay(facts: RawFacts): ScorerResult {
  const breakdown: Record<string, number> = {};
  let score = 0;

  if (facts.indoor_outdoor === 'indoor') {
    breakdown['indoor_outdoor_indoor'] = 50;
    score += 50;
  } else if (facts.indoor_outdoor === 'mixed') {
    breakdown['indoor_outdoor_mixed'] = 25;
    score += 25;
  }

  if (facts.cafe_available === true) {
    breakdown['cafe_available'] = 20;
    score += 20;
  }
  if (facts.toilets_available === true) {
    breakdown['toilets_available'] = 15;
    score += 15;
  }
  if (facts.baby_change_available === true) {
    breakdown['baby_change_available'] = 10;
    score += 10;
  }
  if (facts.visit_duration_mins !== null && facts.visit_duration_mins >= 90) {
    breakdown['visit_duration_mins_gte_90'] = 5;
    score += 5;
  }

  return { score: clamp(score), breakdown };
}

// ── Score 3: Active Play (0-100) ──────────────────────────────────────────────
// How much physical activity can children get here? Combines OSM activity_level
// with category slug to avoid double-counting.
//
// Cap rule: activity_level=high (+40) + active category slug (+35) are capped
// at 55 combined contribution. This prevents a soft-play centre with an OSM
// activity tag from scoring 75 before any duration/outdoor bonus.

export function scoreActivePlay(facts: RawFacts, venue: VenueForScoring): ScorerResult {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const slug = venue.category?.slug ?? '';
  const isActiveSlug = ACTIVE_SLUGS.has(slug);
  const isHighActivity = facts.activity_level === 'high';

  // Apply activity_level and category slug with a combined cap of 55.
  if (isHighActivity && isActiveSlug) {
    // Both signals agree: cap at 55 to avoid double-counting.
    breakdown['activity_level_high'] = 40;
    breakdown['active_category_slug'] = 15; // reduced to respect the 55-point cap
    score += 55;
  } else if (isHighActivity) {
    breakdown['activity_level_high'] = 40;
    score += 40;
  } else if (isActiveSlug) {
    breakdown['active_category_slug'] = 35;
    score += 35;
  }

  if (facts.visit_duration_mins !== null && facts.visit_duration_mins >= 60) {
    breakdown['visit_duration_mins_gte_60'] = 15;
    score += 15;
  }
  if (facts.indoor_outdoor === 'outdoor') {
    breakdown['indoor_outdoor_outdoor'] = 10;
    score += 10;
  }

  return { score: clamp(score), breakdown };
}

// ── Score 4: Learning (0-100) ─────────────────────────────────────────────────
// How educational is this venue? Museums, zoos, and verified venues with
// descriptions score highest.

export function scoreLearning(facts: RawFacts, venue: VenueForScoring): ScorerResult {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const slug = venue.category?.slug ?? '';

  if (EDUCATIONAL_SLUGS.has(slug)) {
    breakdown['educational_category_slug'] = 40;
    score += 40;
  }

  // A substantial description signals the venue has educational context to share.
  if (venue.description !== null && venue.description.length > 50) {
    breakdown['description_length_gt_50'] = 25;
    score += 25;
  }

  if (venue.is_verified) {
    breakdown['is_verified'] = 20;
    score += 20;
  }

  // Child-specific venues (max_age <= 16) are more deliberately designed
  // for learning at an appropriate level.
  if (venue.max_age <= 16) {
    breakdown['max_age_lte_16'] = 15;
    score += 15;
  }

  // facts is passed to keep the signature consistent with other scorers;
  // no facts fields contribute to this score in v1.
  void facts;

  return { score: clamp(score), breakdown };
}

// ── Score 5: Budget (0-100) ───────────────────────────────────────────────────
// How affordable is this venue? Directly maps price_range to a score.
// No clamp needed: all values are already within 0-100.

export function scoreBudget(venue: VenueForScoring): ScorerResult {
  const priceRange = venue.price_range;

  switch (priceRange) {
    case 'free':     return { score: 100, breakdown: { price_range_free: 100 } };
    case 'budget':   return { score: 70,  breakdown: { price_range_budget: 70 } };
    case 'moderate': return { score: 40,  breakdown: { price_range_moderate: 40 } };
    case 'premium':  return { score: 10,  breakdown: { price_range_premium: 10 } };
    default:
      // null / unknown price: neutral score. We do not penalise a venue for
      // missing price data -- that would unfairly downrank recently imported venues.
      return { score: 35, breakdown: { price_range_unknown: 35 } };
  }
}

// ── Score 6: Accessibility (0-100) ────────────────────────────────────────────
// How accessible is this venue for families with mobility needs?

export function scoreAccessibility(facts: RawFacts): ScorerResult {
  const breakdown: Record<string, number> = {};
  let score = 0;

  if (facts.wheelchair_accessible === 'yes') {
    breakdown['wheelchair_accessible_yes'] = 50;
    score += 50;
  } else if (facts.wheelchair_accessible === 'limited') {
    breakdown['wheelchair_accessible_limited'] = 25;
    score += 25;
  }

  if (facts.toilets_available === true) {
    breakdown['toilets_available'] = 20;
    score += 20;
  }
  if (facts.parking_available === true) {
    breakdown['parking_available'] = 15;
    score += 15;
  }
  if (facts.baby_change_available === true) {
    breakdown['baby_change_available'] = 10;
    score += 10;
  }
  if (facts.indoor_outdoor === 'indoor') {
    // Indoor venues generally have more controlled, accessible environments.
    breakdown['indoor_outdoor_indoor'] = 5;
    score += 5;
  }

  return { score: clamp(score), breakdown };
}

// ── Layer 3: Recommended-for tags ─────────────────────────────────────────────
// Pre-computed tags that power O(1) GIN-indexed filter queries.
// Threshold for score-based tags is 65/100.

const SCORE_THRESHOLD = 65;

export function computeRecommendedFor(
  scores:  IntelligenceScores,
  facts:   RawFacts,
  venue:   VenueForScoring,
): RecommendedForTag[] {
  const tags: RecommendedForTag[] = [];

  // Score-based tags
  if (scores.rainy_day_score          >= SCORE_THRESHOLD) tags.push('rainy_day');
  if (scores.active_play_score        >= SCORE_THRESHOLD) tags.push('burn_energy');
  if (scores.learning_score           >= SCORE_THRESHOLD) tags.push('learning');
  if (scores.budget_score             >= SCORE_THRESHOLD) tags.push('budget_friendly');
  if (scores.accessibility_score      >= SCORE_THRESHOLD) tags.push('accessible');
  if (scores.parent_convenience_score >= SCORE_THRESHOLD) tags.push('parent_friendly');

  // Fact-based tags (derived directly from Layer 1 values)
  if (facts.indoor_outdoor === 'indoor') tags.push('indoor');
  if (facts.indoor_outdoor === 'outdoor' || facts.indoor_outdoor === 'mixed') tags.push('outdoor');

  // Price tag
  if (venue.price_range === 'free') tags.push('free');

  // Duration-based tags
  const duration = facts.visit_duration_mins;
  if (duration !== null && duration >= 180) tags.push('full_day');
  if (duration !== null && duration >= 60 && duration < 180) tags.push('half_day');

  // Age-based tags
  if (venue.min_age <= 2) tags.push('toddler_friendly');

  // Combination tags
  if (duration !== null && duration >= 120 && scores.active_play_score >= 40) {
    tags.push('family_day_out');
  }

  return tags;
}

// ── Top-level export ──────────────────────────────────────────────────────────

export interface IntelligenceResult {
  scores:          IntelligenceScores;
  recommended_for: RecommendedForTag[];
  score_breakdown: ScoreBreakdown;
}

/**
 * Compute all intelligence scores, recommended_for tags, and the audit
 * breakdown for a single venue.
 *
 * @param facts  - Layer 1 raw facts (from extractRawFacts)
 * @param venue  - Minimal venue row from the Supabase query
 * @returns      - Layer 2 scores, Layer 3 tags, and per-component breakdown
 */
export function computeIntelligence(
  facts: RawFacts,
  venue: VenueForScoring,
): IntelligenceResult {
  const convenience  = scoreParentConvenience(facts);
  const rainyDay     = scoreRainyDay(facts);
  const activePlay   = scoreActivePlay(facts, venue);
  const learning     = scoreLearning(facts, venue);
  const budget       = scoreBudget(venue);
  const accessibility = scoreAccessibility(facts);

  const scores: IntelligenceScores = {
    parent_convenience_score: convenience.score,
    rainy_day_score:          rainyDay.score,
    active_play_score:        activePlay.score,
    learning_score:           learning.score,
    budget_score:             budget.score,
    accessibility_score:      accessibility.score,
  };

  const score_breakdown: ScoreBreakdown = {
    parent_convenience: convenience.breakdown,
    rainy_day:          rainyDay.breakdown,
    active_play:        activePlay.breakdown,
    learning:           learning.breakdown,
    budget:             budget.breakdown,
    accessibility:      accessibility.breakdown,
  };

  const recommended_for = computeRecommendedFor(scores, facts, venue);

  return { scores, recommended_for, score_breakdown };
}
