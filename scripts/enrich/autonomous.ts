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
//     auto_apply_field_proposal, queue_candidate_for_review, system_flag_suspected_
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
  emptyRichFactsSummary,
  renderHumanSummary,
  type ClassifiedBuckets,
  type ClassifyContext,
} from './autonomousCore';
import { orchestrateVenue, type VenueInput, type VenueRunResult } from './web/orchestrate';
import { checkPagesForClosure } from './web/closureCheck';
import { extractVenueFacts, type VenueFact, type VenueFactCandidate } from './web/venueFacts';
import { generateDescription, isEligibleForGeneratedDescription } from './web/descriptionGenerator';
import { decideFacilitySync, OFFICIAL_ENRICHMENT_NOTES, type ExistingFacilityRow } from './facilitySync';
import { assessClosure } from './web/closureSignals';
import { buildExceptionQueue, renderExceptionQueueHuman, type ExceptionQueueItem } from './exceptionQueue';
import { discoverFromCandidates } from './discovery/discoverCandidates';
import { DEFAULT_DEDUPE_RADIUS_M, DEFAULT_DEDUPE_RESULT_LIMIT } from './discovery/spatialPrefilterPolicy';
import { createOsmArchiveProvider } from './discovery/providers/osmArchiveProvider';
import { createGeoapifyPlacesProvider, isGeoapifyDiscoveryEnabled } from './discovery/providers/geoapifyPlacesProvider';
import type { DiscoveryProvider, DiscoveryWorkUnit, NormalizedCandidate, ProviderResult } from './discovery/providers/types';
import {
  buildCellCoverage,
  buildCoveragePlanReport,
  ukGridCells,
  type CoverageGridRow,
  type CoveragePlanEntry,
} from './discovery/coveragePlanner';
import { targetedCategorySlugs } from './discovery/categoryTargets';
import { decideBookingUrl } from './web/bookingUrlPolicy';
import { corroborateOfficialSite } from './web/officialCorroboration';

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
  /** Discover mode: how many under-covered grid cells one coverage-planning pass may return (bounded per Phase F). */
  planCells: number;
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
    planCells: 20,
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
    else if (arg.startsWith('--plan-cells=')) flags.planCells = clampPositiveInt(arg.split('=')[1], flags.planCells);
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
  /** Human-readable category name (e.g. "Soft Play"), for descriptionGenerator.ts. Optional — a missing value falls back to a generic label, never invented. */
  categoryLabel?: string | null;
  /** Current booking_url (migration 060 §B). Selected with the venue row so bookingUrlPolicy needs no extra round trip. */
  booking_url?: string | null;
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
  /** Enrichment 2.1 Phase I: rich facts merged across every fetched page (first page to state a given (kind,slug) wins — same "first tier wins" rule as WebField extraction). */
  venueFacts: VenueFactCandidate[];
}

