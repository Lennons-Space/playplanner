/**
 * Tests for components/dev/DevWeatherTester.tsx — the __DEV__-only manual
 * weather/atmosphere QA harness (store/devWeatherStore.ts).
 *
 * Covers:
 *   - No-PII rendering: the modal must never surface a coordinate, email, or
 *     postcode anywhere in its rendered text — the "Location source" line is
 *     always one of two literal, non-personal strings, driven by a BOOLEAN
 *     prop (usingConsentedLocation), never a coordinate value.
 *   - Option presses call the store's setOverride/clear correctly (including
 *     the "Live weather (reset)" row calling clear(), not setOverride(null)),
 *     and the NEW distinct "Mainly clear" (WMO 1) row.
 *   - The Force-night switch calls setForceNight.
 *   - The ACTIVE badge tracks the current override.
 *   - The diagnostics readout reflects the props passed in (resolvedCondition,
 *     weather, usingConsentedLocation) rather than inventing its own values.
 *
 * This component no longer touches react-query (the old query-key-guessing
 * diagnostic was removed as part of the consent-gated location fix — it
 * would have silently pointed at the wrong cache key once granted users
 * stopped always using FALLBACK_LOCATION) — no QueryClientProvider needed.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { DevWeatherTester } from '../DevWeatherTester';
import { useDevWeatherStore } from '@/store/devWeatherStore';
import type { WeatherState } from '@/lib/weather';

function renderTester(props: Partial<React.ComponentProps<typeof DevWeatherTester>> = {}) {
  return render(
    <DevWeatherTester
      visible
      onClose={jest.fn()}
      resolvedCondition={null}
      weather={null}
      usingConsentedLocation={false}
      {...props}
    />,
  );
}

const liveWeather: WeatherState = {
  condition: 'rain',
  temperatureC: 11,
  precipProbabilityPct: 80,
  emoji: '🌧',
  label: 'Rainy',
  weathercode: 61,
};

let getHoursSpy: jest.SpyInstance;

beforeEach(() => {
  useDevWeatherStore.setState({ override: null, forceNight: null });
  // Pin the wall clock to daytime (13:00) so tests asserting the resolved
  // atmosphere are deterministic regardless of when the suite runs —
  // isNightNow() reads the REAL clock (20:00–06:00 = night), which made the
  // mainly_clear → 'sunny' assertion below fail on any evening test run.
  // Same Date.prototype.getHours spy pattern as V2Background.test.tsx
  // (fake timers would collide with the Reanimated frame-callback mock).
  // The Force-night test is unaffected: forceNight overrides the clock.
  getHoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(13);
});

afterEach(() => {
  getHoursSpy.mockRestore();
});

describe('DevWeatherTester — renders', () => {
  it('renders the sheet and every condition option, including the new distinct "Mainly clear"', () => {
    const { getByTestId, getByLabelText } = renderTester();
    expect(getByTestId('dev-weather-tester-sheet')).toBeTruthy();
    expect(getByLabelText('Live weather (reset)')).toBeTruthy();
    expect(getByLabelText('Clear')).toBeTruthy();
    expect(getByLabelText('Mainly clear')).toBeTruthy();
    expect(getByLabelText('Partly cloudy')).toBeTruthy();
    expect(getByLabelText('Overcast')).toBeTruthy();
    expect(getByLabelText('Mist / fog')).toBeTruthy();
    expect(getByLabelText('Drizzle')).toBeTruthy();
    expect(getByLabelText('Rain')).toBeTruthy();
    expect(getByLabelText('Rain (heavy)')).toBeTruthy();
    expect(getByLabelText('Showers')).toBeTruthy();
    expect(getByLabelText('Snow')).toBeTruthy();
    expect(getByLabelText('Thunderstorm')).toBeTruthy();
  });
});

describe('DevWeatherTester — no PII ever rendered', () => {
  // Matches a coordinate-like decimal with >=3 decimal places (the app's own
  // FALLBACK_LOCATION / real GPS coords always carry this much precision) —
  // this must NEVER appear anywhere in the tester's rendered text.
  const COORD_LIKE = /-?\d+\.\d{3,}/;
  const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
  const UK_POSTCODE_LIKE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i;

  function collectText(node: unknown, out: string[] = []): string[] {
    if (node == null) return out;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return out;
    }
    if (Array.isArray(node)) {
      node.forEach((n) => collectText(n, out));
      return out;
    }
    const n = node as { children?: unknown };
    if (n.children != null) collectText(n.children, out);
    return out;
  }

  it.each([false, true])(
    'renders no coordinate-like value for usingConsentedLocation=%s, even with a live weather reading present',
    (usingConsentedLocation) => {
      const { toJSON } = renderTester({
        resolvedCondition: 'rain',
        weather: liveWeather,
        usingConsentedLocation,
      });
      const allText = collectText(toJSON()).join(' | ');
      expect(allText).not.toMatch(COORD_LIKE);
    },
  );

  it('renders no email-like or UK-postcode-like string', () => {
    const { toJSON } = renderTester({ resolvedCondition: 'clear', weather: liveWeather });
    const allText = collectText(toJSON()).join(' | ');
    expect(allText).not.toMatch(EMAIL_LIKE);
    expect(allText).not.toMatch(UK_POSTCODE_LIKE);
  });

  it('the location source line is a literal non-personal label, never a real location value — pre-consent/fallback', () => {
    const { getByText } = renderTester({ resolvedCondition: 'clear', weather: liveWeather, usingConsentedLocation: false });
    expect(getByText('Location source: coarse fallback, pre-consent (non-personal)')).toBeTruthy();
  });

  it('the location source line is a literal non-personal label, never a real location value — consented', () => {
    const { getByText } = renderTester({ resolvedCondition: 'clear', weather: liveWeather, usingConsentedLocation: true });
    expect(getByText('Location source: consented coarse location (non-personal)')).toBeTruthy();
  });
});

describe('DevWeatherTester — option presses drive the store', () => {
  it('pressing a condition row calls setOverride with that condition', () => {
    const { getByLabelText } = renderTester();
    fireEvent.press(getByLabelText('Thunderstorm'));
    expect(useDevWeatherStore.getState().override).toBe('thunderstorm');
  });

  it('pressing "Mainly clear" sets override to the DISTINCT mainly_clear condition (not clear, not partly_cloudy)', () => {
    const { getByLabelText } = renderTester();
    fireEvent.press(getByLabelText('Mainly clear'));
    expect(useDevWeatherStore.getState().override).toBe('mainly_clear');
  });

  it('"Rain (heavy)" honestly maps to the SAME "rain" condition (no invented visual)', () => {
    const { getByLabelText } = renderTester();
    fireEvent.press(getByLabelText('Rain (heavy)'));
    expect(useDevWeatherStore.getState().override).toBe('rain');
  });

  it('pressing "Live weather (reset)" calls clear() — resets BOTH override and forceNight', () => {
    useDevWeatherStore.setState({ override: 'snow', forceNight: true });
    const { getByLabelText } = renderTester();
    fireEvent.press(getByLabelText('Live weather (reset)'));
    expect(useDevWeatherStore.getState().override).toBeNull();
    expect(useDevWeatherStore.getState().forceNight).toBeNull();
  });

  it('marks the ACTIVE row matching the current override, and "Live weather" when override is null', () => {
    const { getByLabelText, rerender } = renderTester();
    expect(getByLabelText('Live weather (reset)').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Snow').props.accessibilityState.selected).toBe(false);

    useDevWeatherStore.getState().setOverride('snow');
    rerender(
      <DevWeatherTester
        visible
        onClose={jest.fn()}
        resolvedCondition="snow"
        weather={null}
        usingConsentedLocation={false}
      />,
    );
    expect(getByLabelText('Snow').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Live weather (reset)').props.accessibilityState.selected).toBe(false);
  });

  it('marks "Mainly clear" ACTIVE when that is the current override', () => {
    useDevWeatherStore.setState({ override: 'mainly_clear' });
    const { getByLabelText } = renderTester({ resolvedCondition: 'mainly_clear' });
    expect(getByLabelText('Mainly clear').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Clear').props.accessibilityState.selected).toBe(false);
    expect(getByLabelText('Partly cloudy').props.accessibilityState.selected).toBe(false);
  });
});

describe('DevWeatherTester — force-night toggle', () => {
  it('toggling the switch ON calls setForceNight(true)', () => {
    const { getByLabelText } = renderTester();
    fireEvent(getByLabelText('Force night'), 'valueChange', true);
    expect(useDevWeatherStore.getState().forceNight).toBe(true);
  });

  it('toggling the switch OFF calls setForceNight(null) — "null" means follow the real clock again', () => {
    useDevWeatherStore.setState({ forceNight: true });
    const { getByLabelText } = renderTester();
    fireEvent(getByLabelText('Force night'), 'valueChange', false);
    expect(useDevWeatherStore.getState().forceNight).toBeNull();
  });
});

describe('DevWeatherTester — diagnostics readout reflects the passed props (honest, not invented)', () => {
  it('shows the raw weathercode and mapped condition from a live reading', () => {
    const { getByText } = renderTester({ resolvedCondition: 'rain', weather: liveWeather });
    expect(getByText('Raw weathercode: 61')).toBeTruthy();
    expect(getByText('Mapped condition: rain')).toBeTruthy();
    expect(getByText('Live vs Overridden: Live')).toBeTruthy();
  });

  it('shows "not a live reading" when the synthetic override has no weathercode', () => {
    useDevWeatherStore.setState({ override: 'snow' });
    const syntheticSnow: WeatherState = {
      condition: 'snow', temperatureC: 15, precipProbabilityPct: 0, emoji: '❄️', label: 'Snowing',
    };
    const { getByText } = renderTester({ resolvedCondition: 'snow', weather: syntheticSnow });
    expect(getByText('Raw weathercode: — (not a live reading)')).toBeTruthy();
    expect(getByText('Live vs Overridden: OVERRIDDEN')).toBeTruthy();
  });

  it('reflects Force-night in the day/night diagnostic line', () => {
    useDevWeatherStore.setState({ forceNight: true });
    const { getByText } = renderTester({ resolvedCondition: 'clear', weather: null });
    expect(getByText('Day / night (resolved): Night')).toBeTruthy();
    expect(getByText('Resolved atmosphere: night')).toBeTruthy();
  });

  it('shows the mapped condition for a mainly_clear reading, distinct from clear/partly_cloudy', () => {
    const mainlyClear: WeatherState = {
      condition: 'mainly_clear', temperatureC: 17, precipProbabilityPct: 0, emoji: '🌤', label: 'Mainly clear',
    };
    const { getByText } = renderTester({ resolvedCondition: 'mainly_clear', weather: mainlyClear });
    expect(getByText('Mapped condition: mainly_clear')).toBeTruthy();
    expect(getByText('Resolved atmosphere: sunny')).toBeTruthy();
  });
});

describe('DevWeatherTester — close affordance', () => {
  it('calls onClose when the Close button is pressed', () => {
    const onClose = jest.fn();
    const { getByLabelText } = renderTester({ onClose });
    fireEvent.press(getByLabelText('Close weather tester'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
