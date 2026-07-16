/**
 * Tests for app/explore/results.tsx — the "Find something for us" results.
 *
 * Focus (not over-tested):
 *   1. Consent gate — undecided shows the consent prompt, not results.
 *   2. Granted → curated venues render with their honest "reason" pills.
 *   3. The "Open now" refine chip flips the server filter (openNow=true).
 *   4. (Step 8, v2 dark restyle) every consent state mounts the shared
 *      <V2Background/>; the legacy <WeatherBackground/> is fully gone;
 *      useWeather() is still called (curation/context-line data, not visuals).
 *
 * Curation correctness itself is covered by lib/__tests__/curation.test.ts;
 * here we only verify the screen wires data → curation → UI correctly.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type { Venue } from '@/types';

import ResultsScreen from '../results';

// ── Mocks (hoisted) ─────────────────────────────────────────────────
const mockConsent = jest.fn(() => ({ status: 'granted', grant: jest.fn(), decline: jest.fn() }));
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => mockConsent(),
}));

const mockUseLocation = jest.fn(() => ({ coords: { latitude: 51.5, longitude: -0.1 }, isLoading: false, error: null }));
jest.mock('@/hooks/location', () => ({
  useLocation: (...args: unknown[]) => mockUseLocation(...(args as [])),
}));

const mockUseWeather = jest.fn(() => null as { emoji: string; label: string; condition: string } | null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

const mockUseNearbyVenues = jest.fn();
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...args),
  // Return an empty category list so enrichedVenues works without erroring.
  useCategories: jest.fn(() => ({ data: [], isLoading: false, error: null })),
}));

// Real favourites — no fake state. Default: nothing saved, mutate is a no-op spy.
jest.mock('@/hooks/useFavourites', () => ({
  useSavedVenueIds: jest.fn(() => ({ savedIds: new Set(), isLoading: false })),
  useToggleFavourite: jest.fn(() => ({ mutate: jest.fn() })),
}));

const mockParams = jest.fn(() => ({ mood: 'auto' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
}));

// Consent prompt — stub so we can assert it appears without its internals.
// Props are captured so we can assert the dark variant is requested without
// changing consent semantics (copy/handlers/labels stay in the real component).
const mockConsentPromptProps = jest.fn();
jest.mock('@/components/consent', () => {
  const { Text } = require('react-native');
  return {
    LocationConsentPrompt: (props: Record<string, unknown>) => {
      mockConsentPromptProps(props);
      return <Text>consent-prompt</Text>;
    },
  };
});

function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    slug: over.id,
    category: undefined,
    price_range: null,
    min_age: 0,
    max_age: 12,
    is_premium: false,
    featured_until: null,
    review_count: 0,
    average_rating: 0,
    distance_km: 1,
    ...over,
  } as Venue;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConsent.mockReturnValue({ status: 'granted', grant: jest.fn(), decline: jest.fn() });
  mockParams.mockReturnValue({ mood: 'auto' });
  mockUseWeather.mockReturnValue(null);
  mockUseNearbyVenues.mockReturnValue({
    data: [], isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
  });
});

describe('ResultsScreen — consent gate', () => {
  it('shows the consent prompt when location is undecided', () => {
    mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    const { getByText } = render(<ResultsScreen />);
    expect(getByText('consent-prompt')).toBeTruthy();
  });

  it('requests the dark variant of the consent prompt (visual-only; same handlers/copy)', () => {
    mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    render(<ResultsScreen />);
    expect(mockConsentPromptProps).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'dark' }),
    );
  });
});

describe('ResultsScreen — curated results', () => {
  it('renders curated venues with reason pills', async () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [
        venue({ id: 'a', name: 'Sunny Soft Play', distance_km: 1 }),
        venue({ id: 'b', name: 'Riverside Park', distance_km: 2 }),
      ],
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });

    const { getByText, getAllByText } = render(<ResultsScreen />);

    await waitFor(() => expect(getByText('Sunny Soft Play')).toBeTruthy());
    expect(getByText('Riverside Park')).toBeTruthy();
    // Distance is shown inside VenueCard2, not as a separate reason pill.
    // We verify at least one venue card rendered (the distance pill was removed
    // in the June 2026 UX polish — it was redundant with what VenueCard2 shows).
    expect(getAllByText('Sunny Soft Play')).toHaveLength(1);
    expect(getAllByText('Riverside Park')).toHaveLength(1);
  });

  it('shows the empty state when nothing is curated', () => {
    mockUseNearbyVenues.mockReturnValue({
      data: [], isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
    const { getByText } = render(<ResultsScreen />);
    expect(getByText('Nothing matched just now')).toBeTruthy();
  });
});

describe('ResultsScreen — refine', () => {
  it('"Open now" chip flips the server openNow filter to true', () => {
    const { getByLabelText } = render(<ResultsScreen />);

    // Initial render: openNow is false.
    const firstCallFilters = mockUseNearbyVenues.mock.calls[0][1] as { openNow: boolean };
    expect(firstCallFilters.openNow).toBe(false);

    fireEvent.press(getByLabelText('Open now'));

    // After toggling, the hook is re-invoked with openNow=true.
    const lastCallFilters = mockUseNearbyVenues.mock.calls.at(-1)![1] as { openNow: boolean };
    expect(lastCallFilters.openNow).toBe(true);
  });
});

// =============================================================================
// Step 8 — v2 dark restyle: shared atmosphere + legacy background removal
// =============================================================================

// ── helper: find a testID anywhere in a rendered tree ───────────────────────
// V2Background is intentionally hidden from the accessibility tree, which
// also excludes it from testing-library's default queries — walk toJSON()
// directly instead (same helper as app/venue/__tests__/venueDetailBackground.test.tsx).
type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;
function containsTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => containsTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return containsTestID(node.children ?? null, testID);
}

describe('ResultsScreen — shared v2 background (every consent state)', () => {
  it('mounts <V2Background/> while consent status is "checking"', () => {
    mockConsent.mockReturnValue({ status: 'checking', grant: jest.fn(), decline: jest.fn() });
    const tree = render(<ResultsScreen />).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('mounts <V2Background/> while consent is "undecided" (behind the prompt)', () => {
    mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    const tree = render(<ResultsScreen />).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('mounts <V2Background/> once consent is "granted"', () => {
    mockConsent.mockReturnValue({ status: 'granted', grant: jest.fn(), decline: jest.fn() });
    const tree = render(<ResultsScreen />).toJSON();
    expect(containsTestID(tree, 'v2-background')).toBe(true);
  });

  it('mounts <V2Background/> when consent is "declined" (fallback-area path), and never calls useLocation()', () => {
    mockConsent.mockReturnValue({ status: 'declined', grant: jest.fn(), decline: jest.fn() });
    const { toJSON, getByText } = render(<ResultsScreen />);
    expect(containsTestID(toJSON(), 'v2-background')).toBe(true);
    // The honest fallback-area label must still render (dark restyle only).
    expect(getByText(/Showing a default area/)).toBeTruthy();
    // useLocation() lives only inside the granted branch (ResultsWithLocation) —
    // the declined path must never exercise it (no OS permission prompt).
    expect(mockUseLocation).not.toHaveBeenCalled();
  });

  it('never calls useLocation() while consent is "checking" or "undecided"', () => {
    mockConsent.mockReturnValue({ status: 'checking', grant: jest.fn(), decline: jest.fn() });
    render(<ResultsScreen />);
    expect(mockUseLocation).not.toHaveBeenCalled();

    mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
    render(<ResultsScreen />);
    expect(mockUseLocation).not.toHaveBeenCalled();
  });

  it('calls useLocation() once consent is granted', () => {
    mockConsent.mockReturnValue({ status: 'granted', grant: jest.fn(), decline: jest.fn() });
    render(<ResultsScreen />);
    expect(mockUseLocation).toHaveBeenCalled();
  });
});

describe('ResultsScreen — weather stays wired for curation data (not visuals)', () => {
  it('still calls useWeather() with the resolved coordinates', () => {
    render(<ResultsScreen />);
    expect(mockUseWeather).toHaveBeenCalledWith(51.5, -0.1);
  });

  it('renders the honest weather context line when weather data is available', () => {
    mockUseWeather.mockReturnValue({ emoji: '☀️', label: 'Sunny', condition: 'clear' });
    const { getByText } = render(<ResultsScreen />);
    expect(getByText(/☀️ Sunny · within \d+ miles/)).toBeTruthy();
  });
});

describe('ResultsScreen — legacy background fully removed (source guard)', () => {
  it('never imports the legacy <WeatherBackground/>', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../results.tsx'), 'utf8');
    expect(src).not.toMatch(/WeatherBackground/);
  });

  it('imports and mounts <V2Background/>', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../results.tsx'), 'utf8');
    expect(src).toMatch(/import\s*{\s*V2Background\s*}\s*from\s*'@\/components\/ui\/V2Background'/);
    expect(src).toMatch(/<V2Background\s*\/>/);
  });
});
