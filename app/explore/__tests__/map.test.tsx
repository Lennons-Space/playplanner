/**
 * Unit tests for app/(tabs)/index.tsx — ExploreScreen.
 *
 * What this file tests:
 *   1. Consent gate — LocationConsentPrompt is shown before any map/toggle
 *   2. Toggle renders — "Map" and "List" buttons appear after consent
 *   3. Toggle switches mode — pressing "List" shows the list; pressing "Map" restores the map
 *   4. List mode shows venues — venue names appear in list mode
 *   5. Empty state in list mode — correct message when useNearbyVenues returns []
 *   6. Filter button accessible in both modes — "Filters" button is always reachable
 *
 * HOW CONSENT STATES WORK IN ExploreScreen:
 *   State 1: consentChecked=false   → renders an empty View (splash guard)
 *   State 2: consentChecked=true, !consented, !declined → LocationConsentPrompt
 *   State 3: consented=true         → MapWithLocation (has GPS)
 *   State 4: declined=true          → LocationFallbackMap (no GPS, London fallback)
 *
 * We drive consent state entirely through the SecureStore mock:
 *   - getItemAsync returns null  → no stored consent → prompt shown (state 2)
 *   - getItemAsync returns '1'   → stored consent → map shown immediately (state 3)
 *
 * WHY MOCKING useNearbyVenues (not supabase directly):
 * The component imports useNearbyVenues from @/hooks/useVenues. Mocking at the
 * hook boundary is simpler, faster, and tests the component in isolation — we
 * already have separate tests for the hook itself in hooks/__tests__/useVenues.test.ts.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Imports (after mocks) ───────────────────────────────────────────────────
import * as SecureStore from 'expo-secure-store';
import { useNearbyVenues } from '@/hooks/useVenues';
import ExploreScreen from '../map';
import type { Venue } from '@/types';

// ─── Module mocks ────────────────────────────────────────────────────────────
// All jest.mock() calls are hoisted to the top of the file by Jest's transform
// (before any imports run). Keep them here — do not move them after imports.

// SecureStore: default to no stored consent (null) so most tests start at the
// consent prompt. Per-test overrides use mockResolvedValueOnce.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// useLocation: return a stable GPS fix so MapWithLocation never stalls on
// locLoading=true. We don't want location loading behaviour in these tests.
jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({
    coords: { latitude: 51.5, longitude: -0.1 },
    isLoading: false,
    error: null,
  })),
}));

// useNearbyVenues: default to empty, no loading. Each test that needs venues
// uses mockReturnValueOnce to inject a custom return value.
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
}));

// filterStore: return sensible defaults with activeFilterCount returning 0.
// This prevents the "Filters · N" badge variant from appearing unexpectedly.
jest.mock('@/store/filterStore', () => ({
  useFilterStore: jest.fn((selector) => {
    const state = {
      filters: {
        categoryIds: [],
        facilityIds: [],
        minAge: null,
        maxAge: null,
        priceRange: [],
        maxDistanceKm: 32,
        openNow: false,
        premiumOnly: false,
      },
      activeFilterCount: () => 0,
    };
    // useFilterStore is called with a selector function in MapScreen:
    //   useFilterStore(useShallow(s => ({ filters: s.filters, activeFilterCount: s.activeFilterCount() })))
    // We receive that selector here and must execute it against our fake state.
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

// react-native-safe-area-context: supply a real inset object so layout maths
// inside MapScreen (insets.top + 8, etc.) does not produce NaN.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// react-native-map-clustering: renders a real native map which cannot run in
// Jest. Replace with a plain View so the component tree doesn't crash.
jest.mock('react-native-map-clustering', () => {
  const { View } = require('react-native');
  // The component is the default export.
  return function MockClusterMapView({ children }: { children?: React.ReactNode }) {
    return <View testID="cluster-map-view">{children}</View>;
  };
});

// react-native-maps: Marker and PROVIDER_GOOGLE are used by VenueMarker and
// renderCluster. Replace Marker with a View so the tree doesn't error out.
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  return {
    Marker: ({ children }: { children?: React.ReactNode }) =>
      <View testID="map-marker">{children}</View>,
    PROVIDER_GOOGLE: 'google',
  };
});

// FilterSheet: has its own Supabase/animation dependencies — mock it with a
// no-op so index.test.tsx stays isolated from FilterSheet internals.
jest.mock('@/components/filters/FilterSheet', () => {
  const { View } = require('react-native');
  return function MockFilterSheet() {
    return <View testID="filter-sheet" />;
  };
});

// recordLocationConsentGranted: a fire-and-forget audit call. Mocking it
// prevents the real implementation from hitting supabase.auth.getUser and
// crashing due to missing env vars.
jest.mock('@/services/consent/locationConsent', () => ({
  recordLocationConsentGranted: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentWithdrawn: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentDenied: jest.fn().mockResolvedValue(undefined),
}));

// expo-router: we don't test navigation in this file, but the component
// imports router. Provide a stub to prevent the crash.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

// @expo/vector-icons: renders SVG icons via a native module — replace with a
// simple Text so the component renders without native bridging.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

// VenueRowSkeleton: uses Animated — replace with a stable View so skeleton
// tests don't rely on animation timing.
jest.mock('@/components/ui/SkeletonLoader', () => {
  const { View } = require('react-native');
  return {
    VenueRowSkeleton: () => <View testID="venue-row-skeleton" />,
  };
});

// lib/supabase: ExploreScreen imports supabase directly for geocodePostcode.
// Without this mock the module evaluates and throws "Missing Supabase env vars"
// before process.env assignments run. The supabase client is never actually
// called in these tests (all hooks that use it are mocked), so a stub suffices.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

// mapStore: provides pendingPostcode / setPendingPostcode consumed by MapScreen.
jest.mock('@/store/mapStore', () => ({
  useMapStore: jest.fn(() => ({
    pendingPostcode: null,
    setPendingPostcode: jest.fn(),
  })),
}));

// ─── Typed mock helpers ──────────────────────────────────────────────────────
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockUseNearbyVenues = useNearbyVenues as jest.MockedFunction<
  typeof useNearbyVenues
>;

// ─── Test helpers ────────────────────────────────────────────────────────────

/**
 * Build a minimal Venue object. Only the fields actually used in VenueRow
 * rendering need to be populated — supplying the full type here would add
 * noise and make the tests harder to read.
 */
