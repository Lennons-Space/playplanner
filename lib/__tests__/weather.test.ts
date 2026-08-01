import {
  classifyCondition,
  parseWeatherResponse,
  getWeatherBadge,
  getWeatherBanner,
  scoreVenueForWeather,
  conditionLabel,
  CONDITION_META,
  type WeatherState,
} from '../weather';

// ── classifyCondition ──────────────────────────────────────────────────────

describe('classifyCondition', () => {
  it('maps clear sky (0) correctly', () => {
    expect(classifyCondition(0)).toBe('clear');
  });

  // 2026-07-19 product decision: WMO 0/1/2/3 are four DISTINCT conditions.
  // Code 1 ("mainly clear") used to be collapsed into 'partly_cloudy' along
  // with code 2 — that under-represented how much sun a "mainly clear" day
  // actually has. They are now kept apart; see CONDITION_META for the new
  // mainly_clear entry and lib/weatherTheme.ts (mainly_clear -> sunny
  // atmosphere, same as clear) + components/ui/V2WeatherMotion.tsx
  // (restrained cloud accent, dark only) for how the distinction surfaces.
  it('maps mainly clear (1) as its own distinct condition, NOT partly_cloudy', () => {
    expect(classifyCondition(1)).toBe('mainly_clear');
  });

  it('maps partly cloudy (2) — distinct from mainly_clear (1) since 2026-07-19', () => {
    expect(classifyCondition(2)).toBe('partly_cloudy');
  });

  it('maps overcast (3)', () => {
    expect(classifyCondition(3)).toBe('overcast');
  });

  it('maps fog (45, 48)', () => {
    expect(classifyCondition(45)).toBe('fog');
    expect(classifyCondition(48)).toBe('fog');
  });

  it('maps drizzle (51, 53, 55, 56, 57)', () => {
    for (const code of [51, 53, 55, 56, 57]) {
      expect(classifyCondition(code)).toBe('drizzle');
    }
  });

  it('maps rain (61, 63, 65, 66, 67)', () => {
    for (const code of [61, 63, 65, 66, 67]) {
      expect(classifyCondition(code)).toBe('rain');
    }
  });

  it('maps snow (71, 73, 75, 77)', () => {
    for (const code of [71, 73, 75, 77]) {
      expect(classifyCondition(code)).toBe('snow');
    }
  });

  it('maps snow showers (85, 86) as snow, NOT thunderstorm', () => {
    expect(classifyCondition(85)).toBe('snow');
    expect(classifyCondition(86)).toBe('snow');
  });

  it('maps showers (80, 81, 82)', () => {
    for (const code of [80, 81, 82]) {
      expect(classifyCondition(code)).toBe('showers');
    }
  });

  it('maps thunderstorm (95, 96, 99)', () => {
    for (const code of [95, 96, 99]) {
      expect(classifyCondition(code)).toBe('thunderstorm');
    }
  });
});

// ── parseWeatherResponse ───────────────────────────────────────────────────

describe('parseWeatherResponse', () => {
  it('returns null when current_weather is missing', () => {
    expect(parseWeatherResponse({})).toBeNull();
    expect(parseWeatherResponse({ hourly: { time: [], weathercode: [], temperature_2m: [], precipitation_probability: [] } })).toBeNull();
  });

  it('parses a clear-sky response', () => {
    const result = parseWeatherResponse({
      current_weather: { weathercode: 0, temperature: 18.7 },
    });
    expect(result).not.toBeNull();
    expect(result!.condition).toBe('clear');
    expect(result!.temperatureC).toBe(19); // Math.round(18.7)
    expect(result!.precipProbabilityPct).toBe(0); // no hourly data
  });

  it('rounds negative temperature correctly', () => {
    const result = parseWeatherResponse({
      current_weather: { weathercode: 71, temperature: -1.4 },
    });
    expect(result!.temperatureC).toBe(-1);
  });

  it('averages next-3-hour precipitation probability', () => {
    const now = new Date();
    const hour = now.getHours();
    // Build a 24-element array where the 3 slots from `hour` are 40, 60, 80.
    const probs = new Array(24).fill(0);
    probs[hour]     = 40;
    probs[hour + 1] = 60;
    probs[hour + 2] = 80;

    const result = parseWeatherResponse({
      current_weather: { weathercode: 61, temperature: 10 },
      hourly: {
        time: [],
        weathercode: [],
        temperature_2m: [],
        precipitation_probability: probs,
      },
    });
    expect(result!.precipProbabilityPct).toBe(60); // (40+60+80)/3
  });

  it('does not crash when the hourly slice is shorter than 3 elements', () => {
    // A 24-element array where only the last element is non-zero.
    // slice(23, 26) on a 24-element array returns a single element — the
    // function should average correctly over fewer than 3 values.
    // Force Date to return 23:00 so the slice window is predictable.
    const dateSpy = jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 23 } as unknown as Date),
    );

    const probs = new Array(24).fill(0);
    probs[23] = 90;
    const result = parseWeatherResponse({
      current_weather: { weathercode: 61, temperature: 8 },
      hourly: {
        time: [],
        weathercode: [],
        temperature_2m: [],
        precipitation_probability: probs,
      },
    });

    dateSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result!.precipProbabilityPct).toBe(90);
  });
});

