// =============================================================================
// scripts/enrich/web/orchestrate.ts
//
// Testable orchestration core (spec §15, build step 4). ALL I/O is injected so
// tests run fully offline — no network, no DB.
//
// Exports:
//   selectBestCandidates  — pure: collapse to one-best per field (method rank)
//   discoverHintLinks     — pure: same-domain hint-path links from a landing page
//   orchestrateVenue      — async, I/O-injected: fetch + extract + propose one venue
//   runEnrichment         — async: map venues → RunReport
//
// Types VenueRunResult / RunReport / OrchestratorDeps are defined here (not in
// types/webEnrichment.ts) because they belong to the orchestration layer. All
// imports are relative — no '@/' path alias (runs under tsx/jest in Node).
// =============================================================================

import type {
  CurrentVenueSnapshot,
  FieldCandidate,
  PageFetch,
  ProposalDraft,
  WebFetchResult,
} from '../../../types/webEnrichment';
import { extractCandidates } from './htmlExtract';
import { isMeaningfulDescription } from './fields';
import { buildProposals } from './proposals';
import { isSafeUrl, sameRegistrableDomain } from './urlSafety';

// ── Method-rank table (jsonld > microdata > meta > heuristic) ─────────────────

const METHOD_RANK: Record<string, number> = {
  jsonld: 0,
  microdata: 1,
  meta: 2,
  heuristic: 3,
};

// ── Hint paths (spec §5) ──────────────────────────────────────────────────────

const HINT_PATH_RE =
  /^\/(opening|opening-times|hours|prices|admission|tickets|contact|visit|plan-your-visit)(\/|$|\?|#)/i;

const MAX_HINT_LINKS = 2;

// ── Result types ──────────────────────────────────────────────────────────────

export type VenueOutcome =
  | 'extracted'
  | 'skipped_no_website'
  | 'skipped_invalid_url'
  | 'skipped_robots'
  | 'skipped_redirect_offdomain'
  | 'skipped_non_html'
  | 'skipped_too_large'
  | 'skipped_bot_protected'
  | 'fetch_failed';

export interface VenueInput {
  venueId: string;
  name: string;
  website: string | null;
}

export interface VenueRunResult {
  venueId: string;
  name: string;
  website: string | null;
  outcome: VenueOutcome;
  pages: PageFetch[];
  note?: string;
  proposals: ProposalDraft[];
}

export interface RunSummary {
  venuesProcessed: number;
  byOutcome: Partial<Record<VenueOutcome, number>>;
  totalProposals: number;
  proposalsByConfidence: { high: number; medium: number; low: number };
}

export interface RunReport {
  runLabel: string;
  generatedAt: string;
  venues: VenueRunResult[];
  summary: RunSummary;
}

// ── Injected deps for orchestrateVenue ───────────────────────────────────────

export interface OrchestratorDeps {
  /** Fetch a single URL — same signature as WebClient.fetch. Never throws. */
  fetchPage: (url: string) => Promise<WebFetchResult>;
  /** ISO8601 timestamp injected for determinism (allows mocking in tests). */
  retrievedAt: string;
  /** Total pages per venue (landing + hints). Default: 3. */
  maxPages?: number;
}

// ── Pure: selectBestCandidates ────────────────────────────────────────────────

/**
 * Collapse a list of FieldCandidates to one per field, choosing the candidate
 * with the lowest method rank (jsonld=0 wins). Ties are broken by first occurrence.
 * This is the "first hit wins per field" rule from spec §6a.
 */
export function selectBestCandidates(candidates: FieldCandidate[]): FieldCandidate[] {
  const best = new Map<string, { rank: number; idx: number; candidate: FieldCandidate }>();

  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx]!;
    const rank = METHOD_RANK[c.method] ?? 99;
    const existing = best.get(c.field);
    // Take this candidate if: no existing, OR strictly better method rank.
    // First occurrence wins among equal ranks (idx comparison).
    if (!existing || rank < existing.rank || (rank === existing.rank && idx < existing.idx)) {
      best.set(c.field, { rank, idx, candidate: c });
    }
  }

  return Array.from(best.values()).map((e) => e.candidate);
}