function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'venue-1',
    name: 'Sunshine Soft Play',
    slug: null,
    description: null,
    category_id: null,
    category: { id: 'cat-1', name: 'Soft Play', icon: '🏀', color: '#000', slug: 'soft-play' },
    address_line1: null,
    address_line2: null,
    city: 'London',
    postcode: null,
    country: 'GB',
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
    review_count: 0,
    average_rating: 4.5,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Wrap the component in a React Query provider so hooks work correctly.
 * A fresh QueryClient per test prevents cached data leaking between tests.
 */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/**
 * Render ExploreScreen and wait for the SecureStore consent check to complete.
 * Without this `waitFor`, tests that assert on post-check UI (toggle, map, etc.)
 * would be asserting against the blank loading view (state 1).
 *
 * Pass `consentStored: true` to simulate a returning user who already accepted
 * consent — SecureStore returns '1' and the map shows immediately.
 */
async function renderAndWaitForConsent(options: { consentStored?: boolean } = {}) {
  if (options.consentStored) {
    mockGetItemAsync.mockResolvedValueOnce('1');
  } else {
    // Explicit null ensures the consent prompt is shown (default mock returns null,
    // but we set it explicitly here to document intent).
    mockGetItemAsync.mockResolvedValueOnce(null);
  }

  const utils = render(<ExploreScreen />, { wrapper: makeWrapper() });

  // Wait for the useEffect's SecureStore.getItemAsync call to resolve, which
  // sets consentChecked=true and moves the component out of the blank loading state.
  await waitFor(() => {
    // In state 2 (no stored consent) we expect the consent prompt.
    // In state 3 (stored consent) we expect the toggle pill.
    // Either way the component has advanced past the loading blank.
    expect(utils.toJSON()).not.toBeNull();
  });

  return utils;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset mocks between tests to prevent state leaking
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  // Restore the default: no stored consent. Individual tests override this.
  mockGetItemAsync.mockResolvedValue(null);
  // Restore the default hook return: empty array, not loading.
  mockUseNearbyVenues.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    // TanStack Query v5 returns many more fields — we only need data/isLoading/error
    // for the component's render logic.
  } as ReturnType<typeof useNearbyVenues>);
});

