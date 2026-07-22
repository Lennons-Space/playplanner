/**
 * Tests for components/ui/ThemedBackground.tsx (Step 10A Part 2, dual-theme
 * foundation) — the background selector contract.
 *
 * Covers: dark mode renders the real, unchanged V2Background (same
 * atmosphere-tagged motion layer, no re-derivation); light mode ALSO renders
 * the real V2Background now (Phase A of the v2 Light-theme correction —
 * V2Background resolves mode internally via useAppTheme, so this wrapper no
 * longer branches or mounts a placeholder); and a source-guard proving
 * neither this component nor useAppTheme ever keys off the current
 * route/pathname (which would break the "atmosphere continuous across
 * navigation" guarantee — see components/ui/V2Background.tsx and the
 * wall-clock loopPhaseAt design).
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
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { useThemeStore } from '@/store/themeStore';

jest.mock('expo-linear-gradient', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, props, children),
  };
});

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

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
  mockUseColorScheme.mockReset();
  mockUseWeather.mockReset();
  // 'rain' (unlike 'clear') resolves to the same atmosphere regardless of
  // time-of-day (resolveAtmosphere's night/day split only affects 'clear' and
  // the unknown-condition fallback — see lib/weatherTheme.ts), so these
  // assertions stay deterministic no matter when the test suite runs.
  mockUseWeather.mockReturnValue({ condition: 'rain', temperatureC: 12, precipProbabilityPct: 80, emoji: '', label: '' });
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('ThemedBackground — dark mode selects the real V2Background, unchanged', () => {
  it('renders the v2-background layer and its atmosphere-tagged motion layer', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const tree = render(<ThemedBackground />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-background')).toBe(true);
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-rain')).toBe(true);
    expect(findTestID(tree as JsonNode, 'themed-background-light-placeholder')).toBe(false);
  });

  it('forwards an explicit `condition` prop straight through to V2Background, overriding the fetched value', () => {
    mockUseColorScheme.mockReturnValue('dark');
    // mockUseWeather is stubbed to 'rain' — if the prop were ignored, this
    // would render the rain motion layer instead of snow.
    const tree = render(<ThemedBackground condition="snow" />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-snow')).toBe(true);
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-rain')).toBe(false);
  });

  it('does not key off any route/pathname — an explicit "dark" preference renders the same, regardless of OS', () => {
    useThemeStore.setState({ preference: 'dark' });
    mockUseColorScheme.mockReturnValue('light'); // irrelevant once preference is explicit
    const tree = render(<ThemedBackground />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-background')).toBe(true);
  });
});

describe('ThemedBackground — light mode also renders the real V2Background', () => {
  it('renders the v2-background layer and its atmosphere-tagged motion layer', () => {
    mockUseColorScheme.mockReturnValue('light');
    const tree = render(<ThemedBackground />).toJSON();
    expect(findTestID(tree as JsonNode, 'v2-background')).toBe(true);
    // mockUseWeather is stubbed to 'rain' in beforeEach.
    expect(findTestID(tree as JsonNode, 'v2-weather-motion-rain')).toBe(true);
    expect(findTestID(tree as JsonNode, 'themed-background-light-placeholder')).toBe(false);
  });

  it('is absolute-fill and non-interactive, same decorative contract as dark', () => {
    mockUseColorScheme.mockReturnValue('light');
    const root = render(<ThemedBackground />).toJSON() as { props: Record<string, unknown> };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.testID).toBe('v2-background');
    expect(root.props.accessibilityElementsHidden).toBe(true);
  });

  it('DOES call useWeather in light mode now — V2Background is mounted, not a placeholder', () => {
    mockUseColorScheme.mockReturnValue('light');
    render(<ThemedBackground />);
    expect(mockUseWeather).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// ISSUE 2 AUDIT (3) — "system" preference: a LIVE device dark↔light flip must
// update the SAME mounted tree (RTL `rerender`, never a fresh `render`/
// remount) through the REAL resolution chain: this file does NOT mock
// useAppTheme — ThemedBackground → V2Background → useAppTheme →
// useThemeStore + the real react-native useColorScheme are all exercised
// end-to-end, exactly like a real screen. mockUseWeather stays fixed at
// 'rain' throughout so 'rain' vs the light warm-ambient set is the
// mode-differentiating signal (rain never renders in light — see
// V2WeatherMotion.tsx).
// ═════════════════════════════════════════════════════════════════════════
describe('ThemedBackground / useAppTheme — Issue 2 audit (3): "system" preference follows a LIVE OS flip on the SAME tree', () => {
  it('dark→light (OS flip, same tree): RainStreak colour disappears, warm haze/dust appear, no stale dark values', () => {
    useThemeStore.setState({ preference: 'system' });
    mockUseColorScheme.mockReturnValue('dark');
    const { toJSON, rerender } = render(<ThemedBackground />);
    let colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // dark RainStreak present

    mockUseColorScheme.mockReturnValue('light');
    rerender(<ThemedBackground />);
    colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(false); // no stale dark RainStreak
    expect(colors.some((c) => c.startsWith('rgba(246,224,180,') || c.startsWith('rgba(255,238,205,'))).toBe(true); // light haze now present
  });

  it('light→dark (OS flip, same tree): warm haze/dust disappear, RainStreak appears, no stale light values', () => {
    useThemeStore.setState({ preference: 'system' });
    mockUseColorScheme.mockReturnValue('light');
    const { toJSON, rerender } = render(<ThemedBackground />);
    let colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(246,224,180,') || c.startsWith('rgba(255,238,205,'))).toBe(true);

    mockUseColorScheme.mockReturnValue('dark');
    rerender(<ThemedBackground />);
    colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(246,224,180,') || c.startsWith('rgba(255,238,205,'))).toBe(false); // no stale light haze
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // dark RainStreak now present
  });

  it('an explicit "dark" preference ignores a live OS flip entirely (same tree)', () => {
    useThemeStore.setState({ preference: 'dark' });
    mockUseColorScheme.mockReturnValue('light'); // OS says light — must be ignored
    const { toJSON, rerender } = render(<ThemedBackground />);
    let colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // still dark

    mockUseColorScheme.mockReturnValue('dark'); // flip OS again — still irrelevant
    rerender(<ThemedBackground />);
    colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // unchanged, still dark
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
