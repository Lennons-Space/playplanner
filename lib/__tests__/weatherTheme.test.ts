// Pure unit tests for the WeatherTheme model — the source of truth that turns
// a weather condition into a full visual theme (background + adaptive chrome).
// No render context needed: lib/weatherTheme is plain TypeScript.

import {
  resolveAtmosphere,
  resolveWeatherTheme,
  isNightNow,
  WEATHER_THEMES,
  type Atmosphere,
} from '@/lib/weatherTheme';
import type { WeatherCondition } from '@/lib/weather';

describe('resolveAtmosphere', () => {
  it('maps clear → sunny during the day and night when dark', () => {
    expect(resolveAtmosphere('clear', false)).toBe('sunny');
    expect(resolveAtmosphere('clear', true)).toBe('night');
  });

  it('maps cloud-family conditions → cloudy', () => {
    (['partly_cloudy', 'overcast', 'fog'] as WeatherCondition[]).forEach((c) =>
      expect(resolveAtmosphere(c, false)).toBe('cloudy'),
    );
  });

  it('maps all wet conditions → rain', () => {
    (['drizzle', 'rain', 'showers', 'thunderstorm'] as WeatherCondition[]).forEach((c) =>
      expect(resolveAtmosphere(c, false)).toBe('rain'),
    );
  });

  it('maps snow → snow', () => {
    expect(resolveAtmosphere('snow', false)).toBe('snow');
  });

  it('falls back to sunny on null/undefined weather', () => {
    expect(resolveAtmosphere(null, false)).toBe('sunny');
    expect(resolveAtmosphere(undefined, false)).toBe('sunny');
  });
});

describe('resolveWeatherTheme — condition → theme', () => {
  it('returns the matching theme for each atmosphere', () => {
    expect(resolveWeatherTheme('clear', false).atmosphere).toBe('sunny');
    expect(resolveWeatherTheme('clear', true).atmosphere).toBe('night');
    expect(resolveWeatherTheme('overcast', false).atmosphere).toBe('cloudy');
    expect(resolveWeatherTheme('rain', false).atmosphere).toBe('rain');
    expect(resolveWeatherTheme('snow', false).atmosphere).toBe('snow');
  });

  it('never returns an undefined/themeless result, even with no data', () => {
    const theme = resolveWeatherTheme(null);
    expect(theme).toBeDefined();
    expect(theme.atmosphere).toBe(resolveAtmosphere(null));
    expect(theme.palette.base).toHaveLength(3);
  });
});

describe('foreground mode + text colour', () => {
  it('sunny uses DARK text (dark-on-light)', () => {
    const t = resolveWeatherTheme('clear', false);
    expect(t.mode).toBe('dark');
    expect(t.text.primary).toBe('#16151A');
  });

  it('cloudy and snow also use dark text (stay light but mooded)', () => {
    expect(resolveWeatherTheme('overcast', false).mode).toBe('dark');
    expect(resolveWeatherTheme('snow', false).mode).toBe('dark');
  });

  it('rain uses LIGHT text on Home (dark navy sky)', () => {
    const t = resolveWeatherTheme('rain', false);
    expect(t.mode).toBe('light');
    expect(t.text.primary).toBe('#FFFFFF');
    expect(t.text.secondary).toBe('rgba(255,255,255,0.72)');
    expect(t.text.tertiary).toBe('rgba(255,255,255,0.55)');
  });

  it('night uses LIGHT text on Home (deep navy sky)', () => {
    const t = resolveWeatherTheme('clear', true);
    expect(t.mode).toBe('light');
    expect(t.text.primary).toBe('#FFFFFF');
  });
});

describe('card treatment', () => {
  it('light atmospheres get solid white cards', () => {
    expect(resolveWeatherTheme('clear', false).card.style).toBe('solid');
    expect(resolveWeatherTheme('overcast', false).card.style).toBe('solid');
    expect(resolveWeatherTheme('snow', false).card.style).toBe('solid');
  });

  it('dark atmospheres get glass cards', () => {
    expect(resolveWeatherTheme('rain', false).card.style).toBe('glass');
    expect(resolveWeatherTheme('clear', true).card.style).toBe('glass');
  });
});

describe('theme table integrity', () => {
  it('every atmosphere has a complete theme', () => {
    (Object.keys(WEATHER_THEMES) as Atmosphere[]).forEach((k) => {
      const t = WEATHER_THEMES[k];
      expect(t.atmosphere).toBe(k);
      expect(t.palette.base).toHaveLength(3);
      expect(t.text.primary).toBeTruthy();
      expect(t.text.secondary).toBeTruthy();
      expect(t.text.tertiary).toBeTruthy();
      expect(t.card.background).toBeTruthy();
      expect(t.accent).toBeTruthy();
    });
  });
});

describe('isNightNow', () => {
  it('treats 8pm–6am as night', () => {
    expect(isNightNow(new Date(2026, 0, 1, 21, 0))).toBe(true);
    expect(isNightNow(new Date(2026, 0, 1, 3, 0))).toBe(true);
    expect(isNightNow(new Date(2026, 0, 1, 12, 0))).toBe(false);
    expect(isNightNow(new Date(2026, 0, 1, 7, 0))).toBe(false);
  });
});
