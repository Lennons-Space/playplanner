/**
 * Background-consistency regression test for the venue detail screen
 * (app/venue/[id].tsx).
 *
 * Home already renders the animated v2 atmosphere (<V2Background/>). This
 * screen previously painted a flat opaque `T.bg` fill instead, so the
 * atmosphere visibly "cut off" when a parent navigated from Home into a
 * venue. This test guards that the shared <V2Background/> is now mounted
 * here too, and that nothing about the existing sticky-bar padding /
 * Directions-with-name behaviour regressed.
 *
 * Heavy child components (ReviewCard, FacilityChips, VenueContactRow,
 * RecommendationExplanation, VenuePhotoUpload) are stubbed out — they are
 * covered by their own dedicated test suites and pull in their own
 * hooks/network concerns that are irrelevant to a background-layer test.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import VenueDetailScreen from '../[id]';
import { useThemeStore } from '@/store/themeStore';
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
  useLocalSearchParams: () => ({ id: 'v1' }),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// ── auth / hooks used directly by the screen ────────────────────────────────
jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(() => null),
}));

const venueFixture = {
  id: 'v1',
  name: 'Bright Soft Play Barn',
  slug: 'bright-soft-play-barn',
  description: 'A lovely indoor play barn.',
  address_line1: '1 Test Street',
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
  price_range: '££',
  min_age: 0,
  max_age: 5,
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
  review_count: 12,
  average_rating: 4.6,
  photos: [],
  facilities: [],
  opening_hours: [],
  distance_km: 1.2,
  category: { id: 'c1', name: 'Soft Play', slug: 'soft-play', icon: 'play', color: '#000' },
  image_url: null,
  image_source: null,
  image_attribution: null,
  image_license: null,
  image_is_exact: null,
} as unknown as Venue;

const mockUseVenue = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useVenue: (...args: unknown[]) => mockUseVenue(...(args as [])),
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

// ── heavy child components — covered by their own test suites ──────────────
jest.mock('@/components/reviews/ReviewCard', () => ({ ReviewCard: () => null }));
jest.mock('@/components/venue/VenuePhotoUpload', () => ({ VenuePhotoUpload: () => null }));
jest.mock('@/components/venue/VenueContactRow', () => ({ VenueContactRow: () => null }));
jest.mock('@/components/venue/FacilityChips', () => ({ FacilityChips: () => null }));
jest.mock('@/components/venues/RecommendationExplanation', () => ({
  RecommendationExplanation: () => null,
}));

// V2Background reads the same coarse weather fetch Home uses — default it to
// "no data yet" (null) so the atmosphere falls back deterministically without
// pulling in a real network call.
const mockUseWeather = jest.fn(() => null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

// Guards that the shared background path never triggers the OS location
// prompt — venue/[id].tsx has no direct import of this hook, but this proves
// the background it now mounts doesn't introduce one either.
const mockUseLocation = jest.fn();
jest.mock('@/hooks/location', () => ({
  useLocation: (...args: unknown[]) => mockUseLocation(...(args as [])),
}));

// ── helper: find a testID anywhere in a rendered tree ───────────────────────
// V2Background is intentionally hidden from the accessibility tree
// (accessibilityElementsHidden / importantForAccessibility), which also
// excludes it from testing-library's default queries (see
// components/ui/__tests__/V2Background.test.tsx) — so walk toJSON() directly.
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function containsTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => containsTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return containsTestID(node.children ?? null, testID);
}

// Finds the first node whose flattened style matches the Venue Detail
// "sheet" wrapper's distinctive, unique-in-this-tree combination of
// properties (20px top radius + −20 overlap) — a stand-in for a testID
// since the sheet <View> has none. Returns the flattened style object, or
// null if no matching node is found (which itself is a useful failure mode:
// the assertion below will fail loudly rather than silently passing).
function findStyleByShape(
  node: JsonNode | JsonNode[],
  predicate: (style: Record<string, unknown>) => boolean
): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findStyleByShape(n, predicate);
      if (found) return found;
    }
    return null;
  }
  const flattened = node.props?.style
    ? (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>)
    : null;
  if (flattened && predicate(flattened)) return flattened;
  return findStyleByShape(node.children ?? null, predicate);
}

const isSheetStyle = (style: Record<string, unknown>) =>
  style.borderTopLeftRadius === 20 && style.marginTop === -20;

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
  mockUseWeather.mockReturnValue(null);
  // jest.setup.js's global useColorScheme mock defaults to 'dark', and every
  // existing test in this file relies on that implicit default — reset the
  // theme store explicitly each run so the new light-mode tests below
  // (which set 'light') can never leak into a later 'dark'-assuming test.
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('Venue Detail — shared v2 background', () => {
  it('mounts the shared <V2Background/> behind the screen content', () => {
    const tree = render(<VenueDetailScreen />, { wrapper: makeWrapper() }).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('never calls useLocation() from the background path', () => {
    render(<VenueDetailScreen />, { wrapper: makeWrapper() });
    expect(mockUseLocation).not.toHaveBeenCalled();
  });

  it('still renders the venue name and core content (screen not broken)', () => {
    const { getByText } = render(<VenueDetailScreen />, { wrapper: makeWrapper() });
    expect(getByText('Bright Soft Play Barn')).toBeTruthy();
  });

  it('still renders the sticky Directions + Plan a visit bar', () => {
    const { getByLabelText } = render(<VenueDetailScreen />, { wrapper: makeWrapper() });
    expect(getByLabelText('Get directions to this venue')).toBeTruthy();
    expect(getByLabelText('Plan a visit to this venue')).toBeTruthy();
  });

  // Regression guard for the exact bug this file was created for: the sheet
  // wrapping every content section below the hero must be translucent, not
  // an opaque fill (T.surface's opaque hex) — otherwise it fully buries the
  // <V2Background/> mounted at the screen root, even though that mount is
  // architecturally correct.
  it('renders the content sheet with a translucent (not opaque) background', () => {
    const tree = render(<VenueDetailScreen />, { wrapper: makeWrapper() }).toJSON();
    const sheetStyle = findStyleByShape(tree, isSheetStyle);
    expect(sheetStyle).not.toBeNull();
    const bg = sheetStyle!.backgroundColor as string;
    expect(bg).toMatch(/^rgba\(/);
    const alpha = Number(bg.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)?.[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe('Venue Detail — error state shares the v2 background', () => {
  it('mounts the shared <V2Background/> behind the error state too', () => {
    mockUseVenue.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Network request failed') });
    const tree = render(<VenueDetailScreen />, { wrapper: makeWrapper() }).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('still renders the error message and "Go back" affordance (screen not broken)', () => {
    mockUseVenue.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Network request failed') });
    const { getByText } = render(<VenueDetailScreen />, { wrapper: makeWrapper() });
    expect(getByText('Could not load venue. Check your connection.')).toBeTruthy();
    expect(getByText('Go back')).toBeTruthy();
  });
});

// ── statTile / infoCard "island card" mode-aware fill (Phase 2 light-theme
// fix) ───────────────────────────────────────────────────────────────────
// Regression guard for the second Phase 2 defect: statTile/infoCard/
// hoursCard/facilityPill/railPhoto used an opaque `T.bg` fill, which in dark
// mode (#0C0C11) reads as an intentional near-black island but in light mode
// (#F1F0F4) painted a cold grey block on top of the warm translucent sheet.
// Only statTile and infoCard render unconditionally for this fixture
// (facilityPill/railPhoto/hoursCard need non-empty facilities/photos/
// opening_hours, out of scope for this background-only suite) — they share
// the exact same `isDark ? T.bg : 'rgba(255,255,255,0.72)'` ternary in
// app/venue/[id].tsx's createStyles, verified by direct source read.
const isStatTileStyle = (style: Record<string, unknown>) =>
  style.borderRadius === 13 && style.paddingVertical === 11 && style.alignItems === 'center';
const isInfoCardStyle = (style: Record<string, unknown>) =>
  style.borderRadius === 14 && style.marginHorizontal === 16 && style.overflow === 'hidden';

describe('Venue Detail — island cards (statTile/infoCard) mode-aware fill', () => {
  it('LIGHT mode: statTile and infoCard use the translucent warm-white fill, not opaque cold grey', () => {
    useThemeStore.setState({ preference: 'light', hasHydrated: true });
    const tree = render(<VenueDetailScreen />, { wrapper: makeWrapper() }).toJSON();
    const statTile = findStyleByShape(tree, isStatTileStyle);
    const infoCard = findStyleByShape(tree, isInfoCardStyle);
    expect(statTile).not.toBeNull();
    expect(infoCard).not.toBeNull();
    expect(statTile!.backgroundColor).toBe('rgba(255,255,255,0.72)');
    expect(infoCard!.backgroundColor).toBe('rgba(255,255,255,0.72)');
    // Never the old opaque light T.bg (#F1F0F4) — that was the bug.
    expect(statTile!.backgroundColor).not.toBe('#F1F0F4');
    expect(infoCard!.backgroundColor).not.toBe('#F1F0F4');
  });

  it('DARK mode: statTile and infoCard stay byte-identical to the pre-fix opaque T.bg (#0C0C11)', () => {
    useThemeStore.setState({ preference: 'dark', hasHydrated: true });
    const tree = render(<VenueDetailScreen />, { wrapper: makeWrapper() }).toJSON();
    const statTile = findStyleByShape(tree, isStatTileStyle);
    const infoCard = findStyleByShape(tree, isInfoCardStyle);
    expect(statTile).not.toBeNull();
    expect(infoCard).not.toBeNull();
    expect(statTile!.backgroundColor).toBe('#0C0C11');
    expect(infoCard!.backgroundColor).toBe('#0C0C11');
  });
});
