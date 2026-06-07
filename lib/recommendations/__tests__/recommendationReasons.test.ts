/**
 * Tests for lib/recommendations/recommendationReasons.ts
 *
 * Each describe block targets one documented behaviour.
 * We use minimal venue objects — only the fields each reason condition actually reads.
 *
 * KEY INVARIANTS:
 *   1. Each of the 7 reasons fires when conditions are met.
 *   2. No reason fires when conditions are NOT met.
 *   3. Max 3 reasons are returned regardless of how many qualify.
 *   4. A bare venue with no data produces an empty array.
 */

import { generateRecommendationReasons } from '../recommendationReasons';
import type { Venue } from '@/types';

// ── Minimal venue factory ─────────────────────────────────────────────────────
function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    slug:              null,
    description:       null,
    category_id:       null,
    category:          undefined,
    address_line1:     null,
    address_line2:     null,
    city:              'Test City',
    postcode:          null,
    country:           'GB',
    latitude:          51.5,
    longitude:         -0.1,
    phone:             null,
    email:             null,
    website:           null,
    price_range:       null,
    min_age:           5,       // not <=2 by default so toddler doesn't auto-fire
    max_age:           12,
    is_published:      true,
    is_verified:       false,
    is_premium:        false,
    featured_until:    null,
    claimed_by:        null,
    submitted_by:      null,
    moderation_status: 'approved',
    osm_id:            null,
    data_source:       null,
    license:           null,
    moderation_notes:  null,
    moderated_by:      null,
    moderated_at:      null,
    review_count:      0,
    average_rating:    0,
    photos:            [],
    facilities:        [],
    opening_hours:     [],
    created_at:        '2024-01-01T00:00:00Z',
    updated_at:        '2024-01-01T00:00:00Z',
    ...over,
  } as Venue;
}

function cat(slug: string) {
  return { id: slug, name: slug, slug, icon: '', color: '#000' };
}

