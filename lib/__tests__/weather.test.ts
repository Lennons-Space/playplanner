import {
  classifyCondition,
  parseWeatherResponse,
  getWeatherBadge,
  getWeatherBanner,
  scoreVenueForWeather,
  type WeatherState,
} from '../weather';

// ── classifyCondition ──────────────────────────────────────────────────────

describe('classifyCondition', () => {
  it('maps clear sky (0) correctly', () => {
    expect(classifyCondition(0)).toBe('clear');
  });

  it('maps partly cloudy (1, 2)', () => {
    expect(classifyCondition(1)).toBe('partly_cloudy');
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
