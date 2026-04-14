/**
 * 01_fetch_osm.js
 *
 * Fetches family-friendly venue data from the OpenStreetMap Overpass API
 * across the entire UK using a grid of 1° × 1° cells (110 cells total).
 *
 * WHY a grid? Overpass has memory and time limits per query. Splitting the UK
 * into small cells keeps each query fast and avoids timeouts.
 *
 * WHY checkpointing? The full UK fetch takes ~6 minutes at 3s per cell.
 * If it crashes midway, saved cell files let you resume without re-fetching.
 *
 * Run: node scripts/import/01_fetch_osm.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * UK bounding box.
 * - lat 49–61 N: 49 covers Channel Islands and Isles of Scilly.
 * - lng -8.7–2 E: -8.7 covers Northern Ireland's western coast (was -8.0 which
 *   missed NI) and St Kilda. England/Wales reach about -5.7; Scotland -7.7;
 *   NI reaches -8.17 at Malin Head.
 */
const LAT_START = 53.3;
const LAT_END   = 53.6;
const LNG_START = -2.4;
const LNG_END   = -2.1;
const STEP      =  1.0;

const DELAY_MS  = 3000; // 3 seconds between requests — be a polite API citizen

const RAW_DIR = path.resolve(__dirname, '../data/raw/osm');

const OVERPASS_PRIMARY  = 'https://overpass-api.de/api/interpreter';
const OVERPASS_FALLBACK = 'https://overpass.kumi.systems/api/interpreter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes an HTTP/HTTPS POST request and returns the response body as a string.
 * Uses Node's built-in http/https — no external fetch library needed.
 */
