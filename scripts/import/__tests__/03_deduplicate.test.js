/**
 * Tests for scripts/import/03_deduplicate.js
 *
 * This script removes near-duplicate venues that share the same postcode and a
 * very similar name, using Fuse.js fuzzy matching (threshold=0.3).
 *
 * WHY this matters:
 *   - A venue near a cell boundary appears in two adjacent Overpass response
 *     files. Without deduplication, parents would see the same venue twice on
 *     the map — confusing and unprofessional.
 *   - If the threshold is too loose (e.g. 0.9), genuinely different venues
 *     sharing a postcode (e.g. a soft play and a café in the same building)
 *     would be merged — venue data would be lost silently.
 *   - If the threshold is too strict (e.g. 0.0, exact match only), a venue
 *     listed as "Banbury Soft Play" in one cell and "Banbury Softplay" in
 *     another would survive as a duplicate.
 *   - Venues with no postcode must be kept as-is — we cannot deduplicate
 *     without a location anchor, and discarding them would drop valid data.
 *
 * NOTE: main() is not tested here (it reads/writes files). We test the
 * pure helper functions directly by replicating them verbatim, following
 * the same pattern as 02_transform_osm.test.js.
 *
 * Fuse.js must be installed: npm install fuse.js --legacy-peer-deps
 * (It is already in package.json dependencies so this is already satisfied.)
 */

'use strict';

// Fuse.js is a production dependency — require it the same way the script does.
let Fuse;
try {
  Fuse = require('fuse.js');
  if (Fuse.default) Fuse = Fuse.default;
} catch (err) {
  throw new Error(
    'fuse.js is not installed. Run: npm install fuse.js --legacy-peer-deps\n' +
    err.message
  );
}

// ---------------------------------------------------------------------------
// Replicated helpers (verbatim from 03_deduplicate.js)
// ---------------------------------------------------------------------------

const FUSE_THRESHOLD = 0.3;

function normalisePostcode(postcode) {
  return postcode.replace(/\s+/g, '').toUpperCase();
}

function groupByPostcode(venues) {
  const groups = new Map();
  for (const venue of venues) {
    const key = venue.postcode
      ? normalisePostcode(venue.postcode)
      : '_NO_POSTCODE_';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(venue);
  }
  return groups;
}