// ── Pure: discoverHintLinks ───────────────────────────────────────────────────

/**
 * Parse <a href="…"> links from HTML, keep those that:
 *   1. Are absolute http(s) (pass isSafeUrl)
 *   2. Share the registrable domain with baseUrl
 *   3. Have a path matching the §5 hint set
 * Returns deduplicated URLs, capped at MAX_HINT_LINKS (2).
 */
export function discoverHintLinks(html: string, baseUrl: string): string[] {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    return [];
  }

  // Extract all href values from <a> tags. Regex-based (no DOM dep, like htmlExtract.ts).
  const hrefRe = /<a\b[^>]*?\shref=["']([^"']+)["'][^>]*>/gi;
  const seen = new Set<string>();
  const results: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null && results.length < MAX_HINT_LINKS) {
    const raw = (match[1] ?? '').trim();
    // Resolve relative URLs against base
    let absUrl: string;
    try {
      absUrl = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }

    // Must pass SSRF guard
    if (!isSafeUrl(absUrl).safe) continue;

    // Must share registrable domain
    let linkHost: string;
    try {
      linkHost = new URL(absUrl).hostname;
    } catch {
      continue;
    }
    if (!sameRegistrableDomain(baseHost, linkHost)) continue;

    // Path must match hint set
    let linkPath: string;
    try {
      linkPath = new URL(absUrl).pathname;
    } catch {
      continue;
    }
    if (!HINT_PATH_RE.test(linkPath)) continue;

    // Deduplicate by normalised URL (drop trailing slash for dedup)
    const dedupeKey = absUrl.replace(/\/+$/, '').toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push(absUrl);
  }

  return results;
}

// ── Async: orchestrateVenue ───────────────────────────────────────────────────

/**
 * Orchestrate the full fetch+extract+propose cycle for one venue.
 * NEVER throws — all errors become typed outcome values.
 */
export async function orchestrateVenue(
  venue: VenueInput,
  snapshot: CurrentVenueSnapshot,
  deps: OrchestratorDeps,
): Promise<VenueRunResult> {
  const maxPages = deps.maxPages ?? 3;
  const { fetchPage, retrievedAt } = deps;

  // Guard: no website stored
  if (!venue.website) {
    return {
      venueId: venue.venueId,
      name: venue.name,
      website: null,
      outcome: 'skipped_no_website',
      pages: [],
      proposals: [],
    };
  }

  const allPages: PageFetch[] = [];
  let allCandidates: FieldCandidate[] = [];

  // ── Step 1: fetch landing page ────────────────────────────────────────────

  let landingResult: WebFetchResult;
  try {
    landingResult = await fetchPage(venue.website);
  } catch (err) {
    // fetchPage should never throw by contract, but guard defensively
    return {
      venueId: venue.venueId,
      name: venue.name,
      website: venue.website,
      outcome: 'fetch_failed',
      pages: [],
      note: err instanceof Error ? err.message : String(err),
      proposals: [],
    };
  }

  if (landingResult.kind !== 'ok') {
    return {
      venueId: venue.venueId,
      name: venue.name,
      website: venue.website,
      outcome: landingResult.kind as VenueOutcome,
      pages: [],
      note: landingResult.note,
      proposals: [],
    };
  }

  const landingPage = landingResult.page;
  allPages.push(landingPage.page);

  // Extract candidates from landing page
  const landingExtracted = extractCandidates(landingPage.html, landingPage.finalUrl);
  allCandidates = allCandidates.concat(landingExtracted.candidates);

  // ── Step 2: discover and fetch hint pages ─────────────────────────────────

  if (maxPages > 1) {
    const hintUrls = discoverHintLinks(landingPage.html, landingPage.finalUrl);
    const remainingSlots = maxPages - 1; // landing used 1 slot
    const toFetch = hintUrls.slice(0, remainingSlots);

    for (const hintUrl of toFetch) {
      // A per-page failure does NOT abort the venue — just skip that page
      try {
        const hintResult = await fetchPage(hintUrl);
        if (hintResult.kind === 'ok') {
          const hintPage = hintResult.page;
          allPages.push(hintPage.page);
          const hintExtracted = extractCandidates(hintPage.html, hintPage.finalUrl);
          allCandidates = allCandidates.concat(hintExtracted.candidates);
        }
        // Skip outcomes for hint pages are silently ignored (not merged into allPages
        // since there's no PageFetch for a skipped fetch)
      } catch {
        // Defensive — fetchPage should never throw, but guard anyway
      }
    }
  }

  // ── Step 3: select best candidates and build proposals ────────────────────

  // FIX 4: filter out description candidates that are just the venue name
  // (or a trivial variation of it) before ranking/dedup. This prevents
  // proposals like "Little People at The Limes" (= the venue name) from
  // reaching the reviewer. Genuine multi-sentence descriptions pass through.
  const filteredCandidates = allCandidates.filter((c) => {
    if (c.field !== 'description') return true;
    return isMeaningfulDescription(String(c.value), venue.name);
  });

  const bestCandidates = selectBestCandidates(filteredCandidates);
  const proposals = buildProposals(bestCandidates, snapshot, { retrievedAt });

  return {
    venueId: venue.venueId,
    name: venue.name,
    website: venue.website,
    outcome: 'extracted',
    pages: allPages,
    proposals,
  };
}

