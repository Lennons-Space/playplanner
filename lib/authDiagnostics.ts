/**
 * authDiagnostics.ts — __DEV__-only visibility into auth session termination.
 *
 * WHY: the unit tests passed while the phone failed, twice. These logs make the
 * device tell us the same facts the tests assert, so a retest produces evidence
 * instead of an impression.
 *
 * WHAT IS LOGGED — safe facts only:
 *   - the auth event name
 *   - whether local auth storage exists, and how many chunks it occupies
 *   - whether the adapter's getItem(storageKey) returns null
 *   - whether getSession() returns null
 *   - a short NON-REVERSIBLE fingerprint of the user id, so "same user as
 *     before" is visible without printing an identifier
 *   - whether the sign-out tombstone is active
 *
 * NEVER logged: access tokens, refresh tokens, passwords, session JSON, emails,
 * raw user ids, or anything else that could identify a person. The fingerprint
 * is a 32-bit non-cryptographic hash rendered as 6 hex characters — enough to
 * compare two ids for equality within one debugging session, useless as an
 * identifier outside it.
 */
import { supabase } from '@/lib/supabase';
import { getAuthStorageKey, inspectLocalAuthStorage, resolveAuthStorageKey } from '@/lib/authSession';
import { isAuthTombstoneActive } from '@/lib/authTombstone';

/**
 * Short, non-reversible fingerprint of an id (FNV-1a, 32-bit).
 * Equality-comparable within a session; not an identifier.
 */
export function fingerprint(value: string | null | undefined): string {
  if (!value) return 'none';
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Log one line describing the CURRENT auth state. No-op outside __DEV__.
 *
 * `label` marks the point in the flow, e.g. 'BEFORE SIGNOUT',
 * 'AFTER LOCAL PURGE', 'T+30s', or an auth event name.
 */
export async function logAuthState(label: string): Promise<void> {
  if (!__DEV__) return;
  try {
    const storage = await inspectLocalAuthStorage(resolveAuthStorageKey(supabase));
    const { data } = await supabase.auth.getSession();
    const userFp = fingerprint(data?.session?.user?.id ?? null);

    console.log(
      `[auth] ${label} | storage=${storage.present ? 'present' : 'null'}` +
        ` chunks=${storage.chunks}` +
        ` verifier=${storage.codeVerifierPresent ? 'present' : 'null'}` +
        ` session=${data?.session ? 'present' : 'null'}` +
        ` user=${userFp}` +
        ` tombstone=${isAuthTombstoneActive() ? 'active' : 'off'}`,
    );
  } catch {
    // Diagnostics must never affect behaviour.
  }
}

/**
 * Log an auth event as it arrives, including whether it was rejected.
 * No-op outside __DEV__.
 */
export function logAuthEvent(
  event: string,
  session: { user?: { id?: string | null } | null } | null | undefined,
  outcome: 'accepted' | 'REJECTED (tombstoned)',
): void {
  if (!__DEV__) return;
  console.log(
    `[auth] event=${event} user=${fingerprint(session?.user?.id ?? null)} -> ${outcome}`,
  );
}

/**
 * Prove — at runtime, on the real device — that the key we purge is the key the
 * LIVE client persists under, rather than inferring it from the derivation.
 * GoTrueClient assigns `this.storageKey = settings.storageKey`, so reading it
 * back off the constructed client is a direct comparison, not a restatement.
 *
 * Logs a loud warning on mismatch. __DEV__ only; never throws.
 */
export function assertStorageKeyMatchesClient(): boolean {
  const derived = getAuthStorageKey();
  const live = (supabase.auth as unknown as { storageKey?: string }).storageKey;
  const matches = live === derived;
  if (__DEV__ && !matches) {
    console.warn(
      `[auth] STORAGE KEY MISMATCH — purge would miss the live session.` +
        ` derived=${fingerprint(derived)} live=${fingerprint(live ?? null)}`,
    );
  }
  return matches;
}

/**
 * After a sign-out, re-check the invariant once the refresh-retry window has
 * elapsed. AUTO_REFRESH_TICK_DURATION_MS bounds how long auth-js will keep
 * retrying a token refresh, so a check comfortably past it catches exactly the
 * resurrection this session's fix targets. __DEV__ only.
 */
export function scheduleSignOutVerification(): void {
  if (!__DEV__) return;
  setTimeout(() => { void logAuthState('T+35s AFTER SIGN-OUT'); }, 35_000);
  setTimeout(() => { void logAuthState('T+60s AFTER SIGN-OUT'); }, 60_000);
}