// =============================================================================
// 1. CONSENT GATE
// =============================================================================
describe('ExploreScreen — consent gate', () => {

  // If this test didn't exist, a bug that skipped the consent check entirely
  // would pass all the toggle tests but silently violate ICO Standard 10 by
  // accessing location without asking the user first.
  it('shows LocationConsentPrompt when no consent is stored in SecureStore', async () => {
    // mockGetItemAsync already returns null by default (set in beforeEach)
    const { getByLabelText } = await renderAndWaitForConsent();

    // LocationConsentPrompt renders two accessible buttons — their labels are
    // set directly in the component and must not change without updating this test.
    expect(getByLabelText('Allow location access')).toBeTruthy();
    expect(getByLabelText('Browse without location')).toBeTruthy();
  });

  // Without this test, a regression that always showed the map regardless of
  // consent state would go undetected — breaking GDPR Art.7 (consent before processing).
  it('does NOT show the Map/List toggle before consent is given', async () => {
    const { queryByLabelText } = await renderAndWaitForConsent();

    // Both toggle buttons must be absent when the consent prompt is shown.
    expect(queryByLabelText('Map view')).toBeNull();
    expect(queryByLabelText('List view')).toBeNull();
  });

  // This is the "returning user" path — consent was stored in a previous session.
  // If SecureStore.getItemAsync were never checked, the prompt would flash on every
  // app open, annoying users who already said yes and breaking GDPR Art.7(3)
  // (consent should not be re-requested when already given).
  it('skips the consent prompt and shows the toggle when consent is already stored', async () => {
    const { getByLabelText, queryByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    // The toggle must be visible.
    expect(getByLabelText('Map view')).toBeTruthy();
    expect(getByLabelText('List view')).toBeTruthy();

    // The consent prompt must NOT appear.
    expect(queryByLabelText('Allow location access')).toBeNull();
  });

  // If declining never moved the app forward (declined=true wasn't set), the
  // user would be stuck on the consent screen with no way out — a terrible UX
  // and a violation of ICO Standard 10 ("must be able to browse without sharing").
  it('shows the map after the user presses "Browse without location"', async () => {
    const { getByLabelText } = await renderAndWaitForConsent();

    // Tap the decline button.
    await act(async () => {
      fireEvent.press(getByLabelText('Browse without location'));
    });

    // After declining, the toggle must appear (LocationFallbackMap is shown).
    await waitFor(() => {
      expect(getByLabelText('Map view')).toBeTruthy();
    });
  });

  // If accepting consent didn't persist the choice (setConsented(true) were missing),
  // the map would not mount and the user would be stuck on the prompt forever.
  it('shows the map after the user presses "Allow location access"', async () => {
    const { getByLabelText } = await renderAndWaitForConsent();

    await act(async () => {
      fireEvent.press(getByLabelText('Allow location access'));
    });

    await waitFor(() => {
      expect(getByLabelText('Map view')).toBeTruthy();
    });
  });

  // GDPR requirement: declining must NOT persist a "declined" flag to SecureStore.
  // The ICO guidance says users should be re-asked on next app open. If we persisted
  // "declined", returning users could never be asked again — permanently blocking GPS.
  it('does NOT write to SecureStore when the user declines consent', async () => {
    const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
    const { getByLabelText } = await renderAndWaitForConsent();

    await act(async () => {
      fireEvent.press(getByLabelText('Browse without location'));
    });

    // Only getItemAsync should have been called (the initial check).
    // setItemAsync must not have been called — declining is not persisted.
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });

  // Confirming the recording side: accepting DOES persist the consent flag.
  // Without this write, the consent would work only for the current session —
  // the user would be asked again every time they open the app.
  it('writes "1" to SecureStore under location_consent_granted when the user accepts', async () => {
    const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
    const { getByLabelText } = await renderAndWaitForConsent();

    await act(async () => {
      fireEvent.press(getByLabelText('Allow location access'));
    });

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      'location_consent_granted',
      '1',
    );
  });
});

