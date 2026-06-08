/**
 * Unit tests for lib/quickFilters.ts
 *
 * Covers every filter's pass/fail rules, the safety-net in applyQuickFilters,
 * badge derivation, and the URL-param validator.
 *
 * Trust rules enforced throughout:
 *   - Hard filters (free, easy-parking, has-cafe, accessible) must NEVER pass
 *     when the relevant data field is null/missing.
 *   - Soft filters must NEVER exclude a venue solely because data is missing.
 *   - Soft filters must never return an empty list — they sort matching venues
 *     to the top but always return the full input.
 *   - Hard filters return [] when nothing confirms the feature — callers render
 *     a "no confirmed data" state rather than an unrelated list.
 */

import {
  applyQuickFilters,
  getQuickFilter,
  parseQuickFilterId,
  QUICK_FILTERS,
  type QuickFilterId,
} from '../quickFilters';
import type { Venue, Facility } from '@/types';

// ── Venue factory ─────────────────────────────────────────────────────────────

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'v1',
    name: 'Test Venue',
    slug: null,
    description: null,
    category_id: null,
    category: undefined,
    address_line1: null,
    address_line2: null,
    city: 'London',
    postcode: null,
    country: 'GB',
    latitude: 51.5,
    longitude: -0.1,
    phone: null,
    email: null,
    website: null,
    price_range: null,
    min_age: 0,
    max_age: 12,
    is_published: true,
    is_verified: false,
    is_premium: false,
    featured_until: null,
    claimed_by: null,
    submitted_by: null,
    moderation_status: 'approved',
    osm_id: null,
    data_source: null,
    license: null,
    moderation_notes: null,
    moderated_by: null,
    moderated_at: null,
    review_count: 0,
    average_rating: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCategory(slug: string) {
  return { id: `cat-${slug}`, name: slug, slug, icon: 'map', color: '#000' };
}

