/**
 * hooks/useEnrichmentProposals.ts
 *
 * Data hooks for the admin Website Enrichment Review screen.
 *
 * SECURITY RULES (do not relax):
 * - Uses the AUTHENTICATED supabase client only — never service-role.
 * - RLS policy `proposals_admin_all` (is_admin()) gates every query.
 * - Does NOT call propose_field or snapshot_current_value from the client.
 * - No automatic approval. All writes are explicit admin actions.
 * - Sensitive fields (evidence_snippet, source_url, proposed_value) are not logged.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { WebField, ExtractionMethod, Confidence } from '@/types/webEnrichment';
import type {
  EnrichmentDecision,
  AppliedMode,
  ReasonCode,
  RollbackItemResult,
} from '@/types/enrichmentDecision';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single reviewable field proposal row as returned by the admin query.
 * `proposed_value` and `current_value` are raw JSONB — callers must narrow
 * before use (scalars are wrapped as `{ v: string }`, opening_hours is an
 * OpeningWeek object).
 */
export interface ProposalRow {
  id: string;
  venue_id: string;
  run_id: string | null;
  field: WebField;
  proposed_value: unknown;
  current_value: unknown;
  confidence: Confidence;
  extraction_method: ExtractionMethod;
  conflicts_existing: boolean;
  source_url: string;
  evidence_snippet: string;
  evidence_raw: string | null;
  retrieved_at: string;
  status: string;
  // Phase 4: decision engine columns (present after migration 057)
  decision: EnrichmentDecision | null;
  decision_reasons: ReasonCode[];
  decision_engine_version: string | null;
  decision_at: string | null;
  applied_mode: AppliedMode | null;
  venues: { name: string } | null;
}

/**
 * A proposal the engine has routed as safe to auto-apply (decision='auto_apply',
 * status='pending'). Used by AutoApplyBatchPanel and useEnrichmentBatch.
 */
export interface AutoApplyCandidate {
  id: string;
  venue_id: string;
  run_id: string | null;
  field: WebField;
  proposed_value: unknown;
  current_value: unknown;
  decision_reasons: ReasonCode[];
  venueName: string;
}

/**
 * A single write ledger row from venue_enrichment_writes.
 * Append-only: no UPDATE/DELETE grants exist for any client role.
 */
export interface WriteRecord {
  id: string;
  run_id: string | null;
  proposal_id: string | null;
  venue_id: string;
  field: string;
  operation: 'apply' | 'rollback';
  old_value: unknown;
  new_value: unknown;
  applied_mode: AppliedMode | null;
  applied_at: string;
  decision_reasons: ReasonCode[];
  source_url: string | null;
  venues: { name: string } | null;
}

/**
 * A row from venue_enrichment_runs — used for the rollback run selector.
 */
export interface RunRecord {
  id: string;
  venue_id: string;
  run_label: string;
  outcome: string;
  created_at: string;
}

/**
 * A proposal row for the audit/terminal views (auto_reject, report_only).
 */
export interface TerminalProposalRow {
  id: string;
  venue_id: string;
  field: string;
  decision: EnrichmentDecision;
  decision_reasons: ReasonCode[];
  decision_engine_version: string | null;
  status: string;
  created_at: string;
  run_id: string | null;
  venues: { name: string } | null;
}

/**
 * Counts derived from venue_field_proposals — shown in the Run Summary section.
 */
export interface EnrichmentSummaryData {
  total: number;
  autoApplyPending: number;
  manualReviewPending: number;
  autoRejected: number;
  reportOnly: number;
  applied: number;
}

// ── Select column strings ─────────────────────────────────────────────────────

const PROPOSAL_SELECT_COLS =
  'id, venue_id, run_id, field, proposed_value, current_value,' +
  ' confidence, extraction_method, conflicts_existing,' +
  ' source_url, evidence_snippet, evidence_raw,' +
  ' retrieved_at, status,' +
  ' decision, decision_reasons, decision_engine_version, decision_at, applied_mode,' +
  ' venues(name)';

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Fetch pending AND approved (but not yet applied) manual-review proposals,
 * joined to venue name.
 *
 * WHY `decision = 'manual_review'`:
 * Only manual_review rows are actionable cards. auto_reject and report_only
 * are persisted for audit and never shown as actionable items (§2 contract).
 * Legacy pilot rows are backfilled to decision='manual_review' by migration 057,
 * so they continue to appear.
 *
 * WHY include `status='approved'`:
 * The apply step is two-phase: (1) UPDATE status to 'approved', (2) RPC to write
 * the venue field. If step 2 fails (e.g. stale_current_value), the row is left
 * as 'approved' with no venue field written. Fetching approved rows lets the admin
 * see these and use Retry Apply (step 2 only) or Return to Pending.
 *
 * WHY `enabled: isAdmin`:
 * - RLS blocks non-admins anyway, but this avoids unnecessary traffic.
 * - Defence-in-depth: component Redirect guard + data-layer guard.
 *
 * WHY staleTime 30 s:
 * - Proposals change only when the enrichment script runs or an admin acts.
 *   Short staleTime is enough for a human-paced review session.
 */