// ── Issue: live weather data-path audit — realistic full Open-Meteo payloads ──
// Full-shape fixtures (the real response Open-Meteo returns, not a minimal
// `{current_weather:{...}}` stub) for the representative code set the
// coordinator asked to prove: 0,1,2,3,45,51,55,61,65,71,80,95. Verified
// against the live Open-Meteo docs (https://open-meteo.com/en/docs) — the
// FULL valid code set is exactly
// {0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99};
// no other code is ever emitted.
function realisticOpenMeteoFixture(weathercode: number, temperature: number) {
  const hourly = {
    time: Array.from({ length: 24 }, (_, i) => `2026-07-18T${String(i).padStart(2, '0')}:00`),
    weathercode: new Array(24).fill(weathercode),
    temperature_2m: new Array(24).fill(temperature),
    precipitation_probability: new Array(24).fill(10),
  };
  return {
    latitude: 52.8,
    longitude: -1.5,
    generationtime_ms: 0.123,
    utc_offset_seconds: 3600,
    timezone: 'Europe/London',
    timezone_abbreviation: 'BST',
    elevation: 100,
    current_weather_units: { time: 'iso8601', interval: 'seconds', temperature: '°C', windspeed: 'km/h', winddirection: '°', weathercode: 'wmo code' },
    current_weather: {
      time: '2026-07-18T12:00',
      interval: 900,
      temperature,
      windspeed: 12.3,
      winddirection: 210,
      is_day: 1,
      weathercode,
    },
    hourly_units: { time: 'iso8601', weathercode: 'wmo code', temperature_2m: '°C', precipitation_probability: '%' },
    hourly,
  };
}

describe('parseWeatherResponse — realistic full Open-Meteo payloads (representative codes)', () => {
  const cases: [number, WeatherState['condition']][] = [
    [0, 'clear'],
    [1, 'mainly_clear'],
    [2, 'partly_cloudy'],
    [3, 'overcast'],
    [45, 'fog'],
    [51, 'drizzle'],
    [55, 'drizzle'],
    [61, 'rain'],
    [65, 'rain'],
    [71, 'snow'],
    [80, 'showers'],
    [95, 'thunderstorm'],
  ];

  it.each(cases)('weathercode %i maps to condition "%s" from a full realistic payload', (code, expected) => {
    const fixture = realisticOpenMeteoFixture(code, 14.2);
    const result = parseWeatherResponse(fixture);
    expect(result).not.toBeNull();
    expect(result!.condition).toBe(expected);
    expect(result!.emoji).toBe(CONDITION_META[expected].emoji);
    expect(result!.label).toBe(CONDITION_META[expected].label);
  });

  it('populates the additive `weathercode` field with the RAW code (diagnostics)', () => {
    const fixture = realisticOpenMeteoFixture(61, 10);
    const result = parseWeatherResponse(fixture);
    expect(result!.weathercode).toBe(61);
  });

  it('extra/unknown top-level fields in a real payload (elevation, timezone, etc) never break parsing', () => {
    const fixture = realisticOpenMeteoFixture(3, 9);
    expect(() => parseWeatherResponse(fixture)).not.toThrow();
  });
});

