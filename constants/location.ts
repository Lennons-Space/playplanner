import type { Coordinates } from '@/types';

// Neutral fallback location used ONLY before GPS resolves (e.g. the brief
// moment between mounting and the first permission/position result).
// Deliberately a non-landmark point in central England — roughly the GB
// population centroid — so no user is ever shown a recognisable city (e.g.
// London) as their location. Nearby-venue queries are already guarded not
// to fire while coords still equal this fallback, so it never drives real
// results; it only positions the map before a real fix is available.
// Matches the fallback location described in the privacy policy (GDPR Art.13).
export const FALLBACK_LOCATION: Coordinates = {
  latitude: 52.8,
  longitude: -1.5,
};

// Maximum radius we allow for venue searches (km). ~50 miles.
// Keeps data requests proportionate — GDPR data minimisation principle.
export const MAX_SEARCH_RADIUS_KM = 80;

// Default radius applied when no filter is set. 32km = 20 miles.
// Always display as miles in the UI; this value is km for internal/DB use only.
export const DEFAULT_SEARCH_RADIUS_KM = 32;

// The version label for the current location consent wording.
// Bump this string (e.g. 'v1.1') whenever the consent text changes —
// this lets us tell, per user, which version of the consent they saw.
export const LOCATION_CONSENT_VERSION = 'v1.0';

// The SecureStore key (+ its "granted" sentinel value) that
// hooks/useLocationConsent.ts persists the user's app-level location
// consent flag under. Pulled out to this Supabase-free, dependency-light
// module (rather than importing hooks/useLocationConsent.ts itself) so that
// widely-mounted, purely-decorative consumers — e.g.
// hooks/useResolvedWeather.ts, read via every <V2Background/> instance on
// nearly every screen — can do a READ-ONLY check of the SAME persisted flag
// without transitively pulling in services/consent/locationConsent.ts's
// Supabase-backed audit-log write path (which those consumers never need:
// they never call grant()/decline(), only ever read the current state).
// MUST match hooks/useLocationConsent.ts exactly — that hook is still the
// single place allowed to WRITE this key.
export const LOCATION_CONSENT_STORAGE_KEY = 'location_consent_granted';
export const LOCATION_CONSENT_GRANTED_VALUE = '1';
