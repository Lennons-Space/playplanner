// ─────────────────────────────────────────────────────────────────────────
// useAppTheme — the SINGLE resolution point for the Play Planner v2 dark/
// light design-token set (`constants/theme.ts` → `Themes.dark` / `Themes.light`).
//
// Step 10A Part 2 (dual-theme foundation): this used to hard-return 'dark'
// (Play Planner v2 shipped dark-only). It now resolves the ACTUAL mode from
// two inputs:
//   1. `themeStore.preference` — the user's saved choice ('system' | 'light'
//      | 'dark'), read from store/themeStore.ts (AsyncStorage-persisted,
//      no PII, no auth coupling).
//   2. `useColorScheme()` (react-native) — the LIVE OS colour scheme, read
//      ONLY when preference is 'system'. This is the ONLY place in
//      production code that may call useColorScheme() directly; every other
//      consumer must go through this hook so there is exactly one
//      resolution rule for the whole app.
//
// Resolution: preference === 'system' ? (OS scheme ?? 'dark') : preference.
// The 'dark' fallback (when the OS reports no preference at all — some
// Android/older-OS combinations) matches Play Planner v2's dark-by-default
// launch stance, it just no longer OVERRIDES an explicit OS or user choice.
//
// WHY a separate hook from useWeatherTheme:
// useWeatherTheme drives the WEATHER background + its own light/dark text
// adaptation for the OLD design system. The v2 reskin uses a SEPARATE,
// additive token set (`Themes`) for its chrome (labels, surfaces, separators)
// so we don't stack two theme systems on top of each other. The weather
// background remains a purely decorative layer behind the content (see
// components/ui/ThemedBackground.tsx, a thin pass-through to V2Background,
// which is now mode-aware and renders the real weather atmosphere in BOTH
// modes — the earlier light-mode placeholder surface was retired in Phase A
// of the v2 Light-theme correction).
//
// IMPORTANT — this hook does NOT touch the legacy `Colors` export (still
// light-only, read directly by Search / Favourites / Venue Detail and most
// other screens not yet migrated to `Themes`) — those screens are visually
// untouched by this change and remain dark-token-hardcoded via their own
// module-scope `const T = Themes.dark` until a later migration phase.
//
// Privacy: this hook does not read location, profile, or any user data — it
// only resolves a display preference (device-local, non-personal) plus the
// OS colour scheme (also non-personal), then returns a static token lookup.
// ─────────────────────────────────────────────────────────────────────────

import { useColorScheme } from 'react-native';
import { Themes, ocean, type ThemeTokens, type AccentPalette } from '@/constants/theme';
import { useThemeStore } from '@/store/themeStore';

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
 * resolved from the user's saved preference crossed with the live OS colour
 * scheme (see module doc above for the exact resolution rule).
 */
export function useAppTheme(): AppTheme {
  const preference = useThemeStore((s) => s.preference);
  const systemScheme = useColorScheme();

  const mode: 'dark' | 'light' =
    preference === 'system' ? (systemScheme ?? 'dark') : preference;

  return {
    mode,
    tokens: Themes[mode],
    accent: ocean,
  };
}
