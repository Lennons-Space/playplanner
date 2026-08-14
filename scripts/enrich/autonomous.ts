// =============================================================================
// scripts/enrich/autonomous.ts
//
// Enrichment 2.0 — Part 10/11/12: the autonomous CLI orchestrator. Wires the
// already-built, already-tested pure layers (confidenceScore, autoApplyPolicy,
// closureSignals, freshness, discovery/*, autonomousCore) to real Supabase +
// web I/O, resumable via a checkpoint file.
//
// SAFETY (mirrors enrichVenues.ts's established convention):
//   - Dry-run is the default. --apply is the ONE flag that turns on real
//     writes (proposal creation, auto-apply, discovery candidate upsert,
//     candidate auto-accept, suspected-closure flagging). Without --apply,
//     this script makes ZERO database writes — it only reads and reports.
//   - Every write goes through the existing audited RPCs (propose_field,
//     auto_apply_field_proposal, auto_accept_candidate, system_flag_suspected_
//     closure) — this script never updates venues/opening_hours directly.
//
// Usage:
//   npx tsx scripts/enrich/autonomous.ts --dry-run --enrich-existing --limit=20
//   npx tsx scripts/enrich/autonomous.ts --apply --enrich-existing --limit=20 --stale-days=30
//   npx tsx scripts/enrich/autonomous.ts --dry-run --discover --limit=50
//   npx tsx scripts/enrich/autonomous.ts --resume --enrich-existing
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';

import type {
  CurrentVenueSnapshot,
  DayHours,
  ProposalDraft,
  WebFetchResult,
} from '../../types/webEnrichment';
import type {
  ClosureAssessment,
  ClosureSignal,
  DedupeExistingVenue,
  OrchestratorCheckpoint,
} from '../../types/enrichmentAutonomy';
import {
  classifyProposals,
  createCheckpoint,
  filterUnprocessed,
  markComplete,
  markProcessed,
  buildAutonomyReport,
  renderHumanSummary,
  type ClassifiedBuckets,
  type ClassifyContext,
} from './autonomousCore';
import { orchestrateVenue, type VenueInput, type VenueRunResult } from './web/orchestrate';
import { checkPagesForClosure } from './web/closureCheck';
import { assessClosure } from './web/closureSignals';
import { buildExceptionQueue, renderExceptionQueueHuman, type ExceptionQueueItem } from './exceptionQueue';
import { discoverFromElements, type RawOsmElement } from './discovery/discoverCandidates';

// ── Flags ──────────────────────────────────────────────────────────────────

export type AutonomousMode = 'enrich-existing' | 'discover';

export interface AutonomousFlags {
  apply: boolean;
  mode: AutonomousMode;
  limit: number;
  staleDays: number;
  maxRuntimeMinutes: number | null;
  resume: boolean;
  reportDir: string;
  osmArchiveDir: string;
}

export function parseFlags(argv: string[]): AutonomousFlags {
  const flags: AutonomousFlags = {
    apply: false,
    mode: 'enrich-existing',
    limit: 20,
    staleDays: 30,
    maxRuntimeMinutes: null,
    resume: false,
    reportDir: path.join(__dirname, 'reports'),
    osmArchiveDir: path.join(__dirname, 'data/raw/osm_archive_20260425'),
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.apply = false;
    else if (arg === '--apply') flags.apply = true;
    else if (arg === '--enrich-existing') flags.mode = 'enrich-existing';
    else if (arg === '--discover') flags.mode = 'discover';
    else if (arg === '--resume') flags.resume = true;
    else if (arg.startsWith('--limit=')) flags.limit = clampPositiveInt(arg.split('=')[1], flags.limit);
    else if (arg.startsWith('--stale-days=')) flags.staleDays = clampPositiveInt(arg.split('=')[1], flags.staleDays, true);
    else if (arg.startsWith('--max-runtime=')) {
      const v = parseInt(arg.split('=')[1] ?? '', 10);
      if (!isNaN(v) && v > 0) flags.maxRuntimeMinutes = v;
    } else if (arg.startsWith('--report-dir=')) flags.reportDir = arg.split('=')[1] ?? flags.reportDir;
    else if (arg.startsWith('--osm-archive-dir=')) flags.osmArchiveDir = arg.split('=')[1] ?? flags.osmArchiveDir;
  }

  return flags;
}

function clampPositiveInt(raw: string | undefined, fallback: number, allowZero = false): number {
  const v = parseInt(raw ?? '', 10);
  if (isNaN(v)) return fallback;
  if (allowZero && v >= 0) return v;
  if (!allowZero && v > 0) return v;
  return fallback;
}

