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

// ─────────────────────────────────────────────────────────────────────────────
// PGRST303 investigation (2026-08-25) — safe JWT + PostgREST error reporting.
//
// A real device reported `fetchProfile failed: PGRST303` while the app looked
// signed in and Home rendered normally. PGRST303 is HTTP 401 — "JWT claims
// validation or parsing failed" (PostgREST docs, Group 3). It is NOT an RLS
// error, and it is NOT PGRST301 ("provided JWT couldn't be decoded or it is
// invalid"), which is the code a malformed or badly-signed token produces.
//
// store/authStore.ts's fetchProfile logged ONLY `error.code`, which is exactly
// why the device could not tell us WHICH claim failed. Everything below exists
// so the next device run produces evidence instead of a bare code.
//
// SAFETY: no token material is ever emitted. The payload is decoded LOCALLY and
// only non-secret facts are reported — algorithm name, which claims are
// present, timestamps, and derived booleans. `sub` is fingerprinted, never
// printed. Nothing is sent anywhere.
// ─────────────────────────────────────────────────────────────────────────────

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Decode a base64url segment without `atob`/`Buffer`.
 *
 * Hermes has not always exposed `atob`, and a diagnostic that throws on the one
 * device we are trying to debug is worse than useless. Deliberately
 * self-contained. Returns null on anything malformed rather than throwing.
 */
