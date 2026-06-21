// ─────────────────────────────────────────────────────────────────────────
// useAppTheme — resolves the active design-token set for the Phase 1 Home
// reskin (`constants/theme.ts` → `Themes.dark` / `Themes.light`).
//
// WHY a separate hook from useWeatherTheme:
// useWeatherTheme drives the WEATHER background + its own light/dark text
// adaptation for the OLD design system. The new Home reskin uses a SEPARATE,
// additive token set (`Themes`) for its chrome (labels, surfaces, separators)
// so we don't stack two theme systems on top of each other. The weather
// background remains a purely decorative layer behind the content.
//
// Default: 'dark'. The design handoff's dark mode is the primary reference
// (see screens/01-home-dark.png); when the OS reports no preference
// (useColorScheme() returns null/undefined, e.g. some Android/test
// environments), we fall back to dark rather than assuming light.
//
// Privacy: this hook does not read location, profile, or any user data — it
// only reads the OS appearance preference via React Native's useColorScheme.
// ─────────────────────────────────────────────────────────────────────────

import { Themes, ocean, type ThemeTokens, type AccentPalette } from '@/constants/theme';

export interface AppTheme {
  /** Resolved mode — never null, defaults to 'dark'. */
  mode: 'dark' | 'light';
  /** Design tokens (bg/surface/label/separator/etc.) for the resolved mode. */
  tokens: ThemeTokens;
  /** Accent palette — Ocean is the only palette wired up in Phase 1. */
  accent: AccentPalette;
}

/**
 * Returns the active theme tokens + accent palette for the Home reskin.
 *
 * GLOBAL WEATHER ENVIRONMENT (2026-06-13): the (tabs) app is now a single
 * LIGHT, weather-aware environment — one ambient WeatherBackground sits behind
 * all four tabs (see app/(tabs)/_layout.tsx). Search / Favourites / Profile are
 * legacy light-only screens with dark text, so the shared weather wash must
 * stay light; Home's chrome therefore resolves to the LIGHT token set too, so
 * its free-floating text (headline, greeting, section labels) stays readable on
 * the cream wash — matching the design's light Home (06-home-light.png).
 *
 * OS-dark support for the tab app is intentionally deferred until the three
 * legacy screens are made theme-aware (otherwise a dark shared wash would make
 * their dark text unreadable). To restore OS-driven dark/light, read
 * useColorScheme() here again and resolve mode from it.
 */
export function useAppTheme(): AppTheme {
  const mode: 'dark' | 'light' = 'light';

  return {
    mode,
    tokens: Themes[mode],
    accent: ocean,
  };
}
