// ─────────────────────────────────────────────────────────────────────────
// WeatherBackground — the single component each screen drops in behind its
// content. It:
//   1. reuses the existing useWeather hook (coarse FALLBACK_LOCATION only — it
//      NEVER calls useLocation(), so it can't trigger the OS prompt and works
//      before location consent),
//   2. maps the weather condition (+ time of day) to one of five atmospheres,
//   3. gates animation on reduced-motion + app-active so it's accessible and
//      battery-friendly,
//   4. renders the chosen atmosphere as an absolute-fill, non-interactive layer.
//
// Two visual modes:
//   • 'ambient'   (default) — the calm cream/sand palette. Used by Search /
//                  Results / Map, whose chrome (text/cards) is NOT weather-aware,
//                  so the background must stay light enough for dark text.
//   • 'immersive' — the cinematic WEATHER_THEMES palette (deep navy rain/night,
//                  warm golden sunny glow). Used by Home, which adapts its text
//                  and cards to match via useWeatherTheme.
//
// It is purely decorative: on any error or missing data it falls back to the
// calm "sunny" wash. Place it as the FIRST child of a screen root and let
// content render on top.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { useWeather } from '@/hooks/useWeather';
import { FALLBACK_LOCATION } from '@/constants/location';
import type { WeatherCondition } from '@/lib/weather';
import { resolveAtmosphere, resolveWeatherPalette, WEATHER_THEMES, type WeatherPalette } from '@/lib/weatherTheme';
import { SunnyBackground } from './SunnyBackground';
import { CloudyBackground } from './CloudyBackground';
import { RainBackground } from './RainBackground';
import { SnowBackground } from './SnowBackground';
import { NightBackground } from './NightBackground';
import { useAppActive, useReducedMotionPref } from './WeatherLayer';

// Re-exported for back-compat (and because the mapping is genuinely about the
// background). The canonical implementation lives in lib/weatherTheme.
export { resolveAtmosphere };

export interface WeatherBackgroundProps {
  /**
   * Optional explicit condition. When omitted, the component fetches coarse
   * ambient weather itself (deduped via React Query). Screens that already hold
   * a WeatherState can pass its condition to avoid any mapping divergence.
   */
  condition?: WeatherCondition | null;
  /**
   * Visual mode. 'ambient' (default) keeps the calm light palette for screens
   * with non-adaptive chrome; 'immersive' uses the cinematic theme palette and
   * is paired with weather-aware chrome (Home).
   */
  mode?: 'ambient' | 'immersive';
  /**
   * App-theme mode (from useAppTheme()) — only used in 'immersive' mode to
   * pick the dark/light variant of the new Home palette (see
   * WEATHER_PALETTES_BY_MODE in lib/weatherTheme). Ignored in 'ambient' mode.
   *
   * IMPORTANT: leave this UNSET for any screen other than the new Home —
   * when omitted, immersive mode falls back to the original WEATHER_THEMES
   * cinematic palette (the existing look used by venue detail / map / etc.).
   * Only Home opts into the new dark/light Home-specific palettes by passing
   * this prop explicitly.
   */
  paletteMode?: 'dark' | 'light';
}

export function WeatherBackground({ condition, mode = 'ambient', paletteMode }: WeatherBackgroundProps) {
  // Always coarse, fixed coordinates — no user location, no OS prompt.
  const fetched = useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  const effective = condition ?? fetched?.condition ?? null;

  const reduced = useReducedMotionPref();
  const appActive = useAppActive();
  const animate = appActive && !reduced;

  const atmosphere = resolveAtmosphere(effective);

  // Immersive mode swaps in a cinematic palette; ambient passes undefined so
  // each background falls back to its calm default — identical to before.
  //
  //   - paletteMode explicitly set (Home only) -> new Home-specific
  //     dark/light palette (WEATHER_PALETTES_BY_MODE).
  //   - paletteMode unset (every other immersive screen: venue detail, map,
  //     etc.) -> original WEATHER_THEMES cinematic palette, unchanged.
  const palette: WeatherPalette | undefined =
    mode === 'immersive'
      ? paletteMode != null
        ? resolveWeatherPalette(atmosphere, paletteMode)
        : WEATHER_THEMES[atmosphere].palette
      : undefined;

  switch (atmosphere) {
    case 'night':
      return <NightBackground animate={animate} palette={palette} />;
    case 'cloudy':
      return <CloudyBackground animate={animate} palette={palette} />;
    case 'rain':
      return <RainBackground animate={animate} palette={palette} />;
    case 'snow':
      return <SnowBackground animate={animate} palette={palette} />;
    case 'sunny':
    default:
      return <SunnyBackground animate={animate} palette={palette} />;
  }
}
