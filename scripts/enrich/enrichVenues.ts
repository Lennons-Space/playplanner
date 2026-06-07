// =============================================================================
// scripts/enrich/enrichVenues.ts
//
// Phase 2A: Venue Enrichment Engine — dry-run CLI script.
//
// Usage:
//   npx tsx scripts/enrich/enrichVenues.ts [flags]
//
// Flags:
//   --dry-run          Default mode. Prints a report; writes nothing. Always
//                      the behaviour unless --write is explicitly passed.
//   --write            Persist results to venue_enrichment. Requires --limit
//                      to be explicitly provided AND <= 20. See SAFETY below.
//   --limit=20         How many venues to process. Default: 20 (dry-run only;
//                      --write requires this to be passed explicitly).
//   --venue-id=<uuid>  Single venue mode (overrides --limit).
//   --phase=osm        Enrichment phase. Default and only supported: osm.
//   --skip-curated     Skip venues where manually_curated = true. Default: true.
//
// Environment variables (read from scripts/.env or the shell environment):
//   SUPABASE_URL              Your Supabase project URL.
//   SUPABASE_SERVICE_ROLE_KEY Your service role key (bypasses RLS).
//
// SAFETY (write mode):
//   - Dry-run is the default; --write must be explicitly passed.
//   - --write REQUIRES an explicit --limit=N. The script refuses to run
//     without it (no silent "default to 20 venues written").
//   - --write REFUSES to run if N > 20. This cap is intentional and temporary
//     while we manually validate output quality — raise it deliberately later.
//   - Rows where manually_curated = true are always skipped, never overwritten,
//     regardless of --skip-curated.
//   - Writes go ONLY to venue_enrichment via upsert on venue_id. The venues
//     table, get_nearby_venues, and the app are never touched by this script.
//   - manually_curated, raw_geoapify, and raw_wikidata are deliberately
//     omitted from the upsert payload so this OSM-only run can never clobber
//     curated data or future enrichment from other sources.
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';

// ── Load environment variables ────────────────────────────────────────────────
// Try to load from scripts/.env first (developer convenience).
// If dotenv is not installed, fall through and rely on shell environment.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as { config: (opts: { path: string }) => void };
  dotenv.config({ path: path.join(__dirname, '../.env') });
} catch {
  // dotenv not available; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be
  // set in the shell environment before running this script.
}

import { createClient } from '@supabase/supabase-js';
import { extractRawFacts } from './osmExtract';
import { computeIntelligence, type VenueForScoring } from './intelligence';
import type {
  RawFacts,
  EnrichmentConfidence,
  RecommendedForTag,
  ScoreBreakdown,
} from '../../types/enrichment';

// ── Validate environment ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
    '       Add them to scripts/.env or export them in your shell.\n' +
    '       Example: scripts/.env\n' +
    '         SUPABASE_URL=https://xxxx.supabase.co\n' +
    '         SUPABASE_SERVICE_ROLE_KEY=eyJ...',
  );
  process.exit(1);
}

// Service role client bypasses RLS -- only used in server-side scripts, never
// shipped to the mobile app. The key never appears in logs.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Parse CLI flags ───────────────────────────────────────────────────────────

interface ScriptFlags {
  dryRun:        boolean;
  write:         boolean;
  limit:         number;
  limitProvided: boolean;
  venueId:       string | null;
  phase:         string;
  skipCurated:   boolean;
}

// Hard cap on how many rows --write may persist in a single run. Intentional
// and temporary while we manually validate output quality on real data.
// Raised 20 -> 100 for the second controlled validation batch (2026-06-07).
const WRITE_LIMIT_CAP = 100;

function parseFlags(argv: string[]): ScriptFlags {
  const flags: ScriptFlags = {
    dryRun:        true,
    write:         false,
    limit:         20,
    limitProvided: false,
    venueId:       null,
    phase:         'osm',
    skipCurated:   true,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      flags.dryRun = true; // already true, but explicit flag is accepted
    } else if (arg === '--write') {
      flags.write = true;
    } else if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.split('=')[1] ?? '', 10);
      if (!isNaN(val) && val > 0) {
        flags.limit = val;
        flags.limitProvided = true;
      }
    } else if (arg.startsWith('--venue-id=')) {
      flags.venueId = arg.split('=')[1] ?? null;
    } else if (arg.startsWith('--phase=')) {
      flags.phase = arg.split('=')[1] ?? 'osm';
    } else if (arg === '--skip-curated') {
      flags.skipCurated = true;
    }
  }

  // --write always implies the script is not in dry-run mode.
  if (flags.write) flags.dryRun = false;

  return flags;
}

