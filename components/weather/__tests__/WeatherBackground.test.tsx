// Dedicated suite for the ambient weather backgrounds.
//
// Globally these components are stubbed (see jest.setup.js) because they are
// decorative. Here we un-stub and mount the REAL implementation with Reanimated
// and the weather hook mocked locally, so the suite is fast and leak-free while
// still exercising the condition→atmosphere mapping and a crash-free render of
// every atmosphere.

import { AccessibilityInfo } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import { WeatherBackground, resolveAtmosphere } from '@/components/weather/WeatherBackground';
import { useLoop, ATMOSPHERE } from '@/components/weather/WeatherLayer';
import { WEATHER_THEMES } from '@/lib/weatherTheme';
import type { WeatherCondition } from '@/lib/weather';

jest.unmock('@/components/weather/WeatherBackground');

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children),
  };
});

// Stub the weather fetch so no real network request is made.
const mockUseWeather = jest.fn();
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...args),
}));

// Walks a react-test-renderer JSON tree collecting every `colors` array — the
// stubbed LinearGradient passes its `colors` prop straight onto a host View, so
// this lets us assert which palette the background actually rendered.
function collectGradientColors(node: unknown, acc: string[][] = []): string[][] {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((n) => collectGradientColors(n, acc));
    return acc;
  }
  const n = node as { props?: { colors?: unknown }; children?: unknown };
  if (n.props && Array.isArray(n.props.colors)) acc.push(n.props.colors as string[]);
  if (n.children) collectGradientColors(n.children, acc);
  return acc;
}

beforeEach(() => {
  mockUseWeather.mockReset();
  mockUseWeather.mockReturnValue(null);
});

describe('resolveAtmosphere', () => {
  it('maps clear → sunny during the day and night when dark', () => {
    expect(resolveAtmosphere('clear', false)).toBe('sunny');
    expect(resolveAtmosphere('clear', true)).toBe('night');
  });

  it('maps cloud-family conditions → cloudy', () => {
    expect(resolveAtmosphere('partly_cloudy', false)).toBe('cloudy');
    expect(resolveAtmosphere('overcast', false)).toBe('cloudy');
    expect(resolveAtmosphere('fog', false)).toBe('cloudy');
  });

  it('maps all wet conditions → rain', () => {
    (['drizzle', 'rain', 'showers', 'thunderstorm'] as WeatherCondition[]).forEach((c) =>
      expect(resolveAtmosphere(c, false)).toBe('rain'),
    );
  });

  it('maps snow → snow', () => {
    expect(resolveAtmosphere('snow', false)).toBe('snow');
  });

  it('falls back to sunny when there is no data', () => {
    expect(resolveAtmosphere(null, false)).toBe('sunny');
    expect(resolveAtmosphere(undefined, false)).toBe('sunny');
  });
});

describe('WeatherBackground', () => {
  it('renders without crashing for every condition', () => {
    const conditions: (WeatherCondition | null)[] = [
      'clear',
      'partly_cloudy',
      'overcast',
      'fog',
      'drizzle',
      'rain',
      'showers',
      'thunderstorm',
      'snow',
      null,
    ];
    conditions.forEach((c) => {
      const { toJSON, unmount } = render(<WeatherBackground condition={c} />);
      expect(toJSON()).toBeTruthy();
      unmount();
    });
  });

  it('uses the fetched condition when no explicit prop is given', () => {
    mockUseWeather.mockReturnValue({
      condition: 'rain',
      temperatureC: 9,
      precipProbabilityPct: 80,
      emoji: '🌧',
      label: 'Rainy',
    });
    const { toJSON } = render(<WeatherBackground />);
    expect(toJSON()).toBeTruthy();
    expect(mockUseWeather).toHaveBeenCalled();
  });

  it('renders the immersive palette without crashing', () => {
    const { toJSON } = render(<WeatherBackground condition="rain" mode="immersive" />);
    expect(toJSON()).toBeTruthy();
  });
});

describe('reduced motion', () => {
  it('useLoop parks at its resting value and runs no animation when animate=false', () => {
    // animate=false models reduced-motion (or a backgrounded app): the driver
    // must hold a constant resting value rather than loop.
    const { result } = renderHook(() => useLoop(false, 1000));
    expect(result.current.value).toBe(0.5);
  });

  it('keeps the static weather gradient mounted even when reduced motion is enabled', () => {
    // Reduced motion must stop animation, NOT remove the static weather artwork.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const tree = render(<WeatherBackground condition="snow" mode="immersive" />).toJSON();
    const colors = collectGradientColors(tree);
    expect(colors).toContainEqual([...WEATHER_THEMES.snow.palette.base]);
  });
});

describe('active theme reaches the background (regression guard)', () => {
  it('immersive mode renders the cinematic theme palette, not the ambient one', () => {
    const tree = render(<WeatherBackground condition="rain" mode="immersive" />).toJSON();
    const colors = collectGradientColors(tree);
    expect(colors).toContainEqual([...WEATHER_THEMES.rain.palette.base]);
    expect(colors).not.toContainEqual([...ATMOSPHERE.rain.base]);
  });

  it('ambient mode (Search/Results/Map) renders the restrained ambient palette', () => {
    const tree = render(<WeatherBackground condition="rain" />).toJSON();
    const colors = collectGradientColors(tree);
    expect(colors).toContainEqual([...ATMOSPHERE.rain.base]);
    expect(colors).not.toContainEqual([...WEATHER_THEMES.rain.palette.base]);
  });

  it('uses the fetched condition (active weather), not a hard-coded fallback', () => {
    mockUseWeather.mockReturnValue({
      condition: 'rain',
      temperatureC: 9,
      precipProbabilityPct: 80,
      emoji: '🌧',
      label: 'Rainy',
    });
    const tree = render(<WeatherBackground mode="immersive" />).toJSON();
    const colors = collectGradientColors(tree);
    // Proves the fetched rain condition flowed through to the rendered palette,
    // rather than the screen silently falling back to the sunny default.
    expect(colors).toContainEqual([...WEATHER_THEMES.rain.palette.base]);
  });

  it('mounts as a non-interactive full-bleed layer (sits behind content)', () => {
    const tree = render(<WeatherBackground condition="clear" mode="immersive" />).toJSON() as {
      props: { pointerEvents?: string };
    };
    expect(tree.props.pointerEvents).toBe('none');
    // And it actually painted a gradient (it is mounted, not an empty layer).
    expect(collectGradientColors(tree).length).toBeGreaterThan(0);
  });
});
