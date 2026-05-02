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
 * Flags:
 *   --sample        Fetch a single Cotswolds bounding box instead of the full UK
 *                   grid. Useful for quick QA of new venue types without a full run.
 *   --retry-failed  Re-fetch only cells recorded in _failed_cells.json.
 *                   Cells that succeed are removed from the log automatically.
 *
 * Run: node scripts/import/01_fetch_osm.js
 * Run: node scripts/import/01_fetch_osm.js --sample
 * Run: node scripts/import/01_fetch_osm.js --retry-failed
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
 * - lng -8.7–1.8 E: -8.7 covers Northern Ireland's western coast (was -8.0 which
 *   missed NI) and St Kilda. England/Wales reach about -5.7; Scotland -7.7;
 *   NI reaches -8.17 at Malin Head. 1.8 (was 2.0) is just east of Lowestoft
 *   (~1.75°E), the UK's true easternmost point, cutting off northern France.
 */
const LAT_START = 49.0;
const LAT_END   = 61.0;
const LNG_START = -8.7;
const LNG_END   =  1.8;  // UK's easternmost point ~1.75°E (Lowestoft); 2.0 overlaps French coast
const STEP      =  1.0;

const DELAY_MS  = 10000; // 10 seconds between requests — increased after persistent HTTP 429 errors

const RAW_DIR = path.resolve(__dirname, '../data/raw/osm');

const FAILED_LOG = path.join(RAW_DIR, '_failed_cells.json');

// Retry behaviour for HTTP 429 (Too Many Requests).
// On 429, wait and retry the SAME endpoint before trying the fallback.
// Delays are in ms: 15s first retry, 45s second retry.
const RETRY_DELAYS_MS = [15000, 45000];

const OVERPASS_PRIMARY  = 'https://overpass-api.de/api/interpreter';
const OVERPASS_FALLBACK = 'https://overpass.kumi.systems/api/interpreter';