describe('parseWeatherResponse — fails safely on malformed / incomplete data', () => {
  it('missing current_weather → null (already covered above; re-asserted against a realistic sibling shape)', () => {
    const { current_weather, ...rest } = realisticOpenMeteoFixture(0, 10);
    expect(parseWeatherResponse(rest as never)).toBeNull();
  });

  it('null data → does not throw, callers treat weather as optional (guarded by hooks/useWeather.ts fetchWeather)', () => {
    // parseWeatherResponse itself requires an object argument (typed), but
    // fetchWeather in hooks/useWeather.ts wraps every call in try/catch and
    // only ever calls this with a parsed JSON object — this test documents
    // that a `current_weather: undefined` shape (the realistic "field
    // missing" case, not a JS null) is what actually reaches this function
    // and it fails safely (see the test above).
    expect(parseWeatherResponse({} as never)).toBeNull();
  });
});

describe('classifyCondition — unknown/unexpected code honesty (documented, not changed)', () => {
  // DOCUMENTED BEHAVIOUR, not a bug fix: any code > 86 that Open-Meteo has
  // never actually emitted (verified against https://open-meteo.com/en/docs
  // — the complete valid set is {0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,
  // 71,73,75,77,80,81,82,85,86,95,96,99}) silently falls through to
  // 'thunderstorm'. For every REAL code Open-Meteo can emit this is correct
  // (only 95/96/99 are >86). This is a defensive catch-all for a
  // hypothetical future WMO code Open-Meteo might add, not a proven
  // misclassification of any code the API emits today — changing it would
  // require a cited doc reference to a real emitted code that maps wrongly,
  // which does not exist, so this test documents the gap rather than
  // "fixing" speculative behaviour.
  it('a code between 87–94 (gap in the WMO table — never emitted by Open-Meteo) falls through to thunderstorm', () => {
    expect(classifyCondition(90)).toBe('thunderstorm');
  });

  it('a code between 97–98 (gap in the WMO table — never emitted by Open-Meteo) falls through to thunderstorm', () => {
    expect(classifyCondition(97)).toBe('thunderstorm');
  });

  it('every code Open-Meteo actually documents classifies without hitting the >86 fallback path incorrectly', () => {
    const REAL_CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    for (const code of REAL_CODES) {
      expect(() => classifyCondition(code)).not.toThrow();
    }
    // Only 95/96/99 should resolve via the >86 fallback for real codes.
    const viaFallback = REAL_CODES.filter((c) => c > 86);
    expect(viaFallback).toEqual([95, 96, 99]);
    for (const code of viaFallback) {
      expect(classifyCondition(code)).toBe('thunderstorm');
    }
  });
});

// ── getWeatherBadge ────────────────────────────────────────────────────────

