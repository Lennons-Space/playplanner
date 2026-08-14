// =============================================================================
// scripts/enrich/discovery/candidateAccept.ts
//
// Enrichment 2.0 — Part 8: the new-venue auto-accept gate. PURE mirror of the
// `auto_accept_candidate` SQL RPC (supabase/migrations/059_enrichment_autonomy.sql)
// — every boolean gate and the score threshold here matches that RPC exactly,
// so a TypeScript 'auto_accept' verdict is never surprised by an RPC rejection
// (and the RPC re-checks everything server-side regardless — this module is a
// pre-flight filter, not a trust boundary; the DB is the trust boundary).
//
// A brand-new venue requires a SIGNIFICANTLY stronger bar than enriching an
// existing one (Part 3/8) — auto-accept is the single highest-risk automated
// action in this system (it PUBLISHES a venue with zero human review), so this
// gate is deliberately conservative: any single missing signal quarantines,
// never silently accepts.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type {
  CandidateAcceptDecision,
  CandidateAcceptInput,
  CandidateAcceptResult,
} from '../../../types/enrichmentAutonomy';

/** Matches auto_accept_candidate's p_min_score DEFAULT 98 exactly. */
export const AUTO_ACCEPT_MIN_SCORE = 98;

/** Below this, evidence is too thin to justify holding a human-review quarantine slot — reject outright. */
export const CANDIDATE_QUARANTINE_FLOOR = 80;

export function decideCandidateAccept(input: CandidateAcceptInput): CandidateAcceptResult {
  const {
    hasFamilyRelevantCategory,
    hasValidUkCoordinates,
    hasValidAddress,
    dedupeDecision,
    isTrustedSource,
    hasClosureSignal,
    requiredFieldsComplete,
    confidenceScore,
  } = input;

  // ── Hard rejects: fundamentally not a viable candidate ───────────────────────
  if (!hasFamilyRelevantCategory) {
    return reject('not a family-relevant category — outside the discovery allowlist');
  }
  if (!hasValidUkCoordinates) {
    return reject('coordinates are not valid UK coordinates');
  }
  if (dedupeDecision === 'duplicate') {
    return reject('matches an existing venue — enrich the existing venue, never create a duplicate');
  }

  // ── Quarantine: plausible, but automation cannot safely decide alone ─────────
  if (dedupeDecision === 'possible_duplicate') {
    return quarantine('ambiguous duplicate — needs human review to confirm distinct from an existing venue');
  }
  if (hasClosureSignal) {
    return quarantine('candidate carries a closure signal — needs human review before any publish');
  }
  if (!isTrustedSource) {
    return quarantine('source is below the trusted tier (Part 2) — needs human review');
  }
  if (!hasValidAddress || !requiredFieldsComplete) {
    return quarantine('missing address or required fields — not enough data to publish unattended');
  }
  if (confidenceScore < CANDIDATE_QUARANTINE_FLOOR) {
    return reject(`confidence ${confidenceScore} is too low to justify even a review queue slot`);
  }
  if (confidenceScore < AUTO_ACCEPT_MIN_SCORE) {
    return quarantine(
      `confidence ${confidenceScore} is just below the auto-accept bar (${AUTO_ACCEPT_MIN_SCORE}) — needs human review`,
    );
  }

  // All gates satisfied AND score clears the strict new-venue bar.
  return {
    decision: 'auto_accept',
    reason: `all gates satisfied, confidence ${confidenceScore} >= ${AUTO_ACCEPT_MIN_SCORE}`,
  };
}

function reject(reason: string): CandidateAcceptResult {
  return { decision: 'reject' as CandidateAcceptDecision, reason };
}
function quarantine(reason: string): CandidateAcceptResult {
  return { decision: 'quarantine' as CandidateAcceptDecision, reason };
}
