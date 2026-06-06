// ─────────────────────────────────────────────────────────────────
// curation.ts — the "Find something for us" ranking engine.
//
// This is the brain behind the decision flow. It takes the venues we
// already fetched (via get_nearby_venues) and produces a SMALL, ordered
// shortlist with an honest reason attached to each one.
//
// DESIGN PRINCIPLES (read before changing weights):
//   • No fake AI. Every score is a deterministic sum of real signals the
//     parent could verify themselves (distance, weather, rating, price).
//   • No randomness. The same input always produces the same output — so
//     results feel stable, not slot-machine. (`surprise` is NOT random; it
//     just relaxes the mood constraint.)
//   • Honest reasons only. We never claim "Open now" here because the
//     get_nearby_venues RPC does not return opening_hours — open-now is
//     handled separately by the results screen via the server `open_now`
//     filter. Reasons come only from fields we actually have.
//   • Small output. We return a shortlist (default 6), never an endless feed.
//
// Reused logic:
//   • getVenueAttributes() — indoor/outdoor/free classification (single source).
//   • scoreVenueForWeather() / getWeatherBadge() — the existing weather layer.
// ─────────────────────────────────────────────────────────────────

import type { Venue } from '@/types';
import { getVenueAttributes } from './venueAttributes';
import {
  scoreVenueForWeather,
  getWeatherBadge,
  type WeatherState,
} from './weather';
import { computeVenueIntelligence } from './recommendations/venueIntelligence';

// ── Moods ──────────────────────────────────────────────────────────
// A mood is the single intent the parent expressed (or 'auto' when they
// just tapped the hero CTA and we infer from context).
export type Mood =
  | 'auto'      // hero CTA — infer indoor/outdoor from weather
  | 'indoor'    // "Stay dry"
  | 'outdoor'   // "Get outside"
  | 'active'    // "Burn energy"
  | 'calm'      // "Something relaxed"
  | 'free'      // "Free today"
  | 'surprise'; // relax all constraints, just give good nearby picks

// Categories that let kids burn energy.
const ACTIVE_SLUGS = new Set([
  'soft-play', 'indoor-play', 'trampoline', 'bowling',
  'park', 'outdoor-sports', 'sports', 'swimming',
]);

// Calmer, lower-stimulation categories.
const CALM_SLUGS = new Set([
  'library', 'arts', 'sensory', 'cafe',
]);

// ── Context ────────────────────────────────────────────────────────
export interface CurationContext {
  /** Current weather, or null if unavailable (curation degrades gracefully). */
  weather: WeatherState | null;
  /** The parent's chosen intent. */
  mood: Mood;
  /** Injectable for tests; defaults to new Date(). */
  now?: Date;
}

export interface CuratedVenue {
  venue: Venue;
  /** Final ranking score (higher = better). Exposed for tests/debugging. */
  score: number;
  /** Up to 3 short, honest cues explaining why this venue is here. */
  reasons: string[];
}

export interface CurateOptions {
  /** Max venues to return. Kept small on purpose — this is not a feed. */
  limit?: number;
}

// ── Weights ────────────────────────────────────────────────────────
// Tuned so that "a great match slightly further away" can still beat
// "a mediocre place next door", but proximity always matters. All values
// are in the same arbitrary unit; only their RATIOS matter.
const W = {
  proximity: 40,   // closest possible venue earns up to this
  weather:   18,   // per point from scoreVenueForWeather (-1..+2)
  rating:    20,   // perfect 5.0 with reviews earns up to this
  reviews:   8,    // volume of reviews (capped) — social proof
  moodMatch: 25,   // venue fits the chosen mood
  featured:  6,    // honest, small nudge for featured venues
} as const;

// Distance (km) at which the proximity bonus reaches zero. Beyond this a
// venue gets no proximity credit but is not excluded.
const PROXIMITY_FALLOFF_KM = 32; // ~20 miles, matches DEFAULT_FILTERS radius

/**
 * Resolve 'auto' into a concrete lean using the weather. This is the
 * "magic": tapping the hero CTA on a rainy day quietly favours indoor.
 * Returns the mood unchanged for every non-auto value.
 */
