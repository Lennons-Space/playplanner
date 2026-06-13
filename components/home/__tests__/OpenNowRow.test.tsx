/**
 * Tests for components/home/OpenNowRow.tsx.
 * Covers: hidden when nothing open, only open venues shown, venues without
 * hours excluded, closing-time pill only when real, and distance sort order.
 *
 * Open status uses the REAL computeIsOpenNow/getOpenUntilLabel (single source
 * of truth) — fixtures use all-day 00:00–23:59 hours so "open now" is
 * deterministic regardless of when the test runs.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { Venue } from '@/types';
import { OpenNowRow } from '@/components/home/OpenNowRow';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(() => 'light'),
}));

jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({
    coords: { latitude: 51.5, longitude: -0.1 },
    isLoading: false,
    error: null,
  })),
}));

const mockUseNearbyVenues = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...args),
  useCategories: jest.fn(() => ({ data: [], isLoading: false, error: null })),
}));

// Surface name + openUntil in render order so we can assert presence + sort.
jest.mock('../ExploreCard', () => {
  const { Text } = require('react-native');
  return {
    ExploreCard: ({ venue, openUntil }: { venue: { name: string }; openUntil?: string | null }) => (
      <Text testID="open-card">{`${venue.name}::${openUntil ?? 'none'}`}</Text>
    ),
  };
});

type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const ALL_DAY = Array.from({ length: 7 }, (_, d) => ({
  id: `oh-${d}`,
  venue_id: 'v',
  day_of_week: d as Day,
  is_closed: false,
  opens_at: '00:00',
  closes_at: '23:59',
  notes: null,
}));

const CLOSED_ALL_DAY = Array.from({ length: 7 }, (_, d) => ({
  id: `ohc-${d}`,
  venue_id: 'v',
  day_of_week: d as Day,
  is_closed: true,
  opens_at: null,
  closes_at: null,
  notes: null,
}));

function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    slug: over.id,
    category_id: 'cat-1',
    category: undefined,
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
    opening_hours: ALL_DAY,
    distance_km: 1,
    ...over,
  } as Venue;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseNearbyVenues.mockReturnValue({ data: [], isLoading: false, error: null });
});

describe('OpenNowRow', () => {
  it('renders nothing when no venues are open', () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        venue({ id: 'closed', name: 'Closed Place', opening_hours: CLOSED_ALL_DAY }),
        venue({ id: 'nohours', name: 'No Hours Place', opening_hours: [] }),
      ],
      isLoading: false,
      error: null,
    });
    const { queryByText } = render(<OpenNowRow onVenuePress={jest.fn()} />);
    expect(queryByText('Open right now')).toBeNull();
  });

  it('shows only currently-open venues; excludes closed and hours-less ones', () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        venue({ id: 'open', name: 'Open Park', opening_hours: ALL_DAY, distance_km: 0.5 }),
        venue({ id: 'closed', name: 'Closed Place', opening_hours: CLOSED_ALL_DAY }),
        venue({ id: 'nohours', name: 'No Hours Place', opening_hours: [] }),
      ],
      isLoading: false,
      error: null,
    });
    const { getByText, queryByText, getAllByTestId } = render(<OpenNowRow onVenuePress={jest.fn()} />);
    expect(getByText('Open right now')).toBeTruthy();
    expect(getByText('Ready to go')).toBeTruthy();
    const cards = getAllByTestId('open-card').map((n) => n.props.children as string);
    expect(cards).toEqual(['Open Park::23:59']); // open shown, with real closing time
    expect(queryByText('Closed Place::none')).toBeNull();
    expect(queryByText('No Hours Place::none')).toBeNull();
  });

  it('sorts open venues by distance (closest first)', () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        venue({ id: 'far', name: 'Far Park', opening_hours: ALL_DAY, distance_km: 2.0 }),
        venue({ id: 'near', name: 'Near Park', opening_hours: ALL_DAY, distance_km: 0.3 }),
        venue({ id: 'mid', name: 'Mid Park', opening_hours: ALL_DAY, distance_km: 1.0 }),
      ],
      isLoading: false,
      error: null,
    });
    const { getAllByTestId } = render(<OpenNowRow onVenuePress={jest.fn()} />);
    const order = getAllByTestId('open-card').map((n) => (n.props.children as string).split('::')[0]);
    expect(order).toEqual(['Near Park', 'Mid Park', 'Far Park']);
  });

  it('passes a real closing time to each card (never fabricated)', () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [venue({ id: 'open', name: 'Open Park', opening_hours: ALL_DAY })],
      isLoading: false,
      error: null,
    });
    const { getAllByTestId } = render(<OpenNowRow onVenuePress={jest.fn()} />);
    const [card] = getAllByTestId('open-card').map((n) => n.props.children as string);
    expect(card).toBe('Open Park::23:59');
  });
});
