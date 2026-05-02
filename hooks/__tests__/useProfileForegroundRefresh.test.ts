/**
 * Tests for useProfileForegroundRefresh (hooks/useAuth.ts — BUG F fix).
 *
 * Why this behaviour matters for PlayPlanner:
 * - is_admin can be revoked server-side at any moment (e.g. by a super-admin
 *   responding to a safeguarding concern). Without this hook, the stale flag
 *   persists in Zustand for the entire session — the revoked admin could
 *   continue accessing the moderation panel.
 * - Fetching on foreground return is the lightest-weight solution: zero cost
 *   while backgrounded, no Realtime channel, no polling loop.
 *
 * Test strategy:
 * - Spy on AppState.addEventListener on the jest-expo preset's already-mocked
 *   react-native module (avoids requireActual which triggers native TurboModules).
 * - Capture the registered callback and drive AppState transitions directly.
 * - Mock useAuthStore with getState() so the hook can read imperatively.
 */

import { renderHook } from '@testing-library/react-native';
import { AppState, AppStateStatus } from 'react-native';

// ---------------------------------------------------------------------------
// Import the hook AFTER mocks are in place.
// ---------------------------------------------------------------------------

import { useProfileForegroundRefresh } from '../useAuth';
import { useAuthStore } from '@/store/authStore';

// ---------------------------------------------------------------------------
// authStore mock — must have getState() because the hook reads store imperatively.
// ---------------------------------------------------------------------------

const mockFetchProfile = jest.fn().mockResolvedValue(undefined);
let mockUser: { id: string } | null = { id: 'user-1' };

jest.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    // React selector overload — required so the import doesn't crash.
    jest.fn((selector: (s: unknown) => unknown) =>
      selector({ user: mockUser, fetchProfile: mockFetchProfile })
    ),
    {
      getState: jest.fn(() => ({
        user: mockUser,
        fetchProfile: mockFetchProfile,
      })),
    }
  ),
}));

// ---------------------------------------------------------------------------
// Supporting mocks required because useAuth.ts imports these at module level.
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  },
}));

jest.mock('@/store/mapStore', () => ({
  useMapStore: Object.assign(jest.fn(), {
    getState: jest.fn(() => ({ setPendingPostcode: jest.fn() })),
  }),
}));

jest.mock('@/services/consent/locationConsent', () => ({
  migratePendingLocationConsent: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// AppState spy — set up after imports so we patch the already-initialised mock.
// We spy on addEventListener and capture the callback, and use Object.defineProperty
// to control currentState between tests.
// ---------------------------------------------------------------------------

let capturedCallback: ((nextState: AppStateStatus) => void) | null = null;
const mockRemove = jest.fn();
let addEventListenerSpy: jest.SpyInstance;

function simulateTransition(nextState: AppStateStatus) {
  if (!capturedCallback) {
    throw new Error('AppState.addEventListener was not called — hook did not mount');
  }
  capturedCallback(nextState);
}

function setCurrentState(state: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', {
    get: () => state,
    configurable: true,
  });
}

beforeEach(() => {
  capturedCallback = null;
  mockFetchProfile.mockClear();
  mockRemove.mockClear();

  // Spy on addEventListener so we capture the callback without replacing react-native.
  addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event: string, cb: (state: AppStateStatus) => void) => {
      capturedCallback = cb;
      return { remove: mockRemove } as ReturnType<typeof AppState.addEventListener>;
    });

  // Default: start backgrounded so background→active fires correctly.
  setCurrentState('background');
  mockUser = { id: 'user-1' };

  // Keep getState() in sync with mockUser.
  (useAuthStore.getState as jest.Mock).mockImplementation(() => ({
    user: mockUser,
    fetchProfile: mockFetchProfile,
  }));
});

afterEach(() => {
  addEventListenerSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProfileForegroundRefresh', () => {
  it('calls fetchProfile when the app transitions from background to active with a signed-in user', () => {
    setCurrentState('background');
    mockUser = { id: 'user-1' };

    renderHook(() => useProfileForegroundRefresh());
    simulateTransition('active');

    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('does NOT call fetchProfile when no user is signed in', () => {
    setCurrentState('background');
    mockUser = null;
    (useAuthStore.getState as jest.Mock).mockReturnValue({
      user: null,
      fetchProfile: mockFetchProfile,
    });

    renderHook(() => useProfileForegroundRefresh());
    simulateTransition('active');

    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('does NOT call fetchProfile when the app was already active (active→active)', () => {
    // previousState is initialised to AppState.currentState at mount time.
    // If the app is already active when the hook mounts, an active event is ignored.
    setCurrentState('active');

    renderHook(() => useProfileForegroundRefresh());
    simulateTransition('active');

    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('does NOT call fetchProfile on background transitions — only on foreground return', () => {
    setCurrentState('active');

    renderHook(() => useProfileForegroundRefresh());

    // active→background (user presses home) — must not trigger a fetch.
    simulateTransition('background');

    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('removes the AppState subscription on unmount — no listener leak', () => {
    const { unmount } = renderHook(() => useProfileForegroundRefresh());

    unmount();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('registers exactly one AppState listener on mount', () => {
    renderHook(() => useProfileForegroundRefresh());

    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('reads user from getState() imperatively — not from stale closure at mount time', () => {
    // Mount with no user signed in.
    mockUser = null;
    (useAuthStore.getState as jest.Mock).mockReturnValue({
      user: null,
      fetchProfile: mockFetchProfile,
    });

    setCurrentState('background');
    renderHook(() => useProfileForegroundRefresh());

    // User signs in while the app is backgrounded.
    mockUser = { id: 'user-late' };
    (useAuthStore.getState as jest.Mock).mockReturnValue({
      user: { id: 'user-late' },
      fetchProfile: mockFetchProfile,
    });

    // Foreground — hook must see the current user, not the null captured at mount.
    simulateTransition('active');

    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('fires on inactive→active transition (e.g. iOS notification tray dismissed)', () => {
    // 'inactive' is an intermediate iOS state (phone call, notification tray).
    // It is NOT 'active', so previousState !== 'active' is true — the hook
    // intentionally fires here because the user may have been away long enough
    // for server-side changes (admin revocation) to have occurred.
    setCurrentState('inactive');

    renderHook(() => useProfileForegroundRefresh());
    simulateTransition('active');

    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });
});
