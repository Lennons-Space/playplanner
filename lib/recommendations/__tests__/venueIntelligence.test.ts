/**
 * Tests for lib/recommendations/venueIntelligence.ts
 *
 * Each test targets a documented behaviour of computeVenueIntelligence().
 * We use minimal venue objects — only the fields each dimension actually reads —
 * so tests stay readable and don't break when unrelated Venue fields change.
 *
 * KEY INVARIANTS:
 *   1. All five scores are always in the 0–100 range.
 *   2. Missing data contributes 0 without throwing.
 *   3. familyScore delegates directly to calculateFamilyScore() — no recomputation.
 *   4. Privacy-safe: no logging, no side effects, no network calls.
 */

import { computeVenueIntelligence } from '../venueIntelligence';
import { calculateFamilyScore } from '../familyScore';
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
    min_age:           0,
    max_age:           16,
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
// Test 1: All 5 scores are in the 0–100 range for a minimal venue
// ─────────────────────────────────────────────────────────────────────────────
describe('Score range invariant', () => {
  test('all 5 scores are numbers in 0–100 for a minimal venue', () => {
    const v = venue({ id: 'v1', name: 'Some Place' });
    const intel = computeVenueIntelligence(v);

    expect(intel.familyScore).toBeGreaterThanOrEqual(0);
    expect(intel.familyScore).toBeLessThanOrEqual(100);

    expect(intel.parentConvenienceScore).toBeGreaterThanOrEqual(0);
    expect(intel.parentConvenienceScore).toBeLessThanOrEqual(100);

    expect(intel.childSuitabilityScore).toBeGreaterThanOrEqual(0);
    expect(intel.childSuitabilityScore).toBeLessThanOrEqual(100);

    expect(intel.trustScore).toBeGreaterThanOrEqual(0);
    expect(intel.trustScore).toBeLessThanOrEqual(100);

    expect(intel.dataConfidenceScore).toBeGreaterThanOrEqual(0);
    expect(intel.dataConfidenceScore).toBeLessThanOrEqual(100);
  });

  test('all 5 scores are numbers (not NaN or undefined)', () => {
    const v = venue({ id: 'v2', name: 'Another Place' });
    const intel = computeVenueIntelligence(v);

    expect(typeof intel.familyScore).toBe('number');
    expect(typeof intel.parentConvenienceScore).toBe('number');
    expect(typeof intel.childSuitabilityScore).toBe('number');
    expect(typeof intel.trustScore).toBe('number');
    expect(typeof intel.dataConfidenceScore).toBe('number');

    expect(Number.isNaN(intel.familyScore)).toBe(false);
    expect(Number.isNaN(intel.parentConvenienceScore)).toBe(false);
    expect(Number.isNaN(intel.childSuitabilityScore)).toBe(false);
    expect(Number.isNaN(intel.trustScore)).toBe(false);
    expect(Number.isNaN(intel.dataConfidenceScore)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: parentConvenienceScore — fully equipped verified venue scores 85+
// ─────────────────────────────────────────────────────────────────────────────
describe('parentConvenienceScore: fully equipped venue', () => {
  test('verified venue with all 4 facility types scores 100', () => {
    const v = venue({
      id: 'pc1',
      name: 'Fully Equipped Centre',
      is_verified: true,
      facilities: [
        facility('parking',     'Parking'),
        facility('cafe',        'Café'),
        facility('toilets',     'Toilets'),
        facility('baby-change', 'Baby Change'),
      ],
    });
    const intel = computeVenueIntelligence(v);
    // parking(25) + cafe(25) + toilets(20) + baby-change(15) + verified(15) = 100
    expect(intel.parentConvenienceScore).toBeGreaterThanOrEqual(85);
    expect(intel.parentConvenienceScore).toBeLessThanOrEqual(100);
  });

  test('verified venue with all 4 facility types scores exactly 100', () => {
    const v = venue({
      id: 'pc1b',
      name: 'Perfect Centre',
      is_verified: true,
      facilities: [
        facility('parking',     'Parking'),
        facility('cafe',        'Café'),
        facility('toilets',     'Toilets'),
        facility('baby-change', 'Baby Change'),
      ],
    });
    const intel = computeVenueIntelligence(v);
    expect(intel.parentConvenienceScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: parentConvenienceScore — venue with no facilities and not verified = 0
// ─────────────────────────────────────────────────────────────────────────────
describe('parentConvenienceScore: no facilities', () => {
  test('venue with empty facilities and not verified scores 0', () => {
    const v = venue({
      id: 'pc2',
      name: 'Bare Venue',
      is_verified: false,
      facilities: [],
    });
    const intel = computeVenueIntelligence(v);
    expect(intel.parentConvenienceScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: childSuitabilityScore — baby welcome + wide age range + active category
// ─────────────────────────────────────────────────────────────────────────────
describe('childSuitabilityScore: baby welcome + active category', () => {
  test('min_age=0, max_age=10, active category scores high', () => {
    const v = venue({
      id: 'cs1',
      name: 'Soft Play World',
      category: cat('soft-play'),
      min_age: 0,
      max_age: 10,
    });
    const intel = computeVenueIntelligence(v);
    // Range: (10-0)/13 * 50 ≈ 38.5, capped at 50 → ~38.5
    // Active category: +25
    // Baby welcome (min_age=0): +25
    // Total: ~88.5 → clamped 100
    expect(intel.childSuitabilityScore).toBeGreaterThanOrEqual(80);
    expect(intel.childSuitabilityScore).toBeLessThanOrEqual(100);
  });

  test('wide age range 0–13 plus active category reaches near-maximum', () => {
    const v = venue({
      id: 'cs2',
      name: 'Adventure Play',
      category: cat('park'),
      min_age: 0,
      max_age: 13,
    });
    const intel = computeVenueIntelligence(v);
    // Range: (13-0)/13 * 50 = 50 (capped), active: +25, baby: +25 → 100
    expect(intel.childSuitabilityScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: childSuitabilityScore — no age data is graceful (0, not a crash)
// ─────────────────────────────────────────────────────────────────────────────
describe('childSuitabilityScore: missing age data', () => {
  test('venue with 0 for both ages (invalid range) handles gracefully', () => {
    const v = venue({
      id: 'cs3',
      name: 'Unknown Place',
      min_age: 0,
      max_age: 0, // max not > min → no age range score
    });
    // Should not throw
    expect(() => computeVenueIntelligence(v)).not.toThrow();
    const intel = computeVenueIntelligence(v);
    expect(intel.childSuitabilityScore).toBeGreaterThanOrEqual(0);
    expect(intel.childSuitabilityScore).toBeLessThanOrEqual(100);
  });

  test('venue with no category and equal ages does not produce NaN', () => {
    const v = venue({
      id: 'cs4',
      name: 'Generic Place',
      min_age: 5,
      max_age: 5, // max not > min
      category: undefined,
    });
    const intel = computeVenueIntelligence(v);
    expect(Number.isNaN(intel.childSuitabilityScore)).toBe(false);
    // No age range, no active category, no baby welcome → 0
    expect(intel.childSuitabilityScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: trustScore — verified + 20 reviews + all data fields = 100
// ─────────────────────────────────────────────────────────────────────────────
describe('trustScore: fully trusted venue', () => {
  test('verified, 20 reviews, all data fields scores 100', () => {
    const v = venue({
      id: 'ts1',
      name: 'Fully Documented Centre',
      is_verified:   true,
      review_count:  20,
      average_rating: 4.5,
      description:   'A well-documented family venue with lots of activities for all ages.',
      price_range:   'budget',
      phone:         '07700000000',
      facilities:    [facility('parking', 'Parking')],
      opening_hours: [
        { id: 'h1', venue_id: 'ts1', day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false, notes: null },
      ],
    });
    const intel = computeVenueIntelligence(v);
    // verified(40) + reviews(30) + all 5 data fields(30) = 100
    expect(intel.trustScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: trustScore — no data at all = 0
// ─────────────────────────────────────────────────────────────────────────────
describe('trustScore: empty venue', () => {
  test('not verified, no reviews, no data fields scores 0', () => {
    const v = venue({
      id: 'ts2',
      name:          'Empty Venue',
      is_verified:   false,
      review_count:  0,
      description:   null,
      price_range:   null,
      phone:         null,
      website:       null,
      facilities:    [],
      opening_hours: [],
    });
    const intel = computeVenueIntelligence(v);
    expect(intel.trustScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: dataConfidenceScore — all 6 fields present = 100
// ─────────────────────────────────────────────────────────────────────────────
describe('dataConfidenceScore: all fields present', () => {
  test('all 6 key fields present scores 100', () => {
    const v = venue({
      id: 'dc1',
      name:          'Complete Venue',
      description:   'More than ten characters here',
      price_range:   'moderate',
      phone:         '07700000000',
      website:       'https://example.com',
      facilities:    [facility('toilets', 'Toilets')],
      opening_hours: [
        { id: 'h1', venue_id: 'dc1', day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false, notes: null },
      ],
    });
    const intel = computeVenueIntelligence(v);
    expect(intel.dataConfidenceScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: dataConfidenceScore — no fields = 0
// ─────────────────────────────────────────────────────────────────────────────
describe('dataConfidenceScore: no fields present', () => {
  test('no key fields present scores 0', () => {
    const v = venue({
      id: 'dc2',
      name:          'Bare Venue',
      description:   null,
      price_range:   null,
      phone:         null,
      website:       null,
      facilities:    [],
      opening_hours: [],
    });
    const intel = computeVenueIntelligence(v);
    expect(intel.dataConfidenceScore).toBe(0);
  });

  test('short description (under 10 chars) does not count', () => {
    const v = venue({
      id: 'dc3',
      name:          'Brief Venue',
      description:   'Short',    // < 10 characters — should not count
      price_range:   null,
      phone:         null,
      website:       null,
      facilities:    [],
      opening_hours: [],
    });
    const intel = computeVenueIntelligence(v);
    expect(intel.dataConfidenceScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: familyScore delegates to calculateFamilyScore
// ─────────────────────────────────────────────────────────────────────────────
describe('familyScore: delegates to calculateFamilyScore', () => {
  test('familyScore matches calculateFamilyScore for a soft-play venue', () => {
    const v = venue({
      id: 'fs1',
      name:          'Soft Play Heaven',
      category:      cat('soft-play'),
      description:   'A large indoor soft-play for babies and toddlers.',
      is_verified:   true,
      price_range:   'budget',
      min_age:       0,
      max_age:       8,
      review_count:  15,
      average_rating: 4.3,
      website:       'https://example.com',
      opening_hours: [
        { id: 'h1', venue_id: 'fs1', day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false, notes: null },
      ],
      facilities: [
        facility('toilets',     'Toilets'),
        facility('cafe',        'Café'),
        facility('baby-change', 'Baby Change'),
        facility('parking',     'Parking'),
      ],
    });

    const intel = computeVenueIntelligence(v);
    const direct = calculateFamilyScore(v);

    expect(intel.familyScore).toBe(direct.familyScore);
  });

  test('familyScore matches calculateFamilyScore for a bare venue', () => {
    const v = venue({ id: 'fs2', name: 'Unknown Place' });
    const intel = computeVenueIntelligence(v);
    const direct = calculateFamilyScore(v);
    expect(intel.familyScore).toBe(direct.familyScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: Partial data combinations are graceful
// ─────────────────────────────────────────────────────────────────────────────
describe('Partial data: no crashes for edge cases', () => {
  test('venue with only phone (no website) counts phone in dataConfidenceScore', () => {
    const v = venue({
      id: 'pd1',
      name:  'Phone Only',
      phone: '07700000000',
    });
    const intel = computeVenueIntelligence(v);
    // Only phone counts → 1/6 * 100 ≈ 17
    expect(intel.dataConfidenceScore).toBeGreaterThan(0);
    expect(intel.dataConfidenceScore).toBeLessThan(50);
  });

  test('partial facilities (cafe only) yields partial parentConvenienceScore', () => {
    const v = venue({
      id: 'pd2',
      name:       'Cafe Venue',
      facilities: [facility('cafe', 'Café')],
    });
    const intel = computeVenueIntelligence(v);
    // Only cafe(25) → 25
    expect(intel.parentConvenienceScore).toBe(25);
  });

  test('active category without age data still earns category bonus', () => {
    const v = venue({
      id: 'pd3',
      name:     'Trampoline Park',
      category: cat('trampoline'),
      min_age:  5,
      max_age:  5, // max not > min — no age range score
    });
    const intel = computeVenueIntelligence(v);
    // Active category: +25, no age range, min_age != 0 → no baby bonus
    expect(intel.childSuitabilityScore).toBe(25);
  });
});
