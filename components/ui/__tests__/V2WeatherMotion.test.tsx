/**
 * V2WeatherMotion — the lightweight animated layer of the v2 Home
 * background (sun pulse/bokeh, rain streaks, mist drift, star twinkle,
 * snowfall).
 *
 * Guards here:
 *   - renders without throwing for every atmosphere (the "animated
 *     background must not crash" requirement);
 *   - is decorative: non-interactive and hidden from the a11y tree;
 *   - fully stops (renders nothing) when the OS reduce-motion preference is
 *     on — the static V2Background gradients are the fallback look.
 */

import { AccessibilityInfo } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { V2WeatherMotion } from '@/components/ui/V2WeatherMotion';
import type { Atmosphere } from '@/lib/weatherTheme';

const ATMOSPHERES: Atmosphere[] = ['sunny', 'cloudy', 'rain', 'night', 'snow'];

describe('V2WeatherMotion', () => {
  it.each(ATMOSPHERES)('renders without throwing for atmosphere=%s', (atmosphere) => {
    expect(() => render(<V2WeatherMotion atmosphere={atmosphere} />)).not.toThrow();
  });

  it('is non-interactive and hidden from the accessibility tree', () => {
    const root = render(<V2WeatherMotion atmosphere="rain" />).toJSON() as {
      props: Record<string, unknown>;
    };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
  });

  it('renders nothing when the OS reduce-motion preference is on (static fallback)', async () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere="snow" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
    spy.mockRestore();
  });
});
