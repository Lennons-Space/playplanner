// =============================================================================
// scripts/enrich/discovery/categoryTargets.ts
//
// Enrichment 2.0 — Part 6: the discovery category allowlist.
//
// REUSE, NOT A SECOND STACK (Part 20 / Liam's explicit instruction): the
// production OSM import pipeline (scripts/import/02_transform_osm.js) already
// has a proven, live-data-validated tag -> category-slug mapping
// (`resolveSlug`, exported) used to populate every existing OSM-sourced venue.
// This module WRAPS that exact function as the primary structural signal —
// it does NOT redefine its own competing OSM tag rules. Two independent tag
// mappings would let a newly-discovered venue and an existing enriched venue
// disagree about the same real-world category, which is exactly the kind of
// inconsistency "don't build a second discovery stack" warns against.
//
// KNOWN PRE-EXISTING GAP (not introduced by this build, documented for Liam):
// `resolveSlug` can return 'mini-golf' and 'family-restaurant', but those two
// category slugs were never created in the `categories` table (confirmed: no
// migration inserts them — 05_insert.js's own comments describe this as a
// real, already-happening rejection into venues_no_category.json). This
// module remaps 'mini-golf' -> 'attraction' (Liam's spec explicitly lists mini
// golf as a target) and drops 'family-restaurant' entirely from discovery
// scope (café/restaurant discovery was not one of Liam's ~30 targets — it was
// the original pipeline's broader ambition, not this feature's).
//
// A handful of the ~30 targets have no reliable OSM tag at all in the UK
// (soft play beyond leisure=soft_play/indoor_play, farm PARKS specifically,
// play cafés, science centres, castellated "heritage attraction" wording,
// arcades, mini golf's colloquial names, activity centres) — these fall back
// to a case-insensitive name-hint match, which candidateAccept.ts's
// `isTrustedSource` treats as a WEAKER signal than a structural tag match
// (Part 6: prefer the strongest available signal).
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

// CJS interop: 02_transform_osm.js is a one-time ETL script (not a TS module),
// but explicitly exports resolveSlug for reuse (see its own module.exports).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const importTransform = require('../../import/02_transform_osm.js') as {
  resolveSlug: (tags: Record<string, string | undefined>) => string | null;
};

/** Slugs resolveSlug can return that do NOT exist in the live categories table (documented above). */
const REMAP: Record<string, string | null> = {
  'mini-golf': 'attraction',
  'family-restaurant': null, // out of scope for this discovery pass — see file header
};

/** Every category slug this discovery pass is willing to create a candidate for. */
export const DISCOVERY_ALLOWED_SLUGS = new Set([
  'soft-play', 'trampoline', 'animal-attraction', 'museum', 'attraction',
  'playground', 'outdoor-sports', 'swimming', 'sports-activity', 'bowling',
  'theme-park', 'childcare',
]);

/**
 * Resolve an OSM element's tags to a family-relevant, live category slug using
 * the SAME logic as the production import pipeline. Returns null when the
 * element is not a recognised family-venue type (Part 6: "do not blindly
 * import all POIs").
 */
export function resolveStructuralCategorySlug(tags: Record<string, string | undefined>): string | null {
  const raw = importTransform.resolveSlug(tags);
  if (!raw) return null;
  const remapped = raw in REMAP ? REMAP[raw] : raw;
  if (!remapped || !DISCOVERY_ALLOWED_SLUGS.has(remapped)) return null;
  return remapped;
}

/** One of the ~30 UK family-venue discovery targets from the Enrichment 2.0 spec. */
export interface CategoryTarget {
  targetLabel: string;
  /** The EXISTING PlayPlanner categories.slug this target resolves to. */
  categorySlug: string;
  /** True when this target has no reliable structural OSM tag and relies on name hints. */
  nameHintOnly: boolean;
  /** Case-insensitive substring match against the venue name — see file header. */
  nameHints?: string[];
}