export function resolveAutoMood(
  mood: Mood,
  weather: WeatherState | null,
): Exclude<Mood, 'auto'> {
  if (mood !== 'auto') return mood;
  if (!weather) return 'surprise'; // no context → don't pretend, just pick well
  const wet =
    weather.condition === 'rain' ||
    weather.condition === 'showers' ||
    weather.condition === 'drizzle' ||
    weather.condition === 'thunderstorm' ||
    weather.condition === 'snow';
  if (wet) return 'indoor';
  if (
    (weather.condition === 'clear' || weather.condition === 'partly_cloudy') &&
    weather.temperatureC >= 16
  ) {
    return 'outdoor';
  }
  return 'surprise';
}

// formatDistance was removed when the distance reason pill was removed from
// CuratedResult (task 2, June 2026 UX polish). VenueCard already shows distance.

function isFeaturedNow(venue: Venue, now: Date): boolean {
  if (!venue.is_premium || !venue.featured_until) return false;
  return new Date(venue.featured_until) > now;
}

/**
 * Does this venue satisfy a HARD constraint for the given mood?
 * A hard constraint excludes non-matching venues entirely (e.g. "Free today"
 * must never surface a paid venue). Soft preferences are handled by scoring.
 *
 * We only exclude when we are CONFIDENT. Unknown attributes (null) are kept,
 * never assumed — matching the data-minimisation rules in venueAttributes.
 */
function passesHardConstraint(venue: Venue, mood: Exclude<Mood, 'auto'>): boolean {
  const attrs = getVenueAttributes(venue);
  switch (mood) {
    case 'free':
      // Only show venues we KNOW are free. Unknown price is excluded here
      // because "Free today" is a promise we must not break.
      return attrs.isFree === true;
    case 'indoor':
      // Exclude venues we KNOW are outdoors. Unknown stays (could be indoor).
      return attrs.isOutdoor !== true;
    case 'outdoor':
      return attrs.isIndoor !== true;
    default:
      return true;
  }
}

/** Soft mood score — rewards a good thematic fit without excluding others. */
function moodScore(venue: Venue, mood: Exclude<Mood, 'auto'>): number {
  const attrs = getVenueAttributes(venue);
  const slug = venue.category?.slug ?? '';
  switch (mood) {
    case 'indoor':
      return attrs.isIndoor === true ? W.moodMatch : 0;
    case 'outdoor':
      return attrs.isOutdoor === true ? W.moodMatch : 0;
    case 'active':
      return ACTIVE_SLUGS.has(slug) ? W.moodMatch : 0;
    case 'calm':
      return CALM_SLUGS.has(slug) ? W.moodMatch : 0;
    case 'free':
      return attrs.isFree === true ? W.moodMatch : 0;
    case 'surprise':
      return 0; // no thematic bias — rank purely on quality + context
    default:
      return 0;
  }
}

function proximityScore(distanceKm: number | undefined): number {
  if (distanceKm == null || !Number.isFinite(distanceKm)) {
    return W.proximity * 0.4; // unknown distance → neutral-ish, don't bury it
  }
  // sqrt curve: same 0km=40, 32km=0 endpoints as linear but compresses the
  // 1–5km band upward — venues a short walk away score meaningfully higher
  // than venues on the edge of the radius.
  const t = Math.max(0, 1 - Math.sqrt(distanceKm / PROXIMITY_FALLOFF_KM));
  return W.proximity * t;
}

// ── Contextual boost slugs ─────────────────────────────────────────
// Kept here (not as module-level Sets) so the functions that use them are
// self-contained and easy to read side-by-side.

