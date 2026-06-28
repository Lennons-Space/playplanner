// =============================================================================
// Tests for confidence.ts — base levels + caps (spec §6b).
// =============================================================================

import { computeConfidence } from '../confidence';

describe('base confidence by method', () => {
  it('jsonld → high for a non-capped field', () => {
    expect(computeConfidence({ field: 'phone', method: 'jsonld' })).toBe('high');
  });
  it('meta → medium', () => {
    expect(computeConfidence({ field: 'phone', method: 'meta' })).toBe('medium');
  });
  it('heuristic → low', () => {
    expect(computeConfidence({ field: 'phone', method: 'heuristic' })).toBe('low');
  });
});

describe('caps', () => {
  it('price_range is capped at medium even from jsonld', () => {
    expect(computeConfidence({ field: 'price_range', method: 'jsonld' })).toBe('medium');
  });
  it('description is capped at medium', () => {
    expect(computeConfidence({ field: 'description', method: 'jsonld' })).toBe('medium');
  });
  it('opening_hours with issues is capped at medium', () => {
    expect(
      computeConfidence({ field: 'opening_hours', method: 'jsonld', openingIssues: ['split_hours'] }),
    ).toBe('medium');
  });
  it('opening_hours without issues stays high', () => {
    expect(
      computeConfidence({ field: 'opening_hours', method: 'jsonld', openingIssues: [] }),
    ).toBe('high');
  });
  it('a conflict caps at medium', () => {
    expect(
      computeConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: true }),
    ).toBe('medium');
  });
  it('a personal email is capped at low', () => {
    expect(
      computeConfidence({ field: 'email', method: 'jsonld', isPersonalEmail: true }),
    ).toBe('low');
  });
});
