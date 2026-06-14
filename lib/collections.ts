// ─────────────────────────────────────────────────────────────────────────
// Discover collections — the editorial "ideas for every kind of day" set.
//
// Each collection is a pure definition: presentation (emoji / title / tagline /
// gradient / representative category pills) + a `match(venue)` predicate that
// decides, from REAL venue data, whether a venue belongs. There is no
// fabricated content here — the predicates and the pills lean on the same
// trustworthy derivations the rest of the app uses (lib/venueAttributes + the
// real category slugs), so a collection only ever surfaces venues that
// genuinely qualify, and only ever shows pills for categories it really holds.
//
// Trust rules (inherited from venueAttributes):
//   - null = unknown → a venue is NEVER matched on a null attribute.
//   - Free means price_range === 'free' only (never assumed from missing data).
//   - Rainy-day means a known INDOOR category only.
//
// MVP: exactly three collections are shown on Discover (DISCOVER_COLLECTIONS),
// plus the "Seasonal Picks" hero (getSeasonalCollection — driven by the existing
// getSeasonalTheme). The hero reuses the same reusable collection page
// (app/discover/[collection].tsx) via the stable 'seasonal' key with a real
// predicate — it is NOT a new screen and NOT a placeholder.
// ─────────────────────────────────────────────────────────────────────────

import { getVenueAttributes } from '@/lib/venueAttributes';
import { getSeasonalTheme } from '@/lib/seasonalPicks';
import type { Venue } from '@/types';

export interface CollectionDef {
  /** Stable url key (the [collection] route param). */
  key: string;
  emoji: string;
  title: string;
  /** One-line editorial tagline shown on the card + collection hero. */
  tagline: string;
  /** Premium light gradient (readable with dark ink text). */
  gradient: readonly [string, string, ...string[]];
  /** Accent used for small UI bits on the collection page + illustration stroke. */
  accent: string;
  /**
   * Presentation-agnostic key naming the card's decorative line-art (resolved by
   * components/discover/illustrations/CollectionIllustration). Kept as a plain
   * string so no React component leaks into this data module.
   */
  illustrationKey: string;
  /**
   * REAL category slugs this collection genuinely contains — rendered as the
   * card's pills via getCategoryMeta (real labels only). Empty = no pills
   * (e.g. a price-based collection has no inherent category to show honestly).
   */
  pillSlugs: readonly string[];
  /** REAL-DATA predicate — decides membership. Never fabricates. */
  match: (venue: Venue) => boolean;
}

// High-energy categories: places designed to wear children out. Real seed slugs
// only (see constants/categories). Cafe/park/farm/library are deliberately
// excluded — they are not reliably "burn energy".
const BURN_ENERGY_SLUGS = new Set<string>([
  'trampoline',
  'soft-play',
  'indoor-play',
  'swimming',
  'outdoor-sports',
]);

// Outdoorsy / nature categories for Hidden Gems. We have no "garden" or "nature
// reserve" category in the seed, so we use the real outdoor slugs we do have.
const HIDDEN_GEM_SLUGS = new Set<string>(['park', 'farm', 'outdoor-sports']);

// "Quiet" threshold for Hidden Gems — genuinely low/no reviews. This is a real
// signal (few reviews), never fabricated popularity, and we never invent a
// rating for these venues.
const HIDDEN_GEM_MAX_REVIEWS = 5;

const COLLECTION_MAP = {
  'burn-energy': {
    key: 'burn-energy',
    emoji: '🔥',
    title: 'Burn Energy',
    tagline: 'Wear them right out.',
    // Peach → coral (muted, magazine-soft — desaturated off the neon coral).
    gradient: ['#FBE3D6', '#F2C6B5', '#E8A795'] as const,
    accent: '#E0602E',
    illustrationKey: 'burn-energy',
    // Real members only (parks are intentionally NOT a burn-energy category).
    pillSlugs: ['soft-play', 'swimming', 'trampoline'],
    match: (v: Venue) => {
      const slug = v.category?.slug;
      return slug != null && BURN_ENERGY_SLUGS.has(slug);
    },
  },
  'rainy-day': {
    key: 'rainy-day',
    emoji: '☔',
    title: 'Rainy Day',
    tagline: 'Indoor adventures for gloomy weather.',
    // Powder blue → lavender (muted, magazine-soft).
    gradient: ['#DFE9F5', '#DADFEF', '#DCD5EB'] as const,
    accent: '#3F6FC4',
    illustrationKey: 'rainy-day',
    // Real indoor members (we have no "museums" category in the seed).
    pillSlugs: ['soft-play', 'bowling', 'indoor-play'],
    // isRainyDaySuitable is true only for known INDOOR categories; null/false excluded.
    match: (v: Venue) => getVenueAttributes(v).isRainyDaySuitable === true,
  },
  'free-days-out': {
    key: 'free-days-out',
    emoji: '💷',
    title: 'Free Days Out',
    tagline: 'Brilliant days that cost nothing.',
    // Mint → sage (muted, magazine-soft — desaturated off the bright mint).
    gradient: ['#DDEDE2', '#C8DECF', '#B7D0BB'] as const,
    accent: '#2E9E5F',
    illustrationKey: 'free-days-out',
    // Price-based collection spans every category — listing specific ones would
    // assert prices we don't know. So: no pills (honest > decorative).
    pillSlugs: [],
    // isFree is true only when price_range === 'free'; null (unknown) excluded.
    match: (v: Venue) => getVenueAttributes(v).isFree === true,
  },
  'hidden-gems': {
    key: 'hidden-gems',
    emoji: '🌳',
    title: 'Hidden Gems',
    tagline: 'Quiet places worth discovering.',
    // Soft sage — calm/natural, distinct from Free's mint (muted further).
    gradient: ['#E4EEE9', '#D3E0DA', '#C3D6CC'] as const,
    accent: '#4E8A77',
    illustrationKey: 'hidden-gems',
    pillSlugs: ['park', 'farm', 'outdoor-sports'],
    // Outdoorsy/nature category AND genuinely quiet (few/no reviews). Honest
    // "hidden" signal — never fabricated popularity, never an invented rating.
    match: (v: Venue) => {
      const slug = v.category?.slug;
      if (slug == null || !HIDDEN_GEM_SLUGS.has(slug)) return false;
      return (v.review_count ?? 0) <= HIDDEN_GEM_MAX_REVIEWS;
    },
  },
} satisfies Record<string, CollectionDef>;

