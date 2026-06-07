// =============================================================================
// scripts/enrich/collectGeoapifyPopular.ts
//
// Phase 2B-1B: confirmatory test on 3 POPULAR COMMERCIAL venues — does Geoapify
// carry richer business data (hours/phone/website/facilities) for well-known
// chains/attractions than it did for the 5 low-profile venues in Phase 2B-1?
// RESEARCH / VALIDATION ONLY.
//
// What this does:
//   - Reads 3 selected popular venues + their OSM enrichment from Supabase
//     (READ-ONLY).
//   - For each: geocode -> match -> (if matched) place-details.
//   - Saves the raw Geoapify responses as fixtures (GeoapifyRawBundle).
//   - Prints a venue-by-venue OSM-vs-Geoapify comparison + match audit, and a
//     coverage + cost summary. Also writes scripts/enrich/PHASE_2B1B_DATA.json
//     so the findings can be analysed without re-spending credits.
//
// What this NEVER does:
//   - Never writes to Supabase / venue_enrichment.
//   - Never touches the app.
//   - Never runs without a real GEOAPIFY_API_KEY (it exits with instructions).
//
// CREDIT BUDGET: hard-capped at 8 (3 venues x 2 = 6 expected; 8 leaves a small
// margin for an unmatched venue that still spends a geocode credit).
//
// Usage:
//   npx tsx scripts/enrich/collectGeoapifyPopular.ts
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

// ── Selected venues (Phase 2B-1B) — 1 popular pick per category family ────────
// Picked via a read-only ILIKE search against `venues` (data_source='osm',
// non-null osm_id + lat/long, sparse/no enrichment) for nationally-known names.
const SELECTED_VENUE_IDS: { id: string; expected: string; why: string }[] = [
  {
    id: '287abc1b-e36f-4308-9afe-29ff9a2f4ae8',
    expected: 'soft-play',
    why: 'Wacky Warehouse — national soft-play chain (Burton-on-Trent)',
  },
  {
    id: 'fb9ad746-37ab-4e8a-9d8b-2f45a75fb0a4',
    expected: 'animal-attraction',
    why: 'Twycross Zoo — major UK zoo (famous, large visitor attraction)',
  },
  {
    id: '25adf478-89bc-4316-919b-efd6538f788a',
    expected: 'animal-attraction',
    why: 'National Sea Life Centre Birmingham — major commercial attraction chain (museum/leisure-equivalent: strong web presence expected)',
  },
];

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'geoapify-popular');
const DATA_OUT     = path.join(__dirname, 'PHASE_2B1B_DATA.json');

