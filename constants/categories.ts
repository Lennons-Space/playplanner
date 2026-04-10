// Known category slugs used for special logic or icon lookups.
// The full category records live in the database (supabase/seed.sql).
// These slugs must match the `slug` column in the `categories` table exactly.
export const CATEGORY_SLUGS = {
  SOFT_PLAY:    'soft-play',
  PARK:         'park',
  PLAYGROUND:   'playground',
  FAMILY_CAFE:  'family-cafe',
  SWIMMING:     'swimming',
  FARM:         'farm',
  MUSEUM:       'museum',
  CINEMA:       'cinema',
  BOWLING:      'bowling',
  ARTS_CRAFTS:  'arts-and-crafts',
  SPORTS_CENTRE:'sports-centre',
  THEATRE:      'theatre',
} as const;

export type CategorySlug = typeof CATEGORY_SLUGS[keyof typeof CATEGORY_SLUGS];