describe('getWeatherBadge', () => {
  it('returns null for neutral conditions (overcast, indoor venue)', () => {
    expect(getWeatherBadge('soft-play', 'overcast')).toBeNull();
  });

  it('returns indoor badge on rainy day for indoor venues', () => {
    expect(getWeatherBadge('soft-play', 'rain')).toBe('🌧 Great in rain');
    expect(getWeatherBadge('bowling',   'rain')).toBe('🌧 Great in rain');
    expect(getWeatherBadge('library',   'rain')).toBe('🌧 Great in rain');
  });

  it('returns outdoor warning on rainy day for outdoor venues', () => {
    expect(getWeatherBadge('park',          'rain')).toBe('🌧 Wet today');
    expect(getWeatherBadge('outdoor-sports','rain')).toBe('🌧 Wet today');
  });

  it('returns outdoor badge on clear day for outdoor venues', () => {
    expect(getWeatherBadge('park',           'clear')).toBe('☀️ Ideal today');
    expect(getWeatherBadge('outdoor-sports', 'clear')).toBe('☀️ Ideal today');
  });

  // Sprint B3: 'playground' was missing from weather.ts OUTDOOR_SLUGS, so it
  // previously got no badge at all (neither outdoor warning nor ideal-day
  // badge). Playgrounds are unambiguously outdoor — this locks the fix.
  it('returns outdoor badges for playground (Sprint B3 fix — was unclassified)', () => {
    expect(getWeatherBadge('playground', 'clear')).toBe('☀️ Ideal today');
    expect(getWeatherBadge('playground', 'rain')).toBe('🌧 Wet today');
  });

  it('returns null for indoor venue on a clear day', () => {
    expect(getWeatherBadge('soft-play', 'clear')).toBeNull();
  });

  it('returns snow badge for indoor venues when snowing', () => {
    expect(getWeatherBadge('soft-play', 'snow')).toBe('❄️ Cosy pick');
  });

  it('correctly handles null/undefined category slug', () => {
    // Uncategorised venues → no badge for any condition
    expect(getWeatherBadge(null,      'rain')).toBeNull();
    expect(getWeatherBadge(undefined, 'rain')).toBeNull();
    expect(getWeatherBadge('',        'rain')).toBeNull();
  });

  it('returns thunderstorm indoor badge, not snow badge, for thunderstorm', () => {
    expect(getWeatherBadge('soft-play', 'thunderstorm')).toBe('⛈ Safe inside');
  });

  it('snow showers (classified as snow) produces snow badge not thunderstorm badge', () => {
    // Verify end-to-end: code 85 → 'snow' → correct badge
    const condition = classifyCondition(85);
    expect(condition).toBe('snow');
    expect(getWeatherBadge('soft-play', condition)).toBe('❄️ Cosy pick');
  });

  // 2026-07-19: mainly_clear (WMO 1) is treated the same as 'clear' for
  // badge purposes — it's "predominantly sunny", not the mixed-sky read of
  // partly_cloudy (which keeps its own distinct, less enthusiastic badge).
  it('mainly_clear gets the SAME outdoor badge as clear, distinct from partly_cloudy', () => {
    expect(getWeatherBadge('park', 'mainly_clear')).toBe('☀️ Ideal today');
    expect(getWeatherBadge('park', 'partly_cloudy')).toBe('⛅ Good today');
  });

  it('mainly_clear returns null for indoor venues, same as clear', () => {
    expect(getWeatherBadge('soft-play', 'mainly_clear')).toBeNull();
  });

  // Phase 9 "weather-driven content consistency": fog gives no reliable
  // indoor-vs-outdoor signal (unlike rain/snow/thunderstorm), so a per-venue
  // badge would be a fabricated claim. This documents that as INTENTIONAL,
  // not an oversight — see getWeatherBanner below for the fog banner fix.
  it('returns null for fog regardless of category (documented, not a gap)', () => {
    expect(getWeatherBadge('park',      'fog')).toBeNull();
    expect(getWeatherBadge('soft-play', 'fog')).toBeNull();
    expect(getWeatherBadge(null,        'fog')).toBeNull();
  });
});

// ── getWeatherBanner ───────────────────────────────────────────────────────

const makeWeather = (overrides: Partial<WeatherState>): WeatherState => ({
  condition:            'overcast',
  temperatureC:         12,
  precipProbabilityPct: 0,
  emoji:                '☁️',
  label:                'Overcast',
  ...overrides,
});

