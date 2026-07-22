/**
 * Tests for app/(tabs)/index.tsx — the Play Planner v2 Browse (Home) screen
 * (EXACT final-jsx pass — Play Planner v2.html + pp2-home.jsx authority).
 *
 * Structure guarded here:
 *   - time-based greeting + 38px headline chrome;
 *   - weather-aware pick CTA card (hidden without weather data);
 *   - search pill with the 34×34 filter box INSIDE the pill (single
 *     non-wrapping row — the filter can never drop below the prompt);
 *   - single-line intent rail with INLINE Clear; NO age chips, NO uppercase
 *     section labels (those belonged to an older design iteration);
 *   - "Good for today" = EditorialCollectionHero routing to a REAL
 *     /discover collection (never a venue) — renders pre-consent too;
 *   - venue list is the ONLY consent-gated region: pre-consent shows the
 *     nudge and never calls useLocation()/useNearbyVenues(); post-consent
 *     renders real VenueCard2 rows with working save hearts;
 *   - no fabricated data: no duration meta, no debug watermark.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';

import { router } from 'expo-router';
import HomeScreen from '../index';
import { pickHeroCollection, getWeatherCta, getHomeContextLine } from '@/lib/homeIntents';
import type { Venue } from '@/types';

// ── Mocks (hoisted) ─────────────────────────────────────────────────
jest.mock('@/hooks/useAuth', () => ({
  useProfile: jest.fn(() => ({ full_name: 'Liam Evanson' })),
}));

const mockConsent = jest.fn(() => ({ status: 'undecided', grant: jest.fn(), decline: jest.fn() }));
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => mockConsent(),
}));

// useLocation is the ONLY hook allowed to fire the OS location prompt. Track
// every call so the pre-consent test can assert it was never invoked.
interface MockLocationResult {
  coords: { latitude: number; longitude: number } | null;
  hasPermission: boolean;
  isLoading: boolean;
  error: string | null;
}
const mockUseLocation = jest.fn<MockLocationResult, unknown[]>(() => ({
  coords: null,
  hasPermission: false,
  isLoading: false,
  error: null,
}));
jest.mock('@/hooks/location', () => ({
  useAreaLabel: jest.fn(() => null),
  useLocation: (...args: unknown[]) => mockUseLocation(...(args as [])),
}));

interface MockWeather {
  condition: string;
  label: string;
  emoji: string;
}
// Home (and, transitively, every <V2Background/> it mounts via
// ThemedBackground) reads the SINGLE shared hooks/useResolvedWeather.ts —
// mock THAT module boundary rather than the inner hooks/useWeather.ts it
// wraps, so both consumers stay in lockstep exactly as they do in the real
// app. Kept as `mockUseWeather` (unchanged name) so every existing
// `mockUseWeather.mockReturnValue({...})` call site in this file continues
// to work unmodified — it just now feeds the `weather` field of the fuller
// ResolvedWeather shape.
const mockUseWeather = jest.fn<MockWeather | null, unknown[]>(() => null);
jest.mock('@/hooks/useResolvedWeather', () => ({
  useResolvedWeather: (...args: unknown[]) => {
    const weather = mockUseWeather(...(args as []));
    return {
      weather,
      condition: weather?.condition ?? null,
      night: false,
      atmosphere: 'sunny',
      usingConsentedLocation: false,
    };
  },
}));

interface MockNearbyVenuesResult {
  data: Venue[];
  isLoading: boolean;
  error: null;
}
const mockUseNearbyVenues = jest.fn<MockNearbyVenuesResult, unknown[]>(() => ({
  data: [],
  isLoading: false,
  error: null,
}));
jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: (...args: unknown[]) => mockUseNearbyVenues(...(args as [])),
  useCategories: jest.fn(() => ({ data: [] })),
}));

jest.mock('@/hooks/useFavourites', () => ({
  useSavedVenueIds: jest.fn(() => ({ savedIds: new Set(), isLoading: false })),
  useToggleFavourite: jest.fn(() => ({ mutate: jest.fn() })),
}));

// DevWeatherTester (__DEV__-only manual weather QA harness, see
// components/dev/DevWeatherTester.tsx) reads a REAL react-query
// QueryClient via useQueryClient() — same pattern as the
// jest.setup.js-level WeatherBackground stub above: this suite tests
// Home's own chrome, not the dev harness (which has its own dedicated
// suite at components/dev/__tests__/DevWeatherTester.test.tsx), so it is
// stubbed here rather than wrapping every render() in this large file with
// a QueryClientProvider it otherwise has no reason to need.
const mockDevWeatherTester = jest.fn();
jest.mock('@/components/dev/DevWeatherTester', () => ({
  DevWeatherTester: (props: unknown) => {
    mockDevWeatherTester(props);
    return null;
  },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
}));

// Home reads the live tab bar height for its scroll bottom-padding. The screen
// is rendered standalone here (outside a bottom-tab navigator), where the real
// hook throws for lack of context — mock it to a fixed height.
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 88,
}));

// ── Venue fixture ────────────────────────────────────────────────────────
function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    slug: over.id,
    description: null,
    address_line1: null,
    address_line2: null,
    city: 'London',
    postcode: null,
    country: 'GB',
    category_id: null,
    latitude: 51.5,
    longitude: -0.1,
    phone: null,
    email: null,
    website: null,
    price_range: null,
    min_age: 0,
    max_age: 12,
    is_published: true,
    is_verified: false,
    is_premium: false,
    featured_until: null,
    claimed_by: null,
    submitted_by: null,
    moderation_status: 'approved',
    osm_id: null,
    data_source: null,
    license: null,
    moderation_notes: null,
    moderated_by: null,
    moderated_at: null,
    review_count: 12,
    average_rating: 4.6,
    photos: [],
    facilities: [],
    opening_hours: [],
    distance_km: 1,
    category: undefined,
    ...over,
  } as Venue;
}

function grantConsentWithVenues(data: Venue[]) {
  mockConsent.mockReturnValue({ status: 'granted', grant: jest.fn(), decline: jest.fn() });
  mockUseLocation.mockReturnValue({
    coords: { latitude: 51.5, longitude: -0.1 },
    hasPermission: true,
    isLoading: false,
    error: null,
  });
  mockUseNearbyVenues.mockReturnValue({ data, isLoading: false, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConsent.mockReturnValue({ status: 'undecided', grant: jest.fn(), decline: jest.fn() });
  mockUseLocation.mockReturnValue({ coords: null, hasPermission: false, isLoading: false, error: null });
  mockUseNearbyVenues.mockReturnValue({ data: [], isLoading: false, error: null });
  mockUseWeather.mockReturnValue(null);
});

describe('Browse (Home) — chrome (renders identically regardless of consent)', () => {
  it('renders the time-based greeting with the user first name', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText(/Good (morning|afternoon|evening|night), Liam/)).toBeTruthy();
  });

  it('renders the hero heading', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("What's the\nplan today?")).toBeTruthy();
  });

  it('renders the search pill and intent rail, with NO section labels (final jsx)', () => {
    const { getByLabelText, queryByText } = render(<HomeScreen />);
    expect(getByLabelText('Search venues')).toBeTruthy();
    expect(getByLabelText(/Rainy Day/)).toBeTruthy();
    expect(getByLabelText(/Burn Energy/)).toBeTruthy();
    // The uppercase section labels belonged to the older design iteration.
    expect(queryByText('What do you need today?')).toBeNull();
    expect(queryByText("Who's coming?")).toBeNull();
  });

  it('does not render age chips on Home (final jsx has none)', () => {
    const { queryByLabelText } = render(<HomeScreen />);
    expect(queryByLabelText('Toddlers')).toBeNull();
    expect(queryByLabelText('4–8 yrs')).toBeNull();
    expect(queryByLabelText('9–12 yrs')).toBeNull();
  });

  it('opens the search screen from the search pill', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Search venues'));
    expect(router.push as jest.Mock).toHaveBeenCalledWith('/(tabs)/search');
  });

  // ── "Your area" header: passive location display, NOT a manual area picker ──
  // Product decision (2026-07-13): the app uses the user's location; there is
  // no manual "Choose Area" flow. The header must show passive wording and its
  // only action is to open the Map (the real location surface).
  it('shows a PASSIVE "Near you" label and never a "Choose area" CTA when no area/postcode is known', () => {
    // beforeEach: consent undecided, useAreaLabel → null, profile.postcode → null.
    const { getByText, queryByText } = render(<HomeScreen />);
    expect(getByText('Your area')).toBeTruthy();
    expect(getByText('Near you')).toBeTruthy();
    // The misleading manual-picker copy must be gone.
    expect(queryByText('Choose area')).toBeNull();
    expect(queryByText('Choose Area')).toBeNull();
  });

  it('the area header opens the Map (its only action) — no manual area-selection flow', () => {
    const { getByLabelText } = render(<HomeScreen />);
    // The accessible label announces the passive area + that it opens the map,
    // never "choose"/"change"/"pick" an area.
    const header = getByLabelText('Your area: Near you — open map');
    expect(header).toBeTruthy();
    fireEvent.press(header);
    expect(router.push as jest.Mock).toHaveBeenCalledWith('/explore/map');
  });

  it('reveals an inline Clear pill in the intent rail once an intent is selected', () => {
    const { getByLabelText, queryByLabelText } = render(<HomeScreen />);
    expect(queryByLabelText('Clear filters')).toBeNull();
    fireEvent.press(getByLabelText(/Rainy Day/));
    expect(getByLabelText('Clear filters')).toBeTruthy();
    fireEvent.press(getByLabelText('Clear filters'));
    expect(queryByLabelText('Clear filters')).toBeNull();
  });

  it('does not render the dev version watermark', () => {
    const { queryByText } = render(<HomeScreen />);
    expect(queryByText(/^PP v/)).toBeNull();
  });

  it('ends the scroll viewport above the tab bar (tab-safe zone) with a bottom spacer', () => {
    const { getByTestId } = render(<HomeScreen />);
    const scroll = getByTestId('home-scroll');
    // The scroll VIEWPORT itself stops above the absolute tab bar — content
    // can never sit or pass beneath the bar, at rest or mid-scroll. Mocked:
    // useBottomTabBarHeight() → 88, insets.bottom → 34; defensive floor is
    // max(88, 52 + 34).
    const style = StyleSheet.flatten(scroll.props.style);
    expect(style.marginBottom).toBe(Math.max(88, 52 + 34));
    // Plus breathing room below the final card inside the viewport.
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(content.paddingBottom).toBeGreaterThanOrEqual(32);
  });
});

describe('Browse (Home) — search pill structure (final jsx: filter INSIDE the pill)', () => {
  it('pins the 34×34 filter box inside the pill, right edge, vertically centred — it can never stack below the prompt', () => {
    const { getByTestId } = render(<HomeScreen />);
    const pill = getByTestId('home-search-pill');
    const pillStyle = StyleSheet.flatten(pill.props.style);
    // VISIBLE bubble: surface fill + hairline ring + pill radius. Must be a
    // STATIC style object — the device build's NativeWind interop drops
    // style-as-function props, which made the bubble invisible on-device.
    expect(typeof pill.props.style).not.toBe('function');
    expect(pillStyle.backgroundColor).toBe('#17171F');
    expect(pillStyle.borderWidth).toBe(1);
    expect(pillStyle.borderRadius).toBeGreaterThan(0);
    // Fixed-height pill; prompt row reserves the filter zone on the right.
    expect(pillStyle.minHeight).toBe(56);
    expect(pillStyle.paddingRight).toBe(14 + 34 + 11);

    // Prompt row: icon + single-line text, horizontal, vertically centred.
    const promptRow = within(pill).getByTestId('home-search-pill-row');
    const rowStyle = StyleSheet.flatten(promptRow.props.style);
    expect(rowStyle.flexDirection).toBe('row');
    expect(rowStyle.alignItems).toBe('center');
    expect(within(promptRow).getByText('What are the kids in the mood for?').props.numberOfLines).toBe(1);

    // Filter box lives INSIDE the pill, absolutely pinned to the right and
    // centred between the pill's top and bottom edges — absolute positioning
    // means it is physically incapable of wrapping below the prompt.
    const filterBox = within(pill).getByTestId('home-filter-button');
    const boxStyle = StyleSheet.flatten(filterBox.props.style);
    expect(boxStyle.width).toBe(34);
    expect(boxStyle.height).toBe(34);
    const anchor = within(pill).getByTestId('home-filter-anchor');
    expect(within(anchor).getByTestId('home-filter-button')).toBeTruthy();
    const anchorStyle = StyleSheet.flatten(anchor.props.style);
    expect(anchorStyle.position).toBe('absolute');
    expect(anchorStyle.top).toBe(0);
    expect(anchorStyle.bottom).toBe(0);
    expect(anchorStyle.right).toBe(14);
    expect(anchorStyle.justifyContent).toBe('center');
  });
});

describe('Browse (Home) — weather-aware pick CTA', () => {
  it('is hidden while there is no weather data', () => {
    const { queryByTestId } = render(<HomeScreen />);
    expect(queryByTestId('home-weather-cta')).toBeNull();
  });

  it('renders the sunny CTA and routes to search', () => {
    mockUseWeather.mockReturnValue({ condition: 'clear', label: 'Sunny', emoji: '☀️' });
    const { getByTestId, getByText } = render(<HomeScreen />);
    expect(getByText(/Find outdoor spots/)).toBeTruthy();
    fireEvent.press(getByTestId('home-weather-cta'));
    expect(router.push as jest.Mock).toHaveBeenCalledWith('/(tabs)/search');
  });

  it('renders the rainy CTA copy for rain conditions', () => {
    mockUseWeather.mockReturnValue({ condition: 'rain', label: 'Rainy', emoji: '🌧' });
    const { getByText } = render(<HomeScreen />);
    expect(getByText(/See indoor picks/)).toBeTruthy();
  });
});

describe('Browse (Home) — "Good for today" editorial collection hero', () => {
  it('renders pre-consent (editorial content, not venue data)', () => {
    const { getByText, getByTestId } = render(<HomeScreen />);
    expect(getByText('Good for today')).toBeTruthy();
    expect(getByTestId('home-collection-hero')).toBeTruthy();
    expect(getByText('Explore →')).toBeTruthy();
  });

  it('routes to a real /discover collection, never a venue', () => {
    const { getByTestId } = render(<HomeScreen />);
    fireEvent.press(getByTestId('home-collection-hero'));
    expect(router.push as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/discover/[collection]',
        params: { collection: expect.stringMatching(/^(rainy-day|burn-energy|free-days-out|hidden-gems)$/) },
      }),
    );
  });
});

describe('Browse (Home) — __DEV__-only weather pill long-press → dev weather tester', () => {
  const originalDev = (global as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('__DEV__ true: wraps the weather pill in a long-press Pressable and mounts the (mocked) tester', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    mockUseWeather.mockReturnValue({ condition: 'clear', label: 'Sunny', emoji: '☀️' });
    const { getByLabelText } = render(<HomeScreen />);
    // Accessible label documents the long-press affordance — production
    // copy (__DEV__ false) never mentions "dev weather tester".
    const pill = getByLabelText(/Weather: Sunny\. Long-press for the dev weather tester\./);
    expect(pill.props.accessibilityRole).toBe('button');
    // The (mocked) DevWeatherTester component is mounted (though its Modal
    // stays closed until the long-press fires) — never absent in __DEV__.
    expect(mockDevWeatherTester).toHaveBeenCalled();
  });

  it('__DEV__ false: renders a plain non-pressable weather pill and never mounts the tester (production safety)', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    mockUseWeather.mockReturnValue({ condition: 'clear', label: 'Sunny', emoji: '☀️' });
    const { getByLabelText, queryByLabelText } = render(<HomeScreen />);
    // Production pill: plain text-role view, no long-press affordance in the
    // accessible label.
    const pill = getByLabelText('Weather: Sunny');
    expect(pill.props.accessibilityRole).toBe('text');
    expect(queryByLabelText(/Long-press for the dev weather tester/)).toBeNull();
    // The dev-only component must never mount at all in a production build —
    // this is the behavioural proof, not just hidden UI.
    expect(mockDevWeatherTester).not.toHaveBeenCalled();
  });
});

describe('pickHeroCollection — real-collection mapping (pure)', () => {
  // Args: (condition, intent, month, hour). Midday July unless stated.
  it('maps rain-family weather to the rainy-day collection', () => {
    expect(pickHeroCollection('rain', null, 6, 12).key).toBe('rainy-day');
    expect(pickHeroCollection('drizzle', null, 6, 12).key).toBe('rainy-day');
    expect(pickHeroCollection('thunderstorm', null, 6, 12).title).toBe('Rainy Day Picks');
  });

  it('maps night hours to Plan for Tomorrow (hidden-gems)', () => {
    const hero = pickHeroCollection('clear', null, 6, 22);
    expect(hero.title).toBe('Plan for Tomorrow');
    expect(hero.key).toBe('hidden-gems');
  });

  it('maps snow to Winter Days Out (hidden-gems)', () => {
    expect(pickHeroCollection('snow', null, 6, 12).title).toBe('Winter Days Out');
    expect(pickHeroCollection('snow', null, 6, 12).key).toBe('hidden-gems');
  });

  it('maps active intents to their real collections', () => {
    expect(pickHeroCollection('clear', 'energy', 3, 12).key).toBe('burn-energy');
    expect(pickHeroCollection('clear', 'free', 3, 12).key).toBe('free-days-out');
    expect(pickHeroCollection('clear', 'animals', 3, 12).key).toBe('hidden-gems');
  });

  it('falls back to season: summer → burn-energy, winter → hidden-gems, else Burn Energy', () => {
    expect(pickHeroCollection('clear', null, 7, 12).title).toBe('Summer Adventures');
    expect(pickHeroCollection('clear', null, 0, 12).title).toBe('Winter Days Out');
    expect(pickHeroCollection('clear', null, 3, 12).title).toBe('Burn Energy');
  });

  // 2026-07-19: mainly_clear (WMO 1) maps through toProtoKey's 'sunny' arm,
  // identically to 'clear' — additive, no new hero-collection behaviour.
  it('treats mainly_clear identically to clear for hero-collection purposes', () => {
    expect(pickHeroCollection('mainly_clear', null, 7, 12).title).toBe('Summer Adventures');
    expect(pickHeroCollection('mainly_clear', null, 6, 22).title).toBe('Plan for Tomorrow');
  });
});

describe('getWeatherCta / getHomeContextLine — mainly_clear sweep (pure)', () => {
  it('getWeatherCta gives mainly_clear the SAME sunny CTA as clear', () => {
    expect(getWeatherCta('mainly_clear')).toEqual(getWeatherCta('clear'));
  });

  it('getHomeContextLine gives mainly_clear the SAME sunny copy as clear', () => {
    const noon = new Date(2026, 6, 15, 12, 0);
    expect(getHomeContextLine('mainly_clear', noon)).toBe(getHomeContextLine('clear', noon));
  });
});

describe('Browse (Home) — pre-consent (undecided): no venues, no location call', () => {
  it('shows the location nudge instead of the venue list', () => {
    const { getByLabelText, queryByText } = render(<HomeScreen />);
    expect(getByLabelText('Turn on location to see venues near you')).toBeTruthy();
    expect(queryByText('Family favourites')).toBeNull();
  });

  it('never calls useLocation() (no OS permission prompt can fire pre-consent)', () => {
    render(<HomeScreen />);
    expect(mockUseLocation).not.toHaveBeenCalled();
  });

  it('never fires a nearby-venues query pre-consent', () => {
    render(<HomeScreen />);
    expect(mockUseNearbyVenues).not.toHaveBeenCalled();
  });

  it('routes into the consent-on-intent flow when the nudge is pressed', () => {
    const { getByLabelText } = render(<HomeScreen />);
    fireEvent.press(getByLabelText('Turn on location to see venues near you'));
    expect(router.push as jest.Mock).toHaveBeenCalledWith('/explore/results?mood=auto');
  });

  it('shows no venues while consent is still being checked', () => {
    mockConsent.mockReturnValue({ status: 'checking', grant: jest.fn(), decline: jest.fn() });
    render(<HomeScreen />);
    expect(mockUseLocation).not.toHaveBeenCalled();
    expect(mockUseNearbyVenues).not.toHaveBeenCalled();
  });

  it('shows the nudge when consent was declined', () => {
    mockConsent.mockReturnValue({ status: 'declined', grant: jest.fn(), decline: jest.fn() });
    const { getByLabelText } = render(<HomeScreen />);
    expect(getByLabelText('Turn on location to see venues near you')).toBeTruthy();
    expect(mockUseLocation).not.toHaveBeenCalled();
  });
});

describe('Browse (Home) — granted: real venue list renders', () => {
  beforeEach(() => {
    grantConsentWithVenues([
      venue({ id: 'v1', name: 'Bright Soft Play Barn', average_rating: 4.8, review_count: 20 }),
      venue({ id: 'v2', name: 'Riverside Park', average_rating: 4.1, review_count: 5 }),
    ]);
  });

  it('mounts useLocation only once consent is granted', () => {
    render(<HomeScreen />);
    expect(mockUseLocation).toHaveBeenCalled();
  });

  it('renders the venue list with header and subtitle', () => {
    // "updated just now" was dropped (Step 8) — the list is not actually
    // refreshed on a timer, so the phrase was a false recency claim. Two
    // "Near you" nodes are expected: the passive area header AND the venue
    // list subtitle (both fall back to the same passive copy here).
    const { getByText, getAllByText, queryByText, getByLabelText } = render(<HomeScreen />);
    expect(getByText('Family favourites')).toBeTruthy();
    expect(getAllByText('Near you')).toHaveLength(2);
    expect(queryByText(/updated just now/)).toBeNull();
    expect(getByLabelText('Bright Soft Play Barn')).toBeTruthy();
    expect(getByLabelText('Riverside Park')).toBeTruthy();
  });

  it('renders a save heart on every venue card (wired to real favourites)', () => {
    const { getAllByLabelText } = render(<HomeScreen />);
    expect(getAllByLabelText('Save venue')).toHaveLength(2);
  });

  it('renders no fabricated duration meta (the real app has no duration source)', () => {
    const { queryByText } = render(<HomeScreen />);
    expect(queryByText(/~\s?\d+(\.\d+)?\s?(hrs?|min)/)).toBeNull();
  });

  it('does not show the location nudge once granted', () => {
    const { queryByLabelText } = render(<HomeScreen />);
    expect(queryByLabelText('Turn on location to see venues near you')).toBeNull();
  });

  it('shows an honest empty state when there are no venues at all', () => {
    mockUseNearbyVenues.mockReturnValue({ data: [], isLoading: false, error: null });
    const { getByText } = render(<HomeScreen />);
    expect(getByText('No venues found nearby.')).toBeTruthy();
  });
});