function deduplicateGroup(venues) {
  const kept      = [];
  const discarded = [];

  for (const candidate of venues) {
    if (kept.length === 0) {
      kept.push(candidate);
      continue;
    }

    const fuse = new Fuse(kept, {
      keys:           ['name'],
      threshold:      FUSE_THRESHOLD,
      includeScore:   true,
      ignoreLocation: true,
    });

    const results = fuse.search(candidate.name);

    if (results.length > 0) {
      const match = results[0];
      const score = match.score !== undefined ? match.score.toFixed(3) : 'n/a';
      console.log(
        `  [dup] "${candidate.name}" (${candidate.osm_id}) ≈ "${match.item.name}" (${match.item.osm_id}) score=${score} postcode=${candidate.postcode}`
      );
      discarded.push(candidate.osm_id);
    } else {
      kept.push(candidate);
    }
  }

  return { kept, discarded };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVenue(overrides = {}) {
  return {
    osm_id:            overrides.osm_id     ?? 'node/1',
    name:              overrides.name       ?? 'Test Venue',
    postcode:          overrides.postcode   ?? 'SW1A 1AA',
    city:              overrides.city       ?? 'London',
    moderation_status: 'pending',
    is_published:      false,
    ...overrides,
  };
}

// Silence console.log from deduplicateGroup's duplicate detection output.
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// normalisePostcode
// ============================================================================

describe('normalisePostcode', () => {
  // "SW1A 1AA" and "SW1A1AA" must normalise to the same key so that venues
  // in the same postcode but with different spacing get grouped correctly.
  it('strips internal spaces', () => {
    expect(normalisePostcode('SW1A 1AA')).toBe('SW1A1AA');
  });

  // Postcode from OSM can be lowercase (e.g. "sw1a 1aa") — must normalise to
  // uppercase so grouping is case-insensitive.
  it('converts to uppercase', () => {
    expect(normalisePostcode('sw1a 1aa')).toBe('SW1A1AA');
  });

  // A postcode with no space (already normalised) must pass through unchanged.
  it('returns the postcode unchanged when it has no spaces', () => {
    expect(normalisePostcode('M11AE')).toBe('M11AE');
  });

  // Multiple spaces (rare but possible in crowdsourced data) must all be stripped.
  it('strips multiple consecutive spaces', () => {
    expect(normalisePostcode('EC1A  1BB')).toBe('EC1A1BB');
  });
});

// ============================================================================
// groupByPostcode
// ============================================================================

describe('groupByPostcode', () => {
  // The most important behaviour: two venues with the same postcode (even
  // different spacing/case) must end up in the same group.
  it('groups two venues with the same postcode together', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', postcode: 'SW1A 1AA' }),
      makeVenue({ osm_id: 'node/2', postcode: 'SW1A1AA' }),  // same, no space
    ];

    const groups = groupByPostcode(venues);

    expect(groups.get('SW1A1AA')).toHaveLength(2);
  });

  // Two venues with different postcodes must be in separate groups.
  it('puts venues with different postcodes into separate groups', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', postcode: 'SW1A 1AA' }),
      makeVenue({ osm_id: 'node/2', postcode: 'EC1A 1BB' }),
    ];

    const groups = groupByPostcode(venues);

    expect(groups.get('SW1A1AA')).toHaveLength(1);
    expect(groups.get('EC1A1BB')).toHaveLength(1);
  });

  // Venues without a postcode go into the special '_NO_POSTCODE_' bucket.
  // They must be kept without deduplication — we cannot compare locations
  // without a postcode anchor.
  it('puts venues without a postcode into the "_NO_POSTCODE_" group', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', postcode: null }),
      makeVenue({ osm_id: 'node/2', postcode: null }),
    ];

    const groups = groupByPostcode(venues);

    expect(groups.get('_NO_POSTCODE_')).toHaveLength(2);
    // Must NOT create a group keyed by 'null' or empty string
    expect(groups.has('null')).toBe(false);
    expect(groups.has('')).toBe(false);
  });

  // Mixed: some with postcode, some without.
  it('correctly separates venues with and without postcodes', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', postcode: 'M1 1AE' }),
      makeVenue({ osm_id: 'node/2', postcode: null }),
      makeVenue({ osm_id: 'node/3', postcode: 'M1 1AE' }),
    ];

    const groups = groupByPostcode(venues);

    expect(groups.get('M11AE')).toHaveLength(2);
    expect(groups.get('_NO_POSTCODE_')).toHaveLength(1);
  });

  // An empty input array must return an empty Map without crashing.
  it('returns an empty Map for an empty venues array', () => {
    const groups = groupByPostcode([]);
    expect(groups.size).toBe(0);
  });
});

// ============================================================================
// deduplicateGroup — core fuzzy matching
// ============================================================================

