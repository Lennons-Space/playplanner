/**
 * Tests for app/business/upgrade.tsx — payments-postponed behaviour.
 *
 * Core requirement: while payments are disabled (no Stripe key, e.g. EAS
 * preview / beta), the upgrade route must show an honest "Coming soon" screen
 * — never the live paywall, never a checkout CTA, never an edge-function call.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import UpgradeScreen from '../upgrade';

// Force payments OFF for this suite (simulates a build with no Stripe key).
jest.mock('@/constants/features', () => ({ PAYMENTS_ENABLED: false }));

// Stub the paywall's heavy deps so importing the module never pulls in the
// native Stripe SDK or the checkout hook. None of these run on the Coming-soon
// path (it returns before the paywall body), but the imports load at module level.
jest.mock('@/hooks/useSubscribe', () => ({
  useSubscribe: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/stripe', () => ({
  fetchPlanPriceIds: jest.fn(),
  PLAN_DETAILS: {},
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

describe('UpgradeScreen — payments disabled', () => {
  it('shows the "Coming soon" screen, not the live paywall', () => {
    const { getByText, queryByText } = render(<UpgradeScreen />);

    expect(getByText('Premium is coming soon')).toBeTruthy();
    expect(getByText('Back to dashboard')).toBeTruthy();

    // None of the live-paywall affordances should be present.
    expect(queryByText('Choose your plan')).toBeNull();
    expect(queryByText(/Subscribe/)).toBeNull();
  });
});
