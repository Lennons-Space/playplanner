/**
 * signOutSessionTermination.test.tsx
 *
 * REPRODUCTION + REGRESSION for the 2026-08-21 real-device failure:
 * after signing out, "Beautiful little park." was still rendered on the venue
 * screen to a user who believed they were logged out.
 *
 * WHY THE IDENTITY-SCOPED QUERY KEYS DID NOT COVER IT
 * ---------------------------------------------------
 * They scope the cache by WHO the store says is signed in. In this failure the
 * store was right and the SIGN-OUT was wrong: the session was never actually
 * terminated, so the previous account came back and every query legitimately
 * re-fetched its rows. No cache-key scheme can defend against that.
 *
 * THE MECHANISM (read out of the installed auth-js 2.103.0, not assumed —
 * GoTrueClient._signOut()):
 *
 *     const { error } = await this.admin.signOut(accessToken, scope);
 *     if (error) {
 *       if (!((isAuthApiError(error) && (404|401|403)) || isAuthSessionMissingError(error))) {
 *         return this._returnResult({ error });   // <-- returns here
 *       }
 *     }
 *     if (scope !== 'others') { await this._removeSession(); }   // <-- skipped
 *
 * Any failure of the server-side revoke that is NOT 401/403/404 — a plain
 * network failure on mobile being the everyday case — leaves the session on
 * disk and emits no 'SIGNED_OUT'. The refresh ticker then keeps running and
 * re-adopts that session, pushing the previous user back into the store.
 *
 * HOW THIS SUITE STAYS HONEST
 * ---------------------------
 * The fake client is modelled on the SDK's real, verified semantics rather than
 * on the fix:
 *   - the session lives in the MOCKED expo-secure-store, under the key the app
 *     really uses (lib/authSession.ts is the REAL module here);
 *   - getSession() re-reads that storage every call, exactly as
 *     GoTrueClient.__loadSession() does;
 *   - the reviews query succeeds only when a session is present in storage,
 *     which is what SupabaseClient._getAccessToken() + RLS amount to;
 *   - simulateAutoRefreshTick() emits TOKEN_REFRESHED only if a session is
 *     still stored — it models the ticker, it does not decide the outcome.
 * Nothing in the fixture asserts the conclusion in advance.
 */
