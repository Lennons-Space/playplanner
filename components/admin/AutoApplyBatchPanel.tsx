/**
 * components/admin/AutoApplyBatchPanel.tsx
 *
 * "Apply safe changes" panel — the auto-apply workflow for the admin screen.
 *
 * FLOW:
 *   idle → [View N safe changes] → preview → [Apply N Safe Changes] →
 *   confirmation modal → [Confirm] → running (sequential RPC calls) → complete
 *
 * SAFETY:
 * - Opening the preview performs NO write.
 * - The batch does NOT start until the admin explicitly confirms the modal.
 * - The batch driver (useEnrichmentBatch) stops immediately on auth failure.
 * - stale and validation_failed outcomes are never counted as applied.
 * - Descriptions are never auto-applied (RPC returns validation_failed for them).
 * - The panel states explicitly that no valid non-empty values are being replaced
 *   (the RPC moves those to manual_review; they are excluded from this candidate list).
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useAutoApplyCandidates } from '@/hooks/useEnrichmentProposals';
import { useEnrichmentBatch, batchOutcomeMessage } from '@/hooks/useEnrichmentBatch';
import type { AutoApplyCandidate } from '@/hooks/useEnrichmentProposals';
import type { BatchResult } from '@/hooks/useEnrichmentBatch';
import { useQueryClient } from '@tanstack/react-query';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    phone: 'Phone', email: 'Email', website: 'Website',
    price_range: 'Price Range', description: 'Description',
    opening_hours: 'Opening Hours', booking_url: 'Booking URL',
  };
  return map[field] ?? field;
}

function scalarDisplay(v: unknown): string {
  if (!v || typeof v !== 'object') return '(empty)';
  const val = (v as Record<string, unknown>)['v'];
  return typeof val === 'string' && val.length > 0 ? val : '(empty)';
}

function outcomeColour(outcome: string): string {
  if (outcome === 'applied') return 'text-success';
  if (outcome === 'not_authorized') return 'text-error';
  if (outcome === 'stale' || outcome === 'moved_to_manual_review') return 'text-sun';
  return 'text-error';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CandidateRow({ candidate }: { candidate: AutoApplyCandidate }) {
  return (
    <View className="flex-row items-start py-1.5 border-b border-greyLighter">
      <Text className="flex-1 text-charcoal text-xs font-bold" numberOfLines={1}>
        {candidate.venueName}
      </Text>
      <Text className="w-20 text-grey text-xs" numberOfLines={1}>
        {fieldLabel(candidate.field)}
      </Text>
      <Text className="flex-1 text-grey text-xs" numberOfLines={1}>
        {scalarDisplay(candidate.current_value)} → {scalarDisplay(candidate.proposed_value)}
      </Text>
    </View>
  );
}

function ResultRow({ result }: { result: BatchResult }) {
  const colour = outcomeColour(result.outcome);
  return (
    <View
      testID={`batch-result-${result.proposalId}`}
      className="flex-row items-start py-1.5 border-b border-greyLighter"
    >
      <Text className="flex-1 text-charcoal text-xs font-bold" numberOfLines={1}>
        {result.venueName}
      </Text>
      <Text className="w-20 text-grey text-xs" numberOfLines={1}>
        {fieldLabel(result.field)}
      </Text>
      <Text className={`flex-1 text-xs font-bold ${colour}`} numberOfLines={2}>
        {batchOutcomeMessage(result)}
      </Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  isAdmin: boolean;
}

type PanelPhase = 'idle' | 'preview' | 'confirming' | 'results';

export function AutoApplyBatchPanel({ isAdmin }: Props) {
  const queryClient                   = useQueryClient();
  const { data: candidates = [], isLoading, refetch } = useAutoApplyCandidates(isAdmin);
  const { state, runBatch, reset }    = useEnrichmentBatch();
  const [phase, setPhase]             = useState<PanelPhase>('idle');

  // Unique run IDs across candidates (for audit/rollback reference display).
  const runIds = useMemo(() => {
    const ids = new Set(candidates.map(c => c.run_id).filter(Boolean) as string[]);
    return Array.from(ids);
  }, [candidates]);

  // Unique fields affected.
  const fieldsAffected = useMemo(() => {
    return Array.from(new Set(candidates.map(c => fieldLabel(c.field))));
  }, [candidates]);

  const venueCount  = useMemo(() => new Set(candidates.map(c => c.venue_id)).size, [candidates]);
  const totalFields = candidates.length;

  const isRunning  = state.status === 'running';
  const isDone     = state.status === 'complete' || state.status === 'stopped';

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleViewPreview = () => setPhase('preview');
  const handleCancelPreview = () => setPhase('idle');

  const handleOpenConfirm = () => setPhase('confirming');
  const handleCancelConfirm = () => setPhase('preview');

  const handleConfirmBatch = async () => {
    setPhase('results');
    // NOTE: the isRunningRef guard inside useEnrichmentBatch prevents a second runBatch()
    // call from starting while this one is in flight — within this mounted hook instance.
    // Navigating away and remounting opens a narrow window where a new instance could
    // theoretically start concurrently; the server-side proposal status + stale hash
    // checks inside the RPC are the authoritative guard against any such race.
    await runBatch(candidates);
    // Invalidate candidates cache so a re-load shows only remaining pending items.
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'auto-apply-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'summary'] });
    // Refresh the Review tab (items moved_to_manual_review appear there).
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'pending-proposals'] });
    // Refresh the Audit tab (newly-applied writes appear there).
    queryClient.invalidateQueries({ queryKey: ['enrichment', 'applied-writes'] });
    queryClient.invalidateQueries({ queryKey: ['venues'] });
    queryClient.invalidateQueries({ queryKey: ['venue'] });
  };

  const handleReset = () => {
    reset();
    setPhase('idle');
    refetch();
  };

  // ── Loading / empty state ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View testID="auto-apply-loading" className="items-center py-12">
        <ActivityIndicator color="#FF6B6B" />
      </View>
    );
  }

  if (candidates.length === 0 && phase === 'idle') {
    return (
      <View testID="auto-apply-empty" className="items-center py-12 px-6">
        <Text className="text-charcoal font-bold text-center">No safe changes ready</Text>
        <Text className="text-grey text-sm text-center mt-1">
          All auto-apply candidates have been applied or are awaiting a new enrichment run.
        </Text>
      </View>
    );
  }

  // ── Results view ──────────────────────────────────────────────────────────

  if (phase === 'results') {
    return (
      <ScrollView testID="batch-results-view" className="flex-1" contentContainerClassName="px-4 pb-8">
        <View className="mb-4 mt-2">
          <Text className="text-charcoal font-extrabold text-base mb-1">Batch Results</Text>
          {isRunning && (
            <View className="flex-row items-center gap-2 mb-2">
              <ActivityIndicator size="small" color="#FF6B6B" />
              <Text className="text-grey text-sm">Applying… ({state.results.length}/{candidates.length})</Text>
            </View>
          )}
          {isDone && (
            <View className="flex-row gap-3 mb-3">
              <View testID="batch-applied-count" className="bg-success/20 rounded-full px-3 py-0.5">
                <Text className="text-success text-xs font-bold">{state.appliedCount} applied</Text>
              </View>
              {state.failedCount > 0 && (
                <View testID="batch-failed-count" className="bg-error/10 rounded-full px-3 py-0.5">
                  <Text className="text-error text-xs font-bold">{state.failedCount} skipped/failed</Text>
                </View>
              )}
              {state.status === 'stopped' && (
                <View testID="batch-stopped-badge" className="bg-error rounded-full px-3 py-0.5">
                  <Text className="text-white text-xs font-bold">Stopped</Text>
                </View>
              )}
            </View>
          )}
          {state.status === 'stopped' && state.stoppedReason && (
            <View className="bg-error/10 border border-error rounded-xl px-3 py-2 mb-3">
              <Text testID="batch-stopped-reason" className="text-error text-xs font-bold">
                {state.stoppedReason}
              </Text>
            </View>
          )}
        </View>

        {/* Per-item results */}
        <View className="bg-white rounded-2xl p-3">
          <View className="flex-row pb-1 border-b border-greyLighter mb-1">
            <Text className="flex-1 text-grey text-xs font-bold uppercase">Venue</Text>
            <Text className="w-20 text-grey text-xs font-bold uppercase">Field</Text>
            <Text className="flex-1 text-grey text-xs font-bold uppercase">Result</Text>
          </View>
          {state.results.map((r) => (
            <ResultRow key={r.proposalId} result={r} />
          ))}
          {isRunning && (
            <View className="py-2 items-center">
              <ActivityIndicator size="small" color="#FF6B6B" />
            </View>
          )}
        </View>

        {isDone && (
          <TouchableOpacity
            testID="batch-reset-btn"
            className="mt-4 bg-sky rounded-xl py-3 items-center"
            onPress={handleReset}
          >
            <Text className="text-white font-bold">Done</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // ── Confirmation modal ────────────────────────────────────────────────────

  return (
    <>
      <Modal
        testID="batch-confirm-modal"
        visible={phase === 'confirming'}
        transparent
        animationType="fade"
        onRequestClose={handleCancelConfirm}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View testID="batch-confirm-modal-content" className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-extrabold text-lg mb-4">Confirm batch apply</Text>

            <Text className="text-grey text-xs font-bold uppercase mb-1">Changes</Text>
            <Text testID="confirm-batch-count" className="text-charcoal font-bold text-sm mb-3">
              {totalFields} field write{totalFields !== 1 ? 's' : ''} across {venueCount} venue{venueCount !== 1 ? 's' : ''}
            </Text>

            <Text className="text-grey text-xs font-bold uppercase mb-1">Fields affected</Text>
            <Text testID="confirm-batch-fields" className="text-charcoal text-sm mb-3">
              {fieldsAffected.join(', ')}
            </Text>

            {runIds.length > 0 && (
              <>
                <Text className="text-grey text-xs font-bold uppercase mb-1">Run ID(s) for audit</Text>
                <Text className="text-charcoal text-xs font-mono mb-3" numberOfLines={2}>
                  {runIds.join('\n')}
                </Text>
              </>
            )}

            <View className="bg-success/10 border border-success rounded-xl px-3 py-2 mb-3">
              <Text testID="confirm-no-replace-warning" className="text-success text-xs font-bold">
                No valid non-empty fields will be replaced. Each write is individually
                guarded — if a field has become non-empty since the proposal was created,
                the RPC moves it to manual review rather than overwriting.
              </Text>
            </View>

            <View className="bg-sandDark rounded-xl px-3 py-2 mb-4">
              <Text className="text-grey text-xs">
                Failed or stale items will NOT be falsely marked as applied.
                The batch can be safely re-run — already-applied items drop out automatically.
              </Text>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                testID="batch-confirm-cancel"
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={handleCancelConfirm}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="batch-confirm-confirm"
                className="flex-1 bg-success rounded-xl py-3 items-center"
                onPress={handleConfirmBatch}
              >
                <Text className="text-white font-bold">Apply {totalFields} changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Preview / idle panel ──────────────────────────────────────────── */}
      <ScrollView testID="auto-apply-panel" className="flex-1" contentContainerClassName="px-4 pb-8">
        {phase === 'idle' && (
          <View className="mt-4">
            <View className="bg-success/10 border border-success rounded-2xl p-4 mb-3">
              <Text className="text-success font-bold text-base mb-1">
                {totalFields} safe change{totalFields !== 1 ? 's' : ''} ready
              </Text>
              <Text className="text-charcoal text-sm mb-1">
                {venueCount} venue{venueCount !== 1 ? 's' : ''} · Fields: {fieldsAffected.join(', ')}
              </Text>
              <Text className="text-grey text-xs">
                These changes fill empty or invalid fields. No existing valid values are replaced.
              </Text>
            </View>
            <TouchableOpacity
              testID="view-preview-btn"
              className="bg-sky rounded-xl py-3 items-center"
              onPress={handleViewPreview}
            >
              <Text className="text-white font-bold">View {totalFields} safe changes</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'preview' && (
          <>
            {/* Safety statement */}
            <View className="bg-success/10 border border-success rounded-xl px-3 py-2 mt-4 mb-3">
              <Text testID="preview-no-replace-statement" className="text-success text-xs font-bold">
                None of these changes replace valid existing values.
                The RPC re-enforces this guard at write time — if a value has been added
                since the proposal was created, the item moves to manual review automatically.
              </Text>
            </View>

            {/* Run IDs */}
            {runIds.length > 0 && (
              <View className="bg-sandDark rounded-xl px-3 py-2 mb-3">
                <Text className="text-grey text-xs font-bold uppercase mb-1">Run ID(s) for rollback</Text>
                <Text testID="preview-run-ids" className="text-charcoal text-xs font-mono" numberOfLines={3}>
                  {runIds.join('\n')}
                </Text>
              </View>
            )}

            {/* Candidate table */}
            <View testID="auto-apply-candidate-list" className="bg-white rounded-2xl p-3 mb-4">
              <View className="flex-row pb-1 border-b border-greyLighter mb-1">
                <Text className="flex-1 text-grey text-xs font-bold uppercase">Venue</Text>
                <Text className="w-20 text-grey text-xs font-bold uppercase">Field</Text>
                <Text className="flex-1 text-grey text-xs font-bold uppercase">Current → New</Text>
              </View>
              {candidates.map((c) => (
                <CandidateRow key={c.id} candidate={c} />
              ))}
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                testID="preview-cancel-btn"
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={handleCancelPreview}
              >
                <Text className="text-charcoal font-bold">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="apply-safe-changes-btn"
                className="flex-1 bg-success rounded-xl py-3 items-center"
                onPress={handleOpenConfirm}
              >
                <Text className="text-white font-bold">Apply {totalFields} safe changes</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
