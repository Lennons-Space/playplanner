// =============================================================================
// scripts/enrich/web/__tests__/confidenceScore.test.ts
//
// Tests the numeric 0-100 confidence engine (Enrichment 2.0 Part 3). These
// tests lock the scoring identities the auto-apply policy depends on — if the
// base scores or penalties drift, autoApplyPolicy's thresholds silently mean
// something different.
// =============================================================================

import { scoreFieldConfidence } from '../confidenceScore';
import { FIELD_THRESHOLDS } from '../autoApplyPolicy';

const LOWEST_REAL_THRESHOLD = Math.min(...Object.values(FIELD_THRESHOLDS).filter((v): v is number => typeof v === 'number'));

describe('scoreFieldConfidence — base scores by method', () => {
  it('scores jsonld highest', () => {
    const r = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: false });
    expect(r.score).toBe(90);
    expect(r.baseScore).toBe(90);
  });

  it('scores microdata below jsonld', () => {
    const r = scoreFieldConfidence({ field: 'phone', method: 'microdata', conflictsExisting: false });
    expect(r.score).toBe(82);
  });

  it('scores meta below microdata', () => {
    const r = scoreFieldConfidence({ field: 'phone', method: 'meta', conflictsExisting: false });
    expect(r.score).toBe(65);
  });

  it('scores heuristic lowest', () => {
    const r = scoreFieldConfidence({ field: 'phone', method: 'heuristic', conflictsExisting: false });
    expect(r.score).toBe(40);
  });
});

describe('scoreFieldConfidence — penalties', () => {
  it('penalises a conflict with the existing stored value', () => {
    const clean = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: false });
    const conflict = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: true });
    expect(conflict.score).toBeLessThan(clean.score);
    expect(conflict.adjustments.some((a) => a.reason.includes('conflicts'))).toBe(true);
  });

  it('penalises opening-hours parse issues', () => {
    const r = scoreFieldConfidence({
      field: 'opening_hours',
      method: 'jsonld',
      conflictsExisting: false,
      openingIssues: ['split_hours'],
    });
    expect(r.score).toBeLessThan(90);
  });

  it('heavily penalises a personal-looking email', () => {
    const r = scoreFieldConfidence({
      field: 'email',
      method: 'jsonld',
      conflictsExisting: false,
      isPersonalEmail: true,
    });
    expect(r.score).toBeLessThanOrEqual(55);
  });

  it('discounts stale evidence', () => {
    const fresh = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: false, evidenceAgeDays: 5 });
    const stale = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: false, evidenceAgeDays: 150 });
    expect(stale.score).toBeLessThan(fresh.score);
  });

  it('never goes below 0 or above 100', () => {
    const low = scoreFieldConfidence({
      field: 'email',
      method: 'heuristic',
      conflictsExisting: true,
      isPersonalEmail: true,
      evidenceAgeDays: 400,
    });
    expect(low.score).toBeGreaterThanOrEqual(0);

    const high = scoreFieldConfidence({
      field: 'phone',
      method: 'jsonld',
      conflictsExisting: false,
      corroboratingSources: 10,
    });
    expect(high.score).toBeLessThanOrEqual(100);
  });
});

describe('scoreFieldConfidence — corroboration bonus', () => {
  it('rewards multiple independent sources agreeing, capped', () => {
    const one = scoreFieldConfidence({ field: 'website', method: 'meta', conflictsExisting: false, corroboratingSources: 1 });
    const three = scoreFieldConfidence({ field: 'website', method: 'meta', conflictsExisting: false, corroboratingSources: 3 });
    expect(three.score).toBeGreaterThan(one.score);
    expect(three.score - one.score).toBeLessThanOrEqual(10);
  });
});

describe('scoreFieldConfidence — field ceilings (lossy/legal fields)', () => {
  it('caps price_range below any realistic auto-apply threshold regardless of method', () => {
    const r = scoreFieldConfidence({ field: 'price_range', method: 'jsonld', conflictsExisting: false, corroboratingSources: 5 });
    expect(r.score).toBeLessThanOrEqual(84);
    expect(r.score).toBeLessThan(LOWEST_REAL_THRESHOLD);
  });

  it('caps description — apply always requires an admin rewrite', () => {
    const r = scoreFieldConfidence({ field: 'description', method: 'jsonld', conflictsExisting: false });
    expect(r.score).toBeLessThanOrEqual(60);
  });

  it('caps booking_url below every auto-apply threshold, so the generic score path can never publish one', () => {
    const r = scoreFieldConfidence({ field: 'booking_url', method: 'jsonld', conflictsExisting: false });
    expect(r.score).toBe(84);
    expect(r.score).toBeLessThan(88); // the lowest FIELD_THRESHOLDS entry (phone)
  });

  it('keeps booking_url above the defer floor, so a real booking link is retained as evidence rather than discarded', () => {
    // It used to be pinned at 0 ("no target column yet"), which silently threw
    // away every booking link before identity could ever be checked.
    const r = scoreFieldConfidence({ field: 'booking_url', method: 'jsonld', conflictsExisting: false });
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
});

describe('scoreFieldConfidence — qualitative mirror', () => {
  it('still reports the existing low/medium/high band unchanged', () => {
    const r = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: false });
    expect(r.qualitative).toBe('high');
  });
});