describe('deduplicateGroup', () => {
  // The first venue in the group is always kept — it is the "canonical" record.
  it('always keeps the first venue in a single-item group', () => {
    const venues = [makeVenue({ osm_id: 'node/1', name: 'Soft Play Zone' })];
    const { kept, discarded } = deduplicateGroup(venues);
    expect(kept).toHaveLength(1);
    expect(discarded).toHaveLength(0);
  });

  // Two completely different names in the same postcode must both be kept.
  // A threshold that is too loose would silently drop valid venues.
  it('keeps both venues when names are clearly different', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Soft Play World' }),
      makeVenue({ osm_id: 'node/2', name: 'Italian Kitchen' }),
    ];
    const { kept, discarded } = deduplicateGroup(venues);
    expect(kept).toHaveLength(2);
    expect(discarded).toHaveLength(0);
  });

  // An exact duplicate name (same postcode, same name — two cell boundary hits)
  // must be deduplicated. The second one is discarded.
  it('discards an exact duplicate name', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Banbury Soft Play' }),
      makeVenue({ osm_id: 'node/2', name: 'Banbury Soft Play' }),
    ];
    const { kept, discarded } = deduplicateGroup(venues);
    expect(kept).toHaveLength(1);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toBe('node/2');
  });

  // A very minor name variant (one word difference, high similarity) must be
  // treated as a duplicate. This is the primary value of fuzzy matching.
  it('discards a near-duplicate with a minor name variation', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Banbury Soft Play' }),
      makeVenue({ osm_id: 'node/2', name: 'Banbury Soft Play Centre' }),
    ];
    const { kept, discarded } = deduplicateGroup(venues);
    expect(kept).toHaveLength(1);
    // The first one (the original) must be kept.
    expect(kept[0].osm_id).toBe('node/1');
    expect(discarded).toContain('node/2');
  });

  // A single-character typo must be caught (e.g. "Softplay" vs "Softpaly").
  it('discards a near-duplicate with a single-character typo', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Softplay Kingdom' }),
      makeVenue({ osm_id: 'node/2', name: 'Softpaly Kingdom' }), // transposed a/l
    ];
    const { kept, discarded } = deduplicateGroup(venues);
    // With threshold=0.3 and ignoreLocation=true, a single transposition in a
    // two-word name should be caught.
    expect(kept).toHaveLength(1);
    expect(discarded).toHaveLength(1);
  });

  // Genuinely different venues at the same postcode (e.g. a building has both
  // a soft play and a café) must NOT be merged.
  it('keeps distinct venues that share a postcode but have unrelated names', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Jungle Gym Soft Play' }),
      makeVenue({ osm_id: 'node/2', name: 'Café Bella' }),
      makeVenue({ osm_id: 'node/3', name: 'Central Library' }),
    ];
    const { kept, discarded } = deduplicateGroup(venues);
    expect(kept).toHaveLength(3);
    expect(discarded).toHaveLength(0);
  });

  // The first venue is always the winner. If there are three copies and the
  // first is the original, all others must be discarded.
  it('keeps only the first occurrence when three identical venues exist', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Happy Kids Play' }),
      makeVenue({ osm_id: 'node/2', name: 'Happy Kids Play' }),
      makeVenue({ osm_id: 'node/3', name: 'Happy Kids Play' }),
    ];
    const { kept, discarded } = deduplicateGroup(venues);
    expect(kept).toHaveLength(1);
    expect(kept[0].osm_id).toBe('node/1');
    expect(discarded).toHaveLength(2);
  });

  // The discarded array must contain the osm_ids of removed venues, not the
  // full venue objects. The main() function logs these IDs for audit purposes.
  it('puts the osm_id strings (not venue objects) into the discarded array', () => {
    const venues = [
      makeVenue({ osm_id: 'node/10', name: 'Play Zone' }),
      makeVenue({ osm_id: 'node/20', name: 'Play Zone' }),
    ];
    const { discarded } = deduplicateGroup(venues);
    expect(typeof discarded[0]).toBe('string');
    expect(discarded[0]).toBe('node/20');
  });

  // An empty group must return empty arrays without crashing.
  it('handles an empty venues array gracefully', () => {
    const { kept, discarded } = deduplicateGroup([]);
    expect(kept).toHaveLength(0);
    expect(discarded).toHaveLength(0);
  });
});

// ============================================================================
// Integration: full deduplication pipeline
// ============================================================================

