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
import { COLLECTIONS, type CollectionKey } from '@/lib/collections';
import { Colors } from '@/constants/theme';
import type { WeatherCondition } from '@/lib/weather';

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

// ── Intent definitions (6 chips — final pp2-home.jsx emoji/sub set) ────────
export const INTENTS: readonly IntentDef[] = [
  {
    key: 'rain',
    label: 'Rainy Day',
    sub: 'Indoor picks',
    emoji: '🌧️',
    color: Colors.intentRain,
    match: COLLECTIONS['rainy-day'].match,
  },
  {
    key: 'energy',
    label: 'Burn Energy',
    sub: 'Wear them right out',
    emoji: '⚡',
    color: Colors.intentEnergy,
    match: COLLECTIONS['burn-energy'].match,
  },
  {
    key: 'free',
    label: 'Free Day Out',
    sub: 'No entry cost',
    emoji: '🆓',
    color: Colors.intentFree,
    match: COLLECTIONS['free-days-out'].match,
  },
  {
    key: 'animals',
    label: 'Animal Fix',
    sub: 'Farms & wildlife',
    emoji: '🐑',
    color: Colors.intentAnimals,
    // Only 'farm' is a reliable animal category in the seed (no zoo/aquarium).
    match: (v: Venue) => v.category?.slug === 'farm',
  },
  {
    key: 'toddler',
    label: 'Toddler Time',
    sub: 'Under-3s welcome',
    emoji: '👶',
    color: Colors.intentToddler,
    match: (v: Venue) =>
      getVenueAttributes(v).isToddlerFriendly === true ||
      (v.min_age != null && v.min_age <= 2),
  },
  {
    key: 'parent',
    label: 'Parent Friendly',
    sub: 'Good coffee on-site',
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

// ═══════════════════════════════════════════════════════════════════════════
// Final pp2-home.jsx ports (2026-07-08, exact-v2 pass). All pure functions —
// no React, no fabricated data. Weather conditions are the app's REAL
// WeatherCondition union mapped onto the prototype's copy keys.
// ═══════════════════════════════════════════════════════════════════════════

// App condition → prototype copy key. The app's forecast source can't produce
// the prototype's 'windy'/'night' weather conditions ('night' in the app is
// time-of-day, handled by the `hour` argument below), so those rows of the
// prototype maps are unreachable and intentionally not ported.
type ProtoWeatherKey = 'sunny' | 'rain' | 'thunder' | 'snow' | 'cloudy' | 'fog';
function toProtoKey(condition: WeatherCondition | null): ProtoWeatherKey {
  switch (condition) {
    case 'rain':
    case 'drizzle':
    case 'showers':
      return 'rain';
    case 'thunderstorm':
      return 'thunder';
    case 'snow':
      return 'snow';
    case 'overcast':
    case 'partly_cloudy':
      return 'cloudy';
    case 'fog':
      return 'fog';
    case 'clear':
    case 'mainly_clear':
      return 'sunny';
    default:
      return 'sunny'; // unknown/null
  }
}

// ── "Good for today" hero collection (pp2-home.jsx `heroCollection`) ───────
// Every hero routes to a REAL app collection (lib/collections):
//   proto 'rain'   → 'rainy-day'      proto 'energy' → 'burn-energy'
//   proto 'free'   → 'free-days-out'  proto 'gems'   → 'hidden-gems'
// Titles/descriptions are the prototype's editorial copy — they describe the
// collection, never a venue, so nothing is fabricated.
export interface HeroCollectionDef {
  key: CollectionKey;
  title: string;
  desc: string;
  emoji: string;
  accent: string;
  /** Dark-mode gradient stops (prototype gd1 → gd2, 145deg). */
  gd1: string;
  gd2: string;
}

const HERO_DEFS = {
  rain:    { key: 'rainy-day' as CollectionKey,     title: 'Rainy Day Picks',  desc: 'Stay dry, stay happy',            emoji: '🌧️', accent: '#3B7FCC', gd1: '#060C18', gd2: '#0A1424' },
  thunder: { key: 'rainy-day' as CollectionKey,     title: 'Rainy Day Picks',  desc: 'Best to stay inside today',       emoji: '⛈️', accent: '#3B7FCC', gd1: '#060C18', gd2: '#0A1424' },
  energy:  { key: 'burn-energy' as CollectionKey,   title: 'Burn Energy',      desc: 'Wear them right out',             emoji: '⚡',  accent: '#E05A20', gd1: '#1C0D04', gd2: '#2C1608' },
  free:    { key: 'free-days-out' as CollectionKey, title: 'Free Days Out',    desc: 'No entry cost, ever',             emoji: '🌿', accent: '#2E9E62', gd1: '#050E09', gd2: '#091810' },
  gems:    { key: 'hidden-gems' as CollectionKey,   title: 'Hidden Gems',      desc: 'Off the beaten track',            emoji: '✨', accent: '#7C4FCC', gd1: '#0C0818', gd2: '#140E28' },
  animals: { key: 'hidden-gems' as CollectionKey,   title: 'Animal Adventures', desc: 'Get close to nature',            emoji: '🐑', accent: '#7C4FCC', gd1: '#0C0818', gd2: '#140E28' },
  summer:  { key: 'burn-energy' as CollectionKey,   title: 'Summer Adventures', desc: 'Make the most of the sunshine',  emoji: '☀️', accent: '#E8A828', gd1: '#1A1008', gd2: '#2C1C08' },
  winter:  { key: 'hidden-gems' as CollectionKey,   title: 'Winter Days Out',  desc: 'Cosy finds for cold days',        emoji: '❄️', accent: '#5B9BD5', gd1: '#060C18', gd2: '#0A1424' },
  night:   { key: 'hidden-gems' as CollectionKey,   title: 'Plan for Tomorrow', desc: 'Get ahead for a great day out',  emoji: '🌙', accent: '#7C4FCC', gd1: '#0C0818', gd2: '#140E28' },
} satisfies Record<string, HeroCollectionDef>;

/**
 * Prototype precedence: rain/thunder → night (time-based here; the app has no
 * 'night' weather condition) → snow → active intent → season. Intents with no
 * prototype hero ('toddler'/'parent') fall through to the season default,
 * exactly as the prototype's `H[activeIntent] || season` did.
 */
export function pickHeroCollection(
  condition: WeatherCondition | null,
  intent: IntentKey | null,
  month: number,
  hour: number,
): HeroCollectionDef {
  const proto = toProtoKey(condition);
  if (proto === 'rain') return HERO_DEFS.rain;
  if (proto === 'thunder') return HERO_DEFS.thunder;
  if (hour >= 21 || hour < 6) return HERO_DEFS.night;
  if (proto === 'snow') return HERO_DEFS.winter;
  if (intent === 'rain') return HERO_DEFS.rain;
  if (intent === 'energy') return HERO_DEFS.energy;
  if (intent === 'free') return HERO_DEFS.free;
  if (intent === 'animals') return HERO_DEFS.animals;
  if (month >= 11 || month <= 1) return HERO_DEFS.winter;
  if (month >= 6 && month <= 8) return HERO_DEFS.summer;
  return HERO_DEFS.energy;
}

// ── Weather-aware pick CTA (pp2-home.jsx `wCTA`) ───────────────────────────
export interface WeatherCta {
  icon: string;
  line: string;
  cta: string;
  color: string;
}

const WEATHER_CTA: Record<ProtoWeatherKey, WeatherCta> = {
  sunny:   { icon: '☀️', line: 'Perfect weather for a day out.',            cta: 'Find outdoor spots',    color: '#E8A828' },
  rain:    { icon: '🌧️', line: "Rainy day? We've got you covered.",         cta: 'See indoor picks',      color: '#4C8DF6' },
  cloudy:  { icon: '⛅', line: 'Mild day — any excuse to get out.',          cta: 'Find something nearby', color: '#8899AA' },
  snow:    { icon: '❄️', line: 'Snow day! Rare fun — make the most of it.', cta: 'Snow day picks',        color: '#7AB8D8' },
  thunder: { icon: '⛈️', line: "Stay inside — we've got great indoor picks.", cta: 'Indoor only',         color: '#8AAACE' },
  fog:     { icon: '🌫️', line: 'Foggy morning — a cosy local pick?',        cta: 'Find local spots',      color: '#8A9AAA' },
};

/** Null when there's no weather data yet — the CTA card simply doesn't render. */
export function getWeatherCta(condition: WeatherCondition | null | undefined): WeatherCta | null {
  if (condition == null) return null;
  return WEATHER_CTA[toProtoKey(condition)];
}

// ── Context line (pp2-home.jsx `ctxLine` — full weather × time-of-day map) ─
export function getHomeContextLine(condition: WeatherCondition | null, now: Date): string {
  const hour = now.getHours();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const tod = hour < 12 ? 'am' : hour < 17 ? 'pm' : hour < 21 ? 'eve' : 'night';
  const map: Record<ProtoWeatherKey, Record<'am' | 'pm' | 'eve' | 'night', string>> = {
    rain:    { am: 'Rainy morning — indoor picks sorted.', pm: "Wet afternoon? We've got you.", eve: 'Rainy evening — plan ahead.', night: 'Wet one tonight — indoor picks below.' },
    thunder: { am: 'Stay inside — great indoor picks.', pm: 'Storm outside — best to stay cosy.', eve: 'Thundery evening — settle in.', night: 'Stormy night — indoor plans ready.' },
    snow:    { am: 'Snow day! Make the most of it.', pm: 'Still snowing — wrap up and go.', eve: 'Snowy evening — magical out there.', night: 'Snow expected — exciting morning ahead.' },
    cloudy:  { am: 'Mild morning — still worth getting out.', pm: 'Overcast but dry — go for it.', eve: 'Grey day ending — plan a better one.', night: "Let's plan something for tomorrow." },
    fog:     { am: 'Foggy start — a cosy local pick?', pm: 'Misty afternoon — staying local is smart.', eve: 'Foggy evening — stick nearby.', night: 'Foggy night — local plans for tomorrow.' },
    sunny:   {
      am: isWeekend ? 'Weekend morning — get outside.' : 'Great morning to get outside.',
      pm: isWeekend ? 'Perfect afternoon for the park.' : 'Afternoon sorted.',
      eve: 'Golden hour — make the most of it.',
      night: 'Clear skies — great plans for tomorrow.',
    },
  };
  return map[toProtoKey(condition)][tod];
}
