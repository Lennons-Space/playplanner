/**
 * Tests for app/(tabs)/index.tsx — the simplified, calm Home.
 *
 * Home Final pass: Home is a calm hallway — welcome + ONE editorial collection
 * hero + recently-viewed + a quiet Discover link. No venue hero, no Near You,
 * no mood/intent/age browse chips (all live on Discover). Focus (not over-tested):
 *   1. Greeting + hero heading render.
 *   2. The removed browsing sections are NO LONGER present on Home.
 *   3. The editorial collection hero always renders and opens a collection page.
 *   4. There is no duplicate bottom Discover CTA (the hero owns Explore).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { router } from 'expo-router';
import HomeScreen from '../index';

// ── Mocks (hoisted) ─────────────────────────────────────────────────
jest.mock('@/hooks/useAuth', () => ({
  useProfile: jest.fn(() => ({ full_name: 'Liam Evanson' })),
}));

const mockConsent = jest.fn(() => ({ status: 'undecided', grant: jest.fn(), decline: jest.fn() }));
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => mockConsent(),
}));

// NearbyPreview transitively imports location/weather/venue hooks. Mock them so
// importing Home never pulls in native location modules, even though the nudge
// path (undecided) does not mount NearbyPreview.
jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({ coords: null, isLoading: false })),
  useAreaLabel: jest.fn(() => null),
}));

// Recently viewed is local-only; keep it empty here so the row stays hidden.
jest.mock('@/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: jest.fn(() => ({ items: [], loading: false })),
}));
jest.mock('@/hooks/useWeather', () => ({ useWeather: jest.fn(() => null) }));
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({ data: [], isLoading: false, error: null })),
  useCategories: jest.fn(() => ({ data: [] })),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
});

describe('HomeScreen', () => {
  it('renders the greeting with the user first name', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Hi Liam 👋')).toBeTruthy();
  });

  it('renders the hero heading', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("What's the\nplan today?")).toBeTruthy();
  });

  it('no longer renders the mood / need / age browsing sections (moved to Discover)', () => {
    const { queryByText } = render(<HomeScreen />);
    expect(queryByText('What are the kids in the mood for?')).toBeNull();
    expect(queryByText('What do you need today?')).toBeNull();
    expect(queryByText("Who's coming?")).toBeNull();
  });

  it('always shows an editorial collection hero that opens a Discover collection', () => {
    const { getByLabelText } = render(<HomeScreen />);
    // The hero is a collection (never a venue) and shows regardless of location
    // consent — Home no longer reads location for its main content. With weather
    // mocked null, the weather-aware choice falls to the seasonal collection.
    fireEvent.press(getByLabelText(/Open collection/));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith({
      pathname: '/discover/[collection]',
      params: { collection: 'seasonal' },
    });
  });

  it('has no duplicate bottom Discover CTA (the hero owns the Explore action)', () => {
    const { queryByText, queryByLabelText } = render(<HomeScreen />);
    expect(queryByText('Need ideas?')).toBeNull();
    expect(queryByLabelText('Need ideas? Open Discover')).toBeNull();
  });
});
