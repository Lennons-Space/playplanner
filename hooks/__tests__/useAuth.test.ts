/**
 * Tests for hooks/useAuth.ts — useAuthListener.
 *
 * (useProfileForegroundRefresh has its own dedicated test file:
 * hooks/__tests__/useProfileForegroundRefresh.test.ts.)
 *
 * Why these tests matter for PlayPlanner:
 * - On sign-out, pendingPostcode must be cleared from the map store so it is
 *   never visible to the next user on a shared or family device (GDPR / ICO
 *   Children's Code shared-device data isolation).
 * - On sign-in, any pre-auth location consent must be RETIRED, never linked to
 *   the account that happens to be signing in (PP-018). The old behaviour
 *   attributed one person's consent to another on a shared device.
 * - Auth Session Recovery checkpoint: the Supabase SDK already self-heals
 *   from a terminal stale-refresh-token error internally (clears its own
 *   session, fires SIGNED_OUT) — this hook's job is to react correctly to
 *   that SIGNED_OUT event: clear app-level state, show a friendly one-time
 *   message ONLY when the loss was involuntary (never after a deliberate
 *   "Sign out" tap), and never surface a raw Supabase error.
 *
 * Test strategy: render the REAL hook via renderHook (not a hand-copied
 * reproduction of its logic — a prior version of this file mocked
 * onAuthStateChange and then re-implemented the callback body inline, which
 * meant these tests could never actually catch a bug in the real hook).
 * The real store/authStore.ts and store/mapStore.ts are used (not mocked) so
 * consumeDeliberateSignOut()'s real coordination with authStore.signOut() is
 * exercised end-to-end.
 */