// Sample mode: a single Cotswolds cell for fast QA of new venue types.
// Covers the Cotswolds AONB and surrounding towns/villages — good coverage
// of parks, nature reserves, farms, and historic sites.
const SAMPLE_BBOX = { south: 51.6, west: -2.0, north: 51.9, east: -1.5 };

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
 *
 * WHY quality filters in-query? Filtering at the Overpass level (e.g.
 * ["access"!="private"], ["name"]) reduces response payload size and avoids
 * downloading hundreds of private or unnamed venues that we'd drop in
 * transform anyway. Less data transferred = faster fetches, less memory.
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
  node["leisure"="water_park"]["access"!="private"](${bbox});
  way["leisure"="water_park"]["access"!="private"](${bbox});
  node["leisure"="nature_reserve"]["access"!="private"](${bbox});
  way["leisure"="nature_reserve"]["access"!="private"](${bbox});
  node["leisure"="park"]["name"]["access"!="private"](${bbox});
  way["leisure"="park"]["name"]["access"!="private"](${bbox});
  node["tourism"="farm"](${bbox});
  way["tourism"="farm"](${bbox});
  node["historic"~"^(castle|ruins|fort)$"](${bbox});
  way["historic"~"^(castle|ruins|fort)$"](${bbox});
  node["amenity"="arts_centre"](${bbox});
  way["amenity"="arts_centre"](${bbox});
  node["tourism"="picnic_site"]["name"](${bbox});
);
out center;`;
}

/** Loads the set of cell keys that failed on a previous run. */
function loadFailedCells() {
  if (!fs.existsSync(FAILED_LOG)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(FAILED_LOG, 'utf8'));
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/**
 * Records a failed cell key in _failed_cells.json so --retry-failed can
 * pick it up. Reads the current file, appends, and rewrites atomically.
 * Cell key format: "lat_lng" e.g. "49.0_-2.7"
 */
function saveFailedCell(key) {
  const existing = loadFailedCells();
  existing.add(key);
  fs.writeFileSync(FAILED_LOG, JSON.stringify([...existing], null, 2), 'utf8');
}

/**
 * Removes a cell key from _failed_cells.json after a successful retry.
 */
function clearFailedCell(key) {
  const existing = loadFailedCells();
  existing.delete(key);
  fs.writeFileSync(FAILED_LOG, JSON.stringify([...existing], null, 2), 'utf8');
}

/**
 * Fetches a single cell from Overpass with retry + exponential backoff.
 *
 * Strategy:
 * - Try primary endpoint. On HTTP 429, wait and retry up to 2 times before
 *   moving on. On other errors, move on immediately.
 * - If primary fails after retries, try fallback endpoint with same backoff.
 * - If both fail, throw so the caller can record the failure.
 *
 * WHY retry on 429 before fallback? Hammering a different endpoint immediately
 * after a 429 often hits the same rate-limit pool. Waiting first gives the
 * server time to recover.
 */
async function fetchCellWithRetry(south, west, north, east) {
  const query = buildQuery(south, west, north, east);

  for (const endpoint of [OVERPASS_PRIMARY, OVERPASS_FALLBACK]) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const raw  = await postRequest(endpoint, query);
        const json = JSON.parse(raw);
        return json.elements || [];
      } catch (err) {
        lastErr = err;
        const is429 = err.message.includes('429');
        if (is429 && attempt < RETRY_DELAYS_MS.length) {
          const wait = RETRY_DELAYS_MS[attempt];
          console.warn(`  [retry] 429 on ${endpoint} — waiting ${wait / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})...`);
          await sleep(wait);
          // continue to next attempt on same endpoint
        } else {
          // Not 429, or out of retries — log and try next endpoint
          console.warn(`  [warn] ${endpoint} failed: ${err.message.slice(0, 120)}`);
          break;
        }
      }
    }
  }

  throw new Error('Both Overpass endpoints failed after retries.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const isSample = process.argv.includes('--sample');
  const isRetryFailed = process.argv.includes('--retry-failed');

  if (isRetryFailed) {
    const failed = loadFailedCells();
    if (failed.size === 0) {
      console.log('No failed cells recorded. Run without --retry-failed for a full fetch.');
      process.exit(0);
    }
    console.log(`=`.repeat(60));
    console.log(`RETRY MODE — ${failed.size} previously failed cells.`);
    console.log(`Failed cells log: ${FAILED_LOG}`);
    console.log(`=`.repeat(60) + '\n');
  }

  if (isSample) {
    // ------------------------------------------------------------------
    // SAMPLE MODE: fetch a single Cotswolds bounding box for fast QA.
    // No checkpointing, no grid — just one fetch and one output file.
    // ------------------------------------------------------------------
    console.log('='.repeat(60));
    console.log('SAMPLE MODE — Cotswolds bbox only. Not a full UK run.');
    console.log(`Bbox: S=${SAMPLE_BBOX.south} W=${SAMPLE_BBOX.west} N=${SAMPLE_BBOX.north} E=${SAMPLE_BBOX.east}`);
    console.log(`Raw output → ${RAW_DIR}`);
    console.log('='.repeat(60));

    const { south, west, north, east } = SAMPLE_BBOX;
    const filename = 'cell_sample_cotswolds.json';
    const filepath = path.join(RAW_DIR, filename);

    process.stdout.write('Fetching Cotswolds sample ... ');
    try {
      const elements = await fetchCellWithRetry(south, west, north, east);
      fs.writeFileSync(filepath, JSON.stringify(elements, null, 2), 'utf8');
      console.log(`done (${elements.length} elements)`);
      console.log(`Saved to ${filepath}`);
    } catch (err) {
      // Do NOT write [] — a missing file is unambiguous "needs retry".
      console.error(`FAILED — ${err.message}`);
      process.exit(1);
    }

    console.log('\nSample fetch complete. Run 02_transform_osm.js --dry-run to QA results.');
    return;
  }

  // ------------------------------------------------------------------
  // FULL UK GRID MODE (default)
  // ------------------------------------------------------------------

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
    const cellKey  = `${south.toFixed(1)}_${west.toFixed(1)}`;

    // In --retry-failed mode, skip cells that did NOT previously fail.
    // loadFailedCells() is called inside the loop to pick up changes as cells
    // succeed and are removed from the log mid-run. This is intentional.
    if (isRetryFailed && !loadFailedCells().has(cellKey)) {
      continue;
    }

    // --- Checkpoint: skip cells already fetched ---
    if (fs.existsSync(filepath)) {
      const raw = fs.readFileSync(filepath, 'utf8').trim();
      try {
        const parsed = JSON.parse(raw);
        // A valid response (even 0 elements) is cached — skip it.
        // Only a missing file (or one removed by cleanup) means "needs fetch".
        console.log(`${counter} SKIP  ${label} (cached: ${parsed.length} elements)`);
        continue;
      } catch {
        // Corrupt cache file — delete and re-fetch
        console.warn(`${counter} CORRUPT cache for ${label} — deleting and re-fetching`);
        fs.unlinkSync(filepath);
      }
    }

    process.stdout.write(`${counter} Fetching ${label} ... `);

    try {
      const elements = await fetchCellWithRetry(south, west, north, east);
      fs.writeFileSync(filepath, JSON.stringify(elements, null, 2), 'utf8');
      console.log(`done (${elements.length} elements)`);
      // If this cell was previously failed and now succeeded, remove from log
      clearFailedCell(cellKey);
    } catch (err) {
      // DO NOT write a cache file — a missing file means "needs retry".
      // Record in _failed_cells.json for --retry-failed mode.
      console.log(`FAILED — ${err.message}`);
      console.error(`  [error] Cell ${label} failed — recorded in _failed_cells.json for retry.`);
      saveFailedCell(cellKey);
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
      // A missing file means the main pass failed for this cell — also subdivide.
      const cellExists = fs.existsSync(cellFile);
      if (cellExists) {
        let existing;
        try {
          existing = JSON.parse(fs.readFileSync(cellFile, 'utf8'));
        } catch {
          existing = null;
        }
        if (existing !== null && existing.length > 0) continue; // cell had data, skip
      }

      // This 1° cell returned empty or failed — re-fetch as four 0.5° sub-cells
      console.log(`  Subdividing failed cell lat=${lat} lng=${lng}...`);
      for (let subLat = lat; subLat < lat + 1; subLat += SUB_STEP) {
        for (let subLng = lng; subLng < lng + 1; subLng += SUB_STEP) {
          const subFile = path.join(RAW_DIR, `cell_${subLat}_${subLng}_sub.json`);
          const subKey  = `${subLat}_${subLng}_sub`;
          if (fs.existsSync(subFile)) {
            try {
              const cached = JSON.parse(fs.readFileSync(subFile, 'utf8'));
              if (cached.length > 0) {
                console.log(`    SKIP sub-cell ${subLat},${subLng} (cached)`);
                continue;
              }
            } catch {
              // Corrupt sub-cell cache — delete and re-fetch
              console.warn(`    CORRUPT sub-cell cache for ${subLat},${subLng} — re-fetching`);
              fs.unlinkSync(subFile);
            }
          }
          await sleep(DELAY_MS);
          try {
            const elements = await fetchCellWithRetry(subLat, subLng, subLat + SUB_STEP, subLng + SUB_STEP);
            fs.writeFileSync(subFile, JSON.stringify(elements), 'utf8');
            console.log(`    sub-cell ${subLat},${subLng}: ${elements.length} elements`);
            clearFailedCell(subKey);
          } catch (err) {
            // DO NOT write [] — leave missing so it can be retried.
            console.error(`    FAILED sub-cell ${subLat},${subLng}: ${err.message}`);
            saveFailedCell(subKey);
          }
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
