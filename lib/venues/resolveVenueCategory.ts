// resolveVenueCategory — single, safe way to turn whatever the data layer
// hands us into ONE category object for display.
//
// WHY THIS EXISTS
// The app has two venue data paths with DIFFERENT category shapes:
//   • useVenue / useVenueSearch → PostgREST join `category:categories(...)`
//     → a nested `category` object (or, for some join shapes, a 1-element
//     array).  This is why Venue Detail shows "Park & Playground".
//   • get_nearby_venues RPC (the Map / nearby list) → returns a FLAT
//     `category_id uuid` ONLY — no name/slug/colour/icon and no nested
//     object.  Reading `venue.category?.name` there is always undefined,
//     which is exactly why Map cards fell back to the generic "VENUE".
//
// Rather than scatter unsafe optional chains, every Map surface resolves the
// category through this one pure function.  When only a `category_id` is
// present it is looked up in the categories table (fetched once via
// useCategories()).  We NEVER fabricate a category: if there is genuinely no
// category and no matching id, we return null and callers show "Venue".

import type { Category, Venue } from '@/types';

/** Minimal shape we accept from the categories lookup (useCategories rows). */
export type CategoryLike = {
  id: string;
  name: string;
  slug?: string | null;
  icon?: string | null;
  color?: string | null;
};

function normalise(c: CategoryLike): Category {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug ?? '',
    icon: c.icon ?? '',
    color: c.color ?? '',
  };
}

/**
 * Resolve a venue's category to a single object, or null when the venue
 * genuinely has no category.
 *
 * Accepts, in priority order:
 *   1. an already-joined nested `category` object,
 *   2. a PostgREST array-join shape (`category: [ {...} ]`),
 *   3. a flat `category_id` looked up in `categoryById`.
 */
export function resolveVenueCategory(
  venue: Pick<Venue, 'category' | 'category_id'>,
  categoryById?: ReadonlyMap<string, CategoryLike>,
): Category | null {
  const raw = venue.category as unknown;

  // 1 + 2: nested object or [object] from a join.
  const joined = Array.isArray(raw) ? raw[0] : raw;
  if (
    joined &&
    typeof joined === 'object' &&
    typeof (joined as { id?: unknown }).id === 'string' &&
    typeof (joined as { name?: unknown }).name === 'string'
  ) {
    return normalise(joined as CategoryLike);
  }

  // 3: flat category_id → lookup.
  if (venue.category_id && categoryById) {
    const found = categoryById.get(venue.category_id);
    if (found) return normalise(found);
  }

  return null;
}

/** Build an id→category lookup from a useCategories() result. */
export function buildCategoryLookup(
  categories: readonly CategoryLike[] | undefined | null,
): Map<string, CategoryLike> {
  const map = new Map<string, CategoryLike>();
  for (const c of categories ?? []) {
    if (c && typeof c.id === 'string') map.set(c.id, c);
  }
  return map;
}
