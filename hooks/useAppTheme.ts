// ─────────────────────────────────────────────────────────────────────────
// useAppTheme — resolves the active design-token set for the Play Planner v2
// dark/glass reskin (`constants/theme.ts` → `Themes.dark` / `Themes.light`).
//
// WHY a separate hook from useWeatherTheme:
// useWeatherTheme drives the WEATHER background + its own light/dark text
// adaptation for the OLD design system. The v2 reskin uses a SEPARATE,
// additive token set (`Themes`) for its chrome (labels, surfaces, separators)
// so we don't stack two theme systems on top of each other. The weather
// background remains a purely decorative layer behind the content.
//
// Default: 'dark'. Play Planner v2 (Claude Design handoff, June 2026) ships
// dark-by-default — see screens/01-home-dark.png. Home, the v2 tab bar, and
// the Discover collection pages all consume this hook and therefore now
// render dark by default too.
//
// IMPORTANT — this flip does NOT touch the legacy `Colors` export (still
// light-only, read directly by Search / Favourites / Profile / Venue Detail),
// and it does NOT change the shared `<WeatherBackground />` behind the tabs
// (app/(tabs)/_layout.tsx still mounts it with no mode/paletteMode override,
// i.e. its calm light 'ambient' default) — so those three legacy screens are
// visually untouched by this change. Home carries its own opaque dark
// background (tokens.bg) instead of relying on the shared wash, which is what
// makes it safe to flip this hook's default without redoing the legacy
// screens in the same pass. See app/(tabs)/index.tsx and _layout.tsx for the
// full reasoning.
//
// Privacy: this hook does not read location, profile, or any user data — it
// only returns a static design-token lookup.
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
 * Returns the active theme tokens + accent palette for the v2 chrome.
 *
 * OS-driven light switching is intentionally NOT wired up yet (would require
 * auditing every `Themes`/`useAppTheme` consumer against a light palette too).
 * To add it later, read `useColorScheme()` here and resolve `mode` from it,
 * defaulting to 'dark' when the OS reports no preference.
 */
export function useAppTheme(): AppTheme {
  const mode: 'dark' | 'light' = 'dark';

  return {
    mode,
    tokens: Themes[mode],
    accent: ocean,
  };
}
