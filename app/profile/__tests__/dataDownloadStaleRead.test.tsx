/**
 * dataDownloadStaleRead.test.tsx
 *
 * ADVERSARIAL harness for the 2026-08-21 real-device report: after
 * A -> sign out -> explicit sign-in as B, Account B was still shown
 * "You downloaded your data recently…" with Account A's timestamp — even
 * though the per-account SecureStore key had shipped and its unit tests passed.
 *
 * The existing suite (dataDownloadAccountBoundary.test.tsx) mounts and unmounts
 * the screen around an identity change, so every SecureStore read resolves
 * before the next step. That is NOT what a phone does. This suite therefore
 * drives the things that suite cannot:
 *
 *   - the identity changing on a screen that STAYS MOUNTED,
 *   - SecureStore reads that resolve OUT OF ORDER (A's read landing after B's),
 *   - rapid A -> B -> A switching,
 *   - an export whose write lands after the identity has moved on,
 *   - the legacy device-global key being present on an upgrading device.
 *
 * Storage is a real map behind the mocked native module, and every read is a
 * promise this test resolves by hand, so the ordering is exact rather than
 * hopeful.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react-native';
import DataDownloadScreen, { exportCooldownKey, buildCooldownRecord } from '../data-download';

// ---------------------------------------------------------------------------
// A real key/value store behind the native boundary, with MANUAL control over
// when each read resolves.
// ---------------------------------------------------------------------------
const mockStore = new Map<string, string>();

/** Pending reads, in call order, so a test can resolve them out of order. */
const mockPendingReads: { key: string; resolve: () => void }[] = [];

/** When true, getItemAsync parks until the test releases it. */
const mockControl = { manualReads: false };

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => {
    if (!mockControl.manualReads) {
      return Promise.resolve(mockStore.get(key) ?? null);
    }
    return new Promise((resolvePromise) => {
      mockPendingReads.push({
        key,
        // Reads the CURRENT value at release time, exactly as a real read that
        // completes later would.
        resolve: () => resolvePromise(mockStore.get(key) ?? null),
      });
    });
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

// The signed-in account. Switched between renders exactly as a real sign-out /
// sign-in switches it, WITHOUT unmounting the screen.
const mockAuth = { userId: 'user-a' as string | null };
const mockSubscribers = new Set<() => void>();

jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => {
    // Minimal re-implementation of a zustand selector subscription, so an
    // identity change re-renders a MOUNTED screen the way the real store does.
    const ReactActual = require('react');
    const [, force] = ReactActual.useState(0);
    ReactActual.useEffect(() => {
      const cb = () => force((n: number) => n + 1);
      mockSubscribers.add(cb);
      return () => { mockSubscribers.delete(cb); };
    }, []);
    return selector({ user: mockAuth.userId ? { id: mockAuth.userId } : null });
  },
}));

/** Change the signed-in account on a screen that stays mounted. */
async function switchAccount(userId: string | null) {
  await act(async () => {
    mockAuth.userId = userId;
    mockSubscribers.forEach((cb) => cb());
    await Promise.resolve();
  });
}

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
const ONE_HOUR_AGO = String(Date.now() - 3_600_000);
const TWO_HOURS_AGO = String(Date.now() - 7_200_000);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Release a parked read by key, MOST RECENT first.
 *
 * Order matters: switching A -> B -> A queues a second read for A, and the
 * interesting one is the latest (the current identity's), not the first
 * (already cancelled) one.
 */
async function releaseRead(key: string): Promise<boolean> {
  const index = mockPendingReads.map((r) => r.key).lastIndexOf(key);
  if (index === -1) return false;
  const [pending] = mockPendingReads.splice(index, 1);
  await act(async () => {
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return true;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockPendingReads.length = 0;
  mockControl.manualReads = false;
  mockAuth.userId = 'user-a';
  mockSubscribers.clear();
});

// ===========================================================================
describe('identity change on a screen that stays mounted', () => {
  it('drops Account A’s cooldown the moment the account becomes B', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Number(ONE_HOUR_AGO)));

    render(<DataDownloadScreen />);
    await waitFor(() => expect(screen.getByText(COOLDOWN_TEXT)).toBeTruthy());

    // Sign out, then sign in as B — the screen is never unmounted.
    await switchAccount(null);
    await switchAccount('user-b');
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });

  it('shows no cooldown during the signed-out moment in between', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Number(ONE_HOUR_AGO)));

    render(<DataDownloadScreen />);
    await waitFor(() => expect(screen.getByText(COOLDOWN_TEXT)).toBeTruthy());

    await switchAccount(null);
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });
});

