/**
 * authSignInRace.test.tsx
 *
 * ADVERSARIAL proof of the tombstone / sign-in race.
 *
 * THE QUESTION
 * ------------
 * Account A signs out (tombstone armed for A). A stale, pre-sign-out token
 * refresh is still retrying. The user then starts an explicit sign-in. Can A be
 * re-adopted in the window between "sign-in started" and "sign-in finished"?
 *
 * THE SDK DOES NOT SAVE US — verified in @supabase/auth-js@2.103.0, not assumed:
 *
 *   1. Lock selection (GoTrueClient.js:129-143):
 *        this.lock = settings.lock || lockNoOp
 *        if (settings.lock)                       -> settings.lock
 *        else if (persistSession && isBrowser() && navigator.locks)
 *                                                 -> navigatorLock
 *        else                                     -> lockNoOp
 *      lib/supabase.ts passes no `lock`. `isBrowser()` is
 *        typeof window !== 'undefined' && typeof document !== 'undefined'
 *      (helpers.js:43) — React Native has no `document`, and no Web Locks API.
 *      So the lock is lockNoOp:
 *        async function lockNoOp(name, acquireTimeout, fn) { return await fn() }
 *      (:31-33) — NO mutual exclusion at all.
 *
 *   2. signInWithPassword() (:790) does not call _acquireLock AT ALL. It goes
 *      straight to the network, then _saveSession() + _notifyAllSubscribers(
 *      'SIGNED_IN', …) (:828-830).
 *
 * Therefore a concurrent refresh and sign-in are NOT serialised, and any window
 * in which protection is lifted is genuinely exploitable. The first design
 * lifted it by calling clearAuthTombstone() BEFORE awaiting signInWithPassword,
 * so the window was the entire network round-trip.
 *
 * THE FIX UNDER TEST: protection is never lifted in advance of an outcome.
 * beginExplicitSignIn() records intent; only the SIGNED_IN emitted during that
 * attempt may establish an identity; completeExplicitSignIn(false) leaves the
 * tombstone armed. A second rule refuses any session whose identity differs
 * from the one the app has already adopted, which covers scenario (D).
 *
 * Storage here is the REAL chunked adapter over a mocked expo-secure-store, and
 * the gate, listener and store are the real implementations.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://exampleproj.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

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

const mockClientState = {
  listeners: [] as ((event: string, session: unknown) => void)[],
  autoRefreshRunning: true,
  /** Resolver for the in-flight signInWithPassword, so the test controls timing. */
  pendingSignIn: null as null | ((result: { ok: boolean; userId?: string }) => void),
};

jest.mock('@/lib/supabase', () => {
  const { ExpoSecureStoreAdapter, getAuthStorageKey } = require('@/lib/authSession');

  const readSession = async () => {
    const raw = await ExpoSecureStoreAdapter.getItem(getAuthStorageKey());
    return raw ? JSON.parse(raw) : null;
  };

  const notify = async (event: string, session: unknown) => {
    for (const cb of mockClientState.listeners) await cb(event, session);
  };

  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  });

  return {
    supabase: {
      from: () => builder,
      rpc: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
      auth: {
        get storageKey() {
          return getAuthStorageKey();
        },
        signOut: async () => {
          const key = getAuthStorageKey();
          await ExpoSecureStoreAdapter.removeItem(key);
          await notify('SIGNED_OUT', null);
          return { error: null };
        },
        getSession: async () => ({ data: { session: await readSession() }, error: null }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          mockClientState.listeners.push(cb);
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  mockClientState.listeners = mockClientState.listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
        startAutoRefresh: async () => { mockClientState.autoRefreshRunning = true; },
        stopAutoRefresh: async () => { mockClientState.autoRefreshRunning = false; },
      },
    },
    __notify: notify,
  };
});

jest.mock('@/services/consent/locationConsent', () => ({
  retirePendingLocationConsent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/authDiagnostics', () => ({
  logAuthState: jest.fn().mockResolvedValue(undefined),
  logAuthEvent: jest.fn(),
  scheduleSignOutVerification: jest.fn(),
  assertStorageKeyMatchesClient: jest.fn(() => true),
  fingerprint: jest.fn(() => 'aaaaaa'),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});

import { ExpoSecureStoreAdapter, getAuthStorageKey } from '@/lib/authSession';
import { useAuthStore } from '@/store/authStore';
import { useAuthListener } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  beginExplicitSignIn,
  completeExplicitSignIn,
  __resetAuthTombstoneForTests,
} from '@/lib/authTombstone';

