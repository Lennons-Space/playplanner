/**
 * Tests for hooks/useEnrichmentProposals.ts — invalidateAfterResolve
 *
 * Verifies that useResolveProposal correctly invalidates all required
 * React Query caches after a successful resolution:
 *   - ['enrichment', 'pending-proposals'] — existing behaviour
 *   - ['venues']                          — existing behaviour (venue list caches)
 *   - ['venue']                           — NEW: covers venue-detail ['venue', id]
 *
 * Supabase is fully mocked — no real DB calls, no migration applied.
 * Pattern mirrors hooks/__tests__/useVenueClaims.test.ts.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useResolveProposal, useAutoApplyCandidates } from '../useEnrichmentProposals';

// ── Mock supabase ─────────────────────────────────────────────────────────────
// Chainable builder for supabase.from() — approveAndApply uses:
//   .from('venue_field_proposals').update({...}).eq('id', id).select('id')
const mockSelectAfterUpdate = jest.fn();
const mockEqAfterUpdate     = jest.fn();
const mockUpdateFn          = jest.fn();
const mockRpc               = jest.fn();
const mockFrom              = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc:  (...args: unknown[]) => mockRpc(...args),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a fresh QueryClient + wrapper for each test (avoids cache bleed). */
function makeClientAndWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries:   { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, Wrapper };
}

/**
 * Wire the supabase mock so a full approveAndApply succeeds:
 *   Step 1 — UPDATE returns a row    (RLS check: row returned = permission OK)
 *   Step 2 — RPC returns no error
 */
function setupSuccessfulApprove(proposalId: string) {
  mockSelectAfterUpdate.mockResolvedValue({
    data:  [{ id: proposalId }],
    error: null,
  });
  mockEqAfterUpdate.mockReturnValue({ select: mockSelectAfterUpdate });
  mockUpdateFn.mockReturnValue({ eq: mockEqAfterUpdate });
  mockFrom.mockReturnValue({ update: mockUpdateFn });
  mockRpc.mockResolvedValue({ error: null });
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// describe: useResolveProposal — invalidateAfterResolve
// ══════════════════════════════════════════════════════════════════════════════

describe('useResolveProposal — invalidateAfterResolve', () => {

  it('invalidates [enrichment, pending-proposals] after a successful approveAndApply', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-1');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });

    await act(async () => {
      result.current.approveAndApply.mutate({
        proposalId: 'prop-1',
        reviewedBy: 'admin-user',
      });
    });

    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['enrichment', 'pending-proposals'] })
    );
  });

  it('invalidates [venues] after a successful approveAndApply', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-2');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });

    await act(async () => {
      result.current.approveAndApply.mutate({
        proposalId: 'prop-2',
        reviewedBy: 'admin-user',
      });
    });

    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['venues'] })
    );
  });

  it('invalidates [venue] (singular) after a successful approveAndApply — covers venue-detail cache', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-3');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });

    await act(async () => {
      result.current.approveAndApply.mutate({
        proposalId: 'prop-3',
        reviewedBy: 'admin-user',
      });
    });

    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['venue'] })
    );
  });

  it('fires all three invalidations in a single approveAndApply success', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-4');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });

    await act(async () => {
      result.current.approveAndApply.mutate({
        proposalId: 'prop-4',
        reviewedBy: 'admin-user',
      });
    });

    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    const calledKeys = (invalidateSpy.mock.calls as unknown[])
      .map((call) => (call as [{ queryKey: unknown[] }])[0]?.queryKey);

    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ['enrichment', 'pending-proposals'],
        ['venues'],
        ['venue'],
      ])
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Fix D defense — T5: useAutoApplyCandidates excludes description proposals
// ══════════════════════════════════════════════════════════════════════════════

describe('useAutoApplyCandidates — Fix D defense: description excluded (T5)', () => {
  it('T5: includes .neq("field", "description") in the supabase query chain', async () => {
    // Build a chainable mock for the SELECT path used by useAutoApplyCandidates:
    //   .from(...).select(...).eq('decision','auto_apply').eq('status','pending')
    //   .neq('field','description').order(...).limit(200)
    const mockLimit       = jest.fn().mockResolvedValue({ data: [], error: null });
    const mockOrder       = jest.fn().mockReturnValue({ limit: mockLimit });
    const mockNeq         = jest.fn().mockReturnValue({ order: mockOrder });
    const mockEqPending   = jest.fn().mockReturnValue({ neq: mockNeq });
    const mockEqDecision  = jest.fn().mockReturnValue({ eq: mockEqPending });
    const mockSelect      = jest.fn().mockReturnValue({ eq: mockEqDecision });
    mockFrom.mockReturnValue({ select: mockSelect });

    const { Wrapper } = makeClientAndWrapper();
    const { result } = renderHook(() => useAutoApplyCandidates(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Defense-in-depth filter must be present in the chain.
    expect(mockNeq).toHaveBeenCalledWith('field', 'description');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Fix E — T6: invalidateAfterResolve invalidates applied-writes + run-writes
// ══════════════════════════════════════════════════════════════════════════════

describe('Fix E — invalidateAfterResolve (T6)', () => {
  it('T6a: invalidates [enrichment, applied-writes] after a successful approveAndApply', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-t6a');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });
    await act(async () => {
      result.current.approveAndApply.mutate({ proposalId: 'prop-t6a', reviewedBy: 'admin-user' });
    });
    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['enrichment', 'applied-writes'] })
    );
  });

  it('T6b: invalidates [enrichment, run-writes] after a successful approveAndApply', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-t6b');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });
    await act(async () => {
      result.current.approveAndApply.mutate({ proposalId: 'prop-t6b', reviewedBy: 'admin-user' });
    });
    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['enrichment', 'run-writes'] })
    );
  });

  it('T6c: all six cache keys are invalidated in a single approveAndApply', async () => {
    const { client, Wrapper } = makeClientAndWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    setupSuccessfulApprove('prop-t6c');

    const { result } = renderHook(() => useResolveProposal(), { wrapper: Wrapper });
    await act(async () => {
      result.current.approveAndApply.mutate({ proposalId: 'prop-t6c', reviewedBy: 'admin-user' });
    });
    await waitFor(() => expect(result.current.approveAndApply.isSuccess).toBe(true));

    const calledKeys = (invalidateSpy.mock.calls as unknown[])
      .map((call) => (call as [{ queryKey: unknown[] }])[0]?.queryKey);

    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ['enrichment', 'pending-proposals'],
        ['enrichment', 'summary'],
        ['enrichment', 'applied-writes'],
        ['enrichment', 'run-writes'],
        ['venues'],
        ['venue'],
      ])
    );
  });
});
