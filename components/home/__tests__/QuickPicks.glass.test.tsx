// Verifies QuickPicks intent-chip label colour.
//
// The (tabs) app is now a single LIGHT, weather-aware environment: one ambient
// WeatherBackground sits behind every tab (app/(tabs)/_layout) and the legacy
// light-only sibling screens (Search/Favourites/Profile) use dark text, so the
// shared wash must stay light. useAppTheme() therefore resolves to the LIGHT
// token set regardless of the OS colour scheme, and QuickPicks renders dark
// label text on a light chip surface in every case. OS-dark support for the tab
// app is deferred (see hooks/useAppTheme.ts).

import React from 'react';
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { QuickPicks } from '@/components/home/QuickPicks';
import { Themes } from '@/constants/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

describe('QuickPicks theming (useAppTheme — light tab app)', () => {
  it('uses dark label text when the OS reports no preference', () => {
    mockUseColorScheme.mockReturnValue(null);
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.light.label);
  });

  it('stays light even when the OS reports dark (tab app is light-only for now)', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.light.label);
  });

  it('uses dark label text on a light OS theme', () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.light.label);
  });
});
