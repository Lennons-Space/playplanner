// =============================================================================
// scripts/enrich/collectGeoapifyFixtures.ts
//
// Phase 2B-1: collect 5 REAL Geoapify responses and compare them against our
// existing OSM enrichment. RESEARCH / VALIDATION ONLY.
//
// What this does:
//   - Reads 5 selected venues + their OSM enrichment from Supabase (READ-ONLY).
//   - For each: geocode -> match -> (if matched) place-details.
//   - Saves the raw Geoapify responses as fixtures (GeoapifyRawBundle).
//   - Prints a venue-by-venue OSM-vs-Geoapify comparison + match audit, and a
//     coverage + cost summary. Also writes scripts/enrich/PHASE_2B1_DATA.json
//     so the findings can be analysed without re-spending credits.
//
// What this NEVER does:
//   - Never writes to Supabase / venue_enrichment.
//   - Never touches the app.
//   - Never runs without a real GEOAPIFY_API_KEY (it exits with instructions).
//
// Usage:
//   npx tsx scripts/enrich/collectGeoapifyFixtures.ts
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as { config: (o: { path: string }) => void };
  dotenv.config({ path: path.join(__dirname, '../.env') });
} catch { /* rely on shell env */ }

import { createClient } from '@supabase/supabase-js';
import { geoapifyClientFromEnv } from './geoapifyClient';
import { matchVenue } from './geoapifyMatch';
import {
  extractGeoapifyAnnotatedFacts,
  extractGeoapifyExtras,
  firstProperties,
} from './geoapifyExtract';
import { annotateOsmFacts } from './osmProvenance';
import { mergeAnnotatedFacts } from './mergeFacts';
import type {
  AnnotatedFacts,
  GeoapifyExtras,
  GeoapifyRawBundle,
  GeoapifyResponse,
  MatchResult,
  RawFacts,
  VenueMatchInput,
} from '../../types/enrichment';

// ── Selected venues (Phase 2B-1) — one per category family ────────────────────
const SELECTED_VENUE_IDS: { id: string; expected: string }[] = [
  { id: '006a4f51-1541-45ff-ac97-3114876990e6', expected: 'playground' },
  { id: '01144e3c-15d6-444f-8b6a-e15f0ba76c42', expected: 'soft-play' },
  { id: '0060d2e5-42cc-4235-a243-f67304654d81', expected: 'swimming' },
  { id: '02c755b7-8e65-4fb2-bef8-e7cc15f8ed76', expected: 'museum' },
  { id: '00796cc5-79c6-4c87-9cc3-42c5e52ee986', expected: 'animal-attraction' },
];

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'geoapify-real');
const DATA_OUT     = path.join(__dirname, 'PHASE_2B1_DATA.json');

interface VenueRow {
  id: string;
  name: string;
  postcode: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  osm_id: string | null;
  category: { slug: string } | null;
  venue_enrichment: {
    raw_osm_tags: Record<string, string> | null;
    indoor_outdoor: string | null;
    parking_available: boolean | null;
    cafe_available: boolean | null;
    toilets_available: boolean | null;
    baby_change_available: boolean | null;
    wheelchair_accessible: string | null;
    visit_duration_mins: number | null;
    activity_level: string | null;
    enrichment_confidence: string;
    enrichment_sources: string[];
  } | null;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function fmtFacts(f: RawFacts): Record<string, unknown> {
  return { ...f };
}

function osmFactsFromRow(row: VenueRow): RawFacts {
  const e = row.venue_enrichment;
  return {
    indoor_outdoor: (e?.indoor_outdoor ?? null) as RawFacts['indoor_outdoor'],
    parking_available: e?.parking_available ?? null,
    cafe_available: e?.cafe_available ?? null,
    toilets_available: e?.toilets_available ?? null,
    baby_change_available: e?.baby_change_available ?? null,
    wheelchair_accessible: (e?.wheelchair_accessible ?? null) as RawFacts['wheelchair_accessible'],
    visit_duration_mins: e?.visit_duration_mins ?? null,
    activity_level: (e?.activity_level ?? null) as RawFacts['activity_level'],
  };
}

interface PerVenueResult {
  venue: VenueMatchInput;
  expected_category: string;
  osm_facts: RawFacts;
  osm_confidence: string | null;
  match: MatchResult;
  geoapify_facts: RawFacts | null;
  geoapify_extras: GeoapifyExtras | null;
  merged_applied_fields: string[];
  merged_conflicts: number;
  geocode_candidate_count: number;
}

async function main(): Promise<void> {
  console.log('\nPhase 2B-1 — Real Geoapify Fixture Collection (research only)');
  console.log('================================================================');

  // Require the key BEFORE touching anything — never call the API keyless.
  const client = geoapifyClientFromEnv({ minIntervalMs: 1200, dailyCreditBudget: 50 });

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in scripts/.env.');
    process.exit(1);
  }
  const sb = createClient(url, key);

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  // Total OSM venue count — for cost extrapolation only (read-only, cheap).
  const { count: totalOsm } = await sb
    .from('venues')
    .select('id', { count: 'exact', head: true })
    .eq('data_source', 'osm')
    .not('osm_id', 'is', null);

