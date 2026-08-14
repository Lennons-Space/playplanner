// =============================================================================
// scripts/enrich/web/closureCheck.ts
//
// Enrichment 2.0 — Part 9 wiring: turns fetched page HTML (captured via
// orchestrate.ts's OrchestratorDeps.captureHtml) into ClosureSignal evidence
// using closureSignals.ts's detectClosureText, without any extra network call
// (the HTML is already sitting in memory from the normal enrichment fetch).
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import { detectClosureText } from './closureSignals';
import { sourceTierOf } from '../sourceTrust';
import type { ClosureSignal } from '../../../types/enrichmentAutonomy';

/** Crude but adequate tag stripper for closure-phrase scanning — mirrors the
 * regex-based approach already used elsewhere in this codebase (e.g.
 * orchestrate.ts's discoverHintLinks) rather than pulling in a DOM parser for
 * a single substring search. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scan every fetched page for closure signals. A venue's own website is
 * always tier 1 (official) per sourceTrust.ts's canonical tier table — this
 * function is only ever called on a venue's own crawled pages (never a
 * third-party directory), so the tier is derived from that single source of
 * truth, not re-declared as a local literal.
 */
export function checkPagesForClosure(htmlByUrl: Record<string, string>, detectedAt: string): ClosureSignal[] {
  const sourceTier = sourceTierOf('official_website');
  const signals: ClosureSignal[] = [];
  for (const [url, html] of Object.entries(htmlByUrl)) {
    const signal = detectClosureText(stripHtmlToText(html), { sourceUrl: url, sourceTier, detectedAt });
    if (signal) signals.push(signal);
  }
  return signals;
}
