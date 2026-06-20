/**
 * Tests for the auth onboarding flow.
 *
 * Covers:
 *   1. Routing gate (index.tsx) — redirects based on SecureStore
 *   2. Skip on onboarding-1 — marks seen + navigates to welcome
 *   3. Get Started on onboarding-3 — marks seen + navigates to welcome
 *   4. Welcome screen CTAs — register and login navigation
 *
 * We avoid testing internals (styles, component tree depth). Each test
 * asserts a single observable behaviour so failures are easy to diagnose.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Screen imports — after all mocks are declared
// ---------------------------------------------------------------------------

import AuthIndex    from '../index';
import Onboarding1  from '../onboarding-1';
import Onboarding3  from '../onboarding-3';
import WelcomeScreen from '../welcome';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Jest before any import runs
// ---------------------------------------------------------------------------

// SecureStore: default returns null (onboarding not seen). Individual tests
// override with mockResolvedValueOnce to simulate the "seen" state.
const mockGetItemAsync = jest.fn().mockResolvedValue(null);
const mockSetItemAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// expo-router: capture push / replace calls without real navigation.
const mockPush    = jest.fn();
const mockReplace = jest.fn();
const mockBack    = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: (...a: unknown[]) => mockBack(...a) },
  Redirect: ({ href }: { href: string }) => {
    // Render a plain Text so we can query by its content in routing-gate tests.
    const { Text } = require('react-native');
    return <Text>{href}</Text>;
  },
}));

// SafeAreaView: pass children straight through — no layout engine in Jest.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// LinearGradient: used by welcome.tsx — render children so the tree is intact.
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

// Icon: thin stub that renders nothing — prevents SVG import errors in Jest.
jest.mock('@/components/ui', () => ({
  Icon: () => null,
}));

// constants/theme — use the real (pure) token module so all tokens resolve
// (the welcome/onboarding screens read Colors, FontFamily and BorderRadius).
jest.mock('@/constants/theme', () => jest.requireActual('@/constants/theme'));

// ---------------------------------------------------------------------------
// Shared reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Default: onboarding not yet seen
  mockGetItemAsync.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// 1. Routing gate
// ---------------------------------------------------------------------------

describe('AuthIndex — routing gate', () => {
  it('redirects to onboarding-1 when onboarding_complete is absent', async () => {
    mockGetItemAsync.mockResolvedValue(null);

    const { getByText } = render(<AuthIndex />);

    // After the async SecureStore check resolves, Redirect renders the href as text.
    await waitFor(() => {
      expect(getByText('/(auth)/onboarding-1')).toBeTruthy();
    });
  });

  it('redirects to welcome when onboarding_complete is "1"', async () => {
    mockGetItemAsync.mockResolvedValue('1');

    const { getByText } = render(<AuthIndex />);

    await waitFor(() => {
      expect(getByText('/(auth)/welcome')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Skip on onboarding-1
// ---------------------------------------------------------------------------

describe('Onboarding1 — Skip button', () => {
  it('calls SecureStore.setItemAsync with onboarding_complete=1 and navigates to welcome', async () => {
    const { getByLabelText } = render(<Onboarding1 />);

    fireEvent.press(getByLabelText('Skip onboarding'));

    await waitFor(() => {
      expect(mockSetItemAsync).toHaveBeenCalledWith('onboarding_complete', '1');
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome');
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Get Started on onboarding-3
// ---------------------------------------------------------------------------

describe('Onboarding3 — Get Started button', () => {
  it('calls SecureStore.setItemAsync with onboarding_complete=1 and navigates to welcome', async () => {
    const { getByLabelText } = render(<Onboarding3 />);

    fireEvent.press(getByLabelText('Get started with PlayPlanner'));

    await waitFor(() => {
      expect(mockSetItemAsync).toHaveBeenCalledWith('onboarding_complete', '1');
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Welcome screen CTAs
// ---------------------------------------------------------------------------

describe('WelcomeScreen — CTAs', () => {
  it('"Create free account" navigates to /(auth)/register', () => {
    const { getByLabelText } = render(<WelcomeScreen />);

    fireEvent.press(getByLabelText('Create a free account'));

    expect(mockPush).toHaveBeenCalledWith('/(auth)/register');
  });

  it('"Sign in" navigates to /(auth)/login', () => {
    const { getByLabelText } = render(<WelcomeScreen />);

    fireEvent.press(getByLabelText('Sign in to your existing account'));

    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
  });
});
