// =============================================================================
// types/enrichmentDecision.ts
//
// ⭐ SINGLE SOURCE OF TRUTH — Phase 1 contract for the exception-only Website
// Enrichment decision engine. EVERY later module (decision engine, orchestration,
// reports, admin hooks, admin UI) MUST import the unions / constants / types from
// here. Do NOT redeclare these string literals anywhere else.
//
// The SQL side (migration 057 + RPCs) cannot import TypeScript, so it mirrors
// these exact strings by hand — they are pinned in scripts/enrich/DECISION_CONTRACT.md
// and verified at the Phase 3 reconciliation gate. If you change a string here you
// MUST change it there and in the migration CHECK constraints.
//
// Relative imports only — NO '@/' alias (this type is consumed by both the Expo
// app bundle AND the node-side enrichment scripts/jest).
// =============================================================================

import type {
  Confidence,
  ExtractionMethod,
  WebField,
} from './webEnrichment';

// ── 1. Decision verdict ───────────────────────────────────────────────────────
// MUST match migration 057 CHECK: decision in (...).
export type EnrichmentDecision =
  | 'auto_apply' // engine is confident + safe → applied without a human (re-guarded at write time)
  | 'manual_review' // a human must approve/edit/reject → the only thing shown as an actionable card
  | 'auto_reject' // not worth a human's time → persisted for audit, never actionable
  | 'report_only'; // recorded for audit/future retry → never applied, never actionable

export const ENRICHMENT_DECISIONS: readonly EnrichmentDecision[] = [
  'auto_apply',
  'manual_review',
  'auto_reject',
  'report_only',
] as const;

// ── 2. Proposal status ────────────────────────────────────────────────────────
// MUST match venue_field_proposals.status CHECK (056 + 057's 'report_only').
export type ProposalStatus =
  | 'pending' // awaiting action (manual_review) OR awaiting auto-apply (auto_apply)
  | 'approved' // admin approved; apply RPC not yet succeeded (two-phase manual path)
  | 'applied' // written to the live venue (see applied_mode for auto vs manual)
  | 'rejected' // rejected by an admin OR by the engine (auto_reject)
  | 'superseded' // replaced by a newer proposal for the same (venue, field)
  | 'report_only'; // engine recorded it for audit; never actionable

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  'pending',
  'approved',
  'applied',
  'rejected',
  'superseded',
  'report_only',
] as const;

// How the engine's decision maps to the status a freshly-proposed row is stored with.
// (auto_apply rows stay 'pending' until the in-app batch applies them → 'applied'.)
export const DECISION_TO_INITIAL_STATUS: Record<EnrichmentDecision, ProposalStatus> = {
  auto_apply: 'pending',
  manual_review: 'pending',
  auto_reject: 'rejected',
  report_only: 'report_only',
};

// Only these decisions ever surface as actionable admin cards.
export const ACTIONABLE_DECISIONS: readonly EnrichmentDecision[] = ['manual_review'] as const;

// ── 3. applied_mode ───────────────────────────────────────────────────────────
// MUST match venue_field_proposals.applied_mode + venue_enrichment_writes.applied_mode CHECK.
export type AppliedMode = 'auto' | 'manual';

// ── 4. Reason-code registry ───────────────────────────────────────────────────
// Closed vocabulary stored in decision_reasons (jsonb array of these strings).
// The admin UI maps each code → a human label via REASON_LABELS below.
// Keep additions here; never invent ad-hoc reason strings in the engine.
export type ReasonCode =
  // — auto_apply justifications —
  | 'current_empty'
  | 'current_invalid'
  | 'single_validated_value'
  | 'official_domain_source'
  | 'structured_and_visible_agree'
  | 'complete_week'
  | 'pricing_unambiguous'
  | 'description_facts_sufficient'
  // — manual_review triggers —
  | 'would_replace_existing'
  | 'multiple_values_conflict'
  | 'central_vs_branch_conflict'
  | 'competing_email'
  | 'official_domain_email_competes'
  | 'opening_hours_change_warning'
  | 'opening_hours_partial_week'
  | 'price_ambiguous'
  | 'meaningful_url_difference'
  | 'description_one_uncertainty'
  // — auto_reject reasons —
  | 'duplicate'
  | 'canonical_equivalent_website'
  | 'equals_current'
  | 'unsupported_field'
  | 'malformed_value'
  | 'placeholder_value'
  | 'off_domain_source'
  | 'stale_contradicted_by_visible'
  | 'description_failed_similarity'
  | 'description_failed_validation'
  | 'description_unsupported_fact'
  | 'description_conflicting_evidence'
  // — report_only reasons —
  | 'booking_url_no_target_column'
  | 'insufficient_description_evidence'
  // — legacy (057 backfill of pre-engine pilot rows) —
  | 'legacy_manual_pilot';

