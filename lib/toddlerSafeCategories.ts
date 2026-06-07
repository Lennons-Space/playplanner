// =============================================================================
// lib/toddlerSafeCategories.ts
//
// Single source of truth for "is this venue category confirmed safe for
// toddlers (ages 0-2) by venue TYPE?" Currently consumed by the enrichment
// intelligence engine to decide the 'toddler_friendly' recommended_for tag.
//
// IMPORTANT: Do NOT import from '@/' path aliases here, and do not import
// anything with React Native / Expo dependencies. This file is imported by
// scripts/enrich/intelligence.ts, which runs outside the Expo app bundle
// (via tsx), where the '@/' alias is not configured. Relative imports and
// plain TypeScript only.
//
// Why this exists: venues.min_age defaults to 0 in the database (migration
// 001), so a venue that was never assessed for age-suitability looks
// identical to one confirmed to welcome babies from birth. min_age alone
// cannot be trusted as evidence of toddler-friendliness — the category is
// the only reliable signal of venue TYPE. A 2026-06 audit found ~19,261
// approved venues (41% of the catalogue) carry min_age=0 paired with generic
// OSM-import max_age buckets (12/16/18) — e.g. 9,682 'attraction' venues at
// 0/18 — none of which represent confirmed toddler suitability.
// =============================================================================

/**
 * Category slugs confirmed safe for toddlers by venue TYPE — the kind of
 * place is inherently appropriate for very young children, regardless of
 * whether the venue's age-range fields were ever populated with real data.
 *
 * Deliberately conservative: categories such as 'attraction', 'museum',
 * 'theme-park', 'sports-centre', and 'childcare' are excluded on purpose —
 * they vary too widely (height/age restrictions, hands-on vs. look-don't-touch
 * exhibits, purpose) to assume toddler-suitability from category alone.
 * Expand this set only with stronger evidence (e.g. confirmed facility data
 * from Geoapify/Wikidata enrichment), not by guesswork.
 */
export const TODDLER_SAFE_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  'soft-play',
  'playground',
  'farm',
  'library',
  'swimming',
  'animal-attraction',
  'park',
]);
