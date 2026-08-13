// ─────────────────────────────────────────────────────────────────────────
// useAppTheme — the SINGLE resolution point for the Play Planner v2 dark/
// light design-token set (`constants/theme.ts` → `Themes.dark` / `Themes.light`).
//
// AUTOMATIC DAY/NIGHT THEME (2026-08-13): the app's light/dark appearance is
// resolved ENTIRELY from local time — see lib/timeAppearance.ts for the pure
// 07:00/19:00 rule and store/appearanceStore.ts for the live,
// boundary-scheduled resolution this hook reads. This is a fixed product
// rule: it is authoritative over BOTH the OS colour scheme (react-native's
// useColorScheme/Appearance — never read here, or anywhere else in
// production code — see the source-guard test in
// hooks/__tests__/useAppTheme.test.tsx) and the user's old saved
// System/Light/Dark preference (store/themeStore.ts — kept only for
// AsyncStorage data compatibility with already-installed copies of the app;
// no longer consulted for visual resolution — see
// app/profile/appearance.tsx, now an Automatic-only explainer with no
// picker).
//
// WHY a separate hook from useWeatherTheme:
// useWeatherTheme drives the WEATHER background + its own light/dark text
// adaptation for the OLD design system. The v2 reskin uses a SEPARATE,
// additive token set (`Themes`) for its chrome (labels, surfaces, separators)
// so we don't stack two theme systems on top of each other. The weather
// background remains a purely decorative layer behind the content (see
// components/ui/ThemedBackground.tsx, a thin pass-through to V2Background,
// which is mode-aware and renders the real weather atmosphere in BOTH
// modes) — atmosphere (sunny/cloudy/rain/snow/night) is a RELATED but
// DISTINCT concept from THEME and keeps its own separate time window
// (lib/weatherTheme.ts's isNightNow, 20:00–06:00 — see that file's header
// for why the two windows are intentionally different systems).
//
// IMPORTANT — this hook does NOT touch the legacy `Colors` export (still
// light-only, read directly by Search / Favourites / Venue Detail and most
// other screens not yet migrated to `Themes`) — those screens are visually
// untouched by this change and remain dark-token-hardcoded via their own
// module-scope `const T = Themes.dark` until a later migration phase.
//
// Privacy: this hook does not read location, profile, or any user data — it
// only resolves the local device clock (device-local, non-personal) into a
// display preference, then returns a static token lookup.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { Themes, ocean, type ThemeTokens, type AccentPalette } from '@/constants/theme';
import { useAppearanceStore, startAppearanceScheduler } from '@/store/appearanceStore';

export interface AppTheme {
  /** Resolved mode — never null. */
  mode: 'dark' | 'light';
  /** Design tokens (bg/surface/label/separator/etc.) for the resolved mode. */
  tokens: ThemeTokens;
  /** Accent palette — Ocean is the only palette wired up so far. */
  accent: AccentPalette;
}

/**
 * Returns the active theme tokens + accent palette for the v2 chrome,
 * resolved purely from local time (see module doc above). Also ensures the
 * process-wide boundary/foreground scheduler (store/appearanceStore.ts) is
 * running — idempotent, safe to call from every screen that uses this hook.
 */
export function useAppTheme(): AppTheme {
  const mode = useAppearanceStore((s) => s.mode);

  useEffect(() => {
    startAppearanceScheduler();
  }, []);

  return {
    mode,
    tokens: Themes[mode],
    accent: ocean,
  };
}
