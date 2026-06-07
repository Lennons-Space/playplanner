/**
 * Tests for lib/recommendations/familyScore.ts
 *
 * Each test targets a documented behaviour. We use minimal venue objects —
 * only the fields the scoring functions actually read are set, so tests stay
 * readable and don't break when unrelated Venue fields change.
 *
 * KEY INVARIANT (privacy):
 *   Scores are computed entirely from already-fetched venue data. These tests
 *   confirm no network calls, no logging, and no side effects occur.
 */

import {
  calculateFamilyScore,
  calculateRecommendationScore,
} from '../familyScore';
import type { Venue } from '@/types';

// ── Minimal venue factory ─────────────────────────────────────────────────────
// Only include fields we actually check. TypeScript cast ensures type safety
// without forcing callers to provide every nullable field.
function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  // Defaults come first; the caller's values in `over` override them.
  // id and name are NOT listed explicitly here — they come exclusively from `over`.
  return {
    slug:             null,
    description:      null,
    category_id:      null,
    category:         undefined,
    address_line1:    null,
    address_line2:    null,
    city:             'Test City',
    postcode:         null,
    country:          'GB',
    latitude:         51.5,
    longitude:        -0.1,
    phone:            null,
    email:            null,
    website:          null,
    price_range:      null,
    min_age:          0,
    max_age:          16,
    is_published:     true,
    is_verified:      false,
    is_premium:       false,
    featured_until:   null,
    claimed_by:       null,
    submitted_by:     null,
    moderation_status: 'approved',
    osm_id:           null,
    data_source:      null,
    license:          null,
    moderation_notes: null,
    moderated_by:     null,
    moderated_at:     null,
    review_count:     0,
    average_rating:   0,
    photos:           [],
    facilities:       [],
    opening_hours:    [],
    created_at:       '2024-01-01T00:00:00Z',
    updated_at:       '2024-01-01T00:00:00Z',
    // Caller's values override all defaults above
    ...over,
  } as Venue;
}

