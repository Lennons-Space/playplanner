// =============================================================================
// Tests for proposals.ts — dedup (row 26), conflict (row 12), draft shape.
// =============================================================================

import { buildProposals } from '../proposals';
import type {
  CurrentVenueSnapshot,
  FieldCandidate,
  OpeningWeek,
  ProposalDraft,
} from '../../../../types/webEnrichment';

const SRC = 'https://venue.co.uk/';
const AT = '2026-06-22T12:00:00.000Z';

function emptySnapshot(overrides: Partial<CurrentVenueSnapshot> = {}): CurrentVenueSnapshot {
  return {
    description: null,
    price_range: null,
    website: null,
    phone: null,
    email: null,
    opening_hours: [],
    ...overrides,
  };
}

function cand(over: Partial<FieldCandidate> & Pick<FieldCandidate, 'field' | 'value' | 'method'>): FieldCandidate {
  return { sourceUrl: SRC, evidenceSnippet: 'evidence', ...over };
}

function only(drafts: ProposalDraft[]): ProposalDraft {
  expect(drafts).toHaveLength(1);
  return drafts[0]!;
}

describe('dedup (row 26)', () => {
  it('drops a phone proposal equal to the current value (after normalisation)', () => {
    const drafts = buildProposals(
      [cand({ field: 'phone', value: '+441727822106', method: 'jsonld' })],
      emptySnapshot({ phone: '+44 1727 822106' }),
      { retrievedAt: AT },
    );
    expect(drafts).toHaveLength(0);
  });

  // FIX 1 regression: Apple Tree Nursery — extracted "01738561083", stored "+44 1738 561083"
  // Old code: "014447845612..." vs "+4414447..." → mismatch → false CONFLICT.
  // New code: both → "+441738561083" → equal → dropped as no-op, NOT a conflict.
  it('FIX 1: drops Apple Tree phone proposal (national vs E.164 same number)', () => {
    const drafts = buildProposals(
      [cand({ field: 'phone', value: '01738561083', method: 'heuristic' })],
      emptySnapshot({ phone: '+44 1738 561083' }),
      { retrievedAt: AT },
    );
    expect(drafts).toHaveLength(0);
  });

  it('FIX 1: still flags a genuinely different UK number as a conflict', () => {
    const drafts = buildProposals(
      [cand({ field: 'phone', value: '01738999999', method: 'heuristic' })],
      emptySnapshot({ phone: '+44 1738 561083' }),
      { retrievedAt: AT },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.conflicts_existing).toBe(true);
  });

  it('FIX 1: does not coerce a non-UK number to GB (foreign number stays distinct)', () => {
    // +1 number is not equal to any +44 stored value
    const drafts = buildProposals(
      [cand({ field: 'phone', value: '+12125550123', method: 'jsonld' })],
      emptySnapshot({ phone: '+44 1738 561083' }),
      { retrievedAt: AT },
    );
    // They differ → conflict, not a no-op dedup
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.conflicts_existing).toBe(true);
  });
});

describe('conflict (row 12)', () => {
  it('flags a differing existing value and caps confidence at medium', () => {
    const d = only(
      buildProposals(
        [cand({ field: 'phone', value: '+441727822106', method: 'jsonld' })],
        emptySnapshot({ phone: '01111 111111' }),
        { retrievedAt: AT },
      ),
    );
    expect(d.conflicts_existing).toBe(true);
    expect(d.confidence).toBe('medium'); // jsonld(high) capped by conflict
  });
});

describe('new value (no current)', () => {
  it('emits a draft with the uniform proposed_value container', () => {
    const d = only(
      buildProposals(
        [cand({ field: 'phone', value: '+441727822106', method: 'jsonld' })],
        emptySnapshot(),
        { retrievedAt: AT },
      ),
    );
    expect(d.conflicts_existing).toBe(false);
    expect(d.confidence).toBe('high');
    expect(d.proposed_value).toEqual({ v: '+441727822106' });
    expect(d.current_value).toBeNull();
    expect(d.retrieved_at).toBe(AT);
    expect(d.source_url).toBe(SRC);
  });

  it('passes opening-hours issues through to the confidence cap', () => {
    const week: OpeningWeek = {
      days: Array.from({ length: 7 }, (_, i) => ({ day_of_week: i, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] })),
      seasonal_notes: null,
      source_text: 'Mo-Su 09:00-17:00',
    };
    const d = only(
      buildProposals(
        [cand({ field: 'opening_hours', value: week, method: 'jsonld', openingIssues: ['split_hours'] })],
        emptySnapshot(),
        { retrievedAt: AT },
      ),
    );
    expect(d.confidence).toBe('medium');
    expect(d.proposed_value).toBe(week); // structured, not wrapped
  });
});

describe('opening-hours dedup', () => {
  it('drops a week identical to the stored rows', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ day_of_week: i, is_closed: false, intervals: [{ opens: '10:00', closes: '16:00' }] }));
    const week: OpeningWeek = { days, seasonal_notes: null, source_text: 'x' };
    const drafts = buildProposals(
      [cand({ field: 'opening_hours', value: week, method: 'jsonld' })],
      emptySnapshot({ opening_hours: days }),
      { retrievedAt: AT },
    );
    expect(drafts).toHaveLength(0);
  });
});
