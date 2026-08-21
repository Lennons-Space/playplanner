/**
 * authTombstone.ts — decides which identity may become the app's current one.
 *
 * NOTE ON THE NAME: this began as a plain sign-out tombstone and is now the
 * full auth identity gate (tombstone + authoritative identity + sign-in
 * intent). The filename is kept because several memory notes and four call
 * sites already reference it; the responsibilities are described here.
 *
 * WHY THIS EXISTS (real-device failure, 2026-08-21, second retest)
 * ---------------------------------------------------------------
 * Purging the persisted session is necessary but NOT sufficient. From the
 * installed @supabase/auth-js@2.103.0:
 *
 *   _callRefreshToken()                                (GoTrueClient.js:3869)
 *     ├─ _refreshAccessToken() retries with exponential backoff for as long as
 *     │  the error is a retryable FETCH error       (:3718-3741)
 *     ├─ await this._saveSession(data.session)   ← UNCONDITIONAL WRITE (:3943)
 *     └─ _notifyAllSubscribers('TOKEN_REFRESHED', data.session)
 *
 * A refresh that STARTED before a sign-out finishes AFTER it, rewrites the
 * terminated session to disk and emits an ordinary TOKEN_REFRESHED.
 * `stopAutoRefresh()` only clears the interval; it cannot cancel a refresh
 * already in flight, and no purge can outrun a write that happens later.
 *
 * WHY THE FIRST DESIGN WAS STILL RACY (2026-08-21, third review)
 * -------------------------------------------------------------
 * The first version cleared the tombstone in login.tsx immediately BEFORE
 * `signInWithPassword()`. Protection was therefore off for the entire network
 * round-trip, so a stale TOKEN_REFRESHED landing mid-login was adopted. And the
 * SDK does not save us:
 *
 *   - GoTrueClient picks its lock as: `settings.lock` if provided, else
 *     `navigatorLock` when `isBrowser() && navigator.locks`, else `lockNoOp`
 *     (:129-143). `isBrowser()` is `typeof window !== 'undefined' && typeof
 *     document !== 'undefined'` (helpers.js:43) — React Native has no
 *     `document`, and no Web Locks API. So the lock is `lockNoOp`, which is
 *     literally `async (name, timeout, fn) => await fn()` (:31-33): NO mutual
 *     exclusion whatsoever.
 *   - `signInWithPassword()` (:790) does not call `_acquireLock` at all. It
 *     goes straight to the network, then `_saveSession()` +
 *     `_notifyAllSubscribers('SIGNED_IN', …)`.
 *
 * So concurrent sign-in and refresh are NOT serialised, and the window is real.
 *
 * THE INVARIANT THIS MODULE ENFORCES
 * ----------------------------------
 * The app's authoritative identity changes only when:
 *   (a) an explicit sign-in EMITS its own SIGNED_IN while that sign-in is in
 *       progress, or
 *   (b) the session ends (identity becomes none).
 *
 * Everything else — in particular a TOKEN_REFRESHED for a signed-out identity,
 * or for any identity other than the current one — is refused. Protection is
 * never lifted in advance of an outcome: `beginExplicitSignIn()` records
 * INTENT, it does not clear the tombstone, and only `completeExplicitSignIn(true)`
 * retires it.
 *
 * All state is in-memory. It does not need to survive a restart: a restart
 * reads the session from storage, and storage was purged at sign-out.
 */

/** The identity that was signed out, or null when no sign-out is in effect. */
let terminatedUserId: string | null = null;

/** The identity the app has actually adopted, or null when signed out. */
let authoritativeUserId: string | null = null;

/** True between beginExplicitSignIn() and completeExplicitSignIn(). */
let explicitSignInPending = false;

/** Minimal shape we need off an auth event's session. */
interface SessionLike {
  user?: { id?: string | null } | null;
}