function makeFacility(slug: string, name: string): Facility {
  return { id: `fac-${slug}`, slug, name, icon: 'check' };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function filter(id: QuickFilterId) {
  const f = getQuickFilter(id);
  if (!f) throw new Error(`Filter not found: ${id}`);
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK_FILTERS catalogue completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('QUICK_FILTERS catalogue', () => {
  it('has exactly 11 filters', () => {
    expect(QUICK_FILTERS).toHaveLength(11);
  });

  it('every filter has id, label, description, and test function', () => {
    QUICK_FILTERS.forEach((f) => {
      expect(typeof f.id).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(typeof f.description).toBe('string');
      expect(typeof f.test).toBe('function');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rainy-day
// ─────────────────────────────────────────────────────────────────────────────

describe('rainy-day filter', () => {
  const f = filter('rainy-day');

  it('passes for soft-play (known indoor)', () => {
    const v = makeVenue({ category: makeCategory('soft-play') });
    const r = f.test(v);
    expect(r.passes).toBe(true);
    expect(r.confidence).toBe('certain');
  });

  it('passes for trampoline (indoor slug)', () => {
    const v = makeVenue({ category: makeCategory('trampoline') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for museum', () => {
    const v = makeVenue({ category: makeCategory('museum') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for swimming', () => {
    const v = makeVenue({ category: makeCategory('swimming') });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails for park (outdoor)', () => {
    const v = makeVenue({ category: makeCategory('park') });
    const r = f.test(v);
    expect(r.passes).toBe(false);
  });

  it('fails for outdoor-sports', () => {
    const v = makeVenue({ category: makeCategory('outdoor-sports') });
    expect(f.test(v).passes).toBe(false);
  });

  it('passes with "likely" confidence when name contains "indoor"', () => {
    const v = makeVenue({ name: 'Indoor Play Zone' });
    const r = f.test(v);
    expect(r.passes).toBe(true);
    expect(r.confidence).toBe('likely');
  });

  it('passes with "likely" confidence when name contains "soft play"', () => {
    const v = makeVenue({ name: 'Kiddie Soft Play Centre' });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails for venue with no category and no name hints', () => {
    const v = makeVenue({ name: 'Random Place' });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// free (hard filter)
// ─────────────────────────────────────────────────────────────────────────────

describe('free filter (hard)', () => {
  const f = filter('free');

  it('passes only when price_range is "free"', () => {
    const v = makeVenue({ price_range: 'free' });
    expect(f.test(v).passes).toBe(true);
    expect(f.test(v).confidence).toBe('certain');
  });

  it('fails when price_range is null (unknown — must not claim free)', () => {
    const v = makeVenue({ price_range: null });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when price_range is "budget"', () => {
    const v = makeVenue({ price_range: 'budget' });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when price_range is "premium"', () => {
    const v = makeVenue({ price_range: 'premium' });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when price_range is "moderate"', () => {
    const v = makeVenue({ price_range: 'moderate' });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toddlers
// ─────────────────────────────────────────────────────────────────────────────

describe('toddlers filter', () => {
  const f = filter('toddlers');

  // Discovery Sprint A (P2): min_age/max_age are OSM-import DEFAULTS
  // catalogue-wide (scripts/import/02_transform_osm.js SLUG_AGES — e.g. every
  // 'attraction' defaults to 0-18). The filter previously trusted
  // "min_age <= 3 AND max_age > 0" as a 'certain' match, which let thousands
  // of never-assessed attractions (London Dungeon, SEA LIFE, Shrek's
  // Adventure — all min_age=0/max_age=18) pass an explicit "Toddlers" filter
  // a parent taps for safety reasons. The signal is now CATEGORY-ONLY.

  it('does NOT pass on age range alone when category is an untrusted default (attraction)', () => {
    const v = makeVenue({ min_age: 0, max_age: 18, category: makeCategory('attraction') });
    expect(f.test(v).passes).toBe(false);
  });

  it('does NOT pass for an animal-attraction with defaulted ages (SEA LIFE-style)', () => {
    const v = makeVenue({ min_age: 0, max_age: 18, category: makeCategory('animal-attraction') });
    expect(f.test(v).passes).toBe(false);
  });

  it('passes with certainty for soft-play by category (toddler slug)', () => {
    const v = makeVenue({
      min_age: 0, max_age: 12, // generic ages — category is the trusted signal
      category: makeCategory('soft-play'),
    });
    const r = f.test(v);
    expect(r.passes).toBe(true);
    expect(r.confidence).toBe('certain');
  });

  it('passes for library by category', () => {
    const v = makeVenue({
      min_age: 0, max_age: 12,
      category: makeCategory('library'),
    });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails for bowling (not a toddler category) with adult age range', () => {
    const v = makeVenue({ min_age: 5, max_age: 18, category: makeCategory('bowling') });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails for playground (not in quickFilters TODDLER_SLUGS) even with toddler-range ages', () => {
    // Note: quickFilters.ts TODDLER_SLUGS deliberately differs from the
    // recommendation-reason whitelist (filter-specific category set);
    // playground is not in it, and age alone no longer counts.
    const v = makeVenue({ min_age: 0, max_age: 16, category: makeCategory('playground') });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// burn-energy
// ─────────────────────────────────────────────────────────────────────────────

describe('burn-energy filter', () => {
  const f = filter('burn-energy');

  it('passes for soft-play', () => {
    const v = makeVenue({ category: makeCategory('soft-play') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for trampoline', () => {
    const v = makeVenue({ category: makeCategory('trampoline') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for swimming', () => {
    const v = makeVenue({ category: makeCategory('swimming') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for park', () => {
    const v = makeVenue({ category: makeCategory('park') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes with "likely" for name containing "adventure"', () => {
    const v = makeVenue({ name: 'Little Adventures Centre' });
    const r = f.test(v);
    expect(r.passes).toBe(true);
    expect(r.confidence).toBe('likely');
  });

  it('fails for library (calm, not active)', () => {
    const v = makeVenue({ category: makeCategory('library') });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails for venue with no category and no name hints', () => {
    const v = makeVenue({ name: 'Some Place' });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// outdoors
// ─────────────────────────────────────────────────────────────────────────────

describe('outdoors filter', () => {
  const f = filter('outdoors');

  it('passes for park', () => {
    const v = makeVenue({ category: makeCategory('park') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for farm', () => {
    const v = makeVenue({ category: makeCategory('farm') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes with "likely" for name containing "nature trail"', () => {
    const v = makeVenue({ name: 'Woodland Nature Trail' });
    const r = f.test(v);
    expect(r.passes).toBe(true);
    expect(r.confidence).toBe('likely');
  });

  it('fails for soft-play (indoor)', () => {
    const v = makeVenue({ category: makeCategory('soft-play') });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails for museum', () => {
    const v = makeVenue({ category: makeCategory('museum') });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// indoors
// ─────────────────────────────────────────────────────────────────────────────

describe('indoors filter', () => {
  const f = filter('indoors');

  it('passes for library', () => {
    const v = makeVenue({ category: makeCategory('library') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for bowling', () => {
    const v = makeVenue({ category: makeCategory('bowling') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes with "likely" for name containing "museum"', () => {
    const v = makeVenue({ name: "Children's Museum" });
    const r = f.test(v);
    expect(r.passes).toBe(true);
    expect(r.confidence).toBe('likely');
  });

  it('fails for park (outdoor)', () => {
    const v = makeVenue({ category: makeCategory('park') });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parent-friendly
// ─────────────────────────────────────────────────────────────────────────────

describe('parent-friendly filter', () => {
  const f = filter('parent-friendly');

  it('passes when toilets + baby change + parking are present', () => {
    const v = makeVenue({
      facilities: [
        makeFacility('toilet', 'Toilets'),
        makeFacility('baby-change', 'Baby Changing'),
        makeFacility('parking', 'Parking'),
      ],
    });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes when toilets + baby change are present (score = 4)', () => {
    const v = makeVenue({
      facilities: [
        makeFacility('toilet', 'Toilets'),
        makeFacility('baby-change', 'Baby Changing'),
      ],
    });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails when no facilities data', () => {
    const v = makeVenue({ facilities: [] });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when facilities is undefined', () => {
    const v = makeVenue({ facilities: undefined });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when only one weak facility (parking alone is not enough)', () => {
    const v = makeVenue({ facilities: [makeFacility('parking', 'Parking')] });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// easy-parking (hard filter)
// ─────────────────────────────────────────────────────────────────────────────

describe('easy-parking filter (hard)', () => {
  const f = filter('easy-parking');

  it('passes when parking facility is confirmed', () => {
    const v = makeVenue({ facilities: [makeFacility('parking', 'Parking')] });
    expect(f.test(v).passes).toBe(true);
    expect(f.test(v).confidence).toBe('certain');
  });

  it('fails when facilities is empty', () => {
    const v = makeVenue({ facilities: [] });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when facilities is undefined', () => {
    const v = makeVenue({ facilities: undefined });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when only non-parking facilities are present', () => {
    const v = makeVenue({ facilities: [makeFacility('toilet', 'Toilets')] });
    expect(f.test(v).passes).toBe(false);
  });

  it('passes for "car-park" slug variant', () => {
    const v = makeVenue({ facilities: [makeFacility('car-park', 'Car Park')] });
    expect(f.test(v).passes).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// has-cafe (hard filter)
// ─────────────────────────────────────────────────────────────────────────────

describe('has-cafe filter (hard)', () => {
  const f = filter('has-cafe');

  it('passes when cafe facility is confirmed', () => {
    const v = makeVenue({ facilities: [makeFacility('cafe', 'Cafe')] });
    expect(f.test(v).passes).toBe(true);
    expect(f.test(v).confidence).toBe('certain');
  });

  it('passes for "food" slug variant', () => {
    const v = makeVenue({ facilities: [makeFacility('food', 'Food')] });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes for "restaurant" slug variant', () => {
    const v = makeVenue({ facilities: [makeFacility('restaurant', 'Restaurant')] });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails when no facilities', () => {
    const v = makeVenue({ facilities: [] });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when facilities is undefined', () => {
    const v = makeVenue({ facilities: undefined });
    expect(f.test(v).passes).toBe(false);
  });

  it('does NOT infer cafe from venue name alone (hard filter)', () => {
    const v = makeVenue({ name: 'Cafe Playground', facilities: [] });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accessible (hard filter)
// ─────────────────────────────────────────────────────────────────────────────

describe('accessible filter (hard)', () => {
  const f = filter('accessible');

  it('passes when accessibility facility is confirmed', () => {
    const v = makeVenue({ facilities: [makeFacility('accessible', 'Accessible')] });
    expect(f.test(v).passes).toBe(true);
    expect(f.test(v).confidence).toBe('certain');
  });

  it('passes for "wheelchair" slug variant', () => {
    const v = makeVenue({ facilities: [makeFacility('wheelchair', 'Wheelchair Access')] });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails when no facilities', () => {
    const v = makeVenue({ facilities: [] });
    expect(f.test(v).passes).toBe(false);
  });

  it('fails when facilities is undefined', () => {
    const v = makeVenue({ facilities: undefined });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// under-2-hours
// ─────────────────────────────────────────────────────────────────────────────

describe('under-2-hours filter', () => {
  const f = filter('under-2-hours');

  it('passes for playground (quick-visit slug)', () => {
    const v = makeVenue({ category: makeCategory('playground') });
    expect(f.test(v).passes).toBe(true);
    expect(f.test(v).confidence).toBe('likely');
  });

  it('passes for library', () => {
    const v = makeVenue({ category: makeCategory('library') });
    expect(f.test(v).passes).toBe(true);
  });

  it('passes with "likely" for name containing "park"', () => {
    const v = makeVenue({ name: 'Victoria Park' });
    expect(f.test(v).passes).toBe(true);
  });

  it('fails for theme_park (not in quick-visit set)', () => {
    const v = makeVenue({ category: makeCategory('theme_park') });
    expect(f.test(v).passes).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyQuickFilters
// ─────────────────────────────────────────────────────────────────────────────

describe('applyQuickFilters', () => {
  const parkVenue = makeVenue({ id: 'park', category: makeCategory('park') });
  const softPlayVenue = makeVenue({ id: 'sp', category: makeCategory('soft-play') });
  const freeVenue = makeVenue({ id: 'free', price_range: 'free', category: makeCategory('park') });
  const paidVenue = makeVenue({ id: 'paid', price_range: 'budget' });

  it('returns all venues when filterIds is empty', () => {
    const result = applyQuickFilters([parkVenue, softPlayVenue], []);
    expect(result).toHaveLength(2);
  });

  it('sorts outdoor venues first when "outdoors" selected (soft filter — never excludes)', () => {
    // outdoors is a soft filter: all venues return, park surfaces first.
    const result = applyQuickFilters([parkVenue, softPlayVenue], ['outdoors']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('park');
  });

  it('filters to only free venues when "free" selected', () => {
    const result = applyQuickFilters([freeVenue, paidVenue], ['free']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('free');
  });

  it('AND-combines multiple filters (outdoors AND free)', () => {
    const result = applyQuickFilters([parkVenue, softPlayVenue, freeVenue], ['outdoors', 'free']);
    // parkVenue passes 'free' via KNOWN_FREE_SLUGS (park) and 'outdoors' via category.
    // freeVenue passes 'free' via confirmed price_range and 'outdoors' via category.
    // softPlayVenue is excluded: soft-play is indoor and not a KNOWN_FREE_SLUG.
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.id)).toContain('park');
    expect(result.map((v) => v.id)).toContain('free');
  });

  it('hard filter returns empty array when no venues confirm the feature', () => {
    // accessible is a hard filter — when nothing passes, return [] so the
    // caller can render a "no confirmed data" state instead of unrelated venues.
    const result = applyQuickFilters([parkVenue, softPlayVenue], ['accessible']);
    expect(result).toHaveLength(0);
  });

  it('soft filter never returns empty — sorts matching venues first', () => {
    // rainy-day is soft: even when no venue matches, all venues are still returned.
    const outdoorOnlyVenue = makeVenue({ id: 'out', category: makeCategory('park') });
    const result = applyQuickFilters([outdoorOnlyVenue], ['rainy-day']);
    // park is outdoor so rainy-day fails, but soft filter still returns the venue.
    expect(result).toHaveLength(1);
  });

  it('handles unknown filter IDs gracefully (skips them)', () => {
    const result = applyQuickFilters([parkVenue], ['unknown-id' as QuickFilterId]);
    // Unknown filter is silently dropped, no filtering applied.
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseQuickFilterId
// ─────────────────────────────────────────────────────────────────────────────

describe('parseQuickFilterId', () => {
  it('returns a valid id for known filter strings', () => {
    expect(parseQuickFilterId('rainy-day')).toBe('rainy-day');
    expect(parseQuickFilterId('free')).toBe('free');
    expect(parseQuickFilterId('accessible')).toBe('accessible');
  });

  it('returns null for unknown strings (tamper protection)', () => {
    expect(parseQuickFilterId('unknown')).toBeNull();
    expect(parseQuickFilterId("' OR 1=1 --")).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseQuickFilterId(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseQuickFilterId('')).toBeNull();
  });

  it('handles array input (takes first value)', () => {
    expect(parseQuickFilterId(['rainy-day', 'free'])).toBe('rainy-day');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getQuickFilter
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuickFilter', () => {
  it('returns the filter for a valid id', () => {
    const f = getQuickFilter('burn-energy');
    expect(f).toBeDefined();
    expect(f!.label).toBe('Burn Energy');
  });

  it('returns undefined for an unknown id', () => {
    expect(getQuickFilter('not-a-filter')).toBeUndefined();
  });
});
