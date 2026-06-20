import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { FALLBACK_LOCATION } from '@/constants/location';
import type { Coordinates } from '@/types';

/**
 * Resolves *approximate* coordinates for surfacing nearby venues on the Browse
 * (Home) screen — WITHOUT ever prompting for permission.
 *
 * Privacy (ICO Children's Code Standard 10 + UK GDPR data minimisation):
 *  - Runs ONLY when the app's own location consent is 'granted' AND the OS
 *    foreground permission has ALREADY been granted. Permission is *checked*
 *    (getForegroundPermissionsAsync), never *requested* — so this can never
 *    trigger a system prompt on Home load. The real location prompt still lives
 *    on the Map/results flow (consent-on-intent), unchanged.
 *  - Uses the last-known position only (no fresh GPS fix) and ROUNDS it to ~1km
 *    (2 dp) before returning — Home only needs a rough area, not a precise fix.
 *  - When consent/permission is absent it returns the fixed public
 *    FALLBACK_LOCATION (GB centroid). That is not personal data, so a
 *    non-consenting user still sees real venues without any location access.
 *
 * Returns `{ coords, isApprox }` where `isApprox` is true when the fixed
 * fallback is in use (no personal location), false when real (rounded) coords
 * are used.
 */
export interface ApproxCoords {
  coords: Coordinates;
  isApprox: boolean;
}

// ~1km grid. Rounds away precise GPS so we never hold a fine-grained fix on Home.
function roundCoarse(n: number): number {
  return Math.round(n * 100) / 100;
}

export function useApproxCoords(): ApproxCoords {
  const { status } = useLocationConsent();
  const [coords, setCoords] = useState<ApproxCoords>({
    coords: FALLBACK_LOCATION,
    isApprox: true,
  });

  useEffect(() => {
    let active = true;

    if (status !== 'granted') {
      setCoords({ coords: FALLBACK_LOCATION, isApprox: true });
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        // Check (do NOT request) the OS permission — no prompt.
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          if (active) setCoords({ coords: FALLBACK_LOCATION, isApprox: true });
          return;
        }
        // Cached last-known position only — no fresh fix, no prompt.
        const pos = await Location.getLastKnownPositionAsync();
        if (!pos) {
          if (active) setCoords({ coords: FALLBACK_LOCATION, isApprox: true });
          return;
        }
        if (active) {
          setCoords({
            coords: {
              latitude: roundCoarse(pos.coords.latitude),
              longitude: roundCoarse(pos.coords.longitude),
            },
            isApprox: false,
          });
        }
      } catch {
        if (active) setCoords({ coords: FALLBACK_LOCATION, isApprox: true });
      }
    })();

    return () => {
      active = false;
    };
  }, [status]);

  return coords;
}
