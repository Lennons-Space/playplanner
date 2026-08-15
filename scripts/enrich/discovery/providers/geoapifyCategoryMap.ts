// =============================================================================
// scripts/enrich/discovery/providers/geoapifyCategoryMap.ts
//
// Enrichment 2.1 — Phase D3: Geoapify Places category codes -> PlayPlanner
// category slugs. Verified against Geoapify's own primary API docs
// (apidocs.geoapify.com/docs/places, fetched 2026-08-14 — see
// GEOAPIFY_2_1_COMPLIANCE.md) — NOT guessed. Deliberately a representative
// subset, not the full Geoapify taxonomy: this provider is disabled by
// default (compliance ambiguity, see the compliance doc), so exhaustively
// mapping every category now would be speculative effort for a feature that
// may never run. Extend this table if/when Liam approves enabling the
// provider and wants broader category coverage.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import { DISCOVERY_ALLOWED_SLUGS } from '../categoryTargets';

/** Geoapify category code -> PlayPlanner category slug. Every value is checked against DISCOVERY_ALLOWED_SLUGS below. */
export const GEOAPIFY_CATEGORY_MAP: Record<string, string> = {
  'leisure.playground': 'playground',
  'leisure.park': 'outdoor-sports',
  'leisure.park.garden': 'outdoor-sports',
  'entertainment.zoo': 'animal-attraction',
  'entertainment.aquarium': 'animal-attraction',
  'entertainment.museum': 'museum',
  'entertainment.theme_park': 'theme-park',
  'entertainment.water_park': 'swimming',
  'sport.swimming_pool': 'swimming',
  'sport.sports_centre': 'sports-activity',
  'entertainment.bowling_alley': 'bowling',
  'entertainment.activity_park': 'sports-activity',
  'entertainment.activity_park.climbing': 'sports-activity',
  'entertainment.activity_park.trampoline': 'trampoline',
};

// Fail loudly at import time if a mapping ever points at a slug that doesn't
// actually exist — cheaper to catch here than silently create candidates
// with a category_id that fails its FK at insert time.
for (const [code, slug] of Object.entries(GEOAPIFY_CATEGORY_MAP)) {
  if (!DISCOVERY_ALLOWED_SLUGS.has(slug)) {
    throw new Error(`geoapifyCategoryMap: "${code}" maps to unknown/disallowed slug "${slug}"`);
  }
}

/** Every Geoapify category code this provider will ever request — used to build the `categories` query param. */
export function allMappedGeoapifyCategories(): string[] {
  return Object.keys(GEOAPIFY_CATEGORY_MAP);
}

export function resolveGeoapifyCategorySlug(geoapifyCategories: string[]): string | null {
  for (const c of geoapifyCategories) {
    const slug = GEOAPIFY_CATEGORY_MAP[c];
    if (slug) return slug;
  }
  return null;
}
