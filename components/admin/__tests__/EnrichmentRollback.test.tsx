/**
 * Unit tests for EnrichmentRollback — Fix H regression.
 *
 * Verifies that RollbackResultRow shows the venue NAME (from the writes join)
 * rather than a raw UUID slice when the name is available in the write ledger.
 * Falls back to `id.slice(0, 8)…` only when no name is available.
 *
 * Supabase is fully mocked. No real DB calls. No migration applied.
 */

import React from 'react';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView:      'View',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@/hooks/useEnrichmentProposals', () => ({
  useEnrichmentRuns:  jest.fn(),
  useRunWrites:       jest.fn(),
  useRollbackRun:     jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

import { useEnrichmentRuns, useRunWrites, useRollbackRun } from '@/hooks/useEnrichmentProposals';
import { EnrichmentRollback } from '../EnrichmentRollback';
import type { RunRecord, WriteRecord } from '@/hooks/useEnrichmentProposals';
import type { RollbackItemResult }      from '@/types/enrichmentDecision';

const mockUseRuns     = useEnrichmentRuns as jest.MockedFunction<typeof useEnrichmentRuns>;
const mockUseWrites   = useRunWrites      as jest.MockedFunction<typeof useRunWrites>;
const mockUseRollback = useRollbackRun    as jest.MockedFunction<typeof useRollbackRun>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN: RunRecord = {
  id:         'run-abc',
  venue_id:   'venue-aaa',
  run_label:  'Pilot run 2026-06-29',
  outcome:    'complete',
  created_at: '2026-06-29T10:00:00Z',
};

// Write record that carries a venue name via the `venues` join.
const WRITE_WITH_NAME: WriteRecord = {
  id:               'write-1',
  run_id:           'run-abc',
  proposal_id:      'prop-1',
  venue_id:         'venue-aaaaaaaaa',
  field:            'phone',
  operation:        'apply',
  old_value:        null,
  new_value:        { v: '+44 20 7946 0958' },
  applied_mode:     'auto',
  applied_at:       '2026-06-29T10:05:00Z',
  decision_reasons: [],
  source_url:       'https://venue.co.uk',
  venues:           { name: 'Happy Kids Farm' },
};

// Write record WITHOUT a venue name.
const WRITE_NO_NAME: WriteRecord = {
  ...WRITE_WITH_NAME,
  id:       'write-2',
  venue_id: 'venue-bbbbbbbbbb',
  venues:   null,
};

const ROLLBACK_RESULT_WITH_NAME: RollbackItemResult = {
  write_id:    'write-1',
  proposal_id: 'prop-1',
  venue_id:    'venue-aaaaaaaaa',
  field:       'phone',
  outcome:     'restored',
};

const ROLLBACK_RESULT_NO_NAME: RollbackItemResult = {
  write_id:    'write-2',
  proposal_id: 'prop-2',
  venue_id:    'venue-bbbbbbbbbb',
  field:       'phone',
  outcome:     'restored',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

// ---------------------------------------------------------------------------
// beforeEach — wire up mock hooks
// ---------------------------------------------------------------------------

const mockMutateAsync = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  mockUseRuns.mockReturnValue({
    data:      [RUN],
    isLoading: false,
  } as ReturnType<typeof useEnrichmentRuns>);

  // Default: writes loaded for the selected run (with and without venue name)
  mockUseWrites.mockReturnValue({
    data:      [WRITE_WITH_NAME, WRITE_NO_NAME],
    isLoading: false,
  } as ReturnType<typeof useRunWrites>);

  mockUseRollback.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending:   false,
    error:       null,
  } as unknown as ReturnType<typeof useRollbackRun>);
});

// ---------------------------------------------------------------------------
// Fix H: rollback result rows show venue name when available
// ---------------------------------------------------------------------------

describe('Fix H — EnrichmentRollback result rows show venue name', () => {
  it('shows venue name from venueNameById map when the write ledger has a name', async () => {
    // mutateAsync resolves with rollback results including a matching write_id
    mockMutateAsync.mockResolvedValue([ROLLBACK_RESULT_WITH_NAME]);

    const { getByTestId } = render(
      <EnrichmentRollback isAdmin={true} />,
      { wrapper: makeWrapper() }
    );

    // Select the run
    await waitFor(() => expect(getByTestId(`run-selector-${RUN.id}`)).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId(`run-selector-${RUN.id}`)); });

    // Confirm rollback
    await waitFor(() => expect(getByTestId('rollback-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('rollback-btn')); });
    await waitFor(() => expect(getByTestId('rollback-confirm-confirm')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('rollback-confirm-confirm')); });

    // Rollback results should appear
    await waitFor(() => expect(getByTestId('rollback-results')).toBeTruthy());

    // Scope to the results section only — the write preview above also shows the name.
    const resultsSection = getByTestId('rollback-results');
    // The venue NAME must be shown inside the results section.
    expect(within(resultsSection).getByText('Happy Kids Farm')).toBeTruthy();
    // The raw UUID slice must NOT be present inside the results section.
    expect(within(resultsSection).queryByText('venue-aaa…')).toBeNull();
  });

  it('falls back to venue_id slice when no venue name is available in the write ledger', async () => {
    mockMutateAsync.mockResolvedValue([ROLLBACK_RESULT_NO_NAME]);

    const { getByTestId } = render(
      <EnrichmentRollback isAdmin={true} />,
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(getByTestId(`run-selector-${RUN.id}`)).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId(`run-selector-${RUN.id}`)); });
    await waitFor(() => expect(getByTestId('rollback-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('rollback-btn')); });
    await waitFor(() => expect(getByTestId('rollback-confirm-confirm')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('rollback-confirm-confirm')); });
    await waitFor(() => expect(getByTestId('rollback-results')).toBeTruthy());

    // Scope to the results section — write preview area may contain venue names from other writes.
    const resultsSection = getByTestId('rollback-results');
    // No name → shows the first 8 chars of the venue_id + ellipsis.
    // 'venue-bb' is the first 8 chars of 'venue-bbbbbbbbbb'.
    expect(within(resultsSection).getByText('venue-bb…')).toBeTruthy();
  });
});