export function useReviewableProposals(isAdmin: boolean) {
  return useQuery<ProposalRow[]>({
    queryKey: ['enrichment', 'pending-proposals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_field_proposals')
        .select(PROPOSAL_SELECT_COLS)
        .in('status', ['pending', 'approved'])
        .eq('decision', 'manual_review')
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) {
        // Log code + message only — never the row data (may contain business PII).
        console.error('[enrichment] proposals query failed:', error.code, error.message);
        throw error;
      }
      return (data ?? []) as unknown as ProposalRow[];
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });
}

// Back-compat alias (existing tests reference the screen which used this name).
export const usePendingProposals = useReviewableProposals;

/**
 * Counts across venue_field_proposals, optionally scoped to a run_id.
 * Used in the summary strip shown at the top of the admin screen.
 * Fetches only decision+status columns for efficiency (no row data).
 */
export function useEnrichmentSummary(isAdmin: boolean, runId?: string) {
  return useQuery<EnrichmentSummaryData>({
    queryKey: ['enrichment', 'summary', runId ?? 'all'],
    queryFn: async () => {
      const { data, error } = runId
        ? await supabase
            .from('venue_field_proposals')
            .select('decision, status')
            .eq('run_id', runId)
            .limit(10_000)
        : await supabase
            .from('venue_field_proposals')
            .select('decision, status')
            .limit(10_000);

      if (error) {
        console.error('[enrichment] summary query failed:', error.code, error.message);
        throw error;
      }

      const rows = (data ?? []) as { decision: string | null; status: string }[];
      return {
        total: rows.length,
        autoApplyPending:     rows.filter(r => r.decision === 'auto_apply'    && r.status === 'pending').length,
        manualReviewPending:  rows.filter(r => r.decision === 'manual_review' && r.status === 'pending').length,
        autoRejected:         rows.filter(r => r.decision === 'auto_reject').length,
        reportOnly:           rows.filter(r => r.decision === 'report_only').length,
        applied:              rows.filter(r => r.status   === 'applied').length,
      };
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });
}

/**
 * Proposals the engine has routed as safe to auto-apply:
 *   decision='auto_apply' AND status='pending'
 *
 * Used by the "Apply safe changes" preview panel. Opening the preview performs
 * NO write — writes only happen when the admin confirms the batch modal.
 * These are re-queried after each batch run to implement resumability
 * (applied items leave status='pending' via the RPC → 'applied', so they
 * naturally drop out of this result set).
 */
export function useAutoApplyCandidates(isAdmin: boolean) {
  return useQuery<AutoApplyCandidate[]>({
    queryKey: ['enrichment', 'auto-apply-candidates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_field_proposals')
        .select('id, venue_id, run_id, field, proposed_value, current_value, decision_reasons, venues(name)')
        .eq('decision', 'auto_apply')
        .eq('status', 'pending')
        .neq('field', 'description')
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) {
        console.error('[enrichment] auto-apply candidates query failed:', error.code, error.message);
        throw error;
      }

      const rows = (data ?? []) as unknown as {
        id: string;
        venue_id: string;
        run_id: string | null;
        field: WebField;
        proposed_value: unknown;
        current_value: unknown;
        decision_reasons: ReasonCode[];
        venues: { name: string } | null;
      }[];

      return rows.map(r => ({
        id:               r.id,
        venue_id:         r.venue_id,
        run_id:           r.run_id,
        field:            r.field,
        proposed_value:   r.proposed_value,
        current_value:    r.current_value,
        decision_reasons: r.decision_reasons ?? [],
        venueName:        r.venues?.name ?? 'Unknown venue',
      }));
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Applied write ledger rows (operation='apply'), newest first.
 * Used in the Audit / History view to show what was written and when.
 * RLS: writes_admin_select ensures admin-only access.
 */
export function useAppliedWrites(isAdmin: boolean) {
  return useQuery<WriteRecord[]>({
    queryKey: ['enrichment', 'applied-writes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_enrichment_writes')
        .select(
          'id, run_id, proposal_id, venue_id, field, operation,' +
          ' old_value, new_value, applied_mode, applied_at,' +
          ' decision_reasons, source_url,' +
          ' venues(name)'
        )
        .eq('operation', 'apply')
        .order('applied_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[enrichment] applied writes query failed:', error.code, error.message);
        throw error;
      }
      return (data ?? []) as unknown as WriteRecord[];
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });
}

/**
 * Terminal proposal rows: auto_reject and report_only decisions.
 * These are NEVER actionable cards. Rendered in a separate read-only view
 * so admins can see what the engine suppressed without confusing it with
 * manual-review work items.
 */
export function useTerminalProposals(isAdmin: boolean) {
  return useQuery<TerminalProposalRow[]>({
    queryKey: ['enrichment', 'terminal-proposals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_field_proposals')
        .select(
          'id, venue_id, field, decision, decision_reasons,' +
          ' decision_engine_version, status, created_at, run_id,' +
          ' venues(name)'
        )
        .in('decision', ['auto_reject', 'report_only'])
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('[enrichment] terminal proposals query failed:', error.code, error.message);
        throw error;
      }
      return (data ?? []) as unknown as TerminalProposalRow[];
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });
}

/**
 * Enrichment run records for the rollback selector.
 * Fetches runs that have associated apply writes (joined via venue_enrichment_writes).
 * Falls back to all runs ordered by creation time.
 */
export function useEnrichmentRuns(isAdmin: boolean) {
  return useQuery<RunRecord[]>({
    queryKey: ['enrichment', 'runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_enrichment_runs')
        .select('id, venue_id, run_label, outcome, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[enrichment] runs query failed:', error.code, error.message);
        throw error;
      }
      return (data ?? []) as unknown as RunRecord[];
    },
    enabled: isAdmin,
    staleTime: 120_000,
  });
}

