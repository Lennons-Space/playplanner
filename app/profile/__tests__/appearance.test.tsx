/**
 * Tests for app/profile/appearance.tsx (2026-08-13, automatic day/night
 * theme).
 *
 * Covers: no picker/options rendered any more (the old System/Light/Dark
 * radios are gone), explains the automatic 7am/7pm rule, renders correctly
 * in both resolved modes, never writes to the legacy themeStore, works
 * fully signed-out, and does not touch/gate on auth/consent/admin state.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AppearanceScreen from '../appearance';
import { useAppearanceStore } from '@/store/appearanceStore';
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
// file stays focused on the appearance-screen business logic.
jest.mock('@/components/ui/ThemedBackground', () => ({
  ThemedBackground: () => null,
}));

jest.mock('@/components/ui/Icon', () => ({
  Icon: () => null,
}));

beforeEach(() => {
  useAppearanceStore.setState({ mode: 'dark' });
});

describe('AppearanceScreen — automatic-only, no picker', () => {
  it('renders the Automatic explainer', () => {
    render(<AppearanceScreen />);
    expect(screen.getByText('Automatic')).toBeTruthy();
    expect(
      screen.getByText(/Light during the day, dark at night/i),
    ).toBeTruthy();
  });

  it('states the exact 7am/7pm rule', () => {
    render(<AppearanceScreen />);
    expect(screen.getByText(/7am/)).toBeTruthy();
    expect(screen.getByText(/7pm/)).toBeTruthy();
  });

  it('renders no selectable options — the old System/Light/Dark radios are gone', () => {
    render(<AppearanceScreen />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText('System')).toBeNull();
    expect(screen.queryByText('Light')).toBeNull();
    expect(screen.queryByText('Dark')).toBeNull();
  });
});

describe('AppearanceScreen — renders without crashing in both resolved modes', () => {
  it('renders with the resolved mode "dark"', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    expect(() => render(<AppearanceScreen />)).not.toThrow();
    expect(screen.getByText('Appearance')).toBeTruthy();
  });

  it('renders with the resolved mode "light"', () => {
    useAppearanceStore.setState({ mode: 'light' });
    expect(() => render(<AppearanceScreen />)).not.toThrow();
    expect(screen.getByText('Appearance')).toBeTruthy();
  });
});

describe('AppearanceScreen — never writes to the legacy themeStore', () => {
  it('mounting and unmounting the screen never changes store/themeStore.ts preference', () => {
    useThemeStore.setState({ preference: 'system' });
    const { unmount } = render(<AppearanceScreen />);
    expect(useThemeStore.getState().preference).toBe('system');
    unmount();
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('source guard: never imports store/themeStore — only mentions it in prose explaining why not', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../appearance.tsx'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/themeStore/i);
    }
  });
});

describe('AppearanceScreen — signed-out / no auth, consent, or admin coupling', () => {
  it('back button navigates via router.back(), no auth/session involved', () => {
    const { router } = jest.requireMock('expo-router') as { router: { back: jest.Mock } };
    render(<AppearanceScreen />);
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(router.back).toHaveBeenCalled();
  });

  it('source guard: never imports auth/consent/admin — this screen cannot alter them', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../appearance.tsx'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/authStore|useAuth|is_admin|consent|supabase/i);
    }
  });
});
