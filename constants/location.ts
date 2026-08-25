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

// NOTE (PP-018, 2026-08-25): the app-level location-consent STORAGE contract
// used to live here as a device-global key plus a bare '1' sentinel. Both are
// gone. A bare sentinel under a shared key cannot say who granted it, so every
// account on the device read it as its own — Account A's consent silently
// became Account B's (GDPR Art.7; ICO Children's Code Standard 10).
//
// Consent storage now lives in lib/locationConsentStorage.ts: a per-account key
// holding a record that names its own owner. That module is deliberately just
// as dependency-free as this one, so hooks/useResolvedWeather.ts (mounted by
// every <V2Background/> instance) can still read consent without pulling in the
// Supabase-backed audit-log write path. The old key survives there only as
// LEGACY_GLOBAL_LOCATION_CONSENT_KEY, which is deleted on sight, never read.
