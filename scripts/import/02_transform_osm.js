/**
 * 02_transform_osm.js
 *
 * Reads all cell_*.json files from scripts/data/raw/osm/ and transforms each
 * OSM element into a PlayPlanner venue record shape, then deduplicates on
 * osm_id and saves to scripts/data/transformed/venues_osm.json.
 *
 * WHY transform separately from fetch? Keeping fetch and transform as separate
 * steps means you can re-run the transform with different mapping rules
 * without re-hitting the Overpass API.
 *
 * Flags:
 *   --dry-run   Run all transform logic and print full stats, but do NOT write
 *               the output file. Useful for QA after adding new venue types.
 *
 * Run: node scripts/import/02_transform_osm.js
 * Run: node scripts/import/02_transform_osm.js --dry-run
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------

const RAW_DIR       = path.resolve(__dirname, '../data/raw/osm');
const TRANSFORM_DIR = path.resolve(__dirname, '../data/transformed');
const OUT_FILE      = path.join(TRANSFORM_DIR, 'venues_osm.json');

// ---------------------------------------------------------------------------
// Tag → category slug mapping
//
// WHY slugs and not UUIDs? The DB categories table is environment-specific
// (staging vs production have different UUIDs). Slugs are stable identifiers
// that the insert script resolves to UUIDs at runtime.
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
  // Rural / small-town venue types added for better coverage outside cities.
  // WHY these slugs? Mapped to the closest existing DB category — e.g. a water
  // park is a specialised swimming venue; a nature reserve or named park is an
  // outdoor-sports destination; farms with visitor access are animal-attractions.
  'leisure=water_park':      'swimming',
  'leisure=nature_reserve':  'outdoor-sports',
  'leisure=park':            'outdoor-sports',
  'tourism=farm':            'animal-attraction',
  'historic=castle':         'attraction',
  'historic=ruins':          'attraction',
  'historic=fort':           'attraction',
  'amenity=arts_centre':     'attraction',
  'tourism=picnic_site':     'outdoor-sports',
};

// ---------------------------------------------------------------------------
// Default age ranges per category slug
//
// WHY defaults? OSM data rarely includes age-suitability info. Using
// sensible defaults means venues are immediately usable in age-filtered
// searches, and venue owners can correct them via the claimed listing flow.
//
// The existing outdoor-sports (5–18) and attraction (0–18) entries already
// cover all new slug mappings above — no new entries are required.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips control characters and unprintable Unicode from a string, then
 * truncates to maxLen characters. Returns null for empty / non-string input.
 *
 * WHY? OSM is crowdsourced. Names and descriptions can contain:
 *   - ASCII control chars (\x00–\x1F, \x7F) — break JSON / DB storage
 *   - Unicode control / private-use code points — confusing in the app UI
 *   - Excessively long strings — can overflow DB columns or the app layout
 *
 * @param {unknown} s    - Input value (expected string).
 * @param {number} maxLen - Maximum character length (default 500).
 * @returns {string|null}
 */
function sanitise(s, maxLen = 500) {
  if (typeof s !== 'string') return null;
  // Remove C0/C1 control characters and lone surrogates
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x1F\x7F-�]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen);
}

/**
 * Determines the best-matching category slug for an OSM element.
 *
 * Priority order: leisure → tourism → historic → amenity
 *
 * WHY this order?
 *   - leisure covers the most specific family-venue types (soft play,
 *     playground, swimming). It must always win over generic tourism tags.
 *   - tourism covers destination types (theme park, museum, farm).
 *   - historic is specific enough to map to 'attraction' without ambiguity.
 *   - amenity is lowest priority because its tags (restaurant, cafe) are
 *     only included when filtered by kids_menu/children tags in the fetch.
 *
 * Returns null if no known mapping exists.
 */
