// =============================================================================
// scripts/enrich/web/__tests__/closureSignals.test.ts
//
// Tests closure detection (Enrichment 2.0 Part 9). The hard rule under test:
// network failures / 404s / robots denial must NEVER produce a closure
// recommendation — there is no code path in this module that even accepts
// those as input, so these tests assert the escalation ladder instead.
// =============================================================================

import { detectClosureText, assessClosure } from '../closureSignals';

const now = '2026-08-13T00:00:00.000Z';

describe('detectClosureText', () => {
  it('detects an explicit permanent-closure phrase', () => {
    const sig = detectClosureText('Sadly, Willows Farm has permanently closed after 20 years.', {
      sourceUrl: 'https://willowsfarm.co.uk/',
      sourceTier: 1,
      detectedAt: now,
    });
    expect(sig).not.toBeNull();
    expect(sig!.kind).toBe('explicit_official_text');
  });

  it('does NOT match "closed today"', () => {
    const sig = detectClosureText('We are closed today for staff training.', {
      sourceUrl: 'https://example.com/',
      sourceTier: 1,
      detectedAt: now,
    });
    expect(sig).toBeNull();
  });

  it('does NOT match "closed on Mondays"', () => {
    const sig = detectClosureText('Opening hours: closed on Mondays, open Tue-Sun 10-5.', {
      sourceUrl: 'https://example.com/',
      sourceTier: 1,
      detectedAt: now,
    });
    expect(sig).toBeNull();
  });

  it('does NOT match "temporarily closed for refurbishment"', () => {
    const sig = detectClosureText('The soft play area is temporarily closed for refurbishment.', {
      sourceUrl: 'https://example.com/',
      sourceTier: 1,
      detectedAt: now,
    });
    expect(sig).toBeNull();
  });

  it('tags a tier-3 source as third-party evidence, not official', () => {
    const sig = detectClosureText('Readers report this attraction has now closed.', {
      sourceUrl: 'https://some-directory.example/',
      sourceTier: 3,
      detectedAt: now,
    });
    expect(sig!.kind).toBe('explicit_thirdparty_text');
  });

  it('caps the evidence snippet and never returns the whole page', () => {
    const longText = 'x'.repeat(2000) + ' this venue has ceased trading ' + 'y'.repeat(2000);
    const sig = detectClosureText(longText, { sourceUrl: 'https://example.com/', sourceTier: 1, detectedAt: now });
    expect(sig!.evidenceSnippet.length).toBeLessThanOrEqual(512);
  });
});

describe('assessClosure — escalation ladder', () => {
  it('no signals -> active', () => {
    const r = assessClosure([], { isRecheck: false });
    expect(r.recommendedStatus).toBe('active');
  });

  it('a single signal -> suspected_closed, even from a tier-1 source, on a first check', () => {
    const r = assessClosure(
      [{ kind: 'explicit_official_text', sourceUrl: 'https://x.com', evidenceSnippet: 'closed', detectedAt: now, sourceTier: 1 }],
      { isRecheck: false },
    );
    expect(r.recommendedStatus).toBe('suspected_closed');
  });

  it('a single tier-1 signal on a RE-CHECK -> confirmed_closed', () => {
    const r = assessClosure(
      [{ kind: 'explicit_official_text', sourceUrl: 'https://x.com', evidenceSnippet: 'closed', detectedAt: now, sourceTier: 1 }],
      { isRecheck: true },
    );
    expect(r.recommendedStatus).toBe('confirmed_closed');
  });

  it('two tier-3 signals on a re-check -> confirmed_closed (corroborated even without tier-1)', () => {
    const sig = { kind: 'explicit_thirdparty_text' as const, sourceUrl: 'https://x.com', evidenceSnippet: 'closed', detectedAt: now, sourceTier: 3 as const };
    const r = assessClosure([sig, sig], { isRecheck: true });
    expect(r.recommendedStatus).toBe('confirmed_closed');
  });

  it('a single tier-3 signal on a re-check stays suspected (not enough corroboration)', () => {
    const r = assessClosure(
      [{ kind: 'explicit_thirdparty_text', sourceUrl: 'https://x.com', evidenceSnippet: 'closed', detectedAt: now, sourceTier: 3 }],
      { isRecheck: true },
    );
    expect(r.recommendedStatus).toBe('suspected_closed');
  });

  it('always documents that fetch failures/404s/robots-denial are excluded', () => {
    const r = assessClosure([], { isRecheck: false });
    expect(r.ignoredNonSignals.length).toBeGreaterThan(0);
  });
});
