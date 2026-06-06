// ─────────────────────────────────────────────────────────────────────────────
// lib/recommendations/venueIntelligence.ts
//
// Venue Intelligence Layer — five targeted scoring dimensions that power
// ranking and curation. This layer sits above familyScore.ts and reuses it
// rather than recomputing it.
//
// DESIGN PRINCIPLES:
//   • Pure function — no React, no side effects, no logging, no network.
//   • Delegates to calculateFamilyScore() for the family dimension.
//   • All null/undefined fields are treated as 0 contribution (not crashes).
//   • Privacy-safe: scores are computed in memory only, never logged.
//
// Internal use only — not for direct UI rendering.
// Consumers: lib/curation.ts (ranking nudges), lib/smartFeed.ts (section logic).
// ─────────────────────────────────────────────────────────────────────────────

import type { Venue } from '@/types';
import { calculateFamilyScore } from './familyScore';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Five targeted intelligence scores for a venue.
 *
 * Internal use only — not for direct UI rendering.
 * Use these scores in curation and feed logic, never to display raw numbers.
 */
export interface VenueIntelligence {
  /** 0–100: how well this venue serves families with children. Delegates to calculateFamilyScore(). */
  familyScore: number;
  /** 0–100: how practical this venue is for parents (parking, cafe, toilets, baby-change). */
  parentConvenienceScore: number;
  /** 0–100: how suitable this venue's content is for children of various ages. */
  childSuitabilityScore: number;
  /** 0–100: how trustworthy the venue is (verified, reviews, data completeness). */
  trustScore: number;
  /** 0–100: how much confirmed data exists for this venue. */
  dataConfidenceScore: number;
}

// ── Category slugs for child suitability ─────────────────────────────────────

/** Categories where children can be physically active. Earns category bonus. */
const ACTIVE_CATEGORY_SLUGS = new Set([
  'soft-play',
  'indoor-play',
  'trampoline',
  'park',
  'playground',
  'outdoor-sports',
  'swimming',
  'adventure',
  'sports',
]);

// ── Facility helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a slug for comparison: lowercase, collapse hyphens/underscores/spaces.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[-_ ]+/g, '-');
}

/**
 * Check whether a venue has a facility matching any of the given target slugs.
 * Handles both the flat Facility shape ({ slug, name }) and the nested
 * join shape ({ facility: { slug, name } }) that different queries return.
 */
function hasFacility(venue: Venue, ...targets: string[]): boolean {
  if (!venue.facilities || venue.facilities.length === 0) return false;

  return venue.facilities.some((facilityRow) => {
    const obj =
      (facilityRow as unknown as { facility?: Record<string, unknown> }).facility ??
      (facilityRow as unknown as Record<string, unknown>);

    const slug = norm((obj['slug'] as string | undefined) ?? '');
    const name = ((obj['name'] as string | undefined) ?? '').toLowerCase();

    return targets.some(
      (t) => slug.includes(norm(t)) || name.includes(t.toLowerCase()),
    );
  });
}

// ── Score 1: Parent convenience (0–100) ──────────────────────────────────────

function computeParentConvenienceScore(venue: Venue): number {
  let score = 0;

  if (hasFacility(venue, 'parking', 'car-park', 'car park')) score += 25;
  if (hasFacility(venue, 'cafe', 'food', 'restaurant', 'kiosk'))  score += 25;
  if (hasFacility(venue, 'toilet', 'toilets', 'wc'))              score += 20;
  if (hasFacility(venue, 'baby-change', 'baby_change', 'baby changing', 'nappy')) score += 15;
  if (venue.is_verified) score += 15;

  return Math.max(0, Math.min(100, score));
}

// ── Score 2: Child suitability (0–100) ───────────────────────────────────────

function computeChildSuitabilityScore(venue: Venue): number {
  let score = 0;

  // Age range width sub-score (0–50)
  const hasValidMin =
    typeof venue.min_age === 'number' && Number.isFinite(venue.min_age);
  const hasValidMax =
    typeof venue.max_age === 'number' && Number.isFinite(venue.max_age);

  if (hasValidMin && hasValidMax && venue.max_age > venue.min_age) {
    const rangeScore = ((venue.max_age - venue.min_age) / 13) * 50;
    score += Math.max(0, Math.min(50, rangeScore));
  }

  // Active/indoor category bonus (+25)
  const slug = venue.category?.slug ?? '';
  if (ACTIVE_CATEGORY_SLUGS.has(slug.toLowerCase())) {
    score += 25;
  }

  // Baby-welcome bonus (+25) — min_age === 0 means babies are explicitly welcome
  if (hasValidMin && venue.min_age === 0) {
    score += 25;
  }

  return Math.max(0, Math.min(100, score));
}

// ── Score 3: Trust (0–100) ───────────────────────────────────────────────────

function computeTrustScore(venue: Venue): number {
  let score = 0;

  // Verified venue: strongest single trust signal
  if (venue.is_verified) score += 40;

  // Review volume: normalised to 20 reviews = full credit
  const reviewCount = typeof venue.review_count === 'number' ? venue.review_count : 0;
  const reviewComponent = (Math.min(reviewCount, 20) / 20) * 30;
  score += reviewComponent;

  // Data completeness: 5 key fields, each contributing up to 6 points (total 30)
  const hasFacilitiesData =
    Array.isArray(venue.facilities) && venue.facilities.length > 0;
  const hasOpeningHours =
    Array.isArray(venue.opening_hours) && venue.opening_hours.length > 0;
  const hasPriceRange = Boolean(venue.price_range);
  const hasDescription = Boolean(venue.description);
  const hasContact = Boolean(venue.phone || venue.website);

  const fields = [
    hasFacilitiesData,
    hasOpeningHours,
    hasPriceRange,
    hasDescription,
    hasContact,
  ];
  const hits = fields.filter(Boolean).length;
  score += (hits / 5) * 30;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Score 4: Data confidence (0–100) ─────────────────────────────────────────

function computeDataConfidenceScore(venue: Venue): number {
  const hasFacilitiesData =
    Array.isArray(venue.facilities) && venue.facilities.length > 0;
  const hasOpeningHours =
    Array.isArray(venue.opening_hours) && venue.opening_hours.length > 0;
  const hasPriceRange = Boolean(venue.price_range);
  const hasDescription =
    typeof venue.description === 'string' && venue.description.length > 10;
  const hasPhone = Boolean(venue.phone);
  const hasWebsite = Boolean(venue.website);

  const fields = [
    hasFacilitiesData,
    hasOpeningHours,
    hasPriceRange,
    hasDescription,
    hasPhone,
    hasWebsite,
  ];
  const hits = fields.filter(Boolean).length;

  return Math.max(0, Math.min(100, Math.round((hits / 6) * 100)));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the full venue intelligence profile for ranking and curation.
 *
 * Internal use only — not for direct UI rendering.
 *
 * All five scores are 0–100 and deterministic for the same input.
 * Missing data contributes 0 without throwing.
 *
 * @param venue - The venue to score. Must have at least `id` and `name`.
 */
export function computeVenueIntelligence(venue: Venue): VenueIntelligence {
  return {
    familyScore:            calculateFamilyScore(venue).familyScore,
    parentConvenienceScore: computeParentConvenienceScore(venue),
    childSuitabilityScore:  computeChildSuitabilityScore(venue),
    trustScore:             computeTrustScore(venue),
    dataConfidenceScore:    computeDataConfidenceScore(venue),
  };
}
