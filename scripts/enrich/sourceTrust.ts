// =============================================================================
// scripts/enrich/sourceTrust.ts
//
// Enrichment 2.0 — Part 2: the canonical source-trust hierarchy. Single source
// of truth so every module (closureSignals.ts's sourceTier, candidateAccept.ts's
// isTrustedSource, the compliance audit) references the SAME tiers instead of
// each re-deriving its own notion of "trusted".
//
// Tier 1 — Official: the venue's own website/domain, or an official operator
//   announcement. Highest trust: this is the venue speaking for itself.
// Tier 2 — Structured open data: OpenStreetMap (ODbL) and Geoapify (which is
//   itself OSM-derived + supplementary open sources). Community/aggregator
//   data, not authoritative, but structured and attributable.
// Tier 3 — Lower-confidence directories: any other open business directory
//   with clear terms permitting this use. Never auto-applied without
//   corroboration; review-only.
//
// EXPLICIT NO-SCRAPE LIST (Part 2, non-negotiable — enforced by NEVER importing
// a client for any of these anywhere in scripts/enrich/**, verified by the
// compliance audit's grep check, not just this comment):
//   - Google Maps / Google Search result pages
//   - TripAdvisor
//   - Any login-gated or CAPTCHA-protected source
//   - Any source disallowed by its own robots.txt for our user agent
// No proxy rotation, no CAPTCHA bypass, no anti-bot circumvention anywhere in
// this codebase — webClient.ts's robots enforcement is structural (single
// non-bypassable code path, no --ignore-robots flag; see WEBSITE_ENRICHMENT_SPEC.md §5).
//
// No I/O, no '@/' path alias.
// =============================================================================

export type SourceTier = 1 | 2 | 3;

export type SourceId = 'official_website' | 'osm' | 'geoapify' | 'operator_announcement';

export const SOURCE_TIERS: Record<SourceId, SourceTier> = {
  official_website: 1,
  operator_announcement: 1,
  osm: 2,
  geoapify: 2,
};

/** Sources this codebase must never scrape/import from — see file header. */
export const NO_SCRAPE_SOURCES = [
  'google_maps',
  'google_search',
  'tripadvisor',
] as const;

export function isTrustedSourceId(source: SourceId): boolean {
  return SOURCE_TIERS[source] <= 2;
}

export function sourceTierOf(source: SourceId): SourceTier {
  return SOURCE_TIERS[source];
}
