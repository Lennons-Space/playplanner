/**
 * authResurrection.test.tsx
 *
 * REPRODUCTION + REGRESSION for the 2026-08-21 SECOND real-device failure:
 * airplane mode on -> Sign out -> "signOut error: Network request failed" ->
 * connectivity restored -> the app became Liam again with no credentials
 * entered (Download My Data produced a real export, admin state returned,
 * authenticated review data reappeared). A second, ONLINE sign-out did not hold
 * either.
 *
 * WHY PURGING STORAGE WAS NOT ENOUGH — from the installed auth-js 2.103.0:
 *
 *   _callRefreshToken()                                (GoTrueClient.js:3869)
 *     ├─ _refreshAccessToken() retries with exponential backoff for as long as
 *     │  the error is a retryable FETCH error and the next backoff still fits
 *     │  inside AUTO_REFRESH_TICK_DURATION_MS       (:3718-3741)
 *     ├─ await this._saveSession(data.session)   ← UNCONDITIONAL WRITE (:3943)
 *     └─ _notifyAllSubscribers('TOKEN_REFRESHED', data.session)
 *
 * A refresh that STARTED before the purge finishes AFTER it, writes the
 * terminated session back to disk, and emits an ordinary TOKEN_REFRESHED.
 * `stopAutoRefresh()` clears the interval but cannot cancel a refresh already
 * in flight, and no purge can outrun a write that happens later. This is why
 * the online sign-out failed too.
 *
 * HOW THIS SUITE STAYS HONEST
 * ---------------------------
 *   - Storage is the REAL chunked ExpoSecureStoreAdapter from lib/authSession.ts
 *     — the same object lib/supabase.ts passes to createClient() — over a
 *     mocked `expo-secure-store` (the native boundary).
 *   - The fake client's getSession() reads through that adapter, exactly as
 *     GoTrueClient.__loadSession() re-reads storage on every call.
 *   - signOut() reproduces _signOut()'s documented early return: on a failed
 *     server revoke it returns { error } and does NOT remove the session or
 *     emit an event.
 *   - simulateLateTokenRefresh() does what _callRefreshToken() does on success:
 *     write through the adapter, then emit TOKEN_REFRESHED. It models the SDK;
 *     it does not decide the outcome.
 *   - The real useAuthListener, the real authStore and the real tombstone are
 *     under test. Nothing about the adoption decision is stubbed.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://exampleproj.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

// ---------------------------------------------------------------------------
// Native boundary
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

// ---------------------------------------------------------------------------
// Fake client over the REAL adapter
// ---------------------------------------------------------------------------
const mockClientState = {
  /** true = the server-side revoke fails, as under airplane mode. */
  failServerRevoke: false,
  listeners: [] as ((event: string, session: unknown) => void)[],
  autoRefreshRunning: true,
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
        // Lazy on purpose. jest hoists this factory ABOVE the process.env
        // assignments at the top of the file, so evaluating the key here
        // eagerly would resolve it before the environment exists — which is
        // precisely the "derived key differs from the key in use" hazard this
        // suite asserts against. The real client resolves it once at
        // construction, after Expo has inlined the variable.
        get storageKey() {
          return getAuthStorageKey();
        },
        // Faithful to GoTrueClient._signOut().
        signOut: async () => {
          if (mockClientState.failServerRevoke) {
            return { error: { code: undefined, message: 'Network request failed' } };
          }
          // The success path is _removeSession(): remove, then emit SIGNED_OUT.
          const key = getAuthStorageKey();
          await ExpoSecureStoreAdapter.removeItem(key);
          await ExpoSecureStoreAdapter.removeItem(`${key}-code-verifier`);
          await ExpoSecureStoreAdapter.removeItem(`${key}-user`);
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

// The __DEV__ diagnostics schedule 35s/60s verification timers, which have no
// place in a unit test's event loop. Their own behaviour is covered by
// lib/__tests__/authDiagnostics.test.ts.
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

function sessionFor(userId: string) {
  const jwtish = (seed: string) =>
    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${seed.repeat(400)}.${seed.repeat(20)}`;
  return {
    access_token: jwtish('Ab0'),
    refresh_token: jwtish('Zy9'),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, aud: 'authenticated', role: 'authenticated' },
  };
}

/** Persist a session through the real adapter and put it in the store. */
async function signedInAs(userId: string) {
  await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(sessionFor(userId)));
  useAuthStore.setState({
    user: { id: userId } as never,
    session: sessionFor(userId) as never,
    profile: null,
    isLoading: false,
  });
}

/**
 * What auth-js does when a refresh that began BEFORE the sign-out finally
 * succeeds: _saveSession() writes the session back, then TOKEN_REFRESHED is
 * emitted. Models the SDK; makes no judgement about whether it should be
 * adopted — that is what is under test.
 */
async function simulateLateTokenRefresh(userId: string) {
  const session = sessionFor(userId);
  await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(session));
  await act(async () => {
    await (require('@/lib/supabase') as {
      __notify: (e: string, s: unknown) => Promise<void>;
    }).__notify('TOKEN_REFRESHED', session);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Harness({ queryClient }: { queryClient: QueryClient }) {
  useAuthListener(queryClient);
  return null;
}

function mountListener() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  const utils = render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Harness, { queryClient: client }),
    ),
  );
  return { client, utils };
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

async function storedSession() {
  const raw = await ExpoSecureStoreAdapter.getItem(getAuthStorageKey());
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  mockStore.clear();
  mockClientState.failServerRevoke = false;
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
describe('the storage key that is purged is the key the client uses', () => {
  it('matches the live client’s storageKey exactly', () => {
    expect((supabase.auth as unknown as { storageKey: string }).storageKey).toBe(getAuthStorageKey());
  });
});

// ===========================================================================
describe('OFFLINE sign-out (the airplane-mode case)', () => {
  it('CONTROL: the server revoke fails and the SDK leaves the session on disk', async () => {
    await signedInAs(USER_A);
    mockClientState.failServerRevoke = true;

    // The SDK's own behaviour, before our code intervenes.
    const { error } = await supabase.auth.signOut();
    expect(error).toBeTruthy();
    expect(await storedSession()).not.toBeNull();
  });

  it('leaves storage and session null after our sign-out', async () => {
    mountListener();
    await signedInAs(USER_A);
    mockClientState.failServerRevoke = true;

    await tapSignOut();

    expect(await storedSession()).toBeNull();
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does NOT resurrect when a late token refresh writes the session back', async () => {
    mountListener();
    await signedInAs(USER_A);
    mockClientState.failServerRevoke = true;

    await tapSignOut();
    // Connectivity returns; the refresh that was retrying finally succeeds.
    await simulateLateTokenRefresh(USER_A);

    // THE INVARIANT. Before the tombstone this left the store holding USER_A
    // and the session back on disk.
    expect(useAuthStore.getState().user).toBeNull();
    await waitFor(async () => expect(await storedSession()).toBeNull());
    expect((await supabase.auth.getSession()).data.session).toBeNull();
  });

  it('stops the auto-refresh ticker', async () => {
    mountListener();
    await signedInAs(USER_A);
    mockClientState.failServerRevoke = true;

    await tapSignOut();

    expect(mockClientState.autoRefreshRunning).toBe(false);
  });
});

// ===========================================================================
describe('ONLINE sign-out', () => {
  it('leaves storage and session null', async () => {
    mountListener();
    await signedInAs(USER_A);

    await tapSignOut();

    expect(await storedSession()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does NOT resurrect when a late token refresh lands after a CLEAN sign-out', async () => {
    mountListener();
    await signedInAs(USER_A);

    await tapSignOut();
    await simulateLateTokenRefresh(USER_A);

    // This is the second sign-out from the video: it was online, it "worked",
    // and Liam still came back.
    expect(useAuthStore.getState().user).toBeNull();
    await waitFor(async () => expect(await storedSession()).toBeNull());
  });

  it('repeated resurrection attempts keep failing', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    for (let i = 0; i < 3; i++) {
      await simulateLateTokenRefresh(USER_A);
      expect(useAuthStore.getState().user).toBeNull();
    }
    await waitFor(async () => expect(await storedSession()).toBeNull());
  });
});

// ===========================================================================
describe('an explicit sign-in still works', () => {
  it('adopts a session after a real login records intent and success', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();
    expect(useAuthStore.getState().user).toBeNull();

    // app/(auth)/login.tsx records INTENT before signInWithPassword and the
    // OUTCOME after it. Protection is never lifted in advance — see
    // hooks/__tests__/authSignInRace.test.tsx for the race this prevents.
    beginExplicitSignIn();
    const session = sessionFor(USER_A);
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(session));
    await act(async () => {
      await (require('@/lib/supabase') as {
        __notify: (e: string, s: unknown) => Promise<void>;
      }).__notify('SIGNED_IN', session);
    });

    completeExplicitSignIn(true);

    expect(useAuthStore.getState().user?.id).toBe(USER_A);
  });

  it('a DIFFERENT account signing in is never blocked by the tombstone', async () => {
    mountListener();
    await signedInAs(USER_A);
    await tapSignOut();

    const session = sessionFor(USER_B);
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), JSON.stringify(session));
    await act(async () => {
      await (require('@/lib/supabase') as {
        __notify: (e: string, s: unknown) => Promise<void>;
      }).__notify('SIGNED_IN', session);
    });

    expect(useAuthStore.getState().user?.id).toBe(USER_B);
  });
});
