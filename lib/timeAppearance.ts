// ─────────────────────────────────────────────────────────────────────────
// timeAppearance — the single, pure source of truth for PlayPlanner's
// automatic light/dark app THEME.
//
// This is NOT the weather/atmosphere "night" concept (see lib/weatherTheme.ts
// isNightNow/resolveAtmosphere — a separate, purely decorative system: sunny/
// cloudy/rain/snow/night backgrounds + motion, on its own 20:00–06:00
// window). THEME governs the app's actual light/dark chrome tokens
// (constants/theme.ts Themes.light/Themes.dark) everywhere in the app; it is
// a fixed product rule, not user-configurable and not OS-driven — see
// store/appearanceStore.ts for the live, boundary-scheduled resolution built
// on top of this pure function, and hooks/useAppTheme.ts for the single
// consumption point every screen reads.
//
// Rule (accepted 2026-08-13, PlayPlanner "automatic day/night theme"):
//   07:00 (inclusive) – 18:59 local time → light
//   19:00 (inclusive) – 06:59 local time → dark
// Always LOCAL device time — Date#getHours() is local by definition, so this
// never needs (or wants) a UTC conversion. Never a sunset/weather-API time.
// ─────────────────────────────────────────────────────────────────────────

export type Appearance = 'light' | 'dark';

/** Local hour (0–23) at which light mode begins. */
export const DAY_START_HOUR = 7;
/** Local hour (0–23) at which dark mode begins. */
export const NIGHT_START_HOUR = 19;

/**
 * Pure, deterministic resolver — the ONLY place that should ever decide the
 * app's light/dark THEME from the clock. Accepts an injectable Date so tests
 * never depend on the real wall clock (see lib/__tests__/timeAppearance.test.ts
 * and store/__tests__/appearanceStore.test.ts for the full boundary matrix).
 */
export function resolveTimeAppearance(date: Date = new Date()): Appearance {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < DAY_START_HOUR ? 'dark' : 'light';
}

/**
 * Milliseconds from `date` until the next appearance boundary (the next
 * 07:00 or 19:00 local time, whichever is sooner). Used to schedule exactly
 * ONE timer per boundary crossing (store/appearanceStore.ts) instead of
 * polling every second.
 */
export function msUntilNextBoundary(date: Date = new Date()): number {
  const hour = date.getHours();
  const next = new Date(date);

  if (hour < DAY_START_HOUR) {
    next.setHours(DAY_START_HOUR, 0, 0, 0);
  } else if (hour < NIGHT_START_HOUR) {
    next.setHours(NIGHT_START_HOUR, 0, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(DAY_START_HOUR, 0, 0, 0);
  }

  const ms = next.getTime() - date.getTime();
  // Never schedule a non-positive delay (would fire immediately / risk a
  // tight loop) — floors at 1s. Covers the exact-boundary instant and any
  // DST-transition edge case producing an unexpected delta.
  return ms > 0 ? ms : 1000;
}
