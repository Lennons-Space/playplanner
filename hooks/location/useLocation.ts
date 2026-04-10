import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import type { Coordinates } from '@/types';
import { FALLBACK_LOCATION } from '@/constants/location';
import { recordLocationConsentGranted } from '@/services/consent/locationConsent';
import { coarsenCoordinates } from '@/services/location/coordinates';

interface LocationState {
  coords: Coordinates;
  hasPermission: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Requests location permission and returns the user's current coordinates.
 *
 * Geolocation is NOT requested automatically at app start — it is only
 * requested when a component that uses this hook mounts. This keeps us
 * compliant with ICO Children's Code Standard 10 (geolocation off by default).
 *
 * When permission is granted, consent is logged to `location_consent_log`
 * for GDPR Art.7 compliance. This is non-blocking — a logging failure will
 * not prevent location from working.
 *
 * Falls back to central London if permission is denied or unavailable.
 */
export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    coords: FALLBACK_LOCATION,
    hasPermission: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    // `active` prevents state updates after the component has unmounted.
    // Without this, if the user navigates away while the permission dialog
    // is open, React would warn about setting state on an unmounted component.
    let active = true;

    async function getLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        if (active) {
          setState({ coords: FALLBACK_LOCATION, hasPermission: false, isLoading: false, error: null });
        }
        return;
      }

      // Log consent to the database — required by GDPR Art.7.
      // Non-blocking: we catch and discard errors so a logging failure never
      // stops the user from using the map.
      recordLocationConsentGranted().catch(() => undefined);

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (active) {
          setState({
            // Round to 3 decimal places (~111m) before storing — GDPR Art.5(1)(c) data minimisation.
            // Exact GPS precision (7+ decimals) is never needed for venue discovery.
            coords: coarsenCoordinates(loc.coords.latitude, loc.coords.longitude),
            hasPermission: true,
            isLoading: false,
            error: null,
          });
        }
      } catch {
        if (active) {
          setState({ coords: FALLBACK_LOCATION, hasPermission: true, isLoading: false, error: 'Could not get location' });
        }
      }
    }

    getLocation();
    // Cleanup: stop any pending async work from updating state after unmount.
    return () => { active = false; };
  }, []);

  return state;
}
