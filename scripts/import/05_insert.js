/**
 * 05_insert.js
 *
 * Reads venues_geocoded.json and upserts them into the Supabase `venues`
 * table in batches of 50, using the service role key to bypass RLS.
 *
 * WHY service role key? RLS policies on `venues` restrict writes to
 * authenticated users submitting their own venues. Bulk import requires
 * bypassing that policy — the service key is safe here because this script
 * runs only on a developer's machine, never in the app itself.
 *
 * WHY upsert on osm_id? Running this script a second time (e.g. after
 * fetching fresh OSM data) should UPDATE existing records rather than
 * creating duplicates or failing with a unique constraint error.
 *
 * CRITICAL: venues are inserted with is_published=false and
 * moderation_status='pending'. They will NOT appear in the app until a
 * moderator reviews and publishes them.
 *
 * Prerequisites:
 *   - Create scripts/.env from scripts/.env.example
 *   - npm install dotenv --legacy-peer-deps (from project root)
 *
 * Run: node scripts/import/05_insert.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Load environment variables from scripts/.env
// WHY scripts/.env and not root .env? The root .env uses EXPO_PUBLIC_ prefixes
// and only contains the anon key (safe for client-side use). The service role
// key is far more powerful and must be kept in a gitignored scripts-only file.
// ---------------------------------------------------------------------------

const dotenvPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(dotenvPath)) {
  console.error(`scripts/.env not found at: ${dotenvPath}`);
  console.error('Create it from scripts/.env.example and add your Supabase credentials.');
  process.exit(1);
}

require('dotenv').config({ path: dotenvPath });

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env vars. Check scripts/.env contains:');
  console.error('  SUPABASE_URL=...');
  console.error('  SUPABASE_SERVICE_KEY=...');
  process.exit(1);
}

// @supabase/supabase-js is installed in the root node_modules
const { createClient } = require('@supabase/supabase-js');

// persistSession: false because this is a server-side script, not a browser.
// There is no auth session to persist between runs.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------

const TRANSFORM_DIR = path.resolve(__dirname, '../data/transformed');
const IN_FILE       = path.join(TRANSFORM_DIR, 'venues_geocoded.json');

const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Splits an array into chunks of at most `size` elements. */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Fetches all categories from Supabase and returns a Map of slug → UUID.
 * WHY at startup? We resolve every venue's category_id once rather than
 * making a DB query per venue.
 */
async function loadCategoryMap() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug');

  if (error) {
    throw new Error(`Could not load categories: ${error.message}`);
  }

  const map = new Map();
  for (const row of data) {
    map.set(row.slug, row.id);
  }
  console.log(`Loaded ${map.size} categories from database.`);
  return map;
}

/**
 * Prepares a venue record for insertion:
 * - Removes the osm_category_slug field (not a DB column)
 * - Resolves category_id from the slug map
 * - Ensures is_published=false and moderation_status='pending' regardless
 *   of what the transformed data says (safety belt)
 */
function prepareRecord(venue, categoryMap) {
  // Destructure to remove osm_category_slug — it is not a column in `venues`
  const { osm_category_slug, ...record } = venue;

  return {
    ...record,
    category_id:       categoryMap.get(osm_category_slug) || null,
    // Safety belt: these must ALWAYS be false/pending for imported data.
    // A moderator must explicitly publish each venue after review.
    is_published:      false,
    moderation_status: 'pending',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Input file not found: ${IN_FILE}`);
    console.error('Run 04_geocode.js first.');
    process.exit(1);
  }

  const venues = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  console.log(`Loaded ${venues.length} venues from ${IN_FILE}`);
  console.log(`Connecting to Supabase: ${SUPABASE_URL}\n`);

  // Load category slug → UUID map
  const categoryMap = await loadCategoryMap();

  // Warn about venues that will have category_id = null
  const noCategory = venues.filter((v) => !categoryMap.has(v.osm_category_slug));
  if (noCategory.length > 0) {
    console.warn(`[warn] ${noCategory.length} venues have an unrecognised category slug and will be inserted with category_id=null.`);
    // Log a sample of unrecognised slugs to help debug category setup
    const unknownSlugs = [...new Set(noCategory.map((v) => v.osm_category_slug))].slice(0, 10);
    console.warn(`  Unknown slugs: ${unknownSlugs.join(', ')}`);
  }

  // Prepare all records
  const records = venues.map((v) => prepareRecord(v, categoryMap));

  // Split into batches
  const batches     = chunk(records, BATCH_SIZE);
  const totalBatches = batches.length;

  let totalUpserted = 0;
  let totalErrors   = 0;

  console.log(`Upserting ${records.length} venues in ${totalBatches} batches of ${BATCH_SIZE}...\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch      = batches[i];
    const batchNum   = i + 1;
    const startIdx   = i * BATCH_SIZE + 1;
    const endIdx     = Math.min(startIdx + batch.length - 1, records.length);

    process.stdout.write(`Inserting batch ${batchNum}/${totalBatches} (venues ${startIdx}-${endIdx})... `);

    const { error, count } = await supabase
      .from('venues')
      .upsert(batch, {
        onConflict:       'osm_id',   // update existing OSM records on re-run
        ignoreDuplicates: false,       // false = update, not silently skip
      })
      .select('id', { count: 'exact', head: true }); // head=true means no data returned, just count

    if (error) {
      console.log(`ERROR`);
      // Log error code and hint only — never log venue data which could
      // contain personal/location info in a production context.
      console.error(`  [error] batch ${batchNum}: code=${error.code} hint=${error.hint || 'none'}`);
      console.error(`  message: ${error.message}`);
      totalErrors += batch.length;
    } else {
      const upserted = count ?? batch.length;
      totalUpserted += upserted;
      console.log(`OK (${upserted} rows)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n--- Import summary ---');
  console.log(`Total venues processed : ${records.length}`);
  console.log(`Successfully upserted  : ${totalUpserted}`);
  if (totalErrors > 0) {
    console.log(`Errors                 : ${totalErrors}`);
    console.log('Check the error messages above. Common causes:');
    console.log('  - osm_id column missing (run migration 013)');
    console.log('  - Service key lacks insert permission');
    console.log('  - Network timeout');
  } else {
    console.log('Errors                 : 0');
  }
  console.log('\nAll done. Venues are in moderation_status=pending and is_published=false.');
  console.log('Review and publish them via the PlayPlanner admin panel.');
}

main().catch((err) => {
  console.error('Fatal error in 05_insert.js:', err);
  process.exit(1);
});
