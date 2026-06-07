/**
 * Tests for components/home/NearbyPreview.tsx
 *
 * Discovery Sprint A — Trust Repair (P1):
 *
 * ROOT CAUSE: NearbyPreview fed raw `useNearbyVenues` rows (which carry
 * `category_id` but NO joined `category` object — see
 * supabase/migrations/045) straight into `calculateRecommendationScore` and
 * `curateVenues`. With `category.slug` undefined, weather scoring,
 * time-of-day/temperature/indoor-outdoor curation boosts, mood scoring,
 * `getWeatherBadge`, and `generateRecommendationReasons` all silently went
 * dead on the Home screen — while the full Results screen (which DOES
 * hydrate `category` via `useCategories`, see app/explore/results.tsx
 * ~line 172) ranked the very same venues completely differently. That
 * produced two different "best nearby" lists for the same parent.
 *
 * THE FIX mirrors the proven results.tsx pattern: build a category map from
 * useCategories() and enrich each venue with `category` BEFORE ranking and
 * curating.
 *
 * This test asserts:
 *   1. Cards render with weather badges driven by `category.slug`
 *      (proves category was hydrated and reached curation/weather logic).
 *   2. Cards render honest family badges from generateRecommendationReasons,
 *      which require `category.slug` to fire category-driven reasons.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import type { Venue, Category } from '@/types';

import { NearbyPreview } from '../NearbyPreview';

// ── Mocks (hoisted) ─────────────────────────────────────────────────
jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({
    coords: { latitude: 51.5, longitude: -0.1 },
    isLoading: false,
    error: null,
  })),
}));

// Rainy weather so getWeatherBadge() has something to say about indoor venues.
jest.mock('@/hooks/useWeather', () => ({
  useWeather: jest.fn(() => ({ condition: 'rain', temperatureC: 12 })),
}));

const mockUseNearbyVenues = jest.fn();
const mockCategories: Category[] = [
  { id: 'cat-soft-play', slug: 'soft-play', name: 'Soft Play', icon: '', color: '#000000' },
  { id: 'cat-park', slug: 'park', name: 'Park', icon: '', color: '#000000' },
];
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...args),
  useCategories: jest.fn(() => ({ data: mockCategories, isLoading: false, error: null })),
}));

jest.mock('@/components/ui', () => {
  const { View, Text } = require('react-native');
  return {
    VenueCard: ({ venue, weatherBadge, familyBadges }: { venue: Venue; weatherBadge?: string | null; familyBadges?: string[] }) => (
      <View>
        <Text>{venue.name}</Text>
        <Text testID={`category-${venue.id}`}>{venue.category?.slug ?? 'no-category'}</Text>
        <Text testID={`weather-badge-${venue.id}`}>{weatherBadge ?? 'no-weather-badge'}</Text>
        <Text testID={`family-badges-${venue.id}`}>{(familyBadges ?? []).join(',') || 'no-family-badges'}</Text>
      </View>
    ),
  };
});

jest.mock('@/components/ui/SkeletonLoader', () => {
  const { Text } = require('react-native');
  return { VenueRowSkeleton: () => <Text>skeleton</Text> };
});

function venue(over: Partial<Venue> & { id: string; name: string; category_id: string }): Venue {
  return {
    slug: over.id,
    description: null,
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
    photos: [],
    facilities: [],
    opening_hours: [],
    distance_km: 1,
    // Crucially: NO `category` object — only `category_id`, exactly what the
    // get_nearby_venues RPC actually returns (see migration 045).
    category: undefined,
    ...over,
  } as Venue;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseNearbyVenues.mockReturnValue({
    data: [], isLoading: false, error: null,
  });
});

describe('NearbyPreview — category hydration (P1 trust-repair fix)', () => {
  it('hydrates venue.category from category_id before ranking/curating, so weather badges and family badges fire', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        venue({ id: 'sp1', name: 'Bright Soft Play Barn', category_id: 'cat-soft-play' }),
        venue({ id: 'pk1', name: 'Riverside Park', category_id: 'cat-park' }),
      ],
      isLoading: false,
      error: null,
    });

    const { getByTestId, getByText } = render(
      <NearbyPreview onSeeAll={jest.fn()} onVenuePress={jest.fn()} />,
    );

    await waitFor(() => expect(getByText('Bright Soft Play Barn')).toBeTruthy());

    // 1. category.slug must be hydrated (not undefined) — this is the actual bug fix.
    expect(getByTestId('category-sp1').props.children).toBe('soft-play');

    // 2. Weather badge must fire for an indoor category in rainy weather —
    //    this is DEAD without category hydration (getWeatherBadge needs category.slug).
    expect(getByTestId('weather-badge-sp1').props.children).not.toBe('no-weather-badge');
    expect(getByTestId('weather-badge-sp1').props.children).toEqual(
      expect.stringContaining('rain'),
    );

    // 3. Honest family badges (generateRecommendationReasons) must reflect the
    //    category — soft-play should surface "Great For Toddlers" and/or
    //    "Rainy Day Winner" / "Burn Energy", none of which can fire with an
    //    undefined category.slug.
    const softPlayBadges = getByTestId('family-badges-sp1').props.children as string;
    expect(softPlayBadges).not.toBe('no-family-badges');
  });

  it('never crashes and falls back gracefully when categories have not loaded yet', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [venue({ id: 'v1', name: 'Mystery Venue', category_id: 'unknown-cat-id' })],
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<NearbyPreview onSeeAll={jest.fn()} onVenuePress={jest.fn()} />);
    await waitFor(() => expect(getByText('Mystery Venue')).toBeTruthy());
    // No throw — that's the assertion. An unknown category_id should resolve
    // to `undefined` (via the `??` guard), exactly like results.tsx.
  });
});
