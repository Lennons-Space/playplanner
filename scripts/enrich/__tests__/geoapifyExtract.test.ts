// =============================================================================
// scripts/enrich/__tests__/geoapifyExtract.test.ts
//
// Tests for the pure Geoapify extractor: a raw GeoJSON feature -> annotated
// Layer 1 facts + capture-only extras (opening hours, website, phone, email).
//
// WHY these tests matter:
//   These derivations decide what Geoapify is allowed to contribute to a venue.
//   The 'explicit' vs 'inferred' provenance tag drives the merge precedence — if
//   a structured facility were mislabelled as inferred (or vice versa), the merge
//   engine would resolve conflicts wrongly and either drop good data or let a
//   weak Geoapify guess override a real OSM tag.
//
// No network, no credits. No '@/' path aliases (runs outside the Expo bundle).
// =============================================================================

import {
  firstFeature,
  firstProperties,
  extractGeoapifyAnnotatedFacts,
  extractGeoapifyExtras,
} from '../geoapifyExtract';
import type {
  GeoapifyFeatureProperties,
  GeoapifyRawBundle,
} from '../../../types/enrichment';

import willows from './fixtures/geoapify/willows-activity-farm.json';

const willowsBundle = willows as unknown as GeoapifyRawBundle;
const willowsDetails: GeoapifyFeatureProperties =
  firstProperties(willowsBundle.place_details) as GeoapifyFeatureProperties;

// =============================================================================
// response helpers
// =============================================================================
describe('firstFeature / firstProperties', () => {
  it('returns the first feature of a response', () => {
    expect(firstFeature(willowsBundle.geocode)?.properties.place_id).toBe('51a8aaaaaaaaaaaab2');
  });

  // Without this: an empty/missing response could throw instead of yielding null.
  it('returns null for empty or missing responses', () => {
    expect(firstFeature({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(firstFeature(null)).toBeNull();
    expect(firstFeature(undefined)).toBeNull();
    expect(firstProperties(null)).toBeNull();
  });
});

// =============================================================================
// extractGeoapifyAnnotatedFacts
// =============================================================================
describe('extractGeoapifyAnnotatedFacts', () => {
  const facts = extractGeoapifyAnnotatedFacts(willowsDetails);

  // Structured facilities/catering/parking/wheelchair must be 'explicit' so they
  // can beat an OSM *inference* during merge.
  it('marks facilities.toilets as explicit true', () => {
    expect(facts.toilets_available).toEqual({ value: true, provenance: 'explicit' });
  });

  it('marks catering.cafe as explicit true', () => {
    expect(facts.cafe_available).toEqual({ value: true, provenance: 'explicit' });
  });

  it('marks a non-empty parking object as explicit true', () => {
    expect(facts.parking_available).toEqual({ value: true, provenance: 'explicit' });
  });

  it('maps wheelchair=yes to explicit yes', () => {
    expect(facts.wheelchair_accessible).toEqual({ value: 'yes', provenance: 'explicit' });
  });

  // Category-derived signals must be 'inferred' (weaker than explicit tags).
  it('derives activity_level=high from an activity category (inferred)', () => {
    expect(facts.activity_level).toEqual({ value: 'high', provenance: 'inferred' });
  });

  it('derives indoor_outdoor from category as inferred', () => {
    expect(facts.indoor_outdoor.provenance).toBe('inferred');
    expect(facts.indoor_outdoor.value).toBe('outdoor'); // leisure.park
  });

  // Geoapify does not provide a visit-duration estimate.
  it('always returns null visit_duration_mins', () => {
    expect(facts.visit_duration_mins).toEqual({ value: null, provenance: null });
  });

  // Missing facility => null (not false). "Geoapify didn't say" ≠ "absent".
  it('returns null for facilities Geoapify did not mention', () => {
    expect(facts.baby_change_available).toEqual({ value: null, provenance: null });
  });

  // Explicit false must be preserved (confirmed absent), not collapsed to null.
  it('preserves an explicit false facility value', () => {
    const f = extractGeoapifyAnnotatedFacts({ facilities: { toilets: false } });
    expect(f.toilets_available).toEqual({ value: false, provenance: 'explicit' });
  });

  it('maps wheelchair=designated to yes and wheelchair=limited to limited', () => {
    expect(extractGeoapifyAnnotatedFacts({ wheelchair: 'designated' }).wheelchair_accessible.value).toBe('yes');
    expect(extractGeoapifyAnnotatedFacts({ wheelchair: 'limited' }).wheelchair_accessible.value).toBe('limited');
  });

  it('returns all-null facts for an empty feature', () => {
    const f = extractGeoapifyAnnotatedFacts({});
    expect(f.toilets_available.value).toBeNull();
    expect(f.indoor_outdoor.value).toBeNull();
    expect(f.wheelchair_accessible.value).toBeNull();
  });
});

// =============================================================================
// extractGeoapifyExtras
// =============================================================================
describe('extractGeoapifyExtras', () => {
  const extras = extractGeoapifyExtras(willowsDetails);

  // These are the high-value fields OSM-via-archive barely provides.
  it('captures opening hours, website, phone, email', () => {
    expect(extras.opening_hours).toBe('Mo-Su 10:00-17:30');
    expect(extras.website).toBe('https://willowsactivityfarm.example');
    expect(extras.phone).toBe('+44 1727 000000');
    expect(extras.email).toBe('hello@willowsactivityfarm.example');
  });

  it('captures the category list', () => {
    expect(extras.categories).toEqual(['leisure.park', 'entertainment.activity_park']);
  });

  // Without this: a top-level website (no contact block) would be missed.
  it('falls back to top-level website when contact.website is absent', () => {
    expect(extractGeoapifyExtras({ website: 'https://x.example' }).website).toBe('https://x.example');
  });

  it('returns nulls when nothing is present', () => {
    expect(extractGeoapifyExtras({})).toEqual({
      opening_hours: null,
      website: null,
      phone: null,
      email: null,
      categories: [],
    });
  });
});
