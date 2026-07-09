// Smoke coverage for V2Background — the static Home atmosphere layer.
//
// Verifies: (1) it renders without throwing for a spread of weather
// conditions (including no data / unknown), and (2) it NEVER calls
// useLocation() — this component must be safe to mount before location
// consent is granted (it only reads the same coarse, cached weather fetch
// Home already makes).

import { render } from '@testing-library/react-native';
import { V2Background } from '@/components/ui/V2Background';

jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children),
  };
});

const mockUseWeather = jest.fn();
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...args),
}));

const mockUseLocation = jest.fn();
jest.mock('@/hooks/location', () => ({
  useLocation: (...args: unknown[]) => mockUseLocation(...args),
}));

beforeEach(() => {
  mockUseWeather.mockReset();
  mockUseLocation.mockReset();
  mockUseWeather.mockReturnValue(null);
});

describe('V2Background', () => {
  it('renders without throwing when weather has not loaded yet', () => {
    expect(() => render(<V2Background />)).not.toThrow();
  });

  it.each([
    ['clear' as const],
    ['partly_cloudy' as const],
    ['overcast' as const],
    ['rain' as const],
    ['thunderstorm' as const],
    ['snow' as const],
  ])('renders without throwing for condition=%s (via useWeather)', (condition) => {
    mockUseWeather.mockReturnValue({ condition, temperatureC: 10, precipProbabilityPct: 0, emoji: '', label: '' });
    expect(() => render(<V2Background />)).not.toThrow();
  });

  it('renders without throwing when an explicit condition prop is passed', () => {
    expect(() => render(<V2Background condition="rain" />)).not.toThrow();
  });

  it('renders without throwing for a null condition prop (forced fallback)', () => {
    expect(() => render(<V2Background condition={null} />)).not.toThrow();
  });

  it('is absolute-fill and non-interactive (decorative layer, never blocks touches)', () => {
    // Decorative layers are intentionally hidden from the accessibility tree
    // (accessibilityElementsHidden / importantForAccessibility), which also
    // excludes them from testing-library's default queries — so read the
    // rendered tree directly instead of getByTestId.
    const root = render(<V2Background />).toJSON() as { props: Record<string, unknown> };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.testID).toBe('v2-background');
  });

  it('never calls useLocation() — must be safe to mount before location consent', () => {
    render(<V2Background />);
    expect(mockUseLocation).not.toHaveBeenCalled();
  });
});