function postRequest(url, body) {
  return new Promise((resolve, reject) => {
    const isHttps  = url.startsWith('https');
    const lib      = isHttps ? https : http;
    const encoded  = encodeURIComponent(body);
    const postData = `data=${encoded}`;

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent':     'PlayPlanner-Import/1.0 (leappdevelop@gmail.com)',
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    // Overpass can be slow; give it up to 120 seconds before we give up.
    req.setTimeout(120000, () => {
      req.destroy(new Error('Request timed out after 120s'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Builds the Overpass QL query for a single grid cell.
 * BBOX format for Overpass is: south,west,north,east
 */
function buildQuery(south, west, north, east) {
  const bbox = `${south},${west},${north},${east}`;
  // This query targets venue types that are relevant for families with children.
  // "access"!="private" filters out venues that are not open to the public.
  // "out center" tells Overpass to return the centroid for way (area) elements.
  return `[out:json][timeout:90];
(
  node["leisure"~"^(playground|soft_play|indoor_play|sports_centre|swimming_pool|bowling_alley|mini_golf|trampoline_park)$"]["access"!="private"](${bbox});
  way["leisure"~"^(playground|soft_play|indoor_play|sports_centre|swimming_pool)$"]["access"!="private"](${bbox});
  node["tourism"~"^(theme_park|zoo|aquarium|museum|attraction)$"](${bbox});
  way["tourism"~"^(theme_park|zoo|aquarium)$"](${bbox});
  node["amenity"~"^(childcare|kindergarten)$"](${bbox});
  node["amenity"~"^(restaurant|fast_food|cafe)$"]["kids_menu"="yes"](${bbox});
  node["amenity"~"^(restaurant|cafe)$"]["children"="yes"](${bbox});
  node["leisure"="pitch"]["sport"~"football|tennis|cricket"]["access"!="private"](${bbox});
);
out center;`;
}

/**
 * Fetches a single cell from Overpass, trying the primary endpoint first,
 * then falling back to the mirror if it fails.
 */
async function fetchCell(south, west, north, east) {
  const query = buildQuery(south, west, north, east);

  // Try primary, then fallback
  for (const endpoint of [OVERPASS_PRIMARY, OVERPASS_FALLBACK]) {
    try {
      const raw  = await postRequest(endpoint, query);
      const json = JSON.parse(raw);
      return json.elements || [];
    } catch (err) {
      console.warn(`  [warn] ${endpoint} failed: ${err.message}. Trying next...`);
    }
  }

  throw new Error('Both Overpass endpoints failed.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // Build the full list of grid cells upfront so we can show progress counters.
  const cells = [];
  for (let lat = LAT_START; lat < LAT_END; lat += STEP) {
    for (let lng = LNG_START; lng < LNG_END; lng += STEP) {
      cells.push({ south: lat, west: lng, north: lat + STEP, east: lng + STEP });
    }
  }

  const total = cells.length;
  console.log(`Starting OSM fetch: ${total} grid cells across the UK.`);
  console.log(`Raw output → ${RAW_DIR}\n`);

  for (let i = 0; i < cells.length; i++) {
    const { south, west, north, east } = cells[i];

    // Use fixed-precision numbers so the filename is always consistent.
    // e.g. "cell_50.0_-8.0.json"
    const label    = `lat=${south.toFixed(1)} lng=${west.toFixed(1)}`;
    const filename = `cell_${south.toFixed(1)}_${west.toFixed(1)}.json`;
    const filepath = path.join(RAW_DIR, filename);
    const counter  = `[${String(i + 1).padStart(3, '0')}/${total}]`;

    // --- Checkpoint: skip cells already fetched ---
    // An existing non-empty file means this cell was already processed.
    // Even failed cells are saved as [] so they do not get re-tried endlessly.
    if (fs.existsSync(filepath)) {
      const existing = fs.readFileSync(filepath, 'utf8').trim();
      if (existing.length > 0) {
        const parsed = JSON.parse(existing);
        console.log(`${counter} SKIP  ${label} (cached: ${parsed.length} elements)`);
        continue;
      }
    }

    process.stdout.write(`${counter} Fetching ${label} ... `);

    try {
      const elements = await fetchCell(south, west, north, east);
      fs.writeFileSync(filepath, JSON.stringify(elements, null, 2), 'utf8');
      console.log(`done (${elements.length} elements)`);
    } catch (err) {
      // Save an empty array so this cell is not retried. Log clearly.
      fs.writeFileSync(filepath, '[]', 'utf8');
      console.log(`FAILED — ${err.message}`);
      console.error(`  [error] Cell ${label} failed. Saved [] to avoid retry.`);
    }

    // Wait before the next request to avoid hammering the public API.
    if (i < cells.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Second pass: subdivide failed cells in the London dense region
  console.log('\n[Pass 2] Subdividing failed cells in dense region (London)...');
  const DENSE_LAT_MIN = 51, DENSE_LAT_MAX = 52;
  const DENSE_LNG_MIN = -1, DENSE_LNG_MAX = 1;
  const SUB_STEP = 0.5;

  for (let lat = DENSE_LAT_MIN; lat < DENSE_LAT_MAX; lat += 1) {
    for (let lng = DENSE_LNG_MIN; lng < DENSE_LNG_MAX; lng += 1) {
      const cellFile = path.join(RAW_DIR, `cell_${lat}_${lng}.json`);
      if (!fs.existsSync(cellFile)) continue;
      const existing = JSON.parse(fs.readFileSync(cellFile, 'utf8'));
      if (existing.length > 0) continue; // cell had data, skip

      // This 1° cell returned empty — re-fetch as four 0.5° sub-cells
      console.log(`  Subdividing failed cell lat=${lat} lng=${lng}...`);
      for (let subLat = lat; subLat < lat + 1; subLat += SUB_STEP) {
        for (let subLng = lng; subLng < lng + 1; subLng += SUB_STEP) {
          const subFile = path.join(RAW_DIR, `cell_${subLat}_${subLng}_sub.json`);
          if (fs.existsSync(subFile) && JSON.parse(fs.readFileSync(subFile,'utf8')).length > 0) {
            console.log(`    SKIP sub-cell ${subLat},${subLng} (cached)`);
            continue;
          }
          await sleep(3000);
          const elements = await fetchCell(subLat, subLng, subLat + SUB_STEP, subLng + SUB_STEP);
          fs.writeFileSync(subFile, JSON.stringify(elements), 'utf8');
          console.log(`    sub-cell ${subLat},${subLng}: ${elements.length} elements`);
        }
      }
    }
  }

  console.log('\nFetch complete. Run 02_transform_osm.js next.');
}

main().catch((err) => {
  console.error('Fatal error in 01_fetch_osm.js:', err);
  process.exit(1);
});
