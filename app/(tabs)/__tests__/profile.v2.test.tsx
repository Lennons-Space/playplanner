/**
 * Profile tab (app/(tabs)/profile.tsx) — v2 dark screen tests (Step 5).
 *
 * Covers: the signed-out Redirect renders with no v2 chrome, real profile
 * fields drive the hero (never hard-coded), every menu row — including the
 * new Family row — navigates to its real route, sign-out and delete-account
 * stay guarded behind their confirm Alerts, no fabricated subscription/
 * family/stats content ever renders, and the tab-safe bottom padding is
 * applied.
 *
 * This screen mounts its own <V2Background/> (same per-screen pattern as
 * Home/Saved/Venue Detail/Map — see components/ui/__tests__/
 * V2Background.test.tsx for the component's own coverage); this file only
 * keeps the behavioural coverage below, mocking useWeather() (which
 * V2Background reads internally) so it renders deterministically.
 *
 * See app/(tabs)/__tests__/profile.deleteAccount.test.tsx for the dedicated
 * GDPR Art.17 storage-cleanup + delete_own_account ordering suite — that
 * file's assertions are unchanged by this restyle and are not duplicated here.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Linking, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ProfileScreen from '../profile';

// ── expo / RN shims ─────────────────────────────────────────────────────────
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    Redirect: ({ href }: { href: string }) =>
      ReactActual.createElement(Text, { testID: 'redirect' }, href),
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 64,
}));

// V2Background reads the same coarse weather fetch every v2 screen uses —
// default to "no data" so the time-aware fallback path runs deterministically
// with no real network call (same pattern as map.v2.test.tsx / favourites.test.tsx).
const mockUseWeather = jest.fn(() => null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
let mockUser: { id: string } | null = { id: 'user-test-id' };
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null; signOut: () => Promise<void> }) => unknown) =>
    selector({ user: mockUser, signOut: mockSignOut }),
}));

const mockUseProfile = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
  useProfile: () => mockUseProfile(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          neq: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })),
    storage: {
      from: jest.fn(() => ({ remove: jest.fn().mockResolvedValue({ data: null, error: null }) })),
    },
    rpc: jest.fn().mockResolvedValue({ error: null }),
  },
}));

// ── helper: find a style anywhere in a rendered tree ────────────────────────
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;

function findFirstPositiveMarginBottom(node: JsonNode | JsonNode[]): number | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findFirstPositiveMarginBottom(n);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const flattened = node.props?.style
    ? (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>)
    : null;
  const mb = flattened?.marginBottom;
  if (typeof mb === 'number' && mb > 0) return mb;
  return findFirstPositiveMarginBottom(node.children ?? null);
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const baseProfile = {
  id: 'user-test-id',
  full_name: 'Jamie Rivers',
  username: 'jamierivers',
  avatar_url: null,
  is_admin: false,
  is_premium: false,
  children_ages: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'user-test-id' };
  mockUseWeather.mockReturnValue(null);
  mockUseProfile.mockReturnValue(baseProfile);
});

// ── Signed-out guard ─────────────────────────────────────────────────────────
describe('Profile v2 — signed-out guard', () => {
  it('renders the Redirect (not the v2 chrome) when signed out, with no crash', () => {
    mockUser = null;
    const screen = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(screen.getByTestId('redirect')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByLabelText('Sign out of your account')).toBeNull();
  });
});

// ── Real data, never fabricated ─────────────────────────────────────────────
describe('Profile v2 — real profile data, not hard-coded', () => {
  it('renders the real name and username from the store, not fabricated values', () => {
    const { getByText, queryByText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(getByText('Jamie Rivers')).toBeTruthy();
    expect(getByText('@jamierivers')).toBeTruthy();
    expect(queryByText('Sarah Mitchell')).toBeNull();
    expect(queryByText('@sarahmitch')).toBeNull();
  });

  it('falls back to "Parent" and omits the username line when the profile has none', () => {
    mockUseProfile.mockReturnValue({ ...baseProfile, full_name: null, username: null });
    const { getByText, queryByText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(getByText('Parent')).toBeTruthy();
    expect(queryByText(/^@/)).toBeNull();
  });

  it('never renders fake subscription, family-member, or usage-stat content from the design mock', () => {
    const { queryByText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(queryByText(/premium/i)).toBeNull();
    expect(queryByText(/upgrade/i)).toBeNull();
    expect(queryByText('5,759')).toBeNull(); // BusinessTab2 fake analytics (pp2-profile.jsx)
    expect(queryByText('1,472')).toBeNull();
    expect(queryByText('Claim your listing')).toBeNull();
    expect(queryByText('Claim now')).toBeNull();
    expect(queryByText(/Sarah Mitchell/)).toBeNull();
  });
});

// ── Menu rows → real routes ──────────────────────────────────────────────────
describe('Profile v2 — menu rows navigate to real routes', () => {
  it('Personal details -> /profile/edit', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Personal details'));
    expect(router.push).toHaveBeenCalledWith('/profile/edit');
  });

  it('Family -> /profile/children-ages (new row, real existing route + hook)', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Family'));
    expect(router.push).toHaveBeenCalledWith('/profile/children-ages');
  });

  it('Notifications -> /profile/notifications', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Notifications'));
    expect(router.push).toHaveBeenCalledWith('/profile/notifications');
  });

  it('Privacy & data -> /profile/privacy-settings', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Privacy & data'));
    expect(router.push).toHaveBeenCalledWith('/profile/privacy-settings');
  });

  it('Download my data -> /profile/data-download', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Download my data'));
    expect(router.push).toHaveBeenCalledWith('/profile/data-download');
  });

  it('My reviews -> /profile/my-reviews', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('My reviews'));
    expect(router.push).toHaveBeenCalledWith('/profile/my-reviews');
  });

  it('My submitted venues -> /profile/my-venues', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('My submitted venues'));
    expect(router.push).toHaveBeenCalledWith('/profile/my-venues');
  });

  it('Add a venue -> /venue/add', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Add a venue'));
    expect(router.push).toHaveBeenCalledWith('/venue/add');
  });

  it('Privacy policy -> /(auth)/privacy', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Privacy policy'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/privacy');
  });

  it('Contact us opens the real support mailto link', () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Contact us'));
    expect(openURLSpy).toHaveBeenCalledWith('mailto:support@playplanner.app');
    openURLSpy.mockRestore();
  });

  it('Help & FAQ opens the in-app v2 Help modal, not a native Alert, and does not navigate', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText, getByTestId } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Help & FAQ'));
    expect(getByTestId('help-modal')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

// ── Help modal (in-app, dark v2 — replaces the old grey native Alert) ──────
describe('Profile v2 — Help modal', () => {
  function openHelp() {
    const utils = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(utils.getByLabelText('Help & FAQ'));
    return utils;
  }

  it('is not present in the tree until opened', () => {
    const { queryByTestId } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(queryByTestId('help-modal')).toBeNull();
  });

  it('shows the same support email as before', () => {
    const { getByText } = openHelp();
    expect(getByText('support@playplanner.app')).toBeTruthy();
  });

  it('"Contact us" inside the modal fires the same support mailto link', () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByLabelText } = openHelp();
    fireEvent.press(getByLabelText('Email support at support@playplanner.app'));
    expect(openURLSpy).toHaveBeenCalledWith('mailto:support@playplanner.app');
    openURLSpy.mockRestore();
  });

  it('closes via the Close button', () => {
    const { getByLabelText, queryByTestId } = openHelp();
    fireEvent.press(getByLabelText('Close Help dialog'));
    expect(queryByTestId('help-modal')).toBeNull();
  });

  it('closes via backdrop dismissal', () => {
    const { getByLabelText, queryByTestId } = openHelp();
    fireEvent.press(getByLabelText('Dismiss Help dialog'));
    expect(queryByTestId('help-modal')).toBeNull();
  });
});

// ── Admin panel — restored 2026-07-17, gated strictly on profile.is_admin ──
// Hiding the row is a UX nicety, not the security boundary: app/admin/
// moderation.tsx independently redirects non-admins and gates every query
// on `enabled: isAdmin`, backed by RLS. These tests only cover the Profile
// screen's own visibility wiring, not the admin route's gate itself.
describe('Profile v2 — admin panel row visibility (profile.is_admin gated)', () => {
  it('does NOT render the Admin section for a non-admin profile (is_admin: false)', () => {
    const { queryByText, queryByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(queryByText('ADMIN')).toBeNull();
    expect(queryByLabelText('Admin panel')).toBeNull();
  });

  it('does NOT render the Admin section when is_admin is undefined', () => {
    const { is_admin: _omit, ...rest } = baseProfile;
    mockUseProfile.mockReturnValue(rest);
    const { queryByText, queryByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(queryByText('ADMIN')).toBeNull();
    expect(queryByLabelText('Admin panel')).toBeNull();
  });

  it('does NOT render the Admin section when is_admin is null', () => {
    mockUseProfile.mockReturnValue({ ...baseProfile, is_admin: null });
    const { queryByText, queryByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(queryByText('ADMIN')).toBeNull();
    expect(queryByLabelText('Admin panel')).toBeNull();
  });

  it('renders the Admin section / Admin panel row when profile.is_admin is true', () => {
    mockUseProfile.mockReturnValue({ ...baseProfile, is_admin: true });
    const { getByText, getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(getByText('ADMIN')).toBeTruthy();
    expect(getByLabelText('Admin panel')).toBeTruthy();
  });

  it('pressing the Admin panel row navigates to the real /admin/moderation route', () => {
    mockUseProfile.mockReturnValue({ ...baseProfile, is_admin: true });
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Admin panel'));
    expect(router.push).toHaveBeenCalledWith('/admin/moderation');
  });
});

// ── Source-level guard: visibility is is_admin driven, no bypass literals ──
// Reads the raw source of profile.tsx rather than the rendered tree, so it
// catches a regression even if someone changes the row's copy/label later.
// Scoped narrowly (no email/UUID literal near the admin gate; the push to
// /admin/moderation only ever appears inside the `profile?.is_admin === true`
// guard) so it never collides with the legitimate "Contact us" mailto link
// elsewhere in the same file.
describe('Profile v2 — admin gate source guard (no hard-coded bypass)', () => {
  const source: string = fs.readFileSync(
    path.join(__dirname, '..', 'profile.tsx'),
    'utf8',
  );

  it('gates the admin section strictly on `profile?.is_admin === true`', () => {
    expect(source).toMatch(/profile\?\.is_admin === true/);
  });

  it('never pushes to /admin/moderation outside the is_admin guard', () => {
    const guardIndex = source.indexOf('profile?.is_admin === true');
    const pushIndex = source.indexOf("router.push('/admin/moderation')");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(guardIndex);

    // Only one admin-route push in the whole file, and it is the one we just
    // located after the guard — i.e. there is no second, unguarded copy.
    const occurrences = source.split("router.push('/admin/moderation')").length - 1;
    expect(occurrences).toBe(1);
  });

  it('contains no hard-coded email literal within the admin section itself', () => {
    const guardIndex = source.indexOf('profile?.is_admin === true');
    const sectionEnd = source.indexOf('{/* ── Footer', guardIndex);
    const adminSection = source.slice(guardIndex, sectionEnd);
    expect(adminSection).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
  });

  it('contains no hard-coded UUID literal anywhere in the file', () => {
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(source).not.toMatch(uuidPattern);
  });
});

// ── Sign-out / delete-account guards preserved ──────────────────────────────
describe('Profile v2 — sign-out and delete-account stay guarded', () => {
  it('sign-out is guarded behind a confirm Alert (signOut is not called until confirmed)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Sign out of your account'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Sign out',
      'Are you sure you want to sign out?',
      expect.any(Array),
    );
    expect(mockSignOut).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('sign-out calls signOut only after the destructive Alert button is confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    fireEvent.press(getByLabelText('Sign out of your account'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    alertSpy.mockRestore();
  });

  it('delete-account starts enabled (not disabled/loading) and is guarded behind a confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    const btn = getByLabelText('Permanently delete your account and all your data');
    expect(btn.props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(btn);
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete account?',
      'This will permanently delete your account and all your data. This cannot be undone.',
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  it('the GDPR transparency warning caption is always visible next to the delete button', () => {
    const { getByText } = render(<ProfileScreen />, { wrapper: makeWrapper() });
    expect(getByText('Permanently deletes all your data. Cannot be undone.')).toBeTruthy();
  });
});

// ── Tab-safe bottom padding ─────────────────────────────────────────────────
describe('Profile v2 — tab-safe bottom padding', () => {
  it('applies a marginBottom derived from tab bar height / safe-area insets so content clears the floating tab bar', () => {
    // Math.max(tabBarHeight (mocked 64), 52 + insets.bottom (mocked 34) = 86) -> tabSafeZone === 86.
    const tree = render(<ProfileScreen />, { wrapper: makeWrapper() }).toJSON();
    expect(findFirstPositiveMarginBottom(tree)).toBe(86);
  });
});
