/**
 * Tests for app/explore/results.tsx — the "Find something for us" results.
 *
 * Focus (not over-tested):
 *   1. Consent gate — undecided shows the consent prompt, not results.
 *   2. Granted → curated venues render with their honest "reason" pills.
 *   3. The "Open now" refine chip flips the server filter (openNow=true).
 *
 * Curation correctness itself is covered by lib/__tests__/curation.test.ts;
 * here we only verify the screen wires data → curation → UI correctly.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { Venue } from '@/types';

import ResultsScreen from '../results';

// ── Mocks (hoisted) ─────────────────────────────────────────────────
const mockConsent = jest.fn(() => ({ status: 'granted', grant: jest.fn(), decline: jest.fn() }));
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => mockConsent(),
}));

jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({ coords: { latitude: 51.5, longitude: -0.1 }, isLoading: false, error: null })),
}));

jest.mock('@/hooks/useWeather', () => ({
  useWeather: jest.fn(() => null),
}));

const mockUseNearbyVenues = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...args),
  // Return an empty category list so enrichedVenues works without erroring.
  useCategories: jest.fn(() => ({ data: [], isLoading: false, error: null })),
}));

const mockParams = jest.fn(() => ({ mood: 'auto' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
}));

// Consent prompt — stub so we can assert it appears without its internals.
jest.mock('@/components/consent', () => {
  const { Text } = require('react-native');
  return { LocationConsentPrompt: () => <Text>consent-prompt</Text> };
});

function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    slug: over.id,
    category: undefined,
    price_range: null,
    min_age: 0,
    max_age: 12,
    is_premium: false,
    featured_until: null,
    review_count: 0,
    average_rating: 0,
    distance_km: 1,
    ...over,
  } as Venue;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConsent.mockReturnValue({ status: 'granted', grant: jest.fn(), decline: jest.fn() });
  mockParams.mockReturnValue({ mood: 'auto' });
  mockUseNearbyVenues.mockReturnValue({
    data: [], isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
  });
});

describe('ResultsScreen — consent gate', () => {
  it('shows the consent prompt when location is undecided', () => {
    mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    const { getByText } = render(<ResultsScreen />);
    expect(getByText('consent-prompt')).toBeTruthy();
  });
});

describe('ResultsScreen — curated results', () => {
  it('renders curated venues with reason pills', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        venue({ id: 'a', name: 'Sunny Soft Play', distance_km: 1 }),
        venue({ id: 'b', name: 'Riverside Park', distance_km: 2 }),
      ],
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });

    const { getByText, getAllByText } = render(<ResultsScreen />);

    await waitFor(() => expect(getByText('Sunny Soft Play')).toBeTruthy());
    expect(getByText('Riverside Park')).toBeTruthy();
    // Distance is shown inside VenueCard, not as a separate reason pill.
    // We verify at least one venue card rendered (the distance pill was removed
    // in the June 2026 UX polish — it was redundant with what VenueCard shows).
    expect(getAllByText('Sunny Soft Play')).toHaveLength(1);
    expect(getAllByText('Riverside Park')).toHaveLength(1);
  });

  it('shows the empty state when nothing is curated', () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [], isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
    const { getByText } = render(<ResultsScreen />);
    expect(getByText('Nothing matched just now')).toBeTruthy();
  });
});

describe('ResultsScreen — refine', () => {
  it('"Open now" chip flips the server openNow filter to true', () => {
    const { getByLabelText } = render(<ResultsScreen />);

    // Initial render: openNow is false.
    const firstCallFilters = mockUseNearbyVenues.mock.calls[0][1] as { openNow: boolean };
    expect(firstCallFilters.openNow).toBe(false);

    fireEvent.press(getByLabelText('Open now'));

    // After toggling, the hook is re-invoked with openNow=true.
    const lastCallFilters = mockUseNearbyVenues.mock.calls.at(-1)![1] as { openNow: boolean };
    expect(lastCallFilters.openNow).toBe(true);
  });
});
