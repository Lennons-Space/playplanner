// =============================================================================
// scripts/enrich/autonomousCore.ts
//
// Enrichment 2.0 — Part 10/11/12: the PURE, testable core of the autonomous
// batch orchestrator. All I/O (network, DB, filesystem) is injected or done by
// the thin CLI wrapper (autonomous.ts) — this file has none, so every rule
// here is unit-tested without a live Supabase project or network access.
//
// Responsibilities:
//   - classifyProposal(s): score + decide auto_apply/defer/ignore/exception
//     for each extracted field proposal (wires confidenceScore + autoApplyPolicy)
//   - checkpoint helpers: resumable venue processing (Part 10)
//   - buildAutonomyReport: the Part 12 run-report shape (JSON + summary counts)
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

import type { ProposalDraft, WebField } from '../../types/webEnrichment';
import type {
  AutoApplyDecision,
  FieldConfidenceScore,
  OrchestratorCheckpoint,
} from '../../types/enrichmentAutonomy';
import { scoreFieldConfidence } from './web/confidenceScore';
import { decideAutoApply } from './web/autoApplyPolicy';

// ── Classification ─────────────────────────────────────────────────────────

export interface ClassifyContext {
  now: Date;
  /**
   * Coarse proxy for "was this field's current value set/confirmed by a
   * human?". The schema has no per-field provenance flag today — venues.
   * is_verified is the closest existing signal, so callers pass it through
   * here. This intentionally ERRS TOWARD MORE EXCEPTIONS (never toward more
   * silent auto-apply): a false positive just means one extra human review,
   * a false negative would mean silently overwriting curated data.
   */
  currentValueHumanVerified: boolean;
  isNewVenue: boolean;
  corroboratingSources?: number;
}

export interface ClassifiedProposal {
  draft: ProposalDraft;
  confidence: FieldConfidenceScore;
  decision: AutoApplyDecision;
}