/**
 * Record that `userId` has been signed out. Call this BEFORE asking the SDK to
 * sign out, so an event that races the sign-out is already covered.
 *
 * A null `userId` arms NOTHING, deliberately. An earlier draft armed the
 * tombstone anyway and treated every subsequent session as a resurrection; the
 * project's existing useAuthListener suite caught that immediately, and it was
 * right to. If we never knew which identity was signed out then there was no
 * session to protect, and blocking all future sign-ins to defend an identity
 * that does not exist trades a real availability failure for no security gain.
 *
 * Where the store has no user but the SDK still holds a session — the exact
 * divergence this whole fix is about — store/authStore.ts re-arms with the id
 * it reads back off that session, so the identity is still covered.
 */
export function tombstoneIdentity(userId: string | null): void {
  authoritativeUserId = null;
  if (!userId) return;
  terminatedUserId = userId;
}

/**
 * Record that the user has STARTED an explicit sign-in.
 *
 * Call immediately before `signInWithPassword()` / `signUp()`. This does NOT
 * lift any protection — that was the bug. It only says "a SIGNED_IN emitted
 * from now until the attempt resolves is attributable to a real login".
 */
export function beginExplicitSignIn(): void {
  explicitSignInPending = true;
}

/**
 * Record the OUTCOME of the explicit sign-in.
 *
 * On success the tombstone is retired: the user proved possession of
 * credentials, so whatever identity was signed out is no longer special.
 * On failure the tombstone REMAINS ARMED — a failed login must not leave the
 * previous identity adoptable, which is exactly scenario (B).
 */
export function completeExplicitSignIn(success: boolean): void {
  explicitSignInPending = false;
  if (success) terminatedUserId = null;
}

/**
 * Record the identity the app has adopted, after an event passes the gate.
 * Pass null when the session ends.
 */
export function noteAdoptedIdentity(userId: string | null): void {
  authoritativeUserId = userId ?? null;
}

/** Whether a sign-out is currently in effect with no successful sign-in since. */
export function isAuthTombstoneActive(): boolean {
  return terminatedUserId !== null;
}

/** The identity the app currently considers authoritative (for diagnostics). */
export function getAuthoritativeUserId(): string | null {
  return authoritativeUserId;
}

/**
 * THE GATE. True when this session must NOT be adopted.
 *
 * Two independent refusals, plus one narrow allowance:
 *
 *  1. TOMBSTONE — the session belongs to an identity that was signed out.
 *     Covers a stale refresh landing after sign-out, during a sign-in attempt
 *     for someone else, and after a FAILED sign-in.
 *
 *  2. IDENTITY CHANGE — the session belongs to someone other than the identity
 *     the app has already adopted. Covers the case the tombstone alone missed:
 *     Account B signs in successfully (retiring A's tombstone) and only THEN
 *     does A's stale refresh land. Without this rule A would silently replace
 *     B, because `_saveSession()` has already overwritten B's session on disk.
 *
 *  3. ALLOWANCE — a SIGNED_IN event while an explicit sign-in is in progress.
 *     That is the one and only way a new authoritative identity is established.
 *     The event name matters: `signInWithPassword()` emits SIGNED_IN (:829),
 *     whereas a stale refresh emits TOKEN_REFRESHED (:3888). A re-login as the
 *     SAME account that was just signed out therefore succeeds, while a stale
 *     refresh for that same account during the same window does not.
 *
 * A fresh app start passes cleanly: nothing is terminated and nothing is
 * authoritative yet, so INITIAL_SESSION is adopted normally.
 */
export function isTombstonedSession(
  session: SessionLike | null | undefined,
  event?: string,
): boolean {
  const incomingId = session?.user?.id;
  if (!incomingId) return false;

  const isExplicitLogin = explicitSignInPending && event === 'SIGNED_IN';
  if (isExplicitLogin) return false;

  if (terminatedUserId !== null && incomingId === terminatedUserId) return true;
  if (authoritativeUserId !== null && incomingId !== authoritativeUserId) return true;

  return false;
}

/** Test-only reset so suites do not leak gate state into one another. */
export function __resetAuthTombstoneForTests(): void {
  terminatedUserId = null;
  authoritativeUserId = null;
  explicitSignInPending = false;
}
