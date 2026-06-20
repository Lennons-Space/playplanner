// ─────────────────────────────────────────────────────────────────────────
// homeIntents.ts — the Browse (Home) "What do you need today?" intent + age
// filtering logic, mapped onto REAL venue data.
//
// The Play Planner v2 design's mock venues carried bespoke `intents`,
// `ageGroups` and `reasons` arrays. Real venues don't have those, so we derive
// membership from trustworthy real attributes (lib/venueAttributes + real
// category slugs + price_range + min/max age + facilities). Nothing is
// fabricated: an intent only matches when the underlying real data supports it.
// Where possible we reuse the SAME tested predicates the Discover collections
// use (lib/collections), so Home and Discover stay consistent.
//
// Pure module (no React) so it can be unit tested without a render context.
// ─────────────────────────────────────────────────────────────────────────

import type { Venue } from '@/types';
import { getVenueAttributes } from '@/lib/venueAttributes';
import { COLLECTIONS } from '@/lib/collections';
import { Colors } from '@/constants/theme';

export type IntentKey = 'rain' | 'energy' | 'free' | 'animals' | 'toddler' | 'parent';
export type AgeKey = 'toddler' | 'little' | 'older';

export interface IntentDef {
  key: IntentKey;
  label: string;
  sub: string;
  emoji: string;
  color: string;
  /** REAL-DATA predicate — never fabricates. */
  match: (v: Venue) => boolean;
}

// Parent-relevant facility keywords (matched case-insensitively against the
// venue's real facilities). A venue is "parent friendly" when it has a cafe
// category OR any of these facilities — both honest signals from real data.
const PARENT_FACILITY_KEYWORDS = [
  'cafe',
  'coffee',
  'parking',
  'baby',
  'chang', // baby changing / changing room
  'toilet',
  'pushchair',
  'buggy',
  'high chair',
  'highchair',
];

type FacilityJoin = { facility?: { name?: string | null; slug?: string | null } | null; name?: string | null };

function hasParentFacility(v: Venue): boolean {
  if (v.category?.slug === 'cafe') return true;
  const facs = (v.facilities ?? []) as FacilityJoin[];
  return facs.some((f) => {
    const name = (f.facility?.name ?? f.facility?.slug ?? f.name ?? '').toString().toLowerCase();
    return name !== '' && PARENT_FACILITY_KEYWORDS.some((k) => name.includes(k));
  });
}

// ── Intent definitions (6 chips, README order + colours) ───────────────────
export const INTENTS: readonly IntentDef[] = [
  {
    key: 'rain',
    label: 'Rainy Day',
    sub: 'Indoor picks',
    emoji: '☔',
    color: Colors.intentRain,
    match: COLLECTIONS['rainy-day'].match,
  },
  {
    key: 'energy',
    label: 'Burn Energy',
    sub: 'Wear them out',
    emoji: '⚡',
    color: Colors.intentEnergy,
    match: COLLECTIONS['burn-energy'].match,
  },
  {
    key: 'free',
    label: 'Free Day Out',
    sub: 'Costs nothing',
    emoji: '💷',
    color: Colors.intentFree,
    match: COLLECTIONS['free-days-out'].match,
  },
  {
    key: 'animals',
    label: 'Animal Fix',
    sub: 'Meet animals',
    emoji: '🐾',
    color: Colors.intentAnimals,
    // Only 'farm' is a reliable animal category in the seed (no zoo/aquarium).
    match: (v: Venue) => v.category?.slug === 'farm',
  },
  {
    key: 'toddler',
    label: 'Toddler Time',
    sub: 'Little ones',
    emoji: '🧸',
    color: Colors.intentToddler,
    match: (v: Venue) =>
      getVenueAttributes(v).isToddlerFriendly === true ||
      (v.min_age != null && v.min_age <= 2),
  },
  {
    key: 'parent',
    label: 'Parent Friendly',
    sub: 'Comfy for grown-ups',
    emoji: '☕',
    color: Colors.intentParent,
    match: hasParentFacility,
  },
];

export function getIntent(key: IntentKey | null): IntentDef | null {
  if (!key) return null;
  return INTENTS.find((i) => i.key === key) ?? null;
}

// ── Age groups ─────────────────────────────────────────────────────────────
export interface AgeDef {
  key: AgeKey;
  label: string;
  emoji: string;
}

export const AGE_GROUPS: readonly AgeDef[] = [
  { key: 'toddler', label: 'Toddlers', emoji: '👶' },
  { key: 'little', label: '4–8 yrs', emoji: '🧒' },
  { key: 'older', label: '9–12 yrs', emoji: '🧑' },
];

// Age-range overlap. Unknown bounds are treated as open (min→0, max→99) so a
// venue with no recorded ages is not excluded (we never CLAIM it suits an age,
// we just don't hide it). This mirrors how the design surfaced broad venues.
export function matchesAge(v: Venue, age: AgeKey): boolean {
  const min = v.min_age ?? 0;
  const max = v.max_age ?? 99;
  switch (age) {
    case 'toddler':
      return min <= 3;
    case 'little':
      return min <= 8 && max >= 4;
    case 'older':
      return max >= 9;
  }
}

// ── Smart filtering + pick ──────────────────────────────────────────────────
/**
 * Filter the fetched venue list by the active intent (or, with no intent, by
 * indoor-only when it's raining) and the active age group. Pure.
 */
export function filterHomeVenues(
  venues: Venue[],
  intent: IntentKey | null,
  age: AgeKey | null,
  weatherRain: boolean,
): Venue[] {
  let list = venues;
  const def = getIntent(intent);
  if (def) {
    list = list.filter(def.match);
  } else if (weatherRain) {
    list = list.filter((v) => getVenueAttributes(v).isRainyDaySuitable === true);
  }
  if (age) {
    list = list.filter((v) => matchesAge(v, age));
  }
  return list;
}

/**
 * Sort a filtered list by rating (desc) and split into the single featured pick
 * + the remaining matches. A non-mutating sort (copies first).
 */
export function pickFeatured(filtered: Venue[]): { featured: Venue | null; rest: Venue[] } {
  const sorted = [...filtered].sort(
    (a, b) => (b.average_rating ?? 0) - (a.average_rating ?? 0),
  );
  return { featured: sorted[0] ?? null, rest: sorted.slice(1) };
}

// ── Contextual "why this matches" tag for a list card ──────────────────────
// A short, honest pill explaining why the venue is in the current filtered set.
// Only ever reflects the ACTIVE intent/age (which the venue already matched),
// or a neutral truth (free / open category) otherwise — never fabricated.
export function getContextTag(
  v: Venue,
  intent: IntentKey | null,
  age: AgeKey | null,
): string | null {
  switch (intent) {
    case 'rain':
      return 'Great for a rainy day';
    case 'energy':
      return 'Burn off some energy';
    case 'free':
      return 'Free entry';
    case 'animals':
      return 'Animals to meet';
    case 'toddler':
      return 'Good for toddlers';
    case 'parent':
      return 'Parent-friendly';
    default:
      break;
  }
  if (age === 'toddler') return 'Good for toddlers';
  if (getVenueAttributes(v).isFree === true) return 'Free entry';
  return null;
}
