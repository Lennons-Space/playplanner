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
