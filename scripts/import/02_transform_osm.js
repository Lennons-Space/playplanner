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
 * Run: node scripts/import/02_transform_osm.js
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
};

// ---------------------------------------------------------------------------
// Default age ranges per category slug
//
// WHY defaults? OSM data rarely includes age-suitability info. Using
// sensible defaults means venues are immediately usable in age-filtered
// searches, and venue owners can correct them via the claimed listing flow.
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
  const cleaned = s.replace(/[\x00-\x1F\x7F\u0080-\u009F\uFFFD]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen);
}

/**
 * Determines the best-matching category slug for an OSM element.
 * Checks leisure → tourism → amenity in priority order.
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
  if (tags.amenity) {
    const key = `amenity=${tags.amenity}`;
    if (TAG_TO_SLUG[key]) return TAG_TO_SLUG[key];
  }
  return null;
}

/**
 * Transforms a single OSM element into a PlayPlanner venue record.
 * Returns null if the element is missing required fields (name, coordinates).
 */
function transformElement(element) {
  const tags = element.tags || {};

  // Skip elements with no name — unnamed venues cannot be displayed.
  const name = sanitise(tags.name, 200);
  if (!name) return null;

  // For nodes, coordinates are at the top level.
  // For ways (areas), Overpass "out center" puts them in element.center.
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;

  // Skip elements with no usable coordinates at all.
  // (These are very rare but do occur for malformed OSM data.)
  if (lat === null || lon === null) return null;

  const slug = resolveSlug(tags);

  // Build address_line1 from house number + street name, matching how
  // most UK addresses are displayed (e.g. "15 High Street").
  const houseNumber = tags['addr:housenumber'] || '';
  const street      = tags['addr:street'] || '';
  const addressLine1 = [houseNumber, street].filter(Boolean).join(' ') || null;

  // city: try addr:city first, then addr:town, then addr:village.
  const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || null;

  const ages = SLUG_AGES[slug] || { min: 0, max: 18 };

  return {
    osm_id:            `${element.type}/${element.id}`,
    osm_category_slug: slug,               // resolved to UUID by 05_insert.js
    name,
    description:       sanitise(tags.description, 2000),
    address_line1:     addressLine1,
    address_line2:     null,               // OSM does not have address_line2
    city,
    postcode:          tags['addr:postcode'] || null,
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
  // Ensure output directory exists
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

  let totalElements  = 0;
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
      const venue = transformElement(element);
      if (!venue) continue;

      // Only keep the first occurrence of each osm_id
      if (!seen.has(venue.osm_id)) {
        seen.set(venue.osm_id, venue);
      }
    }
  }

  const venues = Array.from(seen.values());

  fs.writeFileSync(OUT_FILE, JSON.stringify(venues), 'utf8');

  console.log(
    `Transformed ${totalElements} elements from ${cellFiles.length} cells → ${venues.length} unique venues`
  );
  console.log(`Output → ${OUT_FILE}`);
  console.log('\nRun 03_deduplicate.js next.');
}

main();
