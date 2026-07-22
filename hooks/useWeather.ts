import { useQuery } from '@tanstack/react-query';
import { parseWeatherResponse, CONDITION_META, type WeatherState, type WeatherCondition } from '@/lib/weather';
import { useDevWeatherStore } from '@/store/devWeatherStore';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const FETCH_TIMEOUT_MS = 5000;

async function fetchWeather(lat: number, lon: number): Promise<WeatherState | null> {
  const url = new URL(BASE_URL);
  // 1 decimal place ≈ 11km precision — sufficient for weather forecasts and
  // meaningfully reduces coordinate precision sent to a third-party server.
  url.searchParams.set('latitude',        lat.toFixed(1));
  url.searchParams.set('longitude',       lon.toFixed(1));
  url.searchParams.set('current_weather', 'true');
  url.searchParams.set('hourly',          'weathercode,precipitation_probability');
  url.searchParams.set('forecast_days',   '1');
  url.searchParams.set('timezone',        'Europe/London');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return parseWeatherResponse(data as Parameters<typeof parseWeatherResponse>[0]);
  } catch {
    // Covers both AbortError (timeout) and network failures.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * __DEV__-ONLY: builds a synthetic WeatherState for the dev weather tester's
 * override (store/devWeatherStore.ts + components/dev/DevWeatherTester.tsx).
 * emoji/label come from the SAME CONDITION_META production code uses —
 * never invented copy. `weathercode` is deliberately left undefined (this
 * isn't a real WMO reading — the diagnostic readout treats that absence as
 * "not live"). temperatureC/precipProbabilityPct reuse the live query's last
 * real reading when one exists (still honest data), falling back to a mild
 * placeholder only when no live reading has landed yet.
 */
function buildDevOverrideState(
  condition: WeatherCondition,
  live: WeatherState | null | undefined,
): WeatherState {
  const meta = CONDITION_META[condition];
  return {
    condition,
    temperatureC:         live?.temperatureC ?? 15,
    precipProbabilityPct: live?.precipProbabilityPct ?? 0,
    emoji: meta.emoji,
    label: meta.label,
  };
}

/**
 * Returns current weather for a map coordinate.
 * Cache: 15-min stale / 30-min gc. Query key uses 2-decimal precision
 * (~1km grid) so nearby pans hit the cache instead of re-fetching.
 * Returns null on error or when coords are not ready — callers treat
 * weather as a progressive enhancement, never a hard dependency.
 *
 * __DEV__-ONLY OVERRIDE: when a developer has set an override via the dev
 * weather tester (devWeatherStore), a real build (`__DEV__ === false`, a
 * compile-time constant) never takes this branch — this is a behavioural
 * no-op in production, not merely a hidden UI. The store subscription itself
 * is always mounted (a trivial, side-effect-free hook — see
 * store/devWeatherStore.ts) so this stays a single unconditional hook call
 * (no rules-of-hooks risk from branching a hook call on __DEV__); only the
 * VALUE is ever used inside the `if (__DEV__ ...)` check below. The hook's
 * public signature and return type are unchanged either way.
 */
export function useWeather(
  lat: number | undefined,
  lon: number | undefined,
): WeatherState | null {
  const enabled =
    typeof lat === 'number' &&
    Number.isFinite(lat)    &&
    typeof lon === 'number' &&
    Number.isFinite(lon);

  const { data } = useQuery({
    queryKey:  ['weather', lat?.toFixed(2), lon?.toFixed(2)],
    queryFn:   () => fetchWeather(lat!, lon!),
    enabled,
    staleTime: 15 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
    retry:     1,
  });

  const devOverride = useDevWeatherStore((s) => s.override);
  if (__DEV__ && devOverride) {
    return buildDevOverrideState(devOverride, data);
  }

  return data ?? null;
}
