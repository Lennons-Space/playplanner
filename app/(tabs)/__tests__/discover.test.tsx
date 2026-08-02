/**
 * Tests for app/(tabs)/discover.tsx.
 *
 * Covers the fix for Discover being the only v2 tab that painted an opaque
 * `tokens.bg` fill instead of the shared atmosphere, and the only tab using
 * a hardcoded `paddingBottom: 48` instead of the real bottom-tab-bar
 * clearance every other tab computes via `useBottomTabBarHeight()`.
 *
 * Not re-tested here: collection membership/curation logic (lib/collections
 * has its own suite), CollectionCard's internal rendering (stubbed).
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, fireEvent } from '@testing-library/react-native';

import DiscoverScreen from '../discover';
import { useThemeStore } from '@/store/themeStore';

// ── expo-router ──────────────────────────────────────────────────────────
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

// ── safe-area / tab-bar height — same shape used across other tab tests ──
const mockUseBottomTabBarHeight = jest.fn(() => 74);
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockUseBottomTabBarHeight(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// ── ThemedBackground — not stubbed to null; give it a recognisable testID
// stand-in so we can assert it's actually mounted (the whole point of this
// fix), without pulling in the real weather/location dependency graph.
jest.mock('@/components/ui/ThemedBackground', () => {
  const { View } = require('react-native');
  return {
    ThemedBackground: () => <View testID="themed-background" />,
  };
});

// ── Icon — real component uses react-native-svg; keep it real (already
// exercised by other passing suites), just re-export from the barrel mock
// below alongside the barrel's other named exports Discover imports.
jest.mock('@/components/ui', () => {
  const actual = jest.requireActual('@/components/ui');
  return { ...actual };
});

// ── Collections data — deterministic fixture, no real curation logic ─────
jest.mock('@/lib/collections', () => ({
  DISCOVER_COLLECTIONS: ['rainyDay', 'burnEnergy'],
  COLLECTIONS: {
    rainyDay: { title: 'Rainy Day', gradient: ['#fff', '#eee'], accent: '#000', illustrationKey: 'rain', pillSlugs: [] },
    burnEnergy: { title: 'Burn Energy', gradient: ['#fff', '#eee'], accent: '#000', illustrationKey: 'energy', pillSlugs: [] },
  },
  getSeasonalCollection: () => ({
    title: 'Cosy Autumn Days',
    tagline: 'Fresh ideas for this season',
    gradient: ['#fff', '#eee'],
    accent: '#000',
    illustrationKey: 'sun',
    pillSlugs: [],
  }),
}));

// CollectionCard pulls in CollectionIllustration + gradients — irrelevant to
// this screen's atmosphere/layout fix, stub it to a tappable stand-in.
jest.mock('@/components/discover/CollectionCard', () => {
  const { Pressable, Text } = require('react-native');
  return {
    CollectionCard: ({ def, onPress }: { def: { title: string }; onPress: () => void }) => (
      <Pressable onPress={onPress} accessibilityRole="button">
        <Text>{def.title}</Text>
      </Pressable>
    ),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseBottomTabBarHeight.mockReturnValue(74);
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('Discover — shared v2 atmosphere', () => {
  it('mounts the shared <ThemedBackground/>, same as every other tab screen', () => {
    const { getByTestId } = render(<DiscoverScreen />);
    expect(getByTestId('themed-background')).toBeTruthy();
  });

  it('does not reference the removed shared WeatherBackground in its source', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../discover.tsx'), 'utf8');
    expect(src).not.toMatch(/WeatherBackground/);
  });
});

describe('Discover — real tab-safe-zone clearance', () => {
  // Behavioural, not just "was called": the ScrollView's actual rendered
  // marginBottom must equal the same Math.max(tabBarHeight, 52+insets.bottom)
  // formula every other tab screen uses (Home/Saved/Search/Profile) — proves
  // the real navigation-provided height is genuinely reflected in the
  // rendered layout, not just referenced somewhere in the component.
  it('reserves bottom space equal to the real tab-bar height when it exceeds the insets-based floor', () => {
    mockUseBottomTabBarHeight.mockReturnValue(120); // > 52 + 34 = 86
    const { UNSAFE_getByType } = render(<DiscoverScreen />);
    const { ScrollView } = require('react-native');
    const scrollView = UNSAFE_getByType(ScrollView);
    const { StyleSheet } = require('react-native');
    const style = StyleSheet.flatten(scrollView.props.style);
    expect(style.marginBottom).toBe(120);
  });

  it('falls back to the insets-based floor (52 + insets.bottom) when the real tab-bar height is smaller — never under-reserves', () => {
    mockUseBottomTabBarHeight.mockReturnValue(10); // < 52 + 34 = 86
    const { UNSAFE_getByType } = render(<DiscoverScreen />);
    const { ScrollView, StyleSheet } = require('react-native');
    const scrollView = UNSAFE_getByType(ScrollView);
    const style = StyleSheet.flatten(scrollView.props.style);
    expect(style.marginBottom).toBe(86); // 52 + 34, not the tiny 10
  });

  it('calls the real useBottomTabBarHeight() (not a hardcoded padding)', () => {
    render(<DiscoverScreen />);
    expect(mockUseBottomTabBarHeight).toHaveBeenCalled();
  });

  it('does not hardcode paddingBottom: 48 anywhere in its source', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../discover.tsx'), 'utf8');
    expect(src).not.toMatch(/paddingBottom:\s*48/);
  });

  it('the ScrollView itself carries no opaque backgroundColor (no hidden footer/white block beneath the content)', () => {
    const { UNSAFE_getByType } = render(<DiscoverScreen />);
    const { ScrollView, StyleSheet } = require('react-native');
    const scrollView = UNSAFE_getByType(ScrollView);
    const style = StyleSheet.flatten(scrollView.props.style);
    expect(style.backgroundColor).toBeUndefined();
  });

  it('never mounts BlurView (native module missing from the dev build — a real crash risk this screen\'s glass-adjacent safe-zone treatment could otherwise reintroduce)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../discover.tsx'), 'utf8');
    expect(src).not.toMatch(/BlurView/);
  });
});

describe('Discover — content preserved', () => {
  it('still renders the header, seasonal hero and collections mosaic', () => {
    const { getByText } = render(<DiscoverScreen />);
    expect(getByText('Discover')).toBeTruthy();
    expect(getByText('Seasonal Picks')).toBeTruthy(); // the SectionLabel eyebrow, not the hero card's own title
    expect(getByText('Cosy Autumn Days')).toBeTruthy(); // the seasonal hero card itself
    expect(getByText('Rainy Day')).toBeTruthy();
    expect(getByText('Burn Energy')).toBeTruthy();
  });

  it('still navigates to the collection page on tile press', () => {
    const { getByText } = render(<DiscoverScreen />);
    fireEvent.press(getByText('Rainy Day'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/discover/[collection]', params: { collection: 'rainyDay' } });
  });

  it('still navigates to Search from the header search icon', () => {
    const { getByLabelText } = render(<DiscoverScreen />);
    fireEvent.press(getByLabelText('Search venues, postcodes and tags'));
    expect(mockPush).toHaveBeenCalledWith('/search');
  });
});

describe('Discover — Light and Dark themes remain readable', () => {
  it('renders without crashing and keeps its content in Light mode', () => {
    useThemeStore.setState({ preference: 'light' });
    const { getByText } = render(<DiscoverScreen />);
    expect(getByText('Discover')).toBeTruthy();
  });

  it('renders without crashing and keeps its content in Dark mode', () => {
    useThemeStore.setState({ preference: 'dark' });
    const { getByText } = render(<DiscoverScreen />);
    expect(getByText('Discover')).toBeTruthy();
  });

  it('the title colour actually changes between Light and Dark (theme-aware, not a fixed literal)', () => {
    const { StyleSheet } = require('react-native');
    useThemeStore.setState({ preference: 'light' });
    const light = render(<DiscoverScreen />);
    const lightColor = StyleSheet.flatten(light.getByText('Discover').props.style).color;
    light.unmount();

    useThemeStore.setState({ preference: 'dark' });
    const dark = render(<DiscoverScreen />);
    const darkColor = StyleSheet.flatten(dark.getByText('Discover').props.style).color;

    expect(lightColor).not.toBe(darkColor);
  });
});