function decodeBase64Url(segment: string): string | null {
  try {
    let bits = 0;
    let acc = 0;
    let out = '';
    for (const ch of segment) {
      if (ch === '=') continue;
      const idx = B64URL_ALPHABET.indexOf(ch);
      if (idx === -1) return null; // not base64url
      acc = (acc << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((acc >> bits) & 0xff);
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Safe, non-secret facts about the access token currently in the session. */
export interface JwtClaimFacts {
  /** False when the token is not three dot-separated segments. */
  isJwt: boolean;
  /** JWT header `alg`, e.g. 'HS256' / 'ES256'. Not a secret. */
  alg: string | null;
  /** Which standard claims are PRESENT. Values are never reported. */
  claimsPresent: string[];
  /** Fingerprint of `sub` — comparable, not an identifier. */
  subFingerprint: string;
  /** `role` claim — a PostgREST role name (e.g. 'authenticated'), not secret. */
  role: string | null;
  iat: number | null;
  exp: number | null;
  /** Seconds until expiry by the DEVICE clock. Negative means already expired. */
  secondsUntilExpiry: number | null;
  /**
   * Seconds since issue by the DEVICE clock. A NEGATIVE value means the token
   * claims to have been issued in the future relative to this device — the
   * signature of the clock-skew family of PGRST303 failures.
   */
  secondsSinceIssued: number | null;
  expired: boolean | null;
  /** True when `iat` is in the future by the device clock. */
  issuedInFuture: boolean | null;
}

/**
 * Decode the current access token's claims locally and return only safe facts.
 * Never throws; never emits token material. Returns null if there is no session.
 */
export async function inspectJwtClaims(): Promise<JwtClaimFacts | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) {
      // Not a JWT at all — e.g. a non-JWT publishable/secret API key. That is
      // itself a meaningful finding for a PGRST303, so report it as a fact
      // rather than returning null and losing the distinction.
      return {
        isJwt: false,
        alg: null,
        claimsPresent: [],
        subFingerprint: 'none',
        role: null,
        iat: null,
        exp: null,
        secondsUntilExpiry: null,
        secondsSinceIssued: null,
        expired: null,
        issuedInFuture: null,
      };
    }

    const headerJson = decodeBase64Url(parts[0]);
    const payloadJson = decodeBase64Url(parts[1]);
    const header = headerJson ? JSON.parse(headerJson) : {};
    const payload = payloadJson ? JSON.parse(payloadJson) : {};

    const nowSec = Math.floor(Date.now() / 1000);
    const iat = typeof payload.iat === 'number' ? payload.iat : null;
    const exp = typeof payload.exp === 'number' ? payload.exp : null;

    return {
      isJwt: true,
      alg: typeof header.alg === 'string' ? header.alg : null,
      // Names only — never the values.
      claimsPresent: ['sub', 'role', 'aud', 'iss', 'iat', 'exp', 'session_id', 'aal'].filter(
        (c) => payload[c] !== undefined,
      ),
      subFingerprint: fingerprint(typeof payload.sub === 'string' ? payload.sub : null),
      // A PostgREST role name is configuration, not personal data.
      role: typeof payload.role === 'string' ? payload.role : null,
      iat,
      exp,
      secondsUntilExpiry: exp === null ? null : exp - nowSec,
      secondsSinceIssued: iat === null ? null : nowSec - iat,
      expired: exp === null ? null : exp - nowSec <= 0,
      issuedInFuture: iat === null ? null : nowSec - iat < 0,
    };
  } catch {
    return null;
  }
}

/** The safe subset of a PostgrestError. Server-generated, no token material. */
export interface SafePostgrestError {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
}

/** Narrow an unknown thrown/returned value to the safe PostgREST error fields. */
export function describePostgrestError(error: unknown): SafePostgrestError {
  const e = (error ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    code: str(e.code),
    message: str(e.message),
    details: str(e.details),
    hint: str(e.hint),
  };
}

/**
 * The full safe picture for a failed authenticated request: what PostgREST
 * said, what the token claims look like, and whether the SDK session and the
 * app store agree on who is signed in.
 *
 * This is precisely the diagnostic that was missing when the device reported
 * `fetchProfile failed: PGRST303`. __DEV__ only; never throws; never emits
 * token material.
 */
export async function logAuthenticatedRequestFailure(
  label: string,
  error: unknown,
  storeUserId: string | null | undefined,
): Promise<void> {
  if (!__DEV__) return;
  try {
    const pg = describePostgrestError(error);
    const { data } = await supabase.auth.getSession();
    const sessionUserId = data?.session?.user?.id ?? null;
    const claims = await inspectJwtClaims();

    console.warn(
      `[auth] ${label} FAILED` +
        ` code=${pg.code ?? 'none'}` +
        ` message=${JSON.stringify(pg.message)}` +
        ` details=${JSON.stringify(pg.details)}` +
        ` hint=${JSON.stringify(pg.hint)}`,
    );
    console.warn(
      `[auth] ${label} identity |` +
        ` session=${data?.session ? 'present' : 'null'}` +
        ` sessionUser=${fingerprint(sessionUserId)}` +
        ` storeUser=${fingerprint(storeUserId ?? null)}` +
        ` match=${sessionUserId && storeUserId ? String(sessionUserId === storeUserId) : 'n/a'}` +
        ` tombstone=${isAuthTombstoneActive() ? 'active' : 'off'}`,
    );
    if (claims) {
      console.warn(
        `[auth] ${label} token |` +
          ` isJwt=${claims.isJwt}` +
          ` alg=${claims.alg ?? 'none'}` +
          ` role=${claims.role ?? 'none'}` +
          ` claims=[${claims.claimsPresent.join(',')}]` +
          ` sub=${claims.subFingerprint}` +
          ` expired=${claims.expired}` +
          ` secsUntilExpiry=${claims.secondsUntilExpiry}` +
          ` secsSinceIssued=${claims.secondsSinceIssued}` +
          ` issuedInFuture=${claims.issuedInFuture}`,
      );
      if (claims.issuedInFuture) {
        console.warn(
          `[auth] ${label} — the token's 'iat' is in the FUTURE by this device's` +
            ` clock. A PGRST303 on a freshly-issued token is consistent with` +
            ` clock skew between the device, the auth server and PostgREST.`,
        );
      }
    } else {
      console.warn(`[auth] ${label} token | no session/access token to inspect`);
    }
  } catch {
    // Diagnostics must never affect behaviour.
  }
}
