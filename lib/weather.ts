// Pure utility layer for Open-Meteo weather data.
// No React Query here — all functions are plain TS so they can be tested
// without a render context and reused outside the explore screen.

export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunderstorm';

export interface WeatherState {
  condition:            WeatherCondition;
  temperatureC:         number;
  precipProbabilityPct: number;
  emoji:                string;
  label:                string;
}

// WMO Weather interpretation codes → WeatherCondition.
// Full table: https://open-meteo.com/en/docs#weathervariables
export function classifyCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly_cloudy';
  if (code === 3) return 'overcast';
  if (code <= 48) return 'fog';       // 45, 48
  if (code <= 57) return 'drizzle';   // 51, 53, 55, 56, 57
  if (code <= 67) return 'rain';      // 61, 63, 65, 66, 67
  if (code <= 77) return 'snow';      // 71, 73, 75, 77
  if (code <= 82) return 'showers';   // 80, 81, 82
  if (code <= 86) return 'snow';      // 85, 86: snow showers slight/heavy
  return 'thunderstorm';              // 95, 96, 99
}

const CONDITION_META: Record<WeatherCondition, { emoji: string; label: string }> = {
  clear:         { emoji: '☀️', label: 'Sunny' },
  partly_cloudy: { emoji: '⛅', label: 'Partly cloudy' },
  overcast:      { emoji: '☁️', label: 'Overcast' },
  fog:           { emoji: '🌫', label: 'Foggy' },
  drizzle:       { emoji: '🌦', label: 'Drizzly' },
  rain:          { emoji: '🌧', label: 'Rainy' },
  snow:          { emoji: '❄️', label: 'Snowing' },
  showers:       { emoji: '🌦', label: 'Showery' },
  thunderstorm:  { emoji: '⛈', label: 'Thunderstorm' },
};

interface OpenMeteoResponse {
  current_weather?: {
    weathercode: number;
    temperature:  number;
  };
  hourly?: {
    time:                     string[];
    weathercode:              number[];
    temperature_2m:           number[];
    precipitation_probability: number[];
  };
}

export function parseWeatherResponse(data: OpenMeteoResponse): WeatherState | null {
  if (!data.current_weather) return null;
  const { weathercode, temperature } = data.current_weather;
  const condition = classifyCondition(weathercode);
  const meta      = CONDITION_META[condition];

  // Next-3-hour average precipitation probability from the hourly data.
  let precipProbabilityPct = 0;
  if (data.hourly?.precipitation_probability) {
    const nowHour = new Date().getHours();
    const slices  = data.hourly.precipitation_probability.slice(nowHour, nowHour + 3);
    if (slices.length > 0) {
      precipProbabilityPct = Math.round(slices.reduce((a, b) => a + b, 0) / slices.length);
    }
  }

  return {
    condition,
    temperatureC:         Math.round(temperature),
    precipProbabilityPct,
    emoji: meta.emoji,
    label: meta.label,
  };
}

// Category slugs that are primarily indoors.
const INDOOR_SLUGS = new Set([
  'soft-play', 'indoor-play', 'bowling', 'trampoline',
  'arts', 'library', 'sensory', 'swimming',
]);

// Category slugs that are primarily outdoors.
// 'playground' is unambiguously outdoor; it was previously missing here, so
// playgrounds got no sunny-day weather boost/badge and no rainy-day warning
// (Sprint B3 fix — see lib/venueAttributes.ts OUTDOOR_SLUGS for the matching change).
const OUTDOOR_SLUGS = new Set([
  'park', 'outdoor-sports', 'farm', 'playground',
]);

/**
 * Returns a short badge label to overlay on a VenueCard photo when the
 * weather makes this venue especially good (or notably bad). Returns null
 * for neutral combinations so the badge is silent most of the time.
 */
