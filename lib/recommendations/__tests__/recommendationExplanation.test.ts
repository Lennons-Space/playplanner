/**
 * Tests for lib/recommendations/recommendationExplanation.ts
 *
 * Core invariants verified here:
 *   1. Known high-quality venues produce the expected title.
 *   2. Each reason fires only when its data condition is met.
 *   3. No reason fires when the condition is NOT met.
 *   4. A near-empty venue (no data signals) returns null — never fabricated reasons.
 *   5. result.reasons is always 1–5 items when result is non-null.
 *   6. result.title is always present (non-empty string) when result is non-null.
 *   7. Specific forbidden fabrications: ages, reviews, facilities, price never
 *      appear when the corresponding data fields do not support them.
 */

import { generateRecommendationExplanation } from '../recommendationExplanation';
import type { Venue } from '@/types';

// ── Minimal venue factory ─────────────────────────────────────────────────────
// Matches the factory pattern in recommendationReasons.test.ts and
// venueIntelligence.test.ts for consistency across the test suite.

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
    // min_age/max_age default to 0 (= unset) so age reason does NOT auto-fire.
    min_age:           0,
    max_age:           0,
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
// Title: Family Favourite
// ─────────────────────────────────────────────────────────────────────────────
describe('Title: Family Favourite', () => {
  test('returns "Family Favourite" when familyScore>=70 AND rating>=4.5 AND reviews>=10', () => {
    // soft-play gives a high familyScore via calculateFamilyScore
    const v = venue({
      id: 'ff1',
      name: 'Super Soft Play',
      category: cat('soft-play'),
      average_rating: 4.8,
      review_count: 25,
      is_verified: true,
      min_age: 0,
      max_age: 10,
      price_range: 'budget',
      description: 'A top-rated soft play centre for all the family.',
      opening_hours: [
        { id: 'h1', venue_id: 'ff1', day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false, notes: null },
      ],
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Family Favourite');
  });

  test('includes "Strong family reviews" in reasons', () => {
    const v = venue({
      id: 'ff2',
      name: 'Busy Soft Play',
      category: cat('soft-play'),
      average_rating: 4.6,
      review_count: 15,
      is_verified: true,
      description: 'A great soft play for all ages of children.',
      opening_hours: [
        { id: 'h1', venue_id: 'ff2', day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false, notes: null },
      ],
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Strong family reviews');
  });

  test('does NOT return Family Favourite when reviews < 10', () => {
    const v = venue({
      id: 'ff3',
      name: 'New Soft Play',
      category: cat('soft-play'),
      average_rating: 4.9,
      review_count: 5,
    });
    const result = generateRecommendationExplanation(v);
    // May return a result, but the title should NOT be Family Favourite
    if (result !== null) {
      expect(result.title).not.toBe('Family Favourite');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Title: Great For Toddlers
// ─────────────────────────────────────────────────────────────────────────────
describe('Title: Great For Toddlers', () => {
  // Discovery Sprint A (P2): the title is now CATEGORY-ONLY. We previously
  // also required "confirmed age data" (min_age > 0 || max_age > 0) AND
  // min_age <= 3 — but min_age/max_age are OSM-import DEFAULTS catalogue-wide
  // (scripts/import/02_transform_osm.js SLUG_AGES), so that "safeguard" was
  // satisfied by thousands of never-assessed attractions (London Dungeon,
  // SEA LIFE — both min_age=0/max_age=18). Category (venue TYPE) is the only
  // trustworthy signal — see TODDLER_SLUGS / lib/toddlerSafeCategories.ts.

  test('returns "Great For Toddlers" for a toddler-category venue regardless of age data', () => {
    const v = venue({
      id: 'gt1',
      name: 'Baby Sensory World',
      category: cat('sensory'),
      min_age: 0,
      max_age: 3,
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Great For Toddlers');
  });

  test('fires for soft-play category with min_age=1', () => {
    const v = venue({
      id: 'gt2',
      name: 'Soft Play Barn',
      category: cat('soft-play'),
      min_age: 1,
      max_age: 8,
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Great For Toddlers');
  });

  test('includes age reason in reasons list when age data is present', () => {
    const v = venue({
      id: 'gt3',
      name: 'Toddler Group',
      category: cat('toddler-group'),
      min_age: 0,
      max_age: 4,
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    // Should show age range since both min and max are set (but 0 = unset, only max > 0 here)
    const hasAgeReason = result!.reasons.some((r) => r.includes('age') || r.includes('Age'));
    expect(hasAgeReason).toBe(true);
  });

  test('fires for toddler category even when age data is absent (both 0) — category is the trusted signal', () => {
    const v = venue({
      id: 'gt4',
      name: 'Soft Play (no age)',
      category: cat('soft-play'),
      min_age: 0,  // unset
      max_age: 0,  // unset
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Great For Toddlers');
  });

  test('does NOT fire for attraction venues with defaulted min_age=0 (London Dungeon-style)', () => {
    const v = venue({
      id: 'gt5',
      name: 'The London Dungeon',
      category: cat('attraction'),
      min_age: 0,
      max_age: 18,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.title).not.toBe('Great For Toddlers');
    }
  });

  test('does NOT fire for animal-attraction venues with defaulted min_age=0 (SEA LIFE-style)', () => {
    const v = venue({
      id: 'gt6',
      name: 'SEA LIFE Aquarium',
      category: cat('animal-attraction'),
      min_age: 0,
      max_age: 18,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.title).not.toBe('Great For Toddlers');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Title: Rainy Day Winner
// ─────────────────────────────────────────────────────────────────────────────
describe('Title: Rainy Day Winner', () => {
  test('returns "Rainy Day Winner" for indoor-play category', () => {
    const v = venue({
      id: 'rd1',
      name: 'Indoor Play Centre',
      category: cat('indoor-play'),
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Rainy Day Winner');
  });

  test('returns "Rainy Day Winner" for cinema category', () => {
    const v = venue({
      id: 'rd2',
      name: 'Kids Cinema',
      category: cat('cinema'),
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Rainy Day Winner');
  });

  test('includes "Indoor venue for rainy days" in reasons', () => {
    const v = venue({
      id: 'rd3',
      name: 'Bowling Alley',
      category: cat('bowling'),
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Indoor venue for rainy days');
  });

  test('does NOT return Rainy Day Winner for a park (outdoor category)', () => {
    const v = venue({
      id: 'rd4',
      name: 'Open Park',
      category: cat('park'),
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.title).not.toBe('Rainy Day Winner');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Title: Parent Friendly (>=2 supporting facilities)
// ─────────────────────────────────────────────────────────────────────────────
describe('Title: Parent Friendly (>=2 facilities)', () => {
  test('returns "Parent Friendly" title when venue has toilet + baby-change', () => {
    const v = venue({
      id: 'pf1',
      name: 'Well-Equipped Centre',
      facilities: [
        facility('toilet', 'Toilets'),
        facility('baby-change', 'Baby Change'),
      ],
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Parent Friendly');
  });

  test('"Parent-friendly facilities" reason appears in result', () => {
    const v = venue({
      id: 'pf2',
      name: 'Full Service Centre',
      facilities: [
        facility('parking', 'Car Park'),
        facility('cafe', 'Cafe'),
        facility('toilet', 'Toilets'),
      ],
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Parent-friendly facilities');
  });

  test('does NOT show Parent Friendly title for only 1 facility', () => {
    const v = venue({
      id: 'pf3',
      name: 'Toilet Only Venue',
      facilities: [facility('toilet', 'Toilets')],
    });
    const result = generateRecommendationExplanation(v);
    // With only 1 facility and no category, result may be null
    if (result !== null) {
      expect(result.title).not.toBe('Parent Friendly');
      expect(result.reasons).not.toContain('Parent-friendly facilities');
    }
  });

  test('fires with the nested { facility: {...} } join shape', () => {
    const v = venue({
      id: 'pf4',
      name: 'Nested Facility Venue',
      facilities: [
        { facility: { id: 'toilet', name: 'Toilets', slug: 'toilet', icon: '' } } as unknown as import('@/types').Facility,
        { facility: { id: 'baby-change', name: 'Baby Change', slug: 'baby-change', icon: '' } } as unknown as import('@/types').Facility,
      ],
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Parent-friendly facilities');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing data: near-empty venue should return null OR zero fabricated reasons
// ─────────────────────────────────────────────────────────────────────────────
describe('Missing data: near-empty venue', () => {
  test('returns null for a venue with no data signals', () => {
    // min_age=0, max_age=0 → no age reason
    // no category → no indoor/outdoor/energy reason
    // review_count=0 → no review reasons
    // no facilities → no facilities reason
    // price_range=null → no price reason
    // is_verified=false → no verified reason
    const v = venue({
      id: 'empty1',
      name: 'Empty Place',
    });
    const result = generateRecommendationExplanation(v);
    expect(result).toBeNull();
  });

  test('does not throw for a minimally constructed venue', () => {
    const v = venue({ id: 'empty2', name: 'Minimal' });
    expect(() => generateRecommendationExplanation(v)).not.toThrow();
  });

  test('near-empty venue: result is null (no fabrication)', () => {
    const v = venue({
      id: 'empty3',
      name: 'No Data Venue',
      min_age: 0,
      max_age: 0,
      review_count: 0,
      average_rating: 0,
      price_range: null,
      facilities: [],
      is_verified: false,
      category: undefined,
    });
    expect(generateRecommendationExplanation(v)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No fabricated reasons
// ─────────────────────────────────────────────────────────────────────────────
describe('No fabricated reasons', () => {
  test('review_count=0 never yields "Strong family reviews"', () => {
    const v = venue({
      id: 'nf1',
      name: 'No Reviews Venue',
      category: cat('soft-play'),
      review_count: 0,
      average_rating: 0,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Strong family reviews');
    }
  });

  test('review_count=0 never yields "Popular with local families"', () => {
    const v = venue({
      id: 'nf2',
      name: 'New Venue',
      category: cat('park'),
      review_count: 0,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Popular with local families');
    }
  });

  test('review_count=9 with rating=4.9 does NOT yield "Strong family reviews" (needs >=10)', () => {
    const v = venue({
      id: 'nf3',
      name: 'Nearly There',
      category: cat('soft-play'),
      review_count: 9,
      average_rating: 4.9,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Strong family reviews');
    }
  });

  test('price_range=null never yields "Free entry" or "Budget-friendly day out"', () => {
    const v = venue({
      id: 'nf4',
      name: 'Unknown Price Venue',
      category: cat('soft-play'),
      price_range: null,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Free entry');
      expect(result.reasons).not.toContain('Budget-friendly day out');
    }
  });

  test('price_range=moderate does NOT yield price reasons', () => {
    const v = venue({
      id: 'nf5',
      name: 'Moderate Venue',
      category: cat('park'),
      price_range: 'moderate',
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Free entry');
      expect(result.reasons).not.toContain('Budget-friendly day out');
    }
  });

  test('min_age=0, max_age=0 never yields an age reason', () => {
    // 0/0 means "unset" in this codebase
    const v = venue({
      id: 'nf6',
      name: 'Unknown Age Venue',
      category: cat('soft-play'),
      min_age: 0,
      max_age: 0,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      const ageReasons = result.reasons.filter(
        (r) => r.toLowerCase().includes('suitable') || r.toLowerCase().includes('age'),
      );
      expect(ageReasons).toHaveLength(0);
    }
  });

  test('no facilities never yields "Parent-friendly facilities"', () => {
    const v = venue({
      id: 'nf7',
      name: 'No Facilities Venue',
      category: cat('park'),
      facilities: [],
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Parent-friendly facilities');
    }
  });

  test('is_verified=false never yields "Verified venue"', () => {
    const v = venue({
      id: 'nf8',
      name: 'Unverified Venue',
      category: cat('park'),
      is_verified: false,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      expect(result.reasons).not.toContain('Verified venue');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Max 5 reasons invariant / title+reasons integrity
// ─────────────────────────────────────────────────────────────────────────────
describe('Invariants: 1–5 reasons + title when result is non-null', () => {
  test('reasons array has at least 1 item when result is non-null', () => {
    const v = venue({
      id: 'inv1',
      name: 'At Least One',
      price_range: 'free',
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons.length).toBeGreaterThanOrEqual(1);
  });

  test('reasons array has at most 5 items, even for a venue with many signals', () => {
    const v = venue({
      id: 'inv2',
      name: 'Everything Venue',
      category: cat('soft-play'),
      min_age: 0,
      max_age: 10,
      average_rating: 4.9,
      review_count: 50,
      price_range: 'free',
      is_verified: true,
      facilities: [
        facility('toilet', 'Toilets'),
        facility('baby-change', 'Baby Change'),
        facility('parking', 'Parking'),
        facility('cafe', 'Cafe'),
      ],
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons.length).toBeGreaterThanOrEqual(1);
    expect(result!.reasons.length).toBeLessThanOrEqual(5);
  });

  test('title is always a non-empty string when result is non-null', () => {
    const v = venue({
      id: 'inv3',
      name: 'Title Check',
      category: cat('park'),
    });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(typeof result!.title).toBe('string');
    expect(result!.title.length).toBeGreaterThan(0);
  });

  test('reasons contains no duplicate strings', () => {
    const v = venue({
      id: 'inv4',
      name: 'Dedupe Check',
      category: cat('soft-play'),
      average_rating: 4.7,
      review_count: 20,
      price_range: 'budget',
      is_verified: true,
    });
    const result = generateRecommendationExplanation(v);
    if (result !== null) {
      const unique = new Set(result.reasons);
      expect(unique.size).toBe(result.reasons.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Specific condition checks: price reasons
// ─────────────────────────────────────────────────────────────────────────────
describe('Price reasons', () => {
  test('"Free entry" fires for price_range=free', () => {
    const v = venue({ id: 'pr1', name: 'Free Park', price_range: 'free', category: cat('park') });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Free entry');
  });

  test('"Budget-friendly day out" fires for price_range=budget', () => {
    const v = venue({ id: 'pr2', name: 'Cheap Venue', price_range: 'budget', category: cat('park') });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Budget-friendly day out');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Specific condition checks: verified reason
// ─────────────────────────────────────────────────────────────────────────────
describe('Verified reason', () => {
  test('"Verified venue" fires for is_verified=true', () => {
    const v = venue({ id: 'vr1', name: 'Verified Park', category: cat('park'), is_verified: true });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Verified venue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outdoor Adventure title
// ─────────────────────────────────────────────────────────────────────────────
describe('Title: Outdoor Adventure', () => {
  test('returns "Outdoor Adventure" for farm category', () => {
    const v = venue({ id: 'oa1', name: 'Family Farm', category: cat('farm') });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Outdoor Adventure');
  });

  test('returns "Outdoor Adventure" for beach category', () => {
    const v = venue({ id: 'oa2', name: 'Seaside Beach', category: cat('beach') });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Outdoor Adventure');
  });

  test('includes "Outdoor space to explore" reason', () => {
    const v = venue({ id: 'oa3', name: 'Nature Reserve', category: cat('nature-reserve') });
    const result = generateRecommendationExplanation(v);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('Outdoor space to explore');
  });
});
