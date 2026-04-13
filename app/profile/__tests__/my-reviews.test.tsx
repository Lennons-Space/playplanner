/**
 * Tests for app/profile/my-reviews.tsx
 *
 * Covers: loading state, empty state, review list rendering, error state.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyReviews } from '@/hooks/useDataRights';
import MyReviewsScreen from '../my-reviews';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  Stack: {
    // Factory must not use JSX — React is not available inside jest.mock factories.
    // Use a string component name so RN test renderer can handle it.
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
  useMyReviews:  jest.fn(),
  useDeleteReview: jest.fn(() => ({ mutate: jest.fn() })),
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

const mockUseMyReviews = useMyReviews as jest.MockedFunction<typeof useMyReviews>;

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MyReviewsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders loading state while data is fetching', () => {
    mockUseMyReviews.mockReturnValue({
      data: undefined, isLoading: true, isError: false,
    } as any);

    render(<MyReviewsScreen />, { wrapper: Wrapper });

    // Neither empty state nor error state should appear while loading
    expect(screen.queryByText(/You haven/)).toBeNull();
    expect(screen.queryByText(/Could not load/)).toBeNull();
  });

  it('renders empty state when user has no reviews', () => {
    mockUseMyReviews.mockReturnValue({
      data: [], isLoading: false, isError: false,
    } as any);

    render(<MyReviewsScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/You haven't written any reviews yet/)).toBeTruthy();
    expect(screen.getByText(/Explore venues/)).toBeTruthy();
  });

  it('renders review cards when data is loaded', () => {
    mockUseMyReviews.mockReturnValue({
      data: [
        {
          id: 'rev-1',
          rating: 4,
          title: 'Great place',
          body: 'Really enjoyed it',
          moderation_status: 'approved',
          created_at: '2024-06-01T00:00:00Z',
          venues: { name: 'Park Central', city: 'London' },
        },
      ],
      isLoading: false,
      isError: false,
    } as any);

    render(<MyReviewsScreen />, { wrapper: Wrapper });

    expect(screen.getByText('Park Central')).toBeTruthy();
    expect(screen.getByText('Really enjoyed it')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('renders error state when query fails', () => {
    mockUseMyReviews.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
    } as any);

    render(<MyReviewsScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/Could not load your reviews/)).toBeTruthy();
  });
});
