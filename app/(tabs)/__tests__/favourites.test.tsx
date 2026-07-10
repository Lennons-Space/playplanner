/**
 * Saved tab (app/(tabs)/favourites.tsx) — v2 dark screen tests.
 *
 * Covers: the shared <V2Background/> mounts in every state (grid, empty,
 * signed-out), the prototype header renders (eyebrow / title / "{n} saved"),
 * real venue rows render as cards, tapping a card navigates to Venue Detail,
 * the unsave heart fires the real favourites delete, the empty state shows
 * the v2 copy, and the background path never calls useLocation().
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import FavouritesScreen from '../favourites';

// Expected 2-col grid cell: half the width left after the two 16px outer
// gutters and the single 10px inter-card gap (mirrors cardSize in the screen).
const WINDOW_WIDTH = Dimensions.get('window').width;
const EXPECTED_CARD_SIZE = Math.floor((WINDOW_WIDTH - 16 * 2 - 10) / 2);

// ── expo / RN shims ─────────────────────────────────────────────────────────
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 64,
}));

const mockUseUser = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
  useUser: () => mockUseUser(),
}));

// V2Background reads the same coarse weather fetch Home uses — default it to
// "no data" so the time-aware fallback path runs, exactly like on device
// before the fetch resolves.
const mockUseWeather = jest.fn(() => null);
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...(args as [])),
}));

// Guards that the Saved tab never triggers the OS location prompt — the
// screen has no direct import of this hook and must stay that way (distance
// was deliberately NOT ported from the prototype for this reason).
const mockUseLocation = jest.fn();
jest.mock('@/hooks/location', () => ({
  useLocation: (...args: unknown[]) => mockUseLocation(...(args as [])),
}));

// ── Supabase mock: one thenable builder supports both chains ───────────────
// select chain: .from().select().eq().order()  → order resolves the rows
// delete chain: .from().delete().eq().eq()     → awaiting the builder resolves
type BuilderResult = { data?: unknown; error: unknown };
function makeBuilder(result: BuilderResult) {
  const b: Record<string, unknown> = {};
  b.select = jest.fn(() => b);
  b.delete = jest.fn(() => b);
  b.eq = jest.fn(() => b);
  b.order = jest.fn(() => Promise.resolve(result));
  b.then = (resolve: (r: BuilderResult) => unknown) =>
    Promise.resolve(result).then(resolve);
  return b as Record<string, jest.Mock> & PromiseLike<BuilderResult>;
}

let builder = makeBuilder({ data: [], error: null });
const mockFrom = jest.fn(() => builder);
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...(args as [])) },
}));

// ── Fixtures: shaped exactly like the favourites join rows ─────────────────
const favRowsFixture = [
  {
    id: 'fav-1',
    venue_id: 'v1',
    venue: {
      id: 'v1',
      name: 'Bright Soft Play Barn',
      is_premium: false,
      average_rating: 4.6,
      category: { id: 'c1', name: 'Soft Play', icon: 'play', color: '#8E6BD8', slug: 'soft-play' },
      venue_photos: [{ url: 'https://example.test/p1.jpg', is_cover: true, sort_order: 0, status: 'approved' }],
    },
  },
  {
    id: 'fav-2',
    venue_id: 'v2',
    venue: {
      id: 'v2',
      name: 'Riverside Park',
      is_premium: false,
      average_rating: 0,
      category: { id: 'c2', name: 'Park', icon: 'tree', color: '#5BC08A', slug: 'park' },
      venue_photos: [], // no photo → CategoryPlaceholder branch
    },
  },
];

// ── helper: find a testID anywhere in a rendered tree (V2Background is
// hidden from the a11y tree — see components/ui/__tests__/V2Background.test.tsx). ──
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
  mockUseUser.mockReturnValue({ id: 'u1' });
  mockUseWeather.mockReturnValue(null);
  builder = makeBuilder({ data: favRowsFixture, error: null });
});

describe('Saved tab — v2 grid', () => {
  it('renders the prototype header with the real saved count', async () => {
    const { findByText, getByText } = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    expect(await findByText('Your favourites')).toBeTruthy();
    expect(getByText('Saved places')).toBeTruthy();
    expect(getByText('2 saved')).toBeTruthy();
  });

  it('renders a card per saved venue from the real query rows', async () => {
    const { findByText, getByText, queryByText } = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    expect(await findByText('Bright Soft Play Barn')).toBeTruthy();
    expect(getByText('Riverside Park')).toBeTruthy();
    // Rating: shown only when a real numeric rating exists — Riverside Park
    // has average_rating 0 (no reviews), so no rating row renders for it at
    // all (no fabricated value, no "–" placeholder).
    expect(getByText('4.6')).toBeTruthy();
    expect(queryByText('–')).toBeNull();
    expect(queryByText('0.0')).toBeNull();
  });

  it('sizes cards as fixed 2-column grid cells (square, from window width)', async () => {
    const screen = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    await screen.findByText('Bright Soft Play Barn');
    // The SIZED element is the plain-View card wrapper (testID), not the
    // touchable inside it — the wrapper is the layout boundary on device.
    const card = screen.getByTestId('saved-card-v1');
    const style = StyleSheet.flatten(card.props.style);
    expect(style.width).toBe(EXPECTED_CARD_SIZE);
    expect(style.height).toBe(EXPECTED_CARD_SIZE);
    expect(style.overflow).toBe('hidden'); // children physically cannot exceed the cell
  });

  it('a single saved venue keeps its grid cell — never stretches full width', async () => {
    builder = makeBuilder({ data: [favRowsFixture[0]], error: null });
    const screen = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    await screen.findByText('Bright Soft Play Barn');
    const style = StyleSheet.flatten(screen.getByTestId('saved-card-v1').props.style);
    expect(style.width).toBe(EXPECTED_CARD_SIZE);
    expect(style.height).toBe(EXPECTED_CARD_SIZE);
    expect(style.width).toBeLessThan(WINDOW_WIDTH - 16 * 2); // strictly narrower than the content width
    expect(style.flex).toBeUndefined();       // explicit size, not flex stretch
    expect(style.width).not.toBe('100%');     // and no percentage stretch either
  });

  it('mounts the shared <V2Background/> behind the grid', async () => {
    const screen = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    await screen.findByText('Your favourites');
    expect(containsTestID(screen.toJSON(), 'v2-background')).toBe(true);
  });

  it('opens Venue Detail when a card is tapped', async () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    const { findByLabelText } = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    fireEvent.press(await findByLabelText('Bright Soft Play Barn'));
    expect(router.push).toHaveBeenCalledWith('/venue/v1');
  });

  it('unsave heart deletes the favourite row (real mutation semantics)', async () => {
    const { findByLabelText } = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    fireEvent.press(await findByLabelText('Remove Bright Soft Play Barn from favourites'));
    await waitFor(() => {
      expect(builder.delete).toHaveBeenCalled();
    });
    expect(mockFrom).toHaveBeenCalledWith('favourites');
    expect(builder.eq).toHaveBeenCalledWith('id', 'fav-1');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('never calls useLocation() — distance was deliberately not ported', async () => {
    const screen = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    await screen.findByText('Your favourites');
    expect(mockUseLocation).not.toHaveBeenCalled();
  });
});

describe('Saved tab — empty state', () => {
  it('shows the v2 empty state with a real zero count and the background', async () => {
    builder = makeBuilder({ data: [], error: null });
    const screen = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByText('0 saved')).toBeTruthy();
    expect(screen.getByText('Tap the heart on any venue to save it here for later.')).toBeTruthy();
    expect(containsTestID(screen.toJSON(), 'v2-background')).toBe(true);
  });
});

describe('Saved tab — signed out', () => {
  it('shows the sign-in state over the background and routes to login', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    mockUseUser.mockReturnValue(null);
    const screen = render(<FavouritesScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText('Save your favourite places')).toBeTruthy();
    expect(containsTestID(screen.toJSON(), 'v2-background')).toBe(true);
    fireEvent.press(screen.getByLabelText('Sign in to save favourites'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/login');
    // No favourites fetch is attempted while signed out.
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
