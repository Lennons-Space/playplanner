/**
 * Tests for hooks/useResolvedWeather.ts — the single shared resolved-weather
 * source (Home's weather pill + every <V2Background/> instance).
 *
 * Root-cause fix under test (2026-07-19, product decision): the weather path
 * used to ALWAYS use FALLBACK_LOCATION, even for users who had already
 * granted location consent. Covers:
 *   1. Pre-consent: FALLBACK_LOCATION, zero device-location calls.
 *   2. Declined / not granted: same as pre-consent — never touches Location.
 *   3. Granted: checks (never requests) OS permission, reads a CACHED
 *      last-known position, rounds it to 1dp (~11km) before handing it to
 *      useWeather.
 *   4. Two independent consumers (simulating Home's badge + a
 *      <V2Background/> instance) resolve to the IDENTICAL condition —
 *      "badge and background can never disagree".
 *   6. A failed/absent fetch (useWeather returns null) fails safely to the
 *      time-aware fallback atmosphere, never throws.
 *   12. Force-night flips the resolved atmosphere without corrupting the
 *      live weather condition.
 *   17. Takes no route/pathname argument — nothing here is route-specific.
 *
 * useWeather itself is mocked (its own dedicated suite —
 * hooks/__tests__/useWeather.test.ts — already covers the override/reset/
 * cache-key behaviour in full) so this file can assert purely on the NEW
 * consent-gating + location-resolution logic this hook adds on top.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useResolvedWeather } from '@/hooks/useResolvedWeather';
import { useDevWeatherStore } from '@/store/devWeatherStore';
import { FALLBACK_LOCATION } from '@/constants/location';
import { buildLocationConsentRecord } from '@/lib/locationConsentStorage';
import type { WeatherState } from '@/lib/weather';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(), // must NEVER be called
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
}));

// PP-018: location consent is scoped to the signed-in account, so this hook
// needs to know WHOSE consent to look for. The identity is INJECTED via
// lib/locationConsentIdentity.tsx — deliberately NOT read from store/authStore,
// which would drag lib/supabase into every <V2Background/> instance. Mocking
// the context here is also what keeps this suite Supabase-free.
//
// Signed out the identity is null and this hook is always "not granted": a
// guest is never offered precise location at all. These tests exercise the
// signed-in path, so a stable identity is supplied.
const TEST_USER_ID = 'weather-user-1111-4aaa-8aaa-aaaaaaaaaaaa';
// Mutable so the signed-out (guest) case can be exercised too. Reset in
// beforeEach to the signed-in identity that most tests here assume.
let mockIdentity: string | null = TEST_USER_ID;
jest.mock('@/lib/locationConsentIdentity', () => ({
  useLocationConsentIdentity: () => mockIdentity,
}));

/** A GRANTED record that positively identifies TEST_USER_ID as its owner. */
const GRANTED_RECORD = buildLocationConsentRecord(TEST_USER_ID, 'v1.0', 'granted');

/** A DECLINED record for the same account — parses fine, must NOT unlock GPS. */
const DECLINED_RECORD = buildLocationConsentRecord(TEST_USER_ID, 'v1.0', 'declined');

const mockUseWeatherArgs = jest.fn();
let mockWeatherReturn: WeatherState | null = null;
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (lat: number, lon: number) => {
    mockUseWeatherArgs(lat, lon);
    return mockWeatherReturn;
  },
}));

const L = Location as jest.Mocked<typeof Location>;
const SS = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  jest.clearAllMocks();
  useDevWeatherStore.setState({ override: null, forceNight: null });
  mockIdentity = TEST_USER_ID;
  mockWeatherReturn = null;
  (SS.getItemAsync as jest.Mock).mockResolvedValue(null); // no persisted consent by default
  (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
});

