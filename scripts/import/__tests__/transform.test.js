/**
 * transform.test.js
 *
 * Unit tests for the new rural venue types, city fallback chain, and
 * location_fallback/city_fallback_used fields added in the OSM rural
 * coverage update.
 *
 * These tests import directly from 02_transform_osm.js via the
 * module.exports block at the bottom of that file. The module uses the
 * standard Node.js pattern (require.main === module) to guard main()
 * so it never runs when required by Jest — no mocking needed.
 *
 * Why a separate file from 02_transform_osm.test.js? The existing test
 * file replicates helpers verbatim (by design, per its header comment).
 * This file tests new behaviour introduced in the rural coverage update
 * and can import from the module directly now that exports exist.
 *
 * Jest picks this file up automatically from the __tests__ directory.
 */

'use strict';

const { sanitise, resolveSlug, transformElement, isWithinUK } = require('../02_transform_osm');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Makes a minimal valid OSM node. tagOverrides replaces individual tags.
 * By default the node has a name, leisure=park, and addr:city so it passes
 * all guards inside transformElement.
 */
function makeNode(tagOverrides) {
  return {
    type: 'node',
    id: 1000,
    lat: 51.8,
    lon: -1.7,
    tags: {
      name: 'Test Venue',
      leisure: 'park',
      'addr:city': 'Cirencester',
      ...tagOverrides,
    },
  };
}

// ============================================================================
// 1. sanitise
// ============================================================================

