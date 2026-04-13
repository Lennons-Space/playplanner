/**
 * Location consent logging service.
 *
 * WHY THIS EXISTS:
 * GDPR Article 7 requires you to demonstrate that consent was freely given,
 * specific, informed, and unambiguous. The ICO Children's Code (Standard 10)
 * adds that geolocation must be off by default and consent must be documented.
 * This service writes to `location_consent_log` so we have an audit trail.
 *
 * PRE-AUTH CONSENT:
 * If a user accesses the map before creating an account, their consent cannot
 * immediately be written to the database (no user_id exists). In that case,
 * the consent record is stored locally in SecureStore under PENDING_CONSENT_KEY.
 * Call `migratePendingLocationConsent(userId)` after signup or login to move
 * the pending record into the database, linked to the new account.
 *
 * IMPORTANT: All functions are intentionally non-blocking — a logging failure
 * must never break the user's experience. Monitor errors in production separately.
 */

import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { LOCATION_CONSENT_VERSION } from '@/constants/location';

const PENDING_CONSENT_KEY = 'pending_location_consent';

interface PendingConsent {
  consented_at: string;
  consent_version: string;
}

/**
 * Call this immediately after the user accepts the location consent prompt.
 * If the user is authenticated, writes directly to `location_consent_log`.
 * If not authenticated yet, persists locally for migration on signup/login.
 */
export async function recordLocationConsentGranted(): Promise<void> {
  const consented_at = new Date().toISOString();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // No account yet — store locally and migrate once an account is created.
    try {
      await SecureStore.setItemAsync(
        PENDING_CONSENT_KEY,
        JSON.stringify({ consented_at, consent_version: LOCATION_CONSENT_VERSION }),
      );
    } catch (error) {
      // SecureStore failure is non-fatal. Consent will be prompted again next session.
      console.warn('PlayPlanner: Failed to store pending location consent locally:', error);
    }
    return;
  }

  const { error } = await supabase.from('location_consent_log').insert({
    user_id:         user.id,
    consented_at,
    consent_version: LOCATION_CONSENT_VERSION,
  });
  if (error) console.warn('PlayPlanner: Failed to log location consent to database:', error);
}

/**
 * Call this after a successful signup or login.
 * Reads any locally-stored pre-auth consent record, writes it to the database
 * linked to the authenticated user, then deletes the local copy.
 * Non-blocking — migration failure must never break the auth flow.
 */
export async function migratePendingLocationConsent(userId: string): Promise<void> {
  let pending: PendingConsent | null = null;

  try {
    const raw = await SecureStore.getItemAsync(PENDING_CONSENT_KEY);
    if (raw) pending = JSON.parse(raw) as PendingConsent;
  } catch {
    return;
  }

  if (!pending) return;

  try {
    const { error } = await supabase.from('location_consent_log').insert({
      user_id:         userId,
      consented_at:    pending.consented_at,
      consent_version: pending.consent_version,
    });
    if (error) {
      console.warn('PlayPlanner: Failed to migrate pending location consent:', error);
      // Leave the local copy intact so it is retried on the next login.
      return;
    }
    // Only delete the local copy once the DB write has succeeded.
    await SecureStore.deleteItemAsync(PENDING_CONSENT_KEY);
  } catch {
    // Non-fatal — the pending record remains in SecureStore and will be
    // retried on the next login.
  }
}

/**
 * Call this when the user actively withdraws location consent in app settings.
 * GDPR Art.7(3) — withdrawal must be as easy as giving consent.
 * Marks the most recent active consent record as withdrawn.
 */
export async function recordLocationConsentWithdrawn(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from('location_consent_log')
    .select('id')
    .eq('user_id', user.id)
    .not('consented_at', 'is', null)
    .is('consent_withdrawn_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('location_consent_log')
      .update({ consent_withdrawn_at: new Date().toISOString() })
      .eq('id', existing.id);
  }
}