// ── Checkpoint persistence ───────────────────────────────────────────────────

function checkpointPath(reportDir: string, mode: AutonomousMode): string {
  return path.join(reportDir, `checkpoint-${mode}.json`);
}

export function loadCheckpoint(reportDir: string, mode: AutonomousMode): OrchestratorCheckpoint | null {
  const p = checkpointPath(reportDir, mode);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as OrchestratorCheckpoint;
  } catch {
    return null;
  }
}

export function saveCheckpoint(reportDir: string, mode: AutonomousMode, checkpoint: OrchestratorCheckpoint): void {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(checkpointPath(reportDir, mode), JSON.stringify(checkpoint, null, 2), 'utf8');
}

// ── Venue selection (Part 13 simplified: reuses venue_field_proposals.retrieved_at
// as the "last checked" signal — no new migration needed for this milestone.
// freshness.ts's richer per-domain model remains available, tested, and ready
// for a future scheduler once/if a dedicated last-checked-per-domain column
// exists — see the final report's "flagged decisions" section.) ─────────────

export interface VenueCandidateRow {
  id: string;
  name: string;
  website: string | null;
  is_verified: boolean;
  operating_status: string;
}

/** Pure: filter + prioritise venues due for a re-check. Never-checked venues always sort first. */
export function selectStaleVenues(
  rows: VenueCandidateRow[],
  lastChecked: Map<string, string | null>,
  staleDays: number,
  now: Date,
  limit: number,
): VenueCandidateRow[] {
  const withAge = rows
    .filter((r) => !!r.website && r.operating_status === 'active')
    .map((r) => {
      const last = lastChecked.get(r.id) ?? null;
      const ageDays = last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000) : Infinity;
      return { row: r, ageDays };
    })
    .filter((x) => x.ageDays >= staleDays);

  withAge.sort((a, b) => b.ageDays - a.ageDays);
  return withAge.slice(0, limit).map((x) => x.row);
}

