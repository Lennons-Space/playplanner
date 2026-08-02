/**
 * Tests for app/(tabs)/search.tsx
 *
 * Covers:
 *   1. Free chip excludes venues with null price_range
 *   2. Free chip includes venues with price_range === 'free'
 *   3. Rainy-day filter includes known-indoor category venues
 *   4. Rainy-day filter excludes known-outdoor category venues
 *   5. Rainy-day filter excludes venues with unknown/null category
 *   6. Open-now chip sets openNow filter in the store
 *   7. Category chip sets filterStore.categoryIds correctly
 *   8. "All" chip resets all filters
 *   9. Section heading reads "Nearby venues" (not "Popular venues")
 *  10. Empty state with active filters shows "Clear filters" button
 *  11. (Step 8, v2 dark restyle) mounts <V2Background/>; legacy
 *      <WeatherBackground/> import fully gone; consent gates unchanged.
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Import screen (after mocks) ─────────────────────────────────────────────
import SearchScreen from '../search';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

// Capture the filter store state so tests can read and manipulate it.
let mockFilters = {
  categoryIds: [] as string[],
  facilityIds: [] as string[],
  minAge: null as number | null,
  maxAge: null as number | null,
  priceRange: [] as string[],
  maxDistanceKm: 32,
  openNow: false,
  premiumOnly: false,
};
const mockSetFilters = jest.fn((partial: Record<string, unknown>) => {
  mockFilters = { ...mockFilters, ...partial };
});
const mockResetFilters = jest.fn(() => {
  mockFilters = {
    categoryIds: [],
    facilityIds: [],
    minAge: null,
    maxAge: null,
    priceRange: [],
    maxDistanceKm: 32,
    openNow: false,
    premiumOnly: false,
  };
});

jest.mock('@/store/filterStore', () => ({
  useFilterStore: jest.fn((selector: (s: unknown) => unknown) => {
    const state = {
      filters: mockFilters,
      setFilters: mockSetFilters,
      resetFilters: mockResetFilters,
      activeFilterCount: () =>
        (mockFilters.categoryIds.length ? 1 : 0) +
        (mockFilters.priceRange.length ? 1 : 0) +
        (mockFilters.openNow ? 1 : 0),
    };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

jest.mock('@/store/mapStore', () => ({
  useMapStore: jest.fn(() => ({
    pendingPostcode: null,
    setPendingPostcode: jest.fn(),
  })),
}));

// Provide a fixed set of categories matching the real DB slugs.
const MOCK_CATEGORIES = [
  { id: 'cat-soft-play',   name: 'Soft play',   slug: 'soft-play',   icon: 'stroller', color: '#FF8A7A' },
  { id: 'cat-park',        name: 'Park',         slug: 'park',        icon: 'leaf',     color: '#5BC08A' },
  { id: 'cat-indoor-play', name: 'Indoor play',  slug: 'indoor-play', icon: 'sparkle',  color: '#8E6BD8' },
  { id: 'cat-library',     name: 'Library',      slug: 'library',     icon: 'bookmark', color: '#8494A8' },
  { id: 'cat-farm',        name: 'Farm',         slug: 'farm',        icon: 'leaf',     color: '#B5985B' },
];

// Track which venues are returned by useNearbyVenues so tests can control the list.
let mockNearbyVenues: object[] = [];
let mockSearchResults: object[] = [];
// Loading/error overrides — most tests want the settled/empty defaults, but
// the Phase 5A loading-skeleton and error-retry tests below flip these.
let mockNearbyLoading = false;
let mockNearbyError: Error | null = null;
let mockSearchLoading = false;
let mockSearchError: Error | null = null;
const mockRefetchNearby = jest.fn();
const mockRefetchSearch = jest.fn();

jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({
    data: mockNearbyVenues,
    isLoading: mockNearbyLoading,
    error: mockNearbyError,
    refetch: mockRefetchNearby,
  })),
  useVenueSearch: jest.fn(() => ({
    data: mockSearchResults,
    isLoading: mockSearchLoading,
    error: mockSearchError,
    refetch: mockRefetchSearch,
  })),
  useCategories: jest.fn(() => ({
    data: MOCK_CATEGORIES,
    isLoading: false,
  })),
}));

// Real favourites — no fake state. Default: nothing saved, mutate is a no-op spy.
jest.mock('@/hooks/useFavourites', () => ({
  useSavedVenueIds: jest.fn(() => ({ savedIds: new Set(), isLoading: false })),
  useToggleFavourite: jest.fn(() => ({ mutate: jest.fn() })),
}));

// V2Background (mounted directly by this screen now, Step 8) reads the same
// coarse weather fetch Home/Map/Venue-Detail already read — default it to
// "no data yet" (null) so the atmosphere resolves deterministically without
// ever making a real network call (would otherwise hang the test process —
// see app/venue/__tests__/venueDetailBackground.test.tsx for the same pattern).
jest.mock('@/hooks/useWeather', () => ({
  useWeather: jest.fn(() => null),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Search is a tab screen — same tab-safe-zone pattern as Home. Standalone
// render here (outside a real bottom-tab navigator) needs a fixed height.
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 88,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('@/components/filters/FilterSheet', () => {
  const { View } = require('react-native');
  return function MockFilterSheet() {
    return <View testID="filter-sheet" />;
  };
});

// Only Icon is still imported from the shared '@/components/ui' barrel —
// Chip/ScreenTitle/IconBtn were replaced by local dark equivalents (Step 8:
// those shared components hard-code the legacy light `Colors` export).
jest.mock('@/components/ui', () => {
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('@/constants/location', () => ({
  FALLBACK_LOCATION: { latitude: 52.8, longitude: -1.5 },
  MAX_SEARCH_RADIUS_KM: 80,
  DEFAULT_SEARCH_RADIUS_KM: 32,
}));

// Mock useLocationConsent — default to 'granted' so tests see the nearby section.
// Individual tests can override this per-test if they want to test the consent nudge.
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: jest.fn(() => ({
    status: 'granted',
    grant: jest.fn(),
    decline: jest.fn(),
  })),
}));

// Mock useLocation — return a real Shropshire-like coordinate so tests don't
// depend on expo-location's native module, and so we can verify real location
// is used rather than the London fallback.
jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({
    coords: { latitude: 52.7065, longitude: -2.7419 }, // Shrewsbury
    hasPermission: true,
    isLoading: false,
    error: null,
  })),
}));

// ─── Venue factory ────────────────────────────────────────────────────────────
function makeVenue(overrides: Record<string, unknown> = {}) {
  return {
    id: `v-${Math.random()}`,
    name: 'Test Venue',
    slug: null,
    description: null,
    category_id: null,
    category: undefined,
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
    is_verified: false,
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
    review_count: 0,
    average_rating: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Wrapper / render helpers ─────────────────────────────────────────────────
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

async function renderSearch() {
  const utils = render(<SearchScreen />, { wrapper: makeWrapper() });
  // Wait for the component to settle.
  await waitFor(() => {
    expect(utils.getByText('Search')).toBeTruthy();
  });
  return utils;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  // jest.clearAllMocks() only clears call history — it does NOT undo a
  // `mockReturnValue()` override set by an earlier test (that needs
  // mockReset(), which would also wipe the factory's default implementation
  // shape). The "consent gate unchanged" tests below override
  // useLocationConsent to `{ status: 'undecided' }`; without restoring the
  // granted default here, every test that runs AFTER those in file order
  // would silently inherit 'undecided' and see the location nudge instead of
  // the nearby-venues content. Restore the default explicitly every test.
  const { useLocationConsent } = jest.requireMock('@/hooks/useLocationConsent');
  (useLocationConsent as jest.Mock).mockReturnValue({
    status: 'granted',
    grant: jest.fn(),
    decline: jest.fn(),
  });
  mockNearbyVenues = [];
  mockSearchResults = [];
  mockNearbyLoading = false;
  mockNearbyError = null;
  mockSearchLoading = false;
  mockSearchError = null;
  // Reset the filter store to defaults.
  mockFilters = {
    categoryIds: [],
    facilityIds: [],
    minAge: null,
    maxAge: null,
    priceRange: [],
    maxDistanceKm: 32,
    openNow: false,
    premiumOnly: false,
  };
});

// =============================================================================
// 1. Section heading is "Nearby venues"
// =============================================================================
describe('Search screen — section heading', () => {
  it('shows "Nearby venues" not "Popular venues"', async () => {
    const { getByText, queryByText } = await renderSearch();
    expect(getByText('Nearby venues')).toBeTruthy();
    expect(queryByText('Popular venues')).toBeNull();
  });
});

// =============================================================================
// 2. Free chip — filter behaviour
// =============================================================================
describe('Search screen — Free chip', () => {
  it('calls setFilters with priceRange ["free"] when the Free chip is pressed', async () => {
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-Free'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ priceRange: ['free'] });
  });

  it('excludes venue with null price_range from display when free filter is active (search path)', async () => {
    // In search-active mode, applyFiltersToResults runs client-side.
    // In idle mode, the server-side RPC handles price filtering — the mock does not simulate that.
    // We test the trust rule via the search path where the client-side filter is guaranteed to run.
    const freeVenue = makeVenue({ name: 'Free Place', price_range: 'free',   category: { id: 'cat-soft-play', name: 'Soft play', slug: 'soft-play', icon: '', color: '' } });
    const nullVenue = makeVenue({ name: 'Null Price', price_range: null,     category: { id: 'cat-park',      name: 'Park',      slug: 'park',      icon: '', color: '' } });
    const paidVenue = makeVenue({ name: 'Paid Place', price_range: 'budget', category: { id: 'cat-park',      name: 'Park',      slug: 'park',      icon: '', color: '' } });

    // Search path: useVenueSearch returns these results, applyFiltersToResults filters them.
    mockSearchResults = [freeVenue, nullVenue, paidVenue];
    // Simulate free filter active.
    mockFilters = { ...mockFilters, priceRange: ['free'] };

    const { queryByText, getByLabelText } = await renderSearch();

    // Trigger search-active mode by typing into the search box.
    await act(async () => {
      fireEvent.changeText(getByLabelText('Search for venues'), 'soft');
    });

    // Wait for results to render (real VenueCard2 renders the venue name as text).
    await waitFor(() => {
      expect(queryByText('Free Place')).toBeTruthy();
    });

    // Null-price-range venue must NOT appear (never assume free).
    expect(queryByText('Null Price')).toBeNull();
    // Paid venue must NOT appear.
    expect(queryByText('Paid Place')).toBeNull();
  });
});

// =============================================================================
// 3 & 4 & 5. Rainy-day filter
// =============================================================================
describe('Search screen — Rainy day chip', () => {
  it('calls setIsRainyDay (rainy-day chip active) when Rainy day is pressed', async () => {
    const { getByTestId } = await renderSearch();
    // Chip starts inactive; pressing it should toggle rainy-day mode on.
    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });
    // The chip should now be active (selected).
    await waitFor(() => {
      const chip = getByTestId('chip-☔ Rainy day ideas');
      expect(chip.props.accessibilityState?.selected).toBe(true);
    });
  });

  it('includes soft-play venue in rainy-day results', async () => {
    const softPlay = makeVenue({
      name: 'Bouncy Castle',
      category: { id: 'cat-soft-play', name: 'Soft play', slug: 'soft-play', icon: '', color: '' },
    });
    mockNearbyVenues = [softPlay];

    const { queryByText, getByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByText('Bouncy Castle')).toBeTruthy();
    });
  });

  it('excludes park venue from rainy-day results', async () => {
    const park = makeVenue({
      name: 'Local Park',
      category: { id: 'cat-park', name: 'Park', slug: 'park', icon: '', color: '' },
    });
    mockNearbyVenues = [park];

    const { queryByText, getByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByText('Local Park')).toBeNull();
    });
  });

  it('excludes venue with no category from rainy-day results', async () => {
    const unknownCat = makeVenue({
      name: 'Mystery Venue',
      category: undefined,
    });
    mockNearbyVenues = [unknownCat];

    const { queryByText, getByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByText('Mystery Venue')).toBeNull();
    });
  });

  it('excludes venue with farm category (mixed/null) from rainy-day results', async () => {
    const farm = makeVenue({
      name: 'Farm World',
      category: { id: 'cat-farm', name: 'Farm', slug: 'farm', icon: '', color: '' },
    });
    mockNearbyVenues = [farm];

    const { queryByText, getByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByText('Farm World')).toBeNull();
    });
  });
});

// =============================================================================
// 6. Open-now chip
// =============================================================================
describe('Search screen — Open now chip', () => {
  it('calls setFilters({ openNow: true }) when pressed while inactive', async () => {
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-Open now'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ openNow: true });
  });

  it('calls setFilters({ openNow: false }) when pressed while active', async () => {
    mockFilters = { ...mockFilters, openNow: true };
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-Open now'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ openNow: false });
  });
});

// =============================================================================
// 7. Category chip — sets filterStore.categoryIds
// =============================================================================
describe('Search screen — Category chips', () => {
  it('calls setFilters with the correct category ID when a category chip is pressed', async () => {
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-Soft play'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ categoryIds: ['cat-soft-play'] });
  });

  it('deselects category chip (sets categoryIds to []) when pressed a second time', async () => {
    // Pre-select soft-play.
    mockFilters = { ...mockFilters, categoryIds: ['cat-soft-play'] };
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-Soft play'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ categoryIds: [] });
  });

  it('calls setFilters with park category ID when Parks chip is pressed', async () => {
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-Parks'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ categoryIds: ['cat-park'] });
  });
});

// =============================================================================
// 8. All chip resets filters
// =============================================================================
describe('Search screen — All chip', () => {
  it('calls resetFilters when the All chip is pressed', async () => {
    mockFilters = { ...mockFilters, priceRange: ['free'], openNow: true };
    const { getByTestId } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByTestId('chip-All'));
    });
    expect(mockResetFilters).toHaveBeenCalled();
  });
});

// =============================================================================
// 9. Empty state with active filters shows "Clear filters" button
// =============================================================================
describe('Search screen — Empty state', () => {
  it('shows "Clear filters" button when there are active filters and no results', async () => {
    mockNearbyVenues = [];
    mockFilters = { ...mockFilters, priceRange: ['free'] };

    const { getByLabelText } = await renderSearch();

    await waitFor(() => {
      expect(getByLabelText('Clear all filters')).toBeTruthy();
    });
  });

  it('does NOT show "Clear filters" button when there are no active filters', async () => {
    mockNearbyVenues = [];
    // No active filters.

    const { queryByLabelText } = await renderSearch();

    await waitFor(() => {
      expect(queryByLabelText('Clear all filters')).toBeNull();
    });
  });

  it('calls resetFilters when "Clear filters" is pressed', async () => {
    mockNearbyVenues = [];
    mockFilters = { ...mockFilters, priceRange: ['free'] };

    const { getByLabelText } = await renderSearch();

    await waitFor(() => {
      expect(getByLabelText('Clear all filters')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Clear all filters'));
    });

    expect(mockResetFilters).toHaveBeenCalled();
  });
});

// =============================================================================
// 10. Suggestion chips trigger real filter actions
// =============================================================================
describe('Search screen — Suggestion chips', () => {
  it('"Free" suggestion calls setFilters with priceRange ["free"]', async () => {
    const { getByLabelText } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByLabelText('Filter by Free'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ priceRange: ['free'] });
  });

  it('"Soft play" suggestion calls setFilters with the soft-play category ID', async () => {
    const { getByLabelText } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByLabelText('Filter by Soft play'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ categoryIds: ['cat-soft-play'] });
  });

  it('"Parks" suggestion calls setFilters with the park category ID', async () => {
    const { getByLabelText } = await renderSearch();
    await act(async () => {
      fireEvent.press(getByLabelText('Filter by Parks'));
    });
    expect(mockSetFilters).toHaveBeenCalledWith({ categoryIds: ['cat-park'] });
  });
});

// =============================================================================
// 11. Step 8 — v2 dark restyle: shared atmosphere + legacy background removal
// =============================================================================

// ── helper: find a testID anywhere in a rendered tree ───────────────────────
// V2Background is intentionally hidden from the accessibility tree — walk
// toJSON() directly (same helper as app/venue/__tests__/venueDetailBackground.test.tsx).
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function containsTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => containsTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return containsTestID(node.children ?? null, testID);
}

describe('Search screen — shared v2 background', () => {
  it('mounts <V2Background/>', async () => {
    const utils = render(<SearchScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(utils.getByText('Search')).toBeTruthy());
    expect(containsTestID(utils.toJSON(), 'v2-background')).toBe(true);
  });
});

describe('Search screen — legacy background fully removed (source guard)', () => {
  it('never imports the legacy <WeatherBackground/>', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../search.tsx'), 'utf8');
    expect(src).not.toMatch(/WeatherBackground/);
  });

  // Light-theme correction (feat/exact-v2-design, v2 Light pass): this
  // screen now mounts <ThemedBackground/> instead of a direct <V2Background/>
  // (dark path stays byte-identical — see components/ui/ThemedBackground.tsx)
  // so its chrome resolves via useAppTheme().
  it('imports and mounts <ThemedBackground/>', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../search.tsx'), 'utf8');
    expect(src).toMatch(/import\s*{\s*ThemedBackground\s*}\s*from\s*'@\/components\/ui\/ThemedBackground'/);
    expect(src).toMatch(/<ThemedBackground\s*\/>/);
  });
});

describe('Search screen — consent gate unchanged', () => {
  it('shows the location nudge (not the nearby list) when consent is not granted', async () => {
    const { useLocationConsent } = jest.requireMock('@/hooks/useLocationConsent');
    (useLocationConsent as jest.Mock).mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    const { getByLabelText } = await renderSearch();
    expect(getByLabelText('Turn on location to see venues near you')).toBeTruthy();
  });

  it('routes to the consent-on-intent Results flow when the nudge is pressed', async () => {
    const { useLocationConsent } = jest.requireMock('@/hooks/useLocationConsent');
    (useLocationConsent as jest.Mock).mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    const { router } = jest.requireMock('expo-router');
    const { getByLabelText } = await renderSearch();
    fireEvent.press(getByLabelText('Turn on location to see venues near you'));
    expect(router.push).toHaveBeenCalledWith('/explore/results?mood=auto');
  });
});

// =============================================================================
// 12. Phase 5A — nearby-venues loading/error states (no more "tiny spinner in
// a large blank page"; a failed request must be distinguishable from a
// genuine zero-results empty state, with a way to retry).
// =============================================================================
describe('Search screen — nearby venues loading state', () => {
  it('does not show the generic "No venues nearby" copy while the nearby query is loading', async () => {
    mockNearbyLoading = true;
    const { queryByText } = await renderSearch();
    // While loading, neither the empty-state nor any result should render —
    // the skeleton rows are what's shown instead.
    expect(queryByText('No venues nearby')).toBeNull();
  });
});

describe('Search screen — nearby venues error state', () => {
  it('shows a distinct error message (not the generic empty state) when the nearby query fails', async () => {
    mockNearbyError = new Error('network error');
    const { getByText, queryByText } = await renderSearch();
    await waitFor(() => {
      expect(getByText("Couldn't load nearby venues")).toBeTruthy();
    });
    // Must not be confused with the "no results" empty state.
    expect(queryByText('No venues nearby')).toBeNull();
  });

  it('calls refetch() when "Try again" is pressed on the nearby error state', async () => {
    mockNearbyError = new Error('network error');
    const { getByLabelText } = await renderSearch();
    await waitFor(() => {
      expect(getByLabelText('Try loading nearby venues again')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Try loading nearby venues again'));
    });
    expect(mockRefetchNearby).toHaveBeenCalled();
  });
});

describe('Search screen — search results error state', () => {
  it('shows a distinct error message (not the generic "no results" copy) when the search query fails', async () => {
    mockSearchError = new Error('network error');
    const { getByText, getByLabelText, queryByText } = await renderSearch();
    fireEvent.changeText(getByLabelText('Search for venues'), 'soft play');
    await waitFor(() => {
      expect(getByText("Couldn't load search results")).toBeTruthy();
    });
    expect(queryByText(/No venues found for/)).toBeNull();
  });

  it('calls refetch() when "Try again" is pressed on the search error state', async () => {
    mockSearchError = new Error('network error');
    const { getByLabelText } = await renderSearch();
    fireEvent.changeText(getByLabelText('Search for venues'), 'soft play');
    await waitFor(() => {
      expect(getByLabelText('Try search again')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Try search again'));
    });
    expect(mockRefetchSearch).toHaveBeenCalled();
  });
});
