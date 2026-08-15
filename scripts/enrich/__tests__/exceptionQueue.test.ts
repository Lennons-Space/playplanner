import { buildExceptionQueue, renderExceptionQueueHuman } from '../exceptionQueue';
import type { ClassifiedProposal } from '../autonomousCore';
import type { CandidateAcceptResult, ClosureAssessment } from '../../../types/enrichmentAutonomy';

function classified(action: 'auto_apply' | 'defer' | 'ignore' | 'exception', overrides: Partial<ClassifiedProposal['decision']> = {}): ClassifiedProposal {
  return {
    draft: {
      field: 'website', proposed_value: { v: 'https://x.example' }, current_value: null,
      source_url: 'https://x.example', evidence_snippet: 'e', evidence_raw: null,
      retrieved_at: '2026-08-01T00:00:00.000Z', extraction_method: 'jsonld', confidence: 'high',
      conflicts_existing: false,
    },
    confidence: { field: 'website', method: 'jsonld', score: 87, qualitative: 'high', baseScore: 90, adjustments: [] },
    decision: { field: 'website', action, score: 87, threshold: 90, neverAutoApplies: false, reason: 'test reason', ...overrides },
  };
}

describe('buildExceptionQueue', () => {
  it('includes only exception-decision proposals, not auto_apply/defer/ignore', () => {
    const items = buildExceptionQueue(
      [
        { venueId: 'v1', classified: classified('exception') },
        { venueId: 'v2', classified: classified('auto_apply') },
        { venueId: 'v3', classified: classified('defer') },
        { venueId: 'v4', classified: classified('ignore') },
      ],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'proposal_exception', venueId: 'v1' });
  });

  it('includes only quarantine-decision candidates, not auto_accept/reject', () => {
    const accept: CandidateAcceptResult = { decision: 'auto_accept', reason: 'r' };
    const quarantine: CandidateAcceptResult = { decision: 'quarantine', reason: 'r' };
    const reject: CandidateAcceptResult = { decision: 'reject', reason: 'r' };
    const items = buildExceptionQueue([], [
      { sourceId: 'a', candidateName: 'A', categorySlug: 'park', acceptResult: accept, confidenceScore: 99 },
      { sourceId: 'b', candidateName: 'B', categorySlug: 'park', acceptResult: quarantine, confidenceScore: 85 },
      { sourceId: 'c', candidateName: 'C', categorySlug: 'park', acceptResult: reject, confidenceScore: 10 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'candidate_quarantine', sourceId: 'b' });
  });

  it('includes only confirmed_closed closure assessments, not suspected/active', () => {
    const confirmed: ClosureAssessment = { recommendedStatus: 'confirmed_closed', signalCount: 2, tier1SignalCount: 1, reason: 'r', ignoredNonSignals: [] };
    const suspected: ClosureAssessment = { recommendedStatus: 'suspected_closed', signalCount: 1, tier1SignalCount: 0, reason: 'r', ignoredNonSignals: [] };
    const active: ClosureAssessment = { recommendedStatus: 'active', signalCount: 0, tier1SignalCount: 0, reason: 'r', ignoredNonSignals: [] };
    const items = buildExceptionQueue([], [], [
      { venueId: 'v1', venueName: 'Confirmed Venue', assessment: confirmed },
      { venueId: 'v2', venueName: 'Suspected Venue', assessment: suspected },
      { venueId: 'v3', venueName: 'Active Venue', assessment: active },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'closure_confirmation', venueId: 'v1' });
  });

  it('sorts a closure confirmation ahead of lower-scored items', () => {
    const confirmed: ClosureAssessment = { recommendedStatus: 'confirmed_closed', signalCount: 2, tier1SignalCount: 1, reason: 'r', ignoredNonSignals: [] };
    const items = buildExceptionQueue(
      [{ venueId: 'low', classified: classified('exception', { score: 10 }) }],
      [],
      [{ venueId: 'closure-venue', assessment: confirmed }],
    );
    expect(items[0]!.kind).toBe('closure_confirmation');
  });

  it('de-duplicates the same closure confirmation within one run', () => {
    const confirmed: ClosureAssessment = { recommendedStatus: 'confirmed_closed', signalCount: 2, tier1SignalCount: 1, reason: 'r', ignoredNonSignals: [] };
    const items = buildExceptionQueue([], [], [
      { venueId: 'v1', assessment: confirmed },
      { venueId: 'v1', assessment: confirmed },
    ]);
    expect(items).toHaveLength(1);
  });

  it('de-duplicates the same proposal exception within one run', () => {
    const dup = classified('exception');
    const items = buildExceptionQueue(
      [{ venueId: 'v1', classified: dup }, { venueId: 'v1', classified: dup }],
      [],
    );
    expect(items).toHaveLength(1);
  });

  it('sorts most-actionable (highest score) first', () => {
    const low = classified('exception', { score: 50 });
    low.confidence.score = 50;
    const high = classified('exception', { score: 95 });
    high.confidence.score = 95;
    const items = buildExceptionQueue(
      [{ venueId: 'low', classified: low }, { venueId: 'high', classified: high }],
      [],
    );
    expect(items.map((i) => (i as { venueId: string }).venueId)).toEqual(['high', 'low']);
  });

  it('stays empty for a run with zero exceptions or quarantines', () => {
    const items = buildExceptionQueue([{ venueId: 'v1', classified: classified('auto_apply') }], []);
    expect(items).toHaveLength(0);
  });
});

