/**
 * Unit tests for app/(tabs)/_layout.tsx — TabsLayout auth guard.
 *
 * What these tests protect against:
 *   1. Cold-start flash: while Supabase is replaying the cached session
 *      (isLoading=true), the layout must render null — not redirect to auth.
 *      Without this guard, the app redirects to the auth screen and then
 *      immediately bounces back to tabs once the session resolves, causing
 *      a visible flash that breaks deep-link navigation.
 *
 *   2. No-session redirect: once loading is complete (isLoading=false) and
 *      there is genuinely no session, the layout must redirect to auth.
 *
 *   3. Authenticated render: when a session is present after loading,
 *      the Tabs navigator must render (not redirect anywhere).
 *
 * We mock useAuthStore at the module level so each test can inject the
 * exact store state it needs without spinning up a real Zustand store or
 * touching Supabase.
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';

// ─── Imports (after mocks) ───────────────────────────────────────────────────
import { useAuthStore } from '@/store/authStore';
import TabsLayout, { TabBarBackground } from '../_layout';

// ─── Module mocks ────────────────────────────────────────────────────────────

// Redirect: capture calls so we can assert where non-authed users are sent.
// We render it as a plain View with a testID so `getByTestId('redirect')` works.
const mockRedirectHref = jest.fn();

// Tabs: needs to expose a Tabs.Screen sub-component so the layout's JSX
// doesn't crash. We give it a no-op Screen that just returns null.
// screenOptions is captured (not just discarded) so tests can assert on the
// resolved tabBarActiveTintColor/tabBarInactiveTintColor — that's the only
// place TabsLayout ever passes them, since MockTabs itself renders nothing
// from those props.
const mockTabsScreenOptions = jest.fn();
function MockTabsScreen() { return null; }
function MockTabs({ children, screenOptions }: { children?: React.ReactNode; screenOptions?: unknown }) {
  const { View } = require('react-native');
  mockTabsScreenOptions(screenOptions);
  return <View testID="tabs-navigator">{children}</View>;
}
MockTabs.Screen = MockTabsScreen;

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => {
      mockRedirectHref(href);
      return <View testID="redirect" />;
    },
    Tabs: MockTabs,
  };
});

// useAuthStore: overridden per-test via mockReturnValue.
jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

// react-native-css-interop: wraps JSX and inspects component displayName
// properties that don't exist on our simple mocks. Stubbing it out prevents
// the "Cannot read properties of undefined (reading 'displayName')" crash.
jest.mock('react-native-css-interop', () => ({
  cssInterop: jest.fn(),
  remapProps: jest.fn(),
  StyleSheet: { create: (s: unknown) => s },
}));

// Ionicons: native SVG module — replace with a Text stub.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

// react-native-safe-area-context: supply real-looking insets so layout maths
// in TabsLayout (insets.bottom, paddingBottom) doesn't produce NaN.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
}));

// useAppTheme: TabsLayout reads accent.accent for the active tab tint (v2
// dark glass tab bar) plus `mode` (Phase A, v2 Light-theme correction) for
// the status bar / tab bar background — stub it so the test doesn't depend
// on the real Themes/ocean token module. Exposed as a jest.fn() so
// individual tests can override the resolved mode via mockReturnValueOnce.
const DARK_APP_THEME = {
  mode: 'dark' as const,
  tokens: {
    mode: 'dark', bg: '#0C0C11', warm: '#0E0E14', surface: '#17171F', surface2: '#1F1F29',
    label: '#F4F4F6', label2: 'rgba(235,235,245,0.76)', label3: 'rgba(235,235,245,0.44)',
    label4: 'rgba(235,235,245,0.22)', separator: 'rgba(255,255,255,0.08)',
    fill: 'rgba(255,255,255,0.07)', fill2: 'rgba(255,255,255,0.04)', star: '#FFB23E', appBg: '#060608',
  },
  accent: { accent: '#4C8DF6', light: 'rgba(76,141,246,0.16)', tagText: '#82AEFA' },
};
const LIGHT_APP_THEME = {
  mode: 'light' as const,
  tokens: {
    mode: 'light', bg: '#F1F0F4', warm: '#FBFAFC', surface: '#FFFFFF', surface2: '#F5F4F8',
    label: '#16151A', label2: 'rgba(20,18,28,0.74)', label3: 'rgba(20,18,28,0.48)',
    label4: 'rgba(20,18,28,0.26)', separator: 'rgba(20,18,28,0.10)',
    fill: 'rgba(20,18,28,0.05)', fill2: 'rgba(20,18,28,0.03)', star: '#FF9F0A', appBg: '#E4E3E8',
  },
  accent: { accent: '#4C8DF6', light: 'rgba(76,141,246,0.16)', tagText: '#82AEFA' },
};
// Return type is the union of both stubs so individual tests can override the
// resolved mode with mockReturnValue(LIGHT_APP_THEME) without a literal-type
// mismatch (DARK_APP_THEME.mode is `'dark' as const`).
const mockUseAppTheme = jest.fn(
  (): typeof DARK_APP_THEME | typeof LIGHT_APP_THEME => DARK_APP_THEME,
);
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => mockUseAppTheme(),
}));

// expo-linear-gradient: TabBarBackground renders a <LinearGradient> — replace
// with a plain View (same pattern as ThemedBackground.test.tsx /
// V2Background.test.tsx) so `colors` is inspectable via props on the JSON tree.
jest.mock('expo-linear-gradient', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

// expo-status-bar: react-native's OWN underlying <StatusBar/> is a
// non-visual, imperative-only native module — it renders null under Jest
// (nothing with a `style` prop appears in the JSON tree), so the only way to
// observe what `style` TabsLayout passes down is to capture the prop at the
// mock boundary rather than inspect toJSON() output.
const mockStatusBarStyle = jest.fn();
jest.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style: string }) => {
    mockStatusBarStyle(style);
    return null;
  },
}));

// ─── Typed mock helper ───────────────────────────────────────────────────────
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Drive the store selector calls inside TabsLayout. The component calls
 * useAuthStore twice — once for `session`, once for `isLoading`. Jest calls
 * the mock once per `useAuthStore(selector)` invocation. We return a different
 * value based on the selector's string representation.
 */