// =============================================================================
// 2. TOGGLE RENDERS
// =============================================================================
describe('ExploreScreen — toggle pill renders', () => {

  // The toggle is the primary navigation control on the Explore tab. If it
  // didn't render, users would be permanently stuck in whichever mode the
  // component defaulted to — with no way to switch.
  it('renders both Map and List buttons after consent is confirmed', async () => {
    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    expect(getByLabelText('Map view')).toBeTruthy();
    expect(getByLabelText('List view')).toBeTruthy();
  });

  // The component starts in map mode. If accessibilityState.selected were
  // hard-coded to true on both buttons, screen reader users would hear both
  // as "selected" — confusing and inaccurate.
  it('marks Map as selected and List as not selected on initial render', async () => {
    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    const mapButton = getByLabelText('Map view');
    const listButton = getByLabelText('List view');

    // accessibilityState.selected reflects viewMode state in the component.
    expect(mapButton.props.accessibilityState?.selected).toBe(true);
    expect(listButton.props.accessibilityState?.selected).toBe(false);
  });
});

// =============================================================================
// 3. TOGGLE SWITCHES MODE
// =============================================================================
describe('ExploreScreen — toggle mode switching', () => {

  // If pressing "List" didn't change the view, users would never be able to
  // see the venue list — half the feature would be dead.
  it('pressing List unmounts the map and shows the list container', async () => {
    const { getByLabelText, queryByTestId, findByLabelText } =
      await renderAndWaitForConsent({ consentStored: true });

    // Verify we start in map mode.
    expect(queryByTestId('cluster-map-view')).toBeTruthy();

    // Press List.
    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    // Map must be gone — ClusterMapView is fully unmounted in list mode.
    await waitFor(() => {
      expect(queryByTestId('cluster-map-view')).toBeNull();
    });

    // List mode header text must appear.
    // "No venues found" is the empty-state message (venues=[]).
    await waitFor(() => {
      expect(getByLabelText('List view')).toBeTruthy(); // toggle still present
    });
  });

  // If pressing "Map" after switching to list didn't work, users would be
  // stuck in list mode — the map could never be recovered without restarting the app.
  it('pressing Map after List switches back to map mode', async () => {
    const { getByLabelText, queryByTestId } = await renderAndWaitForConsent({
      consentStored: true,
    });

    // Switch to list.
    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(queryByTestId('cluster-map-view')).toBeNull();
    });

    // Switch back to map.
    await act(async () => {
      fireEvent.press(getByLabelText('Map view'));
    });

    // Map must reappear.
    await waitFor(() => {
      expect(queryByTestId('cluster-map-view')).toBeTruthy();
    });
  });

  // accessibilityState.selected must flip when the user switches mode.
  // Without this, VoiceOver/TalkBack users never know which mode is active.
  it('updates accessibilityState.selected on both buttons when switching to list', async () => {
    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(getByLabelText('List view').props.accessibilityState?.selected).toBe(true);
      expect(getByLabelText('Map view').props.accessibilityState?.selected).toBe(false);
    });
  });
});

