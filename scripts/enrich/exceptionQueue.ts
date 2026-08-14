// =============================================================================
// scripts/enrich/exceptionQueue.ts
//
// Enrichment 2.0 — Part 11: the exception queue. Deliberately NOT a full admin
// UI and NOT a mirror of every pending proposal (Liam's explicit instruction:
// "do not build a huge proposal inbox... a CLI/report-based exception queue is
// acceptable for this milestone"). Surfaces ONLY the cases automation
// genuinely could not safely decide on its own:
//   - proposals autonomousCore classified as 'exception' (conflicting
//     high-quality evidence, or a would-be override of a human-verified value)
//   - discovery candidates candidateAccept.ts quarantined (possible duplicate,
//     closure signal, untrusted source, incomplete data, or just-below-bar
//     confidence)
//
// Everything else — clean auto-applies, silently-deferred low/medium
// evidence, silently-ignored weak evidence, silently-rejected junk candidates
// — never appears here. That is the point: a run can process thousands of
// venues and candidates while leaving only a handful of genuinely ambiguous
// items for Liam to look at.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type { ClassifiedProposal } from './autonomousCore';
import type { CandidateAcceptResult, ClosureAssessment } from '../../types/enrichmentAutonomy';

export interface ProposalExceptionInput {
  venueId: string;
  venueName?: string;
  classified: ClassifiedProposal;
}

export interface CandidateQuarantineInput {
  sourceId: string;
  candidateName: string;
  categorySlug: string;
  acceptResult: CandidateAcceptResult;
  confidenceScore: number;
}

export interface ClosureConfirmationInput {
  venueId: string;
  venueName?: string;
  assessment: ClosureAssessment;
}

export interface ExceptionQueueProposalItem {
  kind: 'proposal_exception';
  key: string;
  venueId: string;
  venueName: string | null;
  field: string;
  score: number;
  threshold: number;
  reason: string;
}

export interface ExceptionQueueCandidateItem {
  kind: 'candidate_quarantine';
  key: string;
  sourceId: string;
  candidateName: string;
  categorySlug: string;
  score: number;
  reason: string;
}

export interface ExceptionQueueClosureItem {
  kind: 'closure_confirmation';
  key: string;
  venueId: string;
  venueName: string | null;
  reason: string;
}

export type ExceptionQueueItem = ExceptionQueueProposalItem | ExceptionQueueCandidateItem | ExceptionQueueClosureItem;

/**
 * Build the exception queue from one run's classified proposals, quarantined
 * candidates, and strong-closure-signal venues. Only 'exception'-decision
 * proposals, 'quarantine'-decision candidates, and 'confirmed_closed'-
 * recommended venues are included — everything else is filtered out here,
 * not by the caller, so no call site can accidentally widen this into a full
 * inbox. A 'confirmed_closed' recommendation ALWAYS lands here rather than
 * being auto-applied: confirm_venue_closure is admin-only by design (Part 9
 * — a destructive change needs stronger proof than an additive one), so
 * automation can never publish this decision on its own, only surface it.
 * De-duplicated by key so a caller accidentally passing the same item twice
 * in one run never doubles it up in the report.
 */
export function buildExceptionQueue(
  proposals: ProposalExceptionInput[],
  candidates: CandidateQuarantineInput[],
  closures: ClosureConfirmationInput[] = [],
): ExceptionQueueItem[] {
  const seen = new Set<string>();
  const items: ExceptionQueueItem[] = [];

  for (const p of proposals) {
    if (p.classified.decision.action !== 'exception') continue;
    const key = `proposal:${p.venueId}:${p.classified.draft.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      kind: 'proposal_exception',
      key,
      venueId: p.venueId,
      venueName: p.venueName ?? null,
      field: p.classified.draft.field,
      score: p.classified.confidence.score,
      threshold: p.classified.decision.threshold,
      reason: p.classified.decision.reason,
    });
  }

  for (const c of candidates) {
    if (c.acceptResult.decision !== 'quarantine') continue;
    const key = `candidate:${c.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      kind: 'candidate_quarantine',
      key,
      sourceId: c.sourceId,
      candidateName: c.candidateName,
      categorySlug: c.categorySlug,
      score: c.confidenceScore,
      reason: c.acceptResult.reason,
    });
  }

  for (const c of closures) {
    if (c.assessment.recommendedStatus !== 'confirmed_closed') continue;
    const key = `closure:${c.venueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      kind: 'closure_confirmation',
      key,
      venueId: c.venueId,
      venueName: c.venueName ?? null,
      reason: c.assessment.reason,
    });
  }

  // Most-actionable first: higher score = closer to a confident human decision
  // either way. Closure confirmations have no numeric score — treated as
  // maximally actionable (100) since strong closure evidence is high-stakes.
  const scoreOf = (i: ExceptionQueueItem): number => (i.kind === 'closure_confirmation' ? 100 : i.score);
  items.sort((a, b) => scoreOf(b) - scoreOf(a));
  return items;
}

export function renderExceptionQueueHuman(items: ExceptionQueueItem[]): string {
  if (items.length === 0) return 'Exception queue: empty — nothing needs your review this run.';

  const lines: string[] = [`Exception queue: ${items.length} item(s) need your review`, ''];
  for (const item of items) {
    if (item.kind === 'proposal_exception') {
      lines.push(
        `  [PROPOSAL] venue=${item.venueId}${item.venueName ? ` (${item.venueName})` : ''} field=${item.field} ` +
        `score=${item.score}/${item.threshold} — ${item.reason}`,
      );
    } else if (item.kind === 'candidate_quarantine') {
      lines.push(
        `  [CANDIDATE] "${item.candidateName}" (${item.categorySlug}, source=${item.sourceId}) ` +
        `score=${item.score} — ${item.reason}`,
      );
    } else {
      lines.push(
        `  [CLOSURE?] venue=${item.venueId}${item.venueName ? ` (${item.venueName})` : ''} — ${item.reason} ` +
        `(admin confirm_venue_closure required — automation cannot publish this)`,
      );
    }
  }
  return lines.join('\n');
}