interface VenueRow {
  id: string;
  name: string;
  postcode: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  osm_id: string | null;
  data_source: string | null;
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

/**
 * Is the matched Geoapify place actually our own OSM object echoed back?
 * We check the datasource raw identifiers against our stored osm_id — this is
 * the "circularity" check: a Geoapify hit that is just our OSM object again
 * proves the matcher works, but does NOT prove Geoapify holds independent data.
 */
function isCircularMatch(ourOsmId: string | null, placeDetails: GeoapifyResponse | undefined): {
  circular: boolean;
  note: string;
} {
  if (!ourOsmId || !placeDetails) return { circular: false, note: 'no place-details to compare' };
  const typedProps = firstProperties(placeDetails);
  if (!typedProps) return { circular: false, note: 'no properties on matched place' };
  // `datasource.raw` (osm_id/osm_type) is not in our narrow GeoapifyFeatureProperties
  // type (we only type fields we read for facts). Read it defensively via `unknown`
  // — this is audit-only, never written to the DB.
  const props = typedProps as unknown as Record<string, unknown>;
  const placeId = typeof props['place_id'] === 'string' ? (props['place_id'] as string) : '';
  const datasource = props['datasource'] as { raw?: Record<string, unknown> } | undefined;
  const rawId = datasource?.raw && typeof datasource.raw['osm_id'] !== 'undefined'
    ? String(datasource.raw['osm_id'])
    : '';
  const rawType = datasource?.raw && typeof datasource.raw['osm_type'] === 'string'
    ? String(datasource.raw['osm_type'])
    : '';
  // Our osm_id is stored like "node/10870122851" or "way/189048464".
  const [ourType, ourNumericId] = ourOsmId.includes('/') ? ourOsmId.split('/') : ['', ourOsmId];
  const numericMatchesRaw = rawId !== '' && ourNumericId === rawId && (rawType === '' || rawType === ourType);
  const numericMatchesPlaceId = ourNumericId !== '' && placeId.includes(ourNumericId);
  if (numericMatchesRaw || numericMatchesPlaceId) {
    return {
      circular: true,
      note: `Geoapify echoed our own OSM object (osm_id=${ourOsmId}, datasource.raw.osm_id=${rawId || '-'}, place_id contains our numeric id=${numericMatchesPlaceId})`,
    };
  }
  return {
    circular: false,
    note: `place_id/datasource do not reference our osm_id=${ourOsmId} — appears to be an independent Geoapify record`,
  };
}

interface PerVenueResult {
  venue: VenueMatchInput;
  expected_category: string;
  selection_reason: string;
  osm_facts: RawFacts;
  osm_confidence: string | null;
  match: MatchResult;
  geoapify_facts: RawFacts | null;
  geoapify_extras: GeoapifyExtras | null;
  merged_applied_fields: string[];
  merged_conflicts: number;
  geocode_candidate_count: number;
  circularity: { circular: boolean; note: string };
}

async function main(): Promise<void> {
  console.log('\nPhase 2B-1B — Popular-Venue Geoapify Confirmatory Test (research only)');
  console.log('========================================================================');
  console.log('Goal: confirm whether Geoapify ONLY failed (Phase 2B-1, n=5, 0 facility');
  console.log('gains) because that sample was low-profile — by testing 3 nationally');
  console.log('known commercial venues likely to carry richer business data.\n');

  // Require the key BEFORE touching anything — never call the API keyless.
  // HARD CAP: 8 credits max for this confirmatory run (3 venues x 2 = 6 expected).
  const client = geoapifyClientFromEnv({ minIntervalMs: 1200, dailyCreditBudget: 8 });

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in scripts/.env.');
    process.exit(1);
  }
  const sb = createClient(url, key);

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  const results: PerVenueResult[] = [];

