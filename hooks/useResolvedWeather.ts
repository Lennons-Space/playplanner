// ─────────────────────────────────────────────────────────────────────────
// useResolvedWeather — the SINGLE shared source of "what weather/atmosphere
// should this screen show right now". Every consumer (Home's weather pill,
// V2Background on every screen) reads from THIS hook — no screen resolves
// weather or location independently, and none of it is route-specific (no
// pathname/route param is ever read here).
//
// ROOT-CAUSE FIX (2026-07-19, product decision from Liam): the weather fetch
// used to ALWAYS use FALLBACK_LOCATION (a GB centroid), even for users who
// had already granted location consent — so a Manchester parent's Home badge
// showed Coventry-ish weather forever. The fix:
//   - PRE-CONSENT / DECLINED: unchanged — FALLBACK_LOCATION, exactly as
//     before. No device-location call of any kind.
//   - GRANTED: use the user's ALREADY-CONSENTED coarse location. This reuses
//     the exact pattern hooks/location/useAreaLabel.ts already established
//     and has in production: CHECK (never REQUEST) the OS permission via
//     getForegroundPermissionsAsync, then read a CACHED last-known position
//     via getLastKnownPositionAsync — never a fresh GPS fix, so mounting
//     this hook (on every screen, since V2Background is everywhere) can
//     NEVER itself trigger the OS location dialog. If the OS permission
//     isn't actually granted (e.g. revoked in system settings after app
//     consent was given), this silently falls back to FALLBACK_LOCATION —
//     never a re-prompt, never an error state.
//
// Data minimisation (GDPR Art.5(1)(c)): the resolved coordinate is rounded
// to 1 decimal place (~11km) before it is ever stored in this hook's state —
// weather forecasts don't need street-level precision. hooks/useWeather.ts's
// fetchWeather() independently ALSO rounds to 1dp for the actual network
// request (belt-and-braces — verified, see that file). Nothing here ever
// logs or renders a coordinate; see components/dev/DevWeatherTester.tsx for
// the honest, coordinate-free diagnostic surface.
//
// Fetch-failure behaviour: unchanged from useWeather's existing React Query
// config (staleTime 15min / gcTime 30min, retry 1) — on a failed refetch for
// the SAME cache key, TanStack Query retains the last successful `data`
// rather than clearing it, so a transient Open-Meteo failure quietly keeps
// showing the last-good reading. Only a genuinely fresh key (e.g. the very
// first fetch after consent is granted, before any data has landed) falls
// through to null → the time-aware fallback atmosphere in resolveAtmosphere.
//
// Consent read (deliberately NOT hooks/useLocationConsent.ts): this hook
// checks the SAME persisted SecureStore flag that hook owns (see
// useSimpleConsentGranted below + constants/location.ts), rather than
// importing that hook directly. Reason: hooks/useLocationConsent.ts's
// `grant()` path pulls in services/consent/locationConsent.ts, which is
// Supabase-backed (writes a GDPR audit-log row) — importing that whole
// module graph from a hook mounted by every <V2Background/> instance
// (nearly every screen, purely decorative) would make a background gradient
// transitively depend on a live DB client for no reason. This hook is
// read-only by construction (it never grants/declines consent, only reads
// the current state), so it doesn't need that write path at all. Both reads
// share one canonical key/value pair (constants/location.ts) so they can
// never drift apart.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useWeather } from '@/hooks/useWeather';
import { useDevWeatherStore } from '@/store/devWeatherStore';
import { useLocationConsentIdentity } from '@/lib/locationConsentIdentity';
import { FALLBACK_LOCATION } from '@/constants/location';
import {
  locationConsentKey,
  parseLocationConsentRecord,
} from '@/lib/locationConsentStorage';
import { isValidCoordinate } from '@/services/location/coordinates';
import { resolveAtmosphere, isNightNow, type Atmosphere } from '@/lib/weatherTheme';
import { conditionLabel, type WeatherState, type WeatherCondition } from '@/lib/weather';

/**
 * Read-only check of the SAME persisted app-level location-consent record
 * hooks/useLocationConsent.ts owns — deliberately NOT that hook itself.
 * That hook's `grant()` path imports services/consent/locationConsent.ts,
 * which is Supabase-backed (writes an audit-log row) — pulling that whole
 * chain into a hook read by every <V2Background/> instance (nearly every
 * screen in the app, purely decorative) would make a background gradient
 * transitively depend on a live DB client for no reason: this hook never
 * calls grant()/decline(), it only ever needs to know the CURRENT state.
 * It shares the key/record helpers in lib/locationConsentStorage.ts — a
 * deliberately dependency-free module — so the two readers can never drift.
 *
 * PP-018: consent is per-account, so this read is too. It is keyed on the
 * signed-in user id, identity-stamped, and generation-guarded, exactly like
 * hooks/useLocationConsent.ts — otherwise a background gradient would happily
 * act on Account A's consent while Account B is signed in. Signed out, it is
 * always false: a guest's session-only agreement is never persisted, so there
 * is nothing here to read.
 *
 * DEPENDENCY BOUNDARY PRESERVED: the account identity is INJECTED via
 * lib/locationConsentIdentity.tsx (a React context supplied by app/_layout.tsx,
 * which already owns auth state) rather than read from store/authStore. That
 * keeps this module — and therefore every <V2Background/> — free of any
 * transitive dependency on lib/supabase, exactly as constants/location.ts
 * originally required. A mirrored identity store was rejected: a mirror that
 * lagged could hand Account A's consent record to Account B, which is the very
 * leak PP-018 closes. Context propagates in the same commit as the auth change,
 * so it cannot lag.
 *
 * Returns 'granted' | 'not-granted' — collapses 'checking' safely: neither
 * 'checking' nor 'undecided' nor 'declined' should ever read a real
 * location, so they're all treated identically here (unlike
 * useLocationConsent's richer 4-state status, which UI screens need for
 * their consent-prompt copy — this hook never renders consent UI).
 */
