// Verifies QuickPicks intent-chip label colour.
//
// Play Planner v2 reskin: the (tabs) app is now a single DARK, weather-aware
// environment — one immersive/dark WeatherBackground sits behind every tab
// (app/(tabs)/_layout) and the global Colors token set is dark. useAppTheme()
// therefore resolves to the DARK token set regardless of the OS colour scheme
// (OS-driven light switching is deferred — see hooks/useAppTheme.ts), so
// QuickPicks renders light label text on the dark chip surface in every case.

import React from 'react';
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { QuickPicks } from '@/components/home/QuickPicks';
import { Themes } from '@/constants/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

describe('QuickPicks theming (useAppTheme — dark tab app)', () => {
  it('uses light label text when the OS reports no preference', () => {
    mockUseColorScheme.mockReturnValue(null);
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('stays dark even when the OS reports light (tab app is dark-only for now)', () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('uses light label text on a dark OS theme', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });
});
