/**
 * Location consent logging service.
 *
 * WHY THIS EXISTS:
 * GDPR Article 7 requires you to demonstrate that consent was freely given,
 * specific, informed, and unambiguous. The ICO Children's Code (Standard 10)
 * adds that geolocation must be off by default and consent must be documented.
 * This service writes to `location_consent_log` so we have an audit trail.
 *
 * PRE-AUTH CONSENT — REMOVED (PP-018, 2026-08-25):
 * This service used to stash a pre-auth consent record in SecureStore under
 * PENDING_CONSENT_KEY and then attribute it, via `migratePendingLocationConsent`,
 * to whichever account signed in next. That call ran on EVERY sign-in (see
 * hooks/useAuth.ts), not just the signup it was designed for, so a consent given
 * by one person on a shared device was written into the consent log of a
 * completely different data subject — manufactured consent, and exactly the
 * evidence GDPR Art.7 says must be genuine.
 *
 * A record written while nobody was signed in cannot be attributed to anyone:
 * there is no proof the person who granted it is the person who later signs in.
 * So nothing pre-auth is persisted any more, and any record left behind by an
 * older build is DELETED rather than adopted — see `retirePendingLocationConsent`.
 * A signed-out user's agreement now lasts only for the screen they gave it on
 * (hooks/useLocationConsent.ts), and a signed-in account with no record of its
 * own is simply asked again the next time location is genuinely required.
 *
 * IMPORTANT: All functions are intentionally non-blocking — a logging failure
 * must never break the user's experience. Monitor errors in production separately.
 */

import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { LOCATION_CONSENT_VERSION } from '@/constants/location';
import { writeAuditLog } from '@/services/audit/gdprAuditLog';

/**
 * The pre-PP-018 anonymous consent record. Never written any more; deleted on
 * sight by `retirePendingLocationConsent` so an older build's leftover cannot
 * be attributed to whoever signs in next.
 */
const PENDING_CONSENT_KEY = 'pending_location_consent';

/**
 * Call this immediately after the user accepts the location consent prompt.
 * If the user is authenticated, writes directly to `location_consent_log`.
 *
 * If NOT authenticated, this records nothing (PP-018). There is no data subject
 * to bind the consent to, and a record that cannot be attributed can only ever
 * be served to the wrong person later. The agreement still applies for the
 * screen the guest gave it on — hooks/useLocationConsent.ts holds that in
 * memory — it simply never outlives the session or reaches the audit log.
 */
export async function recordLocationConsentGranted(): Promise<void> {
  const consented_at = new Date().toISOString();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  try {
    const { error } = await supabase.from('location_consent_log').insert({
      user_id:         user.id,
      consented_at,
      consent_version: LOCATION_CONSENT_VERSION,
    });
    if (error) {
      console.warn('PlayPlanner: Failed to log location consent to database:', error);
    } else {
      // GDPR Art.5(2) accountability — write to central audit trail.
      // Non-blocking: failure here must not affect the user's consent flow.
      await writeAuditLog(user.id, 'location_consent_granted', 'location_consent_log');
    }
  } catch (err) {
    console.warn('PlayPlanner: Unexpected error recording location consent:', err);
  }
}

/**
 * Call this after a successful signup or login.
 *
 * REPLACES `migratePendingLocationConsent` (PP-018, 2026-08-25). That function
 * took a `userId` and wrote the anonymous pre-auth consent record into
 * `location_consent_log` under it. Because hooks/useAuth.ts calls this on every
 * SIGNED_IN — not only at signup — one person's consent on a shared device
 * became a permanent, ICO-facing claim that a DIFFERENT person had consented.
 *
 * This deliberately takes no `userId`: there is no account it could honestly be
 * attributed to. It only clears the leftover so it can never leak. The affected
 * account is asked again the next time location is genuinely required, which is
 * the correct outcome — we do not manufacture consent, and we do not infer it
 * from previous location use.
 *
 * Non-blocking — failure must never break the auth flow. A failed delete is
 * harmless: nothing reads this key any more.
 */
export async function retirePendingLocationConsent(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_CONSENT_KEY);
  } catch {
    // Non-fatal. The record is never read, only removed as housekeeping.
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
    try {
      const { error } = await supabase
        .from('location_consent_log')
        .update({ consent_withdrawn_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) {
        console.warn('PlayPlanner: Failed to record location consent withdrawal:', error);
      } else {
        // GDPR Art.7(3) — withdrawal must be logged just as rigorously as grant.
        await writeAuditLog(user.id, 'location_consent_withdrawn', 'location_consent_log', existing.id);
      }
    } catch (err) {
      console.warn('PlayPlanner: Unexpected error recording consent withdrawal:', err);
    }
  }
}

/**
 * Call this when the OS permission dialog is dismissed with "Deny".
 * This is distinct from `recordLocationConsentWithdrawn` (which is an
 * in-app settings action). Recording a denial lets us demonstrate to the
 * ICO that we honoured the refusal and did not re-prompt inappropriately.
 *
 * Non-blocking — failure must never affect the user experience.
 * No coordinates or personal data are ever written.
 */
export async function recordLocationConsentDenied(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // User is not authenticated. No DB write is possible, but the denial
      // is implicit — we simply do not request location. Nothing to record.
      return;
    }

    // Insert a denial row: consented_at is null, consent_withdrawn_at is null.
    // This creates a record showing the user was asked and said no.
    const { error } = await supabase.from('location_consent_log').insert({
      user_id:              user.id,
      consented_at:         null,
      consent_version:      LOCATION_CONSENT_VERSION,
    });
    if (error) {
      console.warn('PlayPlanner: Failed to log location consent denial:', error);
      return;
    }

    await writeAuditLog(user.id, 'location_consent_denied', 'location_consent_log');
  } catch (err) {
    // Completely non-fatal — denial is already honoured by the hook not
    // requesting coordinates. This is just the accountability paper trail.
    console.warn('PlayPlanner: Unexpected error recording location consent denial:', err);
  }
}