// ── Async: runEnrichment ──────────────────────────────────────────────────────

export interface RunEnrichmentDeps {
  /** Fetch a single URL. Never throws. */
  fetchPage: (url: string) => Promise<WebFetchResult>;
  /** ISO8601 timestamp injected for the run. */
  retrievedAt: string;
  /** Total pages per venue. Default: 3. */
  maxPages?: number;
  /** Provide a CurrentVenueSnapshot for a given venueId. */
  snapshotProvider: (venueId: string) => Promise<CurrentVenueSnapshot>;
}

/**
 * Map a list of venues through orchestrateVenue and assemble a RunReport.
 * All errors in individual venues produce a typed outcome — never throws.
 */
export async function runEnrichment(
  venues: VenueInput[],
  deps: RunEnrichmentDeps,
  runLabel: string,
): Promise<RunReport> {
  const results: VenueRunResult[] = [];

  for (const venue of venues) {
    let snapshot: CurrentVenueSnapshot;
    try {
      snapshot = await deps.snapshotProvider(venue.venueId);
    } catch {
      // If snapshot fetch fails treat as empty — still attempt extraction
      snapshot = {
        description: null,
        price_range: null,
        website: null,
        phone: null,
        email: null,
        opening_hours: [],
      };
    }

    const result = await orchestrateVenue(venue, snapshot, {
      fetchPage: deps.fetchPage,
      retrievedAt: deps.retrievedAt,
      maxPages: deps.maxPages,
    });
    results.push(result);
  }

  const summary = buildSummary(results);

  return {
    runLabel,
    generatedAt: deps.retrievedAt,
    venues: results,
    summary,
  };
}

// ── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(results: VenueRunResult[]): RunSummary {
  const byOutcome: Partial<Record<VenueOutcome, number>> = {};
  let totalProposals = 0;
  const proposalsByConfidence = { high: 0, medium: 0, low: 0 };

  for (const r of results) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    totalProposals += r.proposals.length;
    for (const p of r.proposals) {
      proposalsByConfidence[p.confidence] = (proposalsByConfidence[p.confidence] ?? 0) + 1;
    }
  }

  return {
    venuesProcessed: results.length,
    byOutcome,
    totalProposals,
    proposalsByConfidence,
  };
}