// ===========================================================================
describe('out-of-order SecureStore reads', () => {
  it('A’s read resolving LATE cannot set B’s cooldown', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Number(ONE_HOUR_AGO)));
    mockControl.manualReads = true;

    // A mounts; A's read parks.
    render(<DataDownloadScreen />);
    await settle();
    expect(mockPendingReads.some((r) => r.key === exportCooldownKey('user-a'))).toBe(true);

    // Identity moves to B while A's read is still in flight; B's read parks too.
    await switchAccount('user-b');
    await settle();

    // B's read resolves first (B has no timestamp)…
    await releaseRead(exportCooldownKey('user-b'));
    // …and only THEN does A's stale read land.
    await releaseRead(exportCooldownKey('user-a'));
    await settle();

    // THE INVARIANT: a stale result for the previous account must never reach
    // the new account's UI.
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });

  it('the reverse ordering is equally safe (A resolves before B)', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Number(ONE_HOUR_AGO)));
    mockControl.manualReads = true;

    render(<DataDownloadScreen />);
    await settle();
    await switchAccount('user-b');
    await settle();

    await releaseRead(exportCooldownKey('user-a'));
    await releaseRead(exportCooldownKey('user-b'));
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });

  it('rapid A -> B -> A switching ends on A’s OWN cooldown, not a stale one', async () => {
    mockStore.set(exportCooldownKey('user-a'), buildCooldownRecord('user-a', Number(ONE_HOUR_AGO)));
    mockStore.set(exportCooldownKey('user-b'), buildCooldownRecord('user-b', Number(TWO_HOURS_AGO)));
    mockControl.manualReads = true;

    render(<DataDownloadScreen />);
    await settle();
    await switchAccount('user-b');
    await settle();
    await switchAccount('user-a');
    await settle();

    // Everything lands in the worst possible order: the two stale reads last.
    await releaseRead(exportCooldownKey('user-a')); // the CURRENT identity's read
    await releaseRead(exportCooldownKey('user-b')); // stale
    await settle();

    // A legitimately has a cooldown, so it must be shown — from A's own value.
    await waitFor(() => expect(screen.getByText(COOLDOWN_TEXT)).toBeTruthy());
  });

  it('a stale read for B cannot leak B’s cooldown to A', async () => {
    // Only B has a timestamp. If a stale read leaked, A would show a cooldown
    // it never earned — the same defect in the opposite direction.
    mockStore.set(exportCooldownKey('user-b'), buildCooldownRecord('user-b', Number(ONE_HOUR_AGO)));
    mockControl.manualReads = true;

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);
    await settle();

    await switchAccount('user-a');
    await settle();

    await releaseRead(exportCooldownKey('user-a'));
    await releaseRead(exportCooldownKey('user-b'));
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });
});

// ===========================================================================
describe('an export whose write lands after the identity moved on', () => {
  it('does not paint the outgoing account’s cooldown for the new account', async () => {
    mockAuth.userId = 'user-a';
    render(<DataDownloadScreen />);
    await waitFor(() => screen.getByText('Request download'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Request data download'));
    });
    await waitFor(() => expect(mockStore.has(exportCooldownKey('user-a'))).toBe(true));

    // The account switches immediately after A's export completes.
    await switchAccount('user-b');
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
    // A's timestamp belongs to A's key and nowhere else.
    expect(mockStore.has(exportCooldownKey('user-b'))).toBe(false);
    expect(mockStore.has(LEGACY_GLOBAL_KEY)).toBe(false);
  });
});

// ===========================================================================
describe('the legacy device-global key on an upgrading device', () => {
  it('is deleted and never attributed to either account', async () => {
    mockStore.set(LEGACY_GLOBAL_KEY, ONE_HOUR_AGO);

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
    await waitFor(() => expect(mockStore.has(LEGACY_GLOBAL_KEY)).toBe(false));

    // And switching accounts does not resurrect it for anyone.
    await switchAccount('user-a');
    await settle();
    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
    expect(mockStore.has(LEGACY_GLOBAL_KEY)).toBe(false);
  });
});

// ===========================================================================
// THE DEVICE STATE.
//
// Every ordering above passes, so the per-account key logic and the read
// cancellation are both sound — the stale-read race is NOT what the phone hit.
// That leaves exactly one way the phone could render a cooldown for Account B:
// a value present under a key this screen reads for B.
//
// A bare numeric timestamp carries NO evidence of who it belongs to. Any build
// before the per-account change wrote exactly that, and a value can also land
// under the wrong key during an account-confusion episode (which is precisely
// what the resurrection bug produced on this device). The screen cannot tell
// such a value apart from one the current user legitimately earned — so it
// showed it.
//
// The correction: a stored record must IDENTIFY the account it was written for.
// Anything unattributable is discarded rather than displayed.
// ===========================================================================
describe('an unattributable timestamp under the current account’s key', () => {
  it('is NOT shown as the current account’s cooldown', async () => {
    // Exactly what the device had: a bare timestamp readable for Account B,
    // produced under Account A.
    mockStore.set(exportCooldownKey('user-b'), ONE_HOUR_AGO);

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
    const btn = screen.getByLabelText('Request data download');
    expect(btn.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('is deleted, so it cannot be shown on a later visit either', async () => {
    mockStore.set(exportCooldownKey('user-b'), ONE_HOUR_AGO);

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);
    await settle();

    await waitFor(() => expect(mockStore.has(exportCooldownKey('user-b'))).toBe(false));
  });

  it('a record written FOR THIS ACCOUNT is still honoured', async () => {
    mockStore.set(
      exportCooldownKey('user-b'),
      JSON.stringify({ userId: 'user-b', ts: Number(ONE_HOUR_AGO) }),
    );

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);

    await waitFor(() => expect(screen.getByText(COOLDOWN_TEXT)).toBeTruthy());
  });

  it('a record naming a DIFFERENT account is refused even under this key', async () => {
    mockStore.set(
      exportCooldownKey('user-b'),
      JSON.stringify({ userId: 'user-a', ts: Number(ONE_HOUR_AGO) }),
    );

    mockAuth.userId = 'user-b';
    render(<DataDownloadScreen />);
    await settle();

    expect(screen.queryByText(COOLDOWN_TEXT)).toBeNull();
  });

  it('writes a self-identifying record, so the next read can attribute it', async () => {
    mockAuth.userId = 'user-a';
    render(<DataDownloadScreen />);
    await waitFor(() => screen.getByText('Request download'));

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Request data download'));
    });

    await waitFor(() => expect(mockStore.has(exportCooldownKey('user-a'))).toBe(true));
    const stored = JSON.parse(mockStore.get(exportCooldownKey('user-a'))!);
    expect(stored.userId).toBe('user-a');
    expect(typeof stored.ts).toBe('number');
  });
});