const USER_A = 'a1b2c3d4-0000-4000-8000-00000000000a';
const USER_B = 'b1b2c3d4-0000-4000-8000-00000000000b';

function sessionFor(userId: string, marker = 'v1') {
  const jwtish = (seed: string) =>
    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${seed.repeat(400)}.${marker}`;
  return {
    access_token: jwtish('Ab0'),
    refresh_token: jwtish('Zy9'),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, aud: 'authenticated', role: 'authenticated' },
  };
}

async function notify(event: string, session: unknown) {
  await act(async () => {
    await (require('@/lib/supabase') as {
      __notify: (e: string, s: unknown) => Promise<void>;
    }).__notify(event, session);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The stale, pre-sign-out refresh finally succeeding: auth-js writes the
 * session through the adapter (_saveSession) and emits TOKEN_REFRESHED. This
 * models the SDK; it makes no judgement about adoption.
 */
async function staleRefreshArrives(userId: string) {
  const session = sessionFor(userId, 'stale');
  await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(session));
  await notify('TOKEN_REFRESHED', session);
}

/** What signInWithPassword does on success: save, then emit SIGNED_IN. */
async function signInSucceeds(userId: string) {
  const session = sessionFor(userId, 'fresh');
  await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(session));
  await notify('SIGNED_IN', session);
}

async function signedInAs(userId: string) {
  await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(sessionFor(userId)));
  useAuthStore.setState({
    user: { id: userId } as never,
    session: sessionFor(userId) as never,
    profile: null,
    isLoading: false,
  });
}

async function storedSession() {
  const raw = await ExpoSecureStoreAdapter.getItem(getAuthStorageKey());
  return raw ? JSON.parse(raw) : null;
}

function Harness({ queryClient }: { queryClient: QueryClient }) {
  useAuthListener(queryClient);
  return null;
}

function mountListener() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Harness, { queryClient: client }),
    ),
  );
  return client;
}

async function tapSignOut() {
  await act(async () => {
    try {
      await useAuthStore.getState().signOut();
    } catch {
      /* confirmSignOut swallows */
    }
  });
}

beforeEach(() => {
  mockStore.clear();
  mockClientState.listeners = [];
  mockClientState.autoRefreshRunning = true;
  __resetAuthTombstoneForTests();
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
  const secureStore = jest.requireMock('expo-secure-store') as {
    getItemAsync: jest.Mock; setItemAsync: jest.Mock; deleteItemAsync: jest.Mock;
  };
  secureStore.getItemAsync.mockImplementation(async (k: string) => mockStore.get(k) ?? null);
  secureStore.setItemAsync.mockImplementation(async (k: string, v: string) => { mockStore.set(k, v); });
  secureStore.deleteItemAsync.mockImplementation(async (k: string) => { mockStore.delete(k); });
});

afterEach(() => {
  __resetAuthTombstoneForTests();
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
});

// ===========================================================================
// The SDK's concurrency behaviour, encoded so a future upgrade that changes it
// is caught here rather than on a device.
// ===========================================================================
describe('auth-js concurrency assumptions (installed 2.103.0)', () => {
  it('React Native gets no auth lock, so nothing is serialised', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { version } = require('@supabase/auth-js/package.json');
    expect(version).toBe('2.103.0');

    // isBrowser() requires BOTH window and document. React Native (and this
    // jest-expo environment) has no `document`, so navigatorLock is never
    // selected and GoTrueClient falls through to lockNoOp.
    expect(typeof document === 'undefined' || !('locks' in (globalThis.navigator ?? {}))).toBe(true);
  });
});

// ===========================================================================
// (A) A logout -> B sign-in starts -> stale A refresh arrives before B succeeds
// ===========================================================================
describe('(A) stale A refresh during an in-flight sign-in as B', () => {
  it('never makes A current, and B still signs in normally', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();
    expect(useAuthStore.getState().user).toBeNull();

    // The user taps "Sign in" as Account B. login.tsx records intent, then
    // awaits the network — this is the whole exploitable window.
    beginExplicitSignIn();

    // Mid-flight, A's pre-sign-out refresh finally succeeds.
    await staleRefreshArrives(USER_A);

    // THE ASSERTION. Before the fix the tombstone had already been cleared and
    // A was adopted here.
    expect(useAuthStore.getState().user).toBeNull();

    // B's sign-in then completes normally.
    await signInSucceeds(USER_B);
    completeExplicitSignIn(true);

    expect(useAuthStore.getState().user?.id).toBe(USER_B);
  });

  it('purges the session A wrote, so no A token is left on disk', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    beginExplicitSignIn();
    await staleRefreshArrives(USER_A);

    await waitFor(async () => expect(await storedSession()).toBeNull());
  });
});

// ===========================================================================
// (B) Same, but B's sign-in FAILS
// ===========================================================================
describe('(B) stale A refresh while a sign-in that will FAIL is in flight', () => {
  it('leaves the app signed out — A never resurrects behind a failed login', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    beginExplicitSignIn();
    await staleRefreshArrives(USER_A);
    // signInWithPassword resolves with an error; no SIGNED_IN is ever emitted.
    completeExplicitSignIn(false);

    expect(useAuthStore.getState().user).toBeNull();
    expect(await storedSession()).toBeNull();
  });

  it('a stale A refresh arriving AFTER the failed sign-in is still refused', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    beginExplicitSignIn();
    completeExplicitSignIn(false);

    // The tombstone must survive a failed attempt.
    await staleRefreshArrives(USER_A);

    expect(useAuthStore.getState().user).toBeNull();
    await waitFor(async () => expect(await storedSession()).toBeNull());
  });
});

// ===========================================================================
// (C) A logout -> explicit A sign-in starts -> stale OLD A refresh arrives
// ===========================================================================
describe('(C) re-login as the SAME account with a stale refresh in flight', () => {
  it('the stale session cannot count as the new explicit login', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    beginExplicitSignIn();
    // The OLD A session lands first. It is a TOKEN_REFRESHED, not the SIGNED_IN
    // that the user's login will emit, so it must not be adopted even though
    // an explicit sign-in for this very account is in progress.
    await staleRefreshArrives(USER_A);

    expect(useAuthStore.getState().user).toBeNull();
  });

  it('the genuine A login that follows IS adopted', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    beginExplicitSignIn();
    await staleRefreshArrives(USER_A);
    await signInSucceeds(USER_A);
    completeExplicitSignIn(true);

    expect(useAuthStore.getState().user?.id).toBe(USER_A);
    // And the session on disk is the fresh one, not the stale one.
    const stored = await storedSession();
    expect(stored?.access_token).toContain('fresh');
  });
});

// ===========================================================================
// (D) B signs in successfully -> stale A refresh arrives AFTERWARDS
// ===========================================================================
describe('(D) stale A refresh landing after B is already signed in', () => {
  it('A cannot overwrite B', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    beginExplicitSignIn();
    await signInSucceeds(USER_B);
    completeExplicitSignIn(true);
    expect(useAuthStore.getState().user?.id).toBe(USER_B);

    // Now A's stale refresh finally lands. _saveSession() has overwritten B's
    // session on disk with A's before this event was emitted.
    await staleRefreshArrives(USER_A);

    // The app must NEVER be A here. It fails closed instead: B is signed out
    // rather than silently replaced, because A's write destroyed B's session.
    expect(useAuthStore.getState().user?.id).not.toBe(USER_A);
    expect(useAuthStore.getState().user).toBeNull();
    await waitFor(async () => expect(await storedSession()).toBeNull());
  });

  it('an ordinary refresh for the CURRENT user is still accepted', async () => {
    mountListener();
    await signedInAs(USER_A);

    // Adopt A through the listener so it becomes the authoritative identity.
    await notify('TOKEN_REFRESHED', sessionFor(USER_A, 'first'));
    expect(useAuthStore.getState().user?.id).toBe(USER_A);

    // A perfectly normal background refresh must not be mistaken for an attack.
    const refreshed = sessionFor(USER_A, 'second');
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(refreshed));
    await notify('TOKEN_REFRESHED', refreshed);

    expect(useAuthStore.getState().user?.id).toBe(USER_A);
    expect((await storedSession())?.access_token).toContain('second');
  });
});

// ===========================================================================
// Startup must not be blocked by any of this.
// ===========================================================================
describe('cold start', () => {
  it('adopts the persisted session normally when nothing was signed out', async () => {
    mountListener();
    const session = sessionFor(USER_A, 'restored');
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(session));

    await notify('INITIAL_SESSION', session);

    expect(useAuthStore.getState().user?.id).toBe(USER_A);
  });
});