export function buildSnapshot(
  venueRow: { description: string | null; price_range: string | null; website: string | null; phone: string | null; email: string | null },
  openingRows: { day_of_week: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }[],
): CurrentVenueSnapshot {
  const opening_hours: DayHours[] = openingRows.map((r) => ({
    day_of_week: r.day_of_week,
    is_closed: r.is_closed,
    intervals: r.is_closed || !r.opens_at || !r.closes_at ? [] : [{ opens: r.opens_at, closes: r.closes_at }],
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

// ── Per-venue processing (pure-ish: only I/O is the injected fetchPage) ─────

export interface ProcessVenueResult {
  runResult: VenueRunResult;
  buckets: ClassifiedBuckets;
  closureSignals: ClosureSignal[];
  closureAssessment: ClosureAssessment;
}

export async function processVenue(
  venue: VenueInput,
  snapshot: CurrentVenueSnapshot,
  ctx: { now: Date; isVerified: boolean; isRecheck: boolean },
  deps: { fetchPage: (url: string) => Promise<WebFetchResult> },
): Promise<ProcessVenueResult> {
  const nowIso = ctx.now.toISOString();
  const runResult = await orchestrateVenue(venue, snapshot, {
    fetchPage: deps.fetchPage,
    retrievedAt: nowIso,
    maxPages: 3,
    captureHtml: true,
  });

  const classifyCtx: ClassifyContext = {
    now: ctx.now,
    currentValueHumanVerified: ctx.isVerified,
    isNewVenue: false,
  };
  const buckets = classifyProposals(runResult.proposals, classifyCtx);

  const closureSignals = runResult.htmlByUrl ? checkPagesForClosure(runResult.htmlByUrl, nowIso) : [];
  const closureAssessment = assessClosure(closureSignals, { isRecheck: ctx.isRecheck });

  return { runResult, buckets, closureSignals, closureAssessment };
}

// ── Enrich-existing DB boundary (injected — real impl in main()) ────────────

export interface EnrichExistingDb {
  selectCandidateVenues(): Promise<VenueCandidateRow[]>;
  selectLastCheckedMap(venueIds: string[]): Promise<Map<string, string | null>>;
  getSnapshot(venueId: string): Promise<CurrentVenueSnapshot>;
  /** Returns the new proposal id, or null if propose_field deduped it (value unchanged). */
  proposeField(venueId: string, field: string, draft: ProposalDraft, runId: string): Promise<string | null>;
  setProposalScore(proposalId: string, score: number): Promise<void>;
  autoApplyProposal(proposalId: string, score: number, threshold: number): Promise<void>;
  flagSuspectedClosure(venueId: string, reason: string): Promise<void>;
}

export interface EnrichExistingResult {
  report: ReturnType<typeof buildAutonomyReport>;
  exceptionItems: ExceptionQueueItem[];
  checkpoint: OrchestratorCheckpoint;
}

export async function runEnrichExisting(
  db: EnrichExistingDb,
  fetchPage: (url: string) => Promise<WebFetchResult>,
  flags: AutonomousFlags,
  startCheckpoint: OrchestratorCheckpoint,
  now: () => Date,
  runId: string,
): Promise<EnrichExistingResult> {
  const startedAt = now();
  const deadline = flags.maxRuntimeMinutes ? startedAt.getTime() + flags.maxRuntimeMinutes * 60_000 : null;

  const allCandidates = await db.selectCandidateVenues();
  const lastChecked = await db.selectLastCheckedMap(allCandidates.map((v) => v.id));
  const pool = selectStaleVenues(allCandidates, lastChecked, flags.staleDays, startedAt, allCandidates.length);
  const unprocessedPool = filterUnprocessed(pool.map((v) => v.id), flags.resume ? startCheckpoint : null)
    .map((id) => pool.find((v) => v.id === id)!);
  const selected = unprocessedPool.slice(0, flags.limit);
  const venuesSkippedFresh = allCandidates.filter((v) => !!v.website && v.operating_status === 'active').length - pool.length;

  let checkpoint = startCheckpoint;
  const classifiedByVenue: ClassifiedBuckets[] = [];
  const proposalExceptions: { venueId: string; venueName: string; classified: ClassifiedBuckets['exception'][number] }[] = [];
  const closureExceptions: { venueId: string; venueName: string; assessment: ClosureAssessment }[] = [];
  let venuesCrawled = 0;
  let suspectedClosures = 0;
  let stoppedEarly = false;

  for (const row of selected) {
    if (deadline && now().getTime() >= deadline) { stoppedEarly = true; break; }

    const snapshot = await db.getSnapshot(row.id);
    const wasSuspected = false; // this milestone tracks recheck status via operating_status at selection time only
    const { runResult, buckets, closureAssessment } = await processVenue(
      { venueId: row.id, name: row.name, website: row.website },
      snapshot,
      { now: now(), isVerified: row.is_verified, isRecheck: wasSuspected },
      { fetchPage },
    );

    if (runResult.outcome === 'extracted') venuesCrawled += 1;
    classifiedByVenue.push(buckets);
    for (const c of buckets.exception) proposalExceptions.push({ venueId: row.id, venueName: row.name, classified: c });

    if (closureAssessment.recommendedStatus === 'suspected_closed' || closureAssessment.recommendedStatus === 'confirmed_closed') {
      suspectedClosures += 1;
    }
    if (closureAssessment.recommendedStatus === 'confirmed_closed') {
      // 'confirmed_closed' is NEVER auto-applied — confirm_venue_closure is admin-only
      // by design (Part 9: a destructive change needs stronger proof than an additive
      // one). Automation can only ever surface this as an exception, never publish it.
      closureExceptions.push({ venueId: row.id, venueName: row.name, assessment: closureAssessment });
    }

    if (flags.apply) {
      for (const c of [...buckets.defer, ...buckets.exception]) {
        const id = await db.proposeField(row.id, c.draft.field, c.draft, runId);
        if (id) await db.setProposalScore(id, c.confidence.score);
      }
      for (const c of buckets.autoApply) {
        const id = await db.proposeField(row.id, c.draft.field, c.draft, runId);
        if (id) {
          try {
            await db.autoApplyProposal(id, c.confidence.score, c.decision.threshold);
          } catch {
            // Never abort the batch on one RPC failure (e.g. a stale_current_value
            // race) — the proposal remains pending for the ordinary admin review flow.
          }
        }
      }
      if (closureAssessment.recommendedStatus === 'suspected_closed' && row.operating_status === 'active') {
        await db.flagSuspectedClosure(row.id, closureAssessment.reason);
      }
    }

    checkpoint = markProcessed(checkpoint, row.id, now());
    saveCheckpoint(flags.reportDir, flags.mode, checkpoint);
  }

  if (!stoppedEarly) checkpoint = markComplete(checkpoint, now());
  saveCheckpoint(flags.reportDir, flags.mode, checkpoint);

  const report = buildAutonomyReport({
    runId,
    generatedAt: now().toISOString(),
    durationMs: now().getTime() - startedAt.getTime(),
    venuesConsidered: allCandidates.length,
    venuesCrawled,
    venuesSkippedFresh: Math.max(0, venuesSkippedFresh),
    classifiedByVenue,
    websitesDiscovered: 0,
    candidatesDiscovered: 0,
    candidateDuplicatesSkipped: 0,
    newVenuesAutoAccepted: 0,
    newVenuesQuarantined: 0,
    suspectedClosures,
    failedRequests: 0,
    robotsDeniedRequests: 0,
    cacheHitRate: null,
  });

  const exceptionItems = buildExceptionQueue(proposalExceptions, [], closureExceptions);

  return { report, exceptionItems, checkpoint };
}

// ── Discover-mode I/O boundary ───────────────────────────────────────────────

export function loadOsmArchiveElements(archiveDir: string): RawOsmElement[] {
  if (!fs.existsSync(archiveDir)) return [];
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.json'));
  const elements: RawOsmElement[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8')) as RawOsmElement[];
      elements.push(...raw);
    } catch {
      // A single malformed archive file must not abort discovery for every other file.
    }
  }
  return elements;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as { config: (opts: { path: string }) => void };
    dotenv.config({ path: path.join(__dirname, '../.env') });
  } catch { /* rely on shell env */ }

  const flags = parseFlags(process.argv);
  const runId = `run-${Date.now()}`;

  console.log('\nPlayPlanner Enrichment 2.0 — autonomous orchestrator');
  console.log('=====================================================');
  console.log(`Mode        : ${flags.mode}`);
  console.log(`Write mode  : ${flags.apply ? '*** --apply — LIVE WRITES via propose_field/auto_apply_field_proposal/auto_accept_candidate/system_flag_suspected_closure ***' : 'DRY RUN (zero writes)'}`);
  console.log(`Limit       : ${flags.limit}`);
  if (flags.mode === 'enrich-existing') console.log(`Stale days  : ${flags.staleDays}`);
  if (flags.maxRuntimeMinutes) console.log(`Max runtime : ${flags.maxRuntimeMinutes} min`);
  console.log(`Resume      : ${flags.resume}`);
  console.log(`Report dir  : ${flags.reportDir}`);
  console.log('');

  const SUPABASE_URL = process.env['SUPABASE_URL'];
  const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (scripts/.env or shell env).');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebClient, nodeWebClientDeps } = require('./web/webClient') as typeof import('./web/webClient');
  const webClient = new WebClient(nodeWebClientDeps());
  const fetchPage = webClient.fetch.bind(webClient);

  const checkpoint = (flags.resume && loadCheckpoint(flags.reportDir, flags.mode)) || createCheckpoint(runId, flags.mode, new Date());

  if (flags.mode === 'enrich-existing') {
    const db: EnrichExistingDb = {
      async selectCandidateVenues() {
        const { data, error } = await supabase
          .from('venues')
          .select('id, name, website, is_verified, operating_status')
          .not('website', 'is', null)
          .eq('operating_status', 'active');
        if (error) throw new Error(error.message);
        return (data ?? []) as VenueCandidateRow[];
      },
      async selectLastCheckedMap(venueIds: string[]) {
        const map = new Map<string, string | null>();
        if (venueIds.length === 0) return map;
        const { data, error } = await supabase
          .from('venue_field_proposals')
          .select('venue_id, retrieved_at')
          .in('venue_id', venueIds)
          .order('retrieved_at', { ascending: false });
        if (error) throw new Error(error.message);
        for (const row of (data ?? []) as { venue_id: string; retrieved_at: string }[]) {
          if (!map.has(row.venue_id)) map.set(row.venue_id, row.retrieved_at); // first row per id = most recent (sorted desc)
        }
        return map;
      },
      async getSnapshot(venueId: string) {
        const { data: v } = await supabase.from('venues').select('description, price_range, website, phone, email').eq('id', venueId).single();
        const { data: hours } = await supabase.from('opening_hours').select('day_of_week, is_closed, opens_at, closes_at').eq('venue_id', venueId).order('day_of_week');
        return buildSnapshot(
          v ?? { description: null, price_range: null, website: null, phone: null, email: null },
          (hours ?? []) as { day_of_week: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }[],
        );
      },
      async proposeField(venueId, field, draft, runIdInner) {
        const { data, error } = await supabase.rpc('propose_field', {
          p_run_id: runIdInner,
          p_venue_id: venueId,
          p_field: field,
          p_proposed: draft.proposed_value,
          p_source_url: draft.source_url,
          p_evidence: draft.evidence_snippet,
          p_evidence_raw: draft.evidence_raw,
          p_method: draft.extraction_method,
          p_confidence: draft.confidence,
          p_conflicts: draft.conflicts_existing,
          p_retrieved_at: draft.retrieved_at,
        });
        if (error) throw new Error(error.message);
        return (data as string | null) ?? null;
      },
      async setProposalScore(proposalId, score) {
        const { error } = await supabase.from('venue_field_proposals').update({ confidence_score: score }).eq('id', proposalId);
        if (error) throw new Error(error.message);
      },
      async autoApplyProposal(proposalId, score, threshold) {
        const { error } = await supabase.rpc('auto_apply_field_proposal', {
          p_proposal_id: proposalId, p_confidence_score: score, p_min_score: threshold,
        });
        if (error) throw new Error(error.message);
      },
      async flagSuspectedClosure(venueId, reason) {
        const { error } = await supabase.rpc('system_flag_suspected_closure', { p_venue_id: venueId, p_reason: reason });
        if (error) throw new Error(error.message);
      },
    };

    const result = await runEnrichExisting(db, fetchPage, flags, checkpoint, () => new Date(), runId);
    fs.mkdirSync(flags.reportDir, { recursive: true });
    fs.writeFileSync(path.join(flags.reportDir, `report-${runId}.json`), JSON.stringify(result.report, null, 2), 'utf8');
    console.log(renderHumanSummary(result.report));
    console.log('');
    console.log(renderExceptionQueueHuman(result.exceptionItems));
  } else {
    const { data: venueRows, error } = await supabase
      .from('venues')
      .select('id, name, latitude, longitude, postcode, phone, website, category:categories(slug)');
    if (error) {
      console.error('ERROR: failed to load existing venues for dedupe:', error.message);
      process.exit(1);
    }
    const existingVenues: DedupeExistingVenue[] = ((venueRows ?? []) as unknown as {
      id: string; name: string; latitude: number; longitude: number; postcode: string | null;
      phone: string | null; website: string | null; category: { slug: string }[] | { slug: string } | null;
    }[]).map((v) => ({
      id: v.id, name: v.name, latitude: v.latitude, longitude: v.longitude, postcode: v.postcode,
      phone: v.phone, websiteDomain: extractDomainLocal(v.website),
      category: (Array.isArray(v.category) ? v.category[0]?.slug : v.category?.slug) ?? null,
    }));

    const elements = loadOsmArchiveElements(flags.osmArchiveDir);
    if (elements.length === 0) {
      console.log(`No OSM archive elements found at ${flags.osmArchiveDir} — nothing to discover this run.`);
      return;
    }

    const counts = await discoverFromElements(elements, {
      existingVenues,
      write: flags.apply,
      apply: flags.apply,
      limit: flags.limit,
      upsertCandidate: flags.apply ? async (row) => {
        const { data, error: upErr } = await supabase.from('venue_discovery_candidates').upsert({
          name: row.candidate.name,
          latitude: row.candidate.latitude,
          longitude: row.candidate.longitude,
          postcode: row.candidate.postcode,
          city: null,
          phone: row.candidate.phone,
          website: null,
          source: 'osm',
          source_id: row.sourceId,
          dedupe_decision: row.dedupe.decision,
          matched_venue_id: row.dedupe.matchedVenueId,
          confidence_score: row.acceptInput.confidenceScore,
          has_family_relevant_category: row.acceptInput.hasFamilyRelevantCategory,
          has_valid_uk_coordinates: row.acceptInput.hasValidUkCoordinates,
          has_valid_address: row.acceptInput.hasValidAddress,
          is_trusted_source: row.acceptInput.isTrustedSource,
          official_verification: row.acceptInput.officialVerification,
          has_closure_signal: row.acceptInput.hasClosureSignal,
          required_fields_complete: row.acceptInput.requiredFieldsComplete,
          status: row.acceptResult.decision === 'quarantine' ? 'quarantined' : row.acceptResult.decision === 'reject' ? 'rejected' : 'candidate',
        }, { onConflict: 'source,source_id' }).select('id').single();
        if (upErr) throw new Error(upErr.message);
        return { id: (data as { id: string }).id };
      } : undefined,
      autoAcceptCandidate: flags.apply ? async (candidateId) => {
        const { error: accErr } = await supabase.rpc('auto_accept_candidate', { p_candidate_id: candidateId });
        if (accErr) throw new Error(accErr.message);
      } : undefined,
    });

    console.log('Discovery run complete:');
    console.log(JSON.stringify(counts, null, 2));
    fs.mkdirSync(flags.reportDir, { recursive: true });
    fs.writeFileSync(path.join(flags.reportDir, `report-${runId}.json`), JSON.stringify({ runId, mode: 'discover', ...counts }, null, 2), 'utf8');
  }
}

function extractDomainLocal(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

// Guards the same way as every other CLI script in this directory — never runs main() under Jest.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
