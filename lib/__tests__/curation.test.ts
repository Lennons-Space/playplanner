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

import { curateVenues, resolveAutoMood, timeOfDayScore, temperatureBoost, indoorOutdoorContextBoost, type CurationContext } from '../curation';
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

  // Sprint B3: 'playground' was missing from OUTDOOR_SLUGS in both
  // venueAttributes.ts and weather.ts, so on a sunny day with mood:'auto'
  // (which resolves to 'outdoor') a playground forfeited the +25 mood-match
  // boost AND the +18 weather boost vs. an equally-placed park — despite
  // being unambiguously outdoor and the highest-family-score outdoor
  // category. This locks the corrected behaviour: playground now ranks
  // level with park (same outdoor mood-match + weather treatment) rather
  // than being buried behind it.
  it('playground gets the outdoor mood-match boost and ranks level with park on a sunny "auto" day (Sprint B3 fix)', () => {
    const venues = [
      venue({ id: 'playground', category: cat('playground'), distance_km: 2 }),
      venue({ id: 'soft', category: cat('soft-play'), distance_km: 2 }),
    ];
    const result = curateVenues(venues, ctx({ weather: SUN, mood: 'auto' }));
    // Not excluded by the resolved 'outdoor' hard constraint, and beats an
    // equally-placed indoor venue thanks to the outdoor mood-match + weather boost.
    expect(result.map((r) => r.venue.id)).toContain('playground');
    expect(result[0].venue.id).toBe('playground');
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

// ── Helpers shared by the contextual-boost tests ───────────────────────────
// venueWithSlug: creates a venue whose category slug matches the given string,
// which is how every scoring function identifies the venue type.
function venueWithSlug(id: string, slug: string): Venue {
  return venue({ id, category: cat(slug) });
}

function weather(over: Partial<WeatherState>): WeatherState {
  return {
    condition: 'clear',
    temperatureC: 15,
    precipProbabilityPct: 10,
    emoji: '☀️',
    label: 'Clear',
    ...over,
  };
}

describe('contextual boosts — Step 3A', () => {
  describe('timeOfDayScore', () => {
    // Without the -1 guard, a missing ctx.now would produce a score based on
    // whatever hour getHours() returns on the test machine — making results
    // non-deterministic and breaking existing baseline tests.
    it('sentinel -1 always returns 0', () => {
      expect(timeOfDayScore(venueWithSlug('sp', 'soft-play'), -1)).toBe(0);
      expect(timeOfDayScore(venueWithSlug('cafe', 'cafe'), -1)).toBe(0);
    });

    // A parent heading out at 9am with a toddler would expect soft-play and
    // cafes to surface first; without the morning boost, irrelevant evening
    // venues could outrank them.
    it('morning hour 9: soft-play gets +8', () => {
      expect(timeOfDayScore(venueWithSlug('sp', 'soft-play'), 9)).toBe(8);
    });

    // Parks score 0 in the morning so the morning window doesn't accidentally
    // reward every venue — only the genuinely morning-appropriate ones.
    it('morning hour 9: park gets 0', () => {
      expect(timeOfDayScore(venueWithSlug('park', 'park'), 9)).toBe(0);
    });

    // Afternoon is the most flexible window; applying a bonus here would skew
    // results away from the standard quality/distance ranking for no reason.
    it('afternoon hour 14: soft-play gets 0', () => {
      expect(timeOfDayScore(venueWithSlug('sp', 'soft-play'), 14)).toBe(0);
    });

    // At 6pm parents need something that's actually suitable for kids just out
    // of school. If the after-school boost is broken, a distant cafe could
    // beat a nearby soft-play that's the obvious choice.
    it('after-school hour 18: soft-play gets +8', () => {
      expect(timeOfDayScore(venueWithSlug('sp', 'soft-play'), 18)).toBe(8);
    });

    // Trampolines are explicitly in AFTER_SCHOOL_SLUGS; if the Set is ever
    // accidentally edited, this test catches the regression immediately.
    it('after-school hour 18: trampoline gets +8', () => {
      expect(timeOfDayScore(venueWithSlug('tr', 'trampoline'), 18)).toBe(8);
    });

    // Parks are not in AFTER_SCHOOL_SLUGS (too weather-dependent at pickup
    // time); confirming 0 prevents someone adding park to that Set by mistake.
    it('after-school hour 18: park gets 0', () => {
      expect(timeOfDayScore(venueWithSlug('park', 'park'), 18)).toBe(0);
    });

    // Evening / night edge cases: parents are unlikely to be looking for
    // venues but if they do the function must not crash or apply a stale bonus.
    it('evening hour 21: returns 0', () => {
      expect(timeOfDayScore(venueWithSlug('sp', 'soft-play'), 21)).toBe(0);
      expect(timeOfDayScore(venueWithSlug('park', 'park'), 21)).toBe(0);
    });
  });

  describe('temperatureBoost', () => {
    // If null-weather isn't guarded, every venue would receive a spurious
    // score change whenever the weather API is unavailable — breaking the
    // "degrade gracefully" contract.
    it('null weather returns 0', () => {
      expect(temperatureBoost(venueWithSlug('sp', 'soft-play'), null)).toBe(0);
    });

    // At 28°C parents want outdoor water venues. Swimming belongs to both the
    // "outdoor boost" set AND the "indoor penalty" set; the outdoor boost (+6)
    // must win because VERY_HOT_OUTDOOR_SLUGS is checked first.
    it('28°C: outdoor slug (swimming) gets +6', () => {
      expect(temperatureBoost(venueWithSlug('swim', 'swimming'), weather({ temperatureC: 28 }))).toBe(6);
    });

    // On very hot days indoor venues become stuffy. The -3 penalty is a
    // deliberate UX decision; if temperatureBoost returns 0 here, soft-play
    // incorrectly ties with outdoor venues on hot days.
    it('28°C: indoor slug (soft-play) gets -3', () => {
      expect(temperatureBoost(venueWithSlug('sp', 'soft-play'), weather({ temperatureC: 28 }))).toBe(-3);
    });

    // A cafe is in neither hot-outdoor nor hot-indoor set; it should stay
    // score-neutral so it rises or falls purely on quality/proximity.
    it('28°C: neutral slug (cafe) gets 0', () => {
      expect(temperatureBoost(venueWithSlug('cafe', 'cafe'), weather({ temperatureC: 28 }))).toBe(0);
    });

    // 25°C is a nice warm-but-not-scorching day; parks should be prioritised
    // without penalising indoor venues. +4 for outdoor slugs only.
    it('25°C: outdoor slug (park) gets +4', () => {
      expect(temperatureBoost(venueWithSlug('park', 'park'), weather({ temperatureC: 25 }))).toBe(4);
    });

    // At 25°C libraries should be score-neutral — parents should still be
    // able to choose them without being actively discouraged.
    it('25°C: indoor slug (library) gets 0', () => {
      expect(temperatureBoost(venueWithSlug('lib', 'library'), weather({ temperatureC: 25 }))).toBe(0);
    });

    // At 4°C parents strongly prefer indoor venues. Museum is in COLD_INDOOR_SLUGS;
    // if the cold boost is missing, parents on a freezing day still see outdoor
    // venues ranked equally, which is misleading.
    it('4°C: indoor slug (museum) gets +4', () => {
      expect(temperatureBoost(venueWithSlug('mus', 'museum'), weather({ temperatureC: 4 }))).toBe(4);
    });

    // Parks should not be boosted in freezing weather — confirming 0 prevents
    // accidentally adding park to COLD_INDOOR_SLUGS.
    it('4°C: outdoor slug (park) gets 0', () => {
      expect(temperatureBoost(venueWithSlug('park', 'park'), weather({ temperatureC: 4 }))).toBe(0);
    });

    // 15°C is the "neutral" band (>5, <23); no venue should be biased by
    // temperature at this point — ranking falls back to quality and proximity.
    it('15°C (neutral): all slugs get 0', () => {
      expect(temperatureBoost(venueWithSlug('sp', 'soft-play'), weather({ temperatureC: 15 }))).toBe(0);
      expect(temperatureBoost(venueWithSlug('park', 'park'), weather({ temperatureC: 15 }))).toBe(0);
      expect(temperatureBoost(venueWithSlug('cafe', 'cafe'), weather({ temperatureC: 15 }))).toBe(0);
    });
  });

  describe('indoorOutdoorContextBoost', () => {
    // Same graceful-degradation requirement: no weather data must produce no
    // score change, otherwise the ranking becomes unpredictable offline.
    it('null weather returns 0', () => {
      expect(indoorOutdoorContextBoost(venueWithSlug('sp', 'soft-play'), null)).toBe(0);
    });

    // At 80% precip, parents need indoor cover. If this +5 is absent, rainy-day
    // results feel random rather than contextually helpful.
    it('precip 80%, indoor slug (soft-play) returns +5', () => {
      expect(
        indoorOutdoorContextBoost(venueWithSlug('sp', 'soft-play'), weather({ precipProbabilityPct: 80 }))
      ).toBe(5);
    });

    // An outdoor venue should NOT be boosted when rain is likely — confirming
    // 0 here prevents a logic inversion where parks rise on rainy days.
    it('precip 80%, outdoor slug (park) returns 0', () => {
      expect(
        indoorOutdoorContextBoost(venueWithSlug('park', 'park'), weather({ precipProbabilityPct: 80 }))
      ).toBe(0);
    });

    // Low precip + warm enough = ideal outdoor day. The +3 surfaces parks
    // without mood-matching being required, so 'surprise' mode still feels
    // weather-aware.
    it('precip 5%, temp 18°C, outdoor slug (park) returns +3', () => {
      expect(
        indoorOutdoorContextBoost(
          venueWithSlug('park', 'park'),
          weather({ precipProbabilityPct: 5, temperatureC: 18 })
        )
      ).toBe(3);
    });

    // Library is indoor, so it must not receive the outdoor sunny-day boost.
    it('precip 5%, temp 18°C, indoor slug (library) returns 0', () => {
      expect(
        indoorOutdoorContextBoost(
          venueWithSlug('lib', 'library'),
          weather({ precipProbabilityPct: 5, temperatureC: 18 })
        )
      ).toBe(0);
    });

    // temperatureC < 15 means the fine-weather outdoor boost should NOT fire
    // even if precip is low — it's too cold to recommend outdoor by default.
    it('precip 5%, temp 12°C (below threshold), outdoor slug returns 0', () => {
      expect(
        indoorOutdoorContextBoost(
          venueWithSlug('park', 'park'),
          weather({ precipProbabilityPct: 5, temperatureC: 12 })
        )
      ).toBe(0);
    });

    // 50% precip satisfies neither the >=70 (rainy-indoor) nor the <=10
    // (sunny-outdoor) threshold — no venue should be biased by this.
    it('precip 50% (neither threshold): all slugs get 0', () => {
      expect(
        indoorOutdoorContextBoost(venueWithSlug('sp', 'soft-play'), weather({ precipProbabilityPct: 50 }))
      ).toBe(0);
      expect(
        indoorOutdoorContextBoost(venueWithSlug('park', 'park'), weather({ precipProbabilityPct: 50 }))
      ).toBe(0);
    });
  });

  describe('curateVenues — proximity curve', () => {
    // Under the sqrt curve, a venue at 5km earns meaningfully more proximity
    // credit than one at 28km. This test confirms the curve change hasn't
    // accidentally swapped that ordering (e.g. due to a sign error in the
    // sqrt formula).
    it('near venue (5km) beats far venue (28km) when all other signals are equal', () => {
      const venues = [
        venue({ id: 'far', distance_km: 28 }),
        venue({ id: 'near', distance_km: 5 }),
      ];
      const result = curateVenues(venues, ctx({ mood: 'surprise', weather: null }));
      expect(result[0].venue.id).toBe('near');
    });
  });
});