function mockStore(state: { session: unknown; isLoading: boolean }) {
  mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) => {
    // Identify which selector is being called by inspecting its source string.
    // This avoids tightly coupling to the store's internal shape.
    const src = selector.toString();
    if (src.includes('isLoading')) return state.isLoading;
    if (src.includes('session'))   return state.session;
    return undefined;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// TESTS
// =============================================================================

describe('TabsLayout — auth guard', () => {

  /**
   * Test 1 — Cold-start loading guard.
   *
   * During startup Supabase fires INITIAL_SESSION asynchronously. Until that
   * resolves, isLoading=true regardless of whether a session exists. The layout
   * must render nothing (null) so the splash screen stays visible and we never
   * flash the auth flow to a user who is already signed in.
   */
  it('renders null when isLoading=true and session=null (cold-start guard)', () => {
    mockStore({ session: null, isLoading: true });

    const { toJSON } = render(<TabsLayout />);

    // null is returned from the component — toJSON() returns null for nothing.
    expect(toJSON()).toBeNull();
    // Redirect must not have been called — we cannot redirect during loading.
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });

  /**
   * Test 2 — Unauthenticated redirect.
   *
   * Once loading is complete (isLoading=false) and there is no session, the
   * layout must redirect to /(auth). Without this, an unauthenticated user
   * would see the tabs UI with no profile — a privacy risk.
   */
  it('renders Redirect to /(auth) when isLoading=false and session=null', () => {
    mockStore({ session: null, isLoading: false });

    const { getByTestId } = render(<TabsLayout />);

    // The Redirect stub must render.
    expect(getByTestId('redirect')).toBeTruthy();
    // Confirm the destination is the auth group, not some other route.
    expect(mockRedirectHref).toHaveBeenCalledWith('/(auth)');
  });

  /**
   * Test 3 — Authenticated render.
   *
   * When a session is present and loading is complete, the Tabs navigator
   * must render. No Redirect should fire.
   */
  it('renders the Tabs navigator when isLoading=false and a session is present', () => {
    mockStore({
      session: { access_token: 'tok', user: { id: 'user-1' } },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(<TabsLayout />);

    // Tabs navigator must be present.
    expect(getByTestId('tabs-navigator')).toBeTruthy();
    // No redirect must have fired.
    expect(queryByTestId('redirect')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Step 8 (v2 dark restyle) — the shared ambient <WeatherBackground/> is gone.
// Every tab screen (Home, Map, Saved, Profile, Search) now mounts its own
// <V2Background/> per the per-screen atmosphere pattern — there is nothing
// left for this layout to own.
// =============================================================================
describe('TabsLayout — legacy ambient background fully removed (source guard)', () => {
  it('no longer imports or mounts the legacy <WeatherBackground/>', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../_layout.tsx'), 'utf8');
    expect(src).not.toMatch(/WeatherBackground/);
  });
});

// =============================================================================
// Phase A (v2 Light-theme correction, 2026-07-17) — TabBarBackground and the
// shared <StatusBar/> default are now mode-aware. expo-router's Tabs is
// mocked as a dumb passthrough in this file (see MockTabs above), so
// screenOptions.tabBarBackground never actually renders inside <TabsLayout/>'s
// own tree — TabBarBackground is mounted directly here instead (now exported
// from _layout.tsx for exactly this reason).
// =============================================================================
describe('TabBarBackground — mode-aware glass gradient + border', () => {
  it('dark: renders the unchanged dark gradient/border', () => {
    const tree = render(<TabBarBackground mode="dark" />).toJSON() as {
      children: [{ props: Record<string, unknown> }, { props: Record<string, unknown> }];
    };
    const [gradientNode, borderNode] = tree.children;
    expect(gradientNode.props.colors).toEqual([
      'rgba(14,14,20,0.28)',
      'rgba(14,14,20,0.80)',
      'rgba(14,14,20,0.92)',
    ]);
    const { StyleSheet } = require('react-native');
    expect(StyleSheet.flatten(borderNode.props.style).backgroundColor).toBe('rgba(255,255,255,0.12)');
  });

  it('light: renders a distinct light gradient/border', () => {
    const tree = render(<TabBarBackground mode="light" />).toJSON() as {
      children: [{ props: Record<string, unknown> }, { props: Record<string, unknown> }];
    };
    const [gradientNode, borderNode] = tree.children;
    expect(gradientNode.props.colors).toEqual([
      'rgba(255,255,255,0.35)',
      'rgba(255,255,255,0.85)',
      'rgba(255,255,255,0.94)',
    ]);
    const { StyleSheet } = require('react-native');
    expect(StyleSheet.flatten(borderNode.props.style).backgroundColor).toBe('rgba(20,18,28,0.12)');
  });
});

describe('TabsLayout — shared <StatusBar/> default follows resolved mode', () => {
  it('passes style="light" content when the resolved mode is dark', () => {
    mockUseAppTheme.mockReturnValue(DARK_APP_THEME);
    mockStore({ session: { access_token: 'tok', user: { id: 'user-1' } }, isLoading: false });
    render(<TabsLayout />);
    expect(mockStatusBarStyle).toHaveBeenCalledWith('light');
  });

  it('passes style="dark" content when the resolved mode is light', () => {
    mockUseAppTheme.mockReturnValue(LIGHT_APP_THEME);
    mockStore({ session: { access_token: 'tok', user: { id: 'user-1' } }, isLoading: false });
    render(<TabsLayout />);
    expect(mockStatusBarStyle).toHaveBeenCalledWith('dark');
  });
});

// =============================================================================
// Cross-Screen Visual Consistency checkpoint — theme-aware bottom-tab colours.
//
// Root cause fixed: INACTIVE_TINT used to be a single constant shared by both
// themes (rgba(235,235,245,0.4) — near-white). That reads fine on the dark
// glass tab bar but is nearly invisible against the Light theme's own
// near-opaque WHITE glass tab bar (TabBarBackground's light gradient bottom
// stop is 0.94-opacity white) — a near-white-on-near-white inactive icon.
// INACTIVE_TINT is now keyed by mode: dark keeps its original value
// byte-for-byte; light uses a moderate-opacity dark ink instead.
// =============================================================================
describe('TabsLayout — bottom tab colours are theme-aware and readable', () => {
  const authedStore = { session: { access_token: 'tok', user: { id: 'user-1' } }, isLoading: false };

  it('Light mode: inactive tab tint is dark/readable — not the dark-mode near-white value', () => {
    mockUseAppTheme.mockReturnValue(LIGHT_APP_THEME);
    mockStore(authedStore);
    render(<TabsLayout />);

    const screenOptions = mockTabsScreenOptions.mock.calls[0][0] as Record<string, unknown>;
    expect(screenOptions.tabBarInactiveTintColor).toBe('rgba(20,18,28,0.6)');
    expect(screenOptions.tabBarInactiveTintColor).not.toBe('rgba(235,235,245,0.4)');
  });

  it('Dark mode: inactive tab tint keeps its existing readable light-on-dark value, unchanged', () => {
    mockUseAppTheme.mockReturnValue(DARK_APP_THEME);
    mockStore(authedStore);
    render(<TabsLayout />);

    const screenOptions = mockTabsScreenOptions.mock.calls[0][0] as Record<string, unknown>;
    expect(screenOptions.tabBarInactiveTintColor).toBe('rgba(235,235,245,0.4)');
  });

  it('active tab tint is the accent colour in both themes and always distinguishable from the inactive tint', () => {
    for (const theme of [LIGHT_APP_THEME, DARK_APP_THEME]) {
      mockTabsScreenOptions.mockClear();
      mockUseAppTheme.mockReturnValue(theme);
      mockStore(authedStore);
      render(<TabsLayout />);

      const screenOptions = mockTabsScreenOptions.mock.calls[0][0] as Record<string, unknown>;
      expect(screenOptions.tabBarActiveTintColor).toBe(theme.accent.accent);
      expect(screenOptions.tabBarActiveTintColor).not.toBe(screenOptions.tabBarInactiveTintColor);
    }
  });

  it('Light and Dark inactive tints are genuinely different values — theme-aware, not one shared constant', () => {
    mockUseAppTheme.mockReturnValue(LIGHT_APP_THEME);
    mockStore(authedStore);
    render(<TabsLayout />);
    const lightTint = (mockTabsScreenOptions.mock.calls[0][0] as Record<string, unknown>).tabBarInactiveTintColor;

    mockTabsScreenOptions.mockClear();
    mockUseAppTheme.mockReturnValue(DARK_APP_THEME);
    mockStore(authedStore);
    render(<TabsLayout />);
    const darkTint = (mockTabsScreenOptions.mock.calls[0][0] as Record<string, unknown>).tabBarInactiveTintColor;

    expect(lightTint).not.toBe(darkTint);
  });
});
