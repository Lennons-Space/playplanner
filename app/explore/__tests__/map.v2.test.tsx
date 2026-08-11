/**
 * v2 dark Map screen tests (app/explore/map.tsx — Step 4 reskin).
 *
 * Covers what the reskin added on top of the logic the main map.test.tsx
 * suite already guards: the shared <V2Background/> mounts behind both the
 * map feed and the consent state, the dark consent variant keeps the exact
 * consent labels, and the new AreaVenueCard renders honest real-data fields
 * (reviews line, ages only when the venue has age data, RPC distance) and
 * navigates to Venue Detail.
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/store/authStore';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import ExploreScreen from '../map';
import type { Venue } from '@/types';
import type { WeatherState } from '@/lib/weather';

// ─── Module mocks (same surface as map.test.tsx) ────────────────────────────

// authStore: ExploreScreen's default export is wrapped in RequireSession (see
// components/auth/RequireSession.tsx) — default to an authenticated, settled
// session so this file's existing behaviour tests are unaffected. Guard
// behaviour itself is covered by map.authGuard.test.tsx.
jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
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
  useNearbyVenues: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useCategories: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
}));

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
  // Forward only showsUserLocation onto the mock View so tests can assert the
  // "you are here" marker behaviour without a real native map. children are
  // preserved so markers still render. (Spreading ALL native map props onto a
  // host View crashes the test renderer, so we forward just this one.)
  return function MockClusterMapView({
    children,
    showsUserLocation,
  }: {
    children?: React.ReactNode;
    showsUserLocation?: boolean;
  }) {
    return (
      <View testID="cluster-map-view" showsUserLocation={showsUserLocation}>
        {children}
      </View>
    );
  };
});

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  // Forward onPress so a test can simulate tapping a coloured pin → the
  // selected-venue peek card (fireEvent.press invokes the onPress prop).
  return {
    Marker: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
      <View testID="map-marker" onPress={onPress}>{children}</View>,
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
  // See map.test.tsx for why this no-op mock is sufficient here.
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
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock('@/store/mapStore', () => ({
  useMapStore: jest.fn(() => ({
    pendingPostcode: null,
    setPendingPostcode: jest.fn(),
  })),
}));

// V2Background reads the same coarse weather fetch every v2 screen uses.
const mockUseWeather = jest.fn<WeatherState | null, unknown[]>(() => null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

// ─── Typed mock helpers / fixtures ──────────────────────────────────────────
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockUseNearbyVenues = useNearbyVenues as jest.MockedFunction<
  typeof useNearbyVenues
>;
const mockUseCategories = useCategories as jest.MockedFunction<typeof useCategories>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

/** Drives RequireSession to its authenticated, settled-loading branch. */
function mockAuthenticatedSession() {
  mockUseAuthStore.mockImplementation((selector) =>
    selector({
      session: { access_token: 'tok', user: { id: 'user-test-id' } },
      isLoading: false,
    } as unknown as AuthStoreState),
  );
}

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'venue-1',
    name: 'Sunshine Soft Play',
    slug: null,
    description: null,
    category_id: null,
    category: { id: 'cat-1', name: 'Soft Play', icon: '🏀', color: '#8E6BD8', slug: 'soft-play' },
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
  } as Venue;
}

// ── helper: find a testID anywhere in a rendered tree (V2Background is
// hidden from the a11y tree — see components/ui/__tests__/V2Background.test.tsx). ──
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function containsTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => containsTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return containsTestID(node.children ?? null, testID);
}

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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticatedSession();
  mockGetItemAsync.mockResolvedValue(null);
  mockUseWeather.mockReturnValue(null);
  mockUseNearbyVenues.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useNearbyVenues>);
  mockUseCategories.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCategories>);
});

