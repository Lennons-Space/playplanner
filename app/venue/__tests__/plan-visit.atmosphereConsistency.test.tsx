/**
 * Cross-screen atmosphere consistency — Home, Venue Detail, and Plan Visit
 * must all resolve to the SAME v2 background atmosphere for the same weather
 * condition.
 *
 * This is guaranteed by construction: all three screens mount the same
 * <V2Background/> component, which reads the identical
 * `useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude)` React
 * Query cache key (one shared fetch, never a per-screen re-fetch) and feeds
 * the result through the same pure `resolveAtmosphere()` (lib/weatherTheme.ts).
 * This test mocks useWeather once and asserts the SAME atmosphere-tagged
 * animation layer (`v2-weather-motion-<atmosphere>`) renders on all three
 * screens — i.e. nothing re-derives or re-computes the atmosphere per screen.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import HomeScreen from '../../(tabs)/index';
import VenueDetailScreen from '../[id]';
import PlanVisitScreen from '../plan-visit';
import type { Venue } from '@/types';

// ── expo / RN shims ─────────────────────────────────────────────────────────
jest.mock('expo-linear-gradient', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'v1', venueId: 'v1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 88,
}));

// ── auth (Home reads useProfile; Venue Detail / Plan Visit read useUser) ────
jest.mock('@/hooks/useAuth', () => ({
  useProfile: jest.fn(() => ({ full_name: 'Liam Evanson' })),
  useUser: jest.fn(() => null),
}));

// ── location / consent — Home only; Venue Detail & Plan Visit never import
// these directly. A single shared mock lets us assert useLocation() is never
// called while rendering the two non-Home screens. ──────────────────────────
const mockUseLocation = jest.fn(() => ({
  coords: null,
  hasPermission: false,
  isLoading: false,
  error: null,
}));
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => ({ status: 'undecided', grant: jest.fn(), decline: jest.fn() }),
}));
jest.mock('@/hooks/location', () => ({
  useAreaLabel: jest.fn(() => null),
  useLocation: (...args: unknown[]) => mockUseLocation(...(args as [])),
}));

// ── the shared weather fetch under test ─────────────────────────────────────
const mockUseWeather = jest.fn();
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

// ── venues (Home's list hooks + Venue Detail/Plan Visit's single-venue hook) ─
const venueFixture = {
  id: 'v1',
  name: 'Bright Soft Play Barn',
  description: 'A lovely indoor play barn.',
  address_line1: '1 Test Street',
  address_line2: null,
  city: 'London',
  postcode: 'SW1A 1AA',
  latitude: 51.5,
  longitude: -0.1,
  price_range: '££',
  min_age: 0,
  max_age: 5,
  review_count: 12,
  average_rating: 4.6,
  photos: [],
  facilities: [],
  opening_hours: [],
  distance_km: 1.2,
  category: { id: 'c1', name: 'Soft Play', slug: 'soft-play', icon: 'play', color: '#000' },
} as unknown as Venue;

const mockUseVenue = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({ data: [], isLoading: false, error: null })),
  useCategories: jest.fn(() => ({ data: [] })),
  useVenue: (...args: unknown[]) => mockUseVenue(...(args as [])),
}));

jest.mock('@/hooks/useFavourites', () => ({
  useSavedVenueIds: jest.fn(() => ({ savedIds: new Set(), isLoading: false })),
  useToggleFavourite: jest.fn(() => ({ mutate: jest.fn() })),
}));

jest.mock('@/hooks/useReviews', () => ({
  useVenueReviews: jest.fn(() => ({ data: [], isLoading: false })),
  useMyReview: jest.fn(() => ({ data: null })),
}));

jest.mock('@/hooks/useVenueReport', () => ({
  useReportVenue: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

jest.mock('@/lib/recentlyViewed', () => ({
  addRecentlyViewed: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    })),
  },
}));

jest.mock('@/components/reviews/ReviewCard', () => ({ ReviewCard: () => null }));
jest.mock('@/components/venue/VenuePhotoUpload', () => ({ VenuePhotoUpload: () => null }));
jest.mock('@/components/venue/VenueContactRow', () => ({ VenueContactRow: () => null }));
jest.mock('@/components/venue/FacilityChips', () => ({ FacilityChips: () => null }));
jest.mock('@/components/venues/RecommendationExplanation', () => ({
  RecommendationExplanation: () => null,
}));

// ── helper: find a testID anywhere in a rendered tree (V2Background /
// V2WeatherMotion are hidden from the a11y tree, which also hides them from
// testing-library's default queries — see V2Background.test.tsx). ──────────
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
  mockUseVenue.mockReturnValue({ data: venueFixture, isLoading: false, error: null });
  mockUseLocation.mockReturnValue({ coords: null, hasPermission: false, isLoading: false, error: null });
});

describe('Shared v2 atmosphere — Home / Venue Detail / Plan Visit', () => {
  // 'clear' is deliberately excluded here — it is the one condition whose
  // resolved atmosphere (sunny vs night) depends on the real wall-clock time
  // via resolveAtmosphere()'s isNightNow() default, which would make this
  // test flaky depending on when/where it runs. 'overcast'/'rain'/'snow' all
  // resolve the same atmosphere regardless of time of day, which is exactly
  // what this test needs to isolate: that all three SCREENS agree with each
  // other, not a specific time-of-day behaviour (covered separately by
  // lib/weatherTheme.ts's own resolveAtmosphere tests).
  it.each([
    ['overcast' as const, 'v2-weather-motion-cloudy'],
    ['rain' as const, 'v2-weather-motion-rain'],
    ['snow' as const, 'v2-weather-motion-snow'],
  ])('resolves the SAME atmosphere (condition=%s → %s) on all three screens', (condition, expectedMotionTestId) => {
    mockUseWeather.mockReturnValue({
      condition,
      temperatureC: 10,
      precipProbabilityPct: 0,
      emoji: '',
      label: '',
    });

    const wrapper = makeWrapper();
    const homeTree = render(<HomeScreen />, { wrapper }).toJSON();
    const venueTree = render(<VenueDetailScreen />, { wrapper }).toJSON();
    const planTree = render(<PlanVisitScreen />, { wrapper }).toJSON();

    // All three mount the shared background layer...
    expect(containsTestID(homeTree, 'v2-background')).toBe(true);
    expect(containsTestID(venueTree, 'v2-background')).toBe(true);
    expect(containsTestID(planTree, 'v2-background')).toBe(true);

    // ...and all three resolve to the IDENTICAL atmosphere for the same
    // mocked weather condition (not recomputed differently per screen).
    expect(containsTestID(homeTree, expectedMotionTestId)).toBe(true);
    expect(containsTestID(venueTree, expectedMotionTestId)).toBe(true);
    expect(containsTestID(planTree, expectedMotionTestId)).toBe(true);
  });

  it('never calls useLocation() from Venue Detail or Plan Visit (only Home may, post-consent)', () => {
    mockUseWeather.mockReturnValue(null);
    const wrapper = makeWrapper();
    render(<VenueDetailScreen />, { wrapper });
    render(<PlanVisitScreen />, { wrapper });
    expect(mockUseLocation).not.toHaveBeenCalled();
  });
});
