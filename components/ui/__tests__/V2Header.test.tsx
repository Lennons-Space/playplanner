/**
 * Minimal smoke coverage for components/ui/V2Header.tsx (Phase A of the v2
 * Light-theme correction) — V2Header now reads tokens from useAppTheme()
 * per-render instead of a hard-coded `Themes.dark`, so it must still render
 * without throwing, with the back button and title, in both resolved modes.
 * Mode is forced directly via store/appearanceStore.ts (2026-08-13,
 * automatic day/night theme) — useAppTheme() no longer reads the OS colour
 * scheme at all.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { V2Header } from '@/components/ui/V2Header';
import { useAppearanceStore } from '@/store/appearanceStore';

beforeEach(() => {
  useAppearanceStore.setState({ mode: 'dark' });
});

describe('V2Header — renders in both dark and light without throwing', () => {
  it('renders the title and back button in dark mode', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    expect(() => render(<V2Header title="Notifications" />)).not.toThrow();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByLabelText('Go back')).toBeTruthy();
  });

  it('renders the title and back button in light mode', () => {
    useAppearanceStore.setState({ mode: 'light' });
    expect(() => render(<V2Header title="Privacy" />)).not.toThrow();
    expect(screen.getByText('Privacy')).toBeTruthy();
    expect(screen.getByLabelText('Go back')).toBeTruthy();
  });

  it('renders an optional trailing element', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const { getByText } = render(<V2Header title="Edit" right={<></>} />);
    expect(getByText('Edit')).toBeTruthy();
  });
});
