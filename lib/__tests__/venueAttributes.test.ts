/**
 * Unit tests for lib/venueAttributes.ts
 *
 * Trust rules under test:
 *   - null = unknown → never pass a filter
 *   - never assume free if price_range is null
 *   - never include in rainy-day if category is null/unknown
 *   - never mark toddler-friendly unless in the explicit safe set
 */

import { getVenueAttributes, computeIsOpenNow } from '../venueAttributes';
import type { Venue, OpeningHours } from '@/types';

// ─── Minimal Venue factory ────────────────────────────────────────────────────
// Only populates the fields each test cares about; everything else is safe defaults.
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

// ─── Opening hours helpers ────────────────────────────────────────────────────
function makeHoursRow(
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  opensAt: string | null,
  closesAt: string | null,
  isClosed = false,
): OpeningHours {
  return {
    id: `h-${dayOfWeek}`,
    venue_id: 'v1',
    day_of_week: dayOfWeek,
    opens_at: opensAt,
    closes_at: closesAt,
    is_closed: isClosed,
    notes: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// isFree
// ─────────────────────────────────────────────────────────────────────────────

describe('getVenueAttributes — isFree', () => {
  it('returns null when price_range is null (unknown)', () => {
    const v = makeVenue({ price_range: null });
    expect(getVenueAttributes(v).isFree).toBeNull();
  });

  it('returns true when price_range is "free"', () => {
    const v = makeVenue({ price_range: 'free' });
    expect(getVenueAttributes(v).isFree).toBe(true);
  });

  it('returns false when price_range is "budget"', () => {
    const v = makeVenue({ price_range: 'budget' });
    expect(getVenueAttributes(v).isFree).toBe(false);
  });

  it('returns false when price_range is "premium"', () => {
    const v = makeVenue({ price_range: 'premium' });
    expect(getVenueAttributes(v).isFree).toBe(false);
  });

  it('sets priceConfidence to "unknown" when price_range is null', () => {
    const v = makeVenue({ price_range: null });
    expect(getVenueAttributes(v).priceConfidence).toBe('unknown');
  });

  it('sets priceConfidence to "known" when price_range has a value', () => {
    const v = makeVenue({ price_range: 'free' });
    expect(getVenueAttributes(v).priceConfidence).toBe('known');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isRainyDaySuitable
// ─────────────────────────────────────────────────────────────────────────────

describe('getVenueAttributes — isRainyDaySuitable', () => {
  it('is true for soft-play (known indoor)', () => {
    const v = makeVenue({ category: makeCategory('soft-play') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(true);
  });

  it('is true for indoor-play', () => {
    const v = makeVenue({ category: makeCategory('indoor-play') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(true);
  });

  it('is true for library', () => {
    const v = makeVenue({ category: makeCategory('library') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(true);
  });

  it('is true for swimming', () => {
    const v = makeVenue({ category: makeCategory('swimming') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(true);
  });

  it('is true for sensory', () => {
    const v = makeVenue({ category: makeCategory('sensory') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(true);
  });

  it('is true for bowling', () => {
    const v = makeVenue({ category: makeCategory('bowling') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(true);
  });

  it('is false for park (known outdoor)', () => {
    const v = makeVenue({ category: makeCategory('park') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(false);
  });

  it('is false for outdoor-sports', () => {
    const v = makeVenue({ category: makeCategory('outdoor-sports') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBe(false);
  });

  it('is null for farm (mixed / unknown indoor/outdoor)', () => {
    const v = makeVenue({ category: makeCategory('farm') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBeNull();
  });

  it('is null for cafe (mixed)', () => {
    const v = makeVenue({ category: makeCategory('cafe') });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBeNull();
  });

  it('is null when category is undefined (no join data)', () => {
    const v = makeVenue({ category: undefined });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBeNull();
  });

  it('is null when category slug is null', () => {
    const v = makeVenue({ category: { id: 'x', name: 'X', slug: null as unknown as string, icon: 'map', color: '#000' } });
    expect(getVenueAttributes(v).isRainyDaySuitable).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isIndoor / isOutdoor
// ─────────────────────────────────────────────────────────────────────────────

describe('getVenueAttributes — isIndoor / isOutdoor', () => {
  it('isIndoor=true, isOutdoor=false for trampoline', () => {
    const v = makeVenue({ category: makeCategory('trampoline') });
    const attrs = getVenueAttributes(v);
    expect(attrs.isIndoor).toBe(true);
    expect(attrs.isOutdoor).toBe(false);
  });

  it('isIndoor=false, isOutdoor=true for park', () => {
    const v = makeVenue({ category: makeCategory('park') });
    const attrs = getVenueAttributes(v);
    expect(attrs.isIndoor).toBe(false);
    expect(attrs.isOutdoor).toBe(true);
  });

  it('isIndoor=null, isOutdoor=null for farm', () => {
    const v = makeVenue({ category: makeCategory('farm') });
    const attrs = getVenueAttributes(v);
    expect(attrs.isIndoor).toBeNull();
    expect(attrs.isOutdoor).toBeNull();
  });

  it('isIndoor=null, isOutdoor=null when no category', () => {
    const v = makeVenue({ category: undefined });
    const attrs = getVenueAttributes(v);
    expect(attrs.isIndoor).toBeNull();
    expect(attrs.isOutdoor).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isToddlerFriendly
// ─────────────────────────────────────────────────────────────────────────────

describe('getVenueAttributes — isToddlerFriendly', () => {
  it('is true for library (explicitly safe)', () => {
    const v = makeVenue({ category: makeCategory('library') });
    expect(getVenueAttributes(v).isToddlerFriendly).toBe(true);
  });

  it('is true for soft-play', () => {
    const v = makeVenue({ category: makeCategory('soft-play') });
    expect(getVenueAttributes(v).isToddlerFriendly).toBe(true);
  });

  it('is true for indoor-play', () => {
    const v = makeVenue({ category: makeCategory('indoor-play') });
    expect(getVenueAttributes(v).isToddlerFriendly).toBe(true);
  });

  it('is true for sensory', () => {
    const v = makeVenue({ category: makeCategory('sensory') });
    expect(getVenueAttributes(v).isToddlerFriendly).toBe(true);
  });

  it('is null for park (too variable in practice)', () => {
    const v = makeVenue({ category: makeCategory('park') });
    expect(getVenueAttributes(v).isToddlerFriendly).toBeNull();
  });

  it('is null for swimming (not in explicit safe set)', () => {
    const v = makeVenue({ category: makeCategory('swimming') });
    expect(getVenueAttributes(v).isToddlerFriendly).toBeNull();
  });

  it('is null when no category', () => {
    const v = makeVenue({ category: undefined });
    expect(getVenueAttributes(v).isToddlerFriendly).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isOpenNow (via computeIsOpenNow)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeIsOpenNow', () => {
  beforeAll(() => {
    // Pin time to Wednesday 10:00 AM for deterministic tests.
    // Wednesday = day 3 in JS Date.getDay().
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-10T10:00:00.000Z')); // Wednesday
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns null when opening_hours is absent', () => {
    const v = makeVenue({ opening_hours: undefined });
    expect(computeIsOpenNow(v)).toBeNull();
  });

  it('returns null when opening_hours is an empty array', () => {
    const v = makeVenue({ opening_hours: [] });
    expect(computeIsOpenNow(v)).toBeNull();
  });

  it('returns null when there is no row for today', () => {
    // Only a Monday row (day 1), but today is Wednesday (day 3).
    const v = makeVenue({ opening_hours: [makeHoursRow(1, '09:00', '17:00')] });
    expect(computeIsOpenNow(v)).toBeNull();
  });

  it('returns null when the venue is marked closed today', () => {
    const v = makeVenue({
      opening_hours: [makeHoursRow(3, '09:00', '17:00', true)],
    });
    expect(computeIsOpenNow(v)).toBeNull();
  });

  it('returns null when opens_at is null', () => {
    const v = makeVenue({
      opening_hours: [makeHoursRow(3, null, '17:00')],
    });
    expect(computeIsOpenNow(v)).toBeNull();
  });

  it('returns null when closes_at is null', () => {
    const v = makeVenue({
      opening_hours: [makeHoursRow(3, '09:00', null)],
    });
    expect(computeIsOpenNow(v)).toBeNull();
  });

  it('returns true when current time is within opening hours', () => {
    // Current time pinned to 10:00 UTC. The row opens 09:00 and closes 17:00.
    // Note: new Date('2024-01-10T10:00:00.000Z') — getHours() is UTC in Jest env.
    const v = makeVenue({
      opening_hours: [makeHoursRow(3, '09:00', '17:00')],
    });
    expect(computeIsOpenNow(v)).toBe(true);
  });

  it('returns false when current time is before opening hours', () => {
    // 10:00 is after 11:00 open time → closed.
    const v = makeVenue({
      opening_hours: [makeHoursRow(3, '11:00', '17:00')],
    });
    expect(computeIsOpenNow(v)).toBe(false);
  });

  it('returns false when current time is after closing hours', () => {
    // 10:00 is after 09:30 close time → closed.
    const v = makeVenue({
      opening_hours: [makeHoursRow(3, '08:00', '09:30')],
    });
    expect(computeIsOpenNow(v)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getVenueAttributes — isOpenNow delegation
// ─────────────────────────────────────────────────────────────────────────────

describe('getVenueAttributes — isOpenNow', () => {
  it('returns null when no opening_hours', () => {
    const v = makeVenue({ opening_hours: undefined });
    expect(getVenueAttributes(v).isOpenNow).toBeNull();
  });
});
