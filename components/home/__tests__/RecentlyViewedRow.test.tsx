/**
 * Tests for components/home/RecentlyViewedRow.tsx.
 * Covers: hidden when empty, hidden while loading, renders items when present.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { RecentlyViewedRow } from '@/components/home/RecentlyViewedRow';

const mockHook = jest.fn();
jest.mock('@/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => mockHook(),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(() => 'light'),
}));
// Keep the row test focused — stub the card (it pulls in expo-linear-gradient etc.).
jest.mock('@/components/home/ExploreCard', () => {
  const { Text } = require('react-native');
  return { ExploreCard: ({ venue }: { venue: { name: string } }) => <Text>{venue.name}</Text> };
});

describe('RecentlyViewedRow', () => {
  it('renders nothing when there are no items', () => {
    mockHook.mockReturnValue({ items: [], loading: false });
    const { queryByText } = render(<RecentlyViewedRow onVenuePress={jest.fn()} />);
    expect(queryByText('Continue exploring')).toBeNull();
  });

  it('renders nothing while loading', () => {
    mockHook.mockReturnValue({ items: [{ id: 'a', name: 'A' }], loading: true });
    const { queryByText } = render(<RecentlyViewedRow onVenuePress={jest.fn()} />);
    expect(queryByText('Continue exploring')).toBeNull();
  });

  it('renders the header and cards when items are present', () => {
    mockHook.mockReturnValue({
      items: [
        { id: 'a', name: 'Chester Zoo' },
        { id: 'b', name: 'Attingham Park' },
      ],
      loading: false,
    });
    const { getByText } = render(<RecentlyViewedRow onVenuePress={jest.fn()} />);
    expect(getByText('Continue exploring')).toBeTruthy();
    expect(getByText('Continue where you left off')).toBeTruthy();
    expect(getByText('Chester Zoo')).toBeTruthy();
    expect(getByText('Attingham Park')).toBeTruthy();
  });
});
