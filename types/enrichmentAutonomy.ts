// =============================================================================
// types/enrichmentAutonomy.ts
//
// Enrichment 2.0 — shared types for the autonomy layer built on top of the
// existing website-enrichment proposal/apply system (migration 056,
// types/webEnrichment.ts). This file adds NUMERIC per-field confidence,
// auto-apply policy decisions, closure-signal assessment, freshness
// scheduling, and candidate-venue dedup — without altering any existing type.
//
// No '@/' path alias — these types are consumed by scripts/ (tsx/jest/Node),
// not the Expo app bundle.
// =============================================================================

import type { Confidence, ExtractionMethod, WebField } from './webEnrichment';

// ── Numeric confidence (Part 3) ───────────────────────────────────────────────

/** One named adjustment applied to the base score. Kept for audit/report display. */
export interface ScoreAdjustment {
  reason: string;
  delta: number;
}

/**
 * Deterministic 0-100 confidence for a single field candidate. `qualitative`
 * mirrors the existing low/medium/high band (unchanged, still used by the
 * human-review report) — this is an ADDITIVE numeric layer, not a replacement.
 */
export interface FieldConfidenceScore {
  field: WebField;
  method: ExtractionMethod;
  score: number; // 0-100, clamped
  qualitative: Confidence;
  baseScore: number;
  adjustments: ScoreAdjustment[];
}

export interface ConfidenceScoreInput {
  field: WebField;
  method: ExtractionMethod;
  conflictsExisting: boolean;
  openingIssues?: string[];
  isPersonalEmail?: boolean;
  /** Number of independent sources agreeing on this value (1 = single source). */
  corroboratingSources?: number;
  /** Age of the evidence in days at scoring time (freshness discount). */
  evidenceAgeDays?: number;
}

// ── Auto-apply policy (Part 3/4/15) ──────────────────────────────────────────

export type AutoApplyAction = 'auto_apply' | 'defer' | 'ignore' | 'exception';

export interface AutoApplyDecision {
  field: WebField;
  action: AutoApplyAction;
  score: number;
  threshold: number;
  /** True when a field is structurally excluded from ever auto-applying (e.g. description). */
  neverAutoApplies: boolean;
  reason: string;
}

export interface AutoApplyPolicyInput {
  confidence: FieldConfidenceScore;
  conflictsExisting: boolean;
  /**
   * True when the venue's CURRENT value for this field was set/confirmed by a
   * human admin (not a prior auto-apply). Precedence rule (Part 15): automated
   * data must never silently overwrite human-verified data.
   */
  currentValueHumanVerified: boolean;
  /** True when this proposal targets a brand-new (not-yet-published) venue. */
  isNewVenue?: boolean;
}

// ── Closure signals (Part 9) ──────────────────────────────────────────────────

export type ClosureSignalKind =
  | 'explicit_official_text'   // "permanently closed" on the venue's own site
  | 'explicit_thirdparty_text' // same phrase, but from a lower-trust source
  | 'redirect_to_closure_notice'
  | 'operator_announcement';

export type OperatingStatus = 'active' | 'suspected_closed' | 'confirmed_closed';

export interface ClosureSignal {
  kind: ClosureSignalKind;
  sourceUrl: string;
  evidenceSnippet: string;
  detectedAt: string; // ISO8601
  /** Source trust tier per the hierarchy in Part 2 — 1 = official/operator site. */
  sourceTier: 1 | 2 | 3;
}

export interface ClosureAssessment {
  recommendedStatus: OperatingStatus;
  signalCount: number;
  tier1SignalCount: number;
  reason: string;
  /** Signals considered but explicitly NOT counted as closure evidence (404s, robots denial, etc.). */
  ignoredNonSignals: string[];
}

// ── Freshness / re-enrichment scheduling (Part 13) ────────────────────────────

/** Freshness domains — coarser than WebField because closure/identity cut across fields. */
export type FreshnessDomain =
  | 'identity'        // website/domain
  | 'contact'         // phone/email
  | 'opening_hours'
  | 'pricing'
  | 'closure_status'
  | 'facilities'
  | 'description';

export interface FreshnessCheck {
  domain: FreshnessDomain;
  lastCheckedAt: string | null; // ISO8601, null = never checked
  /** Set true for venues with an active suspected-closure signal — shortens the TTL. */
  suspiciousClosure?: boolean;
}

export interface FreshnessResult {
  domain: FreshnessDomain;
  stale: boolean;
  ttlDays: number;
  ageDays: number | null;
}

export interface VenuePriority {
  venueId: string;
  /** Higher = more urgent. Missing-critical-field venues rank above merely-stale ones. */
  priority: number;
  reasons: string[];
}

// ── Discovery / dedup (Part 6/7/8) ─────────────────────────────────────────────

export interface DedupeCandidate {
  name: string;
  latitude: number;
  longitude: number;
  postcode: string | null;
  phone: string | null;
  websiteDomain: string | null; // registrable domain, lowercased
  category: string | null; // PlayPlanner category slug, when known
}

export interface DedupeExistingVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  postcode: string | null;
  phone: string | null;
  websiteDomain: string | null;
  category: string | null;
}

export type DedupeDecision = 'duplicate' | 'possible_duplicate' | 'distinct';

export interface DedupeSignalBreakdown {
  nameSim: number;
  distanceM: number | null;
  postcodeMatch: boolean;
  phoneMatch: boolean;
  domainMatch: boolean;
  categoryCompatible: boolean;
}

export interface DedupeResult {
  decision: DedupeDecision;
  score: number;
  matchedVenueId: string | null;
  signals: DedupeSignalBreakdown;
  reasons: string[];
}

// ── New-venue auto-accept gate (Part 8) ───────────────────────────────────────

export interface CandidateAcceptInput {
  hasFamilyRelevantCategory: boolean;
  hasValidUkCoordinates: boolean;
  hasValidAddress: boolean;
  dedupeDecision: DedupeDecision;
  isTrustedSource: boolean; // tier 1 or tier 2 per Part 2
  officialVerification: boolean; // tier 1 confirmation found
  hasClosureSignal: boolean;
  requiredFieldsComplete: boolean;
  confidenceScore: number; // 0-100 composite candidate confidence
}

// 'merge_existing' (Enrichment 2.1 Phase H) — an exact dedupe match: the
// candidate IS an already-known venue, so the correct action is enriching
// that existing venue, never creating a duplicate. Distinct from 'reject'
// (which means the candidate itself is not worth pursuing at all).
export type CandidateAcceptDecision = 'merge_existing' | 'auto_accept' | 'quarantine' | 'reject';

export interface CandidateAcceptResult {
  decision: CandidateAcceptDecision;
  reason: string;
}

// ── Orchestrator checkpoint (Part 10) ─────────────────────────────────────────

export interface OrchestratorCheckpoint {
  runId: string;
  startedAt: string;
  updatedAt: string;
  mode: 'enrich-existing' | 'discover';
  processedVenueIds: string[];
  cursor: string | null; // last-processed venue id, for resumable ordering
  complete: boolean;
}
