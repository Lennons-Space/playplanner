/**
 * Deep-link auth guard proof for app/explore/map.tsx (Map / Explore screen).
 *
 * app/(tabs)/_layout.tsx already gates this screen when reached as the Map
 * tab, but app/explore/map.tsx is ALSO registered directly on the root Stack
 * (app/_layout.tsx) with no layout guard of its own, and app/(tabs)/map.tsx
 * re-exports this exact same default export — so a deep link
 * (playplanner://explore/map) could reach it signed out. ExploreScreen's
 * default export is now wrapped in RequireSession (components/auth/
 * RequireSession.tsx). This file proves the four required guarantees:
 *
 *   1. An authenticated user can access Map.
 *   2. Signed-out direct/deep-link access redirects to auth WITHOUT
 *      rendering the screen (no flash of map content, no postcode bar).
 *   3. Postcode lookup cannot be triggered while signed out — the
 *      geocode-postcode Edge Function invoke is never called.
 *   4. The session-loading state does not redirect (must not bounce a
 *      legitimately signed-in user mid cold-start restore).
 *
 * Mock surface mirrors map.test.tsx (same screen, same dependencies) —
 * kept as a separate file so the auth-guard proof is easy to find and does
 * not get lost among the screen's much larger behavioural test suite.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/store/authStore';
import { buildLocationConsentRecord } from '@/lib/locationConsentStorage';
import ExploreScreen from '../map';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockRedirectHref = jest.fn();
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useFocusEffect: jest.fn(),
    Redirect: ({ href }: { href: string }) => {
      mockRedirectHref(href);
      return <View testID="redirect" />;
    },
  };
});

jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(JSON.stringify({ userId: "user-1", grantedAt: "2026-01-01T00:00:00.000Z", consentVersion: "v1.0" })), // account-scoped stored consent — reach the map, not the prompt
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({
    coords: { latitude: 51.5, longitude: -0.1 },
    isLoading: false,
    error: null,
  })),
}));

jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({ data: [], isLoading: false, error: null })),
  useCategories: jest.fn(() => ({ data: [], isLoading: false, error: null })),
}));

jest.mock('@/hooks/useWeather', () => ({
  useWeather: jest.fn(() => null),
}));

jest.mock('@/store/filterStore', () => ({
  useFilterStore: jest.fn((selector) => {
    const state = {
      filters: {
        categoryIds: [], facilityIds: [], minAge: null, maxAge: null,
        priceRange: [], maxDistanceKm: 32, openNow: false, premiumOnly: false,
      },
      activeFilterCount: () => 0,
    };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

jest.mock('@/store/mapStore', () => ({
  useMapStore: jest.fn(() => ({ pendingPostcode: null, setPendingPostcode: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-map-clustering', () => {
  const { View } = require('react-native');
  return function MockClusterMapView({ children }: { children?: React.ReactNode }) {
    return <View testID="cluster-map-view">{children}</View>;
  };
});

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  return {
    Marker: ({ children }: { children?: React.ReactNode }) => <View testID="map-marker">{children}</View>,
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('@/components/filters/FilterSheet', () => {
  const { View } = require('react-native');
  return function MockFilterSheet() {
    return <View testID="filter-sheet" />;
  };
});

jest.mock('@/services/consent/locationConsent', () => ({
  recordLocationConsentGranted: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentWithdrawn: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentDenied: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('@/components/ui/SkeletonLoader', () => {
  const { View } = require('react-native');
  return { VenueRowSkeleton: () => <View testID="venue-row-skeleton" /> };
});

const mockFunctionsInvoke = jest.fn().mockResolvedValue({ data: null, error: null });
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockFunctionsInvoke(...args) },
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

// ─── Typed helpers ────────────────────────────────────────────────────────────
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

function mockStore(state: { session: unknown; isLoading: boolean }) {
  // PP-018: hooks/useLocationConsent.ts scopes consent by `user.id`, so the
  // mocked store must expose `user` alongside `session` — the real store always
  // sets both together (store/authStore.ts). Derived here rather than passed by
  // each caller so a signed-out case can never accidentally carry a user.
  const user = (state.session as { user?: { id: string } } | null)?.user ?? null;
  mockUseAuthStore.mockImplementation((selector) =>
    selector({ ...state, user } as unknown as AuthStoreState),
  );
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(buildLocationConsentRecord('user-1', 'v1.0'));
  mockFunctionsInvoke.mockResolvedValue({ data: null, error: null });
});

// =============================================================================
// 1. Authenticated access
// =============================================================================
describe('ExploreScreen (Map) — authenticated access', () => {
  it('renders the real Map screen (toggle + map view) when a session is present', async () => {
    mockStore({ session: { access_token: 'tok', user: { id: 'user-1' } }, isLoading: false });

    const { getByLabelText, queryByTestId } = render(<ExploreScreen />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(getByLabelText('Map view')).toBeTruthy();
    });
    expect(queryByTestId('redirect')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2. Signed-out redirect — no flash of screen content
// =============================================================================
describe('ExploreScreen (Map) — signed-out deep-link access', () => {
  it('redirects to /(auth) and never renders the Map screen when there is no session', async () => {
    mockStore({ session: null, isLoading: false });

    const { getByTestId, queryByLabelText, queryByTestId } = render(<ExploreScreen />, {
      wrapper: makeWrapper(),
    });

    expect(getByTestId('redirect')).toBeTruthy();
    expect(mockRedirectHref).toHaveBeenCalledWith('/(auth)');

    // The functional screen must not render or flash — none of its content
    // (toggle pill, map, postcode search) should ever mount.
    expect(queryByLabelText('Map view')).toBeNull();
    expect(queryByLabelText('List view')).toBeNull();
    expect(queryByTestId('cluster-map-view')).toBeNull();
  });
});

// =============================================================================
// 3. Postcode lookup cannot be triggered while signed out
// =============================================================================
describe('ExploreScreen (Map) — postcode lookup is unreachable while signed out', () => {
  it('never invokes the geocode-postcode Edge Function on the signed-out path', async () => {
    mockStore({ session: null, isLoading: false });

    render(<ExploreScreen />, { wrapper: makeWrapper() });

    // Give any stray effects a chance to run before asserting the negative.
    await waitFor(() => {
      expect(mockRedirectHref).toHaveBeenCalledWith('/(auth)');
    });

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 4. Session-loading state must not redirect (no bounce for signed-in users)
// =============================================================================
describe('ExploreScreen (Map) — cold-start loading guard', () => {
  it('renders nothing and does not redirect while the session is still loading', () => {
    mockStore({ session: null, isLoading: true });

    const { toJSON, queryByTestId } = render(<ExploreScreen />, { wrapper: makeWrapper() });

    expect(toJSON()).toBeNull();
    expect(queryByTestId('redirect')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });
});