// ── OSM archive loader ────────────────────────────────────────────────────────
// Reads all JSON files from the archive directory and builds a lookup map
// keyed by "${element.type}/${element.id}" (matching venues.osm_id format).

interface OsmElement {
  type: 'node' | 'way' | string;
  id:   number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

function loadOsmArchive(archiveDir: string): Map<string, Record<string, string>> {
  const tagMap = new Map<string, Record<string, string>>();

  let files: string[];
  try {
    files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(`ERROR: Cannot read OSM archive directory: ${archiveDir}`);
    console.error(err);
    process.exit(1);
  }

  for (const file of files) {
    const filePath = path.join(archiveDir, file);
    let elements: OsmElement[];

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      elements = JSON.parse(raw) as OsmElement[];
    } catch (err) {
      console.error(`WARNING: Failed to parse ${file} — skipping.`);
      console.error(err);
      continue;
    }

    for (const el of elements) {
      if (!el.type || typeof el.id !== 'number') continue;
      const key = `${el.type}/${el.id}`;
      // Only store elements that have tags (others have no enrichment value).
      if (el.tags && Object.keys(el.tags).length > 0) {
        tagMap.set(key, el.tags);
      }
    }
  }

  console.log(
    `Loaded ${tagMap.size} OSM elements from ${files.length} archive files`,
  );
  return tagMap;
}

// ── Confidence scoring ────────────────────────────────────────────────────────
// Determines how confident we are in the derived facts.
//
// 'high':   Explicit structural tags present (indoor=, wheelchair=) AND
//           at least one boolean facility tag confirmed.
// 'medium': At least one fact from an explicit OSM tag (not just category inference).
// 'low':    All facts inferred only from tourism/leisure category tags.

function computeConfidence(
  facts: RawFacts,
  tags:  Record<string, string>,
): EnrichmentConfidence {
  // Explicit structural tags: these are added by a surveyor who physically
  // visited and assessed the venue — highest quality signal.
  const hasExplicitIndoor     = tags['indoor'] === 'yes' || tags['indoor'] === 'no';
  const hasExplicitWheelchair = (
    tags['wheelchair'] === 'yes' ||
    tags['wheelchair'] === 'limited' ||
    tags['wheelchair'] === 'no'
  );

  // Explicit facility tags: surveyor confirmed a specific amenity.
  const hasExplicitFacility = (
    tags['toilets'] !== undefined        ||
    tags['changing_table'] !== undefined ||
    tags['toilets:changing_table'] !== undefined ||
    tags['parking'] !== undefined
  );

  // 'high': two structural assessments AND a boolean facility
  if ((hasExplicitIndoor || hasExplicitWheelchair) && hasExplicitFacility) {
    return 'high';
  }

  // 'medium': any single explicit tag (not just category inference)
  if (hasExplicitIndoor || hasExplicitWheelchair || hasExplicitFacility) {
    return 'medium';
  }

  // 'low': everything came from category/leisure/tourism inference
  return 'low';
}

// ── Dry-run report formatter ──────────────────────────────────────────────────

