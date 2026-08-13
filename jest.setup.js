/* eslint-env jest, node */
// Global Jest setup (wired via package.json "jest.setupFiles").
//
// The ambient WeatherBackground is purely decorative: it kicks off a live
// weather fetch and UI-thread (Reanimated) animations that have no place in the
// Home/Search/Results/Map unit tests and would otherwise leak timers / open
// handles across the parallel suite. Stub it to nothing globally so those
// screens render exactly as they did before the feature landed. The weather
// components have their own dedicated suite that mounts the real implementation
// with Reanimated mocked locally.
jest.mock('@/components/weather/WeatherBackground', () => ({
  WeatherBackground: () => null,
}));

// AsyncStorage — required globally (not just in the one test that used to
// mock it locally) now that store/themeStore.ts (Step 10A Part 2, dual-theme
// foundation) persists via AsyncStorage and is pulled in transitively by
// useAppTheme(), which ~13+ components/screens already consume. Without this,
// every one of those tests would hit the real native module (unavailable
// under Jest) the moment useAppTheme() is called. Uses the package's own
// official Jest mock — the same one lib/__tests__/recentlyViewed.test.ts
// already registers locally (that local jest.mock call still wins for that
// file; this is just the same mock made available everywhere else too).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// appearanceStore — PlayPlanner's app-wide light/dark THEME (2026-08-13,
// automatic day/night theme) is resolved purely from local time
// (lib/timeAppearance.ts via store/appearanceStore.ts), NOT from the OS
// colour scheme — useAppTheme() no longer reads useColorScheme() at all (see
// hooks/useAppTheme.ts). Left uncontrolled, every test's resolved mode would
// depend on the real wall-clock time the CI happens to run at, which is
// exactly the non-determinism the automatic-theme spec forbids. Forcing
// 'dark' here preserves the pre-existing dark-by-default test behaviour for
// the dozens of suites that assert dark-token values with no relation to
// theming (this mirrors the old global useColorScheme mock it replaces).
// Suites that specifically want to exercise light/dark rendering override
// this per-test via `useAppearanceStore.setState({ mode: 'light' | 'dark' })`
// (e.g. components/home/__tests__/QuickPicks.glass.test.tsx) — they set it
// again inside their own `it`/`beforeEach`, which always wins since it runs
// after this file. Real boundary/scheduling behaviour has its own dedicated,
// real-timer-free coverage in store/__tests__/appearanceStore.test.ts and
// lib/__tests__/timeAppearance.test.ts — this file only sets the default so
// unrelated suites stay deterministic.
//
// NOTE: this is `setupFiles`, not `setupFilesAfterEach` — Jest's test
// globals (`beforeEach`, `describe`, ...) are not yet installed at this
// point, so this must be a plain top-level statement, not a `beforeEach(...)`
// registration (that would throw "beforeEach is not defined"). Jest resets
// the module registry — and therefore re-runs every `setupFiles` script,
// including this assignment — once per test FILE, which is exactly the
// granularity the old per-file useColorScheme mock had.
require('./store/appearanceStore').useAppearanceStore.setState({ mode: 'dark' });
