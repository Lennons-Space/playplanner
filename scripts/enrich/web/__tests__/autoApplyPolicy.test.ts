// =============================================================================
// scripts/enrich/web/__tests__/autoApplyPolicy.test.ts
//
// Tests the auto-apply decision engine (Enrichment 2.0 Part 3/4/15). These
// tests are the single most safety-critical suite in this pass: a bug here
// means the autonomous orchestrator writes to real venues without a human in
// the loop. Every band and every override is covered.
// =============================================================================

import { decideAutoApply, FIELD_THRESHOLDS } from '../autoApplyPolicy';
import { scoreFieldConfidence } from '../confidenceScore';
import type { FieldConfidenceScore } from '../../../../types/enrichmentAutonomy';

function confidenceOf(score: number, field: FieldConfidenceScore['field'] = 'phone'): FieldConfidenceScore {
  return { field, method: 'jsonld', score, qualitative: 'high', baseScore: score, adjustments: [] };
}

describe('decideAutoApply — auto_apply band', () => {
  it('auto-applies a phone at/above its threshold with no conflict', () => {
    const d = decideAutoApply({
      confidence: confidenceOf(FIELD_THRESHOLDS['phone']!, 'phone'),
      conflictsExisting: false,
      currentValueHumanVerified: false,
    });
    expect(d.action).toBe('auto_apply');
  });

  it('does not auto-apply one point below the threshold', () => {
    const d = decideAutoApply({
      confidence: confidenceOf(FIELD_THRESHOLDS['phone']! - 1, 'phone'),
      conflictsExisting: false,
      currentValueHumanVerified: false,
    });
    expect(d.action).not.toBe('auto_apply');
  });
});

describe('decideAutoApply — never-auto-apply fields', () => {
  it.each(['price_range', 'description', 'booking_url'] as const)('%s never auto-applies even at score 100', (field) => {
    const d = decideAutoApply({
      confidence: confidenceOf(100, field),
      conflictsExisting: false,
      currentValueHumanVerified: false,
    });
    expect(d.action).not.toBe('auto_apply');
    expect(d.neverAutoApplies).toBe(true);
  });
});

describe('decideAutoApply — defer / ignore bands', () => {
  it('defers a mid-confidence score', () => {
    const d = decideAutoApply({
      confidence: confidenceOf(85, 'phone'),
      conflictsExisting: false,
      currentValueHumanVerified: false,
    });
    expect(d.action).toBe('defer');
  });

  it('ignores a low-confidence score', () => {
    const d = decideAutoApply({
      confidence: confidenceOf(40, 'phone'),
      conflictsExisting: false,
      currentValueHumanVerified: false,
    });
    expect(d.action).toBe('ignore');
  });
});

describe('decideAutoApply — precedence guard (human-verified data)', () => {
  it('surfaces an exception instead of auto-applying over a human-verified value', () => {
    const d = decideAutoApply({
      confidence: confidenceOf(99, 'phone'),
      conflictsExisting: true,
      currentValueHumanVerified: true,
    });
    expect(d.action).toBe('exception');
  });
});

describe('decideAutoApply — conflicting high-quality evidence', () => {
  it('surfaces an exception (not auto_apply, not silently deferred) for a near-miss conflict', () => {
    const threshold = FIELD_THRESHOLDS['website']!;
    const d = decideAutoApply({
      confidence: confidenceOf(threshold - 2, 'website'),
      conflictsExisting: true,
      currentValueHumanVerified: false,
    });
    expect(d.action).toBe('exception');
  });

  it('defers a low-quality conflicting proposal rather than raising an exception', () => {
    const d = decideAutoApply({
      confidence: confidenceOf(82, 'website'),
      conflictsExisting: true,
      currentValueHumanVerified: false,
    });
    expect(d.action).toBe('defer');
  });
});

describe('decideAutoApply — new-venue stricter bar', () => {
  it('requires a higher score for a new (not-yet-published) venue', () => {
    const threshold = FIELD_THRESHOLDS['phone']!;
    const existingVenue = decideAutoApply({
      confidence: confidenceOf(threshold, 'phone'),
      conflictsExisting: false,
      currentValueHumanVerified: false,
      isNewVenue: false,
    });
    const newVenue = decideAutoApply({
      confidence: confidenceOf(threshold, 'phone'),
      conflictsExisting: false,
      currentValueHumanVerified: false,
      isNewVenue: true,
    });
    expect(existingVenue.action).toBe('auto_apply');
    expect(newVenue.action).not.toBe('auto_apply');
  });
});

describe('decideAutoApply — integration with the real scorer', () => {
  it('a clean JSON-LD phone with no conflict ends up auto_apply end-to-end', () => {
    const score = scoreFieldConfidence({ field: 'phone', method: 'jsonld', conflictsExisting: false });
    const d = decideAutoApply({ confidence: score, conflictsExisting: false, currentValueHumanVerified: false });
    expect(d.action).toBe('auto_apply');
  });

  it('a heuristic-extracted price never auto-applies end-to-end', () => {
    const score = scoreFieldConfidence({ field: 'price_range', method: 'heuristic', conflictsExisting: false });
    const d = decideAutoApply({ confidence: score, conflictsExisting: false, currentValueHumanVerified: false });
    expect(d.action).not.toBe('auto_apply');
  });
});