/** Merges per-page VenueFactCandidate lists the same way htmlExtract.ts's own found-Map dedupes across tiers: first occurrence (by page-fetch order — landing page first) wins for a given (kind, slug). Zero extra network cost — reuses HTML already fetched for the WebField pipeline/closure check. */
function mergeVenueFacts(htmlByUrl: Record<string, string> | undefined): VenueFactCandidate[] {
  if (!htmlByUrl) return [];
  const seen = new Set<string>();
  const out: VenueFactCandidate[] = [];
  for (const [url, html] of Object.entries(htmlByUrl)) {
    for (const c of extractVenueFacts(html, url)) {
      const key = c.fact.kind === 'facility' ? `facility:${c.fact.slug}` : c.fact.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
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
  const venueFacts = mergeVenueFacts(runResult.htmlByUrl);

  return { runResult, buckets, closureSignals, closureAssessment, venueFacts };
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

  // Enrichment 2.1 Phase K/L — rich-fact application.
  getFacilityRow(venueId: string, slug: string): Promise<ExistingFacilityRow | null>;
  publishFacility(venueId: string, slug: string): Promise<void>;
  /** Only ever called when the target venue_enrichment column is currently NULL — never overwrites an existing explicit value (see runEnrichExisting). */
  fillVenueEnrichmentIfEmpty(venueId: string, field: VenueEnrichmentFillField, value: string | number): Promise<void>;
  getVenueEnrichmentSnapshot(venueId: string): Promise<VenueEnrichmentSnapshot>;
  proposeGeneratedDescription(venueId: string, text: string, factsUsed: VenueFact[], runId: string): Promise<string | null>;
  autoApplyGeneratedDescription(proposalId: string): Promise<void>;
  /** Applies a booking_url proposal via migration 060 §F's identity-checked RPC — never 059's generic auto_apply_field_proposal, which still blocks this field. */
  autoApplyBookingUrl(proposalId: string): Promise<void>;
}

/**
 * venue_enrichment columns this pipeline may fill. The *_evidence columns are
 * EVIDENCE ONLY — nothing here ever writes venues.min_age/max_age, which are
 * admin-owned and carry no provenance flag (see migration 060 Section D).
 */
export type VenueEnrichmentFillField =
  | 'indoor_outdoor'
  | 'admission_status'
  | 'min_age_evidence'
  | 'max_age_evidence'
  | 'min_height_cm_evidence';

export type VenueEnrichmentSnapshot = Record<VenueEnrichmentFillField, string | number | null>;

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
  const facilityConflicts: { venueId: string; venueName: string; facilitySlug: string; reason: string }[] = [];
  const bookingReviews: { venueId: string; venueName: string; proposedUrl: string; reason: string }[] = [];
  const richFacts = emptyRichFactsSummary(flags.apply ? 'apply' : 'dry_run');
  let venuesCrawled = 0;
  let suspectedClosures = 0;
  let stoppedEarly = false;

  for (const row of selected) {
    if (deadline && now().getTime() >= deadline) { stoppedEarly = true; break; }

    const snapshot = await db.getSnapshot(row.id);
    const wasSuspected = false; // this milestone tracks recheck status via operating_status at selection time only
    const { runResult, buckets, closureAssessment, venueFacts } = await processVenue(
      { venueId: row.id, name: row.name, website: row.website },
      snapshot,
      { now: now(), isVerified: row.is_verified, isRecheck: wasSuspected },
      { fetchPage },
    );
    richFacts.factsExtractedTotal += venueFacts.length;

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

    // ─────────────────────────────────────────────────────────────────────
    // WRITE-GATED SECTION. Everything from here on CLASSIFIES identically in
    // dry-run and --apply; only the `if (flags.apply)` blocks perform writes.
    // That is what makes a dry-run's would-change counts real rather than
    // structurally zero (Enrichment 2.1 review fix) — and richFacts.
    // writesPerformed staying 0 is the machine-checkable proof it wrote
    // nothing. DB READS are allowed in dry-run; this script already reads.
    // ─────────────────────────────────────────────────────────────────────
    if (flags.apply) {
      for (const c of [...buckets.defer, ...buckets.exception]) {
        // booking_url is deliberately excluded: it is decided by identity
        // (bookingUrlPolicy.ts) further down, not by the generic threshold
        // path, and proposing it here as well would immediately supersede
        // that proposal with a second one.
        if (c.draft.field === 'booking_url') continue;
        const id = await db.proposeField(row.id, c.draft.field, c.draft, runId);
        if (id) await db.setProposalScore(id, c.confidence.score);
      }
      for (const c of buckets.autoApply) {
        if (c.draft.field === 'booking_url') continue;
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

    // ── Enrichment 2.1 Phase K: facility sync ────────────────────────────
    for (const c of venueFacts) {
      if (c.fact.kind !== 'facility') continue;
      const existing = await db.getFacilityRow(row.id, c.fact.slug);
      // 'official_website': these facts came from crawling the venue's OWN
      // site, so that is their real provenance (tier 1). Labelling them 'osm'
      // — as the first 2.1 pass did — mis-recorded the source in every
      // decision reason, even though both tiers happen to be trusted.
      const decision = decideFacilitySync(c.fact, existing, 'official_website');
      if (decision.action === 'publish') {
        richFacts.facilitiesAdded[c.fact.slug] = (richFacts.facilitiesAdded[c.fact.slug] ?? 0) + 1;
        if (flags.apply) {
          await db.publishFacility(row.id, c.fact.slug);
          richFacts.writesPerformed += 1;
        }
      } else if (decision.action === 'exception') {
        richFacts.facilityConflicts += 1;
        facilityConflicts.push({ venueId: row.id, venueName: row.name, facilitySlug: c.fact.slug, reason: decision.reason });
      }
    }

    // ── Enrichment 2.1 Phase J/I: venue_enrichment fills (fill-if-empty only) ──
    const indoorOutdoorFact = venueFacts.find((c): c is VenueFactCandidate & { fact: Extract<VenueFact, { kind: 'indoor_outdoor' }> } => c.fact.kind === 'indoor_outdoor');
    const admissionFact = venueFacts.find((c): c is VenueFactCandidate & { fact: Extract<VenueFact, { kind: 'admission' }> } => c.fact.kind === 'admission');
    const ageFact = venueFacts.find((c): c is VenueFactCandidate & { fact: Extract<VenueFact, { kind: 'age_range' }> } => c.fact.kind === 'age_range');
    const heightFact = venueFacts.find((c): c is VenueFactCandidate & { fact: Extract<VenueFact, { kind: 'height_restriction' }> } => c.fact.kind === 'height_restriction');
    if (indoorOutdoorFact || admissionFact || ageFact || heightFact) {
      const veSnapshot = await db.getVenueEnrichmentSnapshot(row.id);
      const fill = async (field: VenueEnrichmentFillField, value: string | number): Promise<boolean> => {
        if (veSnapshot[field] !== null && veSnapshot[field] !== undefined) return false; // never overwrite an existing explicit value
        if (flags.apply) {
          await db.fillVenueEnrichmentIfEmpty(row.id, field, value);
          richFacts.writesPerformed += 1;
        }
        return true;
      };

      if (indoorOutdoorFact && await fill('indoor_outdoor', indoorOutdoorFact.fact.value)) richFacts.indoorOutdoorAdded += 1;
      if (admissionFact && await fill('admission_status', admissionFact.fact.status)) richFacts.admissionStateAdded += 1;

      // Age/height are EVIDENCE columns (migration 060 §D). They are never
      // copied into venues.min_age/max_age — those are admin-owned and have no
      // provenance flag, so an automated write there would be
      // indistinguishable from a curator's decision.
      if (ageFact) {
        let added = false;
        if (ageFact.fact.minAge !== null && await fill('min_age_evidence', ageFact.fact.minAge)) added = true;
        if (ageFact.fact.maxAge !== null && await fill('max_age_evidence', ageFact.fact.maxAge)) added = true;
        if (added) richFacts.ageEvidenceAdded += 1;
      }
      if (heightFact && await fill('min_height_cm_evidence', heightFact.fact.minHeightCm)) richFacts.heightEvidenceAdded += 1;
    }

    // ── Enrichment 2.1 Phase D7: booking_url, decided on venue IDENTITY ──
    // EVERY bucket is searched, `ignore` included, and that is deliberate: the
    // generic buckets answer "how sure are we we extracted this correctly",
    // which for booking_url is a parsed <a href> — not a regex guess at prose —
    // and which in any case cannot answer the only question that matters here
    // ("does this link belong to THIS venue"). A booking link therefore lands
    // in `ignore` on score alone; routing it by that bucket is what left the
    // field structurally dead. Identity decides it instead (bookingUrlPolicy),
    // and the DB re-checks identity again (migration 060 §F).
    // Deduplicated by field: propose_field supersedes same-field proposals, so
    // only the best-scoring booking_url draft is ever acted on.
    const bookingDraft = [...buckets.autoApply, ...buckets.defer, ...buckets.exception, ...buckets.ignore]
      .filter((c) => c.draft.field === 'booking_url')
      .sort((a, b) => b.confidence.score - a.confidence.score)[0];
    if (bookingDraft) {
      const proposedUrl = (bookingDraft.draft.proposed_value as { v?: string } | undefined)?.v ?? null;
      const bookingDecision = decideBookingUrl({
        proposedUrl,
        venueWebsite: snapshot.website,
        currentBookingUrl: row.booking_url ?? null,
      });
      if (bookingDecision.action === 'auto_apply') {
        richFacts.bookingUrlsAutoApplied += 1;
        if (flags.apply) {
          const id = await db.proposeField(row.id, 'booking_url', bookingDraft.draft, runId);
          if (id) {
            await db.setProposalScore(id, bookingDraft.confidence.score);
            try {
              await db.autoApplyBookingUrl(id);
              richFacts.writesPerformed += 1;
            } catch {
              // The RPC re-checks identity/staleness itself and is the trust
              // boundary — a refusal just leaves the proposal pending for
              // ordinary human review, exactly like every other apply path.
            }
          }
        }
      } else if (bookingDecision.action === 'exception') {
        richFacts.bookingUrlsExceptioned += 1;
        bookingReviews.push({ venueId: row.id, venueName: row.name, proposedUrl: proposedUrl ?? '', reason: bookingDecision.reason });
        if (flags.apply) {
          // Still recorded as a pending proposal so the human review has a
          // real row to act on — but never auto-applied.
          const id = await db.proposeField(row.id, 'booking_url', bookingDraft.draft, runId);
          if (id) await db.setProposalScore(id, bookingDraft.confidence.score);
        }
      }
    }

    // ── Enrichment 2.1 Phase L: deterministic description generation ──────
    if (isEligibleForGeneratedDescription(snapshot.description, row.name)) {
      const generated = generateDescription({ venueName: row.name, categoryLabel: row.categoryLabel ?? null, city: null, facts: venueFacts.map((c) => c.fact) });
      if (generated) {
        richFacts.descriptionsGenerated += 1;
        if (flags.apply) {
          const id = await db.proposeGeneratedDescription(row.id, generated.text, generated.factsUsed, runId);
          if (id) {
            try {
              await db.autoApplyGeneratedDescription(id);
              richFacts.writesPerformed += 1;
            } catch {
              // Same tolerance as every other auto-apply path — a rejected
              // synthesis (e.g. a real description was added moments ago)
              // just leaves the proposal pending for ordinary review.
            }
          }
        }
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
    richFacts,
  });

  const exceptionItems = buildExceptionQueue(proposalExceptions, [], closureExceptions, facilityConflicts, bookingReviews);

  return { report, exceptionItems, checkpoint };
}

// ── Discover-mode I/O boundary ───────────────────────────────────────────────
// loadOsmArchiveElements moved to discovery/providers/osmArchiveProvider.ts
// (Phase E) — re-exported here so existing call sites/tests keep working.
export { loadOsmArchiveElements } from './discovery/providers/osmArchiveProvider';

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
  console.log(`Write mode  : ${flags.apply ? '*** --apply — LIVE WRITES via propose_field/auto_apply_field_proposal/queue_candidate_for_review/system_flag_suspected_closure. Discovery persists and QUARANTINES candidates; it cannot publish a venue — that needs an admin calling resolve_discovery_candidate ***' : 'DRY RUN (zero writes)'}`);
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
          .select('id, name, website, booking_url, is_verified, operating_status, category:categories(name)')
          .not('website', 'is', null)
          .eq('operating_status', 'active');
        if (error) throw new Error(error.message);
        return ((data ?? []) as unknown as { id: string; name: string; website: string | null; booking_url: string | null; is_verified: boolean; operating_status: string; category: { name: string }[] | { name: string } | null }[])
          .map((v) => ({
            id: v.id, name: v.name, website: v.website, is_verified: v.is_verified, operating_status: v.operating_status,
            booking_url: v.booking_url ?? null,
            categoryLabel: (Array.isArray(v.category) ? v.category[0]?.name : v.category?.name) ?? null,
          }));
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

      // Enrichment 2.1 Phase K/L.
      async getFacilityRow(venueId, slug) {
        const { data: facility } = await supabase.from('facilities').select('id').eq('slug', slug).single();
        if (!facility) return null; // slug doesn't exist in this environment's facilities table — nothing to check against
        const { data } = await supabase.from('venue_facilities').select('notes').eq('venue_id', venueId).eq('facility_id', (facility as { id: string }).id).maybeSingle();
        return data ? { notes: (data as { notes: string | null }).notes } : null;
      },
      async publishFacility(venueId, slug) {
        const { data: facility, error: facErr } = await supabase.from('facilities').select('id').eq('slug', slug).single();
        if (facErr || !facility) return; // slug doesn't exist here — nothing to publish to (documented gap, see facilitySync.ts)
        const { error } = await supabase.from('venue_facilities').upsert(
          { venue_id: venueId, facility_id: (facility as { id: string }).id, notes: OFFICIAL_ENRICHMENT_NOTES },
          { onConflict: 'venue_id,facility_id', ignoreDuplicates: true },
        );
        if (error) throw new Error(error.message);
      },
      async getVenueEnrichmentSnapshot(venueId) {
        const { data } = await supabase
          .from('venue_enrichment')
          .select('indoor_outdoor, admission_status, min_age_evidence, max_age_evidence, min_height_cm_evidence')
          .eq('venue_id', venueId)
          .maybeSingle();
        const row = data as Partial<VenueEnrichmentSnapshot> | null;
        return {
          indoor_outdoor: row?.indoor_outdoor ?? null,
          admission_status: row?.admission_status ?? null,
          min_age_evidence: row?.min_age_evidence ?? null,
          max_age_evidence: row?.max_age_evidence ?? null,
          min_height_cm_evidence: row?.min_height_cm_evidence ?? null,
        };
      },
      async fillVenueEnrichmentIfEmpty(venueId, field, value) {
        // upsert so a venue with no venue_enrichment row yet gets one; the
        // caller (runEnrichExisting) already confirmed the target column is
        // currently null/absent before calling this, so a plain UPDATE-style
        // upsert is safe (never overwrites an existing explicit value).
        const { error } = await supabase.from('venue_enrichment').upsert(
          { venue_id: venueId, [field]: value },
          { onConflict: 'venue_id' },
        );
        if (error) throw new Error(error.message);
      },
      async proposeGeneratedDescription(venueId, text, factsUsed, runIdInner) {
        const { data, error } = await supabase.rpc('propose_field', {
          p_run_id: runIdInner,
          p_venue_id: venueId,
          p_field: 'description',
          p_proposed: { v: text },
          p_source_url: '',
          p_evidence: JSON.stringify(factsUsed).slice(0, 500),
          p_evidence_raw: null,
          p_method: 'heuristic',
          p_confidence: 'medium',
          p_conflicts: false,
        });
        if (error) throw new Error(error.message);
        return (data as string | null) ?? null;
      },
      async autoApplyGeneratedDescription(proposalId) {
        const { error } = await supabase.rpc('auto_apply_generated_description', { p_proposal_id: proposalId });
        if (error) throw new Error(error.message);
      },
      async autoApplyBookingUrl(proposalId) {
        // Migration 060 §F — NOT 059's auto_apply_field_proposal, which still
        // blocks booking_url. This RPC re-checks the host-identity rule
        // server-side; bookingUrlPolicy.ts is only the pre-flight filter.
        const { error } = await supabase.rpc('auto_apply_booking_url', { p_proposal_id: proposalId });
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
    // Enrichment 2.1 Phase D: production discovery no longer loads the entire
    // venues table into memory (was O(total_venues) per run regardless of how
    // many candidates were actually processed — the full-pool scan is now
    // fixture/test-only, see discoverCandidates.test.ts). Each candidate gets
    // its own small, pre-narrowed set from the dedicated spatial RPC instead.
    const lookupNearby = async (lat: number, lon: number): Promise<DedupeExistingVenue[]> => {
      const { data, error: rpcErr } = await supabase.rpc('enrichment_nearby_venues_for_dedupe', {
        p_lat: lat,
        p_lng: lon,
        p_radius_m: DEFAULT_DEDUPE_RADIUS_M,
        p_limit: DEFAULT_DEDUPE_RESULT_LIMIT,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      return ((data ?? []) as {
        id: string; name: string; latitude: number; longitude: number; postcode: string | null;
        phone: string | null; website: string | null; category_slug: string | null;
      }[]).map((v) => ({
        id: v.id, name: v.name, latitude: v.latitude, longitude: v.longitude, postcode: v.postcode,
        phone: v.phone, websiteDomain: extractDomainLocal(v.website), category: v.category_slug,
      }));
    };

    // Phase E/R: provider-wrapped fetch so a missing archive reports clearly
    // instead of silently looking like "zero venues found here" (the bug the
    // audit flagged). One provider's unavailable/failed result never aborts
    // another's (see the loop below).
    //
    // Geoapify is only constructed (and only then needs a real API key) when
    // explicitly enabled — see GEOAPIFY_2_1_COMPLIANCE.md for why it's
    // disabled by default. Checking the env flag BEFORE calling
    // geoapifyClientFromEnv() means a missing GEOAPIFY_API_KEY never breaks a
    // normal (Geoapify-disabled) run.
    const providers: DiscoveryProvider[] = [createOsmArchiveProvider(flags.osmArchiveDir)];
    if (isGeoapifyDiscoveryEnabled()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { geoapifyClientFromEnv } = require('./geoapifyClient') as typeof import('./geoapifyClient');
      providers.push(createGeoapifyPlacesProvider({
        isEnabled: isGeoapifyDiscoveryEnabled,
        client: geoapifyClientFromEnv({ dailyCreditBudget: 300 }), // see GEOAPIFY_2_1_COMPLIANCE.md's suggested budget
      }));
    }

    // ── Phase F: coverage plan (drives every work-unit-based provider) ────
    const coverage = await loadCoveragePlan(supabase as unknown as CoverageRpcClient, flags.planCells);
    if (coverage.available) {
      console.log(`Coverage plan: ${coverage.report!.planEntries.length} under-covered cell(s) of ${coverage.report!.cellsConsidered} considered.`);
      for (const e of coverage.report!.planEntries.slice(0, 5)) {
        console.log(`  cell ${e.cellId} priority=${e.priority}${e.lowDensityCaveat ? ' [low-density, dampened]' : ''} — ${e.reason}`);
      }
      if (coverage.report!.planEntries.length > 5) console.log(`  ... and ${coverage.report!.planEntries.length - 5} more`);
    } else {
      console.log(`Coverage plan UNAVAILABLE: ${coverage.reason}`);
      console.log('  (Providers that can only fetch a bounded area cannot run without a plan — they are reported unavailable below, not silently skipped.)');
    }

    // ── Fetch from every provider, into ONE provider-neutral candidate stream ──
    const providerStatuses: ProviderRunStatus[] = [];
    const candidates: NormalizedCandidate[] = [];
    for (const provider of providers) {
      const units: DiscoveryWorkUnit[] = provider.requiresWorkUnit
        ? coverage.available ? coverage.report!.planEntries.map((e) => e.workUnit) : []
        : [{}]; // fixed extract — one unbounded call

      if (provider.requiresWorkUnit && units.length === 0) {
        const reason = coverage.available
          ? 'coverage plan found no under-covered cells to search this run'
          : `no coverage plan available (${coverage.reason})`;
        providerStatuses.push({ providerId: provider.id, kind: 'unavailable', reason, unitsRequested: 0, unitsSucceeded: 0, candidatesNormalized: 0, droppedUnnormalizable: 0 });
        console.log(`Provider "${provider.id}" unavailable: ${reason}`);
        continue;
      }

      const status: ProviderRunStatus = { providerId: provider.id, kind: 'unavailable', reason: undefined, unitsRequested: units.length, unitsSucceeded: 0, candidatesNormalized: 0, droppedUnnormalizable: 0 };
      const failures: string[] = [];
      for (const unit of units) {
        let result: ProviderResult;
        try {
          result = await provider.fetchCandidates(unit);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
          continue;
        }
        if (result.kind !== 'success') {
          failures.push(`${result.kind}: ${result.reason ?? 'no reason given'}`);
          // One provider's (or one cell's) failure never aborts the others.
          continue;
        }
        status.unitsSucceeded += 1;
        status.candidatesNormalized += result.candidates.length;
        status.droppedUnnormalizable += result.droppedUnnormalizable ?? 0;
        candidates.push(...result.candidates);
      }
      status.kind = status.unitsSucceeded > 0 ? (status.unitsSucceeded === status.unitsRequested ? 'success' : 'partial') : 'unavailable';
      if (failures.length > 0) status.reason = failures.slice(0, 3).join(' | ') + (failures.length > 3 ? ` (+${failures.length - 3} more)` : '');
      providerStatuses.push(status);
      console.log(
        `Provider "${provider.id}" ${status.kind}: ${status.candidatesNormalized} candidate(s) normalized ` +
        `from ${status.unitsSucceeded}/${status.unitsRequested} work unit(s)` +
        `${status.droppedUnnormalizable ? `, ${status.droppedUnnormalizable} unnormalizable row(s) dropped` : ''}` +
        `${status.reason ? ` — ${status.reason}` : ''}`,
      );
    }

    // ── Honest run status ────────────────────────────────────────────────
    // An explicitly requested discovery run that could not use ANY provider is
    // INCOMPLETE, not a successful run that found nothing. Conflating the two
    // is what made a missing OSM archive look like "there are no venues here".
    const usableProviders = providerStatuses.filter((s) => s.kind === 'success' || s.kind === 'partial');
    if (usableProviders.length === 0) {
      const summary = {
        runId, mode: 'discover' as const, status: 'incomplete' as const,
        reason: 'no discovery provider was usable this run — this is NOT a successful run that found zero candidates',
        coveragePlanAvailable: coverage.available, coveragePlanReason: coverage.reason ?? null,
        providers: providerStatuses,
      };
      console.error('\nDISCOVERY INCOMPLETE — no usable provider. Nothing was scanned, and this must not be read as "no new venues exist".');
      for (const s of providerStatuses) console.error(`  ${s.providerId}: ${s.kind}${s.reason ? ` — ${s.reason}` : ''}`);
      fs.mkdirSync(flags.reportDir, { recursive: true });
      fs.writeFileSync(path.join(flags.reportDir, `report-${runId}.json`), JSON.stringify(summary, null, 2), 'utf8');
      process.exitCode = 2; // distinguishable from both success (0) and a crash (1)
      return;
    }

    // Phase D4/H: official-site corroboration, reusing the exact same safe
    // crawler (robots/SSRF/throttle/cache) already used for existing-venue
    // enrichment — only ever fetches a website the candidate itself supplied.
    const corroborate = async (
      website: string | null,
      input: { name: string; postcode: string | null; city: string | null; latitude: number; longitude: number; phone: string | null },
    ) => {
      const r = await corroborateOfficialSite(website, input, { fetchPage });
      return { status: r.status };
    };

    // The TypeScript accept decision -> the candidate row's status. 'auto_accept'
    // maps to 'candidate' (not to anything published): the DB's
    // queue_candidate_for_review then re-checks the gates and moves it to
    // 'quarantined' for a human. Release one has no auto-published state.
    const candidateStatus = (d: string) =>
      d === 'quarantine' ? 'quarantined' : d === 'reject' ? 'rejected' : 'candidate';

    const counts = await discoverFromCandidates(candidates, {
      existingVenues: [], // unused — lookupNearby takes precedence (see discoverCandidates.ts)
      lookupNearby,
      corroborate,
      write: flags.apply,
      apply: flags.apply,
      limit: flags.limit,
      // R2 (pre-staging remediation, 2026-09-01): this used to be a raw
      // PostgREST `.upsert(..., { onConflict: 'source,source_id' })`, which
      // meant a REDISCOVERY of a candidate a human had already rejected,
      // dismissed, marked duplicate, or approved wrote status='candidate'
      // straight back over that decision — the runner's own service-role key
      // could silently undo a terminal human call. Migration 059 now grants
      // service_role NO privilege on venue_discovery_candidates at all (not
      // even SELECT); the ONLY door is upsert_discovery_candidate (061 B2),
      // which enforces "a terminal decision outranks a later automated
      // sighting" server-side, where the runner cannot route around it.
      upsertCandidate: flags.apply ? async (row) => {
        const decision = candidateStatus(row.acceptResult.decision);
        const { data, error: upErr } = await supabase.rpc('upsert_discovery_candidate', {
          p_candidate: {
            name: row.candidate.name,
            latitude: row.candidate.latitude,
            longitude: row.candidate.longitude,
            postcode: row.candidate.postcode,
            address_line1: row.addressLine1,
            city: row.city,
            phone: row.candidate.phone,
            website: row.websiteUrl,
            // The candidate's OWN source — never hardcoded. A hardcoded 'osm'
            // would mis-attribute every non-OSM row AND collide on the
            // (source, source_id) unique key.
            source: row.source,
            source_id: row.sourceId,
            dedupe_decision: row.dedupe.decision,
            matched_venue_id: row.dedupe.matchedVenueId,
            confidence_score: row.acceptInput.confidenceScore,
            has_family_relevant_category: row.acceptInput.hasFamilyRelevantCategory,
            has_valid_uk_coordinates: row.acceptInput.hasValidUkCoordinates,
            has_valid_address: row.acceptInput.hasValidAddress,
            is_trusted_source: row.acceptInput.isTrustedSource,
            official_verification: row.acceptInput.officialVerification,
            // Migration 061: the DB re-checks this itself before publishing —
            // it is the trust boundary, this script is the pre-flight filter.
            independent_identity_evidence_count: row.acceptInput.independentIdentityEvidenceCount,
            identity_evidence_sources: row.acceptInput.identityEvidenceSources ?? [],
            has_closure_signal: row.acceptInput.hasClosureSignal,
            required_fields_complete: row.acceptInput.requiredFieldsComplete,
            status: decision,
            // The RPC builds resolved_mode/reviewed_at/resolution_reasons
            // itself for a 'rejected' status (059's terminal-audit CHECK
            // requires them); this is the human-readable justification it
            // folds into that resolution_reasons entry.
            decision_reason: decision === 'rejected' ? row.acceptResult.reason : undefined,
          },
        });
        if (upErr) throw new Error(upErr.message);
        const result = data as { id: string; outcome: string; status: string };
        return { id: result.id, outcome: result.outcome, status: result.status };
      } : undefined,
      // RELEASE ONE: this QUEUES a strong candidate for human review. It does
      // not publish. auto_accept_candidate no longer exists in the database
      // (migration 061 drops both signatures), so a build still calling it
      // fails loudly rather than silently doing something weaker.
      queueCandidateForReview: flags.apply ? async (candidateId) => {
        const { error: accErr } = await supabase.rpc('queue_candidate_for_review', { p_candidate_id: candidateId });
        if (accErr) throw new Error(accErr.message);
      } : undefined,
    });

    const anyPartial = providerStatuses.some((s) => s.kind === 'partial' || s.kind === 'unavailable');
    const status = anyPartial ? 'partial' : 'complete';
    console.log(`\nDiscovery run ${status}${flags.apply ? '' : ' (DRY RUN — zero writes)'}:`);
    console.log(JSON.stringify(counts, null, 2));
    if (anyPartial) {
      console.log('\nNOTE: at least one provider or work unit did not complete — the counts above are a PARTIAL view of what exists:');
      for (const s of providerStatuses.filter((p) => p.kind !== 'success')) {
        console.log(`  ${s.providerId}: ${s.kind}${s.reason ? ` — ${s.reason}` : ''}`);
      }
    }
    fs.mkdirSync(flags.reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(flags.reportDir, `report-${runId}.json`),
      JSON.stringify({
        runId,
        mode: 'discover',
        status,
        apply: flags.apply,
        coveragePlanAvailable: coverage.available,
        coveragePlanReason: coverage.reason ?? null,
        coveragePlan: coverage.report ?? null,
        providers: providerStatuses,
        ...counts,
      }, null, 2),
      'utf8',
    );
  }
}

// ── Discover-mode helpers ────────────────────────────────────────────────────

/** Per-provider outcome for one discovery run — reported so a run can never look successful when a source silently did nothing. */
export interface ProviderRunStatus {
  providerId: string;
  kind: 'success' | 'partial' | 'unavailable';
  reason?: string;
  unitsRequested: number;
  unitsSucceeded: number;
  candidatesNormalized: number;
  /** Rows the provider could not normalize at all — surfaced rather than vanishing between "fetched" and "evaluated". */
  droppedUnnormalizable: number;
}

interface CoveragePlanLoad {
  available: boolean;
  reason?: string;
  report?: { cellsConsidered: number; undercoveredCells: number; categoriesTargeted: string[]; planEntries: CoveragePlanEntry[] };
}

/**
 * Builds the Phase F coverage plan from real data via the
 * `enrichment_coverage_grid` RPC (migration 060 §G).
 *
 * Degrades VISIBLY, never silently: if the RPC is missing (migration 060 not
 * applied yet — which is the state of every environment today) the run reports
 * the plan as unavailable and says why. It does NOT fall back to pretending
 * the whole country is under-covered, which would send a live provider
 * sweeping the entire UK on a mistaken premise.
 */
/** Minimal structural view of the Supabase client this helper needs — keeps it callable from tests without a real client. */
export interface CoverageRpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

async function loadCoveragePlan(
  supabase: CoverageRpcClient,
  maxCells: number,
): Promise<CoveragePlanLoad> {
  const { data, error } = await supabase.rpc('enrichment_coverage_grid', { p_step_deg: 1.0, p_lat_start: 49.0, p_lng_start: -8.7 });
  if (error) {
    return { available: false, reason: `enrichment_coverage_grid RPC failed (${error.message}) — migration 060 may not be applied` };
  }
  const rows = (data ?? []) as CoverageGridRow[];
  const cells = buildCellCoverage(ukGridCells(1.0), rows);
  const report = buildCoveragePlanReport(cells, {
    targetCategorySlugs: targetedCategorySlugs(),
    now: new Date(),
    maxCellsPerRun: maxCells,
  });
  return { available: true, report };
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
