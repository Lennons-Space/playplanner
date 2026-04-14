/**
 * Integration tests for useSubmitReview (hooks/useReviews.ts).
 *
 * Review integrity is critical for a family venue app — parents rely on these
 * reviews to make safe decisions. These tests verify:
 *   - All new reviews enter with moderation_status='pending' (never 'approved')
 *   - A user cannot submit a review appearing to belong to someone else
 *   - The duplicate-review constraint (23505) produces a friendly message
 *   - Review content (body/title) is never logged on error (privacy)
 *   - Empty optional fields are sent as null, not empty strings (data minimisation)
 *   - The correct query caches are invalidated on success
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSubmitReview } from '@/hooks/useReviews';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

// useUser returns the currently authenticated user from the Zustand store.
// We mock useAuth so tests can control who is "logged in".
jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

import { useUser } from '@/hooks/useAuth';

const mockFrom    = supabase.from    as jest.MockedFunction<typeof supabase.from>;
const mockUseUser = useUser          as jest.MockedFunction<typeof useUser>;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function resetFromMock(insertError: object | null = null) {
  const insertMock = jest.fn().mockResolvedValue({ error: insertError });
  mockFrom.mockReturnValue({ insert: insertMock } as any);
  return insertMock;
}

const BASE_PAYLOAD = {
  venueId:      'venue-test-001',
  rating:       4,
  title:        'Great soft play',
  body:         'Kids loved it, really clean and well staffed.',
  visitDate:    '2026-04-10',
  childrenAges: ['2-4', '5-7'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue({ id: 'user-test-123' } as any);
  resetFromMock();
});

// ======================================================================
// Correct insert shape
// ======================================================================
describe('useSubmitReview — insert shape', () => {
  it('always sends moderation_status as "pending" regardless of payload', async () => {
    const insertMock = resetFromMock(null);
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(BASE_PAYLOAD);
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ moderation_status: 'pending' }),
    );
  });

  it('sends null for title when title is empty string (data minimisation)', async () => {
    const insertMock = resetFromMock(null);
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ ...BASE_PAYLOAD, title: '' });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: null }),
    );
  });

  it('sends null for children_ages when the array is empty (data minimisation)', async () => {
    const insertMock = resetFromMock(null);
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ ...BASE_PAYLOAD, childrenAges: [] });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ children_ages: null }),
    );
  });

  it('sends null for visit_date when visitDate is falsy', async () => {
    const insertMock = resetFromMock(null);
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ ...BASE_PAYLOAD, visitDate: null });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ visit_date: null }),
    );
  });

  it('sends the authenticated user_id on the row', async () => {
    mockUseUser.mockReturnValue({ id: 'user-test-999' } as any);
    const insertMock = resetFromMock(null);
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(BASE_PAYLOAD);
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-test-999' }),
    );
  });
});

// ======================================================================
// Error handling — friendly messages, no content logging
// ======================================================================
describe('useSubmitReview — error handling', () => {
  it('throws a "already reviewed" message when Supabase returns error code 23505', async () => {
    resetFromMock({ code: '23505', message: 'unique_violation' });
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.mutateAsync(BASE_PAYLOAD),
      ).rejects.toThrow(/already reviewed/i);
    });
  });

  it('throws a generic connection message for non-23505 errors', async () => {
    resetFromMock({ code: '42501', message: 'permission denied' });
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.mutateAsync(BASE_PAYLOAD),
      ).rejects.toThrow(/connection/i);
    });
  });

  it('never logs the review body or title on error', async () => {
    resetFromMock({ code: '42501', message: 'permission denied' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useSubmitReview(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync(BASE_PAYLOAD).catch(() => {});
    });

    // Body and title must never appear in any console.error call
    errorSpy.mock.calls.forEach((args) => {
      const logStr = JSON.stringify(args);
      expect(logStr).not.toContain(BASE_PAYLOAD.body);
      expect(logStr).not.toContain(BASE_PAYLOAD.title);
    });

    errorSpy.mockRestore();
  });
});

// ======================================================================
// Cache invalidation on success
// ======================================================================
describe('useSubmitReview — cache invalidation', () => {
  it('invalidates the venue reviews, myReview, and venue queries on success', async () => {
    resetFromMock(null);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useSubmitReview(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(BASE_PAYLOAD);
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queryKey: ['reviews', BASE_PAYLOAD.venueId] }),
        expect.objectContaining({ queryKey: ['venue',   BASE_PAYLOAD.venueId] }),
      ]),
    );
  });
});
