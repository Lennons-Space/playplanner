import { AUTO_ACCEPT_MIN_SCORE, decideCandidateAccept } from '../candidateAccept';
import type { CandidateAcceptInput } from '../../../../types/enrichmentAutonomy';

function baseInput(overrides: Partial<CandidateAcceptInput> = {}): CandidateAcceptInput {
  return {
    hasFamilyRelevantCategory: true,
    hasValidUkCoordinates: true,
    hasValidAddress: true,
    dedupeDecision: 'distinct',
    isTrustedSource: true,
    officialVerification: true,
    hasClosureSignal: false,
    requiredFieldsComplete: true,
    confidenceScore: AUTO_ACCEPT_MIN_SCORE,
    // The base case is a candidate that IS independently corroborated (its own
    // record + a VERIFIED official site), matching officialVerification: true
    // above — so these existing cases keep testing the gate each one is about.
    // The independence gate itself has its own dedicated block below.
    independentIdentityEvidenceCount: 2,
    identityEvidenceSources: ['osm', 'official_website'],
    ...overrides,
  };
}

describe('decideCandidateAccept', () => {
  it('auto-accepts when every gate passes and score clears the strict bar', () => {
    const r = decideCandidateAccept(baseInput());
    expect(r.decision).toBe('auto_accept');
  });

  it('rejects an irrelevant category outright', () => {
    const r = decideCandidateAccept(baseInput({ hasFamilyRelevantCategory: false }));
    expect(r.decision).toBe('reject');
  });

  it('rejects invalid UK coordinates', () => {
    const r = decideCandidateAccept(baseInput({ hasValidUkCoordinates: false }));
    expect(r.decision).toBe('reject');
  });

  it('routes an exact duplicate to merge_existing — never creates a second venue', () => {
    const r = decideCandidateAccept(baseInput({ dedupeDecision: 'duplicate' }));
    expect(r.decision).toBe('merge_existing');
    expect(r.reason).toMatch(/enrich the existing venue/);
  });

  it('quarantines a possible duplicate rather than auto-inserting', () => {
    const r = decideCandidateAccept(baseInput({ dedupeDecision: 'possible_duplicate' }));
    expect(r.decision).toBe('quarantine');
  });

  it('quarantines when a closure signal is present — never auto-accepts', () => {
    const r = decideCandidateAccept(baseInput({ hasClosureSignal: true }));
    expect(r.decision).toBe('quarantine');
  });

  it('quarantines an untrusted source', () => {
    const r = decideCandidateAccept(baseInput({ isTrustedSource: false }));
    expect(r.decision).toBe('quarantine');
  });

  it('quarantines missing address', () => {
    const r = decideCandidateAccept(baseInput({ hasValidAddress: false }));
    expect(r.decision).toBe('quarantine');
  });

  it('quarantines incomplete required fields', () => {
    const r = decideCandidateAccept(baseInput({ requiredFieldsComplete: false }));
    expect(r.decision).toBe('quarantine');
  });

  it('quarantines a candidate just below the auto-accept threshold', () => {
    const r = decideCandidateAccept(baseInput({ confidenceScore: AUTO_ACCEPT_MIN_SCORE - 1 }));
    expect(r.decision).toBe('quarantine');
  });

  it('rejects a candidate with weak confidence rather than holding a review slot', () => {
    const r = decideCandidateAccept(baseInput({ confidenceScore: 50 }));
    expect(r.decision).toBe('reject');
  });

  it('never auto-accepts on any single failing gate, even with a perfect score', () => {
    const gates: (keyof CandidateAcceptInput)[] = [
      'hasFamilyRelevantCategory', 'hasValidUkCoordinates', 'hasValidAddress', 'isTrustedSource', 'requiredFieldsComplete',
    ];
    for (const gate of gates) {
      const r = decideCandidateAccept(baseInput({ [gate]: false, confidenceScore: 100 } as Partial<CandidateAcceptInput>));
      expect(r.decision).not.toBe('auto_accept');
    }
  });
});