describe('Map v2 — shared background atmosphere', () => {
  it('mounts <V2Background/> behind the map feed once consent is stored', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('Map view')).toBeTruthy());
    expect(containsTestID(screen.toJSON(), 'v2-background')).toBe(true);
  });

  it('mounts <V2Background/> behind the consent state, with consent labels unchanged', async () => {
    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('Allow location access')).toBeTruthy());
    // Dark variant must keep the exact consent labels + copy.
    expect(screen.getByLabelText('Browse without location')).toBeTruthy();
    expect(screen.getByText('Find venues near you?')).toBeTruthy();
    expect(containsTestID(screen.toJSON(), 'v2-background')).toBe(true);
  });
});

describe('Map v2 — AreaVenueCard honest data', () => {
  it('shows the real reviews line, and "No reviews yet" when there are none', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({ id: 'v-rated', name: 'Rated Barn', review_count: 12, average_rating: 4.6, distance_km: 3.2 }),
        makeVenue({ id: 'v-unrated', name: 'Unrated Farm', review_count: 0, average_rating: 0 }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText('Rated Barn')).toBeTruthy());
    expect(screen.getByText('★ 4.6 · 12 reviews')).toBeTruthy();
    expect(screen.getByText('No reviews yet')).toBeTruthy();
    // Distance comes from the RPC's distance_km (3.2 km ≈ 2.0 mi) — shown
    // only for the venue that has it.
    expect(screen.getByText('2.0 mi')).toBeTruthy();
  });

  it('renders "Ages X–Y" only when the venue has real age data', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({ id: 'v-ages', name: 'Aged Venue', min_age: 2, max_age: 8 }),
        makeVenue({ id: 'v-noages', name: 'Ageless Venue', min_age: 0, max_age: 0 }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText('Aged Venue')).toBeTruthy());
    expect(screen.getByText('Ages 2–8')).toBeTruthy();
    expect(screen.queryByText(/Ages 0–0/)).toBeNull();
  });

  it('opens Venue Detail when a venue card is tapped', async () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      data: [makeVenue({ id: 'v-tap', name: 'Tappable Venue' })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('Tappable Venue')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Tappable Venue'));
    expect(router.push).toHaveBeenCalledWith('/venue/v-tap');
  });
});

// Phase 9 "weather-driven content consistency" fix (gap #2): AreaVenueCard's
// weatherBadge used to render as bare `Text` in the muted `T.label3` tone —
// no background, no glass treatment — while components/ui/VenueCard.tsx's
// weatherBadge already used a proper dark glass pill. These tests lock in
// that AreaVenueCard now uses the SAME pill (fixed dark scrim + white text),
// so the app has one weather-badge look, not two.
describe('Map v2 — AreaVenueCard weatherBadge glass-pill treatment (Phase 9 fix)', () => {
  it('renders the weatherBadge inside a dark glass pill, matching VenueCard.tsx', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseWeather.mockReturnValue({
      condition: 'clear',
      temperatureC: 22,
      precipProbabilityPct: 0,
      emoji: '☀️',
      label: 'Sunny',
    });
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({
          id: 'v-weather',
          name: 'Sunny Park',
          category: { id: 'cat-park', name: 'Park', icon: '🌳', color: '#4CAF50', slug: 'park' },
        }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    const badge = await waitFor(() => screen.getByText('☀️ Ideal today'));

    // Walk up to the pill View. `badge.parent` is RN's internal Text host
    // wrapper (not our JSX), so the actual <View> pill we render is the
    // grandparent — asserts the same fixed dark-scrim glass treatment
    // VenueCard.tsx uses, not the bare, backgroundless T.label3 text this
    // replaced.
    const pill = badge.parent?.parent;
    expect(pill?.type).toBe('View');
    expect(pill?.props?.style).toMatchObject({
      backgroundColor: 'rgba(20,28,38,0.72)',
    });
    expect(badge.props.style).toMatchObject({ color: '#FFFFFF' });
  });

  it('renders nothing for the weatherBadge slot when no weather-worthy condition applies', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseWeather.mockReturnValue({
      condition: 'overcast',
      temperatureC: 12,
      precipProbabilityPct: 0,
      emoji: '☁️',
      label: 'Overcast',
    });
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({
          id: 'v-neutral',
          name: 'Neutral Venue',
          category: { id: 'cat-soft-play', name: 'Soft Play', icon: '🏀', color: '#8E6BD8', slug: 'soft-play' },
        }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText('Neutral Venue')).toBeTruthy());
    // Overcast + soft-play gets no badge from getWeatherBadge — no pill, no text.
    expect(screen.queryByText(/Ideal today|Wet today|Great in rain|Dry inside|Safe inside|Check safety|Cosy pick|Check conditions|Good today/)).toBeNull();
  });
});