function renderDryRunReport(
  venue:       VenueForScoring,
  tags:        Record<string, string>,
  facts:       RawFacts,
  result:      ReturnType<typeof computeIntelligence>,
  confidence:  EnrichmentConfidence,
): void {
  const divider = '━'.repeat(52);
  const { scores, recommended_for, score_breakdown } = result;

  // Helper: format a nullable value with a reason string
  function fmt(value: unknown, reason: string): string {
    const val = value === null ? 'null' : String(value);
    return `${val.padEnd(18)} (${reason})`;
  }

  // OSM tag preview (up to 4 tags shown, sorted for stability)
  const tagEntries = Object.entries(tags).slice(0, 4);
  const tagLines = tagEntries.map(([k, v], i) => {
    const prefix = i === tagEntries.length - 1 ? '└─' : '├─';
    return `  ${prefix} ${k.padEnd(20)}: ${v}`;
  });

  // Layer 2 breakdown lines
  const scoreLines = [
    formatScoreLine('parent_convenience', scores.parent_convenience_score, score_breakdown.parent_convenience),
    formatScoreLine('rainy_day',          scores.rainy_day_score,          score_breakdown.rainy_day),
    formatScoreLine('active_play',        scores.active_play_score,        score_breakdown.active_play),
    formatScoreLine('learning',           scores.learning_score,           score_breakdown.learning),
    formatScoreLine('budget',             scores.budget_score,             score_breakdown.budget),
    formatScoreLine('accessibility',      scores.accessibility_score,      score_breakdown.accessibility),
  ];

  console.log(`\n${divider}`);
  console.log(`[VENUE] ${venue.name} (id: ${venue.id})`);
  console.log(`  osm_id  : ${venue.osm_id ?? 'null'}`);
  console.log(`  category: ${venue.category?.slug ?? 'unknown'}`);
  console.log('');
  console.log(`  OSM tags found: ${Object.keys(tags).length}`);
  console.log(tagLines.join('\n'));
  console.log('');
  console.log('  Layer 1 -- Raw facts:');
  console.log(`  ├─ indoor_outdoor        : ${fmt(facts.indoor_outdoor,        deriveReason('indoor_outdoor', tags))}`);
  console.log(`  ├─ parking_available     : ${fmt(facts.parking_available,     deriveReason('parking_available', tags))}`);
  console.log(`  ├─ cafe_available        : ${fmt(facts.cafe_available,        deriveReason('cafe_available', tags))}`);
  console.log(`  ├─ toilets_available     : ${fmt(facts.toilets_available,     deriveReason('toilets_available', tags))}`);
  console.log(`  ├─ baby_change_available : ${fmt(facts.baby_change_available, deriveReason('baby_change_available', tags))}`);
  console.log(`  ├─ wheelchair_accessible : ${fmt(facts.wheelchair_accessible, deriveReason('wheelchair_accessible', tags))}`);
  console.log(`  ├─ visit_duration_mins   : ${fmt(facts.visit_duration_mins,   deriveReason('visit_duration_mins', tags))}`);
  console.log(`  └─ activity_level        : ${fmt(facts.activity_level,        deriveReason('activity_level', tags))}`);
  console.log('');
  console.log('  Layer 2 -- Intelligence scores:');
  console.log(scoreLines.map((l, i) => `  ${i < scoreLines.length - 1 ? '├' : '└'}─ ${l}`).join('\n'));
  console.log('');
  console.log(`  Layer 3 -- recommended_for: ${JSON.stringify(recommended_for)}`);
  console.log('');
  console.log(`  Confidence: ${confidence} | Sources: ["osm_archive"]`);
  console.log('  [DRY RUN -- no database writes]');
  console.log(divider);
}

function formatScoreLine(
  label:     string,
  score:     number,
  breakdown: Record<string, number>,
): string {
  const breakdownStr = Object.entries(breakdown)
    .map(([k, v]) => `${k}: +${v}`)
    .join(', ');
  const displayBreakdown = breakdownStr || 'no contributing signals';
  return `${label.padEnd(22)}: ${String(score).padStart(3)}/100  (${displayBreakdown})`;
}

// Provides a brief human-readable reason for each derived fact, shown in the
// dry-run report. This mirrors the logic in osmExtract.ts without duplicating it.
function deriveReason(field: string, tags: Record<string, string>): string {
  switch (field) {
    case 'indoor_outdoor':
      if (tags['indoor'] === 'yes' || tags['indoor'] === 'no') return `indoor=${tags['indoor']}`;
      if (tags['tourism']) return `tourism=${tags['tourism']}`;
      if (tags['leisure']) return `leisure=${tags['leisure']}`;
      if (tags['building']) return `building=${tags['building']}`;
      return 'no tag';

    case 'parking_available':
      if (tags['parking']) return `parking=${tags['parking']}`;
      if (tags['amenity'] === 'parking') return 'amenity=parking';
      return 'no tag';

    case 'cafe_available':
      if (tags['amenity'] && ['cafe', 'restaurant', 'fast_food', 'food_court'].includes(tags['amenity'])) {
        return `amenity=${tags['amenity']}`;
      }
      return 'no tag';

    case 'toilets_available':
      if (tags['toilets']) return `toilets=${tags['toilets']}`;
      if (tags['amenity'] === 'toilets') return 'amenity=toilets';
      return 'no tag';

    case 'baby_change_available':
      if (tags['changing_table']) return `changing_table=${tags['changing_table']}`;
      if (tags['toilets:changing_table']) return `toilets:changing_table=${tags['toilets:changing_table']}`;
      return 'no tag';

    case 'wheelchair_accessible':
      if (tags['wheelchair']) return `wheelchair=${tags['wheelchair']}`;
      return 'no tag';

    case 'visit_duration_mins': {
      const tourism = tags['tourism'] ?? '';
      const leisure = tags['leisure'] ?? '';
      if (tourism) return `${tourism} estimate`;
      if (leisure) return `${leisure} estimate`;
      return 'no tag';
    }

    case 'activity_level': {
      const leisure = tags['leisure'] ?? '';
      const sport   = tags['sport'] ?? '';
      const tourism = tags['tourism'] ?? '';
      if (sport) return `sport=${sport}`;
      if (leisure) return `${leisure} category`;
      if (tourism) return `${tourism} category`;
      return 'no tag';
    }

    default:
      return 'unknown';
  }
}

