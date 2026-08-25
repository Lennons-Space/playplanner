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
 *
 * ── PP-018 (2026-08-25): CONSENT IS SCOPED TO THE SIGNED-IN ACCOUNT ────────
 * This flag used to live under ONE device-global SecureStore key holding a
 * bare sentinel (`'1'`), so every account on the device read the same value:
 * Account A's consent silently became Account B's. GDPR Art.7 requires consent
 * to be attributable to a specific data subject, so that is a real
 * cross-identity leak, not just untidy state.
 *
 * Three defences, mirroring the PP-017 precedent in app/profile/data-download.tsx:
 *   1. The storage KEY is per-account (lib/locationConsentStorage.ts).
 *   2. The stored RECORD names its own owner, so a value that lands under the
 *      wrong key during an account-confusion episode still disowns itself.
 *   3. State is IDENTITY-STAMPED and the effect carries a GENERATION counter,
 *      so a slow read issued for A can never settle into a hook now rendering
 *      for B, and a render can never show a status belonging to another
 *      account — not even for a single frame.
 *
 * ── TRI-STATE (product ruling, 2026-08-25) ────────────────────────────────
 * A decline is now PERSISTED per account: unknown / granted / declined.
 * B declining, signing out and returning stays declined rather than being
 * re-prompted every session (ICO Standard 7 — repeatedly nagging for a
 * decision already made is a dark pattern). Only 'undecided' ever prompts. The
 * decision is changeable at any time from Privacy & data — the GDPR Art.7(3)
 * surface, which now works in both directions.
 *
 * ── SIGNED OUT (product ruling, 2026-08-25) ───────────────────────────────
 * Guests get 'unavailable': precise location is not offered at all. No prompt,
 * nothing persisted, no audit evidence created, and nothing a later account
 * could inherit. Guest browsing continues on the existing postcode/manual/
 * fallback path. Signing in still requires that account's own consent before
 * any precise location is used.
 *
 * OS PERMISSION IS A SEPARATE CONCEPT. The Android/iOS location permission is
 * device-level and may well still be granted when a new account signs in. That
 * is NOT PlayPlanner consent: a fresh account reads as 'undecided' here and is
 * prompted through the app's own flow before any precise location is used. We
 * likewise never revoke the OS permission when an account signs out or
 * withdraws app-level consent — that is the device owner's setting, not ours.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  recordLocationConsentGranted,
  recordLocationConsentDenied,
  recordLocationConsentWithdrawn,
} from '@/services/consent/locationConsent';
import { useLocationConsentIdentity } from '@/lib/locationConsentIdentity';
import { LOCATION_CONSENT_VERSION } from '@/constants/location';
import {
  LEGACY_GLOBAL_LOCATION_CONSENT_KEY,
  locationConsentKey,
  buildLocationConsentRecord,
  parseLocationConsentRecord,
} from '@/lib/locationConsentStorage';

export type LocationConsentStatus =
  | 'checking'      // still reading SecureStore — render a neutral placeholder
  | 'granted'       // this account agreed (this session or a previous one)
  | 'undecided'     // this account has never answered — the only state that prompts
  | 'declined'      // this account said no — persisted, changeable in settings
  | 'unavailable';  // nobody is signed in — precise location is not offered

export interface UseLocationConsent {
  status: LocationConsentStatus;
  /** Persist consent for THIS account + write the GDPR audit record. */
  grant: () => Promise<void>;
  /** Persist a refusal for THIS account + record the denial (Art.5(2)). */
  decline: () => Promise<void>;
  /** Withdraw an existing grant from settings (Art.7(3)). Persists 'declined'. */
  revoke: () => Promise<void>;
}

/** Identity-stamped state — a status is only ever valid for the account named. */
interface ConsentState {
  userId: string | null;
  status: LocationConsentStatus;
}

/** Delete without ever throwing — retiring stale state must not break a screen. */
async function safeDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to do. The parse guard already refuses unattributable values,
    // so a failed delete degrades to "asked again", never to a false grant.
  }
}