// Documents how each of Liam's ~30 target labels maps to a live category —
// used by the compliance/final report and by matchByNameHint() below.
// Targets with a reliable OSM tag (soft play, trampoline, zoo, aquarium,
// museum, castle/heritage, playground, nature reserve/country park, swimming
// pool/splash park, leisure centre, bowling, mini golf, theme park) are
// resolved structurally via resolveStructuralCategorySlug() above and are
// listed here with nameHintOnly:false purely for the report's coverage table.
export const CATEGORY_TARGETS: CategoryTarget[] = [
  { targetLabel: 'soft play', categorySlug: 'soft-play', nameHintOnly: false },
  { targetLabel: 'indoor play', categorySlug: 'soft-play', nameHintOnly: false },
  { targetLabel: 'trampoline parks', categorySlug: 'trampoline', nameHintOnly: false },
  { targetLabel: 'farms / farm parks', categorySlug: 'animal-attraction', nameHintOnly: true,
    nameHints: ['farm park', "children's farm", 'city farm', 'petting farm', 'open farm'] },
  { targetLabel: 'zoos', categorySlug: 'animal-attraction', nameHintOnly: false },
  { targetLabel: 'aquariums', categorySlug: 'animal-attraction', nameHintOnly: false },
  { targetLabel: 'wildlife attractions', categorySlug: 'animal-attraction', nameHintOnly: true,
    nameHints: ['wildlife park', 'safari park', 'bird park', 'sanctuary'] },
  { targetLabel: 'museums', categorySlug: 'museum', nameHintOnly: false },
  { targetLabel: 'science centres', categorySlug: 'museum', nameHintOnly: true,
    nameHints: ['science centre', 'science center', 'discovery centre'] },
  { targetLabel: 'castles', categorySlug: 'attraction', nameHintOnly: false },
  { targetLabel: 'heritage attractions', categorySlug: 'attraction', nameHintOnly: true,
    nameHints: ['heritage', 'historic house', 'manor'] },
  { targetLabel: 'gardens', categorySlug: 'outdoor-sports', nameHintOnly: true,
    nameHints: ['garden', 'arboretum'] },
  { targetLabel: 'parks', categorySlug: 'outdoor-sports', nameHintOnly: false },
  { targetLabel: 'playgrounds', categorySlug: 'playground', nameHintOnly: false },
  { targetLabel: 'country parks', categorySlug: 'outdoor-sports', nameHintOnly: true,
    nameHints: ['country park'] },
  { targetLabel: 'nature reserves', categorySlug: 'outdoor-sports', nameHintOnly: false },
  { targetLabel: 'beaches', categorySlug: 'outdoor-sports', nameHintOnly: true,
    nameHints: ['beach'] },
  { targetLabel: 'splash parks', categorySlug: 'swimming', nameHintOnly: true,
    nameHints: ['splash park', 'splash pad', 'water play'] },
  { targetLabel: 'swimming pools', categorySlug: 'swimming', nameHintOnly: false },
  { targetLabel: 'leisure centres', categorySlug: 'sports-activity', nameHintOnly: false },
  { targetLabel: 'libraries', categorySlug: 'library', nameHintOnly: true,
    nameHints: ['library'] },
  { targetLabel: 'play cafés', categorySlug: 'cafe', nameHintOnly: true,
    nameHints: ['play cafe', 'play café', "kids' cafe"] },
  { targetLabel: 'pottery / crafts', categorySlug: 'arts', nameHintOnly: true,
    nameHints: ['pottery', 'ceramics', 'craft studio', 'paint your own'] },
  { targetLabel: 'climbing', categorySlug: 'sports-activity', nameHintOnly: true,
    nameHints: ['climbing wall', 'climbing centre'] },
  { targetLabel: 'bowling', categorySlug: 'bowling', nameHintOnly: false },
  { targetLabel: 'mini golf', categorySlug: 'attraction', nameHintOnly: false },
  { targetLabel: 'arcades', categorySlug: 'attraction', nameHintOnly: true,
    nameHints: ['arcade'] },
  { targetLabel: 'family entertainment', categorySlug: 'attraction', nameHintOnly: true,
    nameHints: ['family entertainment', 'fec'] },
  { targetLabel: "children's theatres", categorySlug: 'arts', nameHintOnly: true,
    nameHints: ["children's theatre", 'puppet theatre'] },
  { targetLabel: 'activity centres', categorySlug: 'sports-activity', nameHintOnly: true,
    nameHints: ['activity centre', 'activity center', 'adventure centre'] },
  { targetLabel: 'theme parks', categorySlug: 'theme-park', nameHintOnly: false },
];

export function targetedCategorySlugs(): string[] {
  return Array.from(new Set(CATEGORY_TARGETS.map((t) => t.categorySlug)));
}

export interface NameHintMatch {
  target: CategoryTarget;
}

/**
 * Fallback matcher for targets with no reliable OSM tag. Only called by the
 * discovery pipeline when resolveStructuralCategorySlug() returns null — a
 * structural tag match always wins when one exists (Part 6).
 */
export function matchByNameHint(name: string): NameHintMatch | null {
  const lower = name.toLowerCase();
  for (const target of CATEGORY_TARGETS) {
    if (target.nameHintOnly && target.nameHints?.some((h) => lower.includes(h.toLowerCase()))) {
      return { target };
    }
  }
  return null;
}
