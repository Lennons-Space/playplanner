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
 * WHY insert (not upsert)? We pre-filter to net-new records before batching,
 * so a plain insert is safe and avoids any risk of overwriting existing
 * published venues with pending/unpublished data.
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
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env vars. Set them before running:');
  console.error('  set SUPABASE_URL=...');
  console.error('  set SUPABASE_SERVICE_KEY=...');
  console.error('Or add them to scripts/.env (gitignored).');
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

const TRANSFORM_DIR    = path.resolve(__dirname, '../data/transformed');
const IN_FILE          = path.join(TRANSFORM_DIR, 'venues_geocoded.json');
const REJECTED_FILE    = path.join(TRANSFORM_DIR, 'venues_no_category.json');

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
 * Fetches every osm_id that already exists in the venues table (paginated).
 * WHY paginated? The table can have tens of thousands of rows; a single
 * unbounded SELECT may time-out or hit the PostgREST row limit.
 * WHY PAGE=1000? Supabase's default max_rows cap is 1000 per request. Using
 * a larger page size means data.length is always <PAGE even mid-set, so the
 * loop exits after the first page and silently misses the rest.
 * Returns a Set<string> so look-ups are O(1).
 */
async function loadExistingOsmIds() {
  const existing = new Set();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('venues')
      .select('osm_id')
      .not('osm_id', 'is', null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Could not load existing osm_ids: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) existing.add(row.osm_id);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return existing;
}

/**
 * Prepares a venue record for insertion:
 * - Removes osm_category_slug (not a DB column) and any transform-only metadata
 *   fields (location_fallback, city_fallback_used, _meta) that may be present
 *   in older transform output files — stripping them here is a safety belt in
 *   case venues_geocoded.json was produced by a pre-fix version of the script.
 * - Resolves category_id from the slug map
 * - Ensures is_published=false and moderation_status='pending' regardless
 *   of what the transformed data says (safety belt)
 * - Provides an empty-string fallback for postcode because the DB column is
 *   NOT NULL with no DEFAULT — venue owners correct this via the claim flow.
 */