// ── Write-mode payload builder ────────────────────────────────────────────────
// Maps Layer 1/2/3 results into the venue_enrichment upsert payload.
//
// IMPORTANT: manually_curated, raw_geoapify, and raw_wikidata are deliberately
// NOT included here. Supabase's upsert() only writes columns present in the
// payload object — omitting these means an existing row's values are left
// untouched (and a new row gets the table's DEFAULT values: manually_curated
// = false, raw_geoapify/raw_wikidata = NULL). This is defense-in-depth: even
// if the manually_curated pre-filter below had a bug, this script could not
// physically overwrite curated data or another source's enrichment via this
// payload shape.

interface EnrichmentUpsertRow {
  venue_id:              string;
  indoor_outdoor:        RawFacts['indoor_outdoor'];
  parking_available:     RawFacts['parking_available'];
  cafe_available:        RawFacts['cafe_available'];
  toilets_available:     RawFacts['toilets_available'];
  baby_change_available: RawFacts['baby_change_available'];
  wheelchair_accessible: RawFacts['wheelchair_accessible'];
  visit_duration_mins:   RawFacts['visit_duration_mins'];
  activity_level:        RawFacts['activity_level'];
  parent_convenience_score: number;
  rainy_day_score:          number;
  active_play_score:        number;
  learning_score:           number;
  budget_score:             number;
  accessibility_score:      number;
  recommended_for:       RecommendedForTag[];
  enrichment_confidence: EnrichmentConfidence;
  enrichment_sources:    string[];
  raw_osm_tags:          Record<string, string>;
  intelligence_version:  number;
  score_breakdown:       ScoreBreakdown;
  last_enriched_at:      string;
}

function buildEnrichmentRow(
  venue:      VenueForScoring,
  tags:       Record<string, string>,
  facts:      RawFacts,
  result:     ReturnType<typeof computeIntelligence>,
  confidence: EnrichmentConfidence,
): EnrichmentUpsertRow {
  const { scores, recommended_for, score_breakdown } = result;

  return {
    venue_id:                 venue.id,
    indoor_outdoor:           facts.indoor_outdoor,
    parking_available:        facts.parking_available,
    cafe_available:           facts.cafe_available,
    toilets_available:        facts.toilets_available,
    baby_change_available:    facts.baby_change_available,
    wheelchair_accessible:    facts.wheelchair_accessible,
    visit_duration_mins:      facts.visit_duration_mins,
    activity_level:           facts.activity_level,
    parent_convenience_score: scores.parent_convenience_score,
    rainy_day_score:          scores.rainy_day_score,
    active_play_score:        scores.active_play_score,
    learning_score:           scores.learning_score,
    budget_score:             scores.budget_score,
    accessibility_score:      scores.accessibility_score,
    recommended_for:          recommended_for,
    enrichment_confidence:    confidence,
    enrichment_sources:       ['osm_archive'],
    raw_osm_tags:             tags,
    intelligence_version:     1,
    score_breakdown:          score_breakdown,
    last_enriched_at:         new Date().toISOString(),
  };
}

// ── Supabase venue query type ─────────────────────────────────────────────────
// Matches the select() columns we request from Supabase.

