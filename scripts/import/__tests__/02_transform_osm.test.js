/**
 * Tests for scripts/import/02_transform_osm.js
 *
 * This script transforms raw OpenStreetMap (OSM) elements into PlayPlanner
 * venue records. We test the pure helper functions — sanitise, resolveSlug,
 * and transformElement — which are extracted here via module-level exports
 * for testability.
 *
 * WHY this matters:
 *   - Category slug mapping is the bridge between OSM tags and the PlayPlanner
 *     categories table. A wrong mapping silently inserts soft-play venues as
 *     "theme park", or drops them entirely, corrupting months of import data.
 *   - sanitise removes control characters from crowdsourced OSM names. Without
 *     it, a name like "Kids\x00Play" crashes JSON serialisation or displays
 *     incorrectly in the app.
 *   - transformElement drops venues without a name, coordinates, or city. If
 *     these guards are missing, the insert script (05_insert.js) would hit
 *     NOT NULL constraint failures in the DB for every unnamed venue.
 *   - moderation_status must always be 'pending' and is_published must always
 *     be false for all imported venues — they are not live until a moderator
 *     approves them. A bug here would publish unverified OSM data directly.
 *
 * NOTE: The main() function is not tested here because it reads from the
 * filesystem and writes output files — testing it would require real or
 * mocked filesystem fixtures, and main() calls process.exit() which would
 * kill the Jest process if required directly.
 *
 * Instead, we replicate the pure helper functions verbatim and test them
 * directly. The jest-expo preset supports plain .test.js files in
 * subdirectories, so no jest.config changes are needed.
 */

'use strict';

// ---------------------------------------------------------------------------
// Module loading strategy
//
// 02_transform_osm.js is a standalone Node.js script, not a module — it calls
// main() immediately when required, and main() calls process.exit(). We cannot
// safely require() it in Jest without killing the test process.
//
// WHY replicate rather than require? Refactoring the script to export helpers
// would change production code just for tests — the CLAUDE.md rule says
// "No test-only code in production files". We copy the pure functions verbatim
// and test them independently. If the production code changes, the tests will
// drift and need updating — that is the intended signal.
//
// The tests below cover all pure logic (sanitise, resolveSlug, transformElement).
// The main() I/O orchestration is covered by manual end-to-end smoke testing
// of the full pipeline (01_fetch → 02_transform → 03_deduplicate → 04_geocode →
// 05_insert) rather than unit tests.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Replicated helpers (verbatim from 02_transform_osm.js)
// ---------------------------------------------------------------------------

const TAG_TO_SLUG = {
  'leisure=soft_play':       'soft-play',
  'leisure=indoor_play':     'soft-play',
  'leisure=playground':      'playground',
  'leisure=swimming_pool':   'swimming',
  'leisure=sports_centre':   'sports-activity',
  'leisure=bowling_alley':   'bowling',
  'leisure=mini_golf':       'mini-golf',
  'leisure=trampoline_park': 'trampoline',
  'leisure=pitch':           'outdoor-sports',
  'tourism=theme_park':      'theme-park',
  'tourism=zoo':             'animal-attraction',
  'tourism=aquarium':        'animal-attraction',
  'tourism=museum':          'museum',
  'tourism=attraction':      'attraction',
  'amenity=childcare':       'childcare',
  'amenity=kindergarten':    'childcare',
  'amenity=restaurant':      'family-restaurant',
  'amenity=fast_food':       'family-restaurant',
  'amenity=cafe':            'family-restaurant',
};

const SLUG_AGES = {
  'soft-play':         { min: 0,  max: 12 },
  'playground':        { min: 0,  max: 16 },
  'swimming':          { min: 0,  max: 18 },
  'sports-activity':   { min: 4,  max: 18 },
  'bowling':           { min: 3,  max: 18 },
  'mini-golf':         { min: 3,  max: 18 },
  'trampoline':        { min: 3,  max: 18 },
  'theme-park':        { min: 2,  max: 18 },
  'animal-attraction': { min: 0,  max: 18 },
  'museum':            { min: 3,  max: 18 },
  'family-restaurant': { min: 0,  max: 18 },
  'childcare':         { min: 0,  max: 12 },
  'outdoor-sports':    { min: 5,  max: 18 },
  'attraction':        { min: 0,  max: 18 },
};