// Human-facing labels for the admin UI. Every ReasonCode MUST have an entry.
export const REASON_LABELS: Record<ReasonCode, string> = {
  current_empty: 'Current value is empty',
  current_invalid: 'Current value is invalid',
  single_validated_value: 'One validated value found',
  official_domain_source: 'From the official website',
  structured_and_visible_agree: 'Structured data and page text agree',
  complete_week: 'Complete 7-day schedule',
  pricing_unambiguous: 'Pricing maps unambiguously',
  description_facts_sufficient: 'Enough verified facts to summarise',
  would_replace_existing: 'Would replace an existing value',
  multiple_values_conflict: 'Multiple different values found',
  central_vs_branch_conflict: 'Central vs branch value conflict',
  competing_email: 'A competing email was found',
  official_domain_email_competes: 'A different official-domain email exists',
  opening_hours_change_warning: 'Page warns hours may change',
  opening_hours_partial_week: 'Incomplete weekly schedule',
  price_ambiguous: 'Pricing is ambiguous',
  meaningful_url_difference: 'Meaningful path/subdomain/query difference',
  description_one_uncertainty: 'One fact needs a quick check',
  duplicate: 'Duplicate candidate',
  canonical_equivalent_website: 'Same site (www/slash/scheme only)',
  equals_current: 'Equal to the stored value',
  unsupported_field: 'No target field to write to',
  malformed_value: 'Malformed value',
  placeholder_value: 'Placeholder value',
  off_domain_source: 'Source not on the official domain',
  stale_contradicted_by_visible: 'Stale data contradicted by visible content',
  description_failed_similarity: 'Draft too similar to source text',
  description_failed_validation: 'Draft failed validation',
  description_unsupported_fact: 'Draft introduced an unsupported fact',
  description_conflicting_evidence: 'Conflicting evidence for the description',
  booking_url_no_target_column: 'Booking URL: no supported column yet',
  insufficient_description_evidence: 'Not enough facts to summarise',
  legacy_manual_pilot: 'Legacy pilot (pre-engine)',
};

// ── 5. Engine version ─────────────────────────────────────────────────────────
// Stamped on every decision (decision_engine_version). Bump the number when the
// rules change so we can attribute past decisions and re-run report_only retries.
// Format: 'decision-engine@<major>.<minor>.<patch>'. ('legacy-pilot' = pre-engine.)
export const DECISION_ENGINE_VERSION = 'decision-engine@1.0.0' as const;

// ── 6. RPC contract (names, params, return shapes) ────────────────────────────
// These mirror migration 057. The admin hooks call these EXACT names with these
// EXACT param names. Verified at the Phase 3 reconciliation gate.

/** auto_apply_venue_proposal(p_proposal_id, p_applied_text) → AutoApplyResult */
export type AutoApplyOutcome =
  | 'applied'
  | 'not_authorized'
  | 'not_pending'
  | 'moved_to_manual_review'
  | 'stale'
  | 'validation_failed';

export interface AutoApplyResult {
  outcome: AutoApplyOutcome;
  field: WebField | null;
  reason?: string; // present for validation_failed
}

/** apply_venue_proposal / reject — unchanged 056 shape */
export interface ApplyResult {
  ok: boolean;
  field?: WebField;
}

/** rollback_enrichment_run(p_run_id) → RollbackItemResult[] */
export type RollbackOutcome =
  | 'restored'
  | 'already_rolled_back'
  | 'skipped_newer_change'
  | string; // 'failed:<msg>' per-field

export interface RollbackItemResult {
  write_id: string;
  proposal_id: string | null;
  venue_id: string;
  field: WebField;
  outcome: RollbackOutcome;
}

// ── 7. Engine output (cross-boundary: engine → orchestrator/report → propose) ──
// The persistence layer reads decision/reasons/version off this. The engine agent
// owns its INTERNAL helpers, but the per-field result it emits MUST be this shape.
export interface FieldDecision {
  field: WebField;
  decision: EnrichmentDecision;
  reasons: ReasonCode[];
  /** The single candidate chosen for apply (absent for auto_reject with no value). */
  chosen?: {
    value: unknown; // { v: scalar } shape is applied by the proposal layer, not here
    sourceUrl: string;
    evidenceSnippet: string;
    evidenceRaw: string | null;
    method: ExtractionMethod;
    confidence: Confidence;
    conflictsExisting: boolean;
  };
  /** For description auto_apply/manual_review: the ORIGINAL composed copy (never scraped text). */
  generatedText?: string;
}

// ── 8. Batch summary vocabulary (dry-run summary → UI confirm dialog) ──────────
export interface EnrichmentBatchSummary {
  venuesProcessed: number;
  safeChangesReady: number; // auto_apply count
  suppressed: number; // auto_reject + report_only count (no-op/unsupported/recorded)
  exceptions: number; // manual_review count
  failures: number; // extraction failures (fetch_failed etc.)
  /** True if ANY auto_apply would touch a non-empty field (default policy forbids — must be false). */
  wouldReplaceNonEmpty: boolean;
  fieldsAffected: WebField[];
}