  for (const sel of SELECTED_VENUE_IDS) {
    const { data, error } = await sb
      .from('venues')
      .select(
        'id, name, postcode, city, latitude, longitude, osm_id, data_source, ' +
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

    if (data.data_source !== 'osm' || !data.osm_id) {
      console.error(`[SKIP] ${sel.id} — not a comparable OSM venue (data_source=${data.data_source}, osm_id=${data.osm_id}).`);
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
    console.log(`  why selected: ${sel.why}`);
    console.log(`  query: "${text}"  bias: ${venue.latitude},${venue.longitude}`);
    console.log(`  our osm_id: ${data.osm_id}  enrichment: ${data.venue_enrichment ? data.venue_enrichment.enrichment_confidence : 'none (sparse)'}`);

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

    const circularity = isCircularMatch(data.osm_id, placeDetails);
    console.log(`  circularity: ${circularity.circular ? 'CIRCULAR (same OSM object)' : 'independent record'} — ${circularity.note}`);

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
      selection_reason: sel.why,
      osm_facts: osmFactsFromRow(data),
      osm_confidence: data.venue_enrichment?.enrichment_confidence ?? null,
      match,
      geoapify_facts: geoFacts,
      geoapify_extras: geoExtras,
      merged_applied_fields: appliedFields,
      merged_conflicts: conflictCount,
      geocode_candidate_count: candidateCount,
      circularity,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const accepted = results.filter((r) => r.match.decision === 'accept').length;
  const review   = results.filter((r) => r.match.decision === 'review').length;
  const reject   = results.filter((r) => r.match.decision === 'reject').length;
  const totalGapFills = results.reduce((n, r) => n + r.merged_applied_fields.length, 0);
  const withHours  = results.filter((r) => r.geoapify_extras?.opening_hours).length;
  const withWeb    = results.filter((r) => r.geoapify_extras?.website).length;
  const withPhone  = results.filter((r) => r.geoapify_extras?.phone).length;
  const circularN  = results.filter((r) => r.circularity.circular).length;
  const independentN = results.filter((r) => !r.circularity.circular && r.geoapify_facts !== null).length;

  // Specific facility-by-facility "did Geoapify add X?" flags (any of the 3 gained it)
  const gainedField = (field: keyof RawFacts): boolean =>
    results.some((r) => {
      if (!r.geoapify_facts) return false;
      const osmVal = r.osm_facts[field];
      const geoVal = r.geoapify_facts[field];
      return (osmVal === null || osmVal === undefined) && geoVal !== null && geoVal !== undefined;
    });

  console.log('\n========================================================================');
  console.log('SUMMARY');
  console.log(`  venues processed : ${results.length}`);
  console.log(`  match: accept=${accepted} review=${review} reject=${reject}`);
  console.log(`  circular matches (= our own OSM object) : ${circularN}/${results.length}`);
  console.log(`  independent geoapify records             : ${independentN}/${results.length}`);
  console.log(`  total gap-fills from geoapify : ${totalGapFills}`);
  console.log(`  new extras: opening_hours=${withHours} website=${withWeb} phone=${withPhone}`);
  console.log('');
  console.log('FACILITY/ACCESSIBILITY/HOURS GAIN CHECK (vs prior 5-venue test which found 0/5):');
  console.log(`  parking_available     : ${gainedField('parking_available') ? 'GAINED' : 'no gain'}`);
  console.log(`  toilets_available     : ${gainedField('toilets_available') ? 'GAINED' : 'no gain'}`);
  console.log(`  cafe_available        : ${gainedField('cafe_available') ? 'GAINED' : 'no gain'}`);
  console.log(`  baby_change_available : ${gainedField('baby_change_available') ? 'GAINED' : 'no gain'}`);
  console.log(`  wheelchair_accessible : ${gainedField('wheelchair_accessible') ? 'GAINED' : 'no gain'}`);
  console.log(`  opening_hours (extra) : ${withHours > 0 ? 'GAINED' : 'no gain'}`);
  console.log(`  website (extra)       : ${withWeb > 0 ? 'GAINED' : 'no gain'}`);
  console.log(`  phone (extra)         : ${withPhone > 0 ? 'GAINED' : 'no gain'}`);
  console.log('');
  console.log('COST');
  console.log(`  credits spent this run : ${client.credits} (cap was 8)`);
  console.log('');
  console.log('No database writes were performed.');

  // Machine-readable dump for analysis without re-spending credits.
  fs.writeFileSync(
    DATA_OUT,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        phase: '2B-1B (popular-venue confirmatory test)',
        credit_budget: 8,
        credits_spent: client.credits,
        results: results.map((r) => ({
          ...r,
          osm_facts: fmtFacts(r.osm_facts),
          geoapify_facts: r.geoapify_facts ? fmtFacts(r.geoapify_facts) : null,
        })),
        summary: {
          accepted,
          review,
          reject,
          circular_matches: circularN,
          independent_records: independentN,
          total_gap_fills: totalGapFills,
          with_opening_hours: withHours,
          with_website: withWeb,
          with_phone: withPhone,
          gained_parking: gainedField('parking_available'),
          gained_toilets: gainedField('toilets_available'),
          gained_cafe: gainedField('cafe_available'),
          gained_baby_change: gainedField('baby_change_available'),
          gained_wheelchair: gainedField('wheelchair_accessible'),
        },
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
