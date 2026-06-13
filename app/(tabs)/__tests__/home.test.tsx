/**
 * Tests for app/(tabs)/index.tsx — the decision Home.
 *
 * Focus (not over-tested):
 *   1. The kids' mood section and all six intent chips render.
 *   2. Tapping an intent chip routes into the results flow with the correct mood.
 *   3. Privacy: when consent is not granted, Home shows the calm nudge
 *      (NOT the location-using NearbyPreview), proving Home never reaches
 *      for GPS on its own.
 *   4. The location nudge CTA still routes into the results flow (mood=auto).
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
  it('renders the kids mood section and all six intent chips', () => {
    const { getByText, getByLabelText } = render(<HomeScreen />);
    // Kids' mood discovery section (replaced the old search field — TASK 2)
    expect(getByText('What are the kids in the mood for?')).toBeTruthy();
    expect(getByLabelText('Adventurous')).toBeTruthy();
    expect(getByLabelText('Treat Day')).toBeTruthy();
    // Six intent chips — accessibilityLabel uses "<label> intent" suffix
    // to distinguish from the QuickFilterChips row which reuses some labels.
    expect(getByLabelText('Rainy Day intent')).toBeTruthy();
    expect(getByLabelText('Burn Energy intent')).toBeTruthy();
    expect(getByLabelText('Free Day Out intent')).toBeTruthy();
    expect(getByLabelText('Animal Fix intent')).toBeTruthy();
    expect(getByLabelText('Toddler Time intent')).toBeTruthy();
    expect(getByLabelText('Parent Friendly intent')).toBeTruthy();
  });

  it('renders the greeting with the user first name', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText('Hi Liam 👋')).toBeTruthy();
  });

  it('renders the hero heading', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("What's the\nplan today?")).toBeTruthy();
  });

  it('selects a kids mood on tap and deselects on second tap (local UI state)', () => {
    const { getByLabelText, queryByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Calm'));
    expect(getByLabelText('Calm, selected')).toBeTruthy();
    // Mood selection is local UI only — it must NOT navigate.
    expect((router.push as jest.Mock)).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Calm, selected'));
    expect(queryByLabelText('Calm, selected')).toBeNull();
  });

  it('routes to results with mood=indoor when "Rainy Day" intent chip is tapped', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Rainy Day intent'));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/explore/results?mood=indoor');
  });

  it('routes to results with mood=active when "Burn Energy" intent chip is tapped', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Burn Energy intent'));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/explore/results?mood=active');
  });

  it('routes to results with mood=free when "Free Day Out" intent chip is tapped', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Free Day Out intent'));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/explore/results?mood=free');
  });

  it('shows the location nudge (not the GPS preview) when consent is not granted', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("See what's near you")).toBeTruthy();
  });

  it('routes to results with mood=auto when the location nudge is tapped', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText("See what's near you"));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/explore/results?mood=auto');
  });
});