export type CollectionKey = keyof typeof COLLECTION_MAP;

export const COLLECTIONS: Record<CollectionKey, CollectionDef> = COLLECTION_MAP;

/** Ordered keys shown in the Discover "Collections" mosaic (row-major, 2 cols). */
export const DISCOVER_COLLECTIONS: readonly CollectionKey[] = [
  'burn-energy',
  'rainy-day',
  'free-days-out',
  'hidden-gems',
];

// ── Seasonal Picks (the Discover hero) ─────────────────────────────────────
// The hero rotates with the season using the EXISTING getSeasonalTheme() logic
// (no new logic, no data-source change) — the same concept that used to live on
// Home. It is exposed as one stable route key ('seasonal') so the reusable
// collection page resolves it year-round without per-season routes/collections.

// Premium light gradient per season id (readable with dark ink). Keys mirror
// getSeasonalTheme()'s theme ids.
const SEASONAL_GRADIENT: Record<string, readonly [string, string, ...string[]]> = {
  christmas: ['#F4E2DA', '#E8C7C2', '#D7B6C2'], // soft festive rose/evergreen
  winter:    ['#E4EDFB', '#D6E0F6', '#D2D8F1'], // cool frost
  spring:    ['#FDE4EF', '#F1DCEC', '#DEE8CF'], // blossom
  easter:    ['#FCEFD6', '#F2E8D0', '#E2EFCF'], // pastel
  summer:    ['#FFE9C2', '#FFD594', '#FCC56E'], // sunshine
  autumn:    ['#FCE4C6', '#F6CB9C', '#E9AF88'], // amber
};

const SEASONAL_ACCENT: Record<string, string> = {
  christmas: '#B8525E',
  winter:    '#3F6FC4',
  spring:    '#C56C9A',
  easter:    '#C79A3D',
  summer:    '#D98A23',
  autumn:    '#C77A3E',
};

// Season id → decorative illustration key (see CollectionIllustration). Summer
// is the bespoke sun·cloud·kite cover; other seasons fall back to leaf/snow.
const SEASONAL_ILLUSTRATION: Record<string, string> = {
  summer:    'summer',
  spring:    'leaf',
  easter:    'leaf',
  autumn:    'leaf',
  winter:    'snow',
  christmas: 'snow',
};

/**
 * Build the current "Seasonal Picks" collection from getSeasonalTheme().
 * Display (emoji/title/subtitle) + the real category slugs come straight from
 * the season theme; gradient/accent are presentation only. The predicate matches
 * venues whose real category slug belongs to the season — never fabricated.
 */
export function getSeasonalCollection(date: Date = new Date()): CollectionDef {
  const theme = getSeasonalTheme(date);
  const slugs = new Set<string>(theme.slugs);
  return {
    key: 'seasonal',
    emoji: theme.emoji,
    title: theme.title,
    tagline: theme.subtitle,
    gradient: SEASONAL_GRADIENT[theme.id] ?? SEASONAL_GRADIENT.summer,
    accent: SEASONAL_ACCENT[theme.id] ?? '#D98A23',
    illustrationKey: SEASONAL_ILLUSTRATION[theme.id] ?? 'summer',
    pillSlugs: theme.slugs.slice(0, 3),
    match: (v: Venue) => {
      const slug = v.category?.slug;
      return slug != null && slugs.has(slug);
    },
  };
}

/** Resolve a raw route param to a live collection, or null if unknown. */
export function getCollection(key: string | undefined): CollectionDef | null {
  if (!key) return null;
  if (key === 'seasonal') return getSeasonalCollection();
  return (COLLECTIONS as Record<string, CollectionDef>)[key] ?? null;
}
