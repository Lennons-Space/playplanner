/**
 * Tests for hooks/useWeather.ts — live weather data-path audit.
 *
 * Covers:
 *   - HTTP !ok / malformed JSON / timeout (AbortError) / missing
 *     current_weather → all fail safely to `null` (never throw, never crash
 *     a screen — weather is a progressive enhancement everywhere it's read).
 *   - Cache behaviour: the query key never includes theme mode, so a
 *     mode-only change can never trigger a refetch or leave a stale
 *     condition — the SAME cached value is reused.
 *   - __DEV__-ONLY weather-tester override: builds an honest synthetic
 *     WeatherState from the SAME CONDITION_META production code uses, is
 *     reactive across every consumer sharing the query key (no per-screen
 *     override state), "Live weather" correctly resets to the real fetched
 *     value, and — critically — the override is INERT when `__DEV__` is
 *     false (the production-safety guarantee).
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWeather } from '@/hooks/useWeather';
import { useDevWeatherStore } from '@/store/devWeatherStore';

function createWrapper(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

const realFetch = global.fetch;

beforeEach(() => {
  useDevWeatherStore.setState({ override: null, forceNight: null });
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

// ── Fetch-path failure modes — all must resolve to null, never throw ────────
describe('useWeather — fails safely on every failure mode (never throws, never crashes a screen)', () => {
  it('HTTP not-ok (e.g. 500) → null', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  }, 10000);

  it('malformed JSON (fetch resolves but .json() throws) → null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    }) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  }, 10000);

  it('network/timeout failure (fetch rejects, e.g. AbortError) → null', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  }, 10000);

  it('valid HTTP response but missing current_weather → null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hourly: { time: [], weathercode: [], temperature_2m: [], precipitation_probability: [] } }),
    }) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  }, 10000);

  it('undefined coords → never fetches, returns null immediately (query disabled)', () => {
    global.fetch = jest.fn() as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(undefined, undefined), { wrapper: Wrapper });
    expect(result.current).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a successful response resolves to the real parsed condition', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 61, temperature: 12 } }),
    }) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current?.condition).toBe('rain'));
  });
});

// ── Cache behaviour: query key never includes theme mode ────────────────────
describe('useWeather — cache is keyed ONLY on coordinates, never on theme mode', () => {
  it('a second render of the SAME hook with the SAME coords does not refetch (cache reused)', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 0, temperature: 18 } }),
    });
    global.fetch = fetchSpy as never;
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current?.condition).toBe('clear'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Simulate a re-render caused by something UNRELATED to weather (e.g. a
    // theme mode flip in the consuming screen) — same coords, same key.
    rerender({});
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still just the one fetch
    expect(result.current?.condition).toBe('clear'); // no staleness, no reset
  });

  it('two independent hook instances (simulating two screens) sharing a QueryClient share ONE fetch', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 3, temperature: 9 } }),
    });
    global.fetch = fetchSpy as never;
    const { queryClient, Wrapper } = createWrapper();
    const a = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    const b = renderHook(() => useWeather(52.8, -1.5), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children),
    });
    await waitFor(() => expect(a.result.current?.condition).toBe('overcast'));
    await waitFor(() => expect(b.result.current?.condition).toBe('overcast'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── __DEV__ weather-tester override ──────────────────────────────────────────
describe('useWeather — __DEV__ weather-tester override', () => {
  it('with an override set, returns a synthetic state using the REAL CONDITION_META emoji/label (honest copy)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 0, temperature: 18 } }),
    }) as never;
    const { Wrapper } = createWrapper();
    act(() => useDevWeatherStore.getState().setOverride('thunderstorm'));
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current?.condition).toBe('thunderstorm'));
    expect(result.current?.emoji).toBe('⛈');
    expect(result.current?.label).toBe('Thunderstorm');
    // Synthetic override never carries a real WMO code.
    expect(result.current?.weathercode).toBeUndefined();
  });

  it('overriding to "snow" reuses the LIVE temperature reading when one has already landed (still honest data)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 0, temperature: 21 } }),
    }) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current?.condition).toBe('clear'));

    act(() => useDevWeatherStore.getState().setOverride('snow'));
    await waitFor(() => expect(result.current?.condition).toBe('snow'));
    expect(result.current?.temperatureC).toBe(21); // reused the real reading, not a fabricated one
  });

  it('"Live weather" (clear()) resets every consumer back to the real fetched value', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 61, temperature: 11 } }),
    }) as never;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    await waitFor(() => expect(result.current?.condition).toBe('rain'));

    act(() => useDevWeatherStore.getState().setOverride('snow'));
    await waitFor(() => expect(result.current?.condition).toBe('snow'));

    act(() => useDevWeatherStore.getState().clear());
    await waitFor(() => expect(result.current?.condition).toBe('rain')); // back to the real live value
  });

  it('setting an override updates EVERY consumer sharing the query (no per-screen state)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { weathercode: 0, temperature: 18 } }),
    }) as never;
    const { queryClient, Wrapper } = createWrapper();
    const a = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
    const b = renderHook(() => useWeather(52.8, -1.5), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children),
    });
    await waitFor(() => expect(a.result.current?.condition).toBe('clear'));
    await waitFor(() => expect(b.result.current?.condition).toBe('clear'));

    act(() => useDevWeatherStore.getState().setOverride('showers'));
    await waitFor(() => expect(a.result.current?.condition).toBe('showers'));
    await waitFor(() => expect(b.result.current?.condition).toBe('showers'));
  });

  it('PRODUCTION SAFETY: with __DEV__ false, an override is completely ignored — the real value is always returned', async () => {
    const originalDev = (global as { __DEV__?: boolean }).__DEV__;
    (global as { __DEV__?: boolean }).__DEV__ = false;
    try {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ current_weather: { weathercode: 0, temperature: 18 } }),
      }) as never;
      const { Wrapper } = createWrapper();
      act(() => useDevWeatherStore.getState().setOverride('thunderstorm'));
      const { result } = renderHook(() => useWeather(52.8, -1.5), { wrapper: Wrapper });
      await waitFor(() => expect(result.current?.condition).toBe('clear')); // NOT 'thunderstorm'
    } finally {
      (global as { __DEV__?: boolean }).__DEV__ = originalDev;
    }
  });
});