function ageDaysSince(retrievedAt: string, now: Date): number {
  const ms = now.getTime() - new Date(retrievedAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function openingIssuesFor(draft: ProposalDraft): string[] | undefined {
  if (draft.field !== 'opening_hours') return undefined;
  const value = draft.proposed_value as { seasonal_notes?: string | null } | undefined;
  return value?.seasonal_notes ? ['seasonal'] : undefined;
}

export function classifyProposal(draft: ProposalDraft, ctx: ClassifyContext): ClassifiedProposal {
  const confidence = scoreFieldConfidence({
    field: draft.field,
    method: draft.extraction_method,
    conflictsExisting: draft.conflicts_existing,
    openingIssues: openingIssuesFor(draft),
    isPersonalEmail: false, // already reflected upstream in draft.confidence; not re-derived here
    corroboratingSources: ctx.corroboratingSources,
    evidenceAgeDays: ageDaysSince(draft.retrieved_at, ctx.now),
  });

  const decision = decideAutoApply({
    confidence,
    conflictsExisting: draft.conflicts_existing,
    currentValueHumanVerified: ctx.currentValueHumanVerified,
    isNewVenue: ctx.isNewVenue,
  });

  return { draft, confidence, decision };
}

export interface ClassifiedBuckets {
  autoApply: ClassifiedProposal[];
  defer: ClassifiedProposal[];
  ignore: ClassifiedProposal[];
  exception: ClassifiedProposal[];
}

export function classifyProposals(drafts: ProposalDraft[], ctx: ClassifyContext): ClassifiedBuckets {
  const buckets: ClassifiedBuckets = { autoApply: [], defer: [], ignore: [], exception: [] };
  for (const draft of drafts) {
    const classified = classifyProposal(draft, ctx);
    switch (classified.decision.action) {
      case 'auto_apply':
        buckets.autoApply.push(classified);
        break;
      case 'defer':
        buckets.defer.push(classified);
        break;
      case 'ignore':
        buckets.ignore.push(classified);
        break;
      case 'exception':
        buckets.exception.push(classified);
        break;
    }
  }
  return buckets;
}

// ── Checkpoint (Part 10: resume/checkpoint) ───────────────────────────────────

export function createCheckpoint(runId: string, mode: OrchestratorCheckpoint['mode'], now: Date): OrchestratorCheckpoint {
  const iso = now.toISOString();
  return { runId, startedAt: iso, updatedAt: iso, mode, processedVenueIds: [], cursor: null, complete: false };
}

export function markProcessed(checkpoint: OrchestratorCheckpoint, venueId: string, now: Date): OrchestratorCheckpoint {
  if (checkpoint.processedVenueIds.includes(venueId)) return checkpoint;
  return {
    ...checkpoint,
    processedVenueIds: [...checkpoint.processedVenueIds, venueId],
    cursor: venueId,
    updatedAt: now.toISOString(),
  };
}

export function isProcessed(checkpoint: OrchestratorCheckpoint, venueId: string): boolean {
  return checkpoint.processedVenueIds.includes(venueId);
}

/** Filter a candidate venue-id list down to the ones NOT yet processed by this checkpoint. */
export function filterUnprocessed(venueIds: string[], checkpoint: OrchestratorCheckpoint | null): string[] {
  if (!checkpoint) return venueIds;
  return venueIds.filter((id) => !isProcessed(checkpoint, id));
}

export function markComplete(checkpoint: OrchestratorCheckpoint, now: Date): OrchestratorCheckpoint {
  return { ...checkpoint, complete: true, updatedAt: now.toISOString() };
}

// ── Run report (Part 12) ──────────────────────────────────────────────────────

export interface AutonomyRunReport {
  runId: string;
  generatedAt: string;
  durationMs: number;
  venuesConsidered: number;
  venuesCrawled: number;
  venuesSkippedFresh: number;
  websitesDiscovered: number;
  fieldsExtracted: number;
  fieldsAutoApplied: number;
  fieldsUnchanged: number;
  weakEvidenceIgnored: number;
  conflictsQuarantined: number;
  candidatesDiscovered: number;
  candidateDuplicatesSkipped: number;
  newVenuesAutoAccepted: number;
  newVenuesQuarantined: number;
  suspectedClosures: number;
  failedRequests: number;
  robotsDeniedRequests: number;
  cacheHitRate: number | null;
  byField: Partial<Record<WebField, { extracted: number; autoApplied: number }>>;
  /** Enrichment 2.1 Phase Q — "how much richer did PlayPlanner become". */
  richFacts: RichFactsSummary;
}

/**
 * "How much richer did PlayPlanner become" — and, in a dry run, how much
 * richer it WOULD have become.
 *
 * Every count below is a CHANGE IDENTIFIED, computed by the exact same
 * classification code in both modes. `mode` says which run this was, and
 * `writesPerformed` is the independent proof: a dry run identifies changes and
 * performs zero writes, so writesPerformed is always 0 there. (Before this was
 * fixed, all of these were structurally zero in dry-run because the
 * classification itself sat inside the --apply branch — the report couldn't
 * tell you anything about a run you hadn't already committed to.)
 */
export interface RichFactsSummary {
  mode: 'dry_run' | 'apply';
  indoorOutdoorAdded: number;
  facilitiesAdded: Partial<Record<string, number>>; // keyed by facility slug
  admissionStateAdded: number;
  descriptionsGenerated: number;
  /** Venues that gained at least one of min/max age evidence (never venues.min_age/max_age — see migration 060 §D). */
  ageEvidenceAdded: number;
  heightEvidenceAdded: number;
  /** Booking links whose host matched the venue's own domain (bookingUrlPolicy.ts). */
  bookingUrlsAutoApplied: number;
  /** Booking links that could not be tied to the venue — routed to the exception queue, never published unattended. */
  bookingUrlsExceptioned: number;
  factsExtractedTotal: number;
  facilityConflicts: number; // routed to the exception queue, never auto-resolved
  /** Actual write calls made. ALWAYS 0 in dry-run — the machine-checkable proof of zero writes. */
  writesPerformed: number;
}

export function emptyRichFactsSummary(mode: RichFactsSummary['mode'] = 'dry_run'): RichFactsSummary {
  return {
    mode,
    indoorOutdoorAdded: 0,
    facilitiesAdded: {},
    admissionStateAdded: 0,
    descriptionsGenerated: 0,
    ageEvidenceAdded: 0,
    heightEvidenceAdded: 0,
    bookingUrlsAutoApplied: 0,
    bookingUrlsExceptioned: 0,
    factsExtractedTotal: 0,
    facilityConflicts: 0,
    writesPerformed: 0,
  };
}

export interface AutonomyRunReportInputs {
  runId: string;
  generatedAt: string;
  durationMs: number;
  venuesConsidered: number;
  venuesCrawled: number;
  venuesSkippedFresh: number;
  classifiedByVenue: ClassifiedBuckets[];
  websitesDiscovered: number;
  candidatesDiscovered: number;
  candidateDuplicatesSkipped: number;
  newVenuesAutoAccepted: number;
  newVenuesQuarantined: number;
  suspectedClosures: number;
  failedRequests: number;
  robotsDeniedRequests: number;
  cacheHitRate: number | null;
  richFacts: RichFactsSummary;
}

export function buildAutonomyReport(inputs: AutonomyRunReportInputs): AutonomyRunReport {
  let fieldsExtracted = 0;
  let fieldsAutoApplied = 0;
  let weakEvidenceIgnored = 0;
  let conflictsQuarantined = 0;
  const byField: AutonomyRunReport['byField'] = {};

  for (const buckets of inputs.classifiedByVenue) {
    const all = [...buckets.autoApply, ...buckets.defer, ...buckets.ignore, ...buckets.exception];
    for (const c of all) {
      fieldsExtracted += 1;
      const entry = (byField[c.draft.field] ??= { extracted: 0, autoApplied: 0 });
      entry.extracted += 1;
      if (c.decision.action === 'auto_apply') {
        entry.autoApplied += 1;
      }
    }
    fieldsAutoApplied += buckets.autoApply.length;
    weakEvidenceIgnored += buckets.ignore.length;
    conflictsQuarantined += buckets.exception.length;
  }

  return {
    runId: inputs.runId,
    generatedAt: inputs.generatedAt,
    durationMs: inputs.durationMs,
    venuesConsidered: inputs.venuesConsidered,
    venuesCrawled: inputs.venuesCrawled,
    venuesSkippedFresh: inputs.venuesSkippedFresh,
    websitesDiscovered: inputs.websitesDiscovered,
    fieldsExtracted,
    fieldsAutoApplied,
    fieldsUnchanged: 0, // dedup happens upstream in proposals.ts — proposals here are always "changed"
    weakEvidenceIgnored,
    conflictsQuarantined,
    candidatesDiscovered: inputs.candidatesDiscovered,
    candidateDuplicatesSkipped: inputs.candidateDuplicatesSkipped,
    newVenuesAutoAccepted: inputs.newVenuesAutoAccepted,
    newVenuesQuarantined: inputs.newVenuesQuarantined,
    suspectedClosures: inputs.suspectedClosures,
    failedRequests: inputs.failedRequests,
    robotsDeniedRequests: inputs.robotsDeniedRequests,
    cacheHitRate: inputs.cacheHitRate,
    byField,
    richFacts: inputs.richFacts,
  };
}

export function renderHumanSummary(report: AutonomyRunReport): string {
  const lines: string[] = [];
  lines.push(`Enrichment 2.0 autonomous run ${report.runId}`);
  lines.push(`Generated: ${report.generatedAt} (${report.durationMs}ms)`);
  lines.push('');
  lines.push(`Venues considered   : ${report.venuesConsidered}`);
  lines.push(`Venues crawled      : ${report.venuesCrawled}`);
  lines.push(`Venues skipped fresh: ${report.venuesSkippedFresh}`);
  lines.push(`Websites discovered : ${report.websitesDiscovered}`);
  lines.push('');
  lines.push(`Fields extracted       : ${report.fieldsExtracted}`);
  lines.push(`Fields auto-applied    : ${report.fieldsAutoApplied}`);
  lines.push(`Weak evidence ignored  : ${report.weakEvidenceIgnored}`);
  lines.push(`Conflicts quarantined  : ${report.conflictsQuarantined}`);
  lines.push('');
  lines.push(`Candidates discovered      : ${report.candidatesDiscovered}`);
  lines.push(`Candidate duplicates skipped: ${report.candidateDuplicatesSkipped}`);
  lines.push(`New venues auto-accepted   : ${report.newVenuesAutoAccepted}`);
  lines.push(`New venues quarantined     : ${report.newVenuesQuarantined}`);
  lines.push(`Suspected closures         : ${report.suspectedClosures}`);
  lines.push('');
  lines.push(`Failed requests       : ${report.failedRequests}`);
  lines.push(`Robots-denied requests: ${report.robotsDeniedRequests}`);
  lines.push(`Cache hit rate        : ${report.cacheHitRate === null ? 'n/a' : `${(report.cacheHitRate * 100).toFixed(1)}%`}`);
  lines.push('');
  lines.push('By field:');
  for (const [field, counts] of Object.entries(report.byField)) {
    lines.push(`  ${field.padEnd(14)} extracted=${counts.extracted} autoApplied=${counts.autoApplied}`);
  }
  lines.push('');
  const rf = report.richFacts;
  const dry = rf.mode === 'dry_run';
  // Labels say what actually happened, so a dry-run report can never be
  // mistaken for a record of changes that were made.
  const verb = dry ? 'would add' : 'added';
  lines.push(`Rich facts (Enrichment 2.1) — ${dry ? 'DRY RUN: changes identified, nothing written' : 'APPLIED'}:`);
  lines.push(`  Facts extracted total   : ${rf.factsExtractedTotal}`);
  lines.push(`  Indoor/outdoor ${verb.padEnd(9)}: ${rf.indoorOutdoorAdded}`);
  lines.push(`  Admission state ${verb.padEnd(8)}: ${rf.admissionStateAdded}`);
  lines.push(`  Age evidence ${verb.padEnd(11)}: ${rf.ageEvidenceAdded}`);
  lines.push(`  Height evidence ${verb.padEnd(8)}: ${rf.heightEvidenceAdded}`);
  lines.push(`  Descriptions ${dry ? 'would generate' : 'generated'} : ${rf.descriptionsGenerated}`);
  lines.push(`  Booking URLs ${dry ? 'would auto-apply' : 'auto-applied'}: ${rf.bookingUrlsAutoApplied} (host matched the venue's own domain)`);
  lines.push(`  Booking URLs for review : ${rf.bookingUrlsExceptioned} (could not be tied to the venue — never published unattended)`);
  lines.push(`  Facility conflicts      : ${rf.facilityConflicts} (routed to exception queue, never auto-resolved)`);
  lines.push(`  Writes performed        : ${rf.writesPerformed}${dry ? ' (dry run — must be 0)' : ''}`);
  const facilitySlugs = Object.keys(rf.facilitiesAdded);
  if (facilitySlugs.length > 0) {
    lines.push(`  Facilities ${verb}:`);
    for (const slug of facilitySlugs) {
      lines.push(`    ${slug.padEnd(20)} ${rf.facilitiesAdded[slug]}`);
    }
  }
  return lines.join('\n');
}
