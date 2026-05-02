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
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({
    data: mockNearbyVenues,
    isLoading: false,
    error: null,
  })),
  useVenueSearch: jest.fn(() => ({
    data: mockSearchResults,
    isLoading: false,
    error: null,
  })),
  useCategories: jest.fn(() => ({
    data: MOCK_CATEGORIES,
    isLoading: false,
  })),
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

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('@/components/filters/FilterSheet', () => {
  const { View } = require('react-native');
  return function MockFilterSheet() {
    return <View testID="filter-sheet" />;
  };
});

// Mock all UI kit components minimally so they render without native modules.
jest.mock('@/components/ui', () => {
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    VenueCard: ({ venue }: { venue: { name: string } }) => (
      <View testID={`venue-card-${venue.name}`}>
        <Text>{venue.name}</Text>
      </View>
    ),
    Icon: ({ name }: { name: string }) => <Text>{name}</Text>,
    Chip: ({
      children,
      active,
      onPress,
    }: {
      children: React.ReactNode;
      active: boolean;
      onPress: () => void;
    }) => (
      <TouchableOpacity
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={String(children)}
        accessibilityState={{ selected: active }}
        testID={`chip-${children}`}
      >
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    ScreenTitle: ({ title }: { title: string }) => <Text>{title}</Text>,
    IconBtn: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
      <TouchableOpacity onPress={onPress}>{children}</TouchableOpacity>
    ),
  };
});

jest.mock('@/constants/location', () => ({
  FALLBACK_LOCATION: { latitude: 51.5074, longitude: -0.1278 },
}));

// ─── Import screen (after mocks) ─────────────────────────────────────────────
import SearchScreen from '../search';

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
  mockNearbyVenues = [];
  mockSearchResults = [];
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

    const { getByTestId, queryByTestId, getByLabelText } = await renderSearch();

    // Trigger search-active mode by typing into the search box.
    await act(async () => {
      fireEvent.changeText(getByLabelText('Search for venues'), 'soft');
    });

    // Wait for results to render.
    await waitFor(() => {
      expect(getByTestId('venue-card-Free Place')).toBeTruthy();
    });

    // Null-price-range venue must NOT appear (never assume free).
    expect(queryByTestId('venue-card-Null Price')).toBeNull();
    // Paid venue must NOT appear.
    expect(queryByTestId('venue-card-Paid Place')).toBeNull();
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

    const { getByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(getByTestId('venue-card-Bouncy Castle')).toBeTruthy();
    });
  });

  it('excludes park venue from rainy-day results', async () => {
    const park = makeVenue({
      name: 'Local Park',
      category: { id: 'cat-park', name: 'Park', slug: 'park', icon: '', color: '' },
    });
    mockNearbyVenues = [park];

    const { getByTestId, queryByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByTestId('venue-card-Local Park')).toBeNull();
    });
  });

  it('excludes venue with no category from rainy-day results', async () => {
    const unknownCat = makeVenue({
      name: 'Mystery Venue',
      category: undefined,
    });
    mockNearbyVenues = [unknownCat];

    const { getByTestId, queryByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByTestId('venue-card-Mystery Venue')).toBeNull();
    });
  });

  it('excludes venue with farm category (mixed/null) from rainy-day results', async () => {
    const farm = makeVenue({
      name: 'Farm World',
      category: { id: 'cat-farm', name: 'Farm', slug: 'farm', icon: '', color: '' },
    });
    mockNearbyVenues = [farm];

    const { getByTestId, queryByTestId } = await renderSearch();

    await act(async () => {
      fireEvent.press(getByTestId('chip-☔ Rainy day ideas'));
    });

    await waitFor(() => {
      expect(queryByTestId('venue-card-Farm World')).toBeNull();
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
