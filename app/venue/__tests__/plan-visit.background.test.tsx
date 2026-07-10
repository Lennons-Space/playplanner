/**
 * Background-consistency regression test for the Plan Visit screen
 * (app/venue/plan-visit.tsx).
 *
 * Home already renders the animated v2 atmosphere (<V2Background/>). This
 * screen previously painted a flat opaque `pp.sand` (= T.bg) fill instead.
 * This test guards that the shared <V2Background/> is now mounted here too,
 * and that the screen still renders correctly.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PlanVisitScreen from '../plan-visit';
import type { Venue } from '@/types';

// ── expo / RN shims ─────────────────────────────────────────────────────────
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ venueId: 'v1', distance_km: '3.5' }),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(() => null),
}));

const venueFixture = {
  id: 'v1',
  name: 'Bright Soft Play Barn',
  description: 'A lovely indoor play barn.',
  address_line1: '1 Test Street',
  address_line2: null,
  city: 'London',
  postcode: 'SW1A 1AA',
  latitude: 51.5,
  longitude: -0.1,
  price_range: '££',
  min_age: 0,
  max_age: 5,
  review_count: 12,
  average_rating: 4.6,
  photos: [],
  opening_hours: [],
  category: { id: 'c1', name: 'Soft Play', slug: 'soft-play', icon: 'play', color: '#000' },
} as unknown as Venue;

const mockUseVenue = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useVenue: (...args: unknown[]) => mockUseVenue(...(args as [])),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    })),
  },
}));

// V2Background reads the same coarse weather fetch Home uses.
const mockUseWeather = jest.fn(() => null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

// Guards that the shared background path never triggers the OS location
// prompt — plan-visit.tsx has no direct import of this hook either.
const mockUseLocation = jest.fn();
jest.mock('@/hooks/location', () => ({
  useLocation: (...args: unknown[]) => mockUseLocation(...(args as [])),
}));

// ── helper: find a testID anywhere in a rendered tree (see
// components/ui/__tests__/V2Background.test.tsx for why toJSON() is needed
// instead of getByTestId — the background is hidden from the a11y tree). ──
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function containsTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => containsTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return containsTestID(node.children ?? null, testID);
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseVenue.mockReturnValue({ data: venueFixture, isLoading: false, error: null });
  mockUseWeather.mockReturnValue(null);
});

describe('Plan Visit — shared v2 background', () => {
  it('mounts the shared <V2Background/> behind the screen content', () => {
    const tree = render(<PlanVisitScreen />, { wrapper: makeWrapper() }).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('never calls useLocation() from the background path', () => {
    render(<PlanVisitScreen />, { wrapper: makeWrapper() });
    expect(mockUseLocation).not.toHaveBeenCalled();
  });

  it('still renders the venue name and quick actions (screen not broken)', () => {
    const { getByText, getByLabelText } = render(<PlanVisitScreen />, { wrapper: makeWrapper() });
    expect(getByText('Plan your visit')).toBeTruthy();
    expect(getByLabelText('Directions')).toBeTruthy();
    expect(getByLabelText('Add to Calendar')).toBeTruthy();
  });

  it('mounts the shared background on the loading state too', () => {
    mockUseVenue.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const tree = render(<PlanVisitScreen />, { wrapper: makeWrapper() }).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });
});
