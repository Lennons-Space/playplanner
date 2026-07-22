// ─────────────────────────────────────────────────────────────────────────
// devWeatherStore — __DEV__-ONLY manual weather/atmosphere override, for
// visual QA of the shared V2Background/V2WeatherMotion pipeline across every
// screen without needing real weather to change or a device location fix.
//
// NOT PERSISTED — plain in-memory zustand, no AsyncStorage, no `persist`
// middleware. Resets to `{ override: null, forceNight: null }` on every app
// restart. This is deliberate: an override must never survive a restart and
// must never be mistaken for a real saved preference (unlike
// store/themeStore.ts, which IS persisted because it's a real user setting).
//
// Consumed by:
//   - hooks/useWeather.ts   — `override` replaces the live condition when set
//     (behind an `if (__DEV__ && override)` guard — see that file).
//   - components/ui/V2Background.tsx — `forceNight` overrides
//     `resolveAtmosphere`'s time-of-day night argument when non-null (behind
//     an `if (__DEV__ && forceNight !== null)` guard).
//   - components/dev/DevWeatherTester.tsx — the __DEV__-only modal UI that
//     reads + writes this store.
//
// This module itself has NO __DEV__ guard (it's a trivial, side-effect-free
// in-memory store — safe to include in every bundle); the guards live at
// every CONSUMPTION site instead, so a production build never reads or acts
// on `override`/`forceNight` even though the store technically exists. In a
// real device the setters are only ever called from DevWeatherTester, which
// is itself only ever mounted behind `__DEV__` (see app/(tabs)/index.tsx) —
// so `override`/`forceNight` stay permanently `null` in any release build.
//
// Privacy: no PII, no location, no auth coupling — a weather condition
// override is not personal data, and it never leaves the device (no
// network, no logging).
// ─────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { WeatherCondition } from '@/lib/weather';

interface DevWeatherState {
  /** null = no override, use the real fetched condition. */
  override: WeatherCondition | null;
  /** null = use the real time-of-day (isNightNow()); true/false forces night/day. */
  forceNight: boolean | null;
  setOverride: (condition: WeatherCondition | null) => void;
  setForceNight: (forceNight: boolean | null) => void;
  /** Resets BOTH fields — "Live weather" in the dev tester. */
  clear: () => void;
}

export const useDevWeatherStore = create<DevWeatherState>((set) => ({
  override: null,
  forceNight: null,
  setOverride: (condition) => set({ override: condition }),
  setForceNight: (forceNight) => set({ forceNight }),
  clear: () => set({ override: null, forceNight: null }),
}));
