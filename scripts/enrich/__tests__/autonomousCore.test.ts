// =============================================================================
// scripts/enrich/__tests__/autonomousCore.test.ts
//
// Tests the pure orchestrator core: classification wiring, checkpoint
// resume/dedup, and the Part 12 run-report shape.
// =============================================================================

import {
  classifyProposal,
  classifyProposals,
  createCheckpoint,
  markProcessed,
  isProcessed,
  filterUnprocessed,
  markComplete,
  buildAutonomyReport,
  renderHumanSummary,
} from '../autonomousCore';
import type { ProposalDraft } from '../../../types/webEnrichment';

const NOW = new Date('2026-08-13T00:00:00.000Z');

function draft(overrides: Partial<ProposalDraft> = {}): ProposalDraft {
  return {
    field: 'phone',
    proposed_value: { v: '+441743850066' },
    current_value: null,
    source_url: 'https://example.com/',
    evidence_snippet: 'Call us on 01743 850066',
    evidence_raw: null,
    retrieved_at: NOW.toISOString(),
    extraction_method: 'jsonld',
    confidence: 'high',
    conflicts_existing: false,
    ...overrides,
  };
}

describe('classifyProposal', () => {
  it('auto-applies a clean high-confidence phone', () => {
    const r = classifyProposal(draft(), { now: NOW, currentValueHumanVerified: false, isNewVenue: false });
    expect(r.decision.action).toBe('auto_apply');
  });

  it('defers/excepts when the current value is human-verified', () => {
    const r = classifyProposal(draft({ conflicts_existing: true }), {
      now: NOW,
      currentValueHumanVerified: true,
      isNewVenue: false,
    });
    expect(r.decision.action).toBe('exception');
  });

  it('description never auto-applies via this path either', () => {
    const r = classifyProposal(draft({ field: 'description', extraction_method: 'jsonld' }), {
      now: NOW,
      currentValueHumanVerified: false,
      isNewVenue: false,
    });
    expect(r.decision.action).not.toBe('auto_apply');
  });
});

describe('classifyProposals — bucketing', () => {
  it('sorts a mixed batch into the correct buckets', () => {
    const drafts = [
      draft({ field: 'phone', extraction_method: 'jsonld' }), // auto_apply
      draft({ field: 'price_range', extraction_method: 'jsonld' }), // never auto-applies -> defer
      draft({ field: 'email', extraction_method: 'heuristic' }), // low score -> ignore
    ];
    const buckets = classifyProposals(drafts, { now: NOW, currentValueHumanVerified: false, isNewVenue: false });
    expect(buckets.autoApply.length).toBe(1);
    expect(buckets.defer.length).toBe(1);
    expect(buckets.ignore.length).toBe(1);
    expect(buckets.exception.length).toBe(0);
  });
});

describe('checkpoint helpers', () => {
  it('creates an empty, non-complete checkpoint', () => {
    const cp = createCheckpoint('run-1', 'enrich-existing', NOW);
    expect(cp.processedVenueIds).toEqual([]);
    expect(cp.complete).toBe(false);
  });

  it('marks a venue processed and is idempotent', () => {
    let cp = createCheckpoint('run-1', 'enrich-existing', NOW);
    cp = markProcessed(cp, 'venue-a', NOW);
    cp = markProcessed(cp, 'venue-a', NOW); // duplicate call
    expect(cp.processedVenueIds).toEqual(['venue-a']);
    expect(isProcessed(cp, 'venue-a')).toBe(true);
    expect(isProcessed(cp, 'venue-b')).toBe(false);
  });

  it('filterUnprocessed removes already-processed ids, keeps order', () => {
    let cp = createCheckpoint('run-1', 'enrich-existing', NOW);
    cp = markProcessed(cp, 'a', NOW);
    const remaining = filterUnprocessed(['a', 'b', 'c'], cp);
    expect(remaining).toEqual(['b', 'c']);
  });

  it('filterUnprocessed with a null checkpoint returns everything (fresh run)', () => {
    expect(filterUnprocessed(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('markComplete sets complete=true without touching processed ids', () => {
    let cp = createCheckpoint('run-1', 'enrich-existing', NOW);
    cp = markProcessed(cp, 'a', NOW);
    cp = markComplete(cp, NOW);
    expect(cp.complete).toBe(true);
    expect(cp.processedVenueIds).toEqual(['a']);
  });
});

describe('buildAutonomyReport / renderHumanSummary', () => {
  it('aggregates classified buckets into the Part 12 report shape', () => {
    const buckets = classifyProposals(
      [draft({ field: 'phone' }), draft({ field: 'price_range' }), draft({ field: 'email', extraction_method: 'heuristic' })],
      { now: NOW, currentValueHumanVerified: false, isNewVenue: false },
    );
    const report = buildAutonomyReport({
      runId: 'run-1',
      generatedAt: NOW.toISOString(),
      durationMs: 1234,
      venuesConsidered: 5,
      venuesCrawled: 3,
      venuesSkippedFresh: 2,
      classifiedByVenue: [buckets],
      websitesDiscovered: 3,
      candidatesDiscovered: 0,
      candidateDuplicatesSkipped: 0,
      newVenuesAutoAccepted: 0,
      newVenuesQuarantined: 0,
      suspectedClosures: 0,
      failedRequests: 0,
      robotsDeniedRequests: 0,
      cacheHitRate: 0.5,
    });
    expect(report.fieldsExtracted).toBe(3);
    expect(report.fieldsAutoApplied).toBe(1);
    expect(report.byField.phone?.extracted).toBe(1);
    expect(report.byField.phone?.autoApplied).toBe(1);

    const summary = renderHumanSummary(report);
    expect(summary).toContain('run-1');
    expect(summary).toContain('Fields auto-applied    : 1');
  });
});
