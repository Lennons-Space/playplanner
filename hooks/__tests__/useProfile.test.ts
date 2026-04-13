/**
 * Tests for hooks/useProfile.ts
 *
 * Covers:
 *   - usePublicProfile: reads from public_profiles VIEW only, handles null (private),
 *     disabled when userId is undefined
 *   - useUpdateProfile: sends only the fields passed (data minimisation), invalidates cache
 *   - useUpdateChildrenAges: stores null for empty array (data minimisation),
 *     invalidates cache on success
 *   - useWithdrawLocationConsent: calls the audit service, invalidates consent cache
 *
 * GDPR focus areas tested:
 *   - Data minimisation (Art.5(1)(c)): useUpdateProfile must not overwrite unrelated columns
 *   - Consent withdrawal (Art.7(3)): useWithdrawLocationConsent must call recordLocationConsentWithdrawn
 *   - Children's data: useUpdateChildrenAges must store null (not []) when no ages selected
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { recordLocationConsentWithdrawn } from '@/services/consent/locationConsent';
import {
  usePublicProfile,
  useUpdateProfile,
  useUpdateChildrenAges,
  useWithdrawLocationConsent,
} from '@/hooks/useProfile';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => {
  // Build a chainable query builder. We keep the mocks stable so tests can
  // override the resolved value per-call with mockResolvedValueOnce.
  const builder: any = {
    select:     jest.fn().mockReturnThis(),
    eq:         jest.fn().mockReturnThis(),
    update:     jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
  };
  return {
    supabase: {
      from:    jest.fn(() => builder),
      storage: {
        from: jest.fn(() => ({
          upload:       jest.fn(),
          getPublicUrl: jest.fn(),
          remove:       jest.fn(),
        })),
      },
    },
    _builder: builder,
  };
});

jest.mock('@/services/consent/locationConsent', () => ({
  recordLocationConsentWithdrawn: jest.fn().mockResolvedValue(undefined),
}));

// Mock Zustand auth store — provide a stable user.id and a no-op fetchProfile.
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({
      user:         { id: 'user-abc' },
      fetchProfile: jest.fn(),
    }),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _builder } = require('@/lib/supabase') as { _builder: any };
const mockFrom     = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockWithdraw = recordLocationConsentWithdrawn as jest.MockedFunction<typeof recordLocationConsentWithdrawn>;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { Wrapper, client };
}

beforeEach(() => {
  jest.clearAllMocks();
  _builder.select.mockReturnThis();
  _builder.eq.mockReturnThis();
  _builder.update.mockReturnThis();
  _builder.maybeSingle.mockReset();
  mockFrom.mockReturnValue(_builder);
});

// ---------------------------------------------------------------------------
// usePublicProfile
// ---------------------------------------------------------------------------

describe('usePublicProfile', () => {
  it('returns the profile data when the view returns a row', async () => {
    const fakeProfile = {
      id: 'user-abc',
      username: 'happy_parent',
      full_name: 'Jane Doe',
      avatar_url: null,
      bio: 'Hi!',
      is_business_owner: false,
      show_reviews_publicly: true,
    };
    _builder.maybeSingle.mockResolvedValueOnce({ data: fakeProfile, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePublicProfile('user-abc'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(fakeProfile);
  });

  it('returns null when the view returns no row (private/not-found) — privacy gate', async () => {
    // maybeSingle() returns { data: null, error: null } when no row is found.
    // The hook must treat this as null (private), not an error.
    _builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePublicProfile('user-missing'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('throws when Supabase returns an error', async () => {
    _builder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST301', message: 'forbidden', hint: '' },
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePublicProfile('user-abc'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('is disabled (does not fetch) when userId is undefined', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePublicProfile(undefined), { wrapper: Wrapper });

    // Query must stay idle — it must not fire a Supabase call without a userId.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('queries public_profiles VIEW — never the full profiles table', async () => {
    _builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    renderHook(() => usePublicProfile('user-abc'), { wrapper: Wrapper });

    await waitFor(() => expect(mockFrom).toHaveBeenCalled());

    // Must always read from the view, never from the raw table.
    expect(mockFrom).toHaveBeenCalledWith('public_profiles');
    expect(mockFrom).not.toHaveBeenCalledWith('profiles');
  });

  it('does not expose children_ages in the select string', async () => {
    _builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    renderHook(() => usePublicProfile('user-abc'), { wrapper: Wrapper });

    await waitFor(() => expect(mockFrom).toHaveBeenCalled());

    // The select string must never include children_ages — it is private data.
    const selectCall = _builder.select.mock.calls[0]?.[0] ?? '';
    expect(selectCall).not.toContain('children_ages');
  });
});

// ---------------------------------------------------------------------------
// useUpdateProfile
// ---------------------------------------------------------------------------

describe('useUpdateProfile', () => {
  it('sends only the fields passed — data minimisation (GDPR Art.5(1)(c))', async () => {
    // The DB update call is the last in the chain. eq() resolves the promise.
    _builder.eq.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ full_name: 'Jane Updated' });
    });

    // update() must be called with ONLY the fields we passed.
    // It must NOT include the whole profile row — that would accidentally
    // overwrite columns we did not intend to change.
    expect(_builder.update).toHaveBeenCalledWith({ full_name: 'Jane Updated' });
    // Confirm it did NOT include sensitive columns we did not pass.
    const updateArg = (_builder.update as jest.Mock).mock.calls[0][0];
    expect(updateArg).not.toHaveProperty('children_ages');
    expect(updateArg).not.toHaveProperty('marketing_consent');
  });

  it('throws when the Supabase update fails', async () => {
    _builder.eq.mockResolvedValueOnce({ error: { message: 'unique violation' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ username: 'taken_name' })
      ).rejects.toBeTruthy();
    });
  });

  it('writes to the profiles table (not the view)', async () => {
    _builder.eq.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ bio: 'hello' });
    });

    expect(mockFrom).toHaveBeenCalledWith('profiles');
  });
});

// ---------------------------------------------------------------------------
// useUpdateChildrenAges
// ---------------------------------------------------------------------------

describe('useUpdateChildrenAges', () => {
  it('stores null (not []) when the age selection is empty — data minimisation', async () => {
    _builder.eq.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateChildrenAges(), { wrapper: Wrapper });

    // Pass an empty array — should result in null in the DB.
    await act(async () => {
      await result.current.mutateAsync([]);
    });

    // The update must store null, not an empty array.
    // GDPR Art.5(1)(c): we should not persist data we do not need.
    expect(_builder.update).toHaveBeenCalledWith({ children_ages: null });
  });

  it('stores the provided age ranges when non-empty', async () => {
    _builder.eq.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateChildrenAges(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(['2-3', '4-5']);
    });

    expect(_builder.update).toHaveBeenCalledWith({ children_ages: ['2-3', '4-5'] });
  });

  it('throws a friendly error message (not raw DB message) on failure', async () => {
    _builder.eq.mockResolvedValueOnce({ error: { message: 'raw DB error', code: 'PGRST001', hint: '' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateChildrenAges(), { wrapper: Wrapper });

    let caught: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync(['0-1']);
      } catch (e) {
        caught = e as Error;
      }
    });

    // The error message must be user-friendly — raw DB errors must not be exposed.
    expect(caught?.message).toMatch(/Could not save age ranges/);
    expect(caught?.message).not.toContain('raw DB error');
  });

  it('invalidates the profile cache on success', async () => {
    _builder.eq.mockResolvedValueOnce({ data: null, error: null });

    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateChildrenAges(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(['0-1']);
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: expect.arrayContaining(['profile']) }),
    );
  });
});

// ---------------------------------------------------------------------------
// useWithdrawLocationConsent
// ---------------------------------------------------------------------------

describe('useWithdrawLocationConsent', () => {
  it('calls recordLocationConsentWithdrawn — GDPR Art.7(3) compliance', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useWithdrawLocationConsent(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    // Withdrawal must be recorded in the audit log (Art.7(3) + Art.5(2)).
    expect(mockWithdraw).toHaveBeenCalledTimes(1);
  });

  it('invalidates the locationConsent query cache on success', async () => {
    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useWithdrawLocationConsent(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    // The consent status shown in the UI must refresh immediately after withdrawal.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['locationConsent'] }),
    );
  });

  it('propagates errors from the consent service', async () => {
    mockWithdraw.mockRejectedValueOnce(new Error('Network error'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useWithdrawLocationConsent(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('Network error');
    });
  });
});
