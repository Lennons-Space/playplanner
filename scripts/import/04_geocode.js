/**
 * 04_geocode.js
 *
 * Fills in missing latitude/longitude coordinates for venues that have a
 * postcode but no coordinates. This is rare in OSM data but can happen for
 * some way-type elements where Overpass did not return a centre point.
 *
 * Uses postcodes.io — a free, open UK postcode lookup API that requires no
 * authentication and is funded by public data (OS Open Data).
 *
 * WHY a separate script? Geocoding is a network operation with its own
 * rate-limiting concerns. Keeping it separate means you can re-run it
 * independently if the API was temporarily unavailable.
 *
 * Run: node scripts/import/04_geocode.js
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------

const TRANSFORM_DIR = path.resolve(__dirname, '../data/transformed');
const IN_FILE       = path.join(TRANSFORM_DIR, 'venues_deduped.json');
const OUT_FILE      = path.join(TRANSFORM_DIR, 'venues_geocoded.json');

/** Milliseconds to wait between postcodes.io requests. */
const DELAY_MS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a bulk postcodes.io request for up to 100 postcodes at once.
 * POST https://api.postcodes.io/postcodes with body { "postcodes": [...] }
 * Returns a Map of postcode (uppercased, no spaces) → { latitude, longitude }.
 * Missing or invalid postcodes in the response are simply omitted from the map.
 */
function bulkLookupPostcodes(postcodes) {
  const body = JSON.stringify({ postcodes });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.postcodes.io',
      path:     '/postcodes',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'PlayPlanner-Import/1.0 (leappdevelop@gmail.com)',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn(`[warn] postcodes.io bulk endpoint returned ${res.statusCode}`);
          resolve(new Map());
          return;
        }
        try {
          const json = JSON.parse(data);
          const coordMap = new Map();
          for (const item of (json.result || [])) {
            if (item.result && item.result.latitude != null && item.result.longitude != null) {
              // Normalise the key: uppercase, no spaces — matches how we stored postcodes
              const key = item.query.replace(/\s+/g, '').toUpperCase();
              coordMap.set(key, {
                latitude:  item.result.latitude,
                longitude: item.result.longitude,
              });
            }
          }
          resolve(coordMap);
        } catch {
          console.warn('[warn] Could not parse postcodes.io bulk response');
          resolve(new Map());
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`[warn] postcodes.io bulk request failed: ${err.message}`);
      resolve(new Map());
    });

    req.setTimeout(30000, () => {
      req.destroy();
      console.warn('[warn] postcodes.io bulk request timed out');
      resolve(new Map());
    });

    req.write(body);
    req.end();
  });
}

/**
 * Returns true if a venue is missing usable coordinates.
 * Uses null/undefined checks rather than falsy checks so that a venue sitting
 * exactly on the Greenwich meridian (longitude = 0, e.g. Peacehaven, Greenwich)
 * is NOT wrongly treated as missing. The only excluded coordinate pair is (0, 0)
 * which is in the Gulf of Guinea and cannot be a real UK venue.
 */
