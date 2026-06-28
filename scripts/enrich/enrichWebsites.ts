// =============================================================================
// scripts/enrich/enrichWebsites.ts
//
// Website Enrichment CLI — build step 4 (spec §9, §15).
//
// Usage:
//   npx tsx scripts/enrich/enrichWebsites.ts [flags]
//
// Flags:
//   (default)              DRY RUN: fetch → extract → write report. NO DB writes.
//   --propose              ALSO insert pending proposals via propose_field RPC. GATED.
//   --limit=N              How many pilot venues (required for --propose unless --venue-id).
//   --venue-id=<uuid>      Single venue. Implies --limit=1.
//   --report=<base>        Report output base path. Default: scripts/enrich/out/run
//   --max-pages=3          Page cap per venue (landing + hints).
//   --per-domain-delay-ms=3000
//   --refresh              Ignore cache — re-fetch.
//   --cache-only           No network; use cached pages only. Also disables throttle delays.
//
// SAFETY:
//   - Default = dry run. NO DB writes ever happen without --propose.
//   - --propose requires --limit explicitly, OR --venue-id (implied limit 1).
//   - --propose refuses limit > PROPOSE_LIMIT_CAP (100).
//   - robots.txt is ALWAYS honoured — there is no bypass flag.
//   - Secrets/PII are never logged (URLs only).
//
// Environment (read from scripts/.env or shell):
//   SUPABASE_URL              Supabase project URL.
//   SUPABASE_SERVICE_ROLE_KEY Service-role key (bypasses RLS).
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CurrentVenueSnapshot, DayHours } from '../../types/webEnrichment';
import { WebClient, nodeWebClientDeps } from './web/webClient';
import { runEnrichment, type VenueInput } from './web/orchestrate';
import { renderRunJson, renderRunCsv, renderRunHtml } from './web/report';
import { stratifiedSample, categoryBreakdown, parsePilotVenueIds } from './sampling';

// ── Load environment variables ────────────────────────────────────────────────

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as { config: (opts: { path: string }) => void };
  dotenv.config({ path: path.join(__dirname, '../.env') });
} catch {
  // dotenv not available; env vars must be set in the shell.
}

// ── Validate environment ──────────────────────────────────────────────────────

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      '       Add them to scripts/.env or export them in your shell.',
  );
  process.exit(1);
}

// Service-role client bypasses RLS. Used ONLY for read-only venue/opening_hours
// SELECTs in dry-run mode, and for propose_field RPC calls in --propose mode.
// This key never appears in logs.
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── CLI flags ─────────────────────────────────────────────────────────────────

/**
 * Hard cap on how many venues --propose may process in a single run.
 * Named constant — raise deliberately after manual review (spec §9, arch #11).
 */
const PROPOSE_LIMIT_CAP = 100;

interface ScriptFlags {
  propose: boolean;
  limit: number;
  limitProvided: boolean;
  venueId: string | null;
  reportBase: string;
  maxPages: number;
  perDomainDelayMs: number;
  refresh: boolean;
  cacheOnly: boolean;
}

function parseFlags(argv: string[]): ScriptFlags {
  const flags: ScriptFlags = {
    propose: false,
    limit: 20,
    limitProvided: false,
    venueId: null,
    reportBase: path.join(__dirname, 'out', 'run'),
    maxPages: 3,
    perDomainDelayMs: 3000,
    refresh: false,
    cacheOnly: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--propose') {
      flags.propose = true;
    } else if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.slice('--limit='.length), 10);
      if (!isNaN(val) && val > 0) {
        flags.limit = val;
        flags.limitProvided = true;
      }
    } else if (arg.startsWith('--venue-id=')) {
      flags.venueId = arg.slice('--venue-id='.length) || null;
    } else if (arg.startsWith('--report=')) {
      flags.reportBase = arg.slice('--report='.length);
    } else if (arg.startsWith('--max-pages=')) {
      const val = parseInt(arg.slice('--max-pages='.length), 10);
      if (!isNaN(val) && val > 0) flags.maxPages = val;
    } else if (arg.startsWith('--per-domain-delay-ms=')) {
      const val = parseInt(arg.slice('--per-domain-delay-ms='.length), 10);
      if (!isNaN(val) && val >= 0) flags.perDomainDelayMs = val;
    } else if (arg === '--refresh') {
      flags.refresh = true;
    } else if (arg === '--cache-only') {
      flags.cacheOnly = true;
    }
  }

  return flags;
}

// ── Safety gates ──────────────────────────────────────────────────────────────

