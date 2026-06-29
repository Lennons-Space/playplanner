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
import type { FieldDecision } from '../../types/enrichmentDecision';
import { DECISION_ENGINE_VERSION } from '../../types/enrichmentDecision';
import { WebClient, nodeWebClientDeps } from './web/webClient';
import { runEnrichment, type VenueInput } from './web/orchestrate';
import { renderRunJson, renderRunCsv, renderRunHtml, renderDecisionsCsv } from './web/report';
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
  /** --auto-apply-safe: store auto_apply rows as decision='auto_apply'.
   *  Without this, auto_apply is downgraded to manual_review for safety.
   *  The script NEVER calls apply/rollback RPCs — apply is in-app admin only. */
  autoApplySafe: boolean;
  limit: number;
  limitProvided: boolean;
  venueId: string | null;
  reportBase: string;
  maxPages: number;
  perDomainDelayMs: number;
  refresh: boolean;
  cacheOnly: boolean;
  /** Maximum propose_field writes per run (0 = unlimited up to PROPOSE_LIMIT_CAP). */
  maxWrites: number;
  /** Abort after this many consecutive write errors (0 = never abort). */
  stopOnErrorThreshold: number;
}

function parseFlags(argv: string[]): ScriptFlags {
  const flags: ScriptFlags = {
    propose: false,
    autoApplySafe: false,
    limit: 20,
    limitProvided: false,
    venueId: null,
    reportBase: path.join(__dirname, 'out', 'run'),
    maxPages: 3,
    perDomainDelayMs: 3000,
    refresh: false,
    cacheOnly: false,
    maxWrites: 0,
    stopOnErrorThreshold: 0,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--propose' || arg === '--proposal-only') {
      flags.propose = true;
    } else if (arg === '--auto-apply-safe') {
      flags.autoApplySafe = true;
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
    } else if (arg.startsWith('--max-writes=')) {
      const val = parseInt(arg.slice('--max-writes='.length), 10);
      if (!isNaN(val) && val >= 0) flags.maxWrites = val;
    } else if (arg.startsWith('--stop-on-error=')) {
      const val = parseInt(arg.slice('--stop-on-error='.length), 10);
      if (!isNaN(val) && val >= 0) flags.stopOnErrorThreshold = val;
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

  // --auto-apply-safe requires --propose to be meaningful.
  if (flags.autoApplySafe) {
    console.log(
      'INFO: --auto-apply-safe active — auto_apply rows will be stored with decision=auto_apply.\n' +
      '      The script NEVER calls apply/rollback RPCs. Apply is in-app admin only.',
    );
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
  /** City/town for description composition. May be null if the DB column differs. */
  city: string | null;
  /** Category slug resolved from the categories table (used for description composition). */
  category_slug?: string | null;
}

// 'city' supplies the description composer with a verified location fact.
const VENUE_SELECT = 'id, name, website, description, price_range, phone, email, category_id, city';

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

  // Preserve the slug as category_slug for the description composer.
  return selected.map(({ slug, ...row }) => ({ ...row, category_slug: slug ?? null }));
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
 *
 * Persists a FieldDecision via the extended propose_field RPC (§6b).
 * Passes p_decision / p_decision_reasons / p_decision_engine_version.
 *
 * Safety invariants:
 *  - This function NEVER calls apply, auto_apply, or rollback RPCs.
 *  - Apply is in-app admin only (authenticated + is_admin()).
 *  - Service_role fails is_admin() by design (no profiles row).
 *  - auto_apply decisions are downgraded to manual_review unless --auto-apply-safe.
 *  - PII (proposed value) is never logged — only field + error code.
 *
 * Throws on RPC error so the caller can apply stop-on-error logic.
 * Migration 057 must be applied before the extended signature is available.
 */
async function writeDecisionRpc(
  runId: string,
  venueId: string,
  venueWebsite: string | null,
  decision: FieldDecision,
  autoApplySafe: boolean,
): Promise<void> {
  // Without --auto-apply-safe, downgrade auto_apply to manual_review.
  // The in-app admin batch needs explicit authorisation through the UI.
  const effectiveDecision =
    decision.decision === 'auto_apply' && !autoApplySafe ? 'manual_review' : decision.decision;

  let proposedValue: unknown;
  let sourceUrl: string;
  let evidence: string;
  let evidenceRaw: string | null;
  let method: string;
  let confidence: string;
  let conflicts: boolean;

  if (decision.field === 'description') {
    // Description: composed from DB facts, no specific web candidate.
    if (!decision.generatedText) return; // report_only with no draft — nothing to store.
    proposedValue = { v: decision.generatedText };
    sourceUrl = venueWebsite ?? '';
    evidence = 'Composed from verified DB facts (name, category slug, city)';
    evidenceRaw = null;
    method = 'heuristic';
    confidence = 'medium';
    conflicts = false;
  } else if (decision.chosen) {
    const c = decision.chosen;
    // Opening hours: OpeningWeek is stored directly; scalars are wrapped in {v:…}.
    proposedValue = decision.field === 'opening_hours' ? c.value : { v: c.value };
    sourceUrl = c.sourceUrl;
    evidence = c.evidenceSnippet;
    evidenceRaw = c.evidenceRaw;
    method = c.method;
    confidence = c.confidence;
    conflicts = c.conflictsExisting;
  } else {
    return; // No candidate value and no generated text — nothing to persist.
  }

  const { error } = await supabase.rpc('propose_field', {
    p_run_id: runId,
    p_venue_id: venueId,
    p_field: decision.field,
    p_proposed: proposedValue,
    p_source_url: sourceUrl,
    p_evidence: evidence,
    p_evidence_raw: evidenceRaw,
    p_method: method,
    p_confidence: confidence,
    p_conflicts: conflicts,
    // Decision metadata — requires the extended propose_field from §6b.
    p_decision: effectiveDecision,
    p_decision_reasons: decision.reasons,
    p_decision_engine_version: DECISION_ENGINE_VERSION,
  });

  if (error) {
    // Log only field + error code — never the proposed value (may contain PII).
    console.warn(`  [propose_field] failed for field=${decision.field}: ${error.message}`);
    throw error; // Re-throw so the caller can track stop-on-error.
  }
}

// ── Write report files ────────────────────────────────────────────────────────

function writeReports(
  reportBase: string,
  jsonContent: string,
  csvContent: string,
  decisionsContent: string,
  htmlContent: string,
): void {
  const dir = path.dirname(reportBase);
  fs.mkdirSync(dir, { recursive: true });

  const jsonPath = `${reportBase}.json`;
  const csvPath = `${reportBase}.csv`;
  const decisionsPath = `${reportBase}.decisions.csv`;
  const htmlPath = `${reportBase}.html`;

  fs.writeFileSync(jsonPath, jsonContent, 'utf8');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  fs.writeFileSync(decisionsPath, decisionsContent, 'utf8');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  console.log(`\nReports written:`);
  console.log(`  JSON:      ${jsonPath}`);
  console.log(`  CSV:       ${csvPath}`);
  console.log(`  Decisions: ${decisionsPath}`);
  console.log(`  HTML:      ${htmlPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);

  console.log('\nPlayPlanner Website Enrichment Engine — Build Step 4');
  console.log('=====================================================');
  const modeLabel = !flags.propose
    ? 'DRY RUN (no DB writes)'
    : flags.autoApplySafe
      ? '*** PROPOSE + AUTO-APPLY-SAFE (marks auto_apply rows) ***'
      : '*** PROPOSE — will persist decisions (auto_apply downgraded to manual_review) ***';
  console.log(`Mode      : ${modeLabel}`);
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
    // category_slug is resolved by fetchPilotVenues (stratified path only).
    // Single-venue and pilot-ids paths leave it null → description routes to
    // report_only (safe conservative default).
    categorySlug: v.category_slug ?? null,
    city: v.city ?? null,
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
  const decisionsContent = renderDecisionsCsv(report);
  const htmlContent = renderRunHtml(report);
  writeReports(flags.reportBase, jsonContent, csvContent, decisionsContent, htmlContent);

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

  // Print batch decision summary.
  const { batchSummary } = report;
  console.log('\n=== BATCH DECISION SUMMARY ===');
  console.log(`Safe changes ready (auto_apply) : ${batchSummary.safeChangesReady}`);
  console.log(`Exceptions (manual_review)       : ${batchSummary.exceptions}`);
  console.log(`Suppressed (reject/report_only)  : ${batchSummary.suppressed}`);
  console.log(`Failures (fetch/skip)            : ${batchSummary.failures}`);
  if (batchSummary.fieldsAffected.length > 0) {
    console.log(`Fields affected                  : ${batchSummary.fieldsAffected.join(', ')}`);
  }
  if (batchSummary.wouldReplaceNonEmpty) {
    console.error('CRITICAL: wouldReplaceNonEmpty=true — auto_apply would overwrite a non-empty field.');
    console.error('          This is a policy violation. Aborting propose path.');
    process.exit(1);
  }

  // ── GATED PROPOSE PATH ────────────────────────────────────────────────────
  // This block is only reached when --propose is explicitly passed.
  // In dry-run mode (the default), execution ends above this block.
  // Migrations 056 + 057 must be applied before --propose can succeed.
  // The script NEVER calls apply/rollback RPCs — those are in-app admin only.
  if (flags.propose) {
    console.log('\n*** PROPOSE MODE — persisting decisions via propose_field RPC ***');
    console.log('    (Migrations 056 + 057 must be applied first)');
    if (!flags.autoApplySafe) {
      console.log('    (auto_apply decisions downgraded to manual_review — use --auto-apply-safe to enable)');
    }

    let totalWrites = 0;
    let consecutiveErrors = 0;
    const maxWrites = flags.maxWrites > 0 ? flags.maxWrites : Infinity;
    const errorThreshold = flags.stopOnErrorThreshold > 0 ? flags.stopOnErrorThreshold : Infinity;

    outer: for (const venueResult of report.venues) {
      if (venueResult.decisions.length === 0) continue;

      // Insert parent venue_enrichment_runs row.
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
        consecutiveErrors++;
        if (consecutiveErrors >= errorThreshold) {
          console.error(`  Consecutive error threshold (${flags.stopOnErrorThreshold}) reached — aborting.`);
          break outer;
        }
        continue;
      }

      const runId = (runData as { id: string }).id;
      consecutiveErrors = 0;
      let venueWrites = 0;

      // Persist each decision via the extended propose_field RPC.
      for (const decision of venueResult.decisions) {
        if (totalWrites >= maxWrites) {
          console.log(`  --max-writes=${flags.maxWrites} reached — stopping.`);
          break outer;
        }
        try {
          await writeDecisionRpc(
            runId,
            venueResult.venueId,
            venueResult.website,
            decision,
            flags.autoApplySafe,
          );
          totalWrites++;
          venueWrites++;
          consecutiveErrors = 0;
        } catch {
          consecutiveErrors++;
          if (consecutiveErrors >= errorThreshold) {
            console.error(`  Consecutive error threshold (${flags.stopOnErrorThreshold}) reached — aborting.`);
            break outer;
          }
        }
      }

      console.log(`  [proposed] ${venueResult.name}: ${venueWrites} decision(s) persisted`);
    }

    console.log(`\n*** PROPOSE COMPLETE — ${totalWrites} total writes ***`);
  } else {
    console.log('\n=== DRY RUN COMPLETE (no DB writes) ===');
  }
}

main().catch((err: unknown) => {
  console.error('FATAL:', err);
  process.exit(1);
});