const MORNING_SLUGS = new Set(['cafe', 'soft-play', 'indoor-play', 'library', 'sensory']);
const AFTER_SCHOOL_SLUGS = new Set(['soft-play', 'indoor-play', 'trampoline', 'bowling']);
const VERY_HOT_OUTDOOR_SLUGS = new Set(['swimming', 'water-park', 'park', 'outdoor-sports', 'outdoor']);
const VERY_HOT_INDOOR_SLUGS = new Set(['soft-play', 'indoor-play', 'library', 'museum', 'bowling', 'sensory', 'trampoline', 'arts', 'swimming']);
const HOT_OUTDOOR_SLUGS = new Set(['park', 'outdoor-sports', 'farm', 'outdoor']);
const COLD_INDOOR_SLUGS = new Set(['soft-play', 'indoor-play', 'library', 'museum', 'bowling', 'sensory', 'trampoline']);
const PRECIP_INDOOR_SLUGS = new Set(['soft-play', 'indoor-play', 'library', 'museum', 'bowling', 'sensory', 'trampoline', 'arts', 'swimming']);
const PRECIP_OUTDOOR_SLUGS = new Set(['park', 'outdoor-sports', 'farm', 'playground', 'nature_trail', 'outdoor']);

/**
 * Boost venues by category based on the hour of day.
 * Reflects real parent behaviour: cafes/soft-play in the morning,
 * indoor activity venues at after-school pickup time.
 * Returns 0 for unknown time so existing tests are unaffected.
 */
export function timeOfDayScore(venue: Venue, hourOfDay: number): number {
  if (hourOfDay < 0) return 0; // -1 sentinel: ctx.now was absent
  const slug = venue.category?.slug ?? '';
  if (hourOfDay >= 6 && hourOfDay <= 11) {
    return MORNING_SLUGS.has(slug) ? 8 : 0;
  }
  if (hourOfDay >= 12 && hourOfDay <= 16) {
    return 0; // all venue types work in the afternoon
  }
  if (hourOfDay >= 17 && hourOfDay <= 19) {
    // Parents collecting kids want something immediate and sheltered
    return AFTER_SCHOOL_SLUGS.has(slug) ? 8 : 0;
  }
  return 0; // evening/night edge cases — no penalty
}

/**
 * Temperature-specific boost, layered on top of the existing scoreVenueForWeather
 * which handles condition (rain/sun/etc). This handles the temperature dimension
 * independently — hot days make indoor venues uncomfortable; cold days reward indoor.
 */
export function temperatureBoost(venue: Venue, weather: WeatherState | null): number {
  if (!weather) return 0;
  const slug = venue.category?.slug ?? '';
  const t = weather.temperatureC;
  if (t >= 28) {
    if (VERY_HOT_OUTDOOR_SLUGS.has(slug)) return 6;
    // Light indoor penalty: heat makes enclosed venues uncomfortable — parents
    // naturally prefer outdoor/water on very hot days. Not a bug.
    if (VERY_HOT_INDOOR_SLUGS.has(slug)) return -3;
    return 0;
  }
  if (t >= 23) {
    return HOT_OUTDOOR_SLUGS.has(slug) ? 4 : 0;
  }
  if (t <= 5) {
    return COLD_INDOOR_SLUGS.has(slug) ? 4 : 0;
  }
  return 0;
}

/**
 * Uses precipitation probability to tilt indoor/outdoor when mood is neutral.
 * Kept separate from moodScore so it still fires on 'surprise' and 'auto' paths
 * where moodScore deliberately returns 0.
 */
export function indoorOutdoorContextBoost(venue: Venue, weather: WeatherState | null): number {
  if (!weather) return 0;
  const slug = venue.category?.slug ?? '';
  const precip = weather.precipProbabilityPct;
  if (precip >= 70 && PRECIP_INDOOR_SLUGS.has(slug)) return 5;
  if (precip <= 10 && weather.temperatureC >= 15 && PRECIP_OUTDOOR_SLUGS.has(slug)) return 3;
  return 0;
}

function ratingScore(venue: Venue): number {
  if (venue.review_count <= 0) return 0; // no reviews → no rating credit (no guessing)
  const quality = (venue.average_rating / 5) * W.rating;
  const volume = (Math.min(venue.review_count, 20) / 20) * W.reviews;
  return quality + volume;
}

/**
 * Build the short reason list for a card. Priority order matters — the most
 * decision-relevant cue comes first; we keep at most 3.
 */
