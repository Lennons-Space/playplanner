/**
 * venueReviewLogoutBoundary.test.tsx
 *
 * REAL-PATH regression test for the post-logout review leak.
 *
 * WHY THIS FILE EXISTS (and why authCacheBoundary.test.tsx was not enough)
 * -----------------------------------------------------------------------
 * hooks/__tests__/authCacheBoundary.test.tsx exercises the useVenueReviews HOOK
 * in isolation and drives the identity change with useAuthStore.setState().
 * A real-device retest on 2026-08-21 still showed "Beautiful little park."
 * rendered to a signed-out user on the venue-detail screen, which means the
 * hook-level test does not cover the path the device actually takes.
 *
 * This suite therefore mounts the REAL app/venue/[id].tsx screen, with the REAL
 * useReviews / useAuthIdentity / authStore / ReviewCard, and drives sign-out
 * through the REAL store action (which awaits supabase.auth.signOut()) followed
 * by queryClient.clear() — exactly what app/(tabs)/profile.tsx's confirmSignOut
 * does. Nothing about the identity change is simulated by hand.
 *
 * The assertion is on RENDERED OUTPUT: the review body must not be present in
 * the tree, no matter which cache, hook or piece of local state supplied it.
 */
import React from 'react';
import { render, act, waitFor, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import VenueDetailScreen from '../[id]';
import { useAuthStore } from '@/store/authStore';

// The exact review body from the failing real-device test, used as a tracing
// fixture so a match in the rendered tree is unambiguous.
const LEAK_FIXTURE_BODY = 'Beautiful little park.';

// ---------------------------------------------------------------------------
// Simulated server. Everything the jest.mock factories touch lives on this one
// `mock`-prefixed object so babel-plugin-jest-hoist allows the reference.
// ---------------------------------------------------------------------------
const mockServer = {
  /**
   * The identity the NETWORK layer would present. Cleared only by the mocked
   * supabase.auth.signOut() — never by a test directly, so the test cannot
   * accidentally simulate the very state change it is trying to verify.
   */
  sessionUser: null as string | null,
  reviewsRequestCount: 0,
};

/** PostgREST 42501, as raised when `anon` touches public_profiles (065/066). */
const mockPermissionDenied = {
  code: '42501',
  message: 'permission denied for view public_profiles',
  hint: null,
  details: null,
};

const mockReviewRow = {
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
  // Author has show_reviews_publicly false -> ReviewCard renders
  // "Anonymous parent", which is exactly what the device showed.
  profile: null,
};

// ---------------------------------------------------------------------------
// expo / RN shims
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
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// ---------------------------------------------------------------------------
// Supabase: responses depend on who is asking, exactly as RLS makes them.
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      order: () => {
        if (table !== 'reviews') return Promise.resolve({ data: [], error: null });
        mockServer.reviewsRequestCount += 1;
        if (mockServer.sessionUser) {
          return Promise.resolve({ data: [mockReviewRow], error: null });
        }
        // Anonymous callers cannot read this query at all after 065/066/067.
        return Promise.resolve({ data: null, error: mockPermissionDenied });
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      delete: () => builder,
    });
    return builder;
  };

  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      auth: {
        // The real store action awaits this before clearing local state.
        signOut: async () => {
          mockServer.sessionUser = null;
          return { error: null };
        },
        // The store verifies termination by reading the session back — see
        // hooks/__tests__/signOutSessionTermination.test.tsx for the suite that
        // exercises the failure path this verification exists for.
        getSession: async () => ({
          data: { session: mockServer.sessionUser ? { user: { id: mockServer.sessionUser } } : null },
          error: null,
        }),
        startAutoRefresh: () => {},
        stopAutoRefresh: () => {},
      },
      rpc: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
    },
  };
});

// ---------------------------------------------------------------------------
// Venue: public data, legitimately identity-independent.
// ---------------------------------------------------------------------------
const mockVenue = {
  id: 'venue-grove',
  name: 'The Grove Play Area',
  slug: 'the-grove-play-area',
  description: 'A lovely little park.',
  address_line1: '1 Grove Lane',
  address_line2: null,
  city: 'London',
  postcode: 'SW1A 1AA',
  country: 'GB',
  category_id: 'c1',
  latitude: 51.5,
  longitude: -0.1,
  phone: null,
  email: null,
  website: null,
  price_range: null,
  min_age: 0,
  max_age: 12,
  is_published: true,
  is_verified: true,
  is_premium: false,
  featured_until: null,
  claimed_by: null,
  submitted_by: null,
  moderation_status: 'approved',
  osm_id: null,
  data_source: null,
  license: null,
  moderation_notes: null,
  moderated_by: null,
  moderated_at: null,
  review_count: 1,
  average_rating: 5,
  photos: [],
  facilities: [],
  opening_hours: [],
  distance_km: 1.2,
  category: { id: 'c1', name: 'Park', slug: 'park', icon: 'tree', color: '#000' },
  image_url: null,
  image_source: null,
  image_attribution: null,
  image_license: null,
  image_is_exact: null,
};

