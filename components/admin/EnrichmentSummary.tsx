/**
 * components/admin/EnrichmentSummary.tsx
 *
 * Read-only summary strip showing counts across the enrichment pipeline.
 * Displayed above the tab bar on the admin enrichment screen so it is
 * always visible regardless of the active tab.
 *
 * Props:
 *   isAdmin  — query is disabled when false (RLS defence-in-depth).
 *   runId    — when provided, counts are scoped to that run_id.
 *              When undefined, shows overall counts across all runs.
 */

import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useEnrichmentSummary } from '@/hooks/useEnrichmentProposals';

interface Props {
  isAdmin: boolean;
  runId?: string;
}

export function EnrichmentSummary({ isAdmin, runId }: Props) {
  const { data, isLoading, error } = useEnrichmentSummary(isAdmin, runId);

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <View testID="enrichment-summary-loading" className="px-4 py-2">
        <ActivityIndicator size="small" color="#FF6B6B" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View testID="enrichment-summary-error" className="px-4 py-1">
        <Text className="text-error text-xs">Could not load summary.</Text>
      </View>
    );
  }

  return (
    <View
      testID="enrichment-summary"
      className="flex-row flex-wrap gap-2 px-4 py-2"
    >
      <SummaryChip
        testID="summary-auto-apply"
        label="Safe to apply"
        count={data.autoApplyPending}
        colour="bg-success"
        textColour="text-white"
      />
      <SummaryChip
        testID="summary-manual-review"
        label="Manual review"
        count={data.manualReviewPending}
        colour="bg-sky"
        textColour="text-white"
      />
      <SummaryChip
        testID="summary-applied"
        label="Applied"
        count={data.applied}
        colour="bg-success/20"
        textColour="text-charcoal"
      />
      <SummaryChip
        testID="summary-auto-rejected"
        label="Auto-rejected"
        count={data.autoRejected}
        colour="bg-sandDark"
        textColour="text-grey"
      />
      <SummaryChip
        testID="summary-report-only"
        label="Report-only"
        count={data.reportOnly}
        colour="bg-sandDark"
        textColour="text-grey"
      />
      {runId && (
        <View className="bg-sky/10 rounded-full px-2 py-0.5">
          <Text className="text-sky text-xs font-bold">Run-scoped</Text>
        </View>
      )}
    </View>
  );
}

function SummaryChip({
  testID,
  label,
  count,
  colour,
  textColour,
}: {
  testID: string;
  label: string;
  count: number;
  colour: string;
  textColour: string;
}) {
  return (
    <View testID={testID} className={`${colour} rounded-full px-3 py-0.5 flex-row items-center gap-1`}>
      <Text className={`${textColour} text-xs font-bold`}>{count}</Text>
      <Text className={`${textColour} text-xs`}>{label}</Text>
    </View>
  );
}