function useSimpleConsentGranted(): boolean {
  const userId = useLocationConsentIdentity();
  const [state, setState] = useState<{ userId: string | null; granted: boolean }>({
    userId,
    granted: false,
  });
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    let active = true;
    const live = () => active && gen === generation.current;

    // Never carry the previous account's answer into the new identity, not
    // even for the moment before the read below resolves.
    setState({ userId, granted: false });

    if (!userId) {
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(locationConsentKey(userId));
        // A DECLINED record parses successfully too (tri-state) — only an
        // explicit 'granted' decision may unlock location. Truthiness of the
        // record is not enough.
        const record = parseLocationConsentRecord(raw, userId);
        const granted = record?.decision === 'granted';
        if (live()) setState({ userId, granted });
      } catch {
        if (live()) setState({ userId, granted: false });
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  // Identity guard: state describing a different account is never honoured.
  return state.userId === userId ? state.granted : false;
}

/** Round to 1 decimal place (~11km) — weather doesn't need street precision. */
function roundToWeatherPrecision(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Resolves the user's ALREADY-CONSENTED coarse coordinate, or null when
 * unavailable/not applicable. Never requests OS permission, never fires a
 * fresh GPS fix — see the file header for why. Mirrors
 * hooks/location/useAreaLabel.ts's accepted check-then-cached-read pattern.
 */
function useConsentedCoarseCoords(
  consentGranted: boolean,
): { latitude: number; longitude: number } | null {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    let active = true;

    if (!consentGranted) {
      // Covers "checking" | "undecided" | "declined" (all collapse to
      // `false` in useSimpleConsentGranted) — never touch the Location
      // module at all pre-consent or once declined.
      setCoords(null);
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        // CHECK only — never request. No OS prompt can ever fire from here.
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          if (active) setCoords(null);
          return;
        }
        // Cached last-known fix only — no fresh GPS request, no prompt.
        const pos = await Location.getLastKnownPositionAsync();
        if (!pos || !isValidCoordinate(pos.coords.latitude, pos.coords.longitude)) {
          if (active) setCoords(null);
          return;
        }
        if (active) {
          setCoords({
            latitude: roundToWeatherPrecision(pos.coords.latitude),
            longitude: roundToWeatherPrecision(pos.coords.longitude),
          });
        }
      } catch {
        if (active) setCoords(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [consentGranted]);

  return coords;
}

export interface ResolvedWeather {
  /** Live (or __DEV__ synthetic override) weather state — same shape useWeather returns. */
  weather: WeatherState | null;
  /** Final resolved condition, honouring the dev override when active. */
  condition: WeatherCondition | null;
  /** Resolved night flag — honours the __DEV__ force-night override when active. */
  night: boolean;
  /** Final atmosphere every background/badge should render. */
  atmosphere: Atmosphere;
  /** True once we're using the user's real, already-consented coarse location (not the generic fallback). */
  usingConsentedLocation: boolean;
}

/**
 * THE single shared resolved-weather state. Consumed by Home's weather pill
 * AND every <V2Background/> instance — nothing downstream re-derives
 * condition/atmosphere independently, and nothing here is route-specific.
 */
export function useResolvedWeather(): ResolvedWeather {
  const consentGranted = useSimpleConsentGranted();
  const consentedCoords = useConsentedCoarseCoords(consentGranted);
  const usingConsentedLocation = consentGranted && consentedCoords !== null;

  const lat = usingConsentedLocation ? consentedCoords!.latitude : FALLBACK_LOCATION.latitude;
  const lon = usingConsentedLocation ? consentedCoords!.longitude : FALLBACK_LOCATION.longitude;

  // Same coarse, cached, non-personal-by-default fetch — useWeather already
  // handles the __DEV__ weather-tester override internally (single source:
  // store/devWeatherStore.ts), so it is inherited here for free.
  const rawWeather = useWeather(lat, lon);

  const devForceNight = useDevWeatherStore((s) => s.forceNight);
  const night = __DEV__ && devForceNight !== null ? devForceNight : isNightNow();
  const atmosphere = resolveAtmosphere(rawWeather?.condition ?? null, night);

  // Night-label honesty (2026-07-20, Defect 4): CONDITION_META.clear is
  // time-blind ("☀️ Sunny" at 2am) — conditionLabel() supplies the honest
  // night-aware copy using the SAME `night` flag already resolved above, so
  // the label Home's pill reads can never disagree with the atmosphere the
  // background renders. Only emoji/label are overridden — `condition` itself
  // (returned below) stays exactly what the API/dev-override reported, so
  // anything that branches on `condition` (badges, sorting, V2Background's
  // atmosphere lookup) is completely unaffected by this correction.
  const weather: WeatherState | null = rawWeather
    ? { ...rawWeather, ...conditionLabel(rawWeather.condition, night) }
    : null;

  return {
    weather,
    condition: rawWeather?.condition ?? null,
    night,
    atmosphere,
    usingConsentedLocation,
  };
}