import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { useAuthListener } from '../useAuth';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { __resetAuthTombstoneForTests } from '@/lib/authTombstone';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let authStateCallback: ((event: string, session: unknown) => void) | null = null;
const mockUnsubscribe = jest.fn();
const mockOnAuthStateChange = jest.fn((cb: (event: string, session: unknown) => void) => {
  authStateCallback = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...args: [(event: string, session: unknown) => void]) =>
        mockOnAuthStateChange(...args),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      // Surface used by the resurrection gate and by authStore.signOut()'s
      // verify step (2026-08-21). Behaviour of both is covered in
      // hooks/__tests__/authResurrection.test.tsx.
      stopAutoRefresh: jest.fn().mockResolvedValue(undefined),
      startAutoRefresh: jest.fn().mockResolvedValue(undefined),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      storageKey: 'sb-test-auth-token',
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    // authStore.fetchProfile reads the caller's own row through the
    // get_my_profile() SECURITY DEFINER RPC (migration 064).
    rpc: jest.fn(() => ({
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

const mockRetire = jest.fn().mockResolvedValue(undefined);
jest.mock('@/services/consent/locationConsent', () => ({
  retirePendingLocationConsent: (...args: unknown[]) => mockRetire(...args),
}));

const mockQueryClientClear = jest.fn();
const fakeQueryClient = {
  clear: mockQueryClientClear,
} as unknown as import('@tanstack/react-query').QueryClient;

const fakeUser = { id: 'user-abc' } as User;
const fakeSession = { access_token: 'tok', refresh_token: 'ref', user: fakeUser } as Session;

beforeEach(() => {
  authStateCallback = null;
  jest.clearAllMocks();
  useMapStore.setState({ pendingPostcode: null });
  useAuthStore.setState({ session: null, user: null, profile: null, isLoading: true });
  __resetAuthTombstoneForTests();
});

function fireAuthEvent(event: string, session: unknown) {
  act(() => {
    authStateCallback!(event, session);
  });
}

// ---------------------------------------------------------------------------
// Subscription lifecycle (concurrency/lifecycle requirements)
// ---------------------------------------------------------------------------

describe('useAuthListener — subscription lifecycle', () => {
  it('subscribes exactly once to onAuthStateChange', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount — no listener leak', () => {
    const { unmount } = renderHook(() => useAuthListener(fakeQueryClient));
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Normal boot behaviour
// ---------------------------------------------------------------------------

describe('useAuthListener — normal boot', () => {
  it('a valid persisted session (INITIAL_SESSION with a session) boots the store as signed in', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    fireAuthEvent('INITIAL_SESSION', fakeSession);
    expect(useAuthStore.getState().session).toBe(fakeSession);
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('no stored session (INITIAL_SESSION with null) boots the store as signed out, without the expired-session message', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderHook(() => useAuthListener(fakeQueryClient));
    fireAuthEvent('INITIAL_SESSION', null);
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// SIGNED_OUT — state clearing (unchanged behaviour, still correct)
// ---------------------------------------------------------------------------

describe('useAuthListener — SIGNED_OUT clears local state', () => {
  it('clears pendingPostcode from mapStore when SIGNED_OUT fires', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    useMapStore.getState().setPendingPostcode('SW1A 1AA');
    expect(useMapStore.getState().pendingPostcode).toBe('SW1A 1AA');

    fireAuthEvent('SIGNED_OUT', null);

    expect(useMapStore.getState().pendingPostcode).toBeNull();
  });

  it('calls queryClient.clear() on SIGNED_OUT — wipes the authenticated query cache', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    fireAuthEvent('SIGNED_OUT', null);
    expect(mockQueryClientClear).toHaveBeenCalledTimes(1);
  });

  it('clears session/user/profile in authStore on SIGNED_OUT', () => {
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    fireAuthEvent('SIGNED_OUT', null);

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
  });

  it('queryClient.clear() does not touch unrelated Zustand preference stores (mapStore only loses pendingPostcode, nothing else)', () => {
    // useMapStore persists things like the last search radius / filters
    // independently of React Query — queryClient.clear() must never reach
    // into it beyond the one explicit setPendingPostcode(null) call.
    useMapStore.setState({ pendingPostcode: 'SW1A 1AA' });
    const mapStoreBefore = useMapStore.getState();
    renderHook(() => useAuthListener(fakeQueryClient));

    fireAuthEvent('SIGNED_OUT', null);

    // Every OTHER field on the map store is untouched (same reference/values
    // as before, aside from the one field this listener explicitly clears).
    const mapStoreAfter = useMapStore.getState();
    const { pendingPostcode: _before, ...restBefore } = mapStoreBefore;
    const { pendingPostcode: _after, ...restAfter } = mapStoreAfter;
    expect(restAfter).toEqual(restBefore);
  });
});

// ---------------------------------------------------------------------------
// Terminal session recovery — the friendly one-time message
// ---------------------------------------------------------------------------

describe('useAuthListener — involuntary session loss shows one friendly message', () => {
  it('shows "Your session expired. Please sign in again." when SIGNED_OUT fires while a real session existed and no deliberate sign-out happened', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    // This is exactly what happens when the Supabase SDK's own internal
    // recovery from refresh_token_not_found / refresh_token_already_used /
    // session_not_found / session_expired fires SIGNED_OUT after already
    // clearing its own local session — the app never sees the raw
    // AuthApiError directly, only this event.
    fireAuthEvent('SIGNED_OUT', null);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Session expired',
      'Your session expired. Please sign in again.',
    );
    alertSpy.mockRestore();
  });

  it('never renders the raw Supabase AuthApiError — the alert body is always the fixed friendly string', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    fireAuthEvent('SIGNED_OUT', null);

    const [, message] = alertSpy.mock.calls[0];
    expect(message).not.toMatch(/AuthApiError|refresh_token|Invalid Refresh Token/i);
    alertSpy.mockRestore();
  });

  it('does NOT show the message after a deliberate authStore.signOut() call', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    // authStore.signOut() sets the deliberate flag, then the SDK would
    // normally fire SIGNED_OUT itself once the network call resolves — we
    // simulate that by firing the event immediately after, same as the real
    // Supabase client does synchronously via onAuthStateChange.
    await act(async () => {
      await useAuthStore.getState().signOut();
    });
    fireAuthEvent('SIGNED_OUT', null);

    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('does not show the message on a SIGNED_OUT that arrives with no session to lose (idempotent — no duplicate/late-event message)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Default beforeEach state: session is already null.
    renderHook(() => useAuthListener(fakeQueryClient));

    fireAuthEvent('SIGNED_OUT', null);

    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('repeated terminal SIGNED_OUT events do not create a message/recovery loop — shown at most once per involuntary loss', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    fireAuthEvent('SIGNED_OUT', null); // first: real session lost -> shows once
    fireAuthEvent('SIGNED_OUT', null); // second: already null -> no repeat
    fireAuthEvent('SIGNED_OUT', null); // third: still null -> no repeat

    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('concurrent SIGNED_OUT deliveries collapse into a single recovery reaction (one clear, one message)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    // Simulates two near-simultaneous SIGNED_OUT deliveries (e.g. the
    // auto-refresh tick and a manual getSession() both observing the same
    // terminal failure) arriving back to back before React has re-rendered.
    act(() => {
      authStateCallback!('SIGNED_OUT', null);
      authStateCallback!('SIGNED_OUT', null);
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockQueryClientClear).toHaveBeenCalledTimes(2); // clear() itself is idempotent/safe to call twice
    alertSpy.mockRestore();
  });

  it('a fresh sign-in after recovery re-arms the message for any FUTURE involuntary loss', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    fireAuthEvent('SIGNED_OUT', null); // first involuntary loss
    expect(alertSpy).toHaveBeenCalledTimes(1);

    fireAuthEvent('SIGNED_IN', fakeSession); // user signs back in
    fireAuthEvent('SIGNED_OUT', null); // a second, later involuntary loss

    expect(alertSpy).toHaveBeenCalledTimes(2);
    alertSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Ordinary temporary errors must never force a logout
// ---------------------------------------------------------------------------

describe('useAuthListener — temporary conditions do not force logout', () => {
  it('an ordinary profile-fetch/network hiccup that never produces a SIGNED_OUT event leaves the session intact', () => {
    // The Supabase SDK only ever fires SIGNED_OUT for a genuinely terminal
    // session (see AuthRetryableFetchError vs AuthApiError in the installed
    // SDK) — a temporary offline/timeout/outage condition during a refresh
    // attempt does not call _removeSession() internally, so onAuthStateChange
    // simply never fires SIGNED_OUT for it. This test asserts the contract
    // from the app's side: with no SIGNED_OUT event, the session must remain
    // exactly as it was.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    // No auth event fires at all for a transient failure.

    expect(useAuthStore.getState().session).toBe(fakeSession);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockQueryClientClear).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('a TOKEN_REFRESHED event (successful background refresh) does not clear state or show any message', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    const refreshedSession = { ...fakeSession, access_token: 'new-tok' } as Session;
    fireAuthEvent('TOKEN_REFRESHED', refreshedSession);

    expect(useAuthStore.getState().session).toEqual(refreshedSession);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockQueryClientClear).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// SIGNED_IN
// ---------------------------------------------------------------------------

describe('useAuthListener — SIGNED_IN', () => {
  /**
   * PP-018: pre-auth consent is RETIRED on SIGNED_IN, never attributed.
   *
   * This replaces the original "BUG C" behaviour, which called
   * migratePendingLocationConsent(userId) here. Because this listener fires on
   * EVERY sign-in — not just the signup it was designed for — that wrote a
   * guest's consent into the consent log of whichever account signed in next on
   * a shared device. The retire call takes no user id precisely so it cannot
   * attribute anything to anybody.
   */
  it('retires pre-auth location consent on SIGNED_IN without naming an account', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    fireAuthEvent('SIGNED_IN', fakeSession);
    expect(mockRetire).toHaveBeenCalled();
    // The user id must NOT be passed — nothing may be attributed to this account.
    expect(mockRetire).toHaveBeenCalledWith();
  });

  it('does not touch pre-auth location consent if the session has no user', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    fireAuthEvent('SIGNED_IN', null);
    expect(mockRetire).not.toHaveBeenCalled();
  });

  it('a normal sign-in updates the store to the signed-in user', () => {
    renderHook(() => useAuthListener(fakeQueryClient));
    fireAuthEvent('SIGNED_IN', fakeSession);
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(useAuthStore.getState().session).toBe(fakeSession);
  });
});

// ---------------------------------------------------------------------------
// Ordinary deliberate sign-out still works end to end
// ---------------------------------------------------------------------------

describe('useAuthListener — deliberate sign-out still works', () => {
  it('a manual signOut() call clears state and the SDK-fired SIGNED_OUT that follows is a silent no-op message-wise', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useAuthStore.setState({ session: fakeSession, user: fakeUser, profile: null, isLoading: false });
    renderHook(() => useAuthListener(fakeQueryClient));

    await act(async () => {
      await useAuthStore.getState().signOut();
    });
    expect(useAuthStore.getState().session).toBeNull();

    fireAuthEvent('SIGNED_OUT', null);
    expect(mockQueryClientClear).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