describe('useResolvedWeather — OS permission is not app consent (PP-018)', () => {
  // The device-level Android/iOS location permission is granted once and stays
  // granted across account switches. It says nothing about whether the CURRENT
  // PlayPlanner account agreed to location — that is a separate, per-account
  // decision (GDPR Art.7; ICO Children's Code Standard 10).
  //
  // This is the account-switch case in miniature: B signs in on a device where
  // A had already granted both. B has no consent record of their own, so no
  // location may be used for B no matter what the OS says.
  it('OS permission granted + NO account consent → still no location is read', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(null); // this account never consented
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 53.4808, longitude: -2.2426 },
    });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());

    // The Location module must not be consulted at all — not even the
    // permission CHECK, let alone a cached position.
    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(L.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
    expect(mockUseWeatherArgs).toHaveBeenCalledWith(
      FALLBACK_LOCATION.latitude,
      FALLBACK_LOCATION.longitude,
    );
  });

  // Guest ruling: signed out, precise location is not offered at all. Even a
  // stored record and a granted OS permission must not unlock it — there is no
  // account whose consent could apply.
  it('signed out + OS permission granted + a stored record → no location is read', async () => {
    mockIdentity = null;
    (SS.getItemAsync as jest.Mock).mockResolvedValue(GRANTED_RECORD);
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 53.4808, longitude: -2.2426 },
    });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());

    // Nothing is even read from storage for a guest, let alone acted on.
    expect(SS.getItemAsync).not.toHaveBeenCalled();
    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
    expect(mockUseWeatherArgs).toHaveBeenCalledWith(
      FALLBACK_LOCATION.latitude,
      FALLBACK_LOCATION.longitude,
    );
  });

  // Tri-state: a DECLINED record parses successfully, so a truthiness check on
  // the parsed record would wrongly unlock location. Only an explicit
  // 'granted' decision may.
  it('OS permission granted + account DECLINED → still no location is read', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(DECLINED_RECORD);
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 53.4808, longitude: -2.2426 },
    });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());

    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(L.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
    expect(mockUseWeatherArgs).toHaveBeenCalledWith(
      FALLBACK_LOCATION.latitude,
      FALLBACK_LOCATION.longitude,
    );
  });

  // A consent record belonging to a DIFFERENT account is not this account's
  // consent, even with the OS permission granted.
  it('OS permission granted + another account’s consent record → no location is read', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(
      buildLocationConsentRecord('some-other-account-id', 'v1.0'),
    );
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());

    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
  });
});

describe('useResolvedWeather — pre-consent / not granted (items 1, 2)', () => {
  it('pre-consent: uses FALLBACK_LOCATION and never touches the Location module at all', async () => {
    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());
    expect(mockUseWeatherArgs).toHaveBeenCalledWith(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(L.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
  });

  it('declined / never-persisted consent: identical to pre-consent — FALLBACK_LOCATION, no Location calls', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue('0'); // present but not the granted sentinel
    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());
    expect(mockUseWeatherArgs).toHaveBeenCalledWith(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
  });

  it('a SecureStore read failure fails safely to "not granted" (FALLBACK_LOCATION), never throws', async () => {
    (SS.getItemAsync as jest.Mock).mockRejectedValue(new Error('SecureStore unavailable'));
    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());
    expect(mockUseWeatherArgs).toHaveBeenCalledWith(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
    expect(result.current.usingConsentedLocation).toBe(false);
  });
});

describe('useResolvedWeather — granted (item 3): consented coarse location', () => {
  it('checks (never requests) OS permission, reads a CACHED last-known position, and rounds it to 1dp before use', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(GRANTED_RECORD);
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 53.4808123, longitude: -2.2426456 }, // Manchester-ish, deliberately high precision
    });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(result.current.usingConsentedLocation).toBe(true));

    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    // Rounded to 1dp (~11km) — NOT the raw high-precision reading.
    expect(mockUseWeatherArgs).toHaveBeenLastCalledWith(53.5, -2.2);
  });

  it('OS permission not actually granted (revoked in system settings after app consent) → silently falls back, no re-prompt', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(GRANTED_RECORD);
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());

    expect(L.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.usingConsentedLocation).toBe(false);
    expect(mockUseWeatherArgs).toHaveBeenLastCalledWith(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  });

  it('no cached last-known position yet → falls back to FALLBACK_LOCATION, never throws', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(GRANTED_RECORD);
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());
    expect(result.current.usingConsentedLocation).toBe(false);
    expect(mockUseWeatherArgs).toHaveBeenLastCalledWith(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  });

  it('an invalid coordinate from the OS is rejected — falls back rather than feeding garbage to the fetch', async () => {
    (SS.getItemAsync as jest.Mock).mockResolvedValue(GRANTED_RECORD);
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 999, longitude: 999 } });

    const { result } = renderHook(() => useResolvedWeather());
    await waitFor(() => expect(mockUseWeatherArgs).toHaveBeenCalled());
    expect(result.current.usingConsentedLocation).toBe(false);
  });
});