export function getWeatherBadge(
  categorySlug: string | null | undefined,
  condition:    WeatherCondition,
): string | null {
  const slug      = categorySlug ?? '';
  const isIndoor  = INDOOR_SLUGS.has(slug);
  const isOutdoor = OUTDOOR_SLUGS.has(slug);

  if (condition === 'thunderstorm') {
    if (isIndoor)  return '⛈ Safe inside';
    if (isOutdoor) return '⛈ Check safety';
  }
  if (condition === 'rain') {
    if (isIndoor)  return '🌧 Great in rain';
    if (isOutdoor) return '🌧 Wet today';
  }
  if (condition === 'showers') {
    if (isIndoor) return '🌦 Dry inside';
  }
  if (condition === 'drizzle') {
    if (isIndoor) return '🌦 Dry inside';
  }
  if (condition === 'snow') {
    if (isIndoor)  return '❄️ Cosy pick';
    if (isOutdoor) return '❄️ Check conditions';
  }
  if (condition === 'clear' && isOutdoor) {
    return '☀️ Ideal today';
  }
  if (condition === 'partly_cloudy' && isOutdoor) {
    return '⛅ Good today';
  }

  return null;
}

/**
 * Returns a banner strip to show above the venue list when weather warrants
 * a recommendation. Returns null for unremarkable weather.
 *
 * `viewMode` controls copy: in list mode venues are sorted so the banner can
 * say "moved to the top"; in map mode only badges are applied so copy says
 * "highlighted" instead.
 */
export function getWeatherBanner(
  weather:  WeatherState,
  viewMode: 'map' | 'list' = 'map',
): { text: string; tint: string } | null {
  const { condition, temperatureC } = weather;
  const sorted = viewMode === 'list';

  if (condition === 'thunderstorm') {
    return {
      text: sorted ? '⛈  Thunderstorm — indoor venues moved to the top' : '⛈  Thunderstorm — indoor venues highlighted',
      tint: '#EDE8F4',
    };
  }
  if (condition === 'rain') {
    return {
      text: sorted ? '🌧  Rainy day — indoor picks sorted to the top' : '🌧  Rainy day — look for the indoor badges',
      tint: '#E6EEF5',
    };
  }
  if (condition === 'showers') {
    return {
      text: sorted ? '🌦  Showery today — indoor venues sorted first' : '🌦  Showery today — indoor venues highlighted',
      tint: '#E8F1F5',
    };
  }
  if (condition === 'snow') {
    return { text: `❄️  Snow forecast — check travel before you go`, tint: '#EDF2F8' };
  }
  if (temperatureC <= 3) {
    return { text: `🧊  Very cold (${temperatureC}°C) — wrap up warm`, tint: '#EDF2F8' };
  }
  if (condition === 'clear' && temperatureC >= 20) {
    return {
      text: sorted ? `☀️  Sunny & warm (${temperatureC}°C) — outdoor venues first` : `☀️  Sunny & warm (${temperatureC}°C) — outdoor venues highlighted`,
      tint: '#FDF8E8',
    };
  }
  if (condition === 'partly_cloudy' && temperatureC >= 18) {
    return { text: `⛅  Nice day (${temperatureC}°C) — good for outdoor activities`, tint: '#F5FBF0' };
  }

  return null;
}

/**
 * Score offset for weather-boosted venue sorting (higher = better match).
 * Used as a secondary sort key — primary sort is still proximity.
 */
export function scoreVenueForWeather(
  categorySlug: string | null | undefined,
  condition:    WeatherCondition,
): number {
  const slug      = categorySlug ?? '';
  const isIndoor  = INDOOR_SLUGS.has(slug);
  const isOutdoor = OUTDOOR_SLUGS.has(slug);

  if (
    condition === 'rain'         ||
    condition === 'showers'      ||
    condition === 'thunderstorm' ||
    condition === 'snow'
  ) {
    if (isIndoor)  return  2;
    if (isOutdoor) return -1;
    return 0;
  }

  if (condition === 'drizzle') {
    if (isIndoor) return 1;
    return 0;
  }

  if (condition === 'clear' || condition === 'partly_cloudy') {
    if (isOutdoor) return 1;
    // Indoor venues are neutral on nice days — parents may deliberately choose
    // indoor activities regardless of weather, so we boost outdoors without
    // burying the indoor options.
    return 0;
  }

  return 0;
}