function applyProposeGates(flags: ScriptFlags): void {
  if (!flags.propose) return;

  // --propose requires --limit OR --venue-id (mirrors enrichVenues.ts arch #8)
  const limitOk = flags.venueId !== null || flags.limitProvided;
  if (!limitOk) {
    console.error(
      'ERROR: --propose requires an explicit --limit=N (or --venue-id for a single venue).\n' +
        '       This prevents accidentally proposing for every matching venue.\n' +
        `       Hard cap: ${PROPOSE_LIMIT_CAP} venues per run.`,
    );
    process.exit(1);
  }

  const effectiveLimit = flags.venueId ? 1 : flags.limit;
  if (effectiveLimit > PROPOSE_LIMIT_CAP) {
    console.error(
      `ERROR: --propose refuses --limit=${effectiveLimit} (cap is ${PROPOSE_LIMIT_CAP}).\n` +
        '       Raise PROPOSE_LIMIT_CAP deliberately after validating output quality.',
    );
    process.exit(1);
  }
}

// ── DB: fetch pilot venues ────────────────────────────────────────────────────

interface VenueRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  price_range: string | null;
  phone: string | null;
  email: string | null;
  category_id: string | null;
}

const VENUE_SELECT = 'id, name, website, description, price_range, phone, email, category_id';

/** Supabase returns at most ~1000 rows per request; page through them all. */
const PAGE_SIZE = 1000;

/** Eligible = published + approved + has a http(s) website. */
function isEligible(v: VenueRow): boolean {
  return !!v.website && /^https?:\/\//i.test(v.website);
}

/** Map category_id -> slug, so the sampler can stratify by outing category. */
async function fetchCategorySlugMap(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug')
    .returns<{ id: string; slug: string }[]>();
  if (error) {
    console.error('ERROR: Failed to fetch categories:', error.message);
    process.exit(1);
  }
  const map = new Map<string, string>();
  for (const c of data ?? []) map.set(c.id, c.slug);
  // An empty map would silently demote every venue to filler and destroy the
  // stratification guarantee — fail loudly instead (secom MED-2).
  if (map.size === 0) {
    console.error('ERROR: categories table returned no rows — cannot stratify the sample.');
    process.exit(1);
  }
  return map;
}

