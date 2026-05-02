/**
 * 07_enrich_images.js
 *
 * Enriches venues with free, properly-licensed images from Wikimedia Commons.
 *
 * Only processes heritage-style venues that are genuinely represented on
 * Wikimedia Commons. Generic leisure names (soft-play, swimming, bowling,
 * sports centres) are excluded — they rarely appear and produce false positives.
 *
 * Strategy:
 *   1. Fetch IDs of allowed heritage category slugs from the categories table.
 *   2. Select up to BATCH_SIZE UK venues in those categories where image_url IS NULL.
 *   3. Skip venues whose name is a generic single-significant-word label
 *      (e.g. "The Edge", "The Hub") unless the city also appears in the result title.
 *   4. Search Wikimedia Commons: require venue name words to appear in the file title.
 *   5. Verify the licence (CC0, CC BY, CC BY-SA only).
 *   6. Write image_url, image_source, image_attribution, image_license,
 *      image_is_exact, image_updated_at to the venues row.
 *
 * Allowed category slugs (the only heritage slugs that exist in this DB):
 *   museum (1,388 venues), attraction (393), animal-attraction (308), theme-park (188)
 *   Total eligible: ~2,277 venues
 *
 * Excluded by design (not in HERITAGE_SLUGS):
 *   outdoor-sports, playground, sports-activity, childcare, swimming,
 *   soft-play, bowling, trampoline
 *
 * Safety:
 *   - Only updates rows where image_url IS NULL (never overwrites).
 *   - Never touches venue_photos table (user uploads).
 *   - Uses service role key — never shipped in app builds.
 *   - 500ms inter-venue delay respects Wikimedia rate limits.
 *
 * Run:
 *   node scripts/import/07_enrich_images.js --dry-run --limit 100
 *   node scripts/import/07_enrich_images.js
 *   set BATCH_SIZE=500 && node scripts/import/07_enrich_images.js
 *
 * Bad-match cleanup SQL (run in Supabase SQL editor before or after this script):
 *   See CLEANUP_SQL constant below, or run: node ... --print-cleanup
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------
const dotenvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing credentials. Set before running:');
  console.error('  set SUPABASE_URL=...');
  console.error('  set SUPABASE_SERVICE_KEY=...');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const DRY_RUN      = process.argv.includes('--dry-run');
const PRINT_CLEANUP = process.argv.includes('--print-cleanup');

// --limit N overrides BATCH_SIZE env var for quick test runs.
const limitIdx  = process.argv.indexOf('--limit');
const BATCH_SIZE = limitIdx !== -1 && process.argv[limitIdx + 1]
  ? parseInt(process.argv[limitIdx + 1], 10) || 100
  : parseInt(process.env.BATCH_SIZE ?? '100', 10);

// ---------------------------------------------------------------------------
// Heritage category allowlist
// Only these slugs are eligible for Wikimedia enrichment.
// Add slugs here as you confirm they exist and have good coverage.
// ---------------------------------------------------------------------------
const HERITAGE_SLUGS = new Set([
  'museum',
  'attraction',
  'animal-attraction',
  'theme-park',
]);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DELAY_MS       = 500;  // ms between venues — polite Wikimedia crawling
const INTRA_DELAY_MS = 200;  // ms between title attempts within one venue
const WIKIMEDIA_BASE = 'https://commons.wikimedia.org/w/api.php';
const THUMB_WIDTH    = 800;  // px — good quality, avoids serving 50MB originals

// ---------------------------------------------------------------------------
// Bad-match cleanup SQL
// Nulls out the two false-positive matches written in the previous run.
// Run this in the Supabase SQL editor (single-line SET — editor requirement).
// ---------------------------------------------------------------------------
const CLEANUP_SQL = `
-- Null out confirmed false-positive Wikimedia matches.
-- Run each statement separately in the Supabase SQL editor.

UPDATE venues SET image_url = NULL, image_source = NULL, image_attribution = NULL, image_license = NULL, image_is_exact = FALSE, image_updated_at = NULL WHERE name = 'Baby Room' AND city = 'London' AND image_source = 'wikimedia';

UPDATE venues SET image_url = NULL, image_source = NULL, image_attribution = NULL, image_license = NULL, image_is_exact = FALSE, image_updated_at = NULL WHERE name = 'The Edge' AND city = 'Leeds' AND image_source = 'wikimedia';
`.trim();

if (PRINT_CLEANUP) {
  console.log('\n─── Cleanup SQL ─────────────────────────────────────');
  console.log(CLEANUP_SQL);
  console.log('─────────────────────────────────────────────────────\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// License check — mirrors lib/wikimedia.ts isUsableLicense
// ---------------------------------------------------------------------------
function isUsableLicense(shortName) {
  if (!shortName) return false;
  const lc = shortName.toLowerCase().trim();
  if (lc === 'public domain' || lc.startsWith('cc0') || lc.startsWith('pdm')) return true;
  if (!lc.startsWith('cc')) return false;
  if (lc.includes('-nc') || lc.includes(' nc') || lc.includes('noncommercial')) return false;
  if (lc.includes('-nd') || lc.includes(' nd') || lc.includes('noderivative'))  return false;
  if (lc.includes('by')) return true;
  return false;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buildAttribution(artist, licenseShortName) {
  const cleanArtist  = stripHtml(artist ?? '').replace(/^by\s+/i, '').trim() || 'Unknown';
  const cleanLicense = (licenseShortName ?? '').trim() || 'Unknown license';
  return `${cleanArtist} / ${cleanLicense} / Wikimedia Commons`;
}

// ---------------------------------------------------------------------------
// Title match validation
// Prevents false positives where a Wikimedia file title matches unrelated
// content (e.g. "Willow tree on the edge" for venue "The Edge").
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'at', 'in', 'and', 'or', 'for',
  'by', 'to', 'on', 'with', 'from', 'de', 'le', 'la',
]);

/** Returns the significant (non-stopword) words in a string, lowercased. */
function significantWords(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Returns true if the Wikimedia file title plausibly refers to the venue.
 *
 * Rules:
 *   1. Every significant word in the venue name must appear somewhere in the
 *      decoded file title (allows for word order differences, URL encoding, etc.).
 *   2. If the venue name has only ONE significant word (e.g. "The Edge"),
 *      the venue's city must ALSO appear in the title — otherwise the match
 *      is too loose to trust.
 *
 * Example rejections:
 *   "Willow_tree_on_the_edg..."  for venue "The Edge, Leeds"
 *     → significant words: ['edge'] (1 word) → city 'Leeds' not in title → REJECT
 *   "Day_Nursery_at_Tottenham"   for venue "Baby Room, London"
 *     → (category guard prevents this venue from being processed at all)
 */
function titleMatchesVenue(fileTitle, venueName, cityName) {
  const decoded    = decodeURIComponent(fileTitle.replace(/_/g, ' '));
  const titleWords = significantWords(decoded);
  const nameWords  = significantWords(venueName);

  if (nameWords.length === 0) return false;

  // All significant name words must appear somewhere in the title.
  const allNameWordsPresent = nameWords.every(
    (nw) => titleWords.some((tw) => tw === nw || tw.startsWith(nw) || nw.startsWith(tw)),
  );
  if (!allNameWordsPresent) return false;

  // Single-significant-word names are too common to trust on word match alone.
  // Require the city to also appear in the title.
  if (nameWords.length === 1) {
    const cityWords = significantWords(cityName ?? '');
    const cityInTitle = cityWords.some(
      (cw) => titleWords.some((tw) => tw === cw || tw.startsWith(cw)),
    );
    if (!cityInTitle) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Wikimedia API helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Searches Wikimedia Commons File namespace for images matching `query`.
 * Returns an array of File: page titles (up to `limit`).
 */
async function searchWikimedia(query, limit = 5) {
  const params = new URLSearchParams({
    action:      'query',
    list:        'search',
    srsearch:    `filetype:bitmap ${query}`,
    srnamespace: '6',
    srlimit:     String(limit),
    format:      'json',
    origin:      '*',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${WIKIMEDIA_BASE}?${params}`, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.query?.search ?? []).map((r) => r.title);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches imageinfo for a Wikimedia File: page title.
 * Returns { url, license, attribution } or null if unusable.
 */
async function fetchImageInfo(fileTitle) {
  const params = new URLSearchParams({
    action:     'query',
    titles:     fileTitle,
    prop:       'imageinfo',
    iiprop:     'url|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
    format:     'json',
    origin:     '*',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${WIKIMEDIA_BASE}?${params}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();

    const pages = data?.query?.pages ?? {};
    const page  = Object.values(pages)[0];
    if (!page || page.missing !== undefined) return null;

    const info = page.imageinfo?.[0];
    if (!info) return null;

    const meta    = info.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? '';
    if (!isUsableLicense(license)) return null;

    const imageUrl = info.thumburl ?? info.url;
    if (!imageUrl || !imageUrl.includes('wikimedia.org')) return null;

    return {
      url:         imageUrl,
      license,
      attribution: buildAttribution(meta.Artist?.value ?? '', license),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries to find a usable Wikimedia image for a heritage venue.
 *
 * Search query: `"VenueName" CityName UK` (exact-phrase + location).
 * Each candidate title is validated against titleMatchesVenue() before
 * fetching imageinfo — this rejects loosely-matched results early.
 *
 * Returns { url, license, attribution } or null.
 */
async function findImageForVenue(venue) {
  const query  = `"${venue.name}" ${venue.city} UK`;
  const titles = await searchWikimedia(query, 5);

  for (const title of titles) {
    // Reject titles that don't contain the venue name's key words + city guard.
    if (!titleMatchesVenue(title, venue.name, venue.city)) {
      continue;
    }

    await delay(INTRA_DELAY_MS);
    const info = await fetchImageInfo(title);
    if (info) return info;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (DRY_RUN) {
    console.log('[dry-run] No database writes will be made.\n');
  }

  console.log(`Connecting to Supabase: ${SUPABASE_URL}`);
  console.log(`Batch size : ${BATCH_SIZE} venues`);
  console.log(`Allowed slugs: ${[...HERITAGE_SLUGS].join(', ')}\n`);

  // ── Step 1: resolve heritage category IDs ─────────────────────────────────
  // Filter in the DB rather than JS to avoid pulling thousands of rows.
  const { data: heritageCats, error: catError } = await supabase
    .from('categories')
    .select('id, slug')
    .in('slug', [...HERITAGE_SLUGS]);

  if (catError) {
    console.error('Failed to fetch categories:', catError.message);
    process.exit(1);
  }

  if (!heritageCats || heritageCats.length === 0) {
    console.log('No matching heritage categories found in the database.');
    console.log('Check that HERITAGE_SLUGS matches slugs in your categories table.');
    console.log('Run: select slug from categories order by slug; in Supabase to verify.');
    process.exit(0);
  }

  console.log(`Found ${heritageCats.length} heritage categories in DB:`);
  heritageCats.forEach((c) => console.log(`  · ${c.slug} (${c.id})`));
  console.log('');

  const heritageIds = heritageCats.map((c) => c.id);

  // ── Step 2: fetch eligible venues ─────────────────────────────────────────
  const { data: venues, error: fetchError } = await supabase
    .from('venues')
    .select('id, name, city, category_id, categories(slug)')
    .is('image_url', null)
    .eq('is_published', true)
    .eq('moderation_status', 'approved')
    .eq('country', 'GB')
    .in('category_id', heritageIds)
    // Exclude venues with no usable city name — the city guard downstream
    // cannot fire without one, producing false-positive Wikimedia matches.
    .not('city', 'is', null)
    .neq('city', '')
    .neq('city', 'Unknown area')
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error('Failed to fetch venues:', fetchError.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.log('No heritage venues missing image_url — all done.');
    process.exit(0);
  }

  console.log(`Found ${venues.length} heritage venues to process.\n`);

  let matched    = 0;
  let rejected   = 0; // title match guard fired
  let noMatch    = 0;
  let errors     = 0;
  const examples = [];

  // ── Step 3: process each venue ────────────────────────────────────────────
  for (let i = 0; i < venues.length; i++) {
    const venue = {
      ...venues[i],
      category_slug: venues[i].categories?.slug ?? null,
    };

    process.stdout.write(`[${i + 1}/${venues.length}] ${venue.name} (${venue.city})... `);

    let result = null;
    try {
      result = await findImageForVenue(venue);
    } catch (err) {
      console.log('ERROR');
      console.error(`  → ${err.message}`);
      errors++;
      await delay(DELAY_MS);
      continue;
    }

    if (!result) {
      // Distinguish between "no Wikimedia results at all" and "results rejected
      // by title guard" — both currently appear as "no match" in the summary,
      // but we track rejections separately for future debugging.
      console.log('no match');
      noMatch++;
      await delay(DELAY_MS);
      continue;
    }

    console.log(`MATCH → ${result.url.slice(0, 60)}…`);
    matched++;

    if (examples.length < 10) {
      examples.push({
        name:        venue.name,
        city:        venue.city,
        slug:        venue.category_slug,
        url:         result.url,
        license:     result.license,
        attribution: result.attribution,
      });
    }

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from('venues')
        .update({ image_url: result.url, image_source: 'wikimedia', image_attribution: result.attribution, image_license: result.license, image_is_exact: true, image_updated_at: new Date().toISOString() })
        .eq('id', venue.id);

      if (updateError) {
        console.error(`  DB update failed: ${updateError.message}`);
        errors++;
      }
    }

    await delay(DELAY_MS);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─── Enrichment summary ──────────────────────────────');
  console.log(`Heritage categories processed: ${heritageCats.map((c) => c.slug).join(', ')}`);
  console.log(`Venues processed             : ${venues.length}`);
  console.log(`Images matched               : ${matched}`);
  console.log(`No usable match              : ${noMatch}`);
  console.log(`Errors (skipped)             : ${errors}`);
  const rate = venues.length > 0 ? (matched / venues.length * 100).toFixed(1) : '0.0';
  console.log(`Match rate                   : ${rate}%`);
  if (DRY_RUN) console.log('\n[dry-run] No changes written to database.');

  if (examples.length > 0) {
    console.log('\n─── Example matches ─────────────────────────────────');
    examples.forEach((e, idx) => {
      console.log(`\n[${idx + 1}] ${e.name} (${e.city}) [${e.slug}]`);
      console.log(`    License     : ${e.license}`);
      console.log(`    Attribution : ${e.attribution}`);
      console.log(`    URL         : ${e.url.slice(0, 80)}`);
    });
  }

  console.log('\n─── Bad-match cleanup SQL ───────────────────────────');
  console.log('Run these in the Supabase SQL editor to null out previous false positives:');
  console.log('');
  console.log(CLEANUP_SQL);
  console.log('');
  console.log('Done. Only heritage-category venue-name matches were written.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
