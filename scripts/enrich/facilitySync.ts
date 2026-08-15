// =============================================================================
// scripts/enrich/facilitySync.ts
//
// Enrichment 2.1 — Phase K: publishes high-confidence positive facility
// evidence into the CANONICAL consumer-facing table, `venue_facilities`
// (Liam's explicit architectural decision — venue_enrichment stays the
// evidence/intelligence layer, venue_facilities is what the app reads).
//
// COEXISTENCE (the whole point of this file): migration 050's parent-vote
// pipeline already tags its own rows `notes = 'parent-confirmed'` and ONLY
// ever touches rows carrying that exact tag (see mirror_facility_stats_to_
// venue_facilities in 050_parent_facility_votes.sql — its DELETE and its
// ON CONFLICT...DO UPDATE...WHERE both filter on notes = 'parent-confirmed'
// or NULL). This module tags every row IT writes with a DIFFERENT provenance
// value (`OFFICIAL_ENRICHMENT_NOTES` below) — structurally guaranteeing the
// vote-mirror trigger can never overwrite or delete an official-enrichment
// row, and this module never touches a 'parent-confirmed' or admin row
// either. Proven behaviourally (not just argued) in
// supabase/tests/060_enrichment_2_1_facility_sync.mjs against the REAL,
// unmodified migration 050 trigger — no schema change was needed for this
// coexistence guarantee (verified before building, not assumed).
//
// PRECEDENCE (Liam's explicit rule): admin correction > official evidence >
// community votes, for AUTOMATED decisions — but this NEVER means official
// evidence deletes community evidence, or vice versa. This module's decision
// function has exactly one destructive-adjacent case (a negative fact
// conflicting with an existing row) and it NEVER auto-deletes — it routes to
// the exception queue instead, unconditionally.
//
// No I/O — decideFacilitySync is pure. applyFacilitySync (I/O) lives in
// autonomous.ts alongside the other real Supabase writes, same pattern as
// every other Phase D-K module in this codebase.
// =============================================================================

import type { VenueFact } from './web/venueFacts';
import { isTrustedSourceId, type SourceId } from './sourceTrust';

/** Distinct from migration 050's 'parent-confirmed' and from NULL (admin/import rows) — see file header. */
export const OFFICIAL_ENRICHMENT_NOTES = 'official-enrichment';

/**
 * Canonical VenueFact facility slug -> real `facilities.slug` mapping.
 * SINGLE SOURCE OF TRUTH (per instruction: "do not scatter string literals
 * through multiple files") — VenueFact's FacilitySlug union in venueFacts.ts
 * IS already exactly this slug (chosen deliberately to match), so this table
 * mainly documents+enforces that identity and flags which slugs additionally
 * participate in the migration 050 parent-vote pipeline.
 *
 * PRE-EXISTING DATA QUALITY ISSUE (Phase 0 finding, not introduced or fixed
 * here): `facilities` has TWO rows for "baby changing" — 'baby-changing'
 * (seed.sql, icon 👶) and 'baby-change' (migration 050, icon 'stroller').
 * Only 'baby-change' participates in the live vote/mirror pipeline, so it is
 * the canonical target here. 'baby-changing' is a likely-orphaned duplicate
 * — flagged for Liam, not silently merged/deleted (that is a data decision,
 * not a code one).
 */
export const FACILITY_SLUGS_VOTE_ELIGIBLE: ReadonlySet<string> = new Set(['toilets', 'baby-change', 'parking']);

export type FacilitySyncAction = 'publish' | 'already_present' | 'no_action' | 'exception';

export interface FacilitySyncDecision {
  action: FacilitySyncAction;
  reason: string;
}

export interface ExistingFacilityRow {
  /** The current row's notes value, or null. Presence of a row at all (regardless of notes) means the fact is already published. */
  notes: string | null;
}

/**
 * Pure decision: given one extracted positive/negative facility fact, the
 * source's trust tier, and whatever venue_facilities row currently exists
 * (if any), decide what to do. Never returns an action that would delete or
 * silently overwrite an existing row — the caller (applyFacilitySync) only
 * ever INSERTs (on 'publish') or does nothing (every other action).
 */
export function decideFacilitySync(
  fact: Extract<VenueFact, { kind: 'facility' }>,
  existing: ExistingFacilityRow | null,
  source: SourceId,
): FacilitySyncDecision {
  if (!isTrustedSourceId(source)) {
    return { action: 'no_action', reason: `source "${source}" is below the trusted tier — facility facts from it are never auto-published` };
  }

  if (fact.present) {
    if (existing) {
      return { action: 'already_present', reason: 'a venue_facilities row already exists (any provenance) — presence is already correctly published, never overwritten' };
    }
    return { action: 'publish', reason: 'high-confidence positive evidence from a trusted source, no existing row — safe to publish' };
  }

  // Explicit negative evidence (never inferred from absence — see venueFacts.ts).
  if (!existing) {
    return { action: 'no_action', reason: 'explicit negative evidence, but no published row exists to conflict with — nothing to do (the negative is still recorded as evidence in venue_enrichment, not here)' };
  }
  return {
    action: 'exception',
    reason: `explicit negative evidence conflicts with an existing published facility row (notes="${existing.notes ?? 'null'}") — routed to human review, never auto-deleted`,
  };
}