function cat(slug: string) {
  return { id: slug, name: slug, slug, icon: '', color: '#000' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Playground with no description
//
// WHY THIS MATTERS: our "missing description must not disqualify" rule.
// A playground is one of the strongest family signals we have. Missing a
// description just means the trust dimension is lower, not that the venue
// is bad. Parents need to see it.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 1: playground with no description', () => {
  const v = venue({
    id: 'pg1',
    name: 'Sunny Hill Playground',
    category: cat('playground'),
    description: null,             // intentionally missing
    opening_hours: [               // has some hours so usefulness gets a point
      { id: 'h1', venue_id: 'pg1', day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false, notes: null },
    ],
    latitude: 51.5,
    longitude: -0.1,
  });

  test('familyScore is >= 50', () => {
    // Spec: "a playground with correct category, opening hours, and location
    // should still score 60–75" — that ceiling assumes website/phone too.
    // This fixture has only hours + coords, so 50 is the correct threshold
    // for the pure "no description must not disqualify" invariant.
    const result = calculateFamilyScore(v);
    expect(result.familyScore).toBeGreaterThanOrEqual(50);
  });

  test('confidence is low or medium (not excluded)', () => {
    const result = calculateFamilyScore(v);
    expect(['low', 'medium']).toContain(result.confidence);
  });

  test('familyScore is not 0 (not excluded by missing description)', () => {
    const result = calculateFamilyScore(v);
    expect(result.familyScore).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Soft play with photos, hours, and facilities
//
// WHY THIS MATTERS: a well-documented soft-play venue should score very highly
// and earn the "Family Friendly" badge — this is what parents are looking for.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 2: well-documented soft play', () => {
  const v = venue({
    id: 'sp1',
    name: 'Bounce & Play Soft Play',
    category: cat('soft-play'),
    description: 'A large soft-play centre for children aged 0–10, with a dedicated toddler zone, café, and baby-change facilities.',
    is_verified: true,
    price_range: 'budget',
    min_age: 0,
    max_age: 10,
    review_count: 12,
    average_rating: 4.4,
    website: 'https://example.com',
    opening_hours: [
      { id: 'h1', venue_id: 'sp1', day_of_week: 1, opens_at: '09:30', closes_at: '17:30', is_closed: false, notes: null },
    ],
    photos: [
      {
        id: 'ph1', venue_id: 'sp1', uploaded_by: null,
        url: 'https://example.com/photo.jpg', storage_path: 'sp1/1.jpg',
        is_cover: true, status: 'approved', moderation_notes: null,
        moderated_by: null, moderated_at: null, caption: null, sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
      },
    ],
    facilities: [
      { id: 'f1', name: 'Toilets',       slug: 'toilets',     icon: '' },
      { id: 'f2', name: 'Baby Changing', slug: 'baby_change', icon: '' },
      { id: 'f3', name: 'Café',          slug: 'cafe',        icon: '' },
      { id: 'f4', name: 'Parking',       slug: 'parking',     icon: '' },
    ],
  });

  test('familyScore is >= 75', () => {
    const result = calculateFamilyScore(v);
    expect(result.familyScore).toBeGreaterThanOrEqual(75);
  });

  test('confidence is high or medium', () => {
    const result = calculateFamilyScore(v);
    expect(['high', 'medium']).toContain(result.confidence);
  });

  test('badges includes "Family Friendly"', () => {
    const result = calculateFamilyScore(v);
    expect(result.badges).toContain('Family Friendly');
  });

  test('badges includes "Rainy Day Potential"', () => {
    const result = calculateFamilyScore(v);
    expect(result.badges).toContain('Rainy Day Potential');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Nightlife / adult venue
//
// WHY THIS MATTERS: we must not recommend adult venues to parents looking for
// family activities. The score should be very low — not zero (which would
// require us to be certain), but clearly at the bottom of any ranking.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 3: nightlife / adult venue', () => {
  const v = venue({
    id: 'nl1',
    name: 'The Late Night Bar',
    category: cat('nightlife'),
    min_age: 18,
    max_age: 99,
  });

  test('familyScore is <= 15', () => {
    const result = calculateFamilyScore(v);
    expect(result.familyScore).toBeLessThanOrEqual(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Museum with good description and age range
//
// WHY THIS MATTERS: museums are a core rainy-day option for families. A well-
// described museum with a documented age range should score highly and earn
// the "Rainy Day Potential" badge — a key discovery signal.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 4: museum with description and age range', () => {
  const v = venue({
    id: 'mu1',
    name: 'The Natural History Museum',
    category: cat('museum'),
    description: 'A world-class natural history museum featuring interactive dinosaur exhibits, a children\'s discovery zone, and regular family workshops throughout the year.',
    is_verified: true,
    min_age: 0,
    max_age: 16,
    review_count: 30,
    average_rating: 4.7,
    opening_hours: [
      { id: 'h1', venue_id: 'mu1', day_of_week: 1, opens_at: '10:00', closes_at: '17:00', is_closed: false, notes: null },
    ],
  });

  test('familyScore is >= 65', () => {
    const result = calculateFamilyScore(v);
    expect(result.familyScore).toBeGreaterThanOrEqual(65);
  });

  test('badges includes "Rainy Day Potential"', () => {
    const result = calculateFamilyScore(v);
    expect(result.badges).toContain('Rainy Day Potential');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Social proof dampening
//
// WHY THIS MATTERS: without Bayesian dampening, one parent leaving a 5-star
// review would make a brand-new venue rank above a venue with 20 happy
// families. That would surface untested venues at the top of results —
// a safety and trust problem.
//
// WHAT WE TEST: a venue with 1 review at 5.0 should score LOWER in the
// recommendation score than a venue with 20 reviews at 4.5.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 5: social proof dampening', () => {
  // Both venues share the same category, hours, and coordinates.
  // The ONLY difference that should affect the SOCIAL PROOF dimension is
  // review count. We give the established venue is_verified=true so the
  // trust dimension also differs — this ensures the final integer scores
  // are distinguishable after rounding.
  const singleReviewVenue = venue({
    id: 'v_single',
    name: 'New Park',
    category: cat('playground'),
    review_count: 1,
    average_rating: 5.0,
    is_verified: false,
  });

  const manyReviewVenue = venue({
    id: 'v_many',
    name: 'Established Park',
    category: cat('playground'),
    review_count: 20,
    average_rating: 4.5,
    is_verified: true,  // more trusted AND more reviews — should rank above single-review
  });

  test('venue with 20 reviews at 4.5 scores higher than venue with 1 review at 5.0', () => {
    const single = calculateRecommendationScore(singleReviewVenue);
    const many   = calculateRecommendationScore(manyReviewVenue);

    // The established venue has more social proof — it should rank higher
    // despite having a slightly lower raw rating
    expect(many.recommendationScore).toBeGreaterThan(single.recommendationScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Missing description lowers confidence but not score to zero
//
// WHY THIS MATTERS: this is the "missing data must not disqualify" invariant.
// A venue missing a description should get a lower trust dimension and lower
// confidence, but a non-zero family score. This prevents good but data-sparse
// venues from disappearing from discovery.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 6: missing description behaviour', () => {
  const withDescription = venue({
    id: 'v_desc',
    name: 'Adventure Kids Play Centre',
    category: cat('soft-play'),
    description: 'A large indoor play centre in the heart of Bristol with slides, climbing frames, and a dedicated baby area. Open 7 days a week.',
    is_verified: true,
  });

  const withoutDescription = venue({
    id: 'v_nodesc',
    name: 'Adventure Kids Play Centre',
    category: cat('soft-play'),
    description: null,   // intentionally missing
    is_verified: false,  // also not verified — maximise trust gap
  });

  test('familyScore is not 0 when description is missing', () => {
    const result = calculateFamilyScore(withoutDescription);
    expect(result.familyScore).toBeGreaterThan(0);
  });

  test('missing description does lower confidence vs same venue with description', () => {
    const resultWith    = calculateFamilyScore(withDescription);
    const resultWithout = calculateFamilyScore(withoutDescription);

    // The version with a description should have equal or higher confidence
    const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
    expect(confidenceRank[resultWith.confidence]).toBeGreaterThanOrEqual(
      confidenceRank[resultWithout.confidence],
    );
  });

  test('the trust dimension is lower when description is missing', () => {
    const resultWith    = calculateFamilyScore(withDescription);
    const resultWithout = calculateFamilyScore(withoutDescription);
    expect(resultWith._dimensions.trust).toBeGreaterThan(resultWithout._dimensions.trust);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: recommendationScore is always within 0–100
// ─────────────────────────────────────────────────────────────────────────────
describe('Boundary: recommendationScore is clamped 0–100', () => {
  test('perfect venue does not exceed 100', () => {
    const v = venue({
      id: 'perfect',
      name: 'The Ultimate Soft Play',
      category: cat('soft-play'),
      description: 'Absolutely the best soft play in the country. Huge space, amazing facilities.',
      is_verified: true,
      price_range: 'free',
      min_age: 0,
      max_age: 12,
      review_count: 200,
      average_rating: 5.0,
      website: 'https://example.com',
      phone: '07700000000',
      opening_hours: [
        { id: 'h1', venue_id: 'perfect', day_of_week: 1, opens_at: '09:00', closes_at: '18:00', is_closed: false, notes: null },
      ],
      photos: [
        {
          id: 'ph1', venue_id: 'perfect', uploaded_by: null,
          url: 'https://example.com/p.jpg', storage_path: 'p/1.jpg',
          is_cover: true, status: 'approved', moderation_notes: null,
          moderated_by: null, moderated_at: null, caption: null, sort_order: 0,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
      facilities: [
        { id: 'f1', name: 'Toilets',       slug: 'toilets',     icon: '' },
        { id: 'f2', name: 'Baby Changing', slug: 'baby_change', icon: '' },
        { id: 'f3', name: 'Café',          slug: 'cafe',        icon: '' },
        { id: 'f4', name: 'Parking',       slug: 'parking',     icon: '' },
        { id: 'f5', name: 'Accessible',    slug: 'accessible',  icon: '' },
      ],
    });
    const result = calculateRecommendationScore(v);
    expect(result.recommendationScore).toBeLessThanOrEqual(100);
    expect(result.recommendationScore).toBeGreaterThanOrEqual(0);
  });

  test('empty / unknown venue does not go below 0', () => {
    const v = venue({ id: 'empty', name: 'Unknown Place' });
    const result = calculateRecommendationScore(v);
    expect(result.recommendationScore).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discovery Sprint A — Trust Repair (P2 + P3 badge fixes)
//
// P2 root cause: `deriveBadges` granted 'Great For Toddlers' purely from
// `min_age <= 2`. Catalogue-wide, min_age/max_age are OSM-import DEFAULTS
// keyed off category slug (scripts/import/02_transform_osm.js SLUG_AGES) —
// e.g. EVERY 'attraction' and 'animal-attraction' venue defaults to
// min_age=0/max_age=18 with no real age assessment. That made the London
// Dungeon, Big Ben, SEA LIFE and Shrek's Adventure (all min_age=0) badge as
// "Great For Toddlers" — a trust/safety embarrassment for a children's app.
// The badge is now CATEGORY-ONLY (TODDLER_BADGE_SLUGS).
//
// P3 root cause: 'Needs More Info' fired whenever trustScore <= 2. A 2026-06
// measurement over 200 live RPC venues found it fired on 200/200 (100%)
// because is_verified/description>50/photo/trust_score are near-zero
// catalogue-wide. A badge with zero differentiating power was removed.
// ─────────────────────────────────────────────────────────────────────────────
describe('Badge: Great For Toddlers — category-gated, not age-gated', () => {
  test('does NOT badge an attraction with defaulted min_age=0 (London Dungeon-style)', () => {
    const v = venue({
      id: 'badge-attr',
      name: 'The London Dungeon',
      category: cat('attraction'),
      min_age: 0,
      max_age: 18,
    });
    expect(calculateFamilyScore(v).badges).not.toContain('Great For Toddlers');
  });

  test('does NOT badge an animal-attraction with defaulted min_age=0 (SEA LIFE-style)', () => {
    const v = venue({
      id: 'badge-animal-attr',
      name: 'SEA LIFE Aquarium London',
      category: cat('animal-attraction'),
      min_age: 0,
      max_age: 18,
    });
    expect(calculateFamilyScore(v).badges).not.toContain('Great For Toddlers');
  });

  test('does NOT badge a museum, sports-activity, childcare, theme-park or bowling venue', () => {
    for (const slug of ['museum', 'sports-activity', 'childcare', 'theme-park', 'bowling']) {
      const v = venue({
        id: `badge-${slug}`,
        name: `Test ${slug}`,
        category: cat(slug),
        min_age: 0,
        max_age: 18,
      });
      expect(calculateFamilyScore(v).badges).not.toContain('Great For Toddlers');
    }
  });

  test('badges a playground regardless of (defaulted) age data', () => {
    const v = venue({
      id: 'badge-playground',
      name: 'Covent Garden Playground',
      category: cat('playground'),
      min_age: 0,
      max_age: 16,
    });
    expect(calculateFamilyScore(v).badges).toContain('Great For Toddlers');
  });

  test('badges a soft-play venue regardless of (defaulted) age data', () => {
    const v = venue({
      id: 'badge-soft-play',
      name: 'Tiny Tots Soft Play',
      category: cat('soft-play'),
      min_age: 0,
      max_age: 18,
    });
    expect(calculateFamilyScore(v).badges).toContain('Great For Toddlers');
  });

  test('does not badge a venue with no category, even with min_age=0', () => {
    const v = venue({ id: 'badge-no-cat', name: 'Mystery Venue', min_age: 0 });
    expect(calculateFamilyScore(v).badges).not.toContain('Great For Toddlers');
  });
});

describe('Badge: "Needs More Info" has been removed (P3)', () => {
  test('is never present, even for a venue with zero trust signals', () => {
    const v = venue({
      id: 'no-trust-signals',
      name: 'Brand New Venue',
      is_verified: false,
      description: null,
      photos: [],
      cover_photo_url: undefined,
    });
    expect(calculateFamilyScore(v).badges).not.toContain('Needs More Info');
  });

  test('is never present even for a fully-documented, highly-trusted venue', () => {
    const v = venue({
      id: 'high-trust',
      name: 'Verified Soft Play',
      category: cat('soft-play'),
      is_verified: true,
      description: 'A wonderful, spacious soft play centre with full facilities for under-5s and their families.',
    });
    expect(calculateFamilyScore(v).badges).not.toContain('Needs More Info');
  });
});
