import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { useLocationConsent } from '@/hooks/useLocationConsent';

/**
 * Resolves a friendly area label (city / town / locality) for the Home header
 * — WITHOUT ever prompting for permission and WITHOUT storing precise GPS.
 *
 * Privacy (ICO Children's Code Standard 10 + UK GDPR data minimisation):
 *  - Runs ONLY when the app's own location consent is 'granted' AND the OS
 *    foreground permission has ALREADY been granted. Permission status is
 *    *checked* (getForegroundPermissionsAsync), never *requested* — so this
 *    can never trigger a system prompt on app load.
 *  - Uses the last-known position (no fresh GPS fix, no prompt), reverse-
 *    geocodes it to a place NAME via expo-location (already installed; OS
 *    geocoder, no paid API), and keeps ONLY that string. The coordinates are
 *    used transiently and never stored.
 *  - Returns null when unavailable; the caller falls back to the saved profile
 *    postcode, then a "Choose area" CTA.
 */
export function useAreaLabel(): string | null {
  const { status } = useLocationConsent();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // No app-level consent → never touch location.
    if (status !== 'granted') {
      setLabel(null);
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        // Check (do NOT request) the OS permission — no prompt.
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          if (active) setLabel(null);
          return;
        }

        // Cached last-known position only — no fresh fix, no prompt.
        const pos = await Location.getLastKnownPositionAsync();
        if (!pos) {
          if (active) setLabel(null);
          return;
        }

        const places = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        const p = places?.[0];
        // Town/city only — NEVER a county. expo-location's `subregion`/`region`
        // are county/country level (e.g. "Shropshire"), so they're excluded.
        // Prefer city (post town) → district (neighbourhood/village). Falls back
        // to null (→ caller uses postcode) rather than show a broad county.
        const friendly = p?.city ?? p?.district ?? null;
        if (active) setLabel(friendly && friendly.trim() ? friendly.trim() : null);
      } catch {
        if (active) setLabel(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [status]);

  return label;
}
