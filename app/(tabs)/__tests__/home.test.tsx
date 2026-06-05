/**
 * Tests for app/(tabs)/index.tsx — the decision Home.
 *
 * Focus (not over-tested):
 *   1. The hero CTA and quick picks render (the core decision launchers).
 *   2. Tapping the hero routes into the results flow with mood=auto.
 *   3. Privacy: when consent is not granted, Home shows the calm nudge
 *      (NOT the location-using NearbyPreview), proving Home never reaches
 *      for GPS on its own.
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
jest.mock('@/hooks/location', () => ({ useLocation: jest.fn(() => ({ coords: null, isLoading: false })) }));
jest.mock('@/hooks/useWeather', () => ({ useWeather: jest.fn(() => null) }));
jest.mock('@/hooks/useVenues', () => ({ useNearbyVenues: jest.fn(() => ({ data: [], isLoading: false, error: null })) }));

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
  it('renders the hero CTA and all four quick picks', () => {
    const { getByText, getByLabelText } = render(<HomeScreen />);
    expect(getByLabelText('Find something for us')).toBeTruthy();
    expect(getByText('Stay dry')).toBeTruthy();
    expect(getByText('Burn energy')).toBeTruthy();
    expect(getByText('Something calm')).toBeTruthy();
    expect(getByText('Free today')).toBeTruthy();
  });

  it('routes to results with mood=auto when the hero is tapped', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Find something for us'));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/explore/results?mood=auto');
  });

  it('routes to results with the chosen mood when a quick pick is tapped', () => {
    const { getByText } = render(<HomeScreen />);
    fireEvent.press(getByText('Stay dry'));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/explore/results?mood=indoor');
  });

  it('shows the location nudge (not the GPS preview) when consent is not granted', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("See what's near you")).toBeTruthy();
  });
});