export function useLocationConsent(): UseLocationConsent {
  // Injected, not reached for — see lib/locationConsentIdentity.tsx for why a
  // mirrored identity store was rejected.
  const userId = useLocationConsentIdentity();
  const [state, setState] = useState<ConsentState>({ userId, status: 'checking' });

  // Bumped on every identity change. A read that resolves after its generation
  // is superseded is dropped — this is what makes the async path identity-safe.
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    let cancelled = false;
    const live = () => !cancelled && gen === generation.current;

    setState({ userId, status: 'checking' });

    (async () => {
      // Retire the pre-PP-018 device-global record on sight, whoever is signed
      // in. It holds one account's decision and was served to all of them, and
      // nothing can prove whose it was — so it is deleted, never adopted. This
      // applies equally to a legacy "granted" and a legacy "denied" value.
      await safeDelete(LEGACY_GLOBAL_LOCATION_CONSENT_KEY);

      if (!live()) return;

      // Signed out: precise location is not offered at all, and nothing is
      // read or written. Guests browse on the fallback/manual path.
      if (!userId) {
        if (live()) setState({ userId: null, status: 'unavailable' });
        return;
      }

      const key = locationConsentKey(userId);
      let status: LocationConsentStatus = 'undecided';

      try {
        const raw = await SecureStore.getItemAsync(key);
        const record = parseLocationConsentRecord(raw, userId);
        if (record) {
          status = record.decision === 'granted' ? 'granted' : 'declined';
        } else if (raw !== null) {
          // Present but unattributable — a bare legacy sentinel, a malformed
          // value, or a record naming a different account. Discard rather than
          // honour it: the privacy-safe failure mode is asking once more.
          await safeDelete(key);
        }
      } catch {
        // SecureStore failure — treat as undecided so we prompt rather than
        // silently assume consent.
        status = 'undecided';
      }

      if (live()) setState({ userId, status });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * Persist a decision for the CURRENT account and reflect it in state.
   * A no-op when signed out: a guest decision has no data subject to belong
   * to, and persisting it could only ever serve it to whoever signs in next.
   */
  const persist = useCallback(
    async (decision: 'granted' | 'declined', next: LocationConsentStatus) => {
      if (!userId) return;
      try {
        await SecureStore.setItemAsync(
          locationConsentKey(userId),
          buildLocationConsentRecord(userId, LOCATION_CONSENT_VERSION, decision),
        );
      } catch {
        // The write failed, but the decision still applies for this session.
        // Losing it means the account is asked again — never wrongly granted.
      }
      setState({ userId, status: next });
    },
    [userId],
  );

  const grant = useCallback(async () => {
    await persist('granted', 'granted');
    if (!userId) return;
    // GDPR Art.7 audit trail — must never block the user if it fails.
    recordLocationConsentGranted().catch((err: unknown) => {
      console.warn('PlayPlanner: location consent logging failed:', err);
    });
  }, [persist, userId]);

  const decline = useCallback(async () => {
    await persist('declined', 'declined');
    if (!userId) return;
    // Art.5(2) accountability: record that we asked and were refused, so we
    // can demonstrate the refusal was honoured and not prompted around.
    recordLocationConsentDenied().catch((err: unknown) => {
      console.warn('PlayPlanner: location denial logging failed:', err);
    });
  }, [persist, userId]);

  const revoke = useCallback(async () => {
    await persist('declined', 'declined');
    if (!userId) return;
    // Art.7(3): a withdrawal is a distinct event from an initial refusal, and
    // the consent log records it against the account's existing grant.
    recordLocationConsentWithdrawn().catch((err: unknown) => {
      console.warn('PlayPlanner: location withdrawal logging failed:', err);
    });
  }, [persist, userId]);

  // Render-time identity guard. Between an account switch and the effect that
  // reacts to it, `state` still describes the PREVIOUS account — reporting it
  // would show one frame of someone else's decision. Fall back to 'checking',
  // which every consumer already renders as a neutral placeholder.
  const status: LocationConsentStatus = state.userId === userId ? state.status : 'checking';

  return { status, grant, decline, revoke };
}