jest.mock('@/hooks/useVenues', () => ({
  useVenue: () => ({ data: mockVenue, isLoading: false, error: null }),
}));

jest.mock('@/hooks/useVenueReport', () => ({
  useReportVenue: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

// clearRecentlyViewed is called by the store's sign-out (locally cached
// browsing history must not cross an account boundary on a shared device).
jest.mock('@/lib/recentlyViewed', () => ({
  addRecentlyViewed: jest.fn(),
  clearRecentlyViewed: jest.fn().mockResolvedValue(undefined),
}));

// Heavy children with their own suites. ReviewCard is DELIBERATELY REAL — it is
// the component that renders the leaked body.
jest.mock('@/components/venue/VenuePhotoUpload', () => ({ VenuePhotoUpload: () => null }));
jest.mock('@/components/venue/VenueContactRow', () => ({ VenueContactRow: () => null }));
jest.mock('@/components/venue/FacilityChips', () => ({ FacilityChips: () => null }));
jest.mock('@/components/venues/RecommendationExplanation', () => ({
  RecommendationExplanation: () => null,
}));
jest.mock('@/hooks/useWeather', () => ({ useWeather: () => null }));
jest.mock('@/hooks/location', () => ({ useLocation: jest.fn() }));


// The __DEV__ diagnostics schedule 35s/60s verification timers and read real
// SecureStore; neither belongs in this suite's event loop. Their behaviour is
// covered by lib/__tests__/authDiagnostics.test.ts.
jest.mock('@/lib/authDiagnostics', () => ({
  logAuthState: jest.fn().mockResolvedValue(undefined),
  logAuthEvent: jest.fn(),
  scheduleSignOutVerification: jest.fn(),
  assertStorageKeyMatchesClient: jest.fn(() => true),
  fingerprint: jest.fn(() => 'aaaaaa'),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** The exact QueryClient configuration app/_layout.tsx builds. */
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

/** Sign in as `userId`, the way setSession() does (session -> store). */
function signIn(userId: string) {
  mockServer.sessionUser = userId;
  useAuthStore.setState({
    user: { id: userId } as never,
    session: { user: { id: userId } } as never,
    profile: null,
    isLoading: false,
  });
}

/**
 * The REAL sign-out path: the store action (which awaits
 * supabase.auth.signOut(), ending the simulated session) followed by
 * queryClient.clear() — what app/(tabs)/profile.tsx's confirmSignOut performs.
 */
async function realSignOut(client: QueryClient) {
  await act(async () => {
    await useAuthStore.getState().signOut();
    client.clear();
  });
}

/** Let any post-sign-out refetch settle — the window the leak lived in. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockServer.reviewsRequestCount = 0;
  mockServer.sessionUser = null;
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
});

afterEach(() => {
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
});

// ===========================================================================
describe('venue detail — review visibility across the real sign-out path', () => {
  it('CONTROL: renders the review while Account A is signed in', async () => {
    signIn('user-a');
    const client = makeAppQueryClient();
    render(<VenueDetailScreen />, { wrapper: wrapperFor(client) });

    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());
  });

  it('does NOT render the review after sign-out while the screen stays mounted', async () => {
    signIn('user-a');
    const client = makeAppQueryClient();
    render(<VenueDetailScreen />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());

    await realSignOut(client);
    await settle();

    expect(screen.queryByText(LEAK_FIXTURE_BODY)).toBeNull();
  });

  it('does NOT render the review when navigating back to the venue while signed out', async () => {
    signIn('user-a');
    const client = makeAppQueryClient();
    const first = render(<VenueDetailScreen />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());

    await realSignOut(client);
    first.unmount();

    // Navigate away and back: a fresh mount of the same screen, same client.
    render(<VenueDetailScreen />, { wrapper: wrapperFor(client) });
    await settle();

    expect(screen.queryByText(LEAK_FIXTURE_BODY)).toBeNull();
    expect(screen.queryByText('Anonymous parent')).toBeNull();
  });

  it('re-fetches for Account B rather than serving Account A’s cached rows', async () => {
    signIn('user-a');
    const client = makeAppQueryClient();
    const first = render(<VenueDetailScreen />, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(screen.getByText(LEAK_FIXTURE_BODY)).toBeTruthy());
    const afterA = mockServer.reviewsRequestCount;

    await realSignOut(client);
    first.unmount();

    signIn('user-b');
    render(<VenueDetailScreen />, { wrapper: wrapperFor(client) });
    await settle();

    // B must cause a NEW request rather than reading A's cache entry.
    expect(mockServer.reviewsRequestCount).toBeGreaterThan(afterA);
  });
});
