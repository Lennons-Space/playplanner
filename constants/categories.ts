// Known category slugs used for special logic or icon lookups.
// The full category records live in the database (supabase/seed.sql).
// These slugs must match the `slug` column in the `categories` table exactly.
//
// Seed slugs: soft-play, park, cafe, indoor-play, swimming, trampoline,
//             farm, bowling, arts, sports, library, sensory, outdoor-sports
export const CATEGORY_SLUGS = {
  SOFT_PLAY:    'soft-play',
  PARK:         'park',
  CAFE:         'cafe',
  INDOOR_PLAY:  'indoor-play',
  SWIMMING:     'swimming',
  TRAMPOLINE:   'trampoline',
  FARM:         'farm',
  BOWLING:      'bowling',
  ARTS:         'arts',
  SPORTS:       'sports',
  LIBRARY:      'library',
  SENSORY:      'sensory',
  OUTDOOR_SPORTS: 'outdoor-sports',
} as const;

export type CategorySlug = typeof CATEGORY_SLUGS[keyof typeof CATEGORY_SLUGS];

// ─────────────────────────────────────────────────────────────────
// Phase 1 redesign — category metadata map
// Colour/icon values mirror tokens.jsx CATEGORIES exactly.
// Used by CategoryPlaceholder, VenueCard, VenueMini, and Chip.
// ─────────────────────────────────────────────────────────────────

export interface CategoryMeta {
  /** Human-readable display label. */
  label: string;
  /** Primary category colour (pill text, icon). */
  color: string;
  /** Soft pastel tint (pill background, placeholder background). */
  soft: string;
  /** Icon name resolved by CategoryPlaceholder to an Icon.tsx glyph. */
  icon: string;
}

export const CATEGORIES: Record<CategorySlug, CategoryMeta> = {
  // Icons are chosen from the set available in Icon.tsx.
  // Where the design file used a non-existent glyph (e.g. 'tree', 'cup'),
  // we substitute the closest available icon and add a comment.
  'soft-play':   { label: 'Soft play',    color: '#FF8A7A', soft: '#FFE2DE', icon: 'stroller'  }, // stroller ≈ play area
  'park':        { label: 'Park',         color: '#5BC08A', soft: '#DCF4E4', icon: 'leaf'      }, // leaf ≈ nature/tree
  'cafe':        { label: 'Café',         color: '#D08B5B', soft: '#F7E5D3', icon: 'info'      }, // info as neutral fallback; no 'cup' icon
  'indoor-play': { label: 'Indoor play',  color: '#8E6BD8', soft: '#ECE1FF', icon: 'sparkle'   }, // sparkle ≈ fun/magic
  'swimming':    { label: 'Swimming',     color: '#5BA6E8', soft: '#DCEBFA', icon: 'locate'    }, // locate (circle + crosshair) ≈ pool target
  'trampoline':  { label: 'Trampoline',   color: '#E85B9E', soft: '#FBDCE9', icon: 'flame'     }, // flame ≈ energy/bounce
  'farm':        { label: 'Farm',         color: '#B5985B', soft: '#EFE6CC', icon: 'leaf'      }, // leaf ≈ nature
  'bowling':     { label: 'Bowling',      color: '#5B7AE8', soft: '#DCE2FA', icon: 'pin'       }, // pin = map pin, closest to bowling pin
  'arts':        { label: 'Arts',         color: '#E8B55B', soft: '#FBEBCC', icon: 'wand'      }, // wand ≈ creative
  'sports':      { label: 'Sports',       color: '#2FB8B0', soft: '#D4F0EE', icon: 'walk'      }, // walk ≈ active
  'library':     { label: 'Library',      color: '#8494A8', soft: '#E2E7EE', icon: 'bookmark'  }, // bookmark ≈ books
  'sensory':     { label: 'Sensory',      color: '#B85BE8', soft: '#EFD9FA', icon: 'sparkle'   }, // sparkle ≈ sensation
  'outdoor-sports': { label: 'Outdoor sports', color: '#3E9F6B', soft: '#D6F0E3', icon: 'walk' }, // walk ≈ active/outdoor
} as const;

/** Safe fallback when slug is null/unknown (e.g. new DB category not yet mapped). */
export const CATEGORY_FALLBACK: CategoryMeta = {
  label: 'Activity',
  color: '#2FB8B0',
  soft:  '#D4F0EE',
  icon:  'map',
};

/** Resolve a raw slug string to CategoryMeta, falling back gracefully. */
export function getCategoryMeta(slug: string | null | undefined): CategoryMeta {
  if (!slug) return CATEGORY_FALLBACK;
  return CATEGORIES[slug as CategorySlug] ?? CATEGORY_FALLBACK;
}
