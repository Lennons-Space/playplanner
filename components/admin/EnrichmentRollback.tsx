/**
 * components/admin/EnrichmentRollback.tsx
 *
 * Run-scoped rollback panel for the admin enrichment screen.
 *
 * FLOW:
 *   1. Select a run from venue_enrichment_runs.
 *   2. Preview its recorded apply writes (read-only).
 *   3. Explain that newer human edits are protected by the stale guard.
 *   4. Admin confirms → call rollback_enrichment_run(run_id).
 *   5. Display per-item results: restored / already_rolled_back /
 *      skipped_newer_change / failed:<msg>.
 *
 * SAFETY:
 * - No direct UPDATE/DELETE. The RPC appends compensating ledger rows only.
 * - The RPC skips items where a newer human edit has changed the live value
 *   (hash mismatch → skipped_newer_change). This protects human edits.
 * - rollback_enrichment_run is authenticated-only (not service-role).
 * - Opening the preview, selecting a run, and inspecting writes all perform NO write.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useEnrichmentRuns, useRunWrites, useRollbackRun } from '@/hooks/useEnrichmentProposals';
import type { RunRecord, WriteRecord } from '@/hooks/useEnrichmentProposals';
import type { RollbackItemResult } from '@/types/enrichmentDecision';

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
  if (v === null || v === undefined) return '(none)';
  if (!v || typeof v !== 'object') return String(v);
  const val = (v as Record<string, unknown>)['v'];
  if (typeof val === 'string') return val.length > 0 ? val : '(empty)';
  return JSON.stringify(val).slice(0, 40);
}

function rollbackOutcomeLabel(outcome: string): { label: string; colour: string } {
  if (outcome === 'restored') return { label: 'Restored', colour: 'text-success' };
  if (outcome === 'already_rolled_back') return { label: 'Already rolled back', colour: 'text-grey' };
  if (outcome === 'skipped_newer_change') return { label: 'Skipped (newer edit)', colour: 'text-sun' };
  if (outcome.startsWith('failed:')) return { label: `Failed: ${outcome.slice(7)}`, colour: 'text-error' };
  return { label: outcome, colour: 'text-grey' };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RunSelectorRow({
  run,
  isSelected,
  onSelect,
}: {
  run: RunRecord;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      testID={`run-selector-${run.id}`}
      className={`flex-row items-center px-3 py-2 mb-1 rounded-xl ${
        isSelected ? 'bg-sky' : 'bg-sandDark'
      }`}
      onPress={() => onSelect(run.id)}
    >
      <View className="flex-1">
        <Text className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-charcoal'}`} numberOfLines={1}>
          {run.run_label}
        </Text>
        <Text className={`text-xs ${isSelected ? 'text-white/80' : 'text-grey'}`}>
          {new Date(run.created_at).toLocaleString('en-GB')}
        </Text>
      </View>
      <Text className={`text-xs ${isSelected ? 'text-white' : 'text-grey'}`}>
        {run.outcome.replace(/_/g, ' ')}
      </Text>
    </TouchableOpacity>
  );
}

function WritePreviewRow({ write }: { write: WriteRecord }) {
  return (
    <View testID={`rollback-preview-write-${write.id}`} className="flex-row items-center py-1.5 border-b border-greyLighter">
      <Text className="flex-1 text-charcoal text-xs font-bold" numberOfLines={1}>
        {write.venues?.name ?? write.venue_id.slice(0, 8)}
      </Text>
      <Text className="w-20 text-grey text-xs">{fieldLabel(write.field)}</Text>
      <Text className="flex-1 text-grey text-xs" numberOfLines={1}>
        {scalarDisplay(write.new_value)} → {scalarDisplay(write.old_value)}
      </Text>
    </View>
  );
}

function RollbackResultRow({ result, venueName }: { result: RollbackItemResult; venueName?: string }) {
  const { label, colour } = rollbackOutcomeLabel(result.outcome);
  return (
    <View
      testID={`rollback-result-${result.write_id}`}
      className="flex-row items-center py-1.5 border-b border-greyLighter"
    >
      <Text className="flex-1 text-charcoal text-xs font-bold" numberOfLines={1}>
        {venueName ?? result.venue_id.slice(0, 8) + '…'}
      </Text>
      <Text className="w-20 text-grey text-xs">{fieldLabel(result.field)}</Text>
      <Text className={`flex-1 text-xs font-bold ${colour}`} numberOfLines={2}>{label}</Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  isAdmin: boolean;
}

export function EnrichmentRollback({ isAdmin }: Props) {
  const [selectedRunId, setSelectedRunId]       = useState<string | null>(null);
  const [confirmModalVisible, setConfirmModal]  = useState(false);
  const [rollbackResults, setRollbackResults]   = useState<RollbackItemResult[] | null>(null);

  const { data: runs = [], isLoading: runsLoading } = useEnrichmentRuns(isAdmin);
  const { data: writes = [], isLoading: writesLoading } = useRunWrites(isAdmin, selectedRunId);
  const rollbackMutation = useRollbackRun();

  const applyWrites = writes.filter(w => w.operation === 'apply');

  // Build a venue_id → name lookup from the write ledger (writes carry a venues join).
  // Used to show the venue name in rollback result rows instead of a raw UUID slice.
  const venueNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of writes) {
      if (w.venues?.name) m.set(w.venue_id, w.venues.name);
    }
    return m;
  }, [writes]);

  const handleSelectRun = (id: string) => {
    setSelectedRunId(id === selectedRunId ? null : id);
    setRollbackResults(null);
  };

  const handleRollback = async () => {
    if (!selectedRunId) return;
    setConfirmModal(false);
    try {
      const results = await rollbackMutation.mutateAsync({ runId: selectedRunId });
      setRollbackResults(results);
    } catch {
      // Error surfaced via rollbackMutation.error
    }
  };

  return (
    <ScrollView testID="enrichment-rollback" className="flex-1" contentContainerClassName="px-4 pb-8">

      {/* Confirmation modal */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View testID="rollback-confirm-modal" className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-extrabold text-lg mb-3">Confirm rollback</Text>
            <Text className="text-charcoal text-sm mb-3">
              This will restore {applyWrites.length} field value{applyWrites.length !== 1 ? 's' : ''} to
              their state before the enrichment run.
            </Text>
            <View className="bg-success/10 border border-success rounded-xl px-3 py-2 mb-3">
              <Text className="text-success text-xs font-bold">
                Human edits are protected: any field modified by a human after the enrichment
                run was applied will be SKIPPED automatically (the stale guard detects the
                newer value).
              </Text>
            </View>
            <View className="bg-sandDark rounded-xl px-3 py-2 mb-4">
              <Text className="text-grey text-xs">
                Original write ledger rows are preserved. Rollback appends a compensating
                row — history is never edited or deleted.
              </Text>
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity
                testID="rollback-confirm-cancel"
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={() => setConfirmModal(false)}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="rollback-confirm-confirm"
                className="flex-1 bg-error rounded-xl py-3 items-center"
                disabled={rollbackMutation.isPending}
                accessibilityState={{ disabled: rollbackMutation.isPending }}
                onPress={handleRollback}
              >
                {rollbackMutation.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">Rollback run</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Run selector */}
      <Text className="text-grey font-bold uppercase text-xs mt-4 mb-2">
        Select enrichment run
      </Text>
      {runsLoading && <ActivityIndicator color="#FF6B6B" className="mb-4" />}
      {!runsLoading && runs.length === 0 && (
        <Text className="text-grey text-sm mb-4">No enrichment runs recorded yet.</Text>
      )}
      {runs.map((run) => (
        <RunSelectorRow
          key={run.id}
          run={run}
          isSelected={run.id === selectedRunId}
          onSelect={handleSelectRun}
        />
      ))}

      {/* Write preview for selected run */}
      {selectedRunId && (
        <>
          <Text className="text-grey font-bold uppercase text-xs mt-4 mb-2">
            Writes in this run ({applyWrites.length} apply)
          </Text>

          {writesLoading && <ActivityIndicator color="#FF6B6B" className="mb-4" />}

          {!writesLoading && applyWrites.length === 0 && (
            <View className="bg-sandDark rounded-xl px-3 py-3 mb-3">
              <Text testID="rollback-no-writes" className="text-grey text-sm text-center">
                No applied writes found for this run. Nothing to roll back.
              </Text>
            </View>
          )}

          {!writesLoading && applyWrites.length > 0 && (
            <>
              <View className="bg-success/10 border border-success rounded-xl px-3 py-2 mb-3">
                <Text className="text-success text-xs font-bold">
                  Human edits since this run will be protected automatically — those items
                  will be skipped (skipped_newer_change).
                </Text>
              </View>

              <View testID="rollback-write-preview" className="bg-white rounded-2xl p-3 mb-4">
                <View className="flex-row pb-1 border-b border-greyLighter mb-1">
                  <Text className="flex-1 text-grey text-xs font-bold uppercase">Venue</Text>
                  <Text className="w-20 text-grey text-xs font-bold uppercase">Field</Text>
                  <Text className="flex-1 text-grey text-xs font-bold uppercase">New → Restore to</Text>
                </View>
                {applyWrites.map((w) => (
                  <WritePreviewRow key={w.id} write={w} />
                ))}
              </View>

              {rollbackMutation.error && (
                <View className="bg-error/10 border border-error rounded-xl px-3 py-2 mb-3">
                  <Text className="text-error text-xs font-bold">
                    Rollback error: {rollbackMutation.error.message}
                  </Text>
                </View>
              )}

              {!rollbackResults && (
                <TouchableOpacity
                  testID="rollback-btn"
                  className="bg-error rounded-xl py-3 items-center mb-4"
                  disabled={rollbackMutation.isPending}
                  accessibilityState={{ disabled: rollbackMutation.isPending }}
                  onPress={() => setConfirmModal(true)}
                >
                  <Text className="text-white font-bold">
                    Rollback {applyWrites.length} write{applyWrites.length !== 1 ? 's' : ''}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Rollback results */}
          {rollbackResults && (
            <>
              <Text className="text-grey font-bold uppercase text-xs mb-2">
                Rollback results
              </Text>
              <View testID="rollback-results" className="bg-white rounded-2xl p-3 mb-4">
                <View className="flex-row pb-1 border-b border-greyLighter mb-1">
                  <Text className="flex-1 text-grey text-xs font-bold uppercase">Venue</Text>
                  <Text className="w-20 text-grey text-xs font-bold uppercase">Field</Text>
                  <Text className="flex-1 text-grey text-xs font-bold uppercase">Outcome</Text>
                </View>
                {rollbackResults.map((r) => (
                  <RollbackResultRow key={r.write_id} result={r} venueName={venueNameById.get(r.venue_id)} />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
