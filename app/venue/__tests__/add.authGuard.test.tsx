/**
 * Deep-link auth guard proof for app/venue/add.tsx (Add a Venue screen).
 *
 * This screen is registered directly on the root Stack (app/_layout.tsx,
 * presentation:'modal') with no layout guard of its own — unlike screens
 * inside app/(tabs), which app/(tabs)/_layout.tsx already gates. A deep link
 * (playplanner://venue/add) could otherwise reach the submission form,
 * including its postcode lookup network call, while signed out.
 * AddVenueScreen's default export is now wrapped in RequireSession
 * (components/auth/RequireSession.tsx). This file proves the four required
 * guarantees:
 *
 *   1. An authenticated user can access Add a Venue.
 *   2. Signed-out direct/deep-link access redirects to auth WITHOUT
 *      rendering the form (no flash of screen content).
 *   3. Postcode lookup cannot be triggered while signed out — the
 *      geocode-postcode Edge Function invoke is never called.
 *   4. The session-loading state does not redirect (must not bounce a
 *      legitimately signed-in user mid cold-start restore).
 *
 * Mock surface mirrors add.test.tsx (same screen, same dependencies) — kept
 * as a separate file so the auth-guard proof is easy to find and does not
 * get lost among the screen's much larger behavioural test suite.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { useUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import AddVenueScreen from '../add';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockRedirectHref = jest.fn();
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  return {
    router: { back: jest.fn() },
    Redirect: ({ href }: { href: string }) => {
      mockRedirectHref(href);
      return <View testID="redirect" />;
    },
  };
});

jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@/components/ui/V2Background', () => ({
  V2Background: () => null,
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({
    data: [{ id: 'cat-1', name: 'Soft Play', slug: 'soft-play', icon: '🧸', color: '#4C8DF6' }],
  })),
}));

const mockFunctionsInvoke = jest.fn().mockResolvedValue({
  data: { latitude: 51.5, longitude: -0.1, city: 'Manchester' },
  error: null,
});
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({ order: jest.fn().mockResolvedValue({ data: [] }) })),
      insert: jest.fn().mockResolvedValue({ error: null }),
    })),
    functions: {
      invoke: (...args: unknown[]) => mockFunctionsInvoke(...args),
    },
  },
}));

// ─── Typed helpers ────────────────────────────────────────────────────────────
const mockUseUser = useUser as jest.MockedFunction<typeof useUser>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

function mockStore(state: { session: unknown; isLoading: boolean }) {
  mockUseAuthStore.mockImplementation((selector) => selector(state as unknown as AuthStoreState));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue({ id: 'user-test-id' } as any);
  mockFunctionsInvoke.mockResolvedValue({
    data: { latitude: 51.5, longitude: -0.1, city: 'Manchester' },
    error: null,
  });
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

// =============================================================================
// 1. Authenticated access
// =============================================================================
describe('AddVenueScreen — authenticated access', () => {
  it('renders the real Add a Venue form when a session is present', () => {
    mockStore({ session: { access_token: 'tok', user: { id: 'user-test-id' } }, isLoading: false });

    const { getByText, queryByTestId } = render(<AddVenueScreen />);

    expect(getByText('Add a venue')).toBeTruthy();
    expect(queryByTestId('redirect')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2. Signed-out redirect — no flash of screen content
// =============================================================================
describe('AddVenueScreen — signed-out deep-link access', () => {
  it('redirects to /(auth) and never renders the form when there is no session', () => {
    mockStore({ session: null, isLoading: false });

    const { getByTestId, queryByText } = render(<AddVenueScreen />);

    expect(getByTestId('redirect')).toBeTruthy();
    expect(mockRedirectHref).toHaveBeenCalledWith('/(auth)');

    // The functional screen must not render or flash.
    expect(queryByText('Add a venue')).toBeNull();
    expect(queryByText('Submit venue')).toBeNull();
  });
});

// =============================================================================
// 3. Postcode lookup cannot be triggered while signed out
// =============================================================================
describe('AddVenueScreen — postcode lookup is unreachable while signed out', () => {
  it('never invokes the geocode-postcode Edge Function on the signed-out path', async () => {
    mockStore({ session: null, isLoading: false });

    render(<AddVenueScreen />);

    await waitFor(() => {
      expect(mockRedirectHref).toHaveBeenCalledWith('/(auth)');
    });

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 4. Session-loading state must not redirect (no bounce for signed-in users)
// =============================================================================
describe('AddVenueScreen — cold-start loading guard', () => {
  it('renders nothing and does not redirect while the session is still loading', () => {
    mockStore({ session: null, isLoading: true });

    const { toJSON, queryByTestId } = render(<AddVenueScreen />);

    expect(toJSON()).toBeNull();
    expect(queryByTestId('redirect')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });
});
