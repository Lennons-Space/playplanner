/**
 * Unit tests for AutoApplyBatchPanel — Fix F regression (T-F).
 *
 * Verifies that handleConfirmBatch invalidates ALL required React Query caches:
 *   - ['enrichment', 'auto-apply-candidates'] — drop applied items from the list
 *   - ['enrichment', 'summary']              — refresh counts strip
 *   - ['enrichment', 'pending-proposals']    — FIX F: Review tab sees moved_to_manual_review rows
 *   - ['enrichment', 'applied-writes']       — FIX F: Audit tab sees newly-applied writes
 *   - ['venues'] / ['venue']                 — refresh venue detail caches
 *
 * Supabase is fully mocked. No real DB calls. No migration applied.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mocks must be hoisted before imports that use them.
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView:        'View',
  useSafeAreaInsets:   () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

const mockRunBatch = jest.fn().mockResolvedValue(undefined);
const mockReset    = jest.fn();
const mockRefetch  = jest.fn().mockResolvedValue({});

jest.mock('@/hooks/useEnrichmentProposals', () => ({
  useAutoApplyCandidates: jest.fn(),
}));

jest.mock('@/hooks/useEnrichmentBatch', () => ({
  // batchOutcomeMessage is a pure function — keep the real implementation.
  batchOutcomeMessage: jest.requireActual('@/hooks/useEnrichmentBatch').batchOutcomeMessage,
  useEnrichmentBatch:  jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

import { useAutoApplyCandidates } from '@/hooks/useEnrichmentProposals';
import { useEnrichmentBatch }     from '@/hooks/useEnrichmentBatch';
import { AutoApplyBatchPanel }    from '../AutoApplyBatchPanel';
import type { AutoApplyCandidate }  from '@/hooks/useEnrichmentProposals';
import type { BatchState }          from '@/hooks/useEnrichmentBatch';

const mockUseAutoApply = useAutoApplyCandidates as jest.MockedFunction<typeof useAutoApplyCandidates>;
const mockUseBatch     = useEnrichmentBatch     as jest.MockedFunction<typeof useEnrichmentBatch>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CANDIDATE: AutoApplyCandidate = {
  id:               'cand-1',
  venue_id:         'venue-a',
  run_id:           'run-1',
  field:            'phone',
  proposed_value:   { v: '+44 20 7946 0958' },
  current_value:    null,
  decision_reasons: [],
  venueName:        'Happy Kids Farm',
};

const IDLE_BATCH_STATE: BatchState = {
  status:       'idle',
  results:      [],
  appliedCount: 0,
  failedCount:  0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  mockUseAutoApply.mockReturnValue({
    data:      [CANDIDATE],
    isLoading: false,
    refetch:   mockRefetch,
  } as unknown as ReturnType<typeof useAutoApplyCandidates>);

  mockUseBatch.mockReturnValue({
    state:    IDLE_BATCH_STATE,
    runBatch: mockRunBatch,
    reset:    mockReset,
  } as unknown as ReturnType<typeof useEnrichmentBatch>);
});

// ---------------------------------------------------------------------------
// T-F: handleConfirmBatch cache invalidations (Fix F)
// ---------------------------------------------------------------------------

describe('Fix F — T-F: handleConfirmBatch invalidates pending-proposals and applied-writes', () => {
  it('invalidates pending-proposals and applied-writes after confirming the batch', async () => {
    const client        = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { getByTestId } = render(
      <AutoApplyBatchPanel isAdmin={true} />,
      { wrapper: makeWrapper(client) }
    );

    // Step 1: idle → preview
    await waitFor(() => expect(getByTestId('view-preview-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('view-preview-btn')); });

    // Step 2: preview → confirm modal
    await waitFor(() => expect(getByTestId('apply-safe-changes-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('apply-safe-changes-btn')); });

    // Step 3: press the confirm button inside the modal
    await waitFor(() => expect(getByTestId('batch-confirm-confirm')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('batch-confirm-confirm')); });

    // runBatch resolves immediately — all invalidations should have fired.
    await waitFor(() => expect(mockRunBatch).toHaveBeenCalledTimes(1));

    const calledKeys = (invalidateSpy.mock.calls as unknown[])
      .map((call) => (call as [{ queryKey: unknown[] }])[0]?.queryKey);

    // FIX F: both keys must be present.
    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ['enrichment', 'pending-proposals'],
        ['enrichment', 'applied-writes'],
      ])
    );
  });

  it('also invalidates auto-apply-candidates, summary, venues, and venue after batch', async () => {
    const client        = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { getByTestId } = render(
      <AutoApplyBatchPanel isAdmin={true} />,
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(getByTestId('view-preview-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('view-preview-btn')); });
    await waitFor(() => expect(getByTestId('apply-safe-changes-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('apply-safe-changes-btn')); });
    await waitFor(() => expect(getByTestId('batch-confirm-confirm')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('batch-confirm-confirm')); });
    await waitFor(() => expect(mockRunBatch).toHaveBeenCalledTimes(1));

    const calledKeys = (invalidateSpy.mock.calls as unknown[])
      .map((call) => (call as [{ queryKey: unknown[] }])[0]?.queryKey);

    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ['enrichment', 'auto-apply-candidates'],
        ['enrichment', 'summary'],
        ['enrichment', 'pending-proposals'],
        ['enrichment', 'applied-writes'],
        ['venues'],
        ['venue'],
      ])
    );
  });
});
