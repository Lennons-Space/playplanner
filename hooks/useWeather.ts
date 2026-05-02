import { useQuery } from '@tanstack/react-query';
import { parseWeatherResponse, type WeatherState } from '@/lib/weather';

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
 * Returns current weather for a map coordinate.
 * Cache: 15-min stale / 30-min gc. Query key uses 2-decimal precision
 * (~1km grid) so nearby pans hit the cache instead of re-fetching.
 * Returns null on error or when coords are not ready — callers treat
 * weather as a progressive enhancement, never a hard dependency.
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

  return data ?? null;
}
