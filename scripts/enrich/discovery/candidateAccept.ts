// =============================================================================
// scripts/enrich/discovery/candidateAccept.ts
//
// Enrichment 2.0 — Part 8: the new-venue auto-accept gate. PURE mirror of the
// `auto_accept_candidate` SQL RPC (created in 059_enrichment_autonomy.sql,
// replaced in 061_enrichment_review_paths.sql to add the independence gate)
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
// TWO INDEPENDENT REQUIREMENTS (Enrichment 2.1 hardening): auto-accept needs
// BOTH a high confidence score AND at least MIN_INDEPENDENT_IDENTITY_EVIDENCE
// independent identity sources. They are not interchangeable — the score
// measures extraction quality, the evidence count measures whether more than
// one witness says the place exists. A perfect-100 single OSM record therefore
// QUARANTINES; it is a strong candidate, not a publishable one.
//
// SCOPE: this applies ONLY to creating a new published venue. Field-level
// auto-apply on an EXISTING, already-identified venue is unchanged and still
// governed by web/autoApplyPolicy.ts — the venue's identity is not in question
// there, so the independence requirement would be pure friction.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import { MIN_INDEPENDENT_IDENTITY_EVIDENCE } from './identityEvidence';
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
    return { decision: 'merge_existing', reason: 'matches an existing venue — enrich the existing venue, never create a duplicate' };
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

  // ── INDEPENDENT IDENTITY EVIDENCE (Enrichment 2.1 hardening) ─────────────
  // Deliberately checked LAST and separately from the score, because it is a
  // different kind of claim. Everything above asks "did we read this record
  // correctly and completely?"; this asks "does more than one independent
  // witness say this place exists and is what the record claims?".
  //
  // A single structured record — however complete, even at a perfect 100 —
  // is one community-editable row. Publishing a public family venue from that
  // alone is not a confidence problem that a higher threshold could fix, so no
  // score is allowed to substitute for it.
  const evidence = input.independentIdentityEvidenceCount;
  if (evidence < MIN_INDEPENDENT_IDENTITY_EVIDENCE) {
    return quarantine(
      `only ${evidence} independent identity source(s) (${describeSources(input.identityEvidenceSources)}); ` +
      `publishing a new venue needs ${MIN_INDEPENDENT_IDENTITY_EVIDENCE} — either VERIFIED official-site ` +
      `corroboration or a second genuinely independent trusted source. Confidence ${confidenceScore} is ` +
      'strong, but numeric confidence never substitutes for independent identity evidence',
    );
  }

  // All gates satisfied, score clears the strict new-venue bar, AND identity
  // is independently attested.
  return {
    decision: 'auto_accept',
    reason:
      `all gates satisfied, confidence ${confidenceScore} >= ${AUTO_ACCEPT_MIN_SCORE}, ` +
      `and ${evidence} independent identity sources (${describeSources(input.identityEvidenceSources)})`,
  };
}

function describeSources(sources: string[] | undefined): string {
  return sources && sources.length > 0 ? sources.join(' + ') : 'source not recorded';
}

function reject(reason: string): CandidateAcceptResult {
  return { decision: 'reject' as CandidateAcceptDecision, reason };
}
function quarantine(reason: string): CandidateAcceptResult {
  return { decision: 'quarantine' as CandidateAcceptDecision, reason };
}
