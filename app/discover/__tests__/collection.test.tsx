/**
 * Tests for app/discover/[collection].tsx — the reusable Discover collection
 * results page.
 *
 * Focus: the fix for the ONLY production call site of the shared
 * `VenueCard` (components/ui/VenueCard.tsx). That card used to hardcode the
 * legacy light-only `Colors` export, so navigating here from Home's editorial
 * hero (one tap: openHeroCollection -> /discover/[collection]) rendered a
 * white "paper" card with dark-on-light text even though the app's v2
 * default theme is dark. This suite proves:
 *   1. In dark mode, the rendered VenueCard uses the v2 DARK surface — no
 *      legacy white/cream card leaks through.
 *   2. Rating / distance / category / open-status stay honest (no
 *      fabrication) — unaffected by the theming fix.
 *   3. Tapping a card still navigates to Venue Detail.
 *
 * Curation/predicate correctness is lib/collections' own concern (not
 * re-tested here) — this collection's `match` is a trivial stub.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import CollectionScreen from '../[collection]';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { Venue } from '@/types';

// ── expo-router ──────────────────────────────────────────────────────────
const mockPush = jest.fn();
const mockBack = jest.fn();
// Mutable so a single test (the "unknown collection key" background test
// below) can point this at a key `getCollection` resolves to null, without
// a second copy of this whole mock block.
const mockCollectionParam = jest.fn(() => ({ collection: 'test-collection' }));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => mockCollectionParam(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

// ── ThemedBackground — not stubbed to null; give it a recognisable testID
// stand-in (same pattern as app/(tabs)/__tests__/discover.test.tsx) so we can
// assert it's actually mounted in every render branch, without pulling in
// the real weather/location dependency graph.
jest.mock('@/components/ui/ThemedBackground', () => {
  const { View } = require('react-native');
  return {
    ThemedBackground: () => <View testID="themed-background" />,
  };
});

jest.mock('expo-linear-gradient', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

// ── Location consent — granted, so CollectionResults (and VenueCard) render ─
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => ({ status: 'granted' }),
}));
jest.mock('@/hooks/location', () => ({
  useLocation: () => ({ coords: { latitude: 51.5, longitude: -0.1 }, isLoading: false, error: null }),
}));

// ── Collection def — trivial stub, real curation logic is lib/collections' own concern ─
jest.mock('@/lib/collections', () => ({
  getCollection: (key: string | undefined) =>
    key === 'test-collection'
      ? {
          key: 'test-collection',
          emoji: '🌧',
          title: 'Rainy Day Ideas',
          tagline: 'Cosy indoor spots',
          gradient: ['#EAF3FF', '#D8E9FF'],
          accent: '#2E6FD6',
          illustrationKey: 'rain',
          pillSlugs: [],
          match: () => true,
        }
      : null,
}));

// ── Venues — one honest fixture with NO rating/distance and one WITH both,
// so we can assert the honest fallbacks in both directions.
function venueFixture(overrides: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    category: { id: 'c1', name: 'Soft Play', slug: 'soft-play', icon: 'play', color: '#000' },
    category_id: 'c1',
    min_age: 0,
    max_age: 5,
    review_count: 0,
    average_rating: 0,
    distance_km: undefined,
    cover_photo_url: null,
    featured_until: null,
    opening_hours: [],
    photos: [],
    facilities: [],
    ...overrides,
  } as unknown as Venue;
}

const venues: Venue[] = [
  venueFixture({ id: 'v1', name: 'Rainy Barn (no reviews yet, no distance)' }),
  venueFixture({
    id: 'v2',
    name: 'Splash Zone (rated + distance)',
    review_count: 12,
    average_rating: 4.5,
    distance_km: 1.2,
  }),
];

const mockUseNearbyVenues = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...args),
  useCategories: () => ({ data: [], isLoading: false }),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function collectCardRoots(node: JsonNode, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node) return out;
  const style = node.props?.style ? (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>) : null;
  // VenueCard's root Pressable style has this distinctive shape: a card
  // radius + row layout + border — unique enough in this tree to identify it.
  if (style && style.flexDirection === 'row' && style.borderRadius === 24 && style.padding === 10) {
    out.push(style);
  }
  (node.children ?? []).forEach((child) => collectCardRoots(child, out));
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAppearanceStore.setState({ mode: 'dark' });
  mockUseNearbyVenues.mockReturnValue({ data: venues, isLoading: false, error: null });
});

describe('Collection page — VenueCard no longer renders a legacy white card in dark mode', () => {
  it('every rendered VenueCard uses the v2 DARK surface (#17171F), not the legacy white paper (#FFFFFF)', () => {
    const tree = render(<CollectionScreen />, { wrapper: makeWrapper() }).toJSON() as JsonNode;
    const cards = collectCardRoots(tree);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.backgroundColor).toBe('#17171F');
      expect(card.backgroundColor).not.toBe('#FFFFFF');
    }
  });

  it('still renders the correct DARK surface if resolved to light mode (theme still respected, not hardcoded)', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const tree = render(<CollectionScreen />, { wrapper: makeWrapper() }).toJSON() as JsonNode;
    const cards = collectCardRoots(tree);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.backgroundColor).toBe('#FFFFFF');
    }
  });
});

describe('Collection page — VenueCard honesty preserved', () => {
  it('shows "No reviews yet" for a venue with zero reviews (never fabricates a rating)', () => {
    const { getByText } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    expect(getByText('No reviews yet')).toBeTruthy();
  });

  it('shows the real rating + review count for a venue that has them', () => {
    const { getByText } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    expect(getByText('4.5')).toBeTruthy();
    expect(getByText('(12)')).toBeTruthy();
  });

  it('shows a distance chip only for the venue with a real distance_km (1.2km -> 0.7mi)', () => {
    const { getByText, queryAllByText } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    // formatDistance: 1.2km is not <1km, so it converts to miles: 1.2 * 0.621371 ≈ 0.7mi
    expect(getByText('0.7mi')).toBeTruthy();
    // exactly one distance chip should exist — the no-distance venue renders none
    expect(queryAllByText(/mi$/)).toHaveLength(1);
  });

  it('shows the real category label honestly', () => {
    const { getAllByText } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    expect(getAllByText('SOFT PLAY').length).toBeGreaterThan(0);
  });
});

describe('Collection page — navigation preserved', () => {
  it('tapping a VenueCard still navigates to its Venue Detail page', () => {
    const { getByText } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByText('Splash Zone (rated + distance)'));
    expect(mockPush).toHaveBeenCalledWith('/venue/v2');
  });
});

// ── Shared v2 atmosphere (Phase 2 light-theme fix) ──────────────────────────
// Regression guard: this route used to mount a bare
// `<SafeAreaView backgroundColor: tokens.bg>` with no background layer at
// all, painting an opaque cool-grey slab in light mode instead of the warm
// atmosphere every other screen shows. Every render branch — found
// collection (with its 'granted' consent sub-branch), and the unknown-key
// guard — must mount <ThemedBackground/>.
describe('Collection page — shared v2 atmosphere mounted in every render branch', () => {
  it('mounts the shared <ThemedBackground/> for a resolved collection (consent granted)', () => {
    const { getByTestId } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    expect(getByTestId('themed-background')).toBeTruthy();
  });

  it('mounts the shared <ThemedBackground/> for an unknown collection key (the !def guard branch)', () => {
    mockCollectionParam.mockReturnValueOnce({ collection: 'not-a-real-collection' });
    const { getByTestId, getByText } = render(<CollectionScreen />, { wrapper: makeWrapper() });
    // Confirms we actually hit the guard branch, not the normal one.
    expect(getByText('Collection not found')).toBeTruthy();
    expect(getByTestId('themed-background')).toBeTruthy();
  });
});
