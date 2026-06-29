/**
 * hooks/useEnrichmentBatch.ts
 *
 * Isolated, unit-testable sequential batch driver for the "Apply safe changes"
 * auto-apply workflow.
 *
 * SAFETY INVARIANTS (never relax):
 * 1. Calls `auto_apply_venue_proposal` sequentially (one at a time) — no parallelism.
 * 2. Stops IMMEDIATELY on `not_authorized` outcome OR any auth/permission error.
 *    Remaining items are NOT attempted after an auth stop.
 * 3. `stale` and `validation_failed` outcomes → recorded as failed, NEVER counted as applied.
 * 4. Every attempted item gets an explicit result in state.results.
 * 5. Resumable: re-querying useAutoApplyCandidates returns only the remaining pending
 *    candidates (applied items drop out naturally; stale/failed items remain as pending
 *    auto_apply until a human resolves them or a re-run supersedes them).
 * 6. Idempotent against double-tap: uses a ref for synchronous detection of concurrent
 *    calls. If runBatch() is called while already running, the second call is a no-op.
 *    A ref (not setState) is used because setState is async and cannot provide a
 *    synchronous guard.
 * 7. Uses the AUTHENTICATED supabase client only — never service-role.
 * 8. Does NOT log proposal data (only error codes and messages).
 *
 * RPC called: auto_apply_venue_proposal(p_proposal_id uuid, p_applied_text text)
 * Params per call: { p_proposal_id: id, p_applied_text: null }
 * Return: { outcome, field, reason? }
 * outcome ∈ applied | not_authorized | not_pending | moved_to_manual_review | stale | validation_failed
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { AutoApplyOutcome } from '@/types/enrichmentDecision';
import type { AutoApplyCandidate } from './useEnrichmentProposals';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BatchItemOutcome = AutoApplyOutcome | 'unexpected_failure';

export interface BatchResult {
  proposalId: string;
  venueId: string;
  field: string;
  venueName: string;
  /** The RPC outcome or 'unexpected_failure' for network/auth errors. */
  outcome: BatchItemOutcome;
  /** Present for validation_failed with a machine reason code. */
  reason?: string;
  /** Human-readable error message for unexpected_failure. */
  errorMessage?: string;
}

export interface BatchState {
  /** idle → running → (complete | stopped) */
  status: 'idle' | 'running' | 'stopped' | 'complete';
  /** One entry per ATTEMPTED item (not skipped ones). */
  results: BatchResult[];
  /** Items where outcome === 'applied'. Never inflated by stale/failed items. */
  appliedCount: number;
  /** Items where outcome !== 'applied'. */
  failedCount: number;
  /** Set when status === 'stopped'. Explains why the batch was halted. */
  stoppedReason?: string;
}

const INITIAL_STATE: BatchState = {
  status: 'idle',
  results: [],
  appliedCount: 0,
  failedCount: 0,
};

// ── Error message helper ───────────────────────────────────────────────────────

/**
 * Maps auto_apply_venue_proposal outcomes to a concise human-readable message.
 * Extends the enrichmentErrorMessage pattern from the manual-review screen.
 * Never includes row data or proposed values.
 */
export function batchOutcomeMessage(result: BatchResult): string {
  switch (result.outcome) {
    case 'applied':
      return 'Applied successfully.';
    case 'not_authorized':
      return 'Not authorised — batch stopped. Check admin permissions.';
    case 'not_pending':
      return 'Already resolved (not pending).';
    case 'moved_to_manual_review':
      return 'Moved to manual review — live field was not empty.';
    case 'stale':
      return 'Skipped: venue data changed since proposal was created.';
    case 'validation_failed':
      return result.reason
        ? `Validation failed: ${result.reason}.`
        : 'Validation failed.';
    case 'unexpected_failure':
      return result.errorMessage
        ? `Unexpected error: ${result.errorMessage}`
        : 'Unexpected error. Check the console.';
    default:
      return String(result.outcome);
  }
}

// ── Auth / permission error detection ────────────────────────────────────────

/**
 * Returns true when a Supabase RPC error indicates an authentication or
 * permission failure that should halt the entire batch (not just skip one item).
 *
 * Codes:
 *   42501 — insufficient_privilege (PostgreSQL)
 *   PGRST301 — JWT expired (PostgREST)
 *   PGRST302 — JWT invalid (PostgREST)
 */
