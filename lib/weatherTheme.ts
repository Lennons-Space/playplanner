// ─────────────────────────────────────────────────────────────────────────
// WeatherTheme — the single source of truth that turns a live weather
// condition into a *complete* visual theme, not just a background.
//
// The original WeatherBackground only swapped the decorative layer behind the
// screen; the chrome (text, cards) never changed, so weather felt like an
// effect sitting behind the app rather than a designed theme. WeatherTheme
// fixes that by exposing everything a screen needs to feel like the weather:
//   • palette   — the gradient + moving-shape tints + particle colour
//   • mode      — 'dark' or 'light' foreground (drives text colour)
//   • text      — resolved primary/secondary/tertiary text colours
//   • card      — 'solid' or 'glass' card treatment (+ concrete bg/border)
//   • glow      — accent glow colour for the atmosphere
//   • accent    — interactive accent (kept brand-blue; readable on both modes)
//
// This module is PURE TypeScript (no React, no react-native) so it can be unit
// tested without a render context and reused anywhere. Components read these
// tokens; they never hard-code weather colours.
// ─────────────────────────────────────────────────────────────────────────

import type { WeatherCondition } from './weather';

// ── Atmosphere kinds ───────────────────────────────────────────────────────
// The five visual moods every condition collapses into. This is the canonical
// definition; components/weather/WeatherLayer re-exports it for back-compat.
export type Atmosphere = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'night';

/** Foreground/text mode for a theme. */
export type ForegroundMode = 'dark' | 'light';

/** Card treatment for a theme. */
export type CardStyle = 'solid' | 'glass';

/**
 * The palette consumed by the decorative background layer. Structurally
 * identical to the ambient ATMOSPHERE entries in WeatherLayer, so the same
 * background components can render either palette.
 */
export interface WeatherPalette {
  /** Base wash gradient (top → bottom). */
  base: readonly [string, string, string];
  /** Soft accent tints used by the moving shapes. */
  tintA: string;
  tintB: string;
  /** Small particles (dust / streaks / stars / flakes). */
  particle: string;
}

export interface WeatherTheme {
  atmosphere: Atmosphere;
  /** 'dark' = dark text on a light bg; 'light' = light text on a dark bg. */
  mode: ForegroundMode;
  /** Cinematic background palette for this atmosphere. */
  palette: WeatherPalette;
  /** Resolved foreground text colours for screen chrome. */
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  /** Card/pill treatment. */
  card: {
    style: CardStyle;
    background: string;
    border: string;
  };
  /** Accent glow colour (decorative). */
  glow: string;
  /** Interactive accent colour (links, active pills). */
  accent: string;
}

// ── Shared foreground sets ──────────────────────────────────────────────────
// DARK = the existing PlayPlanner near-black text (matches constants/theme
// Colors.label / label2 / label3). LIGHT = soft warm-white for dark skies.
const DARK_TEXT = {
  primary: '#16151A',
  secondary: 'rgba(20,18,28,0.74)',
  tertiary: 'rgba(20,18,28,0.48)',
} as const;

const LIGHT_TEXT = {
  primary: '#FFFFFF',
  secondary: 'rgba(255,255,255,0.72)',
  tertiary: 'rgba(255,255,255,0.55)',
} as const;

const SOLID_CARD = {
  style: 'solid' as const,
  background: '#FFFFFF',
  border: 'rgba(20,18,28,0.10)',
};

const GLASS_CARD = {
  style: 'glass' as const,
  background: 'rgba(255,255,255,0.12)',
  border: 'rgba(255,255,255,0.16)',
};

// Brand accent (Ocean) — readable on both light cream and dark navy.
const ACCENT = '#4C8DF6';

