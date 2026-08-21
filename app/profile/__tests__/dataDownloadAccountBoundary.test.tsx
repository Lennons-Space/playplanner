/**
 * dataDownloadAccountBoundary.test.tsx
 *
 * REPRODUCTION + REGRESSION for the second 2026-08-21 real-device failure.
 *
 * WHAT HAPPENED
 * -------------
 * Account A requested a data download. The tester then signed out and signed in
 * as Account B on the same device. B's "My reviews" screen correctly showed
 * "You haven't written any reviews yet." — but B's Download My Data screen said:
 *
 *     "You downloaded your data recently. You can request another download
 *      after 21 Aug 2026 at 22:53."
 *
 * That timestamp was written while Account A was signed in.
 *
 * THE DEFECT (category A: local client state keyed globally, not by auth.uid())
 * ----------------------------------------------------------------------------
 * app/profile/data-download.tsx persisted the last-export time under a single
 * device-global SecureStore key, 'playplanner.last_data_export'. It was read on
 * mount with no reference to who was signed in, and nothing removed it at
 * sign-out. So every account on the device inherited the previous account's
 * cooldown — and with it the disclosure that somebody else had exported their
 * personal data from this device, which is metadata about another data subject.
 *
 * It was NOT a React Query cache issue (this screen uses no query), NOT a
 * Zustand issue, and NOT a database issue — the cooldown never touched the
 * server at all.
 *
 * These tests drive the REAL screen against a real in-memory SecureStore, and
 * assert on what the user actually sees.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react-native';
import DataDownloadScreen, { exportCooldownKey, buildCooldownRecord } from '../data-download';

// ---------------------------------------------------------------------------
// A real key/value store behind the SecureStore boundary, so the test observes
// which KEYS the screen actually reads and writes rather than trusting a stub
// that answers every key identically (which is what let this bug through).
// ---------------------------------------------------------------------------
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

// The signed-in account, switched between renders exactly as a sign-out /
// sign-in on a shared device switches it.
const mockAuth = { userId: 'user-a' as string | null };

jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: mockAuth.userId ? { id: mockAuth.userId } : null }),
}));

jest.mock('expo-router', () => ({ Stack: { Screen: 'View' } }));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('@/components/ui/V2Background', () => ({ V2Background: () => null }));

jest.mock('@/hooks/useDataRights', () => ({
  buildDataExport: jest.fn().mockResolvedValue('{}'),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///tmp/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

const COOLDOWN_TEXT = /You downloaded your data recently/;
const LEGACY_GLOBAL_KEY = 'playplanner.last_data_export';

/** Flush the screen's async SecureStore read so assertions are deterministic. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockAuth.userId = 'user-a';
});

// ===========================================================================
describe('Download My Data — account boundary', () => {
  it('Account B does NOT inherit Account A’s cooldown', async () => {
    // Account A exported one hour ago.
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Date.now() - 3_600_000));

    const a = render(<DataDownloadScreen />);
    await waitFor(() => expect(screen.getByText(COOLDOWN_TEXT)).toBeTruthy());
    a.unmount();

    // Sign out, sign in as Account B on the same device.
    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);

    await waitFor(() => expect(screen.getByText('Request download')).toBeTruthy());
    await settle();
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });

  it('Account B’s download button is enabled while Account A is on cooldown', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Date.now() - 3_600_000));

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);

    // Settle the screen's async SecureStore read FIRST. Asserting inside
    // waitFor would pass on the very first attempt — before the read resolves —
    // and would therefore have passed against the buggy implementation too.
    await settle();

    const btn = screen.getByLabelText('Request data download');
    expect(btn.props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });

  it('an account still sees its OWN cooldown (the control)', async () => {
    mockStore.set(exportCooldownKey('user-b'), buildCooldownRecord('user-b', Date.now() - 3_600_000));

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);

    await waitFor(() => expect(screen.getByText(COOLDOWN_TEXT)).toBeTruthy());
  });

  it('writes the timestamp under a key scoped to the exporting account', async () => {
    mockAuth.userId = 'user-a';
    render(<DataDownloadScreen />);
    await waitFor(() => screen.getByText('Request download'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Request data download'));
    });

    await waitFor(() => {
      expect(mockStore.has(exportCooldownKey('user-a'))).toBe(true);
    });
    // The device-global key must never be written again.
    expect(mockStore.has(LEGACY_GLOBAL_KEY)).toBe(false);
  });

  it('deletes the legacy device-global key instead of serving it to anyone', async () => {
    // A device upgrading from the previous build still has the global entry,
    // written by whoever exported last.
    mockStore.set(LEGACY_GLOBAL_KEY, String(Date.now() - 3_600_000));

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);

    await waitFor(() => expect(screen.getByText('Request download')).toBeTruthy());
    await settle();
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
    await waitFor(() => expect(mockStore.has(LEGACY_GLOBAL_KEY)).toBe(false));
  });

  it('shows no cooldown at all when nobody is signed in', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Date.now() - 3_600_000));

    mockAuth.userId = null;
    render(<DataDownloadScreen />);

    await waitFor(() => expect(screen.getByText('Request download')).toBeTruthy());
    await settle();
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });
});

// ===========================================================================
// Signed-out safety.
//
// On the 2026-08-21 device retest the app showed a signed-out UI and Download
// My Data still produced a real playplanner_data_export.json. The cause was NOT
// in this screen: the session had been resurrected, so the request was genuinely
// authenticated and get_my_profile_export() resolved a real auth.uid(). That is
// fixed in the auth layer (lib/authTombstone.ts, hooks/__tests__/authResurrection).
//
// These tests pin down the screen's own half of the invariant: with no session,
// nothing is exported, and a refusal from buildDataExport() is surfaced rather
// than being turned into a cooldown.
// ===========================================================================
describe('Download My Data — signed out', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildDataExport } = require('@/hooks/useDataRights') as {
    buildDataExport: jest.Mock;
  };

  it('never calls buildDataExport when nobody is signed in', async () => {
    mockAuth.userId = null;
    render(<DataDownloadScreen />);
    await waitFor(() => screen.getByText('Request download'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Request data download'));
    });

    expect(buildDataExport).not.toHaveBeenCalled();
    expect([...mockStore.keys()]).toEqual([]);
  });

  it('surfaces a refusal and records NO cooldown when the session is gone', async () => {
    // What buildDataExport does when supabase.auth.getSession() returns null.
    buildDataExport.mockRejectedValueOnce(
      new Error('Your session has expired. Please sign in again to download your data.'),
    );

    mockAuth.userId = 'user-a';
    render(<DataDownloadScreen />);
    await waitFor(() => screen.getByText('Request download'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Request data download'));
    });

    await waitFor(() =>
      expect(screen.getByText(/Something went wrong preparing your data/)).toBeTruthy(),
    );
    // A refused export is not an export: no timestamp may be written, or the
    // user would be locked out of a right they never exercised.
    expect(mockStore.has(exportCooldownKey('user-a'))).toBe(false);
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });
});
