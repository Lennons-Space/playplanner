// =============================================================================
// scripts/enrich/__tests__/freshness.test.ts
//
// Tests the freshness/re-enrichment scheduler (Enrichment 2.0 Part 13).
// =============================================================================

import { computeFreshness, prioritiseVenues, FRESHNESS_TTL_DAYS, SUSPICIOUS_CLOSURE_TTL_DAYS } from '../freshness';

const NOW = new Date('2026-08-13T00:00:00.000Z');

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe('computeFreshness', () => {
  it('never-checked is always stale', () => {
    const r = computeFreshness({ domain: 'opening_hours', lastCheckedAt: null }, NOW);
    expect(r.stale).toBe(true);
    expect(r.ageDays).toBeNull();
  });

  it('is fresh just under the domain TTL', () => {
    const ttl = FRESHNESS_TTL_DAYS.opening_hours;
    const r = computeFreshness({ domain: 'opening_hours', lastCheckedAt: daysAgo(ttl - 1) }, NOW);
    expect(r.stale).toBe(false);
  });

  it('is stale at/over the domain TTL', () => {
    const ttl = FRESHNESS_TTL_DAYS.opening_hours;
    const r = computeFreshness({ domain: 'opening_hours', lastCheckedAt: daysAgo(ttl) }, NOW);
    expect(r.stale).toBe(true);
  });

  it('identity has the longest TTL, opening_hours a much shorter one', () => {
    expect(FRESHNESS_TTL_DAYS.identity).toBeGreaterThan(FRESHNESS_TTL_DAYS.opening_hours);
  });

  it('shortens closure_status TTL for a venue already under suspicion', () => {
    const r = computeFreshness(
      { domain: 'closure_status', lastCheckedAt: daysAgo(SUSPICIOUS_CLOSURE_TTL_DAYS), suspiciousClosure: true },
      NOW,
    );
    expect(r.ttlDays).toBe(SUSPICIOUS_CLOSURE_TTL_DAYS);
    expect(r.stale).toBe(true);
  });
});

describe('prioritiseVenues', () => {
  it('ranks a venue missing a critical field above a merely-stale one', () => {
    const result = prioritiseVenues(
      [
        { venueId: 'stale-only', checks: [{ domain: 'opening_hours', lastCheckedAt: daysAgo(200) }] },
        { venueId: 'missing-critical', checks: [], missingCriticalField: true },
      ],
      NOW,
    );
    expect(result[0]!.venueId).toBe('missing-critical');
  });

  it('ranks a fully-fresh, complete venue lowest', () => {
    const result = prioritiseVenues(
      [
        { venueId: 'fresh', checks: [{ domain: 'opening_hours', lastCheckedAt: daysAgo(1) }] },
        { venueId: 'stale', checks: [{ domain: 'opening_hours', lastCheckedAt: daysAgo(200) }] },
      ],
      NOW,
    );
    expect(result[result.length - 1]!.venueId).toBe('fresh');
  });

  it('never invents a popularity signal when none is supplied (no effect on ordering)', () => {
    const withPop = prioritiseVenues(
      [{ venueId: 'a', checks: [], popularitySignal: 100 }],
      NOW,
    );
    const withoutPop = prioritiseVenues([{ venueId: 'a', checks: [] }], NOW);
    expect(withoutPop[0]!.priority).toBe(0);
    expect(withPop[0]!.priority).toBeGreaterThan(0);
  });

  it('is a stable, deterministic sort for identical inputs', () => {
    const input = [
      { venueId: 'a', checks: [{ domain: 'contact' as const, lastCheckedAt: daysAgo(200) }] },
      { venueId: 'b', checks: [{ domain: 'contact' as const, lastCheckedAt: daysAgo(200) }] },
    ];
    const r1 = prioritiseVenues(input, NOW).map((v) => v.venueId);
    const r2 = prioritiseVenues(input, NOW).map((v) => v.venueId);
    expect(r1).toEqual(r2);
  });
});
