import type { Coordinates } from '@/types';

// Default location shown when the user denies permission or location is unavailable.
// Central London — a well-known public landmark, not tied to any individual.
export const FALLBACK_LOCATION: Coordinates = {
  latitude: 51.5074,
  longitude: -0.1278,
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