describe('useResolvedWeather — badge and background can never disagree (item 4)', () => {
  it('two independent consumers (simulating Home\'s pill + a <V2Background/> instance) resolve the IDENTICAL condition/atmosphere', () => {
    mockWeatherReturn = {
      condition: 'rain', temperatureC: 9, precipProbabilityPct: 80, emoji: '🌧', label: 'Rainy',
    };
    const a = renderHook(() => useResolvedWeather());
    const b = renderHook(() => useResolvedWeather());
    expect(a.result.current.condition).toBe(b.result.current.condition);
    expect(a.result.current.atmosphere).toBe(b.result.current.atmosphere);
    expect(a.result.current.condition).toBe('rain');
    expect(a.result.current.atmosphere).toBe('rain');
  });
});

describe('useResolvedWeather — failed/absent fetch fails safely (item 6)', () => {
  it('useWeather returning null resolves to a null condition + the time-aware fallback atmosphere, never throws', () => {
    mockWeatherReturn = null;
    const { result } = renderHook(() => useResolvedWeather());
    expect(result.current.weather).toBeNull();
    expect(result.current.condition).toBeNull();
    expect(['sunny', 'night']).toContain(result.current.atmosphere);
  });
});

describe('useResolvedWeather — force-night never corrupts the live weather condition (item 12)', () => {
  it('force-night flips the resolved atmosphere to night while the underlying condition is untouched', () => {
    mockWeatherReturn = {
      condition: 'clear', temperatureC: 20, precipProbabilityPct: 0, emoji: '☀️', label: 'Sunny',
    };
    useDevWeatherStore.setState({ forceNight: true });

    const { result } = renderHook(() => useResolvedWeather());

    expect(result.current.condition).toBe('clear'); // unchanged — force-night never touches the weather reading
    expect(result.current.night).toBe(true);
    expect(result.current.atmosphere).toBe('night');
  });

  it('force-night=false explicitly forces day even at night wall-clock time, without altering condition', () => {
    mockWeatherReturn = {
      condition: 'overcast', temperatureC: 10, precipProbabilityPct: 0, emoji: '☁️', label: 'Overcast',
    };
    useDevWeatherStore.setState({ forceNight: false });

    const { result } = renderHook(() => useResolvedWeather());

    expect(result.current.condition).toBe('overcast');
    expect(result.current.night).toBe(false);
    expect(result.current.atmosphere).toBe('cloudy'); // overcast is night-invariant anyway, but night flag itself is honoured
  });
});

describe('useResolvedWeather — no route-specific logic (item 17)', () => {
  it('the hook takes no arguments at all — nothing here can vary by route/pathname', () => {
    expect(useResolvedWeather.length).toBe(0);
  });
});

