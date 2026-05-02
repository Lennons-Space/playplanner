/**
 * Tests for usePushNotifications (hooks/usePushNotifications.ts).
 *
 * Push tokens are personal data under GDPR — correctness matters:
 *   - No token is saved without explicit user consent (permission granted)
 *   - Registration is blocked when projectId is missing (Expo SDK 49+ requirement)
 *   - Unregister deletes the correct token (specific if known, all if not)
 *   - DB errors are surfaced as false without exposing token values in logs
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

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

// expo-notifications — mock the functions the hook calls
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync:  jest.fn(),
  getExpoPushTokenAsync:    jest.fn(),
  setNotificationHandler:   jest.fn(), // no-op; moved to _layout.tsx
}));

// expo-constants — control isDevice and projectId
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    isDevice: true,
    expoConfig: {
      extra: {
        eas: { projectId: 'test-project-id' },
      },
    },
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const mockGetToken            = Notifications.getExpoPushTokenAsync   as jest.Mock;
const mockFrom                = supabase.from                          as jest.Mock;
const mockUseUser             = useUser                                as jest.Mock;
const mockConstants           = Constants as jest.Mocked<typeof Constants>;

const MOCK_USER = { id: 'user-abc' };
const MOCK_TOKEN = 'ExponentPushToken[test-token-123]';

// Exposed so tests can inspect the cache after unregister().
let testQueryClient: QueryClient;

function makeWrapper() {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const client = testQueryClient;
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue(MOCK_USER);
  (mockConstants as any).isDevice = true;
  (mockConstants as any).expoConfig = { extra: { eas: { projectId: 'test-project-id' } } };
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: MOCK_TOKEN });
  mockFrom.mockReturnValue({
    upsert: jest.fn().mockResolvedValue({ error: null }),
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    }),
  } as any);
});

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------

describe('register()', () => {
  it('returns false when not a physical device', async () => {
    (mockConstants as any).isDevice = false;

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    let success: boolean;
    await act(async () => { success = await result.current.register(); });

    expect(success!).toBe(false);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('returns false when user is not authenticated', async () => {
    mockUseUser.mockReturnValue(null);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    let success: boolean;
    await act(async () => { success = await result.current.register(); });

    expect(success!).toBe(false);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('returns false when OS permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    let success: boolean;
    await act(async () => { success = await result.current.register(); });

    expect(success!).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('returns false when EAS projectId is missing', async () => {
    (mockConstants as any).expoConfig = { extra: { eas: {} } };

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    let success: boolean;
    await act(async () => { success = await result.current.register(); });

    expect(success!).toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('upserts token and sets isRegistered on success', async () => {
    const upsertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: upsertMock } as any);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    let success: boolean;
    await act(async () => { success = await result.current.register(); });

    expect(success!).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: MOCK_USER.id, token: MOCK_TOKEN }),
      expect.anything()
    );
    expect(result.current.isRegistered).toBe(true);
  });

  it('returns false and does not set isRegistered when upsert fails', async () => {
    const upsertMock = jest.fn().mockResolvedValue({ error: { code: '500', message: 'db error' } });
    mockFrom.mockReturnValue({ upsert: upsertMock } as any);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    let success: boolean;
    await act(async () => { success = await result.current.register(); });

    expect(success!).toBe(false);
    expect(result.current.isRegistered).toBe(false);
  });

  it('clears isLoading after register resolves', async () => {
    const upsertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: upsertMock } as any);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    await act(async () => { await result.current.register(); });

    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unregister()
// ---------------------------------------------------------------------------

describe('unregister()', () => {
  it('does nothing when user is not authenticated', async () => {
    mockUseUser.mockReturnValue(null);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    await act(async () => { await result.current.unregister(); });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('sets isRegistered to false after unregister', async () => {
    // First register to set isRegistered = true
    const upsertMock = jest.fn().mockResolvedValue({ error: null });
    const deleteEqMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom
      .mockReturnValueOnce({ upsert: upsertMock } as any)
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: deleteEqMock }) }) } as any);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });

    await act(async () => { await result.current.register(); });
    expect(result.current.isRegistered).toBe(true);

    await act(async () => { await result.current.unregister(); });
    expect(result.current.isRegistered).toBe(false);
  });

  it('clears isLoading after unregister resolves', async () => {
    mockFrom.mockReturnValue({
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    } as any);

    const { result } = renderHook(() => usePushNotifications(), { wrapper: makeWrapper() });
    await act(async () => { await result.current.unregister(); });

    expect(result.current.isLoading).toBe(false);
  });

  it('writes false into the push-tokens query cache after successful delete', async () => {
    mockFrom.mockReturnValue({
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    } as any);

    // Call makeWrapper first so testQueryClient is assigned, then spy on it
    // before the hook renders so we catch the setQueryData call.
    const wrapper = makeWrapper();
    const setQueryDataSpy = jest.spyOn(testQueryClient, 'setQueryData');

    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await act(async () => { await result.current.unregister(); });

    expect(setQueryDataSpy).toHaveBeenCalledWith(
      ['push-tokens', 'has-token', MOCK_USER.id],
      false
    );
  });
});