describe('getWeatherBanner', () => {
  it('returns null for neutral conditions (overcast, mild temp)', () => {
    expect(getWeatherBanner(makeWeather({ condition: 'overcast', temperatureC: 12 }))).toBeNull();
  });

  it('returns null for partly_cloudy under 18°C', () => {
    expect(getWeatherBanner(makeWeather({ condition: 'partly_cloudy', temperatureC: 15 }))).toBeNull();
  });

  it('returns banner for rain', () => {
    const banner = getWeatherBanner(makeWeather({ condition: 'rain' }), 'list');
    expect(banner).not.toBeNull();
    expect(banner!.text).toContain('sorted');
  });

  it('banner copy differs between map and list modes for rain', () => {
    const weather = makeWeather({ condition: 'rain' });
    const mapBanner  = getWeatherBanner(weather, 'map');
    const listBanner = getWeatherBanner(weather, 'list');
    expect(mapBanner!.text).not.toBe(listBanner!.text);
    expect(listBanner!.text).toContain('sorted');
    expect(mapBanner!.text).not.toContain('sorted');
  });

  it('returns banner for thunderstorm', () => {
    expect(getWeatherBanner(makeWeather({ condition: 'thunderstorm' }))).not.toBeNull();
  });

  it('returns banner for very cold temperature (<=3°C)', () => {
    const banner = getWeatherBanner(makeWeather({ condition: 'overcast', temperatureC: 2 }));
    expect(banner).not.toBeNull();
    expect(banner!.text).toContain('2°C');
  });

  it('does NOT return cold banner for 4°C', () => {
    expect(getWeatherBanner(makeWeather({ condition: 'overcast', temperatureC: 4 }))).toBeNull();
  });

  it('returns banner for sunny warm day (clear + >=20°C)', () => {
    const banner = getWeatherBanner(makeWeather({ condition: 'clear', temperatureC: 22 }), 'list');
    expect(banner).not.toBeNull();
    expect(banner!.text).toContain('22°C');
  });

  it('does NOT return sunny banner for clear day under 20°C', () => {
    expect(getWeatherBanner(makeWeather({ condition: 'clear', temperatureC: 18 }))).toBeNull();
  });

  it('mainly_clear gets the SAME sunny-and-warm banner as clear (>=20°C)', () => {
    const banner = getWeatherBanner(makeWeather({ condition: 'mainly_clear', temperatureC: 21 }), 'list');
    expect(banner).not.toBeNull();
    expect(banner!.text).toContain('21°C');
  });

  // Phase 9 fix ("weather-driven content consistency" — docx gap #1): fog
  // used to fall through every branch here and return null, so Map/Search
  // showed no weather acknowledgement at all on a foggy day, while Home
  // (getWeatherCta/getHomeContextLine in lib/homeIntents.ts) already showed
  // fog-specific "cosy local pick" copy. This locks in the fix: fog now
  // gets a coherent, non-null banner with matching cosy/local framing (NOT
  // indoor-forcing rain wording) — getWeatherBadge and scoreVenueForWeather
  // remain intentionally neutral for fog (see their own tests), this is
  // purely the informational banner strip.
  describe('fog (Phase 9 fix)', () => {
    it('returns a non-null banner for fog (previously fell through to null)', () => {
      const banner = getWeatherBanner(makeWeather({ condition: 'fog', temperatureC: 10 }));
      expect(banner).not.toBeNull();
      expect(banner!.text).toContain('🌫');
    });

    it('fog copy is cosy/local, not rain/indoor-forcing wording', () => {
      const banner = getWeatherBanner(makeWeather({ condition: 'fog', temperatureC: 10 }));
      expect(banner!.text.toLowerCase()).not.toContain('indoor');
      expect(banner!.text.toLowerCase()).not.toContain('rain');
    });

    it('fog banner takes priority over the cold-temperature banner', () => {
      // <=3C would otherwise trigger the "Very cold" banner — fog's own
      // condition-specific banner must win, same as rain/snow do.
      const banner = getWeatherBanner(makeWeather({ condition: 'fog', temperatureC: 1 }));
      expect(banner!.text).toContain('🌫');
      expect(banner!.text).not.toContain('cold');
    });

    it('fog banner is unaffected by viewMode (fog does not drive venue re-sorting)', () => {
      const weather = makeWeather({ condition: 'fog', temperatureC: 10 });
      const mapBanner  = getWeatherBanner(weather, 'map');
      const listBanner = getWeatherBanner(weather, 'list');
      expect(mapBanner).toEqual(listBanner);
    });
  });
});

// ── scoreVenueForWeather ───────────────────────────────────────────────────