describe('Map v2 — user-location marker honours consent (product decision 2026-07-13)', () => {
  // The app centres on the user and shows a real "you are here" marker AFTER
  // consent. If location is declined it must show NO user marker (no fake dot)
  // and fall back to the London-wide view.
  it('shows the native user-location marker after consent is granted', async () => {
    mockGetItemAsync.mockResolvedValue('1'); // returning user, consent stored
    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('Map view')).toBeTruthy());
    // MapWithLocation renders with trackLocation → showsUserLocation = true.
    expect(screen.getByTestId('cluster-map-view').props.showsUserLocation).toBe(true);
  });

  it('does NOT show a user-location marker when location is declined (no fake "you are here")', async () => {
    // Start undecided → consent prompt → user declines → LocationFallbackMap.
    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('Browse without location')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Browse without location'));
    await waitFor(() => expect(screen.getByLabelText('Map view')).toBeTruthy());
    // LocationFallbackMap renders with trackLocation={false} → no user marker.
    expect(screen.getByTestId('cluster-map-view').props.showsUserLocation).toBe(false);
  });
});

describe('Map v2 — honest category labels + section heading', () => {
  it('resolves the flat category_id from the RPC to the REAL category name (Waterway Park → Park & Playground, not VENUE)', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    // get_nearby_venues returns a FLAT category_id ONLY — no nested object.
    mockUseNearbyVenues.mockReturnValue({
      data: [makeVenue({ id: 'v-water', name: 'Waterway Park', category: undefined, category_id: 'cat-park' })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);
    // useCategories supplies the real category row the id maps to.
    mockUseCategories.mockReturnValue({
      data: [{ id: 'cat-park', name: 'Park & Playground', slug: 'park-playground', icon: '🌳', color: '#5BC08A' }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCategories>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText('Waterway Park')).toBeTruthy());
    expect(screen.getByText('PARK & PLAYGROUND')).toBeTruthy();
    expect(screen.queryByText('VENUE')).toBeNull();
  });

  it('shows "VENUE" ONLY as a fallback when the category is genuinely absent (id has no match)', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      // category_id set but useCategories (default []) has no match → never fabricate.
      data: [makeVenue({ id: 'v-none', name: 'Mystery Place', category: undefined, category_id: 'cat-missing' })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText('Mystery Place')).toBeTruthy());
    expect(screen.getByText('VENUE')).toBeTruthy();
  });

  it('labels the section "Nearby places" with a count that matches the list shown (no "Open right now" mismatch)', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      data: [
        makeVenue({ id: 'v-a', name: 'Alpha Farm' }),
        makeVenue({ id: 'v-b', name: 'Bravo Park' }),
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText('Alpha Farm')).toBeTruthy());
    // Heading describes the data actually rendered (all nearby, not open-now).
    expect(screen.getByText('Nearby places')).toBeTruthy();
    expect(screen.queryByText('Open right now')).toBeNull();
    // Count reflects the 2 venues in the list.
    expect(screen.getByText(/2 places within \d+ miles?/)).toBeTruthy();
  });

  it('tapping a coloured marker opens the peek card with the REAL category (not "Venue"), no fabricated open status, closes, and opens Venue Detail', async () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    mockGetItemAsync.mockResolvedValue('1');
    // Flat category_id only (RPC shape) + no opening hours (so open status is unknown).
    mockUseNearbyVenues.mockReturnValue({
      data: [makeVenue({ id: 'v-water', name: 'Waterway Park', category: undefined, category_id: 'cat-park' })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);
    mockUseCategories.mockReturnValue({
      data: [{ id: 'cat-park', name: 'Park & Playground', slug: 'park-playground', icon: '🌳', color: '#5BC08A' }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCategories>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('Map view')).toBeTruthy());

    // No peek card until a marker is tapped.
    expect(screen.queryByText('View venue →')).toBeNull();

    // Tap the coloured pin.
    fireEvent.press(screen.getByTestId('map-marker'));

    // Peek card opens with the REAL category (mixed-case here, distinct from the
    // uppercase list-card badge) — never the generic "Venue".
    await waitFor(() => expect(screen.getByText('View venue →')).toBeTruthy());
    expect(screen.getByText('Park & Playground')).toBeTruthy();
    // No fabricated open/closed status when the venue has no opening hours.
    expect(screen.queryByText('Open now')).toBeNull();
    expect(screen.queryByText('Closed')).toBeNull();

    // "View venue" opens Venue Detail.
    fireEvent.press(screen.getByText('View venue →'));
    expect(router.push).toHaveBeenCalledWith('/venue/v-water');

    // Close dismisses the peek card. dismissVenue no-ops for ~150ms after a
    // marker tap (guard so the marker press can't bubble to the map background
    // and self-dismiss) — a human taps the X well after that, so wait it out.
    await new Promise((r) => setTimeout(r, 200));
    fireEvent.press(screen.getByLabelText('Close venue label'));
    await waitFor(() => expect(screen.queryByText('View venue →')).toBeNull());
  });

  it('the final nearby venue card can scroll clear of the tab bar (renders the last of many cards, honest data)', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      data: Array.from({ length: 12 }, (_, i) => makeVenue({ id: `v-${i}`, name: `Venue ${i}` })),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);
    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    // The last card is present in the scrollable feed (viewport ends above the
    // tab bar via marginBottom: tabSafeZone — asserted structurally below).
    await waitFor(() => expect(screen.getByText('Venue 11')).toBeTruthy());
  });
});