function buildReasons(
  venue: Venue,
  ctx: CurationContext,
  effectiveMood: Exclude<Mood, 'auto'>,
): string[] {
  const reasons: string[] = [];
  const attrs = getVenueAttributes(venue);

  // 1. Weather context — the most "alive" cue when it applies.
  if (ctx.weather) {
    const badge = getWeatherBadge(venue.category?.slug, ctx.weather.condition);
    if (badge) reasons.push(badge);
  }

  // 2. Free — strong decision driver for families.
  if (attrs.isFree === true && reasons.length < 3) {
    reasons.push('🆓 Free entry');
  }

  // 3. Rating — social proof, only when real reviews exist.
  if (reasons.length < 3 && venue.review_count >= 3) {
    if (venue.average_rating >= 4.5) reasons.push('⭐ Top rated');
    else if (venue.average_rating >= 4.0) reasons.push('⭐ Well reviewed');
  }

  // 4. Distance pill removed — VenueCard already shows the distance inline
  //    (e.g. "520m"), so repeating it as a reason pill was redundant and
  //    made the results page feel cluttered. Context: this was task 2 of the
  //    June 2026 UX polish pass.

  // 5. Mood echo — only if we still have room and nothing better said it.
  if (reasons.length < 2 && effectiveMood === 'active' && ACTIVE_SLUGS.has(venue.category?.slug ?? '')) {
    reasons.push('🏃 Room to run around');
  }

  // 6. Featured — last, and only if there is space (never the lead reason).
  if (reasons.length < 3 && isFeaturedNow(venue, ctx.now ?? new Date())) {
    reasons.push('✨ Featured');
  }

  return reasons.slice(0, 3);
}

/**
 * Rank and shortlist venues for the decision flow.
 *
 * @returns deterministic, ordered list of CuratedVenue (length <= limit).
 */
export function curateVenues(
  venues: Venue[],
  ctx: CurationContext,
  opts: CurateOptions = {},
): CuratedVenue[] {
  const limit = opts.limit ?? 6;
  const now = ctx.now ?? new Date();
  const effectiveMood = resolveAutoMood(ctx.mood, ctx.weather);
  // Derived once before the loop — avoids re-calling getHours() per venue.
  // -1 sentinel means ctx.now was absent; timeOfDayScore treats -1 as 0.
  const hourOfDay = ctx.now ? ctx.now.getHours() : -1;

  const scored: { c: CuratedVenue; idx: number }[] = [];

  venues.forEach((venue, idx) => {
    // Defensive: a venue with no name is not presentable.
    if (!venue?.name?.trim()) return;
    // Hard mood constraints (e.g. "Free today" excludes paid venues).
    if (!passesHardConstraint(venue, effectiveMood)) return;

    let score = 0;
    score += proximityScore(venue.distance_km);
    score += ratingScore(venue);
    score += moodScore(venue, effectiveMood);
    if (ctx.weather) {
      score += scoreVenueForWeather(venue.category?.slug, ctx.weather.condition) * W.weather;
    }
    if (isFeaturedNow(venue, now)) score += W.featured;

    // Intelligence nudges — additive only; existing signals are unchanged.
    // Max contribution: +15 (family quality) + +8 (trust) = +23 points.
    // This is kept well below the moodMatch weight (25) so context still
    // dominates over intrinsic quality when a parent expresses a clear intent.
    const intel = computeVenueIntelligence(venue);
    score += (intel.familyScore / 100) * 15;  // family quality nudge (max +15)
    score += (intel.trustScore / 100) * 8;    // trust nudge (max +8)

    // Contextual boosts — additive, small relative to mood+proximity so they
    // personalise at the margin without overriding a parent's explicit intent.
    score += timeOfDayScore(venue, hourOfDay);
    score += temperatureBoost(venue, ctx.weather);
    score += indoorOutdoorContextBoost(venue, ctx.weather);

    scored.push({
      c: { venue, score, reasons: buildReasons(venue, ctx, effectiveMood) },
      idx,
    });
  });

  // Sort by score desc; stable tiebreak on original index so equal scores
  // preserve the RPC's own ordering (premium-then-distance). No randomness.
  scored.sort((a, b) => (b.c.score - a.c.score) || (a.idx - b.idx));

  return scored.slice(0, limit).map((s) => s.c);
}