type SupabaseVenueRow = {
  id:          string;
  name:        string;
  osm_id:      string | null;
  data_source: string | null;
  price_range: string | null;
  min_age:     number;
  max_age:     number;
  is_verified: boolean;
  description: string | null;
  category:    { slug: string } | null;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);

  // ── Write-mode safety gate ──────────────────────────────────────────────────
  // These checks run BEFORE anything else (no archive load, no Supabase query)
  // so an invalid invocation fails immediately and obviously.
  if (flags.write) {
    if (!flags.venueId && !flags.limitProvided) {
      console.error(
        'ERROR: --write requires an explicit --limit=N (no default).\n' +
        '       This prevents accidentally writing to every matching venue.\n' +
        '       Example: npx tsx scripts/enrich/enrichVenues.ts --phase=osm --limit=20 --write',
      );
      process.exit(1);
    }
    if (!flags.venueId && flags.limit > WRITE_LIMIT_CAP) {
      console.error(
        `ERROR: --write refuses to run with --limit=${flags.limit}.\n` +
        `       The write-mode cap is ${WRITE_LIMIT_CAP} for now, while we manually\n` +
        '       validate output quality on real data. Raise WRITE_LIMIT_CAP\n' +
        '       deliberately once that review is complete.',
      );
      process.exit(1);
    }
  }

  console.log('\nPlayPlanner Venue Enrichment Engine — Phase 2A');
  console.log('================================================');
  console.log(`Phase  : ${flags.phase}`);
  if (flags.write) {
    console.log('Mode   : *** WRITE — LIVE DATABASE WRITES TO venue_enrichment ***');
  } else {
    console.log('Mode   : DRY RUN (no writes)');
  }
  console.log(`Limit  : ${flags.venueId ? 'single venue' : flags.limit}`);
  console.log(`Venue  : ${flags.venueId ?? 'all OSM venues'}`);
  console.log('');

  if (flags.write) {
    console.log('⚠️  WRITE MODE ACTIVE — this run will upsert rows into venue_enrichment.');
    console.log('    manually_curated rows are always skipped and never overwritten.');
    console.log('    Only venue_enrichment is touched — venues and get_nearby_venues are not.');
    console.log('');
  }

  // ── Load OSM archive ────────────────────────────────────────────────────────
  const archiveDir = path.join(__dirname, '../data/raw/osm_archive_20260425');
  const osmMap = loadOsmArchive(archiveDir);

  // ── Fetch venues from Supabase ──────────────────────────────────────────────
  // We use service_role which bypasses RLS. This is intentional: the enrichment
  // script is a privileged background process, not an end-user client.
  console.log('\nFetching venues from Supabase...');

  let query = supabase
    .from('venues')
    .select(
      'id, name, osm_id, data_source, price_range, min_age, max_age, ' +
      'is_verified, description, category:categories(slug)',
    )
    .eq('data_source', 'osm')
    .not('osm_id', 'is', null);

  if (flags.venueId) {
    query = query.eq('id', flags.venueId);
  } else {
    query = query.limit(flags.limit);
  }

  const { data: venues, error } = await query.returns<SupabaseVenueRow[]>();

  if (error) {
    console.error('ERROR: Failed to fetch venues from Supabase.');
    console.error(error.message);
    process.exit(1);
  }

  if (!venues || venues.length === 0) {
    console.log('No venues found matching the query. Check data_source = osm and osm_id is not null.');
    return;
  }

  console.log(`Found ${venues.length} venue(s) to process.\n`);

  // ── Pre-fetch manually_curated venue_ids (write mode only) ──────────────────
  // Curated rows are protected by checking BEFORE the loop runs, so a curated
  // venue is never sent to buildEnrichmentRow / upsert in the first place —
  // not just filtered out of a report. This is the authoritative skip list,
  // independent of the --skip-curated flag (which only affects dry-run framing).
  const curatedVenueIds = new Set<string>();
  if (flags.write) {
    const venueIds = venues.map((v) => v.id);
    const { data: curatedRows, error: curatedError } = await supabase
      .from('venue_enrichment')
      .select('venue_id')
      .in('venue_id', venueIds)
      .eq('manually_curated', true)
      .returns<{ venue_id: string }[]>();

    if (curatedError) {
      console.error('ERROR: Failed to check manually_curated rows before writing.');
      console.error(curatedError.message);
      process.exit(1);
    }

    for (const r of curatedRows ?? []) curatedVenueIds.add(r.venue_id);
    if (curatedVenueIds.size > 0) {
      console.log(
        `Found ${curatedVenueIds.size} manually_curated row(s) in this batch — they will be skipped.\n`,
      );
    }
  }

  // ── Process each venue ──────────────────────────────────────────────────────
  let processed = 0;
  let written   = 0;
  let skipped   = 0;

  for (const row of venues) {
    // Normalise the Supabase row into VenueForScoring.
    // The category join returns { slug } or null — handle both safely.
    const venue: VenueForScoring = {
      id:          row.id,
      name:        row.name,
      osm_id:      row.osm_id,
      data_source: row.data_source,
      price_range: row.price_range,
      min_age:     row.min_age    ?? 0,
      max_age:     row.max_age    ?? 18,
      is_verified: row.is_verified ?? false,
      description: row.description,
      category:    row.category,
    };

    // Guard: osm_id must be present (we queried for it, but TypeScript doesn't know)
    if (!venue.osm_id) {
      console.log(`[SKIP] ${venue.name} — osm_id is null (should not happen)`);
      skipped++;
      continue;
    }

    // Never write over manually curated data — checked first, before any
    // scoring work, so a curated row never reaches buildEnrichmentRow/upsert.
    if (flags.write && curatedVenueIds.has(venue.id)) {
      console.log(`[SKIP] ${venue.name} (${venue.id}) — manually_curated = true, never overwritten by script`);
      skipped++;
      continue;
    }

    // Look up OSM tags from the in-memory archive map
    const tags = osmMap.get(venue.osm_id);
    if (!tags) {
      console.log(`[SKIP] ${venue.name} — osm_id ${venue.osm_id} not in archive`);
      skipped++;
      continue;
    }

    try {
      // Layer 1: extract raw facts from OSM tags
      const facts: RawFacts = extractRawFacts(tags);

      // Layer 2 + 3: compute intelligence scores and recommended_for tags
      const result = computeIntelligence(facts, venue);

      // Provenance: how confident are we in the derived facts?
      const confidence = computeConfidence(facts, tags);

      if (flags.write) {
        // Writes ONLY to venue_enrichment, keyed on venue_id. manually_curated,
        // raw_geoapify, and raw_wikidata are intentionally absent from the
        // payload (see buildEnrichmentRow) so existing values are preserved.
        const upsertRow = buildEnrichmentRow(venue, tags, facts, result, confidence);
        const { error: upsertError } = await supabase
          .from('venue_enrichment')
          .upsert(upsertRow, { onConflict: 'venue_id' });

        if (upsertError) {
          // A write/RLS error here means something is fundamentally wrong
          // (bad credentials, policy misconfiguration, schema mismatch) — not
          // a per-venue data problem. Continuing would just repeat the same
          // failure across the rest of the batch, so we halt immediately for
          // the operator to investigate rather than silently degrade.
          console.error(`[ERROR] ${venue.name} (${venue.id}) — upsert failed:`);
          console.error(upsertError.message);
          console.error(
            `\n=== HALTED: write/RLS error on venue ${written + 1} of this batch — ` +
            `${written} written, ${skipped} skipped before stopping ===\n`,
          );
          process.exit(1);
        }

        console.log(
          `[WRITE] ${venue.name} (${venue.id}) — confidence=${confidence}, ` +
          `recommended_for=${JSON.stringify(result.recommended_for)}`,
        );
        written++;
      } else {
        // Print the dry-run report for this venue
        renderDryRunReport(venue, tags, facts, result, confidence);
      }

      processed++;
    } catch (err) {
      // Individual venue failures should not stop the batch.
      console.error(`[ERROR] ${venue.name} (${venue.id}) — processing failed:`);
      console.error(err);
      skipped++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  if (flags.write) {
    console.log(
      `\n=== WRITE COMPLETE: ${written} venue(s) written to venue_enrichment, ${skipped} skipped ===\n`,
    );
  } else {
    console.log(
      `\n=== DRY RUN COMPLETE: ${processed} venues processed, ${skipped} skipped ===\n`,
    );
  }
}

// Run and surface any uncaught errors
main().catch((err: unknown) => {
  console.error('FATAL:', err);
  process.exit(1);
});