// ── Tab-safe bottom content spacing (source guard) ──────────────────────────
// The final nearby venue card must be able to scroll completely above the tab
// bar / Android navigation area. The map applies this the same accepted way as
// Home/Saved/Profile: the scroll VIEWPORT ends above the bar (marginBottom:
// tabSafeZone), and when there's no tab bar (stack route) the inner bottom
// padding adds the safe-area inset instead. A source guard protects both the
// nearby-feed ScrollView and the list-mode FlatList against a regression.
describe('Map v2 — tab-safe bottom content spacing (source guard)', () => {
  const source: string = fs.readFileSync(path.join(__dirname, '..', 'map.tsx'), 'utf8');

  it('computes tabSafeZone from the tab bar height / safe-area inset', () => {
    expect(source).toMatch(/tabSafeZone[\s\S]{0,80}Math\.max\(tabBarHeight, 52 \+ insets\.bottom\)/);
  });

  it('ends BOTH scroll viewports (nearby feed + list mode) above the tab bar via marginBottom: tabSafeZone', () => {
    const occurrences = source.split('marginBottom: tabSafeZone').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('adds the Android nav-bar inset to the inner bottom padding when there is no tab bar (stack route)', () => {
    const occurrences = source.split('tabSafeZone === 0 ? insets.bottom : 0').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('Map v2 — honest category labels + section heading (cont.)', () => {
  it('does NOT show a fabricated "0.0" rating in list mode for an unrated venue', async () => {
    mockGetItemAsync.mockResolvedValue('1');
    mockUseNearbyVenues.mockReturnValue({
      data: [makeVenue({ id: 'v-unrated', name: 'Unrated Barn', review_count: 0, average_rating: 0, category: { id: 'c-p', name: 'Park', icon: '🌳', color: '#5BC08A', slug: 'park' } })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useNearbyVenues>);

    const screen = render(<ExploreScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByLabelText('List view')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('List view'));
    await waitFor(() => expect(screen.getByText('Unrated Barn')).toBeTruthy());
    // No fake rating; the real category still shows (no "·" prefix when there
    // is no rating in front of it).
    expect(screen.queryByText('0.0')).toBeNull();
    expect(screen.getByText('Park')).toBeTruthy();
  });
});