function facility(slug: string, name: string) {
  return { id: slug, name, slug, icon: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reason 1: Family Favourite
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Family Favourite', () => {
  test('fires when average_rating >= 4.5 and review_count >= 10', () => {
    const v = venue({ id: 'r1', name: 'Popular Park', average_rating: 4.7, review_count: 15 });
    expect(generateRecommendationReasons(v)).toContain('Family Favourite');
  });

  test('does not fire when rating is exactly 4.5 but review_count is 9', () => {
    const v = venue({ id: 'r1b', name: 'Not Enough Reviews', average_rating: 4.5, review_count: 9 });
    expect(generateRecommendationReasons(v)).not.toContain('Family Favourite');
  });

  test('does not fire when review_count >= 10 but rating is 4.4', () => {
    const v = venue({ id: 'r1c', name: 'Decent But Not Top', average_rating: 4.4, review_count: 12 });
    expect(generateRecommendationReasons(v)).not.toContain('Family Favourite');
  });

  test('does not fire for zero reviews', () => {
    const v = venue({ id: 'r1d', name: 'New Venue', average_rating: 0, review_count: 0 });
    expect(generateRecommendationReasons(v)).not.toContain('Family Favourite');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason 2: Great For Toddlers
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Great For Toddlers', () => {
  // Discovery Sprint A (P2): min_age is an OSM-import DEFAULT catalogue-wide
  // (scripts/import/02_transform_osm.js SLUG_AGES sets attraction/
  // animal-attraction/etc. to min_age=0 with no real assessment). Trusting
  // `min_age <= 2` as a positive signal falsely badged the London Dungeon,
  // SEA LIFE and Shrek's Adventure as toddler-friendly. The signal is now
  // CATEGORY-ONLY — see TODDLER_SLUGS in recommendationReasons.ts.

  test('does NOT fire on min_age <= 2 alone (untrusted default, no toddler category)', () => {
    const v = venue({ id: 'r2a', name: 'Baby Centre', category: cat('attraction'), min_age: 0 });
    expect(generateRecommendationReasons(v)).not.toContain('Great For Toddlers');
  });

  test('does NOT fire on min_age = 2 alone (untrusted default, no toddler category)', () => {
    const v = venue({ id: 'r2b', name: 'Toddler Place', category: cat('attraction'), min_age: 2 });
    expect(generateRecommendationReasons(v)).not.toContain('Great For Toddlers');
  });

  test('fires when category slug is soft-play (regardless of min_age)', () => {
    const v = venue({ id: 'r2c', name: 'Soft Play', category: cat('soft-play'), min_age: 5 });
    expect(generateRecommendationReasons(v)).toContain('Great For Toddlers');
  });

  test('fires when category slug is sensory', () => {
    const v = venue({ id: 'r2d', name: 'Sensory Room', category: cat('sensory'), min_age: 5 });
    expect(generateRecommendationReasons(v)).toContain('Great For Toddlers');
  });

  test('fires when category slug is library', () => {
    const v = venue({ id: 'r2e', name: 'Local Library', category: cat('library'), min_age: 5 });
    expect(generateRecommendationReasons(v)).toContain('Great For Toddlers');
  });

  test('does not fire when min_age is 3 and no toddler category', () => {
    const v = venue({ id: 'r2f', name: 'Sports Hall', category: cat('bowling'), min_age: 3 });
    expect(generateRecommendationReasons(v)).not.toContain('Great For Toddlers');
  });

  test('does not fire for a high min_age with unrelated category', () => {
    const v = venue({ id: 'r2g', name: 'Teen Zone', category: cat('skating'), min_age: 10 });
    expect(generateRecommendationReasons(v)).not.toContain('Great For Toddlers');
  });

  // Regression: the exact audit-flagged false positives must never re-appear.
  test('does NOT fire for attraction venues with defaulted min_age=0 (London Dungeon-style)', () => {
    const v = venue({ id: 'r2h', name: 'The London Dungeon', category: cat('attraction'), min_age: 0, max_age: 18 });
    expect(generateRecommendationReasons(v)).not.toContain('Great For Toddlers');
  });

  test('does NOT fire for animal-attraction venues with defaulted min_age=0 (SEA LIFE-style)', () => {
    const v = venue({ id: 'r2i', name: 'SEA LIFE Aquarium', category: cat('animal-attraction'), min_age: 0, max_age: 18 });
    expect(generateRecommendationReasons(v)).not.toContain('Great For Toddlers');
  });

  test('fires for playground category (Covent Garden Playground-style)', () => {
    const v = venue({ id: 'r2j', name: 'Covent Garden Playground', category: cat('playground'), min_age: 0, max_age: 16 });
    expect(generateRecommendationReasons(v)).toContain('Great For Toddlers');
  });

  test('fires for soft-play category (genuine toddler venue)', () => {
    const v = venue({ id: 'r2k', name: 'Tiny Tots Soft Play', category: cat('soft-play'), min_age: 0, max_age: 5 });
    expect(generateRecommendationReasons(v)).toContain('Great For Toddlers');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason 3: Rainy Day Winner
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Rainy Day Winner', () => {
  test('fires for indoor-play category', () => {
    const v = venue({ id: 'r3a', name: 'Indoor Play', category: cat('indoor-play') });
    expect(generateRecommendationReasons(v)).toContain('Rainy Day Winner');
  });

  test('fires for swimming category', () => {
    const v = venue({ id: 'r3b', name: 'Swim Centre', category: cat('swimming') });
    expect(generateRecommendationReasons(v)).toContain('Rainy Day Winner');
  });

  test('fires for cinema category', () => {
    const v = venue({ id: 'r3c', name: 'Local Cinema', category: cat('cinema') });
    expect(generateRecommendationReasons(v)).toContain('Rainy Day Winner');
  });

  test('fires for museum (via arts in INDOOR_SLUGS)', () => {
    const v = venue({ id: 'r3d', name: 'Arts Centre', category: cat('arts') });
    expect(generateRecommendationReasons(v)).toContain('Rainy Day Winner');
  });

  test('does not fire for park (outdoor category)', () => {
    const v = venue({ id: 'r3e', name: 'Open Park', category: cat('park') });
    expect(generateRecommendationReasons(v)).not.toContain('Rainy Day Winner');
  });

  test('does not fire with no category', () => {
    const v = venue({ id: 'r3f', name: 'Unknown Place' });
    expect(generateRecommendationReasons(v)).not.toContain('Rainy Day Winner');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason 4: Burn Energy
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Burn Energy', () => {
  test('fires for trampoline category', () => {
    const v = venue({ id: 'r4a', name: 'Jump Zone', category: cat('trampoline') });
    expect(generateRecommendationReasons(v)).toContain('Burn Energy');
  });

  test('fires for park category', () => {
    const v = venue({ id: 'r4b', name: 'Adventure Park', category: cat('park') });
    expect(generateRecommendationReasons(v)).toContain('Burn Energy');
  });

  test('fires for climbing category', () => {
    const v = venue({ id: 'r4c', name: 'Climbing Wall', category: cat('climbing') });
    expect(generateRecommendationReasons(v)).toContain('Burn Energy');
  });

  test('does not fire for library (calm category)', () => {
    const v = venue({ id: 'r4d', name: 'Quiet Library', category: cat('library'), min_age: 5 });
    // library is in TODDLER_SLUGS and INDOOR_SLUGS but NOT ENERGY_SLUGS
    // min_age 5 means no toddler reason, but indoor could fire before energy
    // regardless, energy should NOT be in the results for library
    const reasons = generateRecommendationReasons(v);
    expect(reasons).not.toContain('Burn Energy');
  });

  test('does not fire with no category', () => {
    const v = venue({ id: 'r4e', name: 'No Category Venue' });
    expect(generateRecommendationReasons(v)).not.toContain('Burn Energy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason 5: Parent Friendly
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Parent Friendly', () => {
  test('fires when venue has toilet AND baby-change facilities', () => {
    const v = venue({
      id: 'r5a',
      name: 'Well Equipped Centre',
      facilities: [
        facility('toilet', 'Toilets'),
        facility('baby-change', 'Baby Change'),
      ],
    });
    expect(generateRecommendationReasons(v)).toContain('Parent Friendly');
  });

  test('fires when toilet + baby-change + parking all present (score 3)', () => {
    const v = venue({
      id: 'r5b',
      name: 'Full Service Centre',
      facilities: [
        facility('toilet', 'Toilets'),
        facility('baby-change', 'Baby Change'),
        facility('parking', 'Car Park'),
      ],
    });
    expect(generateRecommendationReasons(v)).toContain('Parent Friendly');
  });

  test('fires with wc slug (toilet alias)', () => {
    const v = venue({
      id: 'r5c',
      name: 'WC Centre',
      facilities: [
        facility('wc', 'WC'),
        facility('baby-change', 'Baby Change'),
      ],
    });
    expect(generateRecommendationReasons(v)).toContain('Parent Friendly');
  });

  test('fires with baby_change (underscore slug variant)', () => {
    const v = venue({
      id: 'r5d',
      name: 'Baby Facility',
      facilities: [
        facility('toilet', 'Toilets'),
        facility('baby_change', 'Baby Changing'),
      ],
    });
    expect(generateRecommendationReasons(v)).toContain('Parent Friendly');
  });

  test('does not fire with only toilet (no baby-change)', () => {
    const v = venue({
      id: 'r5e',
      name: 'Toilet Only',
      facilities: [
        facility('toilet', 'Toilets'),
      ],
    });
    // toilet=1, baby-change=0, parking=0 → score=1, NOT (toilet && baby-change) → false
    expect(generateRecommendationReasons(v)).not.toContain('Parent Friendly');
  });

  test('does not fire with no facilities', () => {
    const v = venue({ id: 'r5f', name: 'Bare Venue', facilities: [] });
    expect(generateRecommendationReasons(v)).not.toContain('Parent Friendly');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason 6: Budget Friendly
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Budget Friendly', () => {
  test('fires when price_range is free', () => {
    const v = venue({ id: 'r6a', name: 'Free Park', price_range: 'free' });
    expect(generateRecommendationReasons(v)).toContain('Budget Friendly');
  });

  test('fires when price_range is budget', () => {
    const v = venue({ id: 'r6b', name: 'Cheap Venue', price_range: 'budget' });
    expect(generateRecommendationReasons(v)).toContain('Budget Friendly');
  });

  test('does not fire when price_range is moderate', () => {
    const v = venue({ id: 'r6c', name: 'Moderate Place', price_range: 'moderate' });
    expect(generateRecommendationReasons(v)).not.toContain('Budget Friendly');
  });

  test('does not fire when price_range is premium', () => {
    const v = venue({ id: 'r6d', name: 'Premium Venue', price_range: 'premium' });
    expect(generateRecommendationReasons(v)).not.toContain('Budget Friendly');
  });

  test('does not fire when price_range is null', () => {
    const v = venue({ id: 'r6e', name: 'Unknown Price', price_range: null });
    expect(generateRecommendationReasons(v)).not.toContain('Budget Friendly');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reason 7: Full Day Adventure
// ─────────────────────────────────────────────────────────────────────────────
describe('Reason: Full Day Adventure', () => {
  test('fires for zoo category', () => {
    const v = venue({ id: 'r7a', name: 'City Zoo', category: cat('zoo') });
    expect(generateRecommendationReasons(v)).toContain('Full Day Adventure');
  });

  test('fires for theme-park category', () => {
    const v = venue({ id: 'r7b', name: 'Theme Park', category: cat('theme-park') });
    expect(generateRecommendationReasons(v)).toContain('Full Day Adventure');
  });

  test('fires for farm category', () => {
    const v = venue({ id: 'r7c', name: 'Family Farm', category: cat('farm') });
    expect(generateRecommendationReasons(v)).toContain('Full Day Adventure');
  });

  test('fires for aquarium category', () => {
    const v = venue({ id: 'r7d', name: 'Sea Life Centre', category: cat('aquarium') });
    expect(generateRecommendationReasons(v)).toContain('Full Day Adventure');
  });

  test('does not fire for park (quick visit category)', () => {
    const v = venue({ id: 'r7e', name: 'Local Park', category: cat('park') });
    expect(generateRecommendationReasons(v)).not.toContain('Full Day Adventure');
  });

  test('does not fire with no category', () => {
    const v = venue({ id: 'r7f', name: 'Unknown Place' });
    expect(generateRecommendationReasons(v)).not.toContain('Full Day Adventure');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Max-3 cap
// ─────────────────────────────────────────────────────────────────────────────
describe('Max-3 cap', () => {
  test('returns at most 3 reasons even when 4+ qualify', () => {
    // This venue qualifies for:
    //   1. Family Favourite (rating 4.8, 20 reviews)
    //   2. Great For Toddlers (category=soft-play, in TODDLER_SLUGS)
    //   3. Rainy Day Winner (soft-play is in INDOOR_SLUGS)
    //   4. Burn Energy (soft-play is in ENERGY_SLUGS)
    // Priority order stops at 3.
    const v = venue({
      id: 'cap1',
      name: 'Super Soft Play',
      category: cat('soft-play'),
      min_age: 0,
      average_rating: 4.8,
      review_count: 20,
    });
    const reasons = generateRecommendationReasons(v);
    expect(reasons.length).toBeLessThanOrEqual(3);
    expect(reasons.length).toBe(3);
  });

  test('priority order is respected — Family Favourite appears before later reasons', () => {
    const v = venue({
      id: 'cap2',
      name: 'Top Rated Indoor',
      category: cat('soft-play'),
      min_age: 0,
      average_rating: 4.9,
      review_count: 25,
    });
    const reasons = generateRecommendationReasons(v);
    expect(reasons[0]).toBe('Family Favourite');
    expect(reasons[1]).toBe('Great For Toddlers');
    expect(reasons[2]).toBe('Rainy Day Winner');
  });

  test('returns fewer than 3 when only 1 reason qualifies', () => {
    const v = venue({
      id: 'cap3',
      name: 'Budget Venue Only',
      price_range: 'free',
    });
    const reasons = generateRecommendationReasons(v);
    expect(reasons).toContain('Budget Friendly');
    expect(reasons.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bare venue — no reasons fire
// ─────────────────────────────────────────────────────────────────────────────
describe('Bare venue', () => {
  test('returns empty array for a venue with no data signals', () => {
    const v = venue({
      id: 'bare1',
      name: 'Empty Place',
      // no category, no rating, no facilities, no price_range
      // min_age defaults to 5 in our factory (not <=2)
    });
    const reasons = generateRecommendationReasons(v);
    expect(reasons).toEqual([]);
  });

  test('does not throw for a minimally constructed venue', () => {
    const v = venue({ id: 'bare2', name: 'Minimal' });
    expect(() => generateRecommendationReasons(v)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Facility shape: nested { facility: { slug, name } }
// ─────────────────────────────────────────────────────────────────────────────
describe('Facility shape: nested join shape', () => {
  test('hasFacility works with nested { facility: {...} } shape', () => {
    const v = venue({
      id: 'ns1',
      name: 'Nested Facility Venue',
      facilities: [
        // Nested join shape returned by venue_facilities join
        { facility: { id: 'toilet', name: 'Toilets', slug: 'toilet', icon: '' } } as unknown as import('@/types').Facility,
        { facility: { id: 'baby-change', name: 'Baby Change', slug: 'baby-change', icon: '' } } as unknown as import('@/types').Facility,
      ],
    });
    expect(generateRecommendationReasons(v)).toContain('Parent Friendly');
  });
});
