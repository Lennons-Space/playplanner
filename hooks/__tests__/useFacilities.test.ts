/**
 * Tests for hooks/useFacilities.ts
 *
 * Parent Contribution MVP — Phase 1 (venue-detail only).
 *
 * WHY these tests matter:
 *   - useVenueFacilityStats reads the PUBLIC aggregate only — never raw votes
 *     (there is no SELECT policy on venue_facility_votes; see migration 050).
 *   - useCastFacilityVote is auth-gated: a signed-out tap must throw a typed
 *     FacilityVoteAuthError the UI can catch and route to sign-in, WITHOUT
 *     ever reaching the network.
 *   - .select('id') + zero-row guard: without it, a silently-RLS-blocked
 *     write looks like success (see useModerateReview for the same pattern).
 *   - Optimistic update / rollback: the chip must feel instant, but never
 *     leave the UI showing a vote that didn't actually persist.
 *   - Privacy: vote/user data must never reach console.error.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import {
  useVenueFacilityStats,
  useCastFacilityVote,
  FacilityVoteAuthError,
  type FacilityStatsMap,
} from '../useFacilities';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockFrom    = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockUseUser = useUser       as jest.MockedFunction<typeof useUser>;

const VENUE_ID  = 'venue-abc-123';
const USER_ID   = 'user-xyz-456';
const FAKE_USER = { id: USER_ID } as any;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      // gcTime must NOT be 0 here: several tests call client.setQueryData
      // directly (without an active observer) and then read it back via
      // client.getQueryData — a zero gcTime would garbage-collect that cache
      // entry on the next tick, making the read return undefined regardless
      // of whether the optimistic-update logic under test is correct.
      queries:   { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue(FAKE_USER);
});

// ============================================================================
// useVenueFacilityStats — reads the public aggregate
// ============================================================================

describe('useVenueFacilityStats', () => {
  function buildSelectMock(rows: any[], error: object | null = null) {
    const inFn = jest.fn().mockResolvedValue({ data: rows, error });
    const eqFn = jest.fn().mockReturnValue({ in: inFn });
    const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
    mockFrom.mockReturnValue({ select: selectFn } as any);
    return { selectFn, eqFn, inFn };
  }

  it('reads from venue_facility_stats (the public aggregate table, never raw votes)', async () => {
    buildSelectMock([]);
    const client = makeClient();
    const { result } = renderHook(() => useVenueFacilityStats(VENUE_ID), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith('venue_facility_stats');
    expect(mockFrom).not.toHaveBeenCalledWith('venue_facility_votes');
  });

  it('maps rows into a per-slug stats map with confidence/present/total', async () => {
    buildSelectMock([
      { facility_slug: 'toilets', yes_count: 4, no_count: 1, total_votes: 5, confidence: 'high', present: true },
    ]);
    const client = makeClient();
    const { result } = renderHook(() => useVenueFacilityStats(VENUE_ID), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const map = result.current.data as FacilityStatsMap;
    expect(map.toilets).toEqual({ slug: 'toilets', confidence: 'high', present: true, total: 5 });
    // Slugs absent from the response default to "unknown" (no votes yet).
    expect(map['baby-change']).toEqual({ slug: 'baby-change', confidence: 'low', present: null, total: 0 });
    expect(map.parking).toEqual({ slug: 'parking', confidence: 'low', present: null, total: 0 });
  });

  it('does not run when venueId is undefined', () => {
    buildSelectMock([]);
    const client = makeClient();
    renderHook(() => useVenueFacilityStats(undefined), { wrapper: makeWrapper(client) });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws a friendly error and logs only safe metadata on failure', async () => {
    buildSelectMock([], { code: '42501', hint: 'permission denied', message: 'raw row leak risk' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = makeClient();
    const { result } = renderHook(() => useVenueFacilityStats(VENUE_ID), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toMatch(/Could not load facility info/);

    const allLogs = errorSpy.mock.calls.flat().join(' ');
    expect(allLogs).toContain('42501');
    expect(allLogs).not.toContain('raw row leak risk');
    errorSpy.mockRestore();
  });
});

// ============================================================================
// useCastFacilityVote — auth gating
// ============================================================================

describe('useCastFacilityVote — auth gating', () => {
  it('throws FacilityVoteAuthError and never calls supabase when signed out', async () => {
    mockUseUser.mockReturnValue(null);
    const client = makeClient();
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ venueId: VENUE_ID, slug: 'toilets' }),
      ).rejects.toBeInstanceOf(FacilityVoteAuthError);
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('surfaces a "please sign in" message the UI can route on', async () => {
    mockUseUser.mockReturnValue(null);
    const client = makeClient();
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, slug: 'parking' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toMatch(/sign in/i);
  });
});

// ============================================================================
// useCastFacilityVote — write shape, .select('id') zero-row guard
// ============================================================================

describe('useCastFacilityVote — write behaviour', () => {
  function buildUpsertMock(rows: any[] | null, error: object | null = null) {
    const selectFn = jest.fn().mockResolvedValue({ data: rows, error });
    const upsertFn = jest.fn().mockReturnValue({ select: selectFn });
    mockFrom.mockReturnValue({ upsert: upsertFn } as any);
    return { upsertFn, selectFn };
  }

  it('upserts with onConflict on (venue_id,user_id,facility_slug) and present=true', async () => {
    const { upsertFn } = buildUpsertMock([{ id: 'vote-1' }]);
    const client = makeClient();
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, slug: 'baby-change' });
    });

    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_id: VENUE_ID,
        user_id: USER_ID,
        facility_slug: 'baby-change',
        present: true,
      }),
      { onConflict: 'venue_id,user_id,facility_slug' },
    );
  });

  it('chains .select("id") to force a representation response', async () => {
    const { selectFn } = buildUpsertMock([{ id: 'vote-1' }]);
    const client = makeClient();
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, slug: 'toilets' });
    });

    expect(selectFn).toHaveBeenCalledWith('id');
  });

  it('throws when the write returns zero rows (silent RLS block)', async () => {
    buildUpsertMock([]);
    const client = makeClient();
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ venueId: VENUE_ID, slug: 'toilets' }),
      ).rejects.toThrow(/session may have changed/);
    });
  });

  it('throws a friendly message and logs only safe metadata on a DB error', async () => {
    buildUpsertMock(null, { code: '23505', hint: 'unique_violation', message: 'venue_id=... user_id=...' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = makeClient();
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ venueId: VENUE_ID, slug: 'toilets' }),
      ).rejects.toThrow(/Could not save your answer/);
    });

    const allLogs = errorSpy.mock.calls.flat().join(' ');
    expect(allLogs).toContain('23505');
    // Never log venue/user identifiers or raw error content.
    expect(allLogs).not.toContain(VENUE_ID);
    expect(allLogs).not.toContain(USER_ID);
    expect(allLogs).not.toContain('venue_id=... user_id=...');
    errorSpy.mockRestore();
  });
});

// ============================================================================
// useCastFacilityVote — optimistic update / rollback / invalidation
// ============================================================================

describe('useCastFacilityVote — optimistic update', () => {
  function buildUpsertMock(rows: any[] | null, error: object | null = null, delayMs = 0) {
    const selectFn = jest.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: rows, error }), delayMs)),
    );
    const upsertFn = jest.fn().mockReturnValue({ select: selectFn });
    mockFrom.mockReturnValue({ upsert: upsertFn } as any);
    return { upsertFn, selectFn };
  }

  const emptyMap = (): FacilityStatsMap => ({
    toilets:       { slug: 'toilets',     confidence: 'low', present: null, total: 0 },
    'baby-change': { slug: 'baby-change', confidence: 'low', present: null, total: 0 },
    parking:       { slug: 'parking',     confidence: 'low', present: null, total: 0 },
  });

  it('optimistically marks the slug as confirmed before the server responds, without recomputing confidence', async () => {
    buildUpsertMock([{ id: 'vote-1' }], null, 30);
    const client = makeClient();

    // Seed a non-trivial pre-tap aggregate (mixed yes/no history) so we can
    // prove the optimistic update does NOT attempt to re-derive a confidence
    // tier from an assumed-unanimous split. If it did, this seeded 'medium'
    // would flip to whatever a naive (total*1+1)/(total+1) reconstruction
    // produces — which would be a fabricated, possibly-wrong verdict.
    const seeded = emptyMap();
    seeded.toilets = { slug: 'toilets', confidence: 'medium', present: true, total: 5 };
    client.setQueryData(['venueFacilityStats', VENUE_ID], seeded);

    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    let mutationPromise!: Promise<unknown>;
    act(() => {
      mutationPromise = result.current.mutateAsync({ venueId: VENUE_ID, slug: 'toilets' });
    });

    // Almost immediately (before the 30ms resolve), the cache should already
    // reflect an optimistic "confirmed" state for toilets — total bumped,
    // present flipped to true, but confidence left exactly as it was. The
    // authoritative confidence only arrives later via onSettled invalidation.
    await waitFor(() => {
      const map = client.getQueryData<FacilityStatsMap>(['venueFacilityStats', VENUE_ID]);
      expect(map).toBeDefined();
      expect(map?.toilets?.total).toBe(6);
      expect(map?.toilets?.present).toBe(true);
      expect(map?.toilets?.confidence).toBe('medium');
    });

    await act(async () => {
      await mutationPromise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back the optimistic update when the write fails', async () => {
    buildUpsertMock(null, { code: '42501', hint: 'permission denied' });
    const client = makeClient();
    const original = emptyMap();
    client.setQueryData(['venueFacilityStats', VENUE_ID], original);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, slug: 'parking' }).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const map = client.getQueryData<FacilityStatsMap>(['venueFacilityStats', VENUE_ID]);
    // Rolled back to the exact pre-mutation snapshot.
    expect(map).toEqual(original);
    errorSpy.mockRestore();
  });

  it('invalidates venueFacilityStats and venue query keys on settle', async () => {
    buildUpsertMock([{ id: 'vote-1' }]);
    const client = makeClient();
    client.setQueryData(['venueFacilityStats', VENUE_ID], emptyMap());
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCastFacilityVote(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, slug: 'toilets' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['venueFacilityStats', VENUE_ID] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['venue', VENUE_ID] });
  });
});
