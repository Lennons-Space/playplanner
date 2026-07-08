/**
 * Regression tests for the Admin Enrichment screen's tab navigation, using the
 * REAL sub-components (EnrichmentSummary, AutoApplyBatchPanel, EnrichmentAudit,
 * EnrichmentRollback) rather than the screen-level mocks used in
 * enrichment.test.tsx.
 *
 * WHY THIS FILE EXISTS:
 * A native Android crash (Fabric `IllegalViewOperationException`, driven by
 * Reanimated's per-frame native-operation flush inside `SurfaceMountingManager`)
 * was reported while switching between the four enrichment tabs on-device, at
 * the exact LIVE baseline captured below:
 *   - Safe-to-apply (auto-apply):  0
 *   - Manual review:               0
 *   - Applied:                     12  (via the pre-ledger legacy-pilot flow —
 *                                       these rows never reach the Audit tab's
 *                                       write ledger, hence 0 write-ledger rows)
 *   - Auto-rejected:               0
 *   - Report-only:                 0
 *   - Write-ledger rows (Audit):   0
 *   - Rejected (legacy-pilot):     5  (resolved; not rendered anywhere in this
 *                                       screen — included here only as background
 *                                       DB state, not asserted on)
 *
 * A true native Fabric crash cannot be reproduced under Jest — jest-expo has no
 * Fabric surface, so `ViewManagerRegistry`/`SurfaceMountingManager` never run.
 * What CAN be verified here:
 *   - the real sub-components mount and unmount cleanly under repeated tab
 *     switching (including revisiting a tab), with no unhandled JS exception;
 *   - the fix applied to EnrichmentRollback — the confirm `<Modal>` is now
 *     scoped to `applyWrites.length > 0` instead of being mounted
 *     unconditionally at the top of the screen — holds at this exact
 *     zero-data baseline (the Modal must be completely absent from the tree,
 *     not just `visible={false}`).
 *
 * Supabase is never touched — every data hook is mocked directly so this file
 * exercises the real component tree without any network/DB dependency.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Required even though this file never calls Supabase directly: the
// `useEnrichmentBatch` mock below uses `jest.requireActual` to keep
// `batchOutcomeMessage` real, and that actual module transitively imports
// '@/lib/supabase' — which throws at load time without this mock (see
// components/admin/__tests__/AutoApplyBatchPanel.test.tsx for the same
// pattern).
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView:      'View',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  router:   { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Redirect: () => null,
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/useAuth', () => ({
  useIsAdmin: jest.fn(() => true),
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn((selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false })
  ),
}));

const mockApproveAndApply = { mutate: jest.fn(), isPending: false };
const mockRetryApply      = { mutate: jest.fn(), isPending: false };
const mockReturnToPending = { mutate: jest.fn(), isPending: false };
const mockReject          = { mutate: jest.fn(), isPending: false };

jest.mock('@/hooks/useEnrichmentProposals', () => ({
  // 0 manual-review proposals — the empty state on the Review tab.
  useReviewableProposals: jest.fn(() => ({ data: [], isLoading: false, error: null })),
  // Applied=12, everything else 0 — the exact reported live counts strip.
  useEnrichmentSummary: jest.fn(() => ({
    data: {
      total:               17,
      autoApplyPending:    0,
      manualReviewPending: 0,
      autoRejected:        0,
      reportOnly:          0,
      applied:             12,
    },
    isLoading: false,
    error:     null,
  })),
  // 0 safe-to-apply candidates — the empty state on the Auto-Apply tab.
  useAutoApplyCandidates: jest.fn(() => ({ data: [], isLoading: false, refetch: jest.fn() })),
  // 0 write-ledger rows — the empty state on the Audit tab's Write history sub-tab.
  useAppliedWrites: jest.fn(() => ({ data: [], isLoading: false })),
  // 0 auto-reject / report-only rows — the empty state on Audit's Engine decisions sub-tab.
  useTerminalProposals: jest.fn(() => ({ data: [], isLoading: false })),
  // 0 enrichment runs — the empty state on the Rollback tab.
  useEnrichmentRuns: jest.fn(() => ({ data: [], isLoading: false })),
  useRunWrites:      jest.fn(() => ({ data: [], isLoading: false })),
  useResolveProposal: jest.fn(() => ({
    approveAndApply: mockApproveAndApply,
    retryApply:      mockRetryApply,
    returnToPending: mockReturnToPending,
    reject:          mockReject,
  })),
  useRollbackRun: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false, error: null })),
}));

jest.mock('@/hooks/useEnrichmentBatch', () => ({
  // batchOutcomeMessage is a pure function — keep the real implementation.
  batchOutcomeMessage: jest.requireActual('@/hooks/useEnrichmentBatch').batchOutcomeMessage,
  useEnrichmentBatch: jest.fn(() => ({
    state:    { status: 'idle', results: [], appliedCount: 0, failedCount: 0 },
    runBatch: jest.fn(),
    reset:    jest.fn(),
  })),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// eslint-disable-next-line import/first
import EnrichmentScreen from '../enrichment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

type TabId = 'tab-review' | 'tab-auto-apply' | 'tab-audit' | 'tab-rollback';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — real sub-components, LIVE zero-data baseline', () => {
  it('mounts on the Review tab without throwing', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-review')).toBeTruthy());
  });

  it('renders each tab safely in sequence: Review -> Auto-Apply -> Audit -> Rollback -> Review', async () => {
    const { getByTestId, queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-review')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-auto-apply')); });
    await waitFor(() => expect(getByTestId('auto-apply-empty')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-audit')); });
    await waitFor(() => expect(getByTestId('enrichment-audit')).toBeTruthy());
    expect(getByTestId('audit-writes-empty')).toBeTruthy();

    await act(async () => { fireEvent.press(getByTestId('tab-rollback')); });
    await waitFor(() => expect(getByTestId('enrichment-rollback')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-review')); });
    await waitFor(() => {
      // Switching away unmounts the Rollback panel — proves tab content is
      // torn down cleanly (mount/unmount is exactly the crash trigger under
      // investigation) with no lingering error boundary / thrown exception.
      expect(queryByTestId('enrichment-rollback')).toBeNull();
      expect(queryByTestId('mocked-enrichment-rollback')).toBeNull();
    });
  });

  it('survives repeated back-and-forth tab switching without throwing (QA-pass simulation)', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-review')).toBeTruthy());

    const order: TabId[] = [
      'tab-auto-apply', 'tab-review', 'tab-audit', 'tab-rollback',
      'tab-auto-apply', 'tab-rollback', 'tab-review', 'tab-audit',
      'tab-rollback', 'tab-audit', 'tab-auto-apply', 'tab-review',
    ];

    for (const tab of order) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.press(getByTestId(tab)); });
    }

    await waitFor(() => expect(getByTestId('tab-review')).toBeTruthy());
  });

  it('the Rollback confirm modal is NOT mounted at the zero-runs baseline (crash-fix regression guard)', async () => {
    const { getByTestId, queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-rollback')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-rollback')); });
    await waitFor(() => expect(getByTestId('enrichment-rollback')).toBeTruthy());

    // With 0 enrichment runs (the exact live baseline that reproduced the
    // on-device crash), the confirm <Modal> must be entirely absent from the
    // tree — not merely `visible={false}`. Previously it was mounted
    // unconditionally, so every switch into/out of this tab allocated and
    // tore down a native Modal surface for no reason.
    expect(queryByTestId('rollback-confirm-modal')).toBeNull();
  });
});