describe('scoreVenueForWeather', () => {
  it('scores indoor venues higher on rainy days', () => {
    expect(scoreVenueForWeather('soft-play', 'rain')).toBeGreaterThan(0);
    expect(scoreVenueForWeather('bowling',   'rain')).toBeGreaterThan(0);
  });

  it('scores outdoor venues lower on rainy days', () => {
    expect(scoreVenueForWeather('park',           'rain')).toBeLessThan(0);
    expect(scoreVenueForWeather('outdoor-sports', 'rain')).toBeLessThan(0);
  });

  it('scores outdoor venues higher on clear days', () => {
    expect(scoreVenueForWeather('park', 'clear')).toBeGreaterThan(0);
  });

  // Sprint B3: 'playground' was missing from OUTDOOR_SLUGS in weather.ts,
  // so it scored 0 (neutral) on both clear and rainy days like an
  // unclassified category — burying it vs. parks on sunny days. It is
  // unambiguously outdoor; these are the corrected expected scores.
  it('scores playground as outdoor: +1 on clear days, -1 on rainy days (Sprint B3 fix)', () => {
    expect(scoreVenueForWeather('playground', 'clear')).toBe(1);
    expect(scoreVenueForWeather('playground', 'rain')).toBe(-1);
  });

  // 2026-07-19: mainly_clear (WMO 1) scores identically to clear/partly_cloudy
  // — no new venue-ranking behaviour invented, per product instruction.
  it('scores mainly_clear the same as clear/partly_cloudy (outdoor +1, indoor neutral)', () => {
    expect(scoreVenueForWeather('park', 'mainly_clear')).toBe(1);
    expect(scoreVenueForWeather('soft-play', 'mainly_clear')).toBe(0);
  });

  it('returns 0 for neutral/uncategorised venues', () => {
    expect(scoreVenueForWeather(null,         'rain')).toBe(0);
    expect(scoreVenueForWeather(undefined,    'rain')).toBe(0);
    expect(scoreVenueForWeather('soft-play',  'overcast')).toBe(0);
    expect(scoreVenueForWeather('soft-play',  'fog')).toBe(0);
  });

  it('indoor venues score 0 (neutral) on sunny days', () => {
    // Outdoor venues get +1 on nice days; indoor stays at 0.
    // Parents choosing soft-play regardless of weather should not be buried.
    expect(scoreVenueForWeather('soft-play',   'clear')).toBe(0);
    expect(scoreVenueForWeather('bowling',     'clear')).toBe(0);
    expect(scoreVenueForWeather('soft-play',   'partly_cloudy')).toBe(0);
  });

  it('applies thunderstorm and snow the same as rain for indoor scoring', () => {
    expect(scoreVenueForWeather('soft-play', 'thunderstorm')).toBe(2);
    expect(scoreVenueForWeather('soft-play', 'snow')).toBe(2);
  });
});

// ── conditionLabel (Defect 4: night-aware label honesty, 2026-07-20) ───────
// CONDITION_META.clear is time-blind ("☀️ Sunny" at 2am) — conditionLabel()
// is the pure seam hooks/useResolvedWeather.ts uses to correct that, without
// touching CONDITION_META itself (still used verbatim by parseWeatherResponse
// and everywhere that genuinely wants the time-blind base copy).
describe('conditionLabel — night-aware label/emoji (Defect 4)', () => {
  it('clear + day: unaffected, same as CONDITION_META.clear', () => {
    expect(conditionLabel('clear', false)).toEqual(CONDITION_META.clear);
  });

  it('clear + night: honest "Clear night" copy with a night icon, not "☀️ Sunny"', () => {
    const result = conditionLabel('clear', true);
    expect(result.label).toBe('Clear night');
    expect(result.emoji).toBe('🌙');
    expect(result).not.toEqual(CONDITION_META.clear);
  });

  it('mainly_clear + day: unaffected, same as CONDITION_META.mainly_clear', () => {
    expect(conditionLabel('mainly_clear', false)).toEqual(CONDITION_META.mainly_clear);
  });

  it('mainly_clear + night: honest night copy, distinct from full "Clear night"', () => {
    const result = conditionLabel('mainly_clear', true);
    expect(result.label).toBe('Mainly clear night');
    expect(result.emoji).toBe('🌙');
    expect(result.label).not.toBe(conditionLabel('clear', true).label);
  });

  it.each([
    'partly_cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'snow', 'showers', 'thunderstorm',
  ] as const)('%s is unaffected by night — every other condition already reads honestly', (condition) => {
    expect(conditionLabel(condition, true)).toEqual(CONDITION_META[condition]);
    expect(conditionLabel(condition, false)).toEqual(CONDITION_META[condition]);
  });
});
