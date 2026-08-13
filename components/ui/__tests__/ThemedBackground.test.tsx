/**
 * Tests for components/ui/ThemedBackground.tsx — the background selector
 * contract.
 *
 * Covers: dark mode renders the real, unchanged V2Background (same
 * atmosphere-tagged motion layer, no re-derivation); light mode ALSO renders
 * the real V2Background (V2Background resolves mode internally via
 * useAppTheme, so this wrapper never branches or mounts a placeholder); a
 * mounted tree updates LIVE (RTL `rerender`, never a fresh `render`/remount)
 * when the resolved appearance changes underneath it — e.g. a 07:00/19:00
 * boundary crossing while the screen stays open (2026-08-13, automatic
 * day/night theme); and a source-guard proving neither this component nor
 * useAppTheme ever keys off the current route/pathname (which would break
 * the "atmosphere continuous across navigation" guarantee — see
 * components/ui/V2Background.tsx and the wall-clock loopPhaseAt design).
 *
 * Mode is forced directly via store/appearanceStore.ts — useAppTheme() no
 * longer reads the OS colour scheme or the legacy themeStore preference at
 * all (see hooks/useAppTheme.ts).
 *
 * Uses the same tree-walking testID lookup as V2Background.test.tsx /
 * plan-visit.atmosphereConsistency.test.tsx rather than getByTestId: these
 * layers are deliberately hidden from the accessibility tree
 * (accessibilityElementsHidden / importantForAccessibility), which also
 * excludes them from testing-library's default byTestId queries.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { useAppearanceStore } from '@/store/appearanceStore';

jest.mock('expo-linear-gradient', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

// V2Background reads the same coarse, cached weather fetch every v2 screen
// uses — force a deterministic condition so the dark-path assertions below
// don't depend on the time-of-day fallback.
const mockUseWeather = jest.fn();
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...args),
}));

type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;

function findTestID(node: JsonNode | JsonNode[], testID: string): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => findTestID(n, testID));
  if (node.props?.testID === testID) return true;
  return findTestID(node.children ?? null, testID);
}

/** Depth-first collection of every resolved `backgroundColor` anywhere in the tree (flattens array/object styles). */
function collectBackgroundColors(node: JsonNode, out: string[] = []): string[] {
  if (!node) return out;
  const style = node.props?.style;
  const styles = Array.isArray(style) ? style : [style];
  for (const s of styles) {
    const bg = (s as { backgroundColor?: string } | undefined)?.backgroundColor;
    if (typeof bg === 'string') out.push(bg);
  }
  for (const child of node.children ?? []) collectBackgroundColors(child, out);
  return out;
}

beforeEach(() => {
  mockUseWeather.mockReset();
  // 'rain' (unlike 'clear') resolves to the same atmosphere regardless of
  // time-of-day (resolveAtmosphere's night/day split only affects 'clear' and
  // the unknown-condition fallback — see lib/weatherTheme.ts), so these
  // assertions stay deterministic no matter when the test suite runs.
  mockUseWeather.mockReturnValue({ condition: 'rain', temperatureC: 12, precipProbabilityPct: 80, emoji: '', label: '' });
  useAppearanceStore.setState({ mode: 'dark' });
});

describe('ThemedBackground — dark mode selects the real V2Background, unchanged', () => {
  it('renders the v2-background layer and its atmosphere-tagged motion layer', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const tree = render(<ThemedBackground />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-background')).toBe(true);
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-rain')).toBe(true);
    expect(findTestID(tree as JsonNode, 'themed-background-light-placeholder')).toBe(false);
  });

  it('forwards an explicit `condition` prop straight through to V2Background, overriding the fetched value', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    // mockUseWeather is stubbed to 'rain' — if the prop were ignored, this
    // would render the rain motion layer instead of snow.
    const tree = render(<ThemedBackground condition="snow" />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-snow')).toBe(true);
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-rain')).toBe(false);
  });
});

describe('ThemedBackground — light mode also renders the real V2Background', () => {
  it('renders the v2-background layer and its atmosphere-tagged motion layer', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const tree = render(<ThemedBackground />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-background')).toBe(true);
    // mockUseWeather is stubbed to 'rain' in beforeEach.
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-rain')).toBe(true);
    expect(findTestID(tree as JsonNode, 'themed-background-light-placeholder')).toBe(false);
  });

  it('is absolute-fill and non-interactive, same decorative contract as dark', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const root = render(<ThemedBackground />).toJSON() as { props: Record<string, unknown> };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.testID).toBe('v2-background');
    expect(root.props.accessibilityElementsHidden).toBe(true);
  });

  it('DOES call useWeather in light mode now — V2Background is mounted, not a placeholder', () => {
    useAppearanceStore.setState({ mode: 'light' });
    render(<ThemedBackground />);
    expect(mockUseWeather).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Live boundary crossing: a mounted tree updates on the SAME instance (RTL
// `rerender`, never a fresh `render`/remount) when the app-wide appearance
// store recomputes — e.g. the device clock crossing 07:00/19:00 while the
// screen stays open. This exercises the real resolution chain end-to-end:
// ThemedBackground → V2Background → useAppTheme → appearanceStore (this file
// does not mock useAppTheme). mockUseWeather stays fixed at 'rain' throughout
// so 'rain' vs the light warm-ambient set is the mode-differentiating
// signal: dark rain renders the dark RainStreak (150,186,216); light rain
// renders the muted blue-grey LightRainStreak (92,112,140) — 2026-07-24
// Light-parity ruling, see V2WeatherMotion.tsx.
// ═════════════════════════════════════════════════════════════════════════
describe('ThemedBackground / useAppTheme — live appearance changes update the SAME mounted tree', () => {
  it('dark→light boundary crossing: dark RainStreak disappears, light rain streak appears, no stale dark values', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const { toJSON, rerender } = render(<ThemedBackground />);
    let colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // dark RainStreak present

    act(() => {
      useAppearanceStore.setState({ mode: 'light' });
    });
    rerender(<ThemedBackground />);
    colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(false); // no stale dark RainStreak
    expect(colors.some((c) => c.startsWith('rgba(92,112,140,'))).toBe(true); // muted blue-grey light rain streak now present
  });

  it('light→dark boundary crossing: light rain streak disappears, dark RainStreak appears, no stale light values', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const { toJSON, rerender } = render(<ThemedBackground />);
    let colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(92,112,140,'))).toBe(true); // light rain streak present

    act(() => {
      useAppearanceStore.setState({ mode: 'dark' });
    });
    rerender(<ThemedBackground />);
    colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(92,112,140,'))).toBe(false); // no stale light rain streak
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // dark RainStreak now present
  });
});

describe('ThemedBackground / useAppTheme — source guard: no route/pathname key', () => {
  it('ThemedBackground.tsx never reads the current route/pathname', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../ThemedBackground.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/usePathname|useSegments|useRoute\b|useNavigationState/);
  });

  it('useAppTheme.ts never reads the current route/pathname', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../hooks/useAppTheme.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/usePathname|useSegments|useRoute\b|useNavigationState/);
  });
});