describe('sanitise', () => {
  it('strips control characters', () => {
    expect(sanitise('Kids\x00Play')).toBe('KidsPlay');
  });

  it('truncates to maxLen', () => {
    const long = 'x'.repeat(600);
    expect(sanitise(long, 500)).toHaveLength(500);
  });

  it('returns null for empty string', () => {
    expect(sanitise('')).toBeNull();
  });

  it('returns null for non-string — number', () => {
    expect(sanitise(42)).toBeNull();
  });

  it('returns null for null', () => {
    expect(sanitise(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(sanitise(undefined)).toBeNull();
  });
});

// ============================================================================
// 2. resolveSlug — existing types still work
// ============================================================================

describe('resolveSlug — existing types', () => {
  it('maps leisure=soft_play to soft-play', () => {
    expect(resolveSlug({ leisure: 'soft_play' })).toBe('soft-play');
  });

  it('maps tourism=museum to museum', () => {
    expect(resolveSlug({ tourism: 'museum' })).toBe('museum');
  });
});

// ============================================================================
// 3. resolveSlug — new rural types
// ============================================================================

describe('resolveSlug — new rural types', () => {
  it('maps tourism=farm to animal-attraction', () => {
    expect(resolveSlug({ tourism: 'farm' })).toBe('animal-attraction');
  });

  it('maps historic=castle to attraction', () => {
    expect(resolveSlug({ historic: 'castle' })).toBe('attraction');
  });

  it('maps historic=ruins to attraction', () => {
    expect(resolveSlug({ historic: 'ruins' })).toBe('attraction');
  });

  it('maps historic=fort to attraction', () => {
    expect(resolveSlug({ historic: 'fort' })).toBe('attraction');
  });

  it('maps leisure=nature_reserve to outdoor-sports', () => {
    expect(resolveSlug({ leisure: 'nature_reserve' })).toBe('outdoor-sports');
  });

  it('maps leisure=park to outdoor-sports', () => {
    expect(resolveSlug({ leisure: 'park' })).toBe('outdoor-sports');
  });

  it('maps leisure=water_park to swimming', () => {
    expect(resolveSlug({ leisure: 'water_park' })).toBe('swimming');
  });

  it('maps amenity=arts_centre to attraction', () => {
    expect(resolveSlug({ amenity: 'arts_centre' })).toBe('attraction');
  });

  it('maps tourism=picnic_site to outdoor-sports', () => {
    expect(resolveSlug({ tourism: 'picnic_site' })).toBe('outdoor-sports');
  });
});

// ============================================================================
// 4. transformElement — city fallback chain
// ============================================================================

describe('transformElement — city fallback chain', () => {
  it('uses addr:town when addr:city is absent', () => {
    const el = makeNode({ name: 'Town Park', leisure: 'park', 'addr:town': 'Burford' });
    delete el.tags['addr:city'];
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.city).toBe('Burford');
    // location_fallback and city_fallback_used are no longer returned on the
    // record — they are transform-internal stats tracked in main() only.
    expect(result).not.toHaveProperty('location_fallback');
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('uses addr:village when addr:city and addr:town are absent', () => {
    const el = makeNode({ name: 'Village Play', leisure: 'playground', 'addr:village': 'Bourton-on-the-Water' });
    delete el.tags['addr:city'];
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.city).toBe('Bourton-on-the-Water');
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('uses addr:hamlet when only hamlet is present', () => {
    const el = makeNode({ name: 'Hamlet Farm', tourism: 'farm', 'addr:hamlet': 'Little Barrington' });
    delete el.tags['addr:city'];
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.city).toBe('Little Barrington');
    expect(result).not.toHaveProperty('city_fallback_used');
    expect(result).not.toHaveProperty('location_fallback');
  });

  it('uses addr:county when only county is present', () => {
    const el = makeNode({ name: 'County Castle', historic: 'castle', 'addr:county': 'Gloucestershire' });
    delete el.tags['addr:city'];
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.city).toBe('Gloucestershire');
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('uses postcode outward code when no address field is present', () => {
    const el = makeNode({ name: 'Remote Picnic Site', tourism: 'picnic_site', 'addr:postcode': 'GL54 3PX' });
    delete el.tags['addr:city'];
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.city).toBe('GL54');
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('keeps venue with no address at all — city is Unknown area', () => {
    // Provide only name + coords, no address tags at all
    const el = {
      type: 'node',
      id: 2000,
      lat: 51.85,
      lon: -1.75,
      tags: { name: 'Remote Nature Reserve', leisure: 'nature_reserve' },
    };
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.city).toBe('Unknown area');
    // These fields must not appear on the record — they are pipeline-internal only
    expect(result).not.toHaveProperty('location_fallback');
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('returns null when the element has no name', () => {
    const el = makeNode({ leisure: 'park' });
    delete el.tags.name;
    expect(transformElement(el)).toBeNull();
  });

  it('returns null when the element has no coords', () => {
    const el = makeNode({ name: 'Park', leisure: 'park' });
    delete el.lat;
    delete el.lon;
    expect(transformElement(el)).toBeNull();
  });
});

// ============================================================================
// 5. resolveSlug — priority order
// ============================================================================

describe('resolveSlug — priority order', () => {
  it('prefers leisure=park over tourism=farm — resolves to outdoor-sports', () => {
    expect(resolveSlug({ leisure: 'park', tourism: 'farm' })).toBe('outdoor-sports');
  });

  it('resolves historic=castle alone to attraction', () => {
    expect(resolveSlug({ historic: 'castle' })).toBe('attraction');
  });

  it('prefers leisure=playground over amenity=arts_centre — resolves to playground', () => {
    expect(resolveSlug({ leisure: 'playground', amenity: 'arts_centre' })).toBe('playground');
  });

  it('prefers tourism=museum over historic=castle — resolves to museum', () => {
    expect(resolveSlug({ tourism: 'museum', historic: 'castle' })).toBe('museum');
  });
});

// ============================================================================
// 6. isWithinUK — coordinate boundary function
// ============================================================================

describe('isWithinUK', () => {
  // UK mainland
  it('accepts central England (London)', () => {
    expect(isWithinUK(51.5, -0.1)).toBe(true);
  });

  it('accepts northern Scotland', () => {
    expect(isWithinUK(58.5, -3.5)).toBe(true);
  });

  it('accepts Northern Ireland', () => {
    expect(isWithinUK(54.6, -5.9)).toBe(true);
  });

  it('accepts Lowestoft — UK easternmost point (~1.75°E)', () => {
    expect(isWithinUK(52.5, 1.75)).toBe(true);
  });

  // Channel Islands — British Crown Dependencies, must be included
  it('accepts Channel Islands (Jersey, lat~49.2, lon~-2.1)', () => {
    expect(isWithinUK(49.2, -2.1)).toBe(true);
  });

  it('accepts Channel Islands (Guernsey, lat~49.5, lon~-2.6)', () => {
    expect(isWithinUK(49.5, -2.6)).toBe(true);
  });

  // French Normandy coast — must be rejected
  it('rejects French Normandy coast (lat 49.5, lon 0.5)', () => {
    expect(isWithinUK(49.5, 0.5)).toBe(false);
  });

  it('rejects French Normandy coast (lat 49.3, lon -0.4)', () => {
    expect(isWithinUK(49.3, -0.4)).toBe(false);
  });

  // Calais area — must be rejected
  it('rejects Calais area (lat 50.9, lon 1.85)', () => {
    // Calais is above 50°N — caught by the lon > 1.8 guard
    expect(isWithinUK(50.9, 1.85)).toBe(false);
  });

  // Completely outside UK
  it('rejects Madrid (lat 40.4, lon -3.7) — too far south', () => {
    expect(isWithinUK(40.4, -3.7)).toBe(false);
  });

  it('rejects Oslo (lat 59.9, lon 10.7) — too far east', () => {
    expect(isWithinUK(59.9, 10.7)).toBe(false);
  });

  it('rejects latitude above UK (lat 62.0, lon -2.0)', () => {
    expect(isWithinUK(62.0, -2.0)).toBe(false);
  });

  it('rejects longitude west of UK (lat 54.0, lon -9.5)', () => {
    expect(isWithinUK(54.0, -9.5)).toBe(false);
  });
});

// ============================================================================
// 7. transformElement — UK coordinate filtering
// ============================================================================

describe('transformElement — UK coordinate filtering', () => {
  it('rejects an element with French Normandy coordinates (lat 49.4, lon 0.3)', () => {
    const el = {
      type: 'node',
      id: 9001,
      lat: 49.4,
      lon: 0.3,
      tags: { name: 'Parc de Jeux Normandie', leisure: 'playground', 'addr:city': 'Caen' },
    };
    expect(transformElement(el)).toBeNull();
  });

  it('rejects an element with Calais-area coordinates (lat 50.9, lon 1.9)', () => {
    const el = {
      type: 'node',
      id: 9002,
      lat: 50.9,
      lon: 1.9,
      tags: { name: 'Cité des Enfants Calais', leisure: 'playground', 'addr:city': 'Calais' },
    };
    expect(transformElement(el)).toBeNull();
  });

  it('accepts a Channel Islands element (Jersey, lat 49.2, lon -2.1)', () => {
    const el = {
      type: 'node',
      id: 9003,
      lat: 49.2,
      lon: -2.1,
      tags: { name: "Jersey Children's Park", leisure: 'playground', 'addr:city': 'St Helier' },
    };
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.country).toBe('GB');
  });

  it('accepts a Channel Islands element (Guernsey, lat 49.5, lon -2.6)', () => {
    const el = {
      type: 'node',
      id: 9004,
      lat: 49.5,
      lon: -2.6,
      tags: { name: 'Guernsey Soft Play', leisure: 'soft_play', 'addr:city': 'St Peter Port' },
    };
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result.country).toBe('GB');
  });
});

// ============================================================================
// 8. transformElement — metadata fields absent from returned record
// ============================================================================

describe('transformElement — no metadata fields on returned record', () => {
  it('does not include location_fallback on a venue with a full address', () => {
    const result = transformElement(makeNode({ 'addr:city': 'Oxford' }));
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('location_fallback');
  });

  it('does not include city_fallback_used on a venue with a full address', () => {
    const result = transformElement(makeNode({ 'addr:city': 'Oxford' }));
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('does not include location_fallback even when the venue has no address', () => {
    const el = {
      type: 'node',
      id: 8001,
      lat: 52.0,
      lon: -1.5,
      tags: { name: 'No Address Venue', leisure: 'park' },
    };
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('location_fallback');
  });

  it('does not include city_fallback_used even when falling back to hamlet', () => {
    const el = makeNode({ name: 'Hamlet Venue', tourism: 'farm', 'addr:hamlet': 'Tiny Village' });
    delete el.tags['addr:city'];
    const result = transformElement(el);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('city_fallback_used');
  });

  it('does not include _meta on any returned venue', () => {
    const result = transformElement(makeNode({}));
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('_meta');
  });
});

// ============================================================================
// Safety invariants — new venue types must always be unpublished + pending
// ============================================================================

describe('transformElement — safety invariants for new rural types', () => {
  const cases = [
    ['farm', makeNode({ name: 'Cotswolds Farm Park', tourism: 'farm', 'addr:town': 'Bourton' })],
    ['castle', makeNode({ name: 'Sudeley Castle', historic: 'castle', 'addr:county': 'Gloucestershire' })],
    ['park', makeNode({ name: 'Cirencester Park', leisure: 'park' })],
    ['water_park', makeNode({ name: 'Cotswold Water Park', leisure: 'water_park', 'addr:village': 'South Cerney' })],
    ['nature_reserve', (() => {
      const el = { type: 'node', id: 3000, lat: 51.7, lon: -1.9,
        tags: { name: 'Cotswold Nature Reserve', leisure: 'nature_reserve' } };
      return el;
    })()],
  ];

  test.each(cases)('%s — is_published is false', (_label, el) => {
    expect(transformElement(el).is_published).toBe(false);
  });

  test.each(cases)('%s — moderation_status is pending', (_label, el) => {
    expect(transformElement(el).moderation_status).toBe('pending');
  });

  test.each(cases)('%s — is_verified is false', (_label, el) => {
    expect(transformElement(el).is_verified).toBe(false);
  });

  test.each(cases)('%s — license is ODbL-1.0', (_label, el) => {
    expect(transformElement(el).license).toBe('ODbL-1.0');
  });

  test.each(cases)('%s — country is GB', (_label, el) => {
    expect(transformElement(el).country).toBe('GB');
  });
});