function prepareRecord(venue, categoryMap) {
  // Destructure to remove osm_category_slug and any transform-internal fields
  // that must not be passed to the DB upsert.
  const { osm_category_slug, location_fallback, city_fallback_used, _meta, ...record } = venue;

  return {
    ...record,
    submitted_by:      null,       // EXPLICIT: OSM imports have no user submitter
    category_id:       categoryMap.get(osm_category_slug) || null,
    // postcode is NOT NULL in the schema with no DEFAULT. OSM data often omits
    // postcodes for rural venues. An empty string satisfies the constraint;
    // venue owners can supply the real postcode after claiming their listing.
    postcode:          record.postcode || '',
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

  // ---------------------------------------------------------------------------
  // Safety filter: reject venues outside UK coordinate bounds.
  // The transform already applies isWithinUK() but this is a final safety belt
  // in case transform output was generated by an older version of the script.
  // ---------------------------------------------------------------------------
  const UK_LAT_MIN = 49.0, UK_LAT_MAX = 61.0;
  const UK_LON_MIN = -8.7, UK_LON_MAX =  1.8;

  const ukVenues = venues.filter(v =>
    v.latitude  >= UK_LAT_MIN && v.latitude  <= UK_LAT_MAX &&
    v.longitude >= UK_LON_MIN && v.longitude <= UK_LON_MAX &&
    // Channel Islands are valid (lat<50, lon<-1.8); reject lat<50 + lon>-1.8 (France)
    !(v.latitude < 50.0 && v.longitude > -1.8) &&
    // Pas-de-Calais / Belgium: lat 50.5–51.5°N lon > 1.5°E — not UK
    !(v.latitude < 51.5 && v.longitude > 1.5)
  );
  const rejected = venues.length - ukVenues.length;

  if (rejected > 0) {
    console.warn(`[filter] Rejected ${rejected} venues outside UK coordinate bounds.`);
    // Log up to 5 examples so we can see what was rejected (names are OSM public
    // data, not personal data — safe to log under the project's no-sensitive-logs rule).
    const examples = venues
      .filter(v => !(
        v.latitude  >= UK_LAT_MIN && v.latitude  <= UK_LAT_MAX &&
        v.longitude >= UK_LON_MIN && v.longitude <= UK_LON_MAX &&
        !(v.latitude < 50.0 && v.longitude > -1.8)
      ))
      .slice(0, 5)
      .map(v => `"${v.name}" (${v.latitude.toFixed(3)}, ${v.longitude.toFixed(3)})`);
    console.warn(`  Examples: ${examples.join(', ')}`);
  }

  // Load category slug → UUID map
  const categoryMap = await loadCategoryMap();

  // Warn about venues that will have category_id = null
  const noCategory = ukVenues.filter((v) => !categoryMap.has(v.osm_category_slug));
  if (noCategory.length > 0) {
    console.warn(`[warn] ${noCategory.length} venues have an unrecognised category slug and will be inserted with category_id=null.`);
    // Log a sample of unrecognised slugs to help debug category setup
    const unknownSlugs = [...new Set(noCategory.map((v) => v.osm_category_slug))].slice(0, 10);
    console.warn(`  Unknown slugs: ${unknownSlugs.join(', ')}`);
  }

  // Prepare all records (use ukVenues — non-UK venues already filtered above)
  const records = ukVenues.map((v) => prepareRecord(v, categoryMap));

  // Split into categorised (insertable) and uncategorised (rejected).
  // WHY split? Venues without a recognised category slug should NOT be inserted
  // with category_id=null — they'd bypass category-based moderation/filtering.
  // Instead we write them to a rejection file so a maintainer can map the
  // unknown slug to a real category, then re-run the import.
  const categorised   = records.filter((r) => r.category_id !== null);
  const uncategorised = records.filter((r) => r.category_id === null);

  if (uncategorised.length > 0) {
    fs.writeFileSync(REJECTED_FILE, JSON.stringify(uncategorised, null, 2), 'utf8');
    console.warn(`[warn] ${uncategorised.length} venues skipped (no category match) → ${REJECTED_FILE}`);
  }

  // Load existing osm_ids from DB (paginated — could be tens of thousands)
  const existingOsmIds = await loadExistingOsmIds();
  console.log(`\nExisting venues in DB with an osm_id : ${existingOsmIds.size}`);

  // Split: genuinely new vs already in DB
  const newVenues       = categorised.filter(r => !existingOsmIds.has(r.osm_id));
  const skippedExisting = categorised.length - newVenues.length;

  console.log(`Venues in file already in DB (skip) : ${skippedExisting}`);
  console.log(`Net-new venues to insert             : ${newVenues.length}`);

  // ---------------------------------------------------------------------------
  // --test-one: debug mode — insert a single record and print the full error.
  // WHY? When a batch insert fails, Supabase only surfaces a summary message.
  // This flag isolates one record so we can see the full error object (code,
  // details, hint) without running the entire import.
  // NEVER log env values (URL, key) here — only venue fields.
  // ---------------------------------------------------------------------------
  if (process.argv.includes('--test-one')) {
    if (newVenues.length === 0) {
      console.log('--test-one: no new venues to test. Exiting.');
      process.exit(0);
    }
    const record = newVenues[0];
    console.log('Test record fields:', JSON.stringify(record, null, 2));
    const { error } = await supabase.from('venues').insert([record]);
    if (error) {
      console.error('Full error:', JSON.stringify(error, null, 2));
    } else {
      console.log('Test insert succeeded');
    }
    process.exit(0);
  }

  if (newVenues.length === 0) {
    console.log('\nNothing new to insert. Exiting.');
    process.exit(0);
  }

  // Batching
  const batches      = chunk(newVenues, BATCH_SIZE);
  const totalBatches = batches.length;

  let totalInserted  = 0;
  let totalErrors    = 0;
  let singleInserted = 0;
  const failedRecords = [];

  console.log(`\nInserting ${newVenues.length} new venues in ${totalBatches} batches of ${BATCH_SIZE}...\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch    = batches[i];
    const batchNum = i + 1;
    const startIdx = i * BATCH_SIZE + 1;
    const endIdx   = Math.min(startIdx + batch.length - 1, newVenues.length);

    process.stdout.write(`Inserting batch ${batchNum}/${totalBatches} (venues ${startIdx}-${endIdx})... `);

    // WHY insert not upsert? We pre-filter to net-new records above so a plain
    // insert is safe and avoids any risk of overwriting existing published venues.
    // WHY no .select()/count? PostgREST returns unreliable counts for insert
    // with head:true. We trust the absence of error as success and use
    // batch.length as the row count.
    const { error: batchError } = await supabase
      .from('venues')
      .insert(batch);

    if (!batchError) {
      totalInserted += batch.length;
      console.log(`OK (${batch.length} rows)`);
    } else {
      console.log(`ERROR`);
      // Batch failed — fall back to inserting record by record so valid rows
      // still make it in and we can isolate exactly which records are broken.
      // Log error code and message only — never log env values or raw payloads.
      console.error(`  [retry] batch ${batchNum} failed (code=${batchError.code} message=${batchError.message}) — retrying record by record`);

      let batchSingleOk = 0;
      for (const record of batch) {
        const { error: recordError } = await supabase
          .from('venues')
          .insert([record]);

        if (!recordError) {
          totalInserted  += 1;
          singleInserted += 1;
          batchSingleOk  += 1;
        } else {
          totalErrors += 1;
          // Cap the failedRecords sample at 20 to keep logs manageable.
          // Only safe fields are captured — no lat/lon, phone, website, or
          // full record payload, in line with the project's no-sensitive-logs rule.
          if (failedRecords.length < 20) {
            failedRecords.push({
              osm_id:        record.osm_id,
              name:          record.name,
              category_id:   record.category_id,
              city:          record.city,
              postcode:      record.postcode,
              error_code:    recordError.code,
              error_message: recordError.message,
            });
          }
        }
      }

      console.error(`  [retry] batch ${batchNum}: ${batchSingleOk} of ${batch.length} inserted individually`);
    }
  }

  if (singleInserted > 0) {
    console.log(`\nSingle-record fallback inserted : ${singleInserted}`);
  }
  if (failedRecords.length > 0) {
    console.log(`\nFirst ${failedRecords.length} failed records:`);
    failedRecords.forEach((r, i) => {
      console.log(`  [${i + 1}] osm_id=${r.osm_id} name="${r.name}" category_id=${r.category_id} city="${r.city}" postcode="${r.postcode}" → ${r.error_code}: ${r.error_message}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n--- Import summary ---');
  console.log(`Total loaded from file              : ${venues.length}`);
  console.log(`Rejected (outside UK)               : ${rejected}`);
  console.log(`Skipped (no category)               : ${uncategorised.length}`);
  console.log(`Already in DB — preserved unchanged : ${skippedExisting}`);
  console.log(`Net-new venues attempted            : ${newVenues.length}`);
  console.log(`Successfully inserted               : ${totalInserted}`);
  console.log(`Single-record fallback inserts      : ${singleInserted}`);
  console.log(`Unique failure patterns (sample)    : ${failedRecords.length} shown above`);
  if (totalErrors > 0) {
    console.log(`Errors                              : ${totalErrors}`);
    console.log('Check the error messages above. Common causes:');
    console.log('  - osm_id column missing (run migration 013)');
    console.log('  - Service key lacks insert permission');
    console.log('  - Network timeout');
  } else {
    console.log(`Errors                              : 0`);
  }
  console.log('\nAll done. New venues are pending/unpublished.');
  console.log('Review and publish them via the PlayPlanner admin panel.');
}

main().catch((err) => {
  console.error('Fatal error in 05_insert.js:', err);
  process.exit(1);
});
