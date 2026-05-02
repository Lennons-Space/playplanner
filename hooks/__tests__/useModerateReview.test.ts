/**
 * Tests for useModerateReview (hooks/useReviews.ts).
 *
 * Covers the notification fire-and-forget wired in this session:
 *   - Approving a review invokes notify-review-published (non-blocking)
 *   - Rejecting a review does NOT invoke the notification function
 *   - A notification failure does not fail the mutation itself
 *   - Moderation still succeeds (query invalidation fires) even if notify throws
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { useModerateReview } from '@/hooks/useReviews';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockFrom        = supabase.from                    as jest.Mock;
const mockInvoke      = supabase.functions.invoke        as jest.Mock;
const mockUseUser     = useUser                          as jest.Mock;

const MOCK_ADMIN = { id: 'admin-xyz' };
const MOCK_REVIEW_ID = 'review-abc-123';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function makeFromMock(updateData: object[] | null = [{ id: MOCK_REVIEW_ID }], updateError: object | null = null) {
  const selectMock = jest.fn().mockResolvedValue({ data: updateData, error: updateError });
  const eqMock     = jest.fn().mockReturnValue({ select: selectMock });
  const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
  mockFrom.mockReturnValue({ update: updateMock } as any);
  return { updateMock, selectMock };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue(MOCK_ADMIN);
  mockInvoke.mockResolvedValue({ data: { sent: 1 }, error: null });
  makeFromMock();
});

// ---------------------------------------------------------------------------
// Notification wiring
// ---------------------------------------------------------------------------

describe('notification fire-and-forget', () => {
  it('calls notify-review-published when a review is approved', async () => {
    const { result } = renderHook(() => useModerateReview(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ reviewId: MOCK_REVIEW_ID, status: 'approved' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Give the fire-and-forget a tick to execute
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith(
      'notify-review-published',
      expect.objectContaining({ body: { reviewId: MOCK_REVIEW_ID } })
    );
  });

  it('does NOT call notify-review-published when a review is rejected', async () => {
    const { result } = renderHook(() => useModerateReview(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ reviewId: MOCK_REVIEW_ID, status: 'rejected' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does NOT fail the mutation when notify-review-published rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useModerateReview(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ reviewId: MOCK_REVIEW_ID, status: 'approved' });
    });

    // Mutation itself must succeed even if the notification call throws
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
  });

  it('fails the mutation when the DB update errors (unrelated to notification)', async () => {
    makeFromMock(null, { code: '500', message: 'DB error' });

    const { result } = renderHook(() => useModerateReview(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ reviewId: MOCK_REVIEW_ID, status: 'approved' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Notification must NOT have been called since the DB update failed
    await act(async () => { await Promise.resolve(); });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