  const results: PerVenueResult[] = [];

  for (const sel of SELECTED_VENUE_IDS) {
    const { data, error } = await sb
      .from('venues')
      .select(
        'id, name, postcode, city, latitude, longitude, osm_id, ' +
        'category:categories(slug), ' +
        'venue_enrichment(raw_osm_tags, indoor_outdoor, parking_available, cafe_available, ' +
        'toilets_available, baby_change_available, wheelchair_accessible, visit_duration_mins, ' +
        'activity_level, enrichment_confidence, enrichment_sources)',
      )
      .eq('id', sel.id)
      .single<VenueRow>();

    if (error || !data) {
      console.error(`[SKIP] ${sel.id} — could not load: ${error?.message}`);
      continue;
    }

    const venue: VenueMatchInput = {
      id: data.id,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      postcode: data.postcode,
      city: data.city && data.city !== 'Unknown area' ? data.city : null,
      category_slug: data.category?.slug ?? sel.expected,
    };

    // Build the geocode query: name + postcode + city (whatever we have).
    const queryParts = [venue.name];
    if (venue.postcode) queryParts.push(venue.postcode);
    if (venue.city) queryParts.push(venue.city);
    const text = queryParts.join(', ');

    console.log(`\n──────────────────────────────────────────────────────────────`);
    console.log(`[${sel.expected}] ${venue.name}`);
    console.log(`  query: "${text}"  bias: ${venue.latitude},${venue.longitude}`);

    // 1) Geocode
    const geocode = await client.geocodeSearch({
      text,
      biasLat: venue.latitude,
      biasLon: venue.longitude,
      limit: 5,
    });
    const geocodeResp = geocode.response;
    const candidateCount = geocodeResp.features?.length ?? 0;

    // 2) Match
    const match = matchVenue(venue, geocodeResp);
    console.log(
      `  match: ${match.decision.toUpperCase()} | dist=${match.distance_m}m ` +
      `name_sim=${match.name_sim} score=${match.score} ` +
      `pc=${match.postcode_match} conf=${match.confidence} | ${match.candidate_name}`,
    );

    // 3) Place details — only for accept/review with a place_id.
    let placeDetails: GeoapifyResponse | undefined;
    let geoFacts: RawFacts | null = null;
    let geoExtras: GeoapifyExtras | null = null;
    let appliedFields: string[] = [];
    let conflictCount = 0;

    if ((match.decision === 'accept' || match.decision === 'review') && match.place_id) {
      const details = await client.placeDetails({ placeId: match.place_id });
      placeDetails = details.response;
      const props = firstProperties(placeDetails);
      if (props) {
        const geoAnnotated: AnnotatedFacts = extractGeoapifyAnnotatedFacts(props);
        geoExtras = extractGeoapifyExtras(props);
        const osmAnnotated: AnnotatedFacts = data.venue_enrichment?.raw_osm_tags
          ? annotateOsmFacts(data.venue_enrichment.raw_osm_tags)
          : annotateOsmFacts({});
        const merged = mergeAnnotatedFacts(osmAnnotated, geoAnnotated);
        geoFacts = {
          indoor_outdoor: geoAnnotated.indoor_outdoor.value,
          parking_available: geoAnnotated.parking_available.value,
          cafe_available: geoAnnotated.cafe_available.value,
          toilets_available: geoAnnotated.toilets_available.value,
          baby_change_available: geoAnnotated.baby_change_available.value,
          wheelchair_accessible: geoAnnotated.wheelchair_accessible.value,
          visit_duration_mins: geoAnnotated.visit_duration_mins.value,
          activity_level: geoAnnotated.activity_level.value,
        };
        appliedFields = merged.applied_fields.map(String);
        conflictCount = merged.conflicts.length;
        console.log(`  geoapify extras: hours=${geoExtras.opening_hours ? 'Y' : '-'} web=${geoExtras.website ? 'Y' : '-'} phone=${geoExtras.phone ? 'Y' : '-'}`);
        console.log(`  gap-fills from geoapify: ${appliedFields.join(', ') || '(none)'}  conflicts: ${conflictCount}`);
      }
    } else {
      console.log('  place-details skipped (no usable match).');
    }

    // 4) Save fixture bundle (raw responses, verbatim).
    const bundle: GeoapifyRawBundle = {
      venue,
      geocode: geocode.raw as GeoapifyResponse,
      ...(placeDetails ? { place_details: placeDetails } : {}),
    };
    const file = path.join(FIXTURE_DIR, `${slugify(venue.name)}.json`);
    fs.writeFileSync(file, JSON.stringify(bundle, null, 2), 'utf8');
    console.log(`  saved fixture: ${path.relative(process.cwd(), file)}`);

    results.push({
      venue,
      expected_category: sel.expected,
      osm_facts: osmFactsFromRow(data),
      osm_confidence: data.venue_enrichment?.enrichment_confidence ?? null,
      match,
      geoapify_facts: geoFacts,
      geoapify_extras: geoExtras,
      merged_applied_fields: appliedFields,
      merged_conflicts: conflictCount,
      geocode_candidate_count: candidateCount,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const accepted = results.filter((r) => r.match.decision === 'accept').length;
  const review   = results.filter((r) => r.match.decision === 'review').length;
  const reject   = results.filter((r) => r.match.decision === 'reject').length;
  const totalGapFills = results.reduce((n, r) => n + r.merged_applied_fields.length, 0);
  const withHours = results.filter((r) => r.geoapify_extras?.opening_hours).length;
  const withWeb   = results.filter((r) => r.geoapify_extras?.website).length;
  const withPhone = results.filter((r) => r.geoapify_extras?.phone).length;

  console.log('\n================================================================');
  console.log('SUMMARY');
  console.log(`  venues processed : ${results.length}`);
  console.log(`  match: accept=${accepted} review=${review} reject=${reject}`);
  console.log(`  total gap-fills from geoapify : ${totalGapFills}`);
  console.log(`  new extras: opening_hours=${withHours} website=${withWeb} phone=${withPhone}`);
  console.log('');
  console.log('COST');
  console.log(`  credits spent this run : ${client.credits}`);
  const perVenue = results.length ? client.credits / results.length : 0;
  console.log(`  credits / venue (avg)  : ${perVenue.toFixed(2)}`);
  console.log(`  est. credits / 100     : ${Math.round(perVenue * 100)}`);
  console.log(`  est. credits / 1,000   : ${Math.round(perVenue * 1000)}`);
  console.log(`  total OSM venues       : ${totalOsm ?? 'unknown'}`);
  if (totalOsm) {
    console.log(`  est. full-catalogue    : ${Math.round(perVenue * totalOsm)} credits ` +
      `(~${Math.ceil((perVenue * totalOsm) / 3000)} days at 3,000/day free tier)`);
  }

  // Machine-readable dump for analysis without re-spending credits.
  fs.writeFileSync(
    DATA_OUT,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_osm_venues: totalOsm ?? null,
        credits_spent: client.credits,
        results: results.map((r) => ({
          ...r,
          osm_facts: fmtFacts(r.osm_facts),
          geoapify_facts: r.geoapify_facts ? fmtFacts(r.geoapify_facts) : null,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nWrote analysis data: ${path.relative(process.cwd(), DATA_OUT)}`);
  console.log('No database writes were performed. Fixtures saved for offline analysis.\n');
}

main().catch((err: unknown) => {
  console.error('FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
