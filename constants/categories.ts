// Known category slugs used for special logic or icon lookups.
// The full category records live in the database (supabase/seed.sql).
// These slugs must match the `slug` column in the `categories` table exactly.
//
// Seed slugs: soft-play, park, cafe, indoor-play, swimming, trampoline,
//             farm, bowling, arts, sports, library, sensory
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
} as const;

export type CategorySlug = typeof CATEGORY_SLUGS[keyof typeof CATEGORY_SLUGS];
