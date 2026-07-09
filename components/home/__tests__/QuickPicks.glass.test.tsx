// Verifies QuickPicks intent-chip label colour.
//
// Play Planner v2 (June 2026 relaunch) ships DARK by default: useAppTheme()
// now hardcodes 'dark' regardless of the OS colour scheme (see
// hooks/useAppTheme.ts), so every useAppTheme() consumer — including this
// orphaned-but-still-tested QuickPicks component — renders the dark token
// set in every case. OS-driven light switching is deferred (not wired up
// yet); when it lands, these three cases should diverge again.

import React from 'react';
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { QuickPicks } from '@/components/home/QuickPicks';
import { Themes } from '@/constants/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

describe('QuickPicks theming (useAppTheme — dark by default)', () => {
  it('uses dark label text when the OS reports no preference', () => {
    mockUseColorScheme.mockReturnValue(null);
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('stays dark even when the OS reports dark (OS-driven switching not wired up yet)', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('stays dark even when the OS reports light (OS-driven switching not wired up yet)', () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });
});