import React from 'react';
import { render, act, waitFor, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LEAK_FIXTURE_BODY = 'Beautiful little park.';

// The real module under the fake client — the purge must go through the same
// storage adapter and key the app really uses.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://exampleproj.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

// ---------------------------------------------------------------------------
// expo-secure-store — a real module boundary, backed by an in-memory map.
// ---------------------------------------------------------------------------
const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

// ---------------------------------------------------------------------------
// A fake Supabase client that reproduces the SDK behaviour quoted above.
// ---------------------------------------------------------------------------
const mockAuthState = {
  /** Set true to make the server-side revoke fail (offline / 5xx). */
  failServerRevoke: false,
  listeners: [] as ((event: string, session: unknown) => void)[],
  autoRefreshRunning: true,
  reviewRequests: 0,
};

jest.mock('@/lib/supabase', () => {
  // Required lazily so the mocked expo-secure-store is already in place.
  const { getAuthStorageKey } = require('@/lib/authSession');

  const readStoredSession = (): { user: { id: string } } | null => {
    const raw = mockSecureStore.get(getAuthStorageKey());
    return raw ? (JSON.parse(raw) as { user: { id: string } }) : null;
  };

  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      order: () => {
        if (table !== 'reviews') return Promise.resolve({ data: [], error: null });
        mockAuthState.reviewRequests += 1;
        // Mirrors _getAccessToken() + RLS: an authenticated caller reads the
        // approved review, `anon` is refused by 065/066/067.
        if (readStoredSession()) {
          return Promise.resolve({
            data: [
              {
                id: 'rev-a',
                venue_id: 'venue-grove',
                user_id: 'user-a',
                rating: 5,
                title: null,
                body: LEAK_FIXTURE_BODY,
                visit_date: null,
                is_anonymous: false,
                moderation_status: 'approved',
                helpful_count: 0,
                created_at: '2026-08-01T00:00:00Z',
                updated_at: '2026-08-01T00:00:00Z',
                profile: null,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({
          data: null,
          error: { code: '42501', message: 'permission denied for view public_profiles', hint: null },
        });
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      delete: () => builder,
    });
    return builder;
  };

  const notify = (event: string, session: unknown) => {
    mockAuthState.listeners.forEach((cb) => cb(event, session));
  };

  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      rpc: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
      auth: {
        // Faithful to GoTrueClient._signOut(): on a failed server revoke it
        // returns the error and does NOT remove the local session or emit.
        signOut: async () => {
          if (mockAuthState.failServerRevoke) {
            return { error: { code: undefined, message: 'Network request failed' } };
          }
          mockSecureStore.delete(getAuthStorageKey());
          notify('SIGNED_OUT', null);
          return { error: null };
        },
        // Faithful to __loadSession(): re-read from storage on every call.
        getSession: async () => ({ data: { session: readStoredSession() }, error: null }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          mockAuthState.listeners.push(cb);
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  mockAuthState.listeners = mockAuthState.listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
        startAutoRefresh: () => {
          mockAuthState.autoRefreshRunning = true;
        },
        stopAutoRefresh: () => {
          mockAuthState.autoRefreshRunning = false;
        },
      },
    },
    ExpoSecureStoreAdapter: require('@/lib/authSession').ExpoSecureStoreAdapter,
    __notify: notify,
    __readStoredSession: readStoredSession,
  };
});

// ---------------------------------------------------------------------------
// Screen-level mocks (identical in spirit to venueDetailBackground.test.tsx)
// ---------------------------------------------------------------------------
jest.mock('expo-linear-gradient', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'venue-grove' }),
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

const mockVenue = {
  id: 'venue-grove',
  name: 'The Grove Play Area',
  slug: 'the-grove-play-area',
  description: 'A lovely little park.',
  address_line1: '1 Grove Lane',
  city: 'London',
  postcode: 'SW1A 1AA',
  country: 'GB',
  category_id: 'c1',
  latitude: 51.5,
  longitude: -0.1,
  price_range: null,
  min_age: 0,
  max_age: 12,
  is_published: true,
  is_verified: true,
  is_premium: false,
  claimed_by: null,
  submitted_by: null,
  moderation_status: 'approved',
  review_count: 1,
  average_rating: 5,
  photos: [],
  facilities: [],
  opening_hours: [],
  distance_km: 1.2,
  category: { id: 'c1', name: 'Park', slug: 'park', icon: 'tree', color: '#000' },
  image_url: null,
};

jest.mock('@/hooks/useVenues', () => ({
  useVenue: () => ({ data: mockVenue, isLoading: false, error: null }),
}));
jest.mock('@/hooks/useVenueReport', () => ({
  useReportVenue: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));
jest.mock('@/lib/recentlyViewed', () => {
  const actual = jest.requireActual('@/lib/recentlyViewed');
  return { ...actual, addRecentlyViewed: jest.fn() };
});
jest.mock('@/components/venue/VenuePhotoUpload', () => ({ VenuePhotoUpload: () => null }));
jest.mock('@/components/venue/VenueContactRow', () => ({ VenueContactRow: () => null }));
jest.mock('@/components/venue/FacilityChips', () => ({ FacilityChips: () => null }));
jest.mock('@/components/venues/RecommendationExplanation', () => ({
  RecommendationExplanation: () => null,
}));
jest.mock('@/hooks/useWeather', () => ({ useWeather: () => null }));
jest.mock('@/hooks/location', () => ({ useLocation: jest.fn() }));
jest.mock('@/services/consent/locationConsent', () => ({
  retirePendingLocationConsent: jest.fn().mockResolvedValue(undefined),
}));


// The __DEV__ diagnostics schedule 35s/60s verification timers; keep them out
// of this suite's event loop. Covered by lib/__tests__/authDiagnostics.test.ts.
jest.mock('@/lib/authDiagnostics', () => ({
  logAuthState: jest.fn().mockResolvedValue(undefined),
  logAuthEvent: jest.fn(),
  scheduleSignOutVerification: jest.fn(),
  assertStorageKeyMatchesClient: jest.fn(() => true),
  fingerprint: jest.fn(() => 'aaaaaa'),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});

import VenueDetailScreen from '../../app/venue/[id]';
import { useAuthStore } from '@/store/authStore';
import { useAuthListener } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { getAuthStorageKey } from '@/lib/authSession';

// ---------------------------------------------------------------------------
// Harness: the auth listener and the venue screen in one tree, as in the app.
// ---------------------------------------------------------------------------
function Harness({ queryClient }: { queryClient: QueryClient }) {
  useAuthListener(queryClient);
  return <VenueDetailScreen />;
}

function makeAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 1000 * 60, gcTime: 1000 * 60 * 5 },
      mutations: { retry: 0 },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** Sign in Account A: session persisted to storage, store updated. */
function signInA() {
  mockSecureStore.set(getAuthStorageKey(), JSON.stringify({ user: { id: 'user-a' } }));
  useAuthStore.setState({
    user: { id: 'user-a' } as never,
    session: { user: { id: 'user-a' } } as never,
    profile: null,
    isLoading: false,
  });
}

/** The real sign-out path from app/(tabs)/profile.tsx's confirmSignOut. */
async function tapSignOut(client: QueryClient) {
  await act(async () => {
    try {
      await useAuthStore.getState().signOut();
    } catch {
      /* confirmSignOut swallows it */
    }
    client.clear();
  });
}

/**
 * What the SDK's auto-refresh ticker does when the app is used again: if a
 * session is still persisted, it refreshes and emits TOKEN_REFRESHED. Models
 * the ticker — it does not decide whether a session should be there.
 */
async function simulateAutoRefreshTick() {
  await act(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session && mockAuthState.autoRefreshRunning) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/lib/supabase') as { __notify: (e: string, s: unknown) => void }).__notify(
        'TOKEN_REFRESHED',
        data.session,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockSecureStore.clear();
  mockAuthState.failServerRevoke = false;
  mockAuthState.listeners = [];
  mockAuthState.autoRefreshRunning = true;
  mockAuthState.reviewRequests = 0;
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
});

afterEach(() => {
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
});

// ===========================================================================
describe('sign-out must actually terminate the local session', () => {
  it('CONTROL: a clean sign-out removes the persisted session', async () => {
    signInA();
    await act(async () => {
      await useAuthStore.getState().signOut();
    });

    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('removes the persisted session even when the server-side revoke FAILS', async () => {
    signInA();
    mockAuthState.failServerRevoke = true;

    await act(async () => {
      await useAuthStore.getState().signOut();
    });

    // This is the root-cause assertion. Before the fix the store was cleared
    // but the session survived on disk, leaving the device authenticated.
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
    expect(mockSecureStore.get(getAuthStorageKey())).toBeUndefined();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('stops the auto-refresh ticker when it has to purge the session itself', async () => {
    signInA();
    mockAuthState.failServerRevoke = true;

    await act(async () => {
      await useAuthStore.getState().signOut();
    });

    expect(mockAuthState.autoRefreshRunning).toBe(false);
  });

  it('clears local state even if supabase.auth.signOut() throws', async () => {
    signInA();
    const throwing = jest
      .spyOn(supabase.auth, 'signOut')
      .mockRejectedValueOnce(new Error('SecureStore unavailable'));

    await act(async () => {
      await useAuthStore.getState().signOut();
    });

    expect(useAuthStore.getState().user).toBeNull();
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
    throwing.mockRestore();
  });
});

// ===========================================================================
describe('venue detail — the exact real-device failure', () => {
  it('CONTROL: Account A sees the review while signed in', async () => {
    signInA();
    const client = makeAppQueryClient();
    render(<Harness queryClient={client} />, { wrapper: wrapperFor(client) });

    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());
  });

  it('does NOT render the review after a sign-out whose server revoke failed', async () => {
    signInA();
    const client = makeAppQueryClient();
    render(<Harness queryClient={client} />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());

    // The sign-out the user actually performed, on a flaky mobile connection.
    mockAuthState.failServerRevoke = true;
    await tapSignOut(client);

    // The user keeps using the app; the SDK's ticker runs.
    await simulateAutoRefreshTick();
    await settle();

    // BEFORE THE FIX: the session was still on disk, TOKEN_REFRESHED put
    // Account A back into the store, the query re-enabled and re-fetched
    // successfully, and this review rendered to a "signed out" user.
    expect(screen.queryByText(LEAK_FIXTURE_BODY)).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('the venue query cannot succeed anonymously once the session is gone', async () => {
    signInA();
    const client = makeAppQueryClient();
    render(<Harness queryClient={client} />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());

    mockAuthState.failServerRevoke = true;
    await tapSignOut(client);
    await simulateAutoRefreshTick();
    await settle();

    // No session in storage means every subsequent request is anonymous, and
    // the anonymous read is refused — RLS remains the enforcement.
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
    expect(screen.queryByText('Anonymous parent')).toBeNull();
  });
});