function isMissingCoords(venue) {
  return venue.latitude == null || venue.longitude == null ||
         (venue.latitude === 0 && venue.longitude === 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Input file not found: ${IN_FILE}`);
    console.error('Run 03_deduplicate.js first.');
    process.exit(1);
  }

  const venues = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  console.log(`Loaded ${venues.length} venues from ${IN_FILE}`);

  const needsGeocoding = venues.filter((v) => isMissingCoords(v));
  const withPostcode   = needsGeocoding.filter((v) => v.postcode);
  const noLocation     = needsGeocoding.filter((v) => !v.postcode);

  console.log(`Venues needing geocoding: ${needsGeocoding.length}`);
  console.log(`  - Have postcode (will geocode): ${withPostcode.length}`);
  console.log(`  - No postcode (will skip):      ${noLocation.length}`);

  if (noLocation.length > 0) {
    console.log('\nSkipped (no location data):');
    for (const v of noLocation) {
      console.log(`  skipped (no location data): "${v.name}" (${v.osm_id})`);
    }
  }

  // Build a lookup map so we can update venues in place efficiently
  const venueMap = new Map(venues.map((v) => [v.osm_id, v]));

  let geocodedCount = 0;
  let failedCount   = 0;

  console.log('\nGeocoding (bulk mode)...');

  // Step 1: Collect unique postcodes from venues that need geocoding.
  // Many venues share a postcode (e.g. a shopping centre with several cafes),
  // so deduplicating here means we query each postcode only once.
  const uniquePostcodes = [...new Set(
    withPostcode.map((v) => v.postcode.replace(/\s+/g, '').toUpperCase())
  )];

  // Build a reverse map: normalised postcode → all venues that use it
  const postcodeToVenues = new Map();
  for (const venue of withPostcode) {
    const key = venue.postcode.replace(/\s+/g, '').toUpperCase();
    if (!postcodeToVenues.has(key)) postcodeToVenues.set(key, []);
    postcodeToVenues.get(key).push(venue);
  }

  console.log(`  ${withPostcode.length} venues share ${uniquePostcodes.length} unique postcodes`);
  console.log(`  Sending ${Math.ceil(uniquePostcodes.length / 100)} bulk request(s) (100 postcodes each)...\n`);

  // Step 2: Query postcodes.io in batches of 100 (the API maximum per request).
  const BULK_BATCH_SIZE = 100;
  const coordCache = new Map(); // normalised postcode → { latitude, longitude } | null

  for (let i = 0; i < uniquePostcodes.length; i += BULK_BATCH_SIZE) {
    const batch      = uniquePostcodes.slice(i, i + BULK_BATCH_SIZE);
    const batchNum   = Math.floor(i / BULK_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniquePostcodes.length / BULK_BATCH_SIZE);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} postcodes)... `);

    const coordMap = await bulkLookupPostcodes(batch);

    // Record results in the cache; mark postcodes with no result as null
    for (const pc of batch) {
      coordCache.set(pc, coordMap.get(pc) || null);
    }

    console.log(`done (${coordMap.size}/${batch.length} resolved)`);

    // Polite delay between bulk batches — 100ms as specified
    if (i + BULK_BATCH_SIZE < uniquePostcodes.length) {
      await sleep(DELAY_MS);
    }
  }

  // Step 3: Apply coordinates back to venues using the cache.
  for (const venue of withPostcode) {
    const key    = venue.postcode.replace(/\s+/g, '').toUpperCase();
    const coords = coordCache.get(key);

    if (coords) {
      venueMap.get(venue.osm_id).latitude  = coords.latitude;
      venueMap.get(venue.osm_id).longitude = coords.longitude;
      geocodedCount++;
    } else {
      failedCount++;
    }
  }

  // Filter out venues that still have no usable coordinates — they would
  // cause NOT NULL violations at insert time and cannot appear on the map.
  const all    = Array.from(venueMap.values());
  const result = all.filter(
    (v) => v.latitude != null && v.longitude != null &&
           !(v.latitude === 0 && v.longitude === 0)
  );
  const dropped = all.length - result.length;

  fs.writeFileSync(OUT_FILE, JSON.stringify(result), 'utf8');

  console.log(`\nGeocoded ${geocodedCount} venues from postcode · Skipped ${noLocation.length} (no location)`);
  if (failedCount > 0) {
    console.log(`  Note: ${failedCount} postcode lookups returned no result (postcode may be invalid or terminated).`);
  }
  if (dropped > 0) {
    console.log(`  Dropped ${dropped} venues with no usable coordinates (would fail DB insert).`);
  }
  console.log(`Output → ${OUT_FILE}`);
  console.log('\nRun 05_insert.js next.');
}

main().catch((err) => {
  console.error('Fatal error in 04_geocode.js:', err);
  process.exit(1);
});
