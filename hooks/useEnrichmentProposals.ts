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
  venues: { name: string } | null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Fetch pending AND approved (but not yet applied) proposals joined to venue name.
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
        .select(
          'id, venue_id, field, proposed_value, current_value,' +
          ' confidence, extraction_method, conflicts_existing,' +
          ' source_url, evidence_snippet, evidence_raw,' +
          ' retrieved_at, status,' +
          ' venues(name)'
        )
        .in('status', ['pending', 'approved'])
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
    queryClient.invalidateQueries({ queryKey: ['venues'] });
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
