/**
 * venueAttributes.ts — pure, side-effect-free attribute derivation for Venue objects.
 *
 * Rules:
 *   - null = unknown → NEVER pass a filter on a null attribute.
 *   - never assume a venue is free if price_range is null.
 *   - never include a venue in rainy-day results if its category is null/unknown.
 *   - never mark a venue toddler-friendly unless it is in the explicit safe set.
 *
 * The isOpenNow logic is extracted from components/ui/VenueCard.tsx so both
 * the card and the search filter share exactly one implementation.
 */

import type { Venue } from '@/types';

// ─── Category classification sets ─────────────────────────────────────────────

/** Categories that are reliably indoors — safe to show on a rainy day. */
const INDOOR_SLUGS = new Set([
  'soft-play',
  'indoor-play',
  'swimming',
  'trampoline',
  'library',
  'arts',
  'bowling',
  'sensory',
]);

/** Categories that are reliably outdoors — NOT rainy-day suitable. */
const OUTDOOR_SLUGS = new Set([
  'park',
  'outdoor-sports',
  // Playgrounds are unambiguously outdoor; they were previously missing here,
  // which incorrectly left them unclassified (isOutdoor=null) and caused them
  // to forfeit the sunny-day mood-match boost in curation (Sprint B3 fix).
  'playground',
]);

/**
 * Categories confirmed safe for toddlers (0–3).
 * Park is intentionally excluded — quality varies too much in practice.
 */
const TODDLER_FRIENDLY_SLUGS = new Set([
  'soft-play',
  'indoor-play',
  'library',
  'sensory',
]);

// ─── Exported types ────────────────────────────────────────────────────────────

export interface VenueAttributes {
  /** true only when price_range === 'free'. null when price_range is null (unknown). */
  isFree: boolean | null;
  /** 'known' when price_range has a value; 'unknown' when null. */
  priceConfidence: 'known' | 'unknown';
  /** true for INDOOR_SLUGS; false for OUTDOOR_SLUGS; null for mixed/unknown categories. */
  isIndoor: boolean | null;
  /** true for OUTDOOR_SLUGS; false for INDOOR_SLUGS; null for mixed/unknown categories. */
  isOutdoor: boolean | null;
  /** true for INDOOR_SLUGS; false for OUTDOOR_SLUGS; null for mixed/unknown/null categories. */
  isRainyDaySuitable: boolean | null;
  /** true only for TODDLER_FRIENDLY_SLUGS. null for any unrecognised / null category. */
  isToddlerFriendly: boolean | null;
  /** Derived from opening_hours. null when no hours data is available. */
  isOpenNow: boolean | null;
}

// ─── isOpenNow (shared with VenueCard) ────────────────────────────────────────

/**
 * Returns true/false if today's opening hours can be resolved, or null when
 * no opening_hours data is present (treating absence as "unknown", not closed).
 *
 * This is the authoritative implementation — both VenueCard.tsx and search.tsx
 * import from here to guarantee identical behaviour.
 */
export function computeIsOpenNow(venue: Venue): boolean | null {
  if (!venue.opening_hours || venue.opening_hours.length === 0) return null;

  const now = new Date();
  // day_of_week: 0 = Sunday — matches JS Date.getDay() convention.
  const todayRow = venue.opening_hours.find((h) => h.day_of_week === now.getDay());
  if (!todayRow || todayRow.is_closed || !todayRow.opens_at || !todayRow.closes_at) return null;

  const toMins = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= toMins(todayRow.opens_at) && nowMins < toMins(todayRow.closes_at);
}

/**
 * Today's closing time as "HH:MM" (24h) when the venue is open now AND the
 * closing time is parseable; null otherwise. Built on the SAME opening_hours
 * rules as computeIsOpenNow (the single source of truth) — never fabricates a
 * time. Use for an honest "Until 18:00" label on open venues.
 */
export function getOpenUntilLabel(venue: Venue): string | null {
  if (computeIsOpenNow(venue) !== true) return null;
  const now = new Date();
  const row = venue.opening_hours?.find((h) => h.day_of_week === now.getDay());
  if (!row || row.is_closed || !row.closes_at) return null;
  const [h, m] = row.closes_at.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Derive trustworthy attributes from a Venue record.
 * All null values mean "data not available" — callers must NOT infer true or
 * false when the attribute is null.
 */
export function getVenueAttributes(venue: Venue): VenueAttributes {
  // ── Price ──────────────────────────────────────────────────────────────────
  const isFree: boolean | null =
    venue.price_range === null ? null : venue.price_range === 'free';
  const priceConfidence: 'known' | 'unknown' =
    venue.price_range !== null ? 'known' : 'unknown';

  // ── Category-based derivations ─────────────────────────────────────────────
  // Use the joined category object's slug where present (search query result),
  // otherwise fall back to null — never assume a category.
  const slug: string | null | undefined = venue.category?.slug;

  let isIndoor: boolean | null = null;
  let isOutdoor: boolean | null = null;
  let isRainyDaySuitable: boolean | null = null;
  let isToddlerFriendly: boolean | null = null;

  if (slug) {
    if (INDOOR_SLUGS.has(slug)) {
      isIndoor = true;
      isOutdoor = false;
      isRainyDaySuitable = true;
    } else if (OUTDOOR_SLUGS.has(slug)) {
      isIndoor = false;
      isOutdoor = true;
      isRainyDaySuitable = false;
    }
    // else: mixed category (farm, cafe, sports) — remain null

    isToddlerFriendly = TODDLER_FRIENDLY_SLUGS.has(slug) ? true : null;
  }
  // If slug is null/undefined all four remain null — unknown, never assumed.

  // ── Open now ───────────────────────────────────────────────────────────────
  const isOpenNow = computeIsOpenNow(venue);

  return {
    isFree,
    priceConfidence,
    isIndoor,
    isOutdoor,
    isRainyDaySuitable,
    isToddlerFriendly,
    isOpenNow,
  };
}
