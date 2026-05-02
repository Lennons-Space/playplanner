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
import { render } from '@testing-library/react-native';

// ─── Imports (after mocks) ───────────────────────────────────────────────────
import { useAuthStore } from '@/store/authStore';
import TabsLayout from '../_layout';

// ─── Module mocks ────────────────────────────────────────────────────────────

// Redirect: capture calls so we can assert where non-authed users are sent.
// We render it as a plain View with a testID so `getByTestId('redirect')` works.
const mockRedirectHref = jest.fn();

// Tabs: needs to expose a Tabs.Screen sub-component so the layout's JSX
// doesn't crash. We give it a no-op Screen that just returns null.
function MockTabsScreen() { return null; }
function MockTabs({ children }: { children?: React.ReactNode }) {
  const { View } = require('react-native');
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

// constants/theme: TabsLayout imports Colors — provide minimal stubs so the
// module resolves without a real build environment.
jest.mock('@/constants/theme', () => ({
  Colors: {
    sky: '#0EA5E9',
    grey: '#9CA3AF',
    white: '#FFFFFF',
    greyLighter: '#F3F4F6',
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