/**
 * Write ledger rows for a specific run (both apply and rollback operations).
 * Used to preview what a rollback would undo before the admin confirms.
 */
export function useRunWrites(isAdmin: boolean, runId: string | null) {
  return useQuery<WriteRecord[]>({
    queryKey: ['enrichment', 'run-writes', runId],
    queryFn: async () => {
      if (!runId) return [];
      const { data, error } = await supabase
        .from('venue_enrichment_writes')
        .select(
          'id, run_id, proposal_id, venue_id, field, operation,' +
          ' old_value, new_value, applied_mode, applied_at,' +
          ' decision_reasons, source_url,' +
          ' venues(name)'
        )
        .eq('run_id', runId)
        .order('applied_at', { ascending: true })
        .limit(200);

      if (error) {
        console.error('[enrichment] run writes query failed:', error.code, error.message);
        throw error;
      }
      return (data ?? []) as unknown as WriteRecord[];
    },
    enabled: isAdmin && runId !== null,
    staleTime: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Returns four mutations for resolving proposals.
 *
 * `approveAndApply`:
 *   Step 1 — mark approved via table UPDATE (RLS-gated, no service-role).
 *             Sets reviewed_by / reviewed_at for audit trail.
 *   Step 2 — call `apply_venue_proposal` RPC.
 *   If step 2 fails, the row stays 'approved'. Use retryApply to rerun step 2.
 *
 * `retryApply`:
 *   Step 2 only. Used when step 1 already succeeded (row is 'approved') but
 *   step 2 failed (e.g. stale_current_value after venue data changed).
 *
 * `returnToPending`:
 *   Reset an 'approved' row back to 'pending' (e.g. admin decides value is wrong).
 *
 * `reject`:
 *   Calls `reject_venue_proposal` RPC with admin notes.
 *
 * On success: invalidates pending-proposals + venues caches.
 * On error: does NOT invalidate — proposal card stays visible for inline feedback.
 *
 * Known RPC error codes surfaced to UI:
 *   not_admin | not_approved | stale_current_value | invalid_email |
 *   description_text_required | description_not_rewritten | no_target_column |
 *   not_found | invalid_enum_value | incomplete_week | duplicate_day_of_week
 */
export function useResolveProposal() {
  const queryClient = useQueryClient();

  const invalidateAfterResolve = () => {
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'pending-proposals'] });
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'summary'] });
    // Refresh the Audit tab so newly-applied writes appear immediately.
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'applied-writes'] });
    // Refresh run-scoped write views (used by the Rollback tab Audit column).
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'run-writes'] });
    queryClient.invalidateQueries({ queryKey: ['venues'] });
    queryClient.invalidateQueries({ queryKey: ['venue'] }); // singular — covers venue-detail ['venue', id]
  };

  // ── approveAndApply ───────────────────────────────────────────────────────
  // reviewedBy is passed from the screen (which reads it from the auth store
  // via the React selector) rather than calling useAuthStore.getState() inside
  // the mutation fn — keeps the mutation testable without a full store setup.
  const approveAndApply = useMutation<
    void,
    Error,
    { proposalId: string; appliedText?: string; reviewedBy: string | null }
  >({
    mutationFn: async ({ proposalId, appliedText, reviewedBy }) => {
      // Step 1: mark the proposal as 'approved' (RLS: proposals_admin_all).
      // WHY .select('id'): forces return=representation so a silent RLS no-op
      // is detected as a zero-row error rather than a false 204 success.
      const { data: updated, error: updateErr } = await supabase
        .from('venue_field_proposals')
        .update({
          status:      'approved',
          reviewed_by: reviewedBy,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', proposalId)
        .select('id');

      if (updateErr) throw new Error(updateErr.message);
      if (!updated || updated.length === 0) {
        throw new Error('Status update returned no rows — check admin permissions.');
      }

      // Step 2: write the field value to the venue (stale-guarded inside RPC).
      const { error: rpcErr } = await supabase.rpc('apply_venue_proposal', {
        p_proposal_id:  proposalId,
        p_applied_text: appliedText ?? null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
    },
    onSuccess: invalidateAfterResolve,
    // onError is intentionally omitted — callers pass per-card onError to mutate()
    // to set inline error messages without removing the card.
  });

  // ── retryApply ────────────────────────────────────────────────────────────
  const retryApply = useMutation<
    void,
    Error,
    { proposalId: string; appliedText?: string }
  >({
    mutationFn: async ({ proposalId, appliedText }) => {
      const { error } = await supabase.rpc('apply_venue_proposal', {
        p_proposal_id:  proposalId,
        p_applied_text: appliedText ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidateAfterResolve,
  });

  // ── returnToPending ───────────────────────────────────────────────────────
  const returnToPending = useMutation<void, Error, { proposalId: string }>({
    mutationFn: async ({ proposalId }) => {
      const { data: updated, error } = await supabase
        .from('venue_field_proposals')
        .update({ status: 'pending' })
        .eq('id', proposalId)
        .select('id');

      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) {
        throw new Error('No rows updated — check admin permissions.');
      }
    },
    onSuccess: invalidateAfterResolve,
  });

  // ── reject ────────────────────────────────────────────────────────────────
  const reject = useMutation<
    void,
    Error,
    { proposalId: string; notes: string }
  >({
    mutationFn: async ({ proposalId, notes }) => {
      const { error } = await supabase.rpc('reject_venue_proposal', {
        p_proposal_id: proposalId,
        p_notes:       notes,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidateAfterResolve,
  });

  return { approveAndApply, retryApply, returnToPending, reject };
}

/**
 * Rollback all applied writes from a given run.
 * Calls `rollback_enrichment_run(p_run_id)` RPC (authenticated only; not service-role).
 * On success: invalidates write-related caches so the audit and rollback views refresh.
 *
 * Return shape per item: { write_id, proposal_id, venue_id, field, outcome }
 * outcome ∈ 'restored' | 'already_rolled_back' | 'skipped_newer_change' | 'failed:<msg>'
 *
 * The RPC never edits or deletes original ledger rows — it appends compensating rows.
 * It skips items where a newer human edit has changed the live value (hash mismatch).
 */
export function useRollbackRun() {
  const queryClient = useQueryClient();

  return useMutation<
    RollbackItemResult[],
    Error,
    { runId: string }
  >({
    mutationFn: async ({ runId }) => {
      const { data, error } = await supabase.rpc('rollback_enrichment_run', {
        p_run_id: runId,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as RollbackItemResult[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrichment', 'applied-writes'] });
      queryClient.invalidateQueries({ queryKey: ['enrichment', 'run-writes'] });
      queryClient.invalidateQueries({ queryKey: ['enrichment', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['venues'] });
      queryClient.invalidateQueries({ queryKey: ['venue'] });
    },
  });
}
