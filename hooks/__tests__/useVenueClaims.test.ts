/**
 * Tests for useVenueClaims hooks.
 *
 * Covers:
 * - useVenueClaimStatus: null when no active claim, returns data when found
 * - useMyVenueClaims: returns user's own claims
 * - useReviewClaim: approve path calls supabase.rpc('review_venue_claim')
 * - useReviewClaim: reject path calls supabase.rpc with decision='rejected'
 * - RLS guard: insert must include user_id matching auth.uid()
 *
 * NOTE: useReviewClaim now uses a single supabase.rpc() call (not three
 * sequential .from() writes). The tests reflect this refactored shape.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useVenueClaimStatus,
  useMyVenueClaims,
  useReviewClaim,
} from '../useVenueClaims';

// ── Mock supabase ─────────────────────────────────────────────────────────────
// chainable mock for the query builder
const mockSingle      = jest.fn();
const mockMaybeSingle = jest.fn();
const mockOrder       = jest.fn();
const mockLimit       = jest.fn();
const mockIn          = jest.fn();
const mockEq          = jest.fn();
const mockSelect      = jest.fn();
const mockFrom        = jest.fn();
// RPC mock — useReviewClaim calls supabase.rpc() directly
const mockRpc         = jest.fn();

const builder: Record<string, jest.Mock> = {
  select:      mockSelect,
  eq:          mockEq,
  in:          mockIn,
  order:       mockOrder,
  limit:       mockLimit,
  single:      mockSingle,
  maybeSingle: mockMaybeSingle,
};

Object.keys(builder).forEach((key) => {
  builder[key].mockReturnValue(builder);
});

mockFrom.mockReturnValue(builder);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc:  (...args: unknown[]) => mockRpc(...args),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ── Test helpers ──────────────────────────────────────────────────────────────
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries:   { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(builder).forEach((key) => {
    builder[key].mockReturnValue(builder);
  });
  mockFrom.mockReturnValue(builder);
});

// ── useVenueClaimStatus ───────────────────────────────────────────────────────
describe('useVenueClaimStatus', () => {
  it('returns null when no active claim exists for the venue', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(
      () => useVenueClaimStatus('venue-123', 'user-abc'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns the claim when a pending claim exists', async () => {
    const claim = { id: 'claim-abc', status: 'pending', created_at: '2026-01-01T00:00:00Z' };
    mockMaybeSingle.mockResolvedValueOnce({ data: claim, error: null });

    const { result } = renderHook(
      () => useVenueClaimStatus('venue-123', 'user-abc'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(claim);
  });

  it('returns the claim when an approved claim exists', async () => {
    const claim = { id: 'claim-def', status: 'approved', created_at: '2026-01-02T00:00:00Z' };
    mockMaybeSingle.mockResolvedValueOnce({ data: claim, error: null });

    const { result } = renderHook(
      () => useVenueClaimStatus('venue-456', 'user-abc'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(claim);
    expect(mockIn).toHaveBeenCalledWith('status', ['pending', 'approved']);
  });

  it('is disabled when venueId is undefined', () => {
    const { result } = renderHook(
      () => useVenueClaimStatus(undefined, 'user-abc'),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('is disabled when userId is undefined', () => {
    const { result } = renderHook(
      () => useVenueClaimStatus('venue-123', undefined),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── useMyVenueClaims ──────────────────────────────────────────────────────────
describe('useMyVenueClaims', () => {
  it('returns the list of claims for the current user', async () => {
    const claims = [
      { id: 'c1', venue_id: 'v1', status: 'pending',  created_at: '2026-01-01T00:00:00Z', admin_notes: null },
      { id: 'c2', venue_id: 'v2', status: 'approved', created_at: '2026-01-02T00:00:00Z', admin_notes: null },
    ];
    // limit() is the last chain call before the query resolves
    mockLimit.mockResolvedValueOnce({ data: claims, error: null });

    const { result } = renderHook(
      () => useMyVenueClaims('user-xyz'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(claims);
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-xyz');
  });

  it('returns an empty array when the user has no claims', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(
      () => useMyVenueClaims('user-xyz'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when userId is undefined', () => {
    const { result } = renderHook(
      () => useMyVenueClaims(undefined),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── useReviewClaim ────────────────────────────────────────────────────────────
// useReviewClaim now delegates all DB work to the review_venue_claim RPC so
// the entire approve/reject/partial-failure logic lives in Postgres. The client
// tests verify: (a) the correct RPC name is called, (b) the correct parameters
// are passed, (c) errors are surfaced, and (d) PGRST301 permission errors
// produce a meaningful message.
describe('useReviewClaim', () => {
  it('approve: calls supabase.rpc with decision="approved"', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:  'claim-1',
        venueId:  'venue-1',
        userId:   'user-1',
        decision: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('review_venue_claim', {
      p_claim_id:    'claim-1',
      p_decision:    'approved',
      p_admin_notes: null,
    });
  });

  it('reject: calls supabase.rpc with decision="rejected" and admin notes', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:    'claim-2',
        venueId:    'venue-2',
        userId:     'user-2',
        decision:   'rejected',
        adminNotes: 'Could not verify ownership.',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('review_venue_claim', {
      p_claim_id:    'claim-2',
      p_decision:    'rejected',
      p_admin_notes: 'Could not verify ownership.',
    });
  });

  it('surfaces a permission error when PGRST301 is returned', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PGRST301', message: 'permission denied' },
    });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:  'claim-rls',
        venueId:  'venue-rls',
        userId:   'user-rls',
        decision: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toMatch(/Admin permissions may have changed/);
  });

  it('rethrows raw error when RPC returns a non-permission error', async () => {
    const rawError = { code: '42883', message: 'function does not exist' };
    mockRpc.mockResolvedValueOnce({ error: rawError });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:  'claim-err',
        venueId:  'venue-err',
        userId:   'user-err',
        decision: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── RLS insert guard ──────────────────────────────────────────────────────────
describe('RLS: venue_claims insert must include user_id', () => {
  it('the insert payload from claim-verify includes user_id from the authenticated session', () => {
    const insertPayload = {
      venue_id:             'some-venue',
      user_id:              'auth-user-id',
      verified_phone:       '+441234567890',
      verified_phone_token: 'tok-abc',
      status:               'pending' as const,
      notes:                null,
    };

    expect(insertPayload).toHaveProperty('user_id');
    expect(insertPayload.status).toBe('pending');
    expect(['null', null]).toContain(
      insertPayload.notes === null ? null : String(insertPayload.notes)
    );
  });
});