function resolveSlug(tags) {
  // Check leisure first — most family venues are tagged under leisure
  if (tags.leisure) {
    const key = `leisure=${tags.leisure}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  if (tags.tourism) {
    const key = `tourism=${tags.tourism}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  if (tags.historic) {
    const key = `historic=${tags.historic}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  if (tags.amenity) {
    const key = `amenity=${tags.amenity}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  return null;
}

/**
 * Returns true if coordinates fall within UK or British Crown Dependency territory.
 * UK = England, Scotland, Wales, Northern Ireland.
 * Crown Dependencies included: Channel Islands (Jersey, Guernsey).
 *
 * Explicitly excluded:
 *   - France / Normandy: lon > -5.0 at lat < 50°N (except Channel Islands)
 *   - Pas-de-Calais / Belgium: lon > 1.5 at lat < 51.5°N
 *   - Isle of Man: lat 53.9–54.5, lon -5.0 to -4.0 (Crown Dependency not served)
 *
 * Channel Islands bounding boxes:
 *   Jersey:   lat 49.1–49.35, lon -2.3 to -1.9
 *   Guernsey: lat 49.4–49.75, lon -2.75 to -2.4
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
function isWithinUK(lat, lon) {
  if (lat < 49.1 || lat > 61.0) return false;
  if (lon < -8.7 || lon > 1.8)  return false;
  // Channel Islands — British Crown Dependencies, accepted despite being south of 50°N.
  const isJersey   = lat > 49.1  && lat < 49.35 && lon > -2.3  && lon < -1.9;
  const isGuernsey = lat > 49.4  && lat < 49.75 && lon > -2.75 && lon < -2.4;
  if (isJersey || isGuernsey) return true;
  // Reject French Normandy and all non-UK land south of 50°N.
  // Cornwall's westernmost venues are at lon ~-5.7 (well west of -5.0) so they
  // are safely kept. French coast (lon > -5.0) at these latitudes is rejected.
  if (lat < 50.0 && lon > -5.0) return false;
  // Pas-de-Calais and Belgium: lat 50.5–51.5°N, lon > 1.5°E.
  // Kent's easternmost point is ~1.4°E, so lon > 1.5 is France/Belgium.
  if (lat < 51.5 && lon > 1.5) return false;
  // Isle of Man — Crown Dependency, not included in this dataset.
  // lat ~54.0–54.45, lon ~-4.85 to -4.28
  if (lat > 53.9 && lat < 54.5 && lon > -5.0 && lon < -4.0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Moderation-noise filter
//
// OSM tags generic structural features (mine shafts, chimneys, wall segments)
// with the same types as real family venues. When the name is a bare generic
// label these records are not venues — they are archaeological/industrial map
// features that would flood the moderation queue and never be published.
//
// Rules:
//   - Exact trimmed lowercase match against REJECT_NAMES (no substring checks)
//   - Antonine Wall segments handled separately via regex — "Antonine Wall
//     Visitor Centre" is a real attraction; wall segment nodes are not
//   - Real venues with descriptive names (e.g. "Chimney Farm Adventure") pass
// ---------------------------------------------------------------------------

const REJECT_NAMES = new Set([
  'chimney',
  'mine shaft',
  'mine chimney',
  'shaft',
  'ventilation shaft',
  'adit',
  'engine house',
]);

const ANTONINE_WALL_SEGMENT = /^antonine wall( segment)?$/i;

/**
 * Returns true if this name is a known structural artifact that is not a
 * family venue. Used to filter out OSM map features before they reach the DB.
 * @param {string} name — already sanitised, non-empty
 */
function isStructuralArtifact(name) {
  return REJECT_NAMES.has(name.trim().toLowerCase()) ||
         ANTONINE_WALL_SEGMENT.test(name.trim());
}

/**
 * Transforms a single OSM element into a PlayPlanner venue record.
 * Returns null if the element is missing required fields (name, coordinates).
 *
 * City fallback chain (most-to-least specific):
 *   addr:city → addr:town → addr:village → addr:hamlet → addr:county →
 *   addr:district → addr:region → postcode outward code → 'Unknown area'
 *
 * WHY keep venues with no address? Rural venues — nature reserves, farm parks,
 * historic castles — are often tagged in OSM with coordinates but no structured
 * address. Dropping them entirely would eliminate the coverage improvement we
 * are trying to achieve. 'Unknown area' is a safe placeholder; venue owners
 * can correct the address via the claim flow, and the DB city column is
 * satisfied.
 */
function transformElement(element) {
  const tags = element.tags || {};

  // Skip elements with no name — unnamed venues cannot be displayed.
  const name = sanitise(tags.name, 200);
  if (!name) return null;

  // Skip structural artifacts — OSM mine/industrial/heritage map features
  // whose bare generic name makes them unsuitable as family venue records.
  if (isStructuralArtifact(name)) return 'artifact';

  // For nodes, coordinates are at the top level.
  // For ways (areas), Overpass "out center" puts them in element.center.
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;

  // Skip elements with no usable coordinates at all.
  // (These are very rare but do occur for malformed OSM data.)
  if (lat === null || lon === null) return null;

  // Reject elements whose coordinates fall outside UK territory.
  // WHY here and not just in the bbox? The rectangular Overpass bbox at southern
  // latitudes (49–50°N) overlaps northern France. isWithinUK() applies the
  // geographic correction that the rectangle cannot express.
  if (!isWithinUK(lat, lon)) return null;

  const slug = resolveSlug(tags);

  // Build address_line1 from house number + street name, matching how
  // most UK addresses are displayed (e.g. "15 High Street").
  const houseNumber = tags['addr:housenumber'] || '';
  const street      = tags['addr:street'] || '';
  const addressLine1 = [houseNumber, street].filter(Boolean).join(' ') || null;

  // City fallback chain: try each address field in order of specificity.
  // For rural venues that have neither town nor village, hamlet or county is
  // better than nothing and prevents a valid venue being silently dropped.
  const rawPostcode = tags['addr:postcode'] || null;
  const city =
    tags['addr:city']     ||
    tags['addr:town']     ||
    tags['addr:village']  ||
    tags['addr:hamlet']   ||
    tags['addr:county']   ||
    tags['addr:district'] ||
    tags['addr:region']   ||
    (rawPostcode ? rawPostcode.split(' ')[0] : null) ||
    null;

  // If still no city at all, keep the venue if it has valid coords and a name
  // (both are already confirmed above). Use 'Unknown area' as a placeholder.
  // Venue owners can correct this via the claim flow.
  // Stats for fallback tiers are computed in main() by inspecting the returned
  // venue's city value and address tags — not stored on the record itself.
  const finalCity = city || 'Unknown area';

  const ages = SLUG_AGES[slug] || { min: 0, max: 18 };

  return {
    osm_id:            `${element.type}/${element.id}`,
    osm_category_slug: slug,               // resolved to UUID by 05_insert.js
    name,
    description:       sanitise(tags.description, 2000),
    address_line1:     addressLine1,
    address_line2:     null,               // OSM does not have address_line2
    city:              finalCity,
    postcode:          rawPostcode,
    country:           'GB',
    latitude:          lat,
    longitude:         lon,
    phone:             tags.phone || tags['contact:phone'] || null,
    website:           tags.website || tags['contact:website'] || null,
    price_range:       null,               // OSM rarely has pricing info
    min_age:           ages.min,
    max_age:           ages.max,
    is_published:      false,              // ALL imports start unpublished
    is_verified:       false,              // Must be manually verified
    is_premium:        false,
    moderation_status: 'pending',          // Must go through moderation queue
    data_source:       'osm',
    license:           'ODbL-1.0',         // OpenStreetMap Open Database Licence
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const isDryRun = process.argv.includes('--dry-run');

  // Ensure output directory exists (even in dry-run so the path is validated)
  fs.mkdirSync(TRANSFORM_DIR, { recursive: true });

  // Read all cell files from the raw directory
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`Raw data directory not found: ${RAW_DIR}`);
    console.error('Run 01_fetch_osm.js first.');
    process.exit(1);
  }

  const cellFiles = fs.readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort(); // sort for deterministic processing order

  if (cellFiles.length === 0) {
    console.error('No cell_*.json files found. Run 01_fetch_osm.js first.');
    process.exit(1);
  }

  console.log(`Reading ${cellFiles.length} cell files from ${RAW_DIR}...`);

  // ---------------------------------------------------------------------------
  // Stats counters
  // ---------------------------------------------------------------------------
  let totalElements    = 0;
  let droppedNoName    = 0;
  let droppedNoCoords  = 0;
  let droppedOutsideUK  = 0;   // rejected by isWithinUK() coordinate filter
  let droppedArtifact   = 0;   // rejected by isStructuralArtifact() name filter
  const rejectedExamples  = []; // up to 10 outside-UK names + coords for QA
  const artifactExamples  = []; // up to 5 artifact names for QA
  const REJECTED_EXAMPLE_LIMIT = 10;
  const ARTIFACT_EXAMPLE_LIMIT = 5;
  let keptNormal       = 0;   // had city/town/village
  let keptFallback     = 0;   // used hamlet/county/district/postcode
  let keptLocFallback  = 0;   // no address at all — kept by coords+name

  // Per-new-type counters for QA breakdown
  const newTypeCounts = {
    farm:          0,
    historic:      0,
    park:          0,
    nature_reserve: 0,
    arts_centre:   0,
    picnic_site:   0,
    water_park:    0,
  };

  // Collect up to 3 example names per new type for visual QA
  const newTypeExamples = {
    farm:          [],
    historic:      [],
    park:          [],
    nature_reserve: [],
    arts_centre:   [],
    picnic_site:   [],
    water_park:    [],
  };
  const EXAMPLE_LIMIT = 3;

  // Use a Map keyed by osm_id for O(1) deduplication across all cells.
  // WHY a Map? Because a venue near a cell boundary will appear in two
  // adjacent cell files. We keep only the first occurrence.
  const seen = new Map(); // osm_id → venue record

  for (const filename of cellFiles) {
    const filepath = path.join(RAW_DIR, filename);
    let elements;

    try {
      elements = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (err) {
      console.warn(`[warn] Could not parse ${filename}: ${err.message} — skipping`);
      continue;
    }

    if (!Array.isArray(elements)) {
      console.warn(`[warn] ${filename} does not contain an array — skipping`);
      continue;
    }

    totalElements += elements.length;

    for (const element of elements) {
      const tags = element.tags || {};

      // Pre-check name so we can count drops accurately before calling
      // transformElement (which also checks name internally).
      const nameRaw = sanitise(tags.name, 200);
      if (!nameRaw) {
        droppedNoName++;
        continue;
      }

      // Pre-check coords
      const lat = element.lat ?? element.center?.lat ?? null;
      const lon = element.lon ?? element.center?.lon ?? null;
      if (lat === null || lon === null) {
        droppedNoCoords++;
        continue;
      }

      const venue = transformElement(element);
      // transformElement returns:
      //   null      — no name, no coords, or outside UK
      //   'artifact'— structural artifact rejected by name filter
      //   object    — valid venue record
      if (venue === null) {
        droppedOutsideUK++;
        if (rejectedExamples.length < REJECTED_EXAMPLE_LIMIT) {
          rejectedExamples.push(
            `"${nameRaw}" (${lat.toFixed(3)}, ${lon.toFixed(3)})`
          );
        }
        continue;
      }
      if (venue === 'artifact') {
        droppedArtifact++;
        if (artifactExamples.length < ARTIFACT_EXAMPLE_LIMIT) {
          artifactExamples.push(`"${nameRaw}"`);
        }
        continue;
      }

      // Only keep the first occurrence of each osm_id
      if (seen.has(venue.osm_id)) continue;
      seen.set(venue.osm_id, venue);

      // Tally keep-tier by inspecting address tags directly.
      // location_fallback and city_fallback_used are no longer stored on the
      // record (they are transform-internal stats, not DB columns).
      const t2 = element.tags || {};
      const hasCity    = !!(t2['addr:city'] || t2['addr:town'] || t2['addr:village']);
      const hasFallback = !hasCity && !!(
        t2['addr:hamlet'] || t2['addr:county'] || t2['addr:district'] ||
        t2['addr:region'] || t2['addr:postcode']
      );
      if (venue.city === 'Unknown area') {
        keptLocFallback++;
      } else if (hasFallback) {
        keptFallback++;
      } else {
        keptNormal++;
      }

      // Tally new rural type breakdown
      const t = tags;
      let newTypeKey = null;
      if (t.tourism === 'farm')          newTypeKey = 'farm';
      else if (t.historic)               newTypeKey = 'historic';
      else if (t.leisure === 'park')     newTypeKey = 'park';
      else if (t.leisure === 'nature_reserve') newTypeKey = 'nature_reserve';
      else if (t.amenity === 'arts_centre')    newTypeKey = 'arts_centre';
      else if (t.tourism === 'picnic_site')    newTypeKey = 'picnic_site';
      else if (t.leisure === 'water_park')     newTypeKey = 'water_park';

      if (newTypeKey) {
        newTypeCounts[newTypeKey]++;
        if (newTypeExamples[newTypeKey].length < EXAMPLE_LIMIT) {
          newTypeExamples[newTypeKey].push(venue.name);
        }
      }
    }
  }

  const venues = Array.from(seen.values());
  const total  = venues.length;

  // ---------------------------------------------------------------------------
  // Stats report
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('TRANSFORM STATS');
  console.log('='.repeat(60));
  console.log(`  Total elements read      : ${totalElements}`);
  console.log(`  Dropped — no name        : ${droppedNoName}`);
  console.log(`  Dropped — no coords      : ${droppedNoCoords}`);
  console.log(`  Dropped — outside UK     : ${droppedOutsideUK}`);
  if (rejectedExamples.length > 0) {
    console.log(`  Rejected examples (first ${rejectedExamples.length}):`);
    for (const ex of rejectedExamples) {
      console.log(`    - ${ex}`);
    }
  }
  console.log(`  Dropped — structural artifact : ${droppedArtifact}`);
  if (artifactExamples.length > 0) {
    console.log(`  Artifact examples (first ${artifactExamples.length}): ${artifactExamples.join(', ')}`);
  }
  console.log(`  Kept — normal (city/town/village) : ${keptNormal}`);
  console.log(`  Kept — fallback (hamlet/county/district/postcode) : ${keptFallback}`);
  console.log(`  Kept — location-only (no address, coords+name only) : ${keptLocFallback}`);
  console.log(`  Total unique venues      : ${total}`);
  console.log('');
  console.log('NEW RURAL TYPE BREAKDOWN');
  console.log('-'.repeat(40));
  for (const [type, count] of Object.entries(newTypeCounts)) {
    const examples = newTypeExamples[type].length > 0
      ? `  e.g. ${newTypeExamples[type].join(', ')}`
      : '  (none found)';
    console.log(`  ${type.padEnd(16)}: ${String(count).padStart(4)}  ${examples}`);
  }
  console.log('='.repeat(60));

  if (isDryRun) {
    console.log('\nDRY RUN — no file written.');
    return;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(venues), 'utf8');
  console.log(`\nOutput → ${OUT_FILE}`);
  console.log('\nRun 03_deduplicate.js next.');
}

// ---------------------------------------------------------------------------
// Exported for unit tests only — not used by the pipeline itself.
// WHY export? These pure functions can be required by test files without
// triggering main() or process.exit(), enabling isolated unit testing.
//
// WHY require.main === module? This is the standard Node.js pattern for
// "only run as a script, not when required by another module". When Jest
// requires this file, require.main is Jest's own entry point — not this
// file — so main() is never called. The exports are available immediately.
// When running via `node 02_transform_osm.js`, require.main IS this module,
// so main() runs exactly as before. No behaviour change for the pipeline.
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = { sanitise, resolveSlug, transformElement, isWithinUK, isStructuralArtifact };
}

if (require.main === module) {
  main();
}
