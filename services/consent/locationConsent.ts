/**
 * Location consent logging service.
 *
 * WHY THIS EXISTS:
 * GDPR Article 7 requires you to demonstrate that consent was freely given,
 * specific, informed, and unambiguous. The ICO Children's Code (Standard 10)
 * adds that geolocation must be off by default and consent must be documented.
 * This service writes to `location_consent_log` so we have an audit trail.
 *
 * IMPORTANT: These functions are intentionally non-blocking — a logging failure
 * must never break the user's experience. Monitor errors in production separately.
 */

import { supabase } from '@/lib/supabase';
import { LOCATION_CONSENT_VERSION } from '@/constants/location';

/**
 * Call this immediately after the OS grants foreground location permission.
 * Records the timestamp and consent version so we can prove consent was given.
 */
export async function recordLocationConsentGranted(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  // If the user isn't authenticated yet (e.g. permission asked before login),
  // we cannot link consent to an account — skip silently.
  if (!user) return;

  await supabase.from('location_consent_log').insert({
    user_id:          user.id,
    consented_at:     new Date().toISOString(),
    consent_version:  LOCATION_CONSENT_VERSION,
  });
}

/**
 * Call this when the user actively withdraws location consent in app settings.
 * GDPR Art.7(3) — withdrawal must be as easy as giving consent.
 * Marks the most recent active consent record as withdrawn.
 */
export async function recordLocationConsentWithdrawn(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Find the most recent consent record that has not yet been withdrawn.
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
