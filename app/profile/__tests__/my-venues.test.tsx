/**
 * Tests for app/profile/my-venues.tsx
 *
 * Covers: loading state, empty state, venue list rendering, error state.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyVenues } from '@/hooks/useDataRights';
import MyVenuesScreen from '../my-venues';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  Stack: {
    Screen: 'View',
  },
  router: { push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({ user: { id: 'user-123' } }),
}));

jest.mock('@/hooks/useDataRights', () => ({
  useMyVenues: jest.fn(),
}));

jest.mock('@/components/profile/ModerationBadge', () => ({
  ModerationBadge: 'View',
}));

jest.mock('date-fns', () => ({
  format: jest.fn(() => '1 Jan 2024'),
}));

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockUseMyVenues = useMyVenues as jest.MockedFunction<typeof useMyVenues>;

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MyVenuesScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders loading state while data is fetching', () => {
    mockUseMyVenues.mockReturnValue({
      data: undefined, isLoading: true, isError: false,
    } as any);

    render(<MyVenuesScreen />, { wrapper: Wrapper });

    expect(screen.queryByText(/You haven/)).toBeNull();
    expect(screen.queryByText(/Could not load/)).toBeNull();
  });

  it('renders empty state when user has no submitted venues', () => {
    mockUseMyVenues.mockReturnValue({
      data: [], isLoading: false, isError: false,
    } as any);

    render(<MyVenuesScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/You haven't submitted any venues yet/)).toBeTruthy();
    expect(screen.getByText(/Submit a venue/)).toBeTruthy();
  });

  it('renders venue rows when data is loaded', () => {
    mockUseMyVenues.mockReturnValue({
      data: [
        {
          id: 'venue-1',
          name: 'Sunny Soft Play',
          city: 'Birmingham',
          postcode: 'B1 1AA',
          moderation_status: 'pending',
          created_at: '2024-03-01T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    } as any);

    render(<MyVenuesScreen />, { wrapper: Wrapper });

    expect(screen.getByText('Sunny Soft Play')).toBeTruthy();
    expect(screen.getByText('Birmingham')).toBeTruthy();
  });

  it('renders error state when query fails', () => {
    mockUseMyVenues.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
    } as any);

    render(<MyVenuesScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/Could not load your submitted venues/)).toBeTruthy();
  });
});