async function fetchPilotVenues(flags: ScriptFlags): Promise<VenueRow[]> {
  // ── Single venue: bypass sampling entirely ──────────────────────────────────
  if (flags.venueId) {
    const { data, error } = await supabase
      .from('venues')
      .select(VENUE_SELECT)
      .eq('is_published', true)
      .eq('moderation_status', 'approved')
      .not('website', 'is', null)
      .eq('id', flags.venueId)
      .returns<VenueRow[]>();
    if (error) {
      console.error('ERROR: Failed to fetch venue:', error.message);
      process.exit(1);
    }
    const eligible = (data ?? []).filter(isEligible);
    if (eligible.length === 0) console.log('No venue found matching --venue-id.');
    return eligible;
  }

  // ── Explicit hand-picked set: pilot_venue_ids.json (no sampling) ─────────────
  // When present this file is authoritative — a --propose run writes to exactly
  // these venues — so a malformed file FAILS the run rather than silently
  // falling back to a large stratified sample.
  const pilotIdsPath = path.join(__dirname, 'pilot_venue_ids.json');
  if (fs.existsSync(pilotIdsPath)) {
    const parse = parsePilotVenueIds(fs.readFileSync(pilotIdsPath, 'utf8'));
    if (!parse.ok) {
      console.error(`ERROR: pilot_venue_ids.json is invalid (${parse.error}). Fix or remove it.`);
      process.exit(1);
    }
    console.log(`Using ${parse.ids.length} venue IDs from pilot_venue_ids.json`);
    const { data, error } = await supabase
      .from('venues')
      .select(VENUE_SELECT)
      .eq('is_published', true)
      .eq('moderation_status', 'approved')
      .not('website', 'is', null)
      .in('id', parse.ids)
      .returns<VenueRow[]>();
    if (error) {
      console.error('ERROR: Failed to fetch pilot venues:', error.message);
      process.exit(1);
    }
    return (data ?? []).filter(isEligible);
  }

  // ── Default: category-stratified sample across family-outing categories ──────
  // Fetch ALL eligible venues (paged) so small categories aren't missed, then
  // pick a balanced, deterministic subset. Round-robins across outing categories
  // and only tops up from childcare/unknown filler (spec §12).
  const all: VenueRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('venues')
      .select(VENUE_SELECT)
      .eq('is_published', true)
      .eq('moderation_status', 'approved')
      .not('website', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .returns<VenueRow[]>();
    if (error) {
      console.error('ERROR: Failed to fetch venues:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const eligible = all.filter(isEligible);
  if (eligible.length === 0) {
    console.log('No venues found matching the pilot query.');
    return [];
  }

  const slugMap = await fetchCategorySlugMap();
  const unmappedCategoryIds = new Set<string>();
  const withSlug = eligible.map((v) => {
    const slug = v.category_id ? slugMap.get(v.category_id) ?? null : null;
    if (v.category_id && !slug) unmappedCategoryIds.add(v.category_id);
    return { ...v, slug };
  });
  // Venues whose category_id isn't in the categories table get demoted to filler,
  // skewing the balance — surface it (ids only, no PII) so it isn't silent (secom HIGH-1).
  if (unmappedCategoryIds.size > 0) {
    console.warn(
      `WARNING: ${unmappedCategoryIds.size} category_id(s) have no slug — those venues ` +
        `fall back to filler: ${[...unmappedCategoryIds].join(', ')}`,
    );
  }

  const selected = stratifiedSample(withSlug, { limit: flags.limit });

  // Non-PII run log: how many eligible, and the category breakdown chosen.
  console.log(`Eligible venues: ${eligible.length}. Stratified sample: ${selected.length}.`);
  for (const { slug, count } of categoryBreakdown(selected)) {
    console.log(`  ${String(count).padStart(4)}  ${slug}`);
  }

  // Strip the transient `slug` field — orchestrator only needs the VenueRow.
  return selected.map(({ slug: _slug, ...row }) => row);
}

// ── DB: build CurrentVenueSnapshot ────────────────────────────────────────────

interface OpeningHoursRow {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

async function buildSnapshot(venueId: string, venueRow: VenueRow): Promise<CurrentVenueSnapshot> {
  const { data: ohRows, error: ohError } = await supabase
    .from('opening_hours')
    .select('day_of_week, opens_at, closes_at, is_closed')
    .eq('venue_id', venueId)
    .returns<OpeningHoursRow[]>();

  if (ohError) {
    // Non-fatal: proceed with empty opening_hours
    console.warn(`WARNING: Could not fetch opening_hours for ${venueId}: ${ohError.message}`);
  }

  const opening_hours: DayHours[] = (ohRows ?? []).map((row) => ({
    day_of_week: row.day_of_week,
    is_closed: row.is_closed,
    intervals:
      row.is_closed || !row.opens_at || !row.closes_at
        ? []
        : [{ opens: row.opens_at, closes: row.closes_at }],
  }));

  return {
    description: venueRow.description,
    price_range: venueRow.price_range,
    website: venueRow.website,
    phone: venueRow.phone,
    email: venueRow.email,
    opening_hours,
  };
}

// ── DB: propose_field RPC (gated — never called in dry-run) ──────────────────

/**
 * GATED PROPOSE PATH — only reached when --propose is explicitly passed.
 * Writes pending proposals to the DB via the propose_field RPC.
 * This branch is NOT exercised in the default dry-run path.
 * Migration 056 must be applied before this can succeed.
 */
async function writeProposeRpc(
  runId: string,
  venueId: string,
  _proposal: import('../../types/webEnrichment').ProposalDraft,
): Promise<void> {
  // The propose_field RPC signature (spec §2):
  //   propose_field(p_run_id, p_venue_id, p_field, p_proposed, p_source_url,
  //                 p_evidence, p_evidence_raw, p_method, p_confidence, p_conflicts)
  const { error } = await supabase.rpc('propose_field', {
    p_run_id: runId,
    p_venue_id: venueId,
    p_field: _proposal.field,
    p_proposed: _proposal.proposed_value,
    p_source_url: _proposal.source_url,
    p_evidence: _proposal.evidence_snippet,
    p_evidence_raw: _proposal.evidence_raw,
    p_method: _proposal.extraction_method,
    p_confidence: _proposal.confidence,
    p_conflicts: _proposal.conflicts_existing,
  });
  if (error) {
    // Log only the field + error code — never the proposed value (may contain PII)
    console.warn(`  [propose_field] failed for field=${_proposal.field}: ${error.message}`);
  }
}

// ── Write report files ────────────────────────────────────────────────────────

function writeReports(
  reportBase: string,
  jsonContent: string,
  csvContent: string,
  htmlContent: string,
): void {
  const dir = path.dirname(reportBase);
  fs.mkdirSync(dir, { recursive: true });

  const jsonPath = `${reportBase}.json`;
  const csvPath = `${reportBase}.csv`;
  const htmlPath = `${reportBase}.html`;

  fs.writeFileSync(jsonPath, jsonContent, 'utf8');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  console.log(`\nReports written:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);
  console.log(`  HTML: ${htmlPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);

  console.log('\nPlayPlanner Website Enrichment Engine — Build Step 4');
  console.log('=====================================================');
  console.log(`Mode      : ${flags.propose ? '*** PROPOSE — will insert pending proposals ***' : 'DRY RUN (no DB writes)'}`);
  console.log(`Limit     : ${flags.venueId ? 'single venue' : flags.limit}`);
  console.log(`Max pages : ${flags.maxPages}`);
  console.log(`Cache     : ${flags.cacheOnly ? 'cache-only (no network)' : flags.refresh ? 'refresh (ignore cache)' : 'normal'}`);
  console.log('');

  // Apply --propose safety gates BEFORE any DB or network activity
  applyProposeGates(flags);

  // ── Fetch pilot venues (read-only SELECT) ──────────────────────────────────
  console.log('Fetching pilot venues...');
  const venueRows = await fetchPilotVenues(flags);
  console.log(`Found ${venueRows.length} eligible venue(s).\n`);

  if (venueRows.length === 0) return;

  const venues: VenueInput[] = venueRows.map((v) => ({
    venueId: v.id,
    name: v.name,
    website: v.website,
  }));

  // ── Build WebClient ────────────────────────────────────────────────────────
  const clientOptions = {
    perDomainIntervalMs: flags.cacheOnly ? 0 : flags.perDomainDelayMs,
    refresh: flags.refresh,
    // cache-only: we set perDomainIntervalMs=0 above; the WebClient handles
    // the rest (cache reads succeed, no network calls go out).
  };
  const webClient = new WebClient(nodeWebClientDeps(), clientOptions);

  // ── Run enrichment ─────────────────────────────────────────────────────────
  const runLabel = `${new Date().toISOString().slice(0, 16)}Z-pilot`;
  const retrievedAt = new Date().toISOString();

  console.log(`Run label : ${runLabel}`);
  console.log('Starting enrichment...\n');

  const report = await runEnrichment(
    venues,
    {
      fetchPage: (url) => webClient.fetch(url),
      retrievedAt,
      maxPages: flags.maxPages,
      snapshotProvider: async (venueId) => {
        const row = venueRows.find((v) => v.id === venueId);
        if (!row) {
          return { description: null, price_range: null, website: null, phone: null, email: null, opening_hours: [] };
        }
        return buildSnapshot(venueId, row);
      },
    },
    runLabel,
  );

  // ── Render and write reports ───────────────────────────────────────────────
  const jsonContent = renderRunJson(report);
  const csvContent = renderRunCsv(report);
  const htmlContent = renderRunHtml(report);
  writeReports(flags.reportBase, jsonContent, csvContent, htmlContent);

  // ── Print summary ──────────────────────────────────────────────────────────
  const { summary } = report;
  console.log('\n=== RUN SUMMARY ===');
  console.log(`Venues processed : ${summary.venuesProcessed}`);
  console.log(`Total proposals  : ${summary.totalProposals}`);
  console.log(`  high           : ${summary.proposalsByConfidence.high}`);
  console.log(`  medium         : ${summary.proposalsByConfidence.medium}`);
  console.log(`  low            : ${summary.proposalsByConfidence.low}`);
  console.log('Outcomes:');
  for (const [outcome, count] of Object.entries(summary.byOutcome)) {
    console.log(`  ${outcome.padEnd(30)}: ${count}`);
  }

  // ── GATED PROPOSE PATH ────────────────────────────────────────────────────
  // This block is only reached when --propose is explicitly passed.
  // In dry-run mode (the default), execution ends above this block.
  // Migration 056 must be applied before --propose can succeed.
  if (flags.propose) {
    console.log('\n*** PROPOSE MODE — inserting pending proposals ***');
    console.log('    (Migration 056 must be applied first)');

    // Insert a parent run row per venue (simplified — full RPC contract per §2)
    for (const venueResult of report.venues) {
      if (venueResult.proposals.length === 0) continue;

      // Insert parent venue_enrichment_runs row
      const { data: runData, error: runError } = await supabase
        .from('venue_enrichment_runs')
        .insert({
          venue_id: venueResult.venueId,
          run_label: runLabel,
          source_website: venueResult.website,
          outcome: venueResult.outcome,
          pages: venueResult.pages,
          error_note: venueResult.note ?? null,
        })
        .select('id')
        .single();

      if (runError || !runData) {
        console.warn(`  [run insert] failed for venue ${venueResult.venueId}: ${runError?.message ?? 'no data'}`);
        continue;
      }

      const runId = (runData as { id: string }).id;

      // Insert each proposal via propose_field RPC
      for (const proposal of venueResult.proposals) {
        await writeProposeRpc(runId, venueResult.venueId, proposal);
      }

      console.log(`  [proposed] ${venueResult.name}: ${venueResult.proposals.length} proposal(s)`);
    }

    console.log('\n*** PROPOSE COMPLETE ***');
  } else {
    console.log('\n=== DRY RUN COMPLETE (no DB writes) ===');
  }
}

main().catch((err: unknown) => {
  console.error('FATAL:', err);
  process.exit(1);
});
