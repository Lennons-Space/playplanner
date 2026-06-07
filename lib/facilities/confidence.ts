// ─────────────────────────────────────────────────────────────────────────────
// lib/facilities/confidence.ts
//
// Pure decision logic for the Parent Contribution facility-vote feature.
//
// WHY THIS FILE EXISTS
//   The real source of truth for confidence/mirroring lives in the database
//   trigger `recompute_facility_stats()` (see
//   supabase/migrations/050_parent_facility_votes.sql) -- that is what
//   actually runs on every vote and writes the public aggregate. Postgres
//   logic cannot run inside Jest, so we cannot test it directly.
//
//   This file is a DELIBERATE MIRROR of that trigger's decision rules,
//   expressed as pure, dependency-free TypeScript. It exists purely so the
//   thresholds are unit-testable and so a reviewer can see, in one place,
//   exactly what "confidence" and "should we trust this enough to recommend
//   it" mean -- without reading SQL.
//
// PARITY CONTRACT (read before changing either side)
//   If you change a threshold here, you MUST make the identical change in
//   the SQL trigger `recompute_facility_stats()`, and vice versa. They are
//   two independent implementations of the same rule and will silently
//   drift apart if only one is edited. The migration file's header comment
//   points back here for the same reason.
//
// PRIVACY NOTE
//   These functions only ever see aggregate counts (numbers), never user
//   identities, vote timestamps, or any personal data. Nothing here should
//   ever be passed PII -- there is none to pass.
// ─────────────────────────────────────────────────────────────────────────────

export type FacilityConfidence = 'low' | 'medium' | 'high';

export interface FacilityConfidenceResult {
  /** How much we trust the aggregate verdict for this facility. */
  confidence: FacilityConfidence;
  /** Majority verdict: true if more parents say "yes" than "no". Ties → false. */
  present: boolean;
  /** Total number of votes cast (yes + no). */
  total: number;
}

export interface FacilityStatsLike {
  confidence: FacilityConfidence;
  present: boolean | null;
}

/**
 * Computes the confidence level and majority verdict for a facility from raw
 * yes/no vote counts. Mirrors `recompute_facility_stats()` in
 * supabase/migrations/050_parent_facility_votes.sql EXACTLY.
 *
 * Thresholds (must match the SQL trigger):
 *   - low:    total < 3
 *   - medium: total >= 3 AND agreement >= 0.66   (agreement = max(yes,no)/total)
 *   - high:   total >= 5 AND agreement >= 0.75
 *   - present: yes > no (ties resolve to "not present" — a cautious default;
 *              we never want to claim a facility exists on a 50/50 split)
 *
 * @param yes Number of "yes, this facility is here" votes.
 * @param no  Number of "no, it isn't" votes.
 */
export function computeConfidence(yes: number, no: number): FacilityConfidenceResult {
  const total = yes + no;

  if (total === 0) {
    return { confidence: 'low', present: false, total };
  }

  const agreement = Math.max(yes, no) / total;
  const present = yes > no;

  let confidence: FacilityConfidence;
  if (total < 3) {
    confidence = 'low';
  } else if (total >= 5 && agreement >= 0.75) {
    confidence = 'high';
  } else if (total >= 3 && agreement >= 0.66) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return { confidence, present, total };
}

/**
 * Decides whether a facility's aggregate stats are trustworthy enough to be
 * mirrored into `venue_facilities` (and therefore picked up by the existing
 * recommender — see scoreFacilities in lib/recommendations/familyScore.ts).
 *
 * Mirrors the WHEN clause of `mirror_facility_stats_to_venue_facilities()`
 * in the migration EXACTLY: confidence must be at least 'medium' AND the
 * majority verdict must be "present".
 */
export function shouldMirror(stats: FacilityStatsLike): boolean {
  return (stats.confidence === 'medium' || stats.confidence === 'high') && stats.present === true;
}