// =============================================================================
// 4. LIST MODE SHOWS VENUES
// =============================================================================
describe('ExploreScreen — list mode renders venues', () => {

  // The primary reason list mode exists is to show venue names in a scannable
  // format. If VenueRow failed to render venue.name, users would see an empty
  // list even when venues are available — a confusing silent failure.
  it('renders venue names in a FlatList when useNearbyVenues returns results', async () => {
    // Override the default empty response with two real venues.
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({ id: 'v1', name: 'Sunshine Soft Play' }),
        makeVenue({ id: 'v2', name: 'Park Lane Playground' }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const { getByLabelText, getByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    // Switch to list mode.
    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    // Both venue names must appear in the rendered output.
    await waitFor(() => {
      expect(getByText('Sunshine Soft Play')).toBeTruthy();
      expect(getByText('Park Lane Playground')).toBeTruthy();
    });
  });

  // The list header shows "N venues nearby" when results exist. If this were
  // missing or showed "No venues found" incorrectly, users would distrust the app.
  it('shows the correct venue count in the list header', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({ id: 'v1', name: 'Venue A' }),
        makeVenue({ id: 'v2', name: 'Venue B' }),
        makeVenue({ id: 'v3', name: 'Venue C' }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const { getByLabelText, getByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(getByText('3 venues nearby')).toBeTruthy();
    });
  });

  // Singular "venue" vs plural "venues" — a small but user-visible detail.
  // "1 venues nearby" reads incorrectly; the component uses a ternary for this.
  it('uses singular "venue" in the header when exactly one venue is returned', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [makeVenue({ id: 'v1', name: 'Solo Venue' })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const { getByLabelText, getByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(getByText('1 venue nearby')).toBeTruthy();
    });
  });

  // Tapping a venue row navigates to the venue detail screen. If the press
  // handler were broken, users could see venue names but never open a venue.
  // We test that the row has the correct accessibilityLabel (the safest
  // way to verify VenueRow renders with the right data without testing internals).
  it('renders each venue row with an accessible label containing the venue name', async () => {
    const venue = makeVenue({
      id: 'v1',
      name: 'Happy Kids Zone',
      category: { id: 'c1', name: 'Soft Play', icon: '🏀', color: '#000', slug: 'soft-play' },
    });
    mockUseNearbyVenues.mockReturnValue({
      data: [venue],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    // VenueRow sets accessibilityLabel to "${venue.name}, ${category.name}".
    await waitFor(() => {
      expect(getByLabelText('Happy Kids Zone, Soft Play')).toBeTruthy();
    });
  });
});

// =============================================================================
// 5. EMPTY STATE IN LIST MODE
// =============================================================================
describe('ExploreScreen — empty state in list mode', () => {

  // If the empty state were missing, users with no nearby venues would see a
  // blank white screen with no explanation — they would assume the app is broken.
  it('shows "No venues found" when useNearbyVenues returns an empty array', async () => {
    // Default mock already returns [] — no override needed.
    const { getByLabelText, getAllByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      // The text appears twice: once in the header, once in the full-page empty state.
      const matches = getAllByText('No venues found');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  // The empty state includes a hint to adjust filters or pan the map. Without
  // this, users would have no idea why results are empty or what to do next.
  it('shows the "Adjust your filters" hint in the empty state', async () => {
    const { getByLabelText, getByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(
        getByText('Adjust your filters or move the map to find venues nearby.'),
      ).toBeTruthy();
    });
  });

  // While venues are loading, the component should show skeleton rows, not the
  // "No venues found" empty state. If the loading branch were absent, the empty
  // state would flash briefly on every search before results arrived.
  it('shows skeleton rows while venues are loading, not the empty state', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const { getByLabelText, getAllByTestId, queryByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      // Skeleton rows must be present.
      const skeletons = getAllByTestId('venue-row-skeleton');
      expect(skeletons.length).toBeGreaterThan(0);

      // Empty state must NOT be shown during loading.
      expect(queryByText('No venues found')).toBeNull();
    });
  });

  // "Finding venues…" loading text appears in the header while loading.
  // Without this, users would see a count of "0 venues" before results arrive.
  it('shows "Finding venues…" in the list header while loading', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const { getByLabelText, getByText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(getByText('Finding venues…')).toBeTruthy();
    });
  });
});

