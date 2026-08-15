// =============================================================================
// scripts/enrich/web/autoApplyPolicy.ts
//
// Enrichment 2.0 — Part 3/4/15: turns a numeric FieldConfidenceScore into one
// of four actions: auto_apply | defer | ignore | exception.
//
// THRESHOLDS (documented, field-specific — Part 3 explicitly allows this):
//   phone           88   "exact official phone number may auto-apply at a lower
//                         threshold" (spec's own example) — a phone number is
//                         low-risk: wrong guesses are easy for a parent to spot
//                         and do not mislead about safety/identity.
//   email           90   Slightly higher than phone: email is more often
//                         mistaken for a personal address (see confidenceScore's
//                         personal-email penalty, which already pulls the score
//                         down before it reaches this gate).
//   website         90   A wrong website is a moderate trust issue (parents may
//                         click through) but is trivially correctable and never
//                         silently wrong about safety.
//   opening_hours   92   Wrong hours cause a wasted family trip — higher bar,
//                         and confidenceScore already zeroes out 20pts for any
//                         parse issue (split hours, seasonal notes, ambiguity),
//                         so only a clean, unambiguous JSON-LD week can clear it.
//   price_range     —    NEVER auto-applies. Mapping free-text to the 4-bucket
//                         enum is lossy by construction (fields.ts mapPriceToBand
//                         docstring); confidenceScore.ts hard-ceilings it at 79,
//                         below every threshold, so it can only ever defer/ignore.
//   description     —    NEVER auto-applies. The 056 apply RPC legally requires
//                         an admin-authored rewrite distinct from scraped text
//                         (copyright) — there is no proposed_value an automation
//                         could ever apply verbatim, by design.
//   booking_url     —    Never auto-applies THROUGH THIS GENERIC PATH, and that
//                         is now a deliberate routing decision rather than the
//                         old "there is no column" one (migration 060 §B adds
//                         venues.booking_url). A booking link needs a check no
//                         confidence score can express — does the link belong
//                         to THIS venue — so it is decided by
//                         web/bookingUrlPolicy.ts against the venue's own
//                         website host and applied via migration 060 §F's
//                         dedicated auto_apply_booking_url RPC. Keeping it in
//                         NEVER_AUTO_APPLY here keeps this module in lockstep
//                         with migration 059's SQL, which also still blocks it.
//
// Bands below the auto-apply threshold (Part 3's suggested 95-100/80-94/<80,
// adapted per-field since the ceiling above already encodes field risk):
//   score >= threshold                          -> auto_apply (if eligible)
//   80 <= score < threshold                      -> defer (kept as retry candidate)
//   score < 80                                    -> ignore (diagnostic only)
//
// Overrides (take priority over the score bands):
//   - current value is human-verified AND the proposal would change it
//       -> exception (Part 15 precedence: automation never silently overwrites
//          an admin-confirmed value; a human must approve the override)
//   - proposal conflicts with a non-null existing value AND is otherwise
//     auto-apply-quality (within 5 points of threshold)
//       -> exception ("two plausible official sources" scenario, Part 11)
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type { WebField } from '../../../types/webEnrichment';
import type { AutoApplyDecision, AutoApplyPolicyInput } from '../../../types/enrichmentAutonomy';

/** Single source of truth for auto-apply thresholds. Exported for tests/report. */
export const FIELD_THRESHOLDS: Partial<Record<WebField, number>> = {
  phone: 88,
  email: 90,
  website: 90,
  opening_hours: 92,
};

/** Fields that can never auto-apply, regardless of score (documented above). */
const NEVER_AUTO_APPLY: ReadonlySet<WebField> = new Set(['price_range', 'description', 'booking_url']);

/** New-venue proposals require a stricter bar (Part 3: new venue > existing-venue enrichment). */
const NEW_VENUE_THRESHOLD_BUMP = 5;

const DEFER_FLOOR = 80;
const EXCEPTION_NEAR_MISS_MARGIN = 5;

export function decideAutoApply(input: AutoApplyPolicyInput): AutoApplyDecision {
  const { confidence, conflictsExisting, currentValueHumanVerified, isNewVenue } = input;
  const { field, score } = confidence;

  const neverAutoApplies = NEVER_AUTO_APPLY.has(field);
  const baseThreshold = FIELD_THRESHOLDS[field] ?? 95; // unknown/unlisted field -> conservative default
  const threshold = baseThreshold + (isNewVenue ? NEW_VENUE_THRESHOLD_BUMP : 0);

  // Precedence guard: never silently override a human-verified value.
  if (currentValueHumanVerified && conflictsExisting) {
    return {
      field,
      action: 'exception',
      score,
      threshold,
      neverAutoApplies,
      reason: 'current value was human-verified; automation requires explicit admin override',
    };
  }

  // Near-miss conflict: two plausible sources disagree and the evidence is
  // otherwise strong enough to have auto-applied — surface it, don't silently
  // pick a winner and don't silently bury it either.
  if (conflictsExisting && score >= threshold - EXCEPTION_NEAR_MISS_MARGIN) {
    return {
      field,
      action: 'exception',
      score,
      threshold,
      neverAutoApplies,
      reason: `conflicting existing value with high-quality evidence (score ${score} within ${EXCEPTION_NEAR_MISS_MARGIN} of threshold ${threshold})`,
    };
  }

  if (!neverAutoApplies && !conflictsExisting && score >= threshold) {
    return {
      field,
      action: 'auto_apply',
      score,
      threshold,
      neverAutoApplies,
      reason: `score ${score} >= threshold ${threshold}, no conflict`,
    };
  }

  if (score >= DEFER_FLOOR) {
    return {
      field,
      action: 'defer',
      score,
      threshold,
      neverAutoApplies,
      reason: neverAutoApplies
        ? `field never auto-applies; score ${score} kept as a retry/evidence candidate`
        : `score ${score} below threshold ${threshold} but >= ${DEFER_FLOOR} — kept, not surfaced`,
    };
  }

  return {
    field,
    action: 'ignore',
    score,
    threshold,
    neverAutoApplies,
    reason: `score ${score} < ${DEFER_FLOOR} — weak evidence, diagnostic only`,
  };
}
