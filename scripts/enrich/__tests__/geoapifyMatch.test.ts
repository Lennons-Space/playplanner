// =============================================================================
// scripts/enrich/__tests__/geoapifyMatch.test.ts
//
// Tests for the pure Geoapify matcher: matchVenue(venue, geocodeResponse).
//
// WHY these tests matter:
//   A wrong match writes plausible-but-false facts (a phone number, a
//   "wheelchair: yes") onto the WRONG venue. These tests lock the conservative
//   gates that stop that: the 150m distance gate, the name-similarity floor, the
//   composite-score thresholds, and the non-family category demotion. A
//   regression here silently corrupts venue data for families.
//
// No network, no credits — every input is a saved fixture or inline literal.
// No '@/' path aliases — this file runs outside the Expo app bundle.
// =============================================================================

import {
  matchVenue,
  normaliseName,
  nameSimilarity,
  haversineMetres,
  DISTANCE_GATE_M,
} from '../geoapifyMatch';
import type { GeoapifyRawBundle, VenueMatchInput } from '../../../types/enrichment';

import willows from './fixtures/geoapify/willows-activity-farm.json';
import wrongName from './fixtures/geoapify/wrong-name-same-coords.json';
import farAway from './fixtures/geoapify/far-away-same-name.json';
import borderline from './fixtures/geoapify/borderline-review.json';
import collision from './fixtures/geoapify/category-collision.json';
import noCandidates from './fixtures/geoapify/no-candidates.json';

const bundle = (b: unknown) => b as unknown as GeoapifyRawBundle;

// =============================================================================
// normaliseName
// =============================================================================
describe('normaliseName', () => {
  // Without this: "The Willows Farm Ltd" wouldn't compare to "Willows Farm",
  // so legitimate matches would be rejected on noise words alone.
  it('lowercases, strips punctuation, and drops business stopwords', () => {
    expect(normaliseName('The Willows Farm Village Ltd.')).toBe('willows farm village');
  });

  it('expands ampersand to "and" then drops it as a stopword', () => {
    expect(normaliseName('Bounce & Play')).toBe('bounce play');
  });

  it('collapses repeated whitespace', () => {
    expect(normaliseName('  Soft   Play   Centre ')).toBe('soft play centre');
  });
});

// =============================================================================
// nameSimilarity
// =============================================================================
describe('nameSimilarity', () => {
  // Without this: identical names might not score 1.0 and clear the floor.
  it('returns 1 for identical names', () => {
    expect(nameSimilarity('Willows Activity Farm', 'Willows Activity Farm')).toBe(1);
  });

  // Without this: word-order / extra-word differences would tank the score and
  // reject good matches ("Willows Activity Farm" vs "Willows Farm").
  it('scores partial token overlap above the 0.5 floor', () => {
    expect(nameSimilarity('Willows Activity Farm', 'Willows Farm')).toBeGreaterThanOrEqual(0.5);
  });

  // Without this: a totally different business at the same coordinates could
  // slip through — this is the core defence against coordinate collisions.
  it('scores unrelated names well below the floor', () => {
    expect(nameSimilarity('Willows Activity Farm', 'Tesco Express')).toBeLessThan(0.5);
  });

  it('returns 0 when either name is empty', () => {
    expect(nameSimilarity('', 'Willows')).toBe(0);
  });
});

// =============================================================================
// haversineMetres
// =============================================================================
describe('haversineMetres', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMetres(51.7259, -0.3361, 51.7259, -0.3361)).toBe(0);
  });

  // Without this: a broken distance formula would let far-away venues pass the
  // gate. ~0.0061° of longitude at this latitude is ~420m — must exceed 150m.
  it('measures roughly 420m for the far-away fixture offset', () => {
    const d = haversineMetres(51.7259, -0.3361, 51.7259, -0.33);
    expect(d).toBeGreaterThan(DISTANCE_GATE_M);
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(500);
  });
});

// =============================================================================
// matchVenue — decisions
// =============================================================================
describe('matchVenue', () => {
  // Without this: the happy path could silently stop accepting good matches,
  // so Geoapify enrichment would never run on any venue.
  it('ACCEPTs a clean name+coords+postcode match', () => {
    const b = bundle(willows);
    const r = matchVenue(b.venue, b.geocode);
    expect(r.decision).toBe('accept');
    expect(r.place_id).toBe('51a8aaaaaaaaaaaab2');
    expect(r.distance_m).toBeLessThanOrEqual(DISTANCE_GATE_M);
    expect(r.name_sim).toBe(1);
    expect(r.postcode_match).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.7);
  });

  // Without this: a shop at the same coordinates as our venue could overwrite it
  // with a wrong phone number — the worst data-corruption case.
  it('REJECTs a different business at the same coordinates (name floor)', () => {
    const b = bundle(wrongName);
    const r = matchVenue(b.venue, b.geocode);
    expect(r.decision).toBe('reject');
    expect(r.name_sim).toBeLessThan(0.5);
  });

  // Without this: a same-named venue across town could be matched, attaching
  // another site's facilities to ours.
  it('REJECTs a same-named venue beyond the 150m distance gate', () => {
    const b = bundle(farAway);
    const r = matchVenue(b.venue, b.geocode);
    expect(r.decision).toBe('reject');
    expect(r.distance_m).toBeGreaterThan(DISTANCE_GATE_M);
    expect(r.reasons.join(' ')).toMatch(/distance/i);
  });

  // Without this: borderline matches would be silently accepted or dropped
  // instead of being surfaced for a human to check.
  it('REVIEWs a borderline score (in [0.55, 0.70))', () => {
    const b = bundle(borderline);
    const r = matchVenue(b.venue, b.geocode);
    expect(r.decision).toBe('review');
    expect(r.score).toBeGreaterThanOrEqual(0.55);
    expect(r.score).toBeLessThan(0.7);
  });

  // Without this: a perfect-scoring match to the supermarket next door would be
  // accepted — the category sanity check is the last line of defence.
  it('DEMOTES an otherwise-perfect match to REVIEW on a non-family category', () => {
    const b = bundle(collision);
    const r = matchVenue(b.venue, b.geocode);
    expect(r.score).toBeGreaterThanOrEqual(0.7);
    expect(r.category_mismatch).toBe(true);
    expect(r.decision).toBe('review');
    expect(r.reasons.join(' ')).toMatch(/category/i);
  });

  // Without this: an empty Geoapify result could throw or be mishandled instead
  // of cleanly rejecting.
  it('REJECTs cleanly when there are no candidates', () => {
    const b = bundle(noCandidates);
    const r = matchVenue(b.venue, b.geocode);
    expect(r.decision).toBe('reject');
    expect(r.place_id).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/no candidates/i);
  });

  it('REJECTs cleanly when the response is null/undefined', () => {
    const v: VenueMatchInput = bundle(willows).venue;
    expect(matchVenue(v, null).decision).toBe('reject');
    expect(matchVenue(v, undefined).decision).toBe('reject');
  });

  // Without this: a candidate with only GeoJSON geometry (no lat/lon properties)
  // would report no distance and be wrongly rejected.
  it('falls back to GeoJSON geometry [lon,lat] when lat/lon properties are absent', () => {
    const v = bundle(willows).venue;
    const r = matchVenue(v, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            place_id: 'geom-only',
            name: 'Willows Activity Farm',
            postcode: 'AL2 1BB',
            category: 'leisure.park',
            rank: { confidence: 0.95 },
          },
          geometry: { type: 'Point', coordinates: [-0.3361, 51.7259] },
        },
      ],
    });
    expect(r.distance_m).toBe(0);
    expect(r.decision).toBe('accept');
  });
});
