/**
 * useLocationConsent — single source of truth for the location consent flag.
 *
 * WHY THIS HOOK EXISTS:
 * Location is OFF by default (ICO Children's Code, Standard 10). Several
 * surfaces now need to know whether the user has already agreed to location
 * (the decision Home, the results screen, and the map). Before this hook each
 * screen re-implemented the SecureStore read/write — risky for a compliance
 * control. This centralises it so every surface behaves identically.
 *
 * IMPORTANT: reading the stored flag NEVER triggers the OS location dialog.
 * The OS prompt only happens later, when a granted screen actually calls
 * useLocation(). So mounting this hook on the Home screen is privacy-safe —
 * it does not request GPS, it only reads a yes/no we already stored.
 */

import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { recordLocationConsentGranted } from '@/services/consent/locationConsent';

// These MUST match the values the map screen has always used, so existing
// users who already granted consent are not re-prompted after this refactor.
const CONSENT_KEY = 'location_consent_granted';
const CONSENT_VALUE = '1';

export type LocationConsentStatus =
  | 'checking'   // still reading SecureStore — render a neutral placeholder
  | 'granted'    // user agreed (this session or a previous one)
  | 'undecided'  // never asked / never answered — safe to prompt
  | 'declined';  // declined this session (not persisted — re-ask next launch)

export interface UseLocationConsent {
  status: LocationConsentStatus;
  /** Persist consent + write the GDPR audit record. Non-blocking on failure. */
  grant: () => Promise<void>;
  /** Decline for this session only (per ICO: re-ask on next app open). */
  decline: () => void;
}

export function useLocationConsent(): UseLocationConsent {
  const [status, setStatus] = useState<LocationConsentStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(CONSENT_KEY);
        if (!cancelled) setStatus(stored === CONSENT_VALUE ? 'granted' : 'undecided');
      } catch {
        // SecureStore failure — treat as undecided so we prompt rather than
        // silently assume consent.
        if (!cancelled) setStatus('undecided');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const grant = useCallback(async () => {
    try {
      await SecureStore.setItemAsync(CONSENT_KEY, CONSENT_VALUE);
      // GDPR Art.7 audit trail — must never block the user if it fails.
      recordLocationConsentGranted().catch((err: unknown) => {
        console.warn('PlayPlanner: location consent logging failed:', err);
      });
    } catch {
      // If the write fails, consent still applies for this session.
    }
    setStatus('granted');
  }, []);

  const decline = useCallback(() => {
    // Deliberately NOT persisted — ICO guidance is to ask again next launch
    // rather than treat one decline as a permanent answer.
    setStatus('declined');
  }, []);

  return { status, grant, decline };
}
