// Pure utility layer for Open-Meteo weather data.
// No React Query here — all functions are plain TS so they can be tested
// without a render context and reused outside the explore screen.

export type WeatherCondition =
  | 'clear'
  | 'mainly_clear'
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
  /**
   * ADDITIVE (diagnostics only) — the raw WMO weather code Open-Meteo
   * returned, before classifyCondition() collapses it into a WeatherCondition.
   * Undefined for any WeatherState that didn't come from a real API response
   * (e.g. the __DEV__ weather tester's synthetic override — see
   * hooks/useWeather.ts) — that absence is itself a useful diagnostic signal
   * ("this reading isn't real"). Never used for any behavioural branching,
   * only ever displayed (e.g. components/dev/DevWeatherTester.tsx).
   */
  weathercode?: number;
}

// WMO Weather interpretation codes → WeatherCondition.
// Full table: https://open-meteo.com/en/docs#weathervariables
export function classifyCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  // WMO 0/1/2/3 are four DISTINCT conditions ("clear sky" / "mainly clear" /
  // "partly cloudy" / "overcast") — previously 1 and 2 were both collapsed
  // into 'partly_cloudy', which under-represented how much sun a "mainly
  // clear" (WMO 1) day actually has. Product decision (2026-07-19): keep
  // them distinct so the UI can show a predominantly-sunny treatment for 1
  // and a genuinely mixed treatment for 2. See CONDITION_META, weatherTheme's
  // resolveAtmosphere (mainly_clear → sunny, same as clear) and
  // V2WeatherMotion (restrained cloud accents on mainly_clear only).
  if (code === 1) return 'mainly_clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3) return 'overcast';
  if (code <= 48) return 'fog';       // 45, 48
  if (code <= 57) return 'drizzle';   // 51, 53, 55, 56, 57
  if (code <= 67) return 'rain';      // 61, 63, 65, 66, 67
  if (code <= 77) return 'snow';      // 71, 73, 75, 77
  if (code <= 82) return 'showers';   // 80, 81, 82
  if (code <= 86) return 'snow';      // 85, 86: snow showers slight/heavy
  return 'thunderstorm';              // 95, 96, 99
}

// Exported (additive) so hooks/useWeather.ts can build an honest synthetic
// WeatherState for the __DEV__ weather tester's override — the SAME
// emoji/label production code uses, never invented copy.
export const CONDITION_META: Record<WeatherCondition, { emoji: string; label: string }> = {
  clear:         { emoji: '☀️', label: 'Sunny' },
  mainly_clear:  { emoji: '🌤', label: 'Mainly clear' },
  partly_cloudy: { emoji: '⛅', label: 'Partly cloudy' },
  overcast:      { emoji: '☁️', label: 'Overcast' },
  fog:           { emoji: '🌫', label: 'Foggy' },
  drizzle:       { emoji: '🌦', label: 'Drizzly' },
  rain:          { emoji: '🌧', label: 'Rainy' },
  snow:          { emoji: '❄️', label: 'Snowing' },
  showers:       { emoji: '🌦', label: 'Showery' },
  thunderstorm:  { emoji: '⛈', label: 'Thunderstorm' },
};

/**
 * Night-aware label/emoji for a condition (2026-07-20, Defect 4 fix).
 *
 * CONDITION_META.clear is time-blind — {emoji:'☀️', label:'Sunny'} — so a
 * genuinely clear sky at 2am rendered "☀️ Sunny", which reads as dishonest
 * next to a correctly-dark night atmosphere. Only 'clear'/'mainly_clear'
 * need a night-specific copy: every other condition (rain, overcast, snow,
 * fog, ...) already reads honestly regardless of time of day, so this is a
 * narrow, additive correction — not a full label rewrite.
 *
 * Pure function: the caller (hooks/useResolvedWeather.ts) supplies the
 * already-resolved `night` flag, so there remains exactly ONE source of
 * "is it night" in the app (lib/weatherTheme.ts isNightNow / the __DEV__
 * force-night override) — this helper never reads the clock itself.
 */
export function conditionLabel(
  condition: WeatherCondition,
  night: boolean,
): { emoji: string; label: string } {
  if (night) {
    if (condition === 'clear') return { emoji: '🌙', label: 'Clear night' };
    if (condition === 'mainly_clear') return { emoji: '🌙', label: 'Mainly clear night' };
  }
  return CONDITION_META[condition];
}

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
    weathercode,
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
  // mainly_clear (WMO 1) is treated the same as clear here — it is
  // "predominantly sunny", not the mixed sun/cloud read of partly_cloudy
  // (WMO 2), which keeps its own distinct badge below.
  if ((condition === 'clear' || condition === 'mainly_clear') && isOutdoor) {
    return '☀️ Ideal today';
  }
  if (condition === 'partly_cloudy' && isOutdoor) {
    return '⛅ Good today';
  }

  // fog: deliberately no per-venue badge. Unlike rain/snow/thunderstorm, fog
  // gives no reliable indoor-vs-outdoor signal (it's not a reason to avoid a
  // park, and it's not a special reason to pick a soft-play centre either),
  // so inventing one here would be a fabricated claim, not an honest badge.
  // scoreVenueForWeather() correctly treats fog as neutral (returns 0) for
  // the same reason. The banner-level fog acknowledgement lives in
  // getWeatherBanner() below (Phase 9 fix — see getWeatherBanner's fog
  // branch for why the banner still needs to say SOMETHING).
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
  // fog (Phase 9 fix — docx "weather-driven content consistency"): previously
  // fog fell through every branch here and rendered NOTHING on Map/Search,
  // while Home (getWeatherCta/getHomeContextLine in lib/homeIntents.ts)
  // already shows thoughtful fog-specific copy ("Foggy morning — a cosy
  // local pick?"). That was the "not deriving from one coherent
  // weather/content state" gap — fog is a first-class WeatherCondition with
  // its own CONDITION_META entry, it just wasn't wired in here. Matches the
  // same cosy/local framing as Home, NOT indoor-forcing language — fog gets
  // no venue-level sort/badge treatment (see getWeatherBadge and
  // scoreVenueForWeather above, both intentionally neutral for fog), this is
  // purely an honest acknowledgement banner. Tint is a muted grey in the
  // same pastel family as the snow/cold banners above, not the warmer
  // thunderstorm/rain blues (fog isn't a warning).
  if (condition === 'fog') {
    return { text: '🌫  Foggy — sticking local today', tint: '#ECEEF0' };
  }
  if (temperatureC <= 3) {
    return { text: `🧊  Very cold (${temperatureC}°C) — wrap up warm`, tint: '#EDF2F8' };
  }
  if ((condition === 'clear' || condition === 'mainly_clear') && temperatureC >= 20) {
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

  if (condition === 'clear' || condition === 'mainly_clear' || condition === 'partly_cloudy') {
    if (isOutdoor) return 1;
    // Indoor venues are neutral on nice days — parents may deliberately choose
    // indoor activities regardless of weather, so we boost outdoors without
    // burying the indoor options.
    return 0;
  }

  return 0;
}
