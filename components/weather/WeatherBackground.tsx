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
// It is purely decorative: on any error or missing data it falls back to the
// calm "sunny" cream wash. Place it as the FIRST child of a screen root and let
// content render on top.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { useWeather } from '@/hooks/useWeather';
import { FALLBACK_LOCATION } from '@/constants/location';
import type { WeatherCondition } from '@/lib/weather';
import { SunnyBackground } from './SunnyBackground';
import { CloudyBackground } from './CloudyBackground';
import { RainBackground } from './RainBackground';
import { SnowBackground } from './SnowBackground';
import { NightBackground } from './NightBackground';
import { useAppActive, useReducedMotionPref, type Atmosphere } from './WeatherLayer';

// Night window: clear skies during these hours read as "clear night".
const NIGHT_START_HOUR = 20; // 8pm
const NIGHT_END_HOUR = 6; //  6am

function isNightNow(now = new Date()): boolean {
  const h = now.getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

export function resolveAtmosphere(
  condition: WeatherCondition | null | undefined,
  night = isNightNow(),
): Atmosphere {
  switch (condition) {
    case 'clear':
      return night ? 'night' : 'sunny';
    case 'partly_cloudy':
    case 'overcast':
    case 'fog':
      return 'cloudy';
    case 'drizzle':
    case 'rain':
    case 'showers':
    case 'thunderstorm':
      return 'rain';
    case 'snow':
      return 'snow';
    default:
      return 'sunny';
  }
}

export interface WeatherBackgroundProps {
  /**
   * Optional explicit condition. When omitted, the component fetches coarse
   * ambient weather itself (deduped via React Query). Screens that already hold
   * a WeatherState can pass its condition to avoid any mapping divergence.
   */
  condition?: WeatherCondition | null;
}

export function WeatherBackground({ condition }: WeatherBackgroundProps) {
  // Always coarse, fixed coordinates — no user location, no OS prompt.
  const fetched = useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  const effective = condition ?? fetched?.condition ?? null;

  const reduced = useReducedMotionPref();
  const appActive = useAppActive();
  const animate = appActive && !reduced;

  const atmosphere = resolveAtmosphere(effective);

  switch (atmosphere) {
    case 'night':
      return <NightBackground animate={animate} />;
    case 'cloudy':
      return <CloudyBackground animate={animate} />;
    case 'rain':
      return <RainBackground animate={animate} />;
    case 'snow':
      return <SnowBackground animate={animate} />;
    case 'sunny':
    default:
      return <SunnyBackground animate={animate} />;
  }
}
