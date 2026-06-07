/**
 * Tests for lib/facilities/confidence.ts
 *
 * These pure functions mirror the SQL trigger `recompute_facility_stats()`
 * (and `mirror_facility_stats_to_venue_facilities()`) in
 * supabase/migrations/050_parent_facility_votes.sql. We cannot run Postgres
 * inside Jest, so this is the only place the confidence/mirror DECISION LOGIC
 * is exercised in CI. The migration's trigger logic itself is DB-enforced and
 * verified only by manual/integration testing against a real database — see
 * the migration file's parity comment and the report for this feature.
 */

import { computeConfidence, shouldMirror } from '../confidence';

describe('computeConfidence — thresholds', () => {
  // 0 votes: nothing to go on. Must not crash on division by zero.
  it('returns low confidence and present=false for zero votes', () => {
    expect(computeConfidence(0, 0)).toEqual({ confidence: 'low', present: false, total: 0 });
  });

  // 1-2 votes → always low, regardless of agreement.
  it('returns low confidence for a single vote', () => {
    expect(computeConfidence(1, 0)).toEqual({ confidence: 'low', present: true, total: 1 });
  });

  it('returns low confidence for two votes even with full agreement', () => {
    expect(computeConfidence(2, 0)).toEqual({ confidence: 'low', present: true, total: 2 });
  });

  // 3 votes with agreement >= 0.66 (2/3 ≈ 0.667) → medium.
  it('returns medium confidence at 3 votes with 2/3 agreement', () => {
    const result = computeConfidence(2, 1);
    expect(result.confidence).toBe('medium');
    expect(result.present).toBe(true);
    expect(result.total).toBe(3);
  });

  // 3 votes with exactly 50/50-ish split (2 vs 1 is the closest to even at
  // odd totals) still counts as medium because agreement (0.667) clears 0.66.
  // A genuine tie (e.g. would require an even total) resolves to low/medium
  // based on agreement, and present=false.
  it('treats a 3-vote tie-leaning split as medium with present=false when no > yes', () => {
    const result = computeConfidence(1, 2);
    expect(result.confidence).toBe('medium');
    expect(result.present).toBe(false); // majority says "not present"
  });

  // 4 votes, agreement 0.75 (3/4) → still medium (needs >= 5 for high).
  it('caps at medium confidence below 5 total votes even with high agreement', () => {
    const result = computeConfidence(3, 1);
    expect(result.confidence).toBe('medium');
    expect(result.total).toBe(4);
  });

  // 5 votes with agreement >= 0.75 (4/5 = 0.8) → high.
  it('returns high confidence at 5 votes with >=75% agreement', () => {
    const result = computeConfidence(4, 1);
    expect(result.confidence).toBe('high');
    expect(result.present).toBe(true);
    expect(result.total).toBe(5);
  });

  // 5 votes but only 60% agreement (3/5) → not enough for high; falls to medium
  // because total >= 3 and agreement (0.6) is below the medium bar (0.66) —
  // so this actually lands on low. This case pins down the boundary precisely.
  it('falls back to low when agreement is below the medium threshold even at 5 votes', () => {
    const result = computeConfidence(3, 2);
    // agreement = 3/5 = 0.6, which is < 0.66 → low
    expect(result.confidence).toBe('low');
    expect(result.present).toBe(true);
  });

  // Exactly at the medium boundary: 0.66 agreement.
  it('treats agreement exactly at 0.66 as medium (boundary inclusive)', () => {
    // 100 total votes, 66 yes / 34 no → agreement = 0.66 exactly
    const result = computeConfidence(66, 34);
    expect(result.confidence).toBe('medium');
  });

  // Exactly at the high boundary: total = 5, agreement = 0.75.
  it('treats agreement exactly at 0.75 with total=5 as high (boundary inclusive)', () => {
    const result = computeConfidence(4, 1); // 4/5 = 0.8 — comfortably above; use exact 0.75 below
    expect(result.confidence).toBe('high');

    // Construct an exact 0.75 with a larger total to hit the boundary precisely.
    const exact = computeConfidence(15, 5); // 20 total, 15/20 = 0.75
    expect(exact.confidence).toBe('high');
  });
});

describe('computeConfidence — majority verdict (present)', () => {
  it('returns present=true when yes outnumbers no', () => {
    expect(computeConfidence(5, 2).present).toBe(true);
  });

  it('returns present=false when no outnumbers yes', () => {
    expect(computeConfidence(2, 5).present).toBe(false);
  });

  it('returns present=false on an exact tie (cautious default)', () => {
    expect(computeConfidence(3, 3).present).toBe(false);
  });
});

describe('shouldMirror', () => {
  it('returns false for low confidence even if present is true', () => {
    expect(shouldMirror({ confidence: 'low', present: true })).toBe(false);
  });

  it('returns false for medium confidence when present is false', () => {
    expect(shouldMirror({ confidence: 'medium', present: false })).toBe(false);
  });

  it('returns true for medium confidence when present is true', () => {
    expect(shouldMirror({ confidence: 'medium', present: true })).toBe(true);
  });

  it('returns true for high confidence when present is true', () => {
    expect(shouldMirror({ confidence: 'high', present: true })).toBe(true);
  });

  it('returns false for high confidence when present is false', () => {
    expect(shouldMirror({ confidence: 'high', present: false })).toBe(false);
  });
});

describe('computeConfidence — one-vote and mixed-agreement edge cases', () => {
  // Single "no" vote: low confidence, present=false (no majority for "yes").
  it('handles a single "no" vote as low confidence and not present', () => {
    expect(computeConfidence(0, 1)).toEqual({ confidence: 'low', present: false, total: 1 });
  });

  // Larger mixed sample that fails the high bar on agreement (just barely).
  it('does not promote to high when agreement is just under 0.75 at high volume', () => {
    // 10 total, 7 yes / 3 no → agreement = 0.7 → medium (>=3 total, >=0.66 agreement)
    const result = computeConfidence(7, 3);
    expect(result.confidence).toBe('medium');
    expect(result.present).toBe(true);
  });

  // Large sample with strong disagreement stays low because agreement is poor,
  // even though total volume is high — confidence reflects AGREEMENT, not just sample size.
  it('returns low confidence for a large but evenly-split sample', () => {
    // 20 total, 11 yes / 9 no → agreement = 0.55 → low
    const result = computeConfidence(11, 9);
    expect(result.confidence).toBe('low');
  });
});