// ── Defect 4: night-label honesty (2026-07-20) ─────────────────────────────
// CONDITION_META.clear is time-blind ("☀️ Sunny" at 2am). This hook is the
// seam that corrects it (conditionLabel(), lib/weather.ts) using the SAME
// `night` flag it already resolves for `atmosphere` — so Home's pill
// (which reads `weather.label`/`weather.emoji`) can never show "Sunny"
// while the background renders night. `condition` itself must stay
// untouched (still 'clear') so nothing that branches on `condition`
// (badges/sorting/atmosphere) is affected — only the label/emoji shown to
// the user changes.
//
// force-night is used (not a Date.prototype.getHours spy) — it's the
// established, already-tested override for this hook and avoids pinning
// the real clock for a test that isn't about isNightNow() itself.
describe('useResolvedWeather — night-label honesty (Defect 4)', () => {
  it('clear + forced day: weather.label stays "Sunny", emoji stays "☀️" (unaffected)', () => {
    mockWeatherReturn = {
      condition: 'clear', temperatureC: 18, precipProbabilityPct: 0, emoji: '☀️', label: 'Sunny',
    };
    useDevWeatherStore.setState({ forceNight: false });

    const { result } = renderHook(() => useResolvedWeather());

    expect(result.current.condition).toBe('clear');
    expect(result.current.weather?.label).toBe('Sunny');
    expect(result.current.weather?.emoji).toBe('☀️');
  });

  it('clear + forced night: weather.label becomes an honest "Clear night" with a night icon — condition stays "clear"', () => {
    mockWeatherReturn = {
      condition: 'clear', temperatureC: 8, precipProbabilityPct: 0, emoji: '☀️', label: 'Sunny',
    };
    useDevWeatherStore.setState({ forceNight: true });

    const { result } = renderHook(() => useResolvedWeather());

    // condition is the raw API/dev-override reading — untouched by the
    // label correction, so any code branching on `condition` is unaffected.
    expect(result.current.condition).toBe('clear');
    expect(result.current.night).toBe(true);
    expect(result.current.weather?.label).toBe('Clear night');
    expect(result.current.weather?.emoji).toBe('🌙');
    // Every other field on the WeatherState is preserved (only label/emoji change).
    expect(result.current.weather?.temperatureC).toBe(8);
    expect(result.current.weather?.precipProbabilityPct).toBe(0);
  });

  it('other conditions (e.g. overcast) are unaffected by night — label/emoji identical day vs night', () => {
    mockWeatherReturn = {
      condition: 'overcast', temperatureC: 10, precipProbabilityPct: 20, emoji: '☁️', label: 'Overcast',
    };
    useDevWeatherStore.setState({ forceNight: true });
    const nightResult = renderHook(() => useResolvedWeather());
    expect(nightResult.result.current.weather?.label).toBe('Overcast');
    expect(nightResult.result.current.weather?.emoji).toBe('☁️');

    useDevWeatherStore.setState({ forceNight: false });
    const dayResult = renderHook(() => useResolvedWeather());
    expect(dayResult.result.current.weather?.label).toBe('Overcast');
    expect(dayResult.result.current.weather?.emoji).toBe('☁️');
  });

  it('a null weather (no reading yet) stays null — no crash from the label correction', () => {
    mockWeatherReturn = null;
    useDevWeatherStore.setState({ forceNight: true });
    const { result } = renderHook(() => useResolvedWeather());
    expect(result.current.weather).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dependency-boundary guard (PP-018)
// ─────────────────────────────────────────────────────────────────────────────
//
// This hook is mounted by every <V2Background/> instance, i.e. nearly every
// screen, purely for decoration. It must NOT reach a live DB client.
//
// PP-018 nearly broke this: scoping consent per account needs the current user
// id, and the obvious source — store/authStore — imports lib/supabase. The
// identity is injected via lib/locationConsentIdentity.tsx instead (a React
// context supplied by app/_layout.tsx), which keeps the boundary intact.
//
// A source-level assertion rather than a behavioural one, because the failure
// mode is an IMPORT: a future refactor reaching for useAuthStore here would
// still pass every behavioural test in this file while quietly dragging
// Supabase into every background gradient. Mirrors the existing source-guard
// idiom in app/explore/__tests__/results.test.tsx.
describe('useResolvedWeather — stays free of the Supabase module graph', () => {
  it('does not import store/authStore or lib/supabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'useResolvedWeather.ts'),
      'utf8',
    );

    // Strip comments so the explanatory prose above these imports (which names
    // both modules on purpose) cannot make this guard pass or fail spuriously.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line: string) => !line.trim().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/from\s+['"]@\/store\/authStore['"]/);
    expect(code).not.toMatch(/from\s+['"]@\/lib\/supabase['"]/);
    expect(code).not.toMatch(/from\s+['"]@\/services\/consent\//);
    // And it DOES use the injected identity.
    expect(code).toMatch(/from\s+['"]@\/lib\/locationConsentIdentity['"]/);
  });
});
