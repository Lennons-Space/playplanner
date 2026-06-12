// ─────────────────────────────────────────────────────────────────────────
// useWeatherTheme — the screen-facing hook that turns live weather into a
// full WeatherTheme (background palette + adaptive text/card chrome).
//
// Privacy: like WeatherBackground, this ONLY uses the coarse FALLBACK_LOCATION.
// It never calls useLocation(), so it cannot trigger the OS prompt and works
// before location consent. Weather is a progressive enhancement — on any error
// or missing data it resolves to the calm "sunny" theme.
//
// Both Home's chrome and its WeatherBackground read from the same cached
// weather (React Query dedupes by key), so the background and the chrome can
// never disagree about which atmosphere is showing.
// ─────────────────────────────────────────────────────────────────────────

import { useWeather } from '@/hooks/useWeather';
import { FALLBACK_LOCATION } from '@/constants/location';
import { resolveWeatherTheme, type WeatherTheme } from '@/lib/weatherTheme';

/**
 * Returns the resolved WeatherTheme for the current ambient weather.
 * Optionally accepts an explicit condition (e.g. from a screen that already
 * holds a WeatherState) to avoid any divergence.
 */
export function useWeatherTheme(): WeatherTheme {
  // Always coarse, fixed coordinates — no user location, no OS prompt.
  const weather = useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  return resolveWeatherTheme(weather?.condition ?? null);
}
