/**
 * 03_deduplicate.js
 *
 * Removes near-duplicate venues that share the same postcode and a very
 * similar name. This catches cases where the same place is mapped twice
 * in OSM under slightly different names (e.g. "Banbury Soft Play" vs
 * "Banbury Soft Play Centre").
 *
 * WHY fuzzy matching? Exact string comparison misses typos and slight
 * variations. Fuse.js gives us a similarity score so we can catch near-
 * matches without discarding genuinely different venues.
 *
 * WHY group by postcode first? Fuzzy-matching every pair would be O(n²).
 * Grouping by postcode reduces comparisons to only venues in the same
 * postcode area — typically 1-5 venues — making it fast and accurate.
 *
 * Prerequisite: npm install fuse.js --legacy-peer-deps (from project root)
 *
 * Run: node scripts/import/03_deduplicate.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Fuse.js must be installed at the project root (root node_modules).
// If this fails, run: npm install fuse.js --legacy-peer-deps
let Fuse;
try {
  Fuse = require('fuse.js');
  // Fuse.js v7+ exports as an ES module with a .default property when required
  if (Fuse.default) Fuse = Fuse.default;
} catch (err) {
  console.error('Could not load fuse.js. Install it with:');
  console.error('  npm install fuse.js --legacy-peer-deps');
  console.error('(run from the PlayPlanner project root)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------

const TRANSFORM_DIR = path.resolve(__dirname, '../data/transformed');
const IN_FILE       = path.join(TRANSFORM_DIR, 'venues_osm.json');
const OUT_FILE      = path.join(TRANSFORM_DIR, 'venues_deduped.json');

/**
 * Fuse.js threshold: 0.0 = perfect match required, 1.0 = anything matches.
 * 0.3 means names must be very similar — catches typos and minor wording
 * differences while keeping genuinely different venues.
 */
const FUSE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a postcode for use as a grouping key:
 * strips spaces and converts to uppercase.
 * "SW1A 1AA" → "SW1A1AA"
 */
function normalisePostcode(postcode) {
  return postcode.replace(/\s+/g, '').toUpperCase();
}

/**
 * Groups an array of venues by normalised postcode.
 * Venues with no postcode go into a special '_NO_POSTCODE_' bucket
 * and are returned as-is (we cannot deduplicate without a location anchor).
 */
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

/**
 * Given a group of venues that share the same postcode, removes near-
 * duplicates using Fuse.js fuzzy name matching.
 *
 * Strategy:
 * - Work through venues in order (first = winner).
 * - For each venue, check if it is "too similar" to any already-accepted venue.
 * - If it is a near-duplicate, discard it and log the decision.
 *
 * Returns { kept: Venue[], discarded: string[] }
 */
function deduplicateGroup(venues) {
  const kept      = [];
  const discarded = [];

  for (const candidate of venues) {
    if (kept.length === 0) {
      // First venue in the group is always kept
      kept.push(candidate);
      continue;
    }

    // Build a Fuse index over the names of already-kept venues.
    // We rebuild it for each candidate to keep the logic simple;
    // groups are small (typically 1-5 items) so this is fast enough.
    const fuse = new Fuse(kept, {
      keys:              ['name'],
      threshold:         FUSE_THRESHOLD,
      includeScore:      true,
      // Disable location-based scoring so only character similarity matters.
      ignoreLocation:    true,
    });

    const results = fuse.search(candidate.name);

    if (results.length > 0) {
      // A match was found — this candidate is a near-duplicate of an already-
      // kept venue. Log it and move on.
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
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Input file not found: ${IN_FILE}`);
    console.error('Run 02_transform_osm.js first.');
    process.exit(1);
  }

  const venues = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  console.log(`Deduplication: ${venues.length} venues in`);

  const groups = groupByPostcode(venues);

  const keptVenues       = [];
  const allDiscarded     = [];
  let noPostcodeCount    = 0;

  for (const [postcode, group] of groups) {
    if (postcode === '_NO_POSTCODE_') {
      // Cannot deduplicate without a postcode — keep all of them.
      noPostcodeCount = group.length;
      keptVenues.push(...group);
      continue;
    }

    if (group.length === 1) {
      // Only one venue at this postcode — nothing to compare.
      keptVenues.push(group[0]);
      continue;
    }

    const { kept, discarded } = deduplicateGroup(group);
    keptVenues.push(...kept);
    allDiscarded.push(...discarded);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(keptVenues), 'utf8');

  console.log(`Deduplication: ${venues.length} in → ${keptVenues.length} out (${allDiscarded.length} duplicates removed)`);
  if (noPostcodeCount > 0) {
    console.log(`  Note: ${noPostcodeCount} venues had no postcode and were kept without deduplication.`);
  }
  console.log(`Output → ${OUT_FILE}`);
  console.log('\nRun 04_geocode.js next.');
}

main();