describe('full deduplication pipeline (groupByPostcode + deduplicateGroup)', () => {
  /**
   * Runs the same logic as main() but without the filesystem I/O.
   * This mirrors exactly what the script does after reading the JSON file.
   */
  function runDeduplication(venues) {
    const groups        = groupByPostcode(venues);
    const keptVenues    = [];
    const allDiscarded  = [];

    for (const [postcode, group] of groups) {
      if (postcode === '_NO_POSTCODE_') {
        keptVenues.push(...group);
        continue;
      }
      if (group.length === 1) {
        keptVenues.push(group[0]);
        continue;
      }
      const { kept, discarded } = deduplicateGroup(group);
      keptVenues.push(...kept);
      allDiscarded.push(...discarded);
    }

    return { keptVenues, allDiscarded };
  }

  // A realistic scenario: two cells overlap and return the same venue twice,
  // plus an unrelated venue in the same postcode, plus a venue in a different
  // postcode.
  it('removes the cell-boundary duplicate while keeping all other venues', () => {
    const venues = [
      makeVenue({ osm_id: 'node/1', name: 'Soft Play World',   postcode: 'SW1A 1AA' }),
      makeVenue({ osm_id: 'node/2', name: 'Soft Play World',   postcode: 'SW1A 1AA' }), // dup
      makeVenue({ osm_id: 'node/3', name: 'City Café',         postcode: 'SW1A 1AA' }),
      makeVenue({ osm_id: 'node/4', name: 'Manchester Splash', postcode: 'M1 1AE'  }),
    ];

    const { keptVenues, allDiscarded } = runDeduplication(venues);

    expect(keptVenues).toHaveLength(3);
    expect(allDiscarded).toContain('node/2');
    // The non-duplicate in the same postcode must be kept.
    expect(keptVenues.some((v) => v.osm_id === 'node/3')).toBe(true);
    // The different-postcode venue must be kept.
    expect(keptVenues.some((v) => v.osm_id === 'node/4')).toBe(true);
  });

  // Venues with no postcode must ALL be kept — no deduplication possible.
  it('keeps all venues that have no postcode', () => {
    const venues = [
      makeVenue({ osm_id: 'node/5', name: 'Park With No Postcode',    postcode: null }),
      makeVenue({ osm_id: 'node/6', name: 'Another Park No Postcode', postcode: null }),
    ];

    const { keptVenues, allDiscarded } = runDeduplication(venues);

    expect(keptVenues).toHaveLength(2);
    expect(allDiscarded).toHaveLength(0);
  });

  // A single-venue group must pass through as-is (no comparison to make).
  it('passes through a single-venue group without modification', () => {
    const venues = [
      makeVenue({ osm_id: 'node/7', name: 'Lonely Venue', postcode: 'B1 1AA' }),
    ];

    const { keptVenues, allDiscarded } = runDeduplication(venues);

    expect(keptVenues).toHaveLength(1);
    expect(allDiscarded).toHaveLength(0);
  });

  // Large batch: confirm output count is correct (all unique venues kept,
  // all duplicates removed).
  it('processes a large batch of venues and removes only the duplicates', () => {
    const venues = [
      // Group 1: SW1A1AA — one duplicate pair, one unique
      makeVenue({ osm_id: 'node/101', name: 'Kensington Play Centre', postcode: 'SW1A 1AA' }),
      makeVenue({ osm_id: 'node/102', name: 'Kensington Play Centre', postcode: 'SW1A 1AA' }), // dup
      makeVenue({ osm_id: 'node/103', name: 'Royal Mews Café',        postcode: 'SW1A 1AA' }),
      // Group 2: M11AE — all unique
      makeVenue({ osm_id: 'node/201', name: 'Northern Bounce',        postcode: 'M1 1AE' }),
      makeVenue({ osm_id: 'node/202', name: 'Ancoats Playground',     postcode: 'M1 1AE' }),
      // Group 3: no postcode — must keep all
      makeVenue({ osm_id: 'node/301', name: 'Rural Park',             postcode: null }),
    ];

    const { keptVenues, allDiscarded } = runDeduplication(venues);

    // 5 unique venues + 1 no-postcode = 5 kept, 1 discarded
    expect(keptVenues).toHaveLength(5);
    expect(allDiscarded).toHaveLength(1);
    expect(allDiscarded[0]).toBe('node/102');
  });

  // Deduplication must be stable: running the same input twice must produce
  // the same output. If it were non-deterministic, the import pipeline could
  // produce different results on retry, confusing debugging.
  it('produces deterministic output (same input → same output)', () => {
    const venues = [
      makeVenue({ osm_id: 'node/a', name: 'Bouncy Castle World', postcode: 'EC1A 1BB' }),
      makeVenue({ osm_id: 'node/b', name: 'Bouncy Castle World', postcode: 'EC1A 1BB' }),
      makeVenue({ osm_id: 'node/c', name: 'Science Museum',      postcode: 'EC1A 1BB' }),
    ];

    const first  = runDeduplication(venues);
    const second = runDeduplication(venues);

    expect(first.keptVenues.map((v) => v.osm_id))
      .toEqual(second.keptVenues.map((v) => v.osm_id));
    expect(first.allDiscarded).toEqual(second.allDiscarded);
  });
});
