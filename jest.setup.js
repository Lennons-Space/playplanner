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

// useColorScheme — react-native's OWN jest mock (node_modules/react-native/
// jest/mocks/useColorScheme.js) defaults to 'light'. Before Step 10A Part 2
// (dual-theme foundation), useAppTheme() hard-returned 'dark' regardless of
// the OS, so that RN default was invisible to every existing suite. Now that
// useAppTheme() actually reads useColorScheme() (via the theme store's
// default 'system' preference), that RN 'light' default would silently flip
// every UNMOCKED useAppTheme() consumer's tests to light-mode tokens —
// breaking dozens of suites that assert dark-token values with no relation
// to theming. Overriding the global default back to 'dark' here preserves
// the existing dark-by-default test behaviour everywhere; suites that
// specifically want to test light/dark switching (e.g.
// components/home/__tests__/QuickPicks.glass.test.tsx) already register
// their own local jest.mock() for this same module, which wins over this
// one for that file.
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(() => 'dark'),
}));
