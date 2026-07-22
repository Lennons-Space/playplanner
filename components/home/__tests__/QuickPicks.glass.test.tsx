// Verifies QuickPicks intent-chip label colour follows the resolved theme.
//
// Step 10A Part 2 (dual-theme foundation): useAppTheme() no longer hard-
// returns 'dark' — it now resolves `mode` from the theme store's
// `preference` ('system' by default, unmocked here so it stays 'system')
// crossed with the OS colour scheme (useColorScheme()), falling back to
// 'dark' only when the OS reports no preference at all (see
// hooks/useAppTheme.ts). QuickPicks was already a useAppTheme() consumer
// before this wiring landed, so it now follows the OS theme automatically —
// QuickPicks.tsx itself needed no changes. This replaces the three
// "OS-driven switching not wired up yet" cases this file used to assert.

import React from 'react';
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { QuickPicks } from '@/components/home/QuickPicks';
import { Themes } from '@/constants/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

describe('QuickPicks theming (useAppTheme — system-resolved)', () => {
  it('falls back to dark label text when the OS reports no preference', () => {
    mockUseColorScheme.mockReturnValue(null);
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('follows the OS into dark mode (default preference is "system")', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('follows the OS into light mode (default preference is "system")', () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.light.label);
  });
});
