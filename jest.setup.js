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
