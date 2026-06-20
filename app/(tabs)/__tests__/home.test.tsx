/**
 * Tests for app/(tabs)/index.tsx — the Play Planner v2 Browse (Home) screen.
 *
 * Browse answers "what should we do today?" with: greeting + headline, a search
 * bar, intent chips ("What do you need today?"), age chips ("Who's coming?"),
 * the "Good for today" featured pick, and a venue list. We assert the layout
 * scaffolding renders and that filtering chips + the featured pick are wired to
 * the (mocked) nearby-venue data. Venue data is mocked so no native location /
 * Supabase modules are pulled in.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { router } from 'expo-router';
import HomeScreen from '../index';

// ── Mocks (hoisted) ─────────────────────────────────────────────────
jest.mock('@/hooks/useAuth', () => ({
  useProfile: jest.fn(() => ({ full_name: 'Liam Evanson' })),
}));

// Location: approx coords + area label, both no-prompt. Mock wholesale so the
// real useApproxCoords (which imports expo-location) is never loaded.
jest.mock('@/hooks/location', () => ({
  useAreaLabel: jest.fn(() => null),
  useApproxCoords: jest.fn(() => ({ coords: { latitude: 52.8, longitude: -1.5 }, isApprox: true })),
  useLocation: jest.fn(() => ({ coords: null, isLoading: false })),
}));

jest.mock('@/hooks/useWeather', () => ({ useWeather: jest.fn(() => null) }));

const mockUseNearbyVenues = jest.fn(() => ({ data: [], isLoading: false }));
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...(args as [])),
}));

jest.mock('@/hooks/useFavourites', () => ({
  useSavedVenueIds: jest.fn(() => ({ savedIds: new Set(), isLoading: false })),
  useToggleFavourite: jest.fn(() => ({ mutate: jest.fn() })),
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
  mockUseNearbyVenues.mockReturnValue({ data: [], isLoading: false });
});

describe('Browse (Home)', () => {
  it('renders the greeting with the user first name', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Hi Liam 👋')).toBeTruthy();
  });

  it('renders the hero heading', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("What's the\nplan today?")).toBeTruthy();
  });

  it('renders the v2 browse sections (search, intents, ages, featured)', () => {
    const { getByText, getByLabelText } = render(<HomeScreen />);
    expect(getByLabelText('Search venues')).toBeTruthy();
    expect(getByText('What do you need today?')).toBeTruthy();
    expect(getByText("Who's coming?")).toBeTruthy();
    expect(getByText('Good for today')).toBeTruthy();
  });

  it('renders the intent and age chips', () => {
    const { getByLabelText } = render(<HomeScreen />);
    expect(getByLabelText(/Rainy Day/)).toBeTruthy();
    expect(getByLabelText(/Burn Energy/)).toBeTruthy();
    expect(getByLabelText('Toddlers')).toBeTruthy();
    expect(getByLabelText('4–8 yrs')).toBeTruthy();
  });

  it('opens the search screen from the search bar', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Search venues'));
    expect(router.push as jest.Mock).toHaveBeenCalledWith('/(tabs)/search');
  });

  it('shows the empty featured state when there are no venues', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('No matches right now')).toBeTruthy();
  });

  it('reveals a Clear control once an intent filter is selected', () => {
    const { getByLabelText, queryByLabelText } = render(<HomeScreen />);
    expect(queryByLabelText('Clear filters')).toBeNull();
    fireEvent.press(getByLabelText(/Rainy Day/));
    expect(getByLabelText('Clear filters')).toBeTruthy();
  });
});
