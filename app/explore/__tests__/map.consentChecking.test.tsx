/**
 * Regression test for the Map screen's consent-'checking' state
 * (app/explore/map.tsx) — Phase 2 shared-background defect repair.
 *
 * Before this fix, `status === 'checking'` (still reading SecureStore, the
 * brief window before the stored consent flag resolves) returned a bare
 * `<View style={{ flex: 1, backgroundColor: T.bg }} />` — an opaque grey
 * flash in light mode instead of the warm shared atmosphere every other
 * screen shows during its own 'checking' state (see
 * app/explore/results.test.tsx's equivalent guard for ResultsScreen).
 *
 * This is a DEDICATED file (rather than an addition to map.v2.test.tsx)
 * because reliably reaching the 'checking' state requires mocking
 * useLocationConsent directly — map.v2.test.tsx instead exercises the real
 * hook against a mocked SecureStore, and adding a second mock for the same
 * module there would change the timing every other test in that file
 * depends on. Mocking it here keeps that suite's existing (uncommitted)
 * tests untouched.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ExploreScreen from '../map';

jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => ({ status: 'checking', grant: jest.fn(), decline: jest.fn() }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({ coords: null, isLoading: false, error: null })),
}));

jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({ data: [], isLoading: false, error: null })),
  useCategories: jest.fn(() => ({ data: [], isLoading: false, error: null })),
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

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  // See map.test.tsx for why this no-op mock is sufficient here. This file's
  // consent status is pinned at 'checking', so MapScreen (and therefore
  // useFocusEffect) is never even reached — provided purely so the module
  // shape matches production and nothing throws if that ever changes.
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: null }) },
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock('@/store/mapStore', () => ({
  useMapStore: jest.fn(() => ({ pendingPostcode: null, setPendingPostcode: jest.fn() })),
}));

const mockUseWeather = jest.fn(() => null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

// V2Background is hidden from the a11y tree (accessibilityElementsHidden),
// so walk toJSON() directly rather than using testing-library's queries —
// same helper as map.v2.test.tsx and app/venue/__tests__/venueDetailBackground.test.tsx.
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function containsTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => containsTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return containsTestID(node.children ?? null, testID);
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWeather.mockReturnValue(null);
});

describe('Map — consent "checking" state shares the v2 atmosphere', () => {
  it('mounts the shared <V2Background/> instead of the old opaque T.bg flash', () => {
    const tree = render(<ExploreScreen />, { wrapper: makeWrapper() }).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('does not render the map, marker, or consent prompt while still checking (honest loading state)', () => {
    const { queryByLabelText, queryByText } = render(<ExploreScreen />, { wrapper: makeWrapper() });
    expect(queryByLabelText('Map view')).toBeNull();
    expect(queryByText('Find venues near you?')).toBeNull();
  });
});