// ── Themes ──────────────────────────────────────────────────────────────────
// Light atmospheres (sunny/cloudy/snow) stay in the warm cream family with dark
// text and solid white cards — close to today, just moodier and with a real
// glow. Dark atmospheres (rain/night) go to a deep desaturated navy with light
// text and glass cards — the "cozy rainy café" / "calm bedtime" moods.
export const WEATHER_THEMES: Record<Atmosphere, WeatherTheme> = {
  sunny: {
    atmosphere: 'sunny',
    mode: 'dark',
    palette: {
      base: ['#FEF8EC', '#FCF2E0', '#F7E7CF'],
      tintA: 'rgba(255, 198, 110, 0.30)', // warm golden glow (top/right)
      tintB: 'rgba(150, 200, 235, 0.10)', // faint blue sky tint
      particle: 'rgba(255, 246, 226, 0.90)',
    },
    text: DARK_TEXT,
    card: SOLID_CARD,
    glow: 'rgba(255, 200, 120, 0.50)',
    accent: ACCENT,
  },
  cloudy: {
    atmosphere: 'cloudy',
    mode: 'dark',
    palette: {
      base: ['#EDEFF3', '#E5E9EF', '#DBE0E8'],
      tintA: 'rgba(255, 255, 255, 0.55)',
      tintB: 'rgba(120, 130, 145, 0.10)',
      particle: 'rgba(255, 255, 255, 0.50)',
    },
    text: DARK_TEXT,
    card: SOLID_CARD,
    glow: 'rgba(255, 255, 255, 0.40)',
    accent: ACCENT,
  },
  snow: {
    atmosphere: 'snow',
    mode: 'dark',
    palette: {
      base: ['#EEF3F8', '#E6ECF3', '#D9E2EC'],
      tintA: 'rgba(255, 255, 255, 0.60)',
      tintB: 'rgba(150, 170, 190, 0.10)',
      particle: 'rgba(255, 255, 255, 0.95)',
    },
    text: DARK_TEXT,
    card: SOLID_CARD,
    glow: 'rgba(210, 228, 245, 0.45)',
    accent: ACCENT,
  },
  rain: {
    atmosphere: 'rain',
    mode: 'light',
    palette: {
      base: ['#2C3547', '#232B3B', '#1A2130'], // deep desaturated navy/blue
      tintA: 'rgba(120, 150, 195, 0.22)', // soft blurred blue shape
      tintB: 'rgba(90, 115, 150, 0.14)',
      particle: 'rgba(205, 220, 245, 0.50)', // light rain streaks (visible on navy)
    },
    text: LIGHT_TEXT,
    card: GLASS_CARD,
    glow: 'rgba(130, 160, 205, 0.40)',
    accent: ACCENT,
  },
  night: {
    atmosphere: 'night',
    mode: 'light',
    palette: {
      base: ['#19203A', '#141A30', '#0E1322'], // deep navy night sky
      tintA: 'rgba(255, 238, 200, 0.32)', // warm moon glow
      tintB: 'rgba(90, 110, 160, 0.16)',
      particle: 'rgba(255, 255, 255, 0.92)', // stars
    },
    text: LIGHT_TEXT,
    card: GLASS_CARD,
    glow: 'rgba(255, 238, 200, 0.45)',
    accent: ACCENT,
  },
};

// ── Time-of-day ──────────────────────────────────────────────────────────────
// Night window: clear skies during these hours read as "clear night".
const NIGHT_START_HOUR = 20; // 8pm
const NIGHT_END_HOUR = 6; //  6am

export function isNightNow(now = new Date()): boolean {
  const h = now.getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

/**
 * Collapse a weather condition (+ time of day) into one of the five
 * atmospheres. Pure and deterministic — falls back to the calm "sunny" mood on
 * missing/unknown data so the UI never ends up themeless.
 */
export function resolveAtmosphere(
  condition: WeatherCondition | null | undefined,
  night: boolean = isNightNow(),
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

/**
 * Resolve a full WeatherTheme from a condition. This is what screens consume to
 * adapt both their background AND their chrome (text, cards) to the weather.
 */
export function resolveWeatherTheme(
  condition: WeatherCondition | null | undefined,
  night: boolean = isNightNow(),
): WeatherTheme {
  return WEATHER_THEMES[resolveAtmosphere(condition, night)];
}