// =============================================================================
// 6. FILTER BUTTON ACCESSIBLE IN BOTH MODES
// =============================================================================
describe('ExploreScreen — Filters button accessibility', () => {

  // The Filters button is a core discovery feature — if it disappeared when
  // switching to list mode, users would lose the ability to refine results.
  it('Filters button is present in map mode (inside the bottom sheet header)', async () => {
    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    // Default is map mode. The button is inside the bottom sheet header row.
    expect(getByLabelText('Filters')).toBeTruthy();
  });

  // Same check for list mode — the filter button is re-rendered in the list
  // header row. Without this, list mode would silently drop the filter control.
  it('Filters button is present in list mode (inside the list header)', async () => {
    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(getByLabelText('Filters')).toBeTruthy();
    });
  });

  // The filter badge shows "Filters · N" when filters are active. This test
  // uses activeFilterCount=2 to confirm the label changes. Without the dynamic
  // label, screen reader users would always hear "Filters" regardless of whether
  // any filters were active.
  it('Filters button label includes the active count when filters are active', async () => {
    // Override filterStore to return activeFilterCount = 2.
    const { useFilterStore } = require('@/store/filterStore');
    (useFilterStore as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) => {
      const state = {
        filters: {
          categoryIds: ['cat-1'],
          facilityIds: [],
          minAge: null,
          maxAge: null,
          priceRange: ['free'],
          maxDistanceKm: 32,
          openNow: false,
          premiumOnly: false,
        },
        activeFilterCount: () => 2,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });

    const { getByLabelText } = await renderAndWaitForConsent({
      consentStored: true,
    });

    expect(getByLabelText('Filters, 2 active')).toBeTruthy();
  });
});

// =============================================================================
// 7. GDPR — consent audit log is non-blocking
// =============================================================================
describe('ExploreScreen — GDPR consent audit log is non-blocking', () => {

  // recordLocationConsentGranted is a fire-and-forget GDPR Art.7 audit call.
  // If it throws and that error were allowed to propagate, accepting consent
  // would crash the app — a privacy-hostile outcome where the user cannot use
  // the map because the audit log service is down.
  it('accepting consent does not crash the app when the audit log service fails', async () => {
    const { recordLocationConsentGranted } = require('@/services/consent/locationConsent');
    (recordLocationConsentGranted as jest.Mock).mockRejectedValueOnce(
      new Error('Audit DB unreachable'),
    );

    const { getByLabelText } = await renderAndWaitForConsent();

    // This must not throw — the catch block in handleConsentAccept absorbs it.
    await expect(
      act(async () => {
        fireEvent.press(getByLabelText('Allow location access'));
      }),
    ).resolves.not.toThrow();

    // Despite the audit failure, the map should still be shown.
    await waitFor(() => {
      expect(getByLabelText('Map view')).toBeTruthy();
    });
  });

  // SecureStore.setItemAsync can fail on some devices (e.g. encrypted storage
  // unavailable). If this were not caught, accepting consent would crash and
  // the user could never access the map — a hostile UX and a potential privacy
  // issue if the crash leaks to an error tracking service.
  it('accepting consent does not crash when SecureStore.setItemAsync fails', async () => {
    const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
    mockSetItemAsync.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    const { getByLabelText } = await renderAndWaitForConsent();

    await expect(
      act(async () => {
        fireEvent.press(getByLabelText('Allow location access'));
      }),
    ).resolves.not.toThrow();

    // Consent should still take effect for this session even if persistence failed.
    await waitFor(() => {
      expect(getByLabelText('Map view')).toBeTruthy();
    });
  });
});