function isAuthOrPermissionError(error: { code?: string; message?: string }): boolean {
  if (!error) return false;
  if (error.code === '42501' || error.code === 'PGRST301' || error.code === 'PGRST302') {
    return true;
  }
  const msg = error.message ?? '';
  return (
    msg.includes('not_authorized') ||
    msg.includes('JWT') ||
    msg.toLowerCase().includes('permission denied')
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useEnrichmentBatch` — sequential guarded batch driver.
 *
 * Usage:
 *   const { state, runBatch, reset } = useEnrichmentBatch();
 *
 *   // Show preview, await user confirmation, THEN call:
 *   await runBatch(candidates);
 *
 *   // To allow a fresh run after completion:
 *   reset();
 *
 * IDEMPOTENT GUARD:
 * We track running state with a ref, not just React state, because setState
 * updates are batched and async — a concurrent call could slip past a state-only
 * guard before the state update has flushed. The ref is reset in a try/finally
 * block so it is always cleared even when we return early (auth stop, error).
 */
export function useEnrichmentBatch() {
  const [state, setState] = useState<BatchState>(INITIAL_STATE);
  /**
   * Synchronous guard against concurrent runBatch() calls.
   * Updated synchronously (unlike setState), so a second call sees the flag
   * before the first call's state update has been processed by React.
   */
  const isRunningRef = useRef(false);

  /**
   * Runs the batch sequentially. Each item calls auto_apply_venue_proposal
   * exactly once. Stops immediately on not_authorized or an auth/permission error.
   * Does nothing if already running (idempotent double-tap guard).
   */
  const runBatch = useCallback(async (candidates: AutoApplyCandidate[]) => {
    // Synchronous guard — safe against concurrent async calls.
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setState({ status: 'running', results: [], appliedCount: 0, failedCount: 0 });

    // Local accumulators — avoid stale-closure issues with reading React state
    // inside a long-running async function.
    const results: BatchResult[] = [];
    let appliedCount = 0;
    let failedCount  = 0;

    try {
      for (const candidate of candidates) {
        let outcome: BatchItemOutcome = 'unexpected_failure';
        let reason: string | undefined;
        let errorMessage: string | undefined;

        try {
          const { data, error } = await supabase.rpc('auto_apply_venue_proposal', {
            p_proposal_id:  candidate.id,
            // Descriptions are NEVER auto-applied — the RPC returns validation_failed
            // if p_applied_text is null and the field is 'description'.
            p_applied_text: null,
          });

          if (error) {
            // RPC-level error (network, auth, PostgREST protocol).
            outcome      = 'unexpected_failure';
            errorMessage = error.message;
            failedCount++;

            const batchResult: BatchResult = {
              proposalId: candidate.id,
              venueId:    candidate.venue_id,
              field:      candidate.field,
              venueName:  candidate.venueName,
              outcome,
              errorMessage,
            };
            results.push(batchResult);

            // Auth/permission error → stop the entire batch immediately.
            if (isAuthOrPermissionError(error)) {
              setState({
                status:        'stopped',
                results:       [...results],
                appliedCount,
                failedCount,
                stoppedReason: 'Permission or authentication error — batch stopped. Check admin session.',
              });
              return; // ref reset happens in finally
            }

            // Non-auth RPC error (e.g. transient network) → record and continue.
            setState({
              status:       'running',
              results:      [...results],
              appliedCount,
              failedCount,
            });
            continue;
          }

          // RPC returned a structured outcome (no error).
          const applyResult = data as { outcome: AutoApplyOutcome; field: string | null; reason?: string };
          outcome = applyResult.outcome;
          reason  = applyResult.reason;

          if (outcome === 'applied') {
            appliedCount++;
          } else {
            // stale, validation_failed, not_pending, moved_to_manual_review →
            // NEVER counted as applied. The RPC leaves the proposal intact for
            // manual review (moved_to_manual_review) or for a later re-run (stale).
            failedCount++;
          }
        } catch (err) {
          // Unhandled JS exception (e.g. network timeout).
          outcome      = 'unexpected_failure';
          errorMessage = err instanceof Error ? err.message : String(err);
          failedCount++;
        }

        const batchResult: BatchResult = {
          proposalId: candidate.id,
          venueId:    candidate.venue_id,
          field:      candidate.field,
          venueName:  candidate.venueName,
          outcome,
          reason,
          errorMessage,
        };
        results.push(batchResult);

        // Stop immediately on not_authorized (RPC returned it as a JSON outcome,
        // not as a Supabase error).
        if (outcome === 'not_authorized') {
          setState({
            status:        'stopped',
            results:       [...results],
            appliedCount,
            failedCount,
            stoppedReason: 'Not authorised — batch stopped. Check admin permissions and session.',
          });
          return; // ref reset happens in finally
        }

        // Update progress after each item (live progress display).
        setState({
          status:       'running',
          results:      [...results],
          appliedCount,
          failedCount,
        });
      }

      setState({
        status:       'complete',
        results:      [...results],
        appliedCount,
        failedCount,
      });
    } finally {
      // Always reset the ref — even when we return early (auth stop, error).
      isRunningRef.current = false;
    }
  }, []);

  /** Resets the batch state to idle so a fresh batch can be started. */
  const reset = useCallback(() => {
    isRunningRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  return { state, runBatch, reset };
}
