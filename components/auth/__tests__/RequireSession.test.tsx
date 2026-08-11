/**
 * Unit tests for components/auth/RequireSession.tsx — the deep-link auth
 * guard used by root-Stack routes that live outside app/(tabs) (currently
 * app/explore/map.tsx and app/venue/add.tsx — see those files' own tests for
 * route-specific proof).
 *
 * This mirrors app/(tabs)/__tests__/tabsLayout.test.tsx's own auth-guard
 * tests exactly, because RequireSession reuses that layout's exact guard
 * logic (same store, same isLoading/session read order, same redirect
 * target) — see the component's doc comment for why there is only one
 * gating mechanism in the app, not two.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Imports (after mocks) ───────────────────────────────────────────────────
import { useAuthStore } from '@/store/authStore';
import { RequireSession } from '../RequireSession';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockRedirectHref = jest.fn();
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => {
      mockRedirectHref(href);
      return <View testID="redirect" />;
    },
  };
});

jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

/** Same selector-driving helper as tabsLayout.test.tsx's mockStore(). */
function mockStore(state: { session: unknown; isLoading: boolean }) {
  mockUseAuthStore.mockImplementation((selector) => selector(state as unknown as AuthStoreState));
}

function Guarded() {
  const { Text } = require('react-native');
  return <Text testID="protected-content">Protected</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('RequireSession — cold-start loading guard', () => {
  it('renders null (no children, no redirect) while isLoading=true, regardless of session', () => {
    mockStore({ session: null, isLoading: true });

    const { toJSON, queryByTestId } = render(
      <RequireSession>
        <Guarded />
      </RequireSession>,
    );

    expect(toJSON()).toBeNull();
    expect(queryByTestId('protected-content')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });
});

describe('RequireSession — unauthenticated redirect', () => {
  it('redirects to /(auth) and does NOT render children when isLoading=false and session=null', () => {
    mockStore({ session: null, isLoading: false });

    const { getByTestId, queryByTestId } = render(
      <RequireSession>
        <Guarded />
      </RequireSession>,
    );

    expect(getByTestId('redirect')).toBeTruthy();
    expect(mockRedirectHref).toHaveBeenCalledWith('/(auth)');
    // The guarded content must never mount on the redirect path — proves the
    // child component's own function body never executes (not merely that
    // its element was withheld from the tree), which is what prevents any
    // pre-redirect flash of the protected screen.
    expect(queryByTestId('protected-content')).toBeNull();
  });
});

describe('RequireSession — authenticated render', () => {
  it('renders children and does not redirect when isLoading=false and a session is present', () => {
    mockStore({
      session: { access_token: 'tok', user: { id: 'user-1' } },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <RequireSession>
        <Guarded />
      </RequireSession>,
    );

    expect(getByTestId('protected-content')).toBeTruthy();
    expect(queryByTestId('redirect')).toBeNull();
    expect(mockRedirectHref).not.toHaveBeenCalled();
  });
});
