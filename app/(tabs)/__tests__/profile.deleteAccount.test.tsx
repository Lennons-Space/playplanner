/**
 * Tests for the "Delete account" flow in app/(tabs)/profile.tsx.
 *
 * GDPR Art.17 (right to erasure) compliance fix — covers the client-side
 * half of migration 051_account_deletion_photo_cleanup.sql:
 *
 *   1. Before calling delete_own_account(), the screen fetches this user's
 *      own UNAPPROVED (status <> 'approved') photo storage paths and removes
 *      them from the `venue-photos` Storage bucket.
 *   2. delete_own_account() is then called regardless of whether the storage
 *      removal succeeded — a Storage error must never block account deletion
 *      (the DB rows, deleted by the RPC, are the source of truth).
 *   3. No user/photo identifiers (paths, ids) are ever passed to console.error
 *      — only generic error metadata (code/message).
 *
 * Server-side behaviour (FK ON DELETE SET NULL anonymisation, deletion of
 * unapproved DB rows inside the RPC) is DB-enforced and verified separately
 * via the verification SQL block in the migration — it cannot run under jest
 * (no Postgres).
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import ProfileScreen from '../profile';

// ── Helpers ─────────────────────────────────────────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks (hoisted) ─────────────────────────────────────────────────────────

const mockRemove = jest.fn().mockResolvedValue({ data: null, error: null });
const mockNeq    = jest.fn();
const mockEq     = jest.fn(() => ({ neq: mockNeq }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockRpc    = jest.fn().mockResolvedValue({ error: null });

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ select: mockSelect })),
    storage: {
      from: jest.fn(() => ({ remove: mockRemove })),
    },
    rpc: jest.fn(),
  },
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({ user: { id: 'user-test-id' }, signOut: mockSignOut }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useProfile: jest.fn(() => ({
    id: 'user-test-id',
    full_name: 'Test Parent',
    avatar_url: null,
    is_premium: false,
    created_at: '2024-01-01T00:00:00Z',
    postcode: null,
  })),
  useUser: jest.fn(() => ({ id: 'user-test-id' })),
}));

// Stats are surfaced via useSavedVenueIds — mock it so the test stays isolated
// from the favourites query.
jest.mock('@/hooks/useFavourites', () => ({
  useSavedVenueIds: jest.fn(() => ({ savedIds: new Set(), isLoading: false })),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'View',
}));

jest.mock('@/components/ui', () => ({
  Icon: () => null,
  PPBrandMark: () => null,
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** Simulates the user confirming the destructive "Delete" alert button. */
function pressDeleteAccount(getByLabelText: (label: string) => any) {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    const destructive = buttons?.find((b) => b.style === 'destructive');
    destructive?.onPress?.();
  });
  fireEvent.press(getByLabelText('Permanently delete your account and all your data'));
  return alertSpy;
}

const mockRpcFn    = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;
const mockFromFn   = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockStorageFromFn = supabase.storage.from as jest.MockedFunction<typeof supabase.storage.from>;

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ error: null });
  mockRpcFn.mockImplementation(mockRpc as any);
  mockRemove.mockResolvedValue({ data: null, error: null });
  mockNeq.mockResolvedValue({ data: [], error: null });
  mockEq.mockImplementation(() => ({ neq: mockNeq }));
  mockSelect.mockImplementation(() => ({ eq: mockEq }));
  mockFromFn.mockImplementation(() => ({ select: mockSelect } as any));
  mockStorageFromFn.mockImplementation(() => ({ remove: mockRemove } as any));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ProfileScreen — delete account (GDPR Art.17 photo cleanup)', () => {
  it('fetches unapproved photo storage paths, removes them from storage, then calls delete_own_account', async () => {
    mockNeq.mockResolvedValue({
      data: [{ storage_path: 'venue-1/photo-a.jpg' }, { storage_path: 'venue-2/photo-b.jpg' }],
      error: null,
    });

    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    pressDeleteAccount(getByLabelText);

    await waitFor(() => {
      expect(mockFromFn).toHaveBeenCalledWith('venue_photos');
      expect(mockSelect).toHaveBeenCalledWith('storage_path');
      expect(mockEq).toHaveBeenCalledWith('uploaded_by', 'user-test-id');
      expect(mockNeq).toHaveBeenCalledWith('status', 'approved');
    });

    await waitFor(() => {
      expect(mockStorageFromFn).toHaveBeenCalledWith('venue-photos');
      expect(mockRemove).toHaveBeenCalledWith(['venue-1/photo-a.jpg', 'venue-2/photo-b.jpg']);
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('delete_own_account');
    });

    // Storage cleanup must run BEFORE the RPC (order matters: orphaned
    // blobs are an acceptable trade-off, a blocked deletion is not).
    const removeOrder = mockRemove.mock.invocationCallOrder[0];
    const rpcOrder    = mockRpc.mock.invocationCallOrder[0];
    expect(removeOrder).toBeLessThan(rpcOrder);
  });

  it('does not call storage.remove when the user has no unapproved photos', async () => {
    mockNeq.mockResolvedValue({ data: [], error: null });

    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    pressDeleteAccount(getByLabelText);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('delete_own_account');
    });

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('still calls delete_own_account when the storage removal fails (non-blocking)', async () => {
    mockNeq.mockResolvedValue({ data: [{ storage_path: 'venue-1/photo-a.jpg' }], error: null });
    mockRemove.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    pressDeleteAccount(getByLabelText);

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalled();
      expect(mockRpc).toHaveBeenCalledWith('delete_own_account');
    });

    errorSpy.mockRestore();
  });

  it('still calls delete_own_account when fetching unapproved photos fails (non-blocking)', async () => {
    mockNeq.mockResolvedValue({ data: null, error: { code: 'PGRST000', message: 'boom' } });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    pressDeleteAccount(getByLabelText);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('delete_own_account');
    });
    expect(mockRemove).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('never logs user/photo identifiers (storage paths or ids) to the console', async () => {
    mockNeq.mockResolvedValue({
      data: [{ storage_path: 'venue-secret-id/photo-secret-id.jpg' }],
      error: null,
    });
    mockRemove.mockResolvedValue({ data: null, error: { message: 'failed' } });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    pressDeleteAccount(getByLabelText);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('delete_own_account');
    });

    for (const call of errorSpy.mock.calls) {
      const serialised = call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
      expect(serialised).not.toContain('venue-secret-id');
      expect(serialised).not.toContain('photo-secret-id');
      expect(serialised).not.toContain('user-test-id');
    }

    errorSpy.mockRestore();
  });
});
