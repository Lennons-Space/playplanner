// =============================================================================
// scripts/enrich/web/confidenceScore.ts
//
// Enrichment 2.0 — Part 3: deterministic PER-FIELD numeric confidence (0-100).
//
// This is an ADDITIVE layer next to the existing qualitative confidence.ts
// (low/medium/high). It does NOT change confidence.ts's output or behaviour —
// the existing human-review report keeps using computeConfidence() unchanged.
// This module exists so autoApplyPolicy.ts has a deterministic score to compare
// against field-specific thresholds (Part 3/4).
//
// Scoring model:
//   base score by extraction method (jsonld/microdata=90, meta=65, heuristic=40)
//   + corroboration bonus (extra independent sources agreeing, capped)
//   - conflict-with-existing-value penalty
//   - opening-hours parse-issue penalty
//   - personal-email penalty
//   - evidence-age discount (stale evidence is weaker evidence)
// clamped to [0, 100].
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type { Confidence, ExtractionMethod, WebField } from '../../../types/webEnrichment';
import type { ConfidenceScoreInput, FieldConfidenceScore, ScoreAdjustment } from '../../../types/enrichmentAutonomy';
import { computeConfidence } from './confidence';

const BASE_BY_METHOD: Record<ExtractionMethod, number> = {
  jsonld: 90,
  microdata: 82,
  meta: 65,
  heuristic: 40,
};

// Fields whose extraction is inherently lossy or legally sensitive keep a hard
// ceiling regardless of method/corroboration — mirrors the qualitative system's
// existing "never above medium" rules (confidence.ts) so this layer can never be
// MORE permissive than the human-review system it sits beside.
const FIELD_SCORE_CEILING: Partial<Record<WebField, number>> = {
  // 84, not just "below every threshold" — deliberately kept ABOVE the 80
  // defer-floor too, so strong price evidence still lands in 'defer' (kept as
  // a retry/evidence candidate) rather than 'ignore'. autoApplyPolicy.ts
  // separately hardcodes price_range as never-auto-apply regardless of score,
  // so this ceiling only controls the defer-vs-ignore split, never eligibility.
  price_range: 84,   // lossy £-text -> 4-bucket enum mapping; never "high enough" alone
  description: 60,   // apply always requires an admin rewrite (legal/copyright) — see 056 RPC
  // 84, for the same reason as price_range: above the 80 defer-floor so a real
  // booking link is KEPT as an evidence candidate rather than dropped into
  // 'ignore', but below every auto-apply threshold so the generic score path
  // can never publish one. Was 0 ("no venues.booking_url column yet — never
  // actionable"); migration 060 §B adds that column, so a 0 ceiling would now
  // silently discard every booking link before anything could look at it.
  // What actually decides a booking link is venue IDENTITY, not this score —
  // see web/bookingUrlPolicy.ts.
  booking_url: 84,
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function scoreFieldConfidence(input: ConfidenceScoreInput): FieldConfidenceScore {
  const adjustments: ScoreAdjustment[] = [];
  const baseScore = BASE_BY_METHOD[input.method];
  let score = baseScore;

  const corroborating = input.corroboratingSources ?? 1;
  if (corroborating > 1) {
    const bonus = Math.min(10, (corroborating - 1) * 5);
    score += bonus;
    adjustments.push({ reason: `${corroborating} corroborating sources`, delta: bonus });
  }

  if (input.conflictsExisting) {
    adjustments.push({ reason: 'conflicts with existing stored value', delta: -25 });
    score -= 25;
  }

  if (input.field === 'opening_hours' && (input.openingIssues?.length ?? 0) > 0) {
    adjustments.push({ reason: `opening-hours parse issues: ${input.openingIssues!.join(',')}`, delta: -20 });
    score -= 20;
  }

  if (input.field === 'email' && input.isPersonalEmail) {
    adjustments.push({ reason: 'personal-looking email address', delta: -35 });
    score -= 35;
  }

  if (typeof input.evidenceAgeDays === 'number' && input.evidenceAgeDays > 30) {
    // Gentle linear discount beyond 30 days, capped at -15 by 120+ days old.
    const penalty = Math.min(15, Math.round(((input.evidenceAgeDays - 30) / 90) * 15));
    if (penalty > 0) {
      adjustments.push({ reason: `evidence is ${input.evidenceAgeDays}d old`, delta: -penalty });
      score -= penalty;
    }
  }

  const ceiling = FIELD_SCORE_CEILING[input.field];
  if (typeof ceiling === 'number' && score > ceiling) {
    adjustments.push({ reason: `field ceiling for ${input.field}`, delta: ceiling - score });
    score = ceiling;
  }

  score = clamp(score);

  const qualitative: Confidence = computeConfidence({
    field: input.field,
    method: input.method,
    conflictsExisting: input.conflictsExisting,
    openingIssues: input.openingIssues,
    isPersonalEmail: input.isPersonalEmail,
  });

  return {
    field: input.field,
    method: input.method,
    score,
    qualitative,
    baseScore,
    adjustments,
  };
}
