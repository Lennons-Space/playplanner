/**
 * Tests for lib/curation.ts — the "Find something for us" ranking engine.
 *
 * These lock the behaviour parents depend on:
 *   • "Free today" never surfaces a paid venue (a broken promise).
 *   • Closer beats further when quality is equal.
 *   • Rain favours indoor; sun favours outdoor.
 *   • Reasons are honest and derived only from real fields.
 *   • Output is small and DETERMINISTIC (no randomness, stable ties).
 */

import { curateVenues, resolveAutoMood, type CurationContext } from '../curation';
import type { WeatherState } from '../weather';
import type { Venue } from '@/types';

// ── Minimal venue factory ──────────────────────────────────────────
// Only the fields curation reads matter; the rest are cast away.
function venue(over: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Venue ${over.id}`,
    slug: over.id,
    category: undefined,
    price_range: null,
    min_age: 0,
    max_age: 12,
    is_premium: false,
    featured_until: null,
    review_count: 0,
    average_rating: 0,
    distance_km: 5,
    ...over,
  } as Venue;
}

function cat(slug: string) {
  return { id: slug, name: slug, slug, icon: '', color: '#000' };
}

const RAIN: WeatherState = {
  condition: 'rain', temperatureC: 11, precipProbabilityPct: 80, emoji: '🌧', label: 'Rainy',
};
const SUN: WeatherState = {
  condition: 'clear', temperatureC: 23, precipProbabilityPct: 5, emoji: '☀️', label: 'Sunny',
};

const ctx = (over: Partial<CurationContext>): CurationContext => ({
  weather: null,
  mood: 'surprise',
  now: new Date('2026-05-28T10:00:00Z'),
  ...over,
});

describe('resolveAutoMood', () => {
  it('returns the mood unchanged when not auto', () => {
    expect(resolveAutoMood('indoor', RAIN)).toBe('indoor');
    expect(resolveAutoMood('free', null)).toBe('free');
  });

  it('leans indoor in wet weather', () => {
    expect(resolveAutoMood('auto', RAIN)).toBe('indoor');
  });

  it('leans outdoor on a warm clear day', () => {
    expect(resolveAutoMood('auto', SUN)).toBe('outdoor');
  });

  it('falls back to surprise with no weather', () => {
    expect(resolveAutoMood('auto', null)).toBe('surprise');
  });
});

describe('curateVenues — hard constraints', () => {
  it('"free" mood excludes paid and unknown-price venues', () => {
    const venues = [
      venue({ id: 'free', price_range: 'free' }),
      venue({ id: 'paid', price_range: 'moderate' }),
      venue({ id: 'unknown', price_range: null }),
    ];
    const result = curateVenues(venues, ctx({ mood: 'free' }));
    expect(result.map((r) => r.venue.id)).toEqual(['free']);
  });

  it('"indoor" mood excludes known-outdoor venues but keeps unknowns', () => {
    const venues = [
      venue({ id: 'soft', category: cat('soft-play') }),   // indoor
      venue({ id: 'park', category: cat('park') }),         // outdoor — excluded
      venue({ id: 'cafe', category: cat('cafe') }),         // mixed/unknown — kept
    ];
    const ids = curateVenues(venues, ctx({ mood: 'indoor' })).map((r) => r.venue.id);
    expect(ids).toContain('soft');
    expect(ids).toContain('cafe');
    expect(ids).not.toContain('park');
  });

  it('drops venues with no name', () => {
    const venues = [venue({ id: 'a', name: '   ' }), venue({ id: 'b' })];
    const ids = curateVenues(venues, ctx({})).map((r) => r.venue.id);
    expect(ids).toEqual(['b']);
  });
});

describe('curateVenues — ranking', () => {
  it('ranks the closer venue first when all else is equal', () => {
    const venues = [
      venue({ id: 'far', distance_km: 20 }),
      venue({ id: 'near', distance_km: 1 }),
    ];
    const result = curateVenues(venues, ctx({}));
    expect(result[0].venue.id).toBe('near');
  });

  it('favours indoor over outdoor when it is raining', () => {
    const venues = [
      venue({ id: 'park', category: cat('park'), distance_km: 2 }),
      venue({ id: 'soft', category: cat('soft-play'), distance_km: 2 }),
    ];
    const result = curateVenues(venues, ctx({ weather: RAIN, mood: 'surprise' }));
    expect(result[0].venue.id).toBe('soft');
  });

  it('favours outdoor over indoor on a warm sunny day', () => {
    const venues = [
      venue({ id: 'soft', category: cat('soft-play'), distance_km: 2 }),
      venue({ id: 'park', category: cat('park'), distance_km: 2 }),
    ];
    const result = curateVenues(venues, ctx({ weather: SUN, mood: 'surprise' }));
    expect(result[0].venue.id).toBe('park');
  });

  it('respects the limit', () => {
    const venues = Array.from({ length: 20 }, (_, i) =>
      venue({ id: String(i), distance_km: i }),
    );
    expect(curateVenues(venues, ctx({}), { limit: 6 })).toHaveLength(6);
  });

  it('is deterministic — equal scores keep input order (no randomness)', () => {
    const venues = [
      venue({ id: 'a', distance_km: 5 }),
      venue({ id: 'b', distance_km: 5 }),
      venue({ id: 'c', distance_km: 5 }),
    ];
    const once = curateVenues(venues, ctx({})).map((r) => r.venue.id);
    const twice = curateVenues(venues, ctx({})).map((r) => r.venue.id);
    expect(once).toEqual(['a', 'b', 'c']);
    expect(twice).toEqual(once);
  });
});

describe('curateVenues — reasons', () => {
  it('surfaces a weather reason for indoor venues in the rain', () => {
    const result = curateVenues(
      [venue({ id: 'soft', category: cat('soft-play') })],
      ctx({ weather: RAIN }),
    );
    expect(result[0].reasons.some((r) => /rain/i.test(r))).toBe(true);
  });

  it('shows a free-entry reason and never more than 3 reasons', () => {
    const result = curateVenues(
      [venue({ id: 'f', price_range: 'free', category: cat('library'), review_count: 10, average_rating: 4.8, distance_km: 0.5 })],
      ctx({ weather: RAIN }),
    );
    expect(result[0].reasons.length).toBeLessThanOrEqual(3);
    expect(result[0].reasons.some((r) => /free/i.test(r))).toBe(true);
  });

  it('does not invent a rating reason when there are no reviews', () => {
    const result = curateVenues(
      [venue({ id: 'new', review_count: 0, average_rating: 0 })],
      ctx({}),
    );
    expect(result[0].reasons.some((r) => /rated|reviewed/i.test(r))).toBe(false);
  });
});
