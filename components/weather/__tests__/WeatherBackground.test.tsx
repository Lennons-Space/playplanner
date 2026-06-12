// Dedicated suite for the ambient weather backgrounds.
//
// Globally these components are stubbed (see jest.setup.js) because they are
// decorative. Here we un-stub and mount the REAL implementation with Reanimated
// and the weather hook mocked locally, so the suite is fast and leak-free while
// still exercising the condition→atmosphere mapping and a crash-free render of
// every atmosphere.

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

import { render } from '@testing-library/react-native';
import { WeatherBackground, resolveAtmosphere } from '@/components/weather/WeatherBackground';
import type { WeatherCondition } from '@/lib/weather';

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
});
