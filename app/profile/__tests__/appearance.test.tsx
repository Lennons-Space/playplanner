/**
 * Tests for app/profile/appearance.tsx (Step 10A Part 2, dual-theme
 * foundation) — the System/Light/Dark appearance control.
 *
 * Covers: reflects the current store preference with an obvious selected
 * state, tapping an option calls setPreference and updates the UI
 * immediately (Zustand reactivity, no reload), renders without crashing in
 * both light and dark, works fully signed-out (no auth coupling at all —
 * this screen never reads a user/session), and does not touch/gate on
 * auth/consent/admin state.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AppearanceScreen from '../appearance';
import { useThemeStore } from '@/store/themeStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// This screen's own <ThemedBackground/> mount has dedicated coverage in
// components/ui/__tests__/ThemedBackground.test.tsx — stub it here so this
// file stays focused on the appearance-control business logic.
jest.mock('@/components/ui/ThemedBackground', () => ({
  ThemedBackground: () => null,
}));

jest.mock('@/components/ui/Icon', () => ({
  Icon: () => null,
}));

beforeEach(() => {
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('AppearanceScreen — reflects the current preference', () => {
  it('marks "System" as selected when preference is "system" (the default)', () => {
    render(<AppearanceScreen />);
    expect(screen.getByLabelText('System').props.accessibilityState).toMatchObject({ selected: true, checked: true });
    expect(screen.getByLabelText('Light').props.accessibilityState).toMatchObject({ selected: false, checked: false });
    expect(screen.getByLabelText('Dark').props.accessibilityState).toMatchObject({ selected: false, checked: false });
  });

  it('marks "Light" as selected when preference is "light"', () => {
    useThemeStore.setState({ preference: 'light' });
    render(<AppearanceScreen />);
    expect(screen.getByLabelText('Light').props.accessibilityState).toMatchObject({ selected: true, checked: true });
    expect(screen.getByLabelText('System').props.accessibilityState).toMatchObject({ selected: false, checked: false });
  });

  it('marks "Dark" as selected when preference is "dark"', () => {
    useThemeStore.setState({ preference: 'dark' });
    render(<AppearanceScreen />);
    expect(screen.getByLabelText('Dark').props.accessibilityState).toMatchObject({ selected: true, checked: true });
    expect(screen.getByLabelText('System').props.accessibilityState).toMatchObject({ selected: false, checked: false });
  });

  it('every option exposes accessibilityRole="radio"', () => {
    render(<AppearanceScreen />);
    for (const label of ['System', 'Light', 'Dark']) {
      expect(screen.getByLabelText(label).props.accessibilityRole).toBe('radio');
    }
  });
});

describe('AppearanceScreen — tapping an option updates the store immediately', () => {
  it('tapping "Dark" calls setPreference and the option becomes selected in the SAME render tree', () => {
    render(<AppearanceScreen />);
    fireEvent.press(screen.getByLabelText('Dark'));
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(screen.getByLabelText('Dark').props.accessibilityState).toMatchObject({ selected: true, checked: true });
    expect(screen.getByLabelText('System').props.accessibilityState).toMatchObject({ selected: false, checked: false });
  });

  it('tapping "Light" then "System" ends up back at "system" (no stale selection)', () => {
    render(<AppearanceScreen />);
    fireEvent.press(screen.getByLabelText('Light'));
    expect(useThemeStore.getState().preference).toBe('light');
    fireEvent.press(screen.getByLabelText('System'));
    expect(useThemeStore.getState().preference).toBe('system');
    expect(screen.getByLabelText('System').props.accessibilityState).toMatchObject({ selected: true, checked: true });
  });
});

describe('AppearanceScreen — renders without crashing in both modes', () => {
  it('renders with preference explicitly "dark"', () => {
    useThemeStore.setState({ preference: 'dark' });
    expect(() => render(<AppearanceScreen />)).not.toThrow();
    expect(screen.getByText('Appearance')).toBeTruthy();
  });

  it('renders with preference explicitly "light"', () => {
    useThemeStore.setState({ preference: 'light' });
    expect(() => render(<AppearanceScreen />)).not.toThrow();
    expect(screen.getByText('Appearance')).toBeTruthy();
  });
});

describe('AppearanceScreen — signed-out / no auth, consent, or admin coupling', () => {
  it('back button navigates via router.back(), no auth/session involved', () => {
    const { router } = jest.requireMock('expo-router') as { router: { back: jest.Mock } };
    render(<AppearanceScreen />);
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(router.back).toHaveBeenCalled();
  });

  it('source guard: never imports auth/consent/admin — a theme change cannot alter them', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../appearance.tsx'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/authStore|useAuth|is_admin|consent|supabase/i);
    }
  });
});
