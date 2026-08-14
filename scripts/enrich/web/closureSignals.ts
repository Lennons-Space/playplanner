// =============================================================================
// scripts/enrich/web/closureSignals.ts
//
// Enrichment 2.0 — Part 9: closure/stale-data handling.
//
// Detects explicit closure language in fetched page text and turns a set of
// ClosureSignal evidence rows into a recommended venues.operating_status.
//
// HARD RULE (Part 9, non-negotiable): network failures, 404s, temporary
// outages, and robots denial are NEVER closure signals by themselves. This
// module has no code path that can produce a closure recommendation from those
// inputs — callers must not even construct a ClosureSignal for them (there is
// no ClosureSignalKind for "fetch failed"), so it is a structural guarantee,
// not just a convention.
//
// Escalation ladder (never skips a step):
//   0 signals                                   -> active (no change)
//   1 signal, any tier                           -> suspected_closed
//   >=2 signals OR >=1 tier-1 (official) signal
//     AND the assessment run is a RE-CHECK        -> confirmed_closed
//     (a single crawl, even from the venue's own official site, is only
//      "suspected" until a second independent check — later in time or a
//      different source — corroborates it; see Part 9's high-risk framing)
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type { ClosureAssessment, ClosureSignal } from '../../../types/enrichmentAutonomy';

// Explicit closure phrases. Deliberately narrow — "closed today", "closed on
// Mondays", "temporarily closed for refurbishment" must NOT match (those are
// normal opening-hours/seasonal facts, not closure signals).
const CLOSURE_PHRASE_RE =
  /\b(permanently closed|has now closed|we have closed|this (?:venue|attraction|site) (?:is|has) closed(?: down)?|ceased trading|no longer (?:open|trading)|closed (?:down )?permanently|now closed for good)\b/i;

// Phrases that LOOK like closure but are explicitly excluded — checked first
// so they can never be misclassified even if a broader phrase would also match.
const EXCLUDED_RE =
  /\b(closed today|closed on \w+days?|temporarily closed|closed for (?:refurbishment|renovation|maintenance|the season|winter)|closed until|closed early)\b/i;

/**
 * Scan a page's visible text for explicit closure language. Returns at most
 * one signal per call (the first genuine match) — callers accumulate across
 * pages/runs by calling this per page and collecting non-null results.
 */
export function detectClosureText(
  text: string,
  opts: { sourceUrl: string; sourceTier: 1 | 2 | 3; detectedAt: string },
): ClosureSignal | null {
  if (EXCLUDED_RE.test(text)) {
    // If the ONLY match is an excluded phrase, do not also fire on a broader
    // pattern elsewhere unless it is a distinct, genuine closure sentence.
    const withoutExcluded = text.replace(EXCLUDED_RE, ' ');
    if (!CLOSURE_PHRASE_RE.test(withoutExcluded)) return null;
  }
  const match = CLOSURE_PHRASE_RE.exec(text);
  if (!match) return null;

  const start = Math.max(0, match.index - 60);
  const end = Math.min(text.length, match.index + match[0].length + 60);
  const snippet = text.slice(start, end).trim().slice(0, 512);

  return {
    kind: opts.sourceTier === 1 ? 'explicit_official_text' : 'explicit_thirdparty_text',
    sourceUrl: opts.sourceUrl,
    evidenceSnippet: snippet,
    detectedAt: opts.detectedAt,
    sourceTier: opts.sourceTier,
  };
}

export interface AssessClosureOptions {
  /** True when this assessment includes at least one signal from a check strictly after the first one recorded for this venue. */
  isRecheck: boolean;
}

export function assessClosure(
  signals: ClosureSignal[],
  opts: AssessClosureOptions,
): ClosureAssessment {
  const tier1Count = signals.filter((s) => s.sourceTier === 1).length;
  const ignoredNonSignals = [
    'network/fetch failure alone is never a closure signal',
    '404 response alone is never a closure signal',
    'robots.txt denial alone is never a closure signal',
  ];

  if (signals.length === 0) {
    return {
      recommendedStatus: 'active',
      signalCount: 0,
      tier1SignalCount: 0,
      reason: 'no closure signals detected',
      ignoredNonSignals,
    };
  }

  const strongEvidence = signals.length >= 2 || tier1Count >= 1;
  if (strongEvidence && opts.isRecheck) {
    return {
      recommendedStatus: 'confirmed_closed',
      signalCount: signals.length,
      tier1SignalCount: tier1Count,
      reason: `${signals.length} signal(s) (${tier1Count} tier-1) corroborated on a re-check`,
      ignoredNonSignals,
    };
  }

  return {
    recommendedStatus: 'suspected_closed',
    signalCount: signals.length,
    tier1SignalCount: tier1Count,
    reason: strongEvidence
      ? `${signals.length} signal(s) (${tier1Count} tier-1) — awaiting a corroborating re-check before confirming`
      : `${signals.length} signal(s), none tier-1 yet — needs corroboration`,
    ignoredNonSignals,
  };
}
