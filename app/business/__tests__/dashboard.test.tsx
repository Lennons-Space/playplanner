/**
 * Unit + Security tests for BusinessDashboard (app/business/dashboard.tsx).
 *
 * Security focus:
 *   - Unauthenticated users must be redirected to login — never see the dashboard
 *   - The Supabase query must be disabled (enabled: false) when no user is present
 *   - No venue data is fetched for unauthenticated requests
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks — all jest.mock calls are hoisted; define stubs inside the factories
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Stack:  { Screen: 'View' },
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// Access mock functions after jest.mock is in place
import { router }    from 'expo-router';
import { useUser }   from '@/hooks/useAuth';
import { supabase }  from '@/lib/supabase';
import BusinessDashboard from '../dashboard';

const mockUseUser      = useUser         as jest.MockedFunction<typeof useUser>;
const mockRouterReplace = router.replace  as jest.Mock;
const mockFrom         = supabase.from   as jest.MockedFunction<typeof supabase.from>;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ======================================================================
// Unauthenticated — security guard
// ======================================================================
describe('BusinessDashboard — unauthenticated', () => {
  beforeEach(() => {
    mockUseUser.mockReturnValue(null);
  });

  it('renders null (blank screen) while the redirect is in flight', () => {
    const { toJSON } = render(<BusinessDashboard />, { wrapper: makeWrapper() });
    expect(toJSON()).toBeNull();
  });

  it('calls router.replace to the login screen', async () => {
    render(<BusinessDashboard />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/login');
    });
  });

  it('does not call supabase.from when user is null', () => {
    render(<BusinessDashboard />, { wrapper: makeWrapper() });
    // Query is enabled: !!user — when null it must not hit the DB
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ======================================================================
// Authenticated — empty state
// ======================================================================
describe('BusinessDashboard — authenticated, no venues', () => {
  beforeEach(() => {
    mockUseUser.mockReturnValue({ id: 'user-test-123' } as any);
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockResolvedValue({ data: [], error: null }),
    } as any);
  });

  it('renders the "Business Dashboard" heading', async () => {
    const { getByText } = render(<BusinessDashboard />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(getByText('Business Dashboard')).toBeTruthy();
    });
  });

  it('shows the "No claimed venues yet" empty state', async () => {
    const { getByText } = render(<BusinessDashboard />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(getByText('No claimed venues yet')).toBeTruthy();
    });
  });

  it('does not redirect to login when user is authenticated', async () => {
    render(<BusinessDashboard />, { wrapper: makeWrapper() });

    await waitFor(() => expect(mockRouterReplace).not.toHaveBeenCalled());
  });
});

// ======================================================================
// Authenticated — with venues
// ======================================================================
describe('BusinessDashboard — authenticated, with venues', () => {
  const fakeVenues = [
    {
      id: 'venue-001',
      name: 'Happy Tots Soft Play',
      city: 'London',
      is_premium: false,
      review_count: 12,
      average_rating: 4.5,
    },
    {
      id: 'venue-002',
      name: 'Jungle Adventure',
      city: 'Manchester',
      is_premium: true,
      review_count: 8,
      average_rating: 4.8,
    },
  ];

  beforeEach(() => {
    mockUseUser.mockReturnValue({ id: 'user-test-123' } as any);
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockResolvedValue({ data: fakeVenues, error: null }),
    } as any);
  });

  it('renders venue names', async () => {
    const { getByText } = render(<BusinessDashboard />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(getByText('Happy Tots Soft Play')).toBeTruthy();
      expect(getByText('Jungle Adventure')).toBeTruthy();
    });
  });

  it('shows "Upgrade to Premium" only for non-premium venues', async () => {
    const { getAllByText } = render(<BusinessDashboard />, { wrapper: makeWrapper() });

    await waitFor(() => {
      // Only one of the two venues is non-premium
      const upgradeBtns = getAllByText(/upgrade to premium/i);
      expect(upgradeBtns).toHaveLength(1);
    });
  });
});
