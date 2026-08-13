// Verifies QuickPicks intent-chip label colour follows the resolved theme.
//
// 2026-08-13 (automatic day/night theme): useAppTheme() resolves `mode`
// entirely from local time via store/appearanceStore.ts — it no longer
// reads the OS colour scheme or the legacy themeStore preference at all
// (see hooks/useAppTheme.ts). QuickPicks was already a useAppTheme()
// consumer before this wiring landed, so it follows the resolved app theme
// automatically — QuickPicks.tsx itself needed no changes. Mode is forced
// directly via the store here instead of mocking useColorScheme.

import React from 'react';
import { render } from '@testing-library/react-native';
import { QuickPicks } from '@/components/home/QuickPicks';
import { Themes } from '@/constants/theme';
import { useAppearanceStore } from '@/store/appearanceStore';

describe('QuickPicks theming (useAppTheme — time-resolved)', () => {
  it('renders dark label text when the resolved mode is dark', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.dark.label);
  });

  it('renders light label text when the resolved mode is light', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const { getByText } = render(<QuickPicks onPick={jest.fn()} />);
    expect(getByText('Rainy Day').props.style.color).toBe(Themes.light.label);
  });
});