describe('renderExceptionQueueHuman', () => {
  it('reports empty queues clearly', () => {
    expect(renderExceptionQueueHuman([])).toMatch(/empty/);
  });

  it('renders a proposal exception line with venue/field/score', () => {
    const items = buildExceptionQueue([{ venueId: 'v1', venueName: 'Test Venue', classified: classified('exception') }], []);
    const text = renderExceptionQueueHuman(items);
    expect(text).toMatch(/Test Venue/);
    expect(text).toMatch(/website/);
  });

  it('renders a closure confirmation line noting admin action is required', () => {
    const confirmed: ClosureAssessment = { recommendedStatus: 'confirmed_closed', signalCount: 2, tier1SignalCount: 1, reason: 'two tier-1 signals', ignoredNonSignals: [] };
    const items = buildExceptionQueue([], [], [{ venueId: 'v1', venueName: 'Closed Venue', assessment: confirmed }]);
    const text = renderExceptionQueueHuman(items);
    expect(text).toMatch(/CLOSURE/);
    expect(text).toMatch(/Closed Venue/);
    expect(text).toMatch(/admin confirm_venue_closure required/);
  });

  it('renders a facility conflict line', () => {
    const items = buildExceptionQueue([], [], [], [{ venueId: 'v1', venueName: 'Test Venue', facilitySlug: 'parking', reason: 'official says no parking, existing row says present' }]);
    const text = renderExceptionQueueHuman(items);
    expect(text).toMatch(/FACILITY CONFLICT/);
    expect(text).toMatch(/Test Venue/);
    expect(text).toMatch(/parking/);
  });
});

describe('buildExceptionQueue — facility conflicts', () => {
  it('includes facility conflicts and de-duplicates by (venue, slug)', () => {
    const input = { venueId: 'v1', venueName: 'Test Venue', facilitySlug: 'parking', reason: 'conflict' };
    const items = buildExceptionQueue([], [], [], [input, input]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'facility_conflict', facilitySlug: 'parking' });
  });

  it('sorts a facility conflict ahead of a lower-scored proposal exception', () => {
    const items = buildExceptionQueue(
      [{ venueId: 'low', classified: classified('exception', { score: 10 }) }],
      [], [],
      [{ venueId: 'v1', facilitySlug: 'parking', reason: 'conflict' }],
    );
    expect(items[0]!.kind).toBe('facility_conflict');
  });
});