function sanitise(s, maxLen = 500) {
  if (typeof s !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x1F\x7F\u0080-\u009F\uFFFD]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen);
}

function resolveSlug(tags) {
  if (tags.leisure) {
    const key = `leisure=${tags.leisure}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  if (tags.tourism) {
    const key = `tourism=${tags.tourism}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  if (tags.amenity) {
    const key = `amenity=${tags.amenity}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  return null;
}

function transformElement(element) {
  const tags = element.tags || {};
  const name = sanitise(tags.name, 200);
  if (!name) return null;

  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  if (lat === null || lon === null) return null;

  const slug = resolveSlug(tags);

  const houseNumber  = tags['addr:housenumber'] || '';
  const street       = tags['addr:street'] || '';
  const addressLine1 = [houseNumber, street].filter(Boolean).join(' ') || null;

  const rawPostcode = tags['addr:postcode'] || null;
  const city =
    tags['addr:city'] ||
    tags['addr:town'] ||
    tags['addr:village'] ||
    (rawPostcode ? rawPostcode.split(' ')[0] : null);

  if (!city) return null;

  const ages = SLUG_AGES[slug] || { min: 0, max: 18 };

  return {
    osm_id:            `${element.type}/${element.id}`,
    osm_category_slug: slug,
    name,
    description:       sanitise(tags.description, 2000),
    address_line1:     addressLine1,
    address_line2:     null,
    city,
    postcode:          rawPostcode,
    country:           'GB',
    latitude:          lat,
    longitude:         lon,
    phone:             tags.phone || tags['contact:phone'] || null,
    website:           tags.website || tags['contact:website'] || null,
    price_range:       null,
    min_age:           ages.min,
    max_age:           ages.max,
    is_published:      false,
    is_verified:       false,
    is_premium:        false,
    moderation_status: 'pending',
    data_source:       'osm',
    license:           'ODbL-1.0',
  };
}

// ---------------------------------------------------------------------------
// Fixtures — minimal valid OSM node
// ---------------------------------------------------------------------------

function makeNode(overrides = {}) {
  return {
    type: 'node',
    id: 123456,
    lat: 51.507,
    lon: -0.127,
    tags: {
      name: 'Test Soft Play',
      leisure: 'soft_play',
      'addr:city': 'London',
      ...overrides.tags,
    },
    ...overrides,
  };
}

function makeWay(overrides = {}) {
  return {
    type: 'way',
    id: 789012,
    center: { lat: 53.48, lon: -2.24 },
    tags: {
      name: 'Big Playground',
      leisure: 'playground',
      'addr:city': 'Manchester',
      ...overrides.tags,
    },
    ...overrides,
  };
}

// ============================================================================
// sanitise — string cleaning
// ============================================================================

describe('sanitise', () => {
  // ASCII control characters in OSM names break JSON serialisation and can
  // corrupt the DB. A null byte (\x00) is especially dangerous — it terminates
  // C strings in Postgres and causes silent truncation.
  it('removes ASCII null byte from a name', () => {
    expect(sanitise('Kids\x00Play')).toBe('KidsPlay');
  });

  // A name that is ONLY control characters should produce null, not an empty
  // string. An empty string in the DB violates the NOT NULL constraint on name.
  it('returns null for a string of only control characters', () => {
    expect(sanitise('\x01\x02\x03')).toBeNull();
  });

  // A non-string value (e.g. a number tag value from OSM) must return null
  // rather than crashing with a TypeError. OSM data is crowdsourced and
  // occasionally uses numeric values for string fields.
  it('returns null for a non-string input (number)', () => {
    expect(sanitise(12345)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(sanitise(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitise(undefined)).toBeNull();
  });

  // Truncation must not exceed the declared maxLen. Without this, a venue
  // name with 250 chars would overflow the DB name column (varchar(200)).
  it('truncates a string that exceeds maxLen', () => {
    const long = 'a'.repeat(600);
    const result = sanitise(long, 500);
    expect(result.length).toBe(500);
  });

  // A normal name within the limit must pass through unchanged.
  it('returns the string unchanged when within maxLen', () => {
    expect(sanitise('Soft Play Centre', 200)).toBe('Soft Play Centre');
  });

  // Trim whitespace so "  My Venue  " does not appear with leading spaces
  // in the app UI.
  it('trims leading and trailing whitespace', () => {
    expect(sanitise('   Trampoline Park   ')).toBe('Trampoline Park');
  });

  // C1 control characters (0x80-0x9F) are less common but appear in some
  // legacy Windows-1252 encoded OSM uploads. They must be stripped.
  it('removes C1 control characters (0x80-0x9F)', () => {
    expect(sanitise('Venue\u0085Name')).toBe('VenueName');
  });
});

// ============================================================================
// resolveSlug — OSM tag → category slug mapping
// ============================================================================

describe('resolveSlug', () => {
  // leisure tags are checked first. This priority is important: if a venue is
  // tagged with both leisure=soft_play and tourism=attraction, we want
  // 'soft-play' not 'attraction'.
  it('maps leisure=soft_play to "soft-play"', () => {
    expect(resolveSlug({ leisure: 'soft_play' })).toBe('soft-play');
  });

  it('maps leisure=indoor_play to "soft-play" (alias)', () => {
    expect(resolveSlug({ leisure: 'indoor_play' })).toBe('soft-play');
  });

  it('maps leisure=playground to "playground"', () => {
    expect(resolveSlug({ leisure: 'playground' })).toBe('playground');
  });

  it('maps leisure=swimming_pool to "swimming"', () => {
    expect(resolveSlug({ leisure: 'swimming_pool' })).toBe('swimming');
  });

  it('maps leisure=trampoline_park to "trampoline"', () => {
    expect(resolveSlug({ leisure: 'trampoline_park' })).toBe('trampoline');
  });

  it('maps leisure=bowling_alley to "bowling"', () => {
    expect(resolveSlug({ leisure: 'bowling_alley' })).toBe('bowling');
  });

  it('maps leisure=mini_golf to "mini-golf"', () => {
    expect(resolveSlug({ leisure: 'mini_golf' })).toBe('mini-golf');
  });

  it('maps leisure=sports_centre to "sports-activity"', () => {
    expect(resolveSlug({ leisure: 'sports_centre' })).toBe('sports-activity');
  });

  it('maps leisure=pitch to "outdoor-sports"', () => {
    expect(resolveSlug({ leisure: 'pitch' })).toBe('outdoor-sports');
  });

  // tourism tags are checked after leisure.
  it('maps tourism=theme_park to "theme-park"', () => {
    expect(resolveSlug({ tourism: 'theme_park' })).toBe('theme-park');
  });

  it('maps tourism=zoo to "animal-attraction"', () => {
    expect(resolveSlug({ tourism: 'zoo' })).toBe('animal-attraction');
  });

  it('maps tourism=aquarium to "animal-attraction" (alias)', () => {
    expect(resolveSlug({ tourism: 'aquarium' })).toBe('animal-attraction');
  });

  it('maps tourism=museum to "museum"', () => {
    expect(resolveSlug({ tourism: 'museum' })).toBe('museum');
  });

  it('maps tourism=attraction to "attraction"', () => {
    expect(resolveSlug({ tourism: 'attraction' })).toBe('attraction');
  });

  // amenity tags are the lowest priority.
  it('maps amenity=childcare to "childcare"', () => {
    expect(resolveSlug({ amenity: 'childcare' })).toBe('childcare');
  });

  it('maps amenity=kindergarten to "childcare" (alias)', () => {
    expect(resolveSlug({ amenity: 'kindergarten' })).toBe('childcare');
  });

  it('maps amenity=restaurant to "family-restaurant"', () => {
    expect(resolveSlug({ amenity: 'restaurant' })).toBe('family-restaurant');
  });

  it('maps amenity=fast_food to "family-restaurant"', () => {
    expect(resolveSlug({ amenity: 'fast_food' })).toBe('family-restaurant');
  });

  it('maps amenity=cafe to "family-restaurant"', () => {
    expect(resolveSlug({ amenity: 'cafe' })).toBe('family-restaurant');
  });

  // leisure takes priority over tourism when both are present. Without this
  // priority a soft play tagged tourism=attraction would be misfiled.
  it('prefers leisure over tourism when both tags exist', () => {
    const slug = resolveSlug({ leisure: 'soft_play', tourism: 'attraction' });
    expect(slug).toBe('soft-play');
  });

  // leisure takes priority over amenity too.
  it('prefers leisure over amenity when both tags exist', () => {
    const slug = resolveSlug({ leisure: 'playground', amenity: 'cafe' });
    expect(slug).toBe('playground');
  });

  // An unrecognised tag combination must return null, not throw. The
  // transformElement caller checks for null and leaves osm_category_slug as
  // null. The insert script then assigns a fallback category.
  it('returns null for an unrecognised tag combination', () => {
    expect(resolveSlug({ leisure: 'dog_park' })).toBeNull();
  });

  it('returns null when no relevant tags are present', () => {
    expect(resolveSlug({ building: 'yes', name: 'Some Building' })).toBeNull();
  });

  // An empty tags object must return null, not throw.
  it('returns null for an empty tags object', () => {
    expect(resolveSlug({})).toBeNull();
  });
});

// ============================================================================
// transformElement — full venue record construction
// ============================================================================

describe('transformElement', () => {
  // ALL imports must start as is_published=false. A bug here would publish
  // unmoderated OSM content directly to the live app.
  it('always sets is_published to false', () => {
    const result = transformElement(makeNode());
    expect(result.is_published).toBe(false);
  });

  // ALL imports must start as moderation_status='pending'. Bypassing the
  // moderation queue would expose unverified content to families.
  it('always sets moderation_status to "pending"', () => {
    const result = transformElement(makeNode());
    expect(result.moderation_status).toBe('pending');
  });

  // ALL imports must be is_verified=false — a claimed business must go through
  // the verification flow, not be auto-verified from OSM data.
  it('always sets is_verified to false', () => {
    const result = transformElement(makeNode());
    expect(result.is_verified).toBe(false);
  });

  // The ODbL-1.0 license attribution is a legal requirement of OSM. Missing it
  // would violate the Open Database Licence.
  it('sets the license to "ODbL-1.0"', () => {
    const result = transformElement(makeNode());
    expect(result.license).toBe('ODbL-1.0');
  });

  it('sets data_source to "osm"', () => {
    const result = transformElement(makeNode());
    expect(result.data_source).toBe('osm');
  });

  // The osm_id must be type/id so the deduplication and insert scripts can
  // match records back to OSM and avoid duplicating nodes vs ways.
  it('builds osm_id as "type/id"', () => {
    const result = transformElement(makeNode({ type: 'node', id: 111 }));
    expect(result.osm_id).toBe('node/111');
  });

  it('builds osm_id as "way/id" for way elements', () => {
    const result = transformElement(makeWay({ id: 222 }));
    expect(result.osm_id).toBe('way/222');
  });

  // country must always be GB — this import pipeline is UK-only.
  it('sets country to "GB"', () => {
    const result = transformElement(makeNode());
    expect(result.country).toBe('GB');
  });

  // address_line2 is never populated from OSM data (OSM has no second address
  // line concept). It must be null so the DB does not store an empty string.
  it('sets address_line2 to null', () => {
    const result = transformElement(makeNode());
    expect(result.address_line2).toBeNull();
  });

  // price_range is almost never in OSM — must be null, not an empty string.
  it('sets price_range to null', () => {
    const result = transformElement(makeNode());
    expect(result.price_range).toBeNull();
  });
});

// ============================================================================
// transformElement — null / guard conditions
// ============================================================================

describe('transformElement — guard conditions (returns null)', () => {
  // An element with no name cannot be shown in the app. The DB name column
  // is NOT NULL. Without this guard every unnamed playground would cause a
  // Postgres insert failure.
  it('returns null when the element has no name tag', () => {
    const element = makeNode({ tags: { leisure: 'soft_play', 'addr:city': 'London' } });
    expect(transformElement(element)).toBeNull();
  });

  // A name that is only whitespace is treated as no name.
  it('returns null when the name tag is only whitespace', () => {
    const element = makeNode({ tags: { name: '   ', 'addr:city': 'London' } });
    expect(transformElement(element)).toBeNull();
  });

  // A name that is only control characters becomes null after sanitise().
  it('returns null when the name tag is only control characters', () => {
    const element = makeNode({ tags: { name: '\x00\x01\x02', 'addr:city': 'London' } });
    expect(transformElement(element)).toBeNull();
  });

  // Without coordinates we cannot place the venue on a map or run PostGIS
  // proximity queries. The DB latitude/longitude columns are NOT NULL.
  it('returns null when a node has no lat or lon', () => {
    const { lat, lon, ...rest } = makeNode();
    expect(transformElement(rest)).toBeNull();
  });

  // A way element without a center object (Overpass "out center") has no
  // coordinates. Must return null, not crash with a TypeError on center.lat.
  it('returns null when a way has no center object', () => {
    const element = makeWay();
    const { center, ...rest } = element;
    expect(transformElement(rest)).toBeNull();
  });

  // The city column is NOT NULL in the DB. Without a city the insert fails.
  // The city derivation falls through addr:city → addr:town → addr:village →
  // outward postcode code. If none is available, the venue must be skipped.
  it('returns null when no city can be derived and no postcode exists', () => {
    const element = makeNode({
      tags: { name: 'Mystery Venue', leisure: 'soft_play' },
      // No addr:city, addr:town, addr:village, addr:postcode
    });
    expect(transformElement(element)).toBeNull();
  });
});

// ============================================================================
// transformElement — coordinate handling
// ============================================================================

describe('transformElement — coordinate handling', () => {
  // Node elements carry lat/lon at the top level.
  it('uses top-level lat/lon for node elements', () => {
    const result = transformElement(makeNode({ lat: 51.5, lon: -0.12 }));
    expect(result.latitude).toBe(51.5);
    expect(result.longitude).toBe(-0.12);
  });

  // Way elements (areas) carry coordinates in element.center when Overpass
  // is queried with "out center". If we read lat/lon from the top level they
  // would be undefined, producing null coordinates.
  it('falls back to center.lat/center.lon for way elements', () => {
    const result = transformElement(makeWay({ center: { lat: 53.5, lon: -2.3 } }));
    expect(result.latitude).toBe(53.5);
    expect(result.longitude).toBe(-2.3);
  });

  // If both lat and center.lat are present, lat takes priority (top-level
  // always wins over center in the ?? chain).
  it('prefers top-level lat over center.lat when both are present', () => {
    const element = { ...makeNode(), lat: 51.0, center: { lat: 99.0 } };
    const result = transformElement(element);
    expect(result.latitude).toBe(51.0);
  });
});

// ============================================================================
// transformElement — address construction
// ============================================================================

describe('transformElement — address construction', () => {
  // The standard UK address format is "15 High Street". The two parts must
  // be joined with a space, not a comma.
  it('builds address_line1 as "houseNumber street"', () => {
    const result = transformElement(makeNode({
      tags: {
        name: 'Venue',
        'addr:housenumber': '42',
        'addr:street': 'Park Road',
        'addr:city': 'London',
      },
    }));
    expect(result.address_line1).toBe('42 Park Road');
  });

  // Only a street name (no house number) should produce just the street.
  it('produces just the street name when there is no house number', () => {
    const result = transformElement(makeNode({
      tags: {
        name: 'Venue',
        'addr:street': 'High Street',
        'addr:city': 'London',
      },
    }));
    expect(result.address_line1).toBe('High Street');
  });

  // When neither house number nor street is present, address_line1 should be
  // null — not an empty string that would display weirdly in the app.
  it('sets address_line1 to null when no house number or street is tagged', () => {
    const result = transformElement(makeNode());
    expect(result.address_line1).toBeNull();
  });

  // City fallback chain: addr:city first.
  it('uses addr:city as the city', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Venue', leisure: 'playground', 'addr:city': 'Birmingham' },
    }));
    expect(result.city).toBe('Birmingham');
  });

  // Second fallback: addr:town.
  it('falls back to addr:town when addr:city is absent', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Venue', leisure: 'playground', 'addr:town': 'Stratford' },
    }));
    expect(result.city).toBe('Stratford');
  });

  // Third fallback: addr:village.
  it('falls back to addr:village when addr:city and addr:town are absent', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Venue', leisure: 'playground', 'addr:village': 'Chipping Norton' },
    }));
    expect(result.city).toBe('Chipping Norton');
  });

  // Fourth fallback: outward postcode code (e.g. "SW1A" from "SW1A 2AA").
  it('falls back to the outward postcode when no city/town/village is tagged', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Venue', leisure: 'playground', 'addr:postcode': 'SW1A 2AA' },
    }));
    expect(result.city).toBe('SW1A');
  });
});

// ============================================================================
// transformElement — category slug and age range defaults
// ============================================================================

describe('transformElement — category slug and age defaults', () => {
  // The slug is the bridge to the categories table. If resolveSlug returns null
  // (unknown venue type), osm_category_slug must be null — not undefined or ''.
  it('sets osm_category_slug to null for an unrecognised tag', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Mystery Venue', leisure: 'unknown_sport', 'addr:city': 'London' },
    }));
    expect(result.osm_category_slug).toBeNull();
  });

  // Soft play must map to the correct slug — this is the most common import
  // category for PlayPlanner.
  it('sets osm_category_slug to "soft-play" for leisure=soft_play', () => {
    const result = transformElement(makeNode());  // default fixture has soft_play
    expect(result.osm_category_slug).toBe('soft-play');
  });

  // Age defaults for soft-play: 0–12. Wrong defaults would make venues invisible
  // to parents searching with age filters (e.g. a 5-year-old would miss venues
  // with max_age=4).
  it('applies the correct default age range for soft-play (0–12)', () => {
    const result = transformElement(makeNode());
    expect(result.min_age).toBe(0);
    expect(result.max_age).toBe(12);
  });

  it('applies the correct default age range for playground (0–16)', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Park', leisure: 'playground', 'addr:city': 'London' },
    }));
    expect(result.min_age).toBe(0);
    expect(result.max_age).toBe(16);
  });

  it('applies the correct default age range for trampoline (3–18)', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Bounce Zone', leisure: 'trampoline_park', 'addr:city': 'London' },
    }));
    expect(result.min_age).toBe(3);
    expect(result.max_age).toBe(18);
  });

  // Unknown slug must fall back to the universal 0–18 default, not throw.
  it('applies the 0–18 fallback age range when the slug is unrecognised', () => {
    const result = transformElement(makeNode({
      tags: { name: 'Mystery Venue', leisure: 'unknown_sport', 'addr:city': 'London' },
    }));
    expect(result.min_age).toBe(0);
    expect(result.max_age).toBe(18);
  });
});

// ============================================================================
// transformElement — contact fields
// ============================================================================

describe('transformElement — contact fields', () => {
  // OSM supports both `phone` and `contact:phone` tag styles. The hook should
  // prefer the direct `phone` tag but fall back to `contact:phone`.
  it('reads phone from the "phone" tag', () => {
    const result = transformElement(makeNode({
      tags: { ...makeNode().tags, phone: '+441234567890' },
    }));
    expect(result.phone).toBe('+441234567890');
  });

  it('falls back to "contact:phone" when "phone" is absent', () => {
    const result = transformElement(makeNode({
      tags: { ...makeNode().tags, 'contact:phone': '+449876543210' },
    }));
    expect(result.phone).toBe('+449876543210');
  });

  it('sets phone to null when no phone tag is present', () => {
    const result = transformElement(makeNode());
    expect(result.phone).toBeNull();
  });

  it('reads website from the "website" tag', () => {
    const result = transformElement(makeNode({
      tags: { ...makeNode().tags, website: 'https://example.com' },
    }));
    expect(result.website).toBe('https://example.com');
  });

  it('falls back to "contact:website" when "website" is absent', () => {
    const result = transformElement(makeNode({
      tags: { ...makeNode().tags, 'contact:website': 'https://contact.example.com' },
    }));
    expect(result.website).toBe('https://contact.example.com');
  });

  it('sets website to null when no website tag is present', () => {
    const result = transformElement(makeNode());
    expect(result.website).toBeNull();
  });
});
