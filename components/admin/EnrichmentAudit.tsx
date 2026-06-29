/**
 * components/admin/EnrichmentAudit.tsx
 *
 * Read-only audit / history view for the admin enrichment screen.
 *
 * Two sub-tabs:
 *   "Write history"   — rows from venue_enrichment_writes (apply + rollback)
 *   "Engine decisions" — auto_reject and report_only proposals (never actionable)
 *
 * SECURITY:
 * - Only SELECT. No mutations here.
 * - RLS policies (writes_admin_select, proposals_admin_all) gate all reads.
 * - No row data is logged.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useAppliedWrites, useTerminalProposals } from '@/hooks/useEnrichmentProposals';
import { REASON_LABELS } from '@/types/enrichmentDecision';
import type { WriteRecord, TerminalProposalRow } from '@/hooks/useEnrichmentProposals';
import type { ReasonCode } from '@/types/enrichmentDecision';

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
  if (Array.isArray(val)) return `[${(val as unknown[]).length} entries]`;
  return JSON.stringify(val).slice(0, 60);
}

function ReasonChips({ codes }: { codes: ReasonCode[] }) {
  if (!codes || codes.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-1 mt-1">
      {codes.map((code) => (
        <View key={code} className="bg-sandDark rounded-full px-2 py-0.5">
          <Text className="text-grey text-xs">{REASON_LABELS[code] ?? code}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Write history row ─────────────────────────────────────────────────────────

function WriteHistoryRow({ record }: { record: WriteRecord }) {
  const isRollback = record.operation === 'rollback';
  return (
    <View
      testID={`write-record-${record.id}`}
      className="bg-white rounded-xl p-3 mb-2 shadow-sm"
    >
      <View className="flex-row items-center gap-2 flex-wrap mb-1">
        <View className="bg-sandDark rounded-full px-2 py-0.5">
          <Text className="text-charcoal text-xs font-bold uppercase">
            {fieldLabel(record.field)}
          </Text>
        </View>
        <View className={`rounded-full px-2 py-0.5 ${isRollback ? 'bg-sun/20' : 'bg-success/20'}`}>
          <Text className={`text-xs font-bold uppercase ${isRollback ? 'text-sun' : 'text-success'}`}>
            {record.operation}
          </Text>
        </View>
        {record.applied_mode && (
          <View className="bg-sky/10 rounded-full px-2 py-0.5">
            <Text className="text-sky text-xs">{record.applied_mode}</Text>
          </View>
        )}
      </View>

      <Text className="text-charcoal text-xs font-bold mb-0.5">
        {record.venues?.name ?? record.venue_id}
      </Text>

      <View className="flex-row gap-4 mt-1">
        <View className="flex-1">
          <Text className="text-grey text-xs font-bold uppercase mb-0.5">Before</Text>
          <Text className="text-charcoal text-xs" numberOfLines={2}>
            {scalarDisplay(record.old_value)}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-grey text-xs font-bold uppercase mb-0.5">After</Text>
          <Text className="text-charcoal text-xs" numberOfLines={2}>
            {scalarDisplay(record.new_value)}
          </Text>
        </View>
      </View>

      <ReasonChips codes={record.decision_reasons as ReasonCode[]} />

      <Text className="text-grey text-xs mt-1">
        {new Date(record.applied_at).toLocaleString('en-GB')}
        {record.run_id && (
          <Text className="font-mono"> · Run: {record.run_id.slice(0, 8)}…</Text>
        )}
      </Text>
    </View>
  );
}

// ── Terminal proposal row ─────────────────────────────────────────────────────

function TerminalRow({ row }: { row: TerminalProposalRow }) {
  const isAutoReject = row.decision === 'auto_reject';
  return (
    <View
      testID={`terminal-proposal-${row.id}`}
      className="bg-white rounded-xl p-3 mb-2 shadow-sm"
    >
      <View className="flex-row items-center gap-2 flex-wrap mb-1">
        <View className="bg-sandDark rounded-full px-2 py-0.5">
          <Text className="text-charcoal text-xs font-bold uppercase">
            {fieldLabel(row.field)}
          </Text>
        </View>
        <View className={`rounded-full px-2 py-0.5 ${isAutoReject ? 'bg-error/10' : 'bg-sky/10'}`}>
          <Text className={`text-xs font-bold ${isAutoReject ? 'text-error' : 'text-sky'}`}>
            {isAutoReject ? 'AUTO-REJECTED' : 'REPORT-ONLY'}
          </Text>
        </View>
      </View>

      <Text className="text-charcoal text-xs font-bold mb-0.5">
        {row.venues?.name ?? row.venue_id}
      </Text>

      <ReasonChips codes={row.decision_reasons as ReasonCode[]} />

      <Text className="text-grey text-xs mt-1">
        {new Date(row.created_at).toLocaleString('en-GB')}
        {row.decision_engine_version && (
          <Text className="font-mono"> · {row.decision_engine_version}</Text>
        )}
      </Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  isAdmin: boolean;
}

type AuditSubTab = 'writes' | 'decisions';

export function EnrichmentAudit({ isAdmin }: Props) {
  const [subTab, setSubTab] = useState<AuditSubTab>('writes');

  const {
    data: writes = [],
    isLoading: writesLoading,
  } = useAppliedWrites(isAdmin);

  const {
    data: terminal = [],
    isLoading: terminalLoading,
  } = useTerminalProposals(isAdmin);

  return (
    <View testID="enrichment-audit" className="flex-1">
      {/* Sub-tab bar */}
      <View className="flex-row px-4 py-2 gap-2">
        <TouchableOpacity
          testID="audit-tab-writes"
          className={`flex-1 py-2 rounded-xl items-center ${subTab === 'writes' ? 'bg-sky' : 'bg-sandDark'}`}
          onPress={() => setSubTab('writes')}
        >
          <Text className={`text-xs font-bold ${subTab === 'writes' ? 'text-white' : 'text-charcoal'}`}>
            Write history
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="audit-tab-decisions"
          className={`flex-1 py-2 rounded-xl items-center ${subTab === 'decisions' ? 'bg-sky' : 'bg-sandDark'}`}
          onPress={() => setSubTab('decisions')}
        >
          <Text className={`text-xs font-bold ${subTab === 'decisions' ? 'text-white' : 'text-charcoal'}`}>
            Engine decisions
          </Text>
        </TouchableOpacity>
      </View>

      {/* Write history */}
      {subTab === 'writes' && (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8">
          {writesLoading && <ActivityIndicator color="#FF6B6B" className="mt-8" />}
          {!writesLoading && writes.length === 0 && (
            <Text testID="audit-writes-empty" className="text-grey text-center mt-8">
              No write history yet.
            </Text>
          )}
          {writes.map((w) => (
            <WriteHistoryRow key={w.id} record={w} />
          ))}
        </ScrollView>
      )}

      {/* Engine decisions (auto_reject + report_only) */}
      {subTab === 'decisions' && (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8">
          <View className="bg-sandDark rounded-xl px-3 py-2 mt-2 mb-3">
            <Text className="text-grey text-xs">
              Auto-rejected and report-only proposals are recorded for audit purposes only.
              They are NEVER actionable cards and are never applied automatically.
            </Text>
          </View>
          {terminalLoading && <ActivityIndicator color="#FF6B6B" className="mt-8" />}
          {!terminalLoading && terminal.length === 0 && (
            <Text testID="audit-decisions-empty" className="text-grey text-center mt-8">
              No engine decisions recorded yet.
            </Text>
          )}
          {terminal.map((t) => (
            <TerminalRow key={t.id} row={t} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
