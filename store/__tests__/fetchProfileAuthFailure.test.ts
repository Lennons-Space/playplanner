/**
 * PGRST303 — an authenticated request rejected while the app looks signed in.
 *
 * THE DEVICE REPORT (2026-08-25, during the PP-018 phone test):
 * Home rendered normally, the app appeared signed in, and the console showed
 * exactly one line:
 *
 *     fetchProfile failed: PGRST303
 *
 * WHAT PGRST303 IS (verified against the PostgREST error reference, Group 3 —
 * JWT, not assumed): HTTP **401**, "JWT claims validation or parsing failed".
 * It is distinct from its neighbours, and the distinction is the whole point:
 *   • PGRST300 (500) — the server has no JWT secret configured.
 *   • PGRST301 (401) — the JWT could not be DECODED or is invalid: the code a
 *     malformed, truncated or wrongly-signed token produces.
 *   • PGRST302 (401) — no Bearer auth at all, with the anon role disabled.
 *   • PGRST303 (401) — the token PARSED and its signature was acceptable, but
 *     CLAIMS validation failed.
 *
 * So the token reaching PostgREST was well-formed and correctly signed. That
 * rules out the whole "malformed / truncated / wrong storage key / chunked
 * adapter corruption" family on its own — a corrupted token cannot reach claims
 * validation, it fails at PGRST301.
 *
 * WHY THE APP STILL LOOKED SIGNED IN: `fetchProfile` logs and returns. It does
 * not clear the session, so the store keeps a genuinely-valid session and every
 * screen renders normally; only `profile` stays null. That is also why nothing
 * looked broken.
 *
 * ── WHY THIS FILE DOES NOT ASSERT AN AUTOMATIC SIGN-OUT ────────────────────
 * The tempting "fail closed" fix — sign out whenever PostgREST rejects the
 * JWT — would be actively harmful until the cause is confirmed. PGRST303 covers
 * a family of claim failures, and at least one known member is TRANSIENT and
 * not the client's fault: a token issued moments earlier can be rejected as
 * "issued in the future" when the validator's clock lags. Signing a parent out
 * on such a rejection would eject them mid-session for a server-side hiccup.
 *
 * So this file pins the invariants that must hold RIGHT NOW — no mixed-identity
 * data, no request storm, no tombstone resurrection — and pins the diagnostics
 * that will tell us, on the next device run, WHICH claim failed. The recovery
 * decision is deliberately deferred until that evidence exists.
 */

import { describePostgrestError, inspectJwtClaims } from '@/lib/authDiagnostics';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockRpcSingle = jest.fn();
const mockGetSession = jest.fn();
const mockRpc = jest.fn(() => ({ single: mockRpcSingle }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...(args as [])),
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...(args as [])),
      signOut: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
  },
}));

jest.mock('@/lib/authSession', () => ({
  purgeLocalAuthSession: jest.fn().mockResolvedValue({ clean: true, passes: 1 }),
  resolveAuthStorageKey: jest.fn(() => 'sb-test-auth-token'),
}));

const mockTombstoneIdentity = jest.fn();
jest.mock('@/lib/authTombstone', () => ({
  tombstoneIdentity: (...args: unknown[]) => mockTombstoneIdentity(...(args as [])),
  isAuthTombstoneActive: jest.fn(() => false),
}));

const mockLogRequestFailure = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/authDiagnostics', () => ({
  ...jest.requireActual('@/lib/authDiagnostics'),
  logAuthState: jest.fn().mockResolvedValue(undefined),
  scheduleSignOutVerification: jest.fn(),
  logAuthenticatedRequestFailure: (...args: unknown[]) =>
    mockLogRequestFailure(...(args as [])),
}));

jest.mock('@/store/mapStore', () => ({
  useMapStore: { getState: () => ({ setPendingPostcode: jest.fn() }) },
}));

jest.mock('@/lib/recentlyViewed', () => ({ clearRecentlyViewed: jest.fn() }));

import { useAuthStore } from '@/store/authStore';

/** The shape postgrest-js hands back for a PGRST303. */
const PGRST303 = {
  code: 'PGRST303',
  message: 'JWT claims validation or parsing failed',
  details: null,
  hint: null,
};

const USER_A = { id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa' };
const USER_B = { id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb' };

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ session: null, user: null, profile: null, isLoading: false });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The reproduction: store says authenticated, PostgREST rejects the JWT.
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchProfile — PostgREST rejects the JWT (PGRST303)', () => {
  it('does not populate a profile from a rejected request', async () => {
    useAuthStore.setState({ user: USER_A as never, profile: null });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    await useAuthStore.getState().fetchProfile();

    expect(useAuthStore.getState().profile).toBeNull();
  });

  it('never leaves a PREVIOUS account’s profile in place after a rejection', async () => {
    // The dangerous shape: A's profile is already loaded, the identity moves to
    // B, and B's fetch is rejected. B must not be shown A's profile.
    useAuthStore.setState({ user: USER_A as never, profile: { id: USER_A.id } as never });
    useAuthStore.setState({ user: USER_B as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    await useAuthStore.getState().fetchProfile();

    const profile = useAuthStore.getState().profile;
    // Whatever else is true, the rendered profile must never belong to A while
    // B is the signed-in user.
    expect(profile === null || (profile as { id: string }).id !== USER_A.id).toBe(true);
  });

  it('makes exactly ONE request per call — no retry storm', async () => {
    useAuthStore.setState({ user: USER_A as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    await useAuthStore.getState().fetchProfile();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_my_profile');
  });

  it('does not resurrect or re-tombstone any identity', async () => {
    useAuthStore.setState({ user: USER_A as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    await useAuthStore.getState().fetchProfile();

    // A failed profile read is not a sign-out and must not touch the tombstone.
    expect(mockTombstoneIdentity).not.toHaveBeenCalled();
  });

  it('resolves rather than throwing — a rejected profile read must not crash a screen', async () => {
    useAuthStore.setState({ user: USER_A as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    await expect(useAuthStore.getState().fetchProfile()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The diagnostic gap that made the device report unusable.
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchProfile — reports the FULL safe error, not just the code', () => {
  it('hands the whole PostgREST error and the store identity to the diagnostic', async () => {
    useAuthStore.setState({ user: USER_A as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    await useAuthStore.getState().fetchProfile();

    // This is what was missing on the device: the code alone cannot say which
    // claim failed, nor whether the SDK session still matches the store.
    expect(mockLogRequestFailure).toHaveBeenCalledWith('fetchProfile', PGRST303, USER_A.id);
  });

  it('does not run the diagnostic on a SUCCESSFUL fetch', async () => {
    useAuthStore.setState({ user: USER_A as never });
    mockRpcSingle.mockResolvedValue({ data: { id: USER_A.id }, error: null });

    await useAuthStore.getState().fetchProfile();

    expect(mockLogRequestFailure).not.toHaveBeenCalled();
    expect(useAuthStore.getState().profile).toEqual({ id: USER_A.id });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. describePostgrestError — the safe projection of the error.
// ─────────────────────────────────────────────────────────────────────────────

describe('describePostgrestError', () => {
  it('surfaces code, message, details and hint', () => {
    expect(
      describePostgrestError({
        code: 'PGRST303',
        message: 'JWT claims validation or parsing failed',
        details: 'iat is in the future',
        hint: 'check clock skew',
      }),
    ).toEqual({
      code: 'PGRST303',
      message: 'JWT claims validation or parsing failed',
      details: 'iat is in the future',
      hint: 'check clock skew',
    });
  });

  it('normalises absent/empty fields to null rather than inventing text', () => {
    expect(describePostgrestError({ code: 'PGRST303' })).toEqual({
      code: 'PGRST303',
      message: null,
      details: null,
      hint: null,
    });
  });

  it('never throws on a non-object, so diagnostics cannot break the caller', () => {
    expect(describePostgrestError(null)).toEqual({
      code: null, message: null, details: null, hint: null,
    });
    expect(describePostgrestError('boom')).toEqual({
      code: null, message: null, details: null, hint: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The structural fix: an identity change clears the profile immediately.
// ─────────────────────────────────────────────────────────────────────────────

describe('setSession — a profile never survives an account switch', () => {
  it('drops the previous account’s profile the moment the identity changes', () => {
    useAuthStore.setState({ user: USER_A as never, profile: { id: USER_A.id } as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    // B signs in. Even before any network call resolves, A's profile is gone.
    useAuthStore.getState().setSession({ user: USER_B } as never);

    expect(useAuthStore.getState().profile).toBeNull();
    expect(useAuthStore.getState().user).toEqual(USER_B);
  });

  it('drops the profile on sign-out (session becomes null)', () => {
    useAuthStore.setState({ user: USER_A as never, profile: { id: USER_A.id } as never });

    useAuthStore.getState().setSession(null);

    expect(useAuthStore.getState().profile).toBeNull();
  });

  it('KEEPS the profile when the same account’s session is merely refreshed', () => {
    // A token refresh re-emits the same identity. Clearing here would blank the
    // profile on every refresh and cause a needless refetch flicker.
    useAuthStore.setState({ user: USER_A as never, profile: { id: USER_A.id } as never });
    mockRpcSingle.mockResolvedValue({ data: { id: USER_A.id }, error: null });

    useAuthStore.getState().setSession({ user: USER_A } as never);

    expect(useAuthStore.getState().profile).toEqual({ id: USER_A.id });
  });

  it('the full switch + rejected fetch leaves NO profile at all', async () => {
    useAuthStore.setState({ user: USER_A as never, profile: { id: USER_A.id } as never });
    mockRpcSingle.mockResolvedValue({ data: null, error: PGRST303 });

    useAuthStore.getState().setSession({ user: USER_B } as never);
    await useAuthStore.getState().fetchProfile();

    // The device-observed shape: signed in as B, profile read rejected.
    // B must see no profile rather than A's.
    expect(useAuthStore.getState().profile).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. inspectJwtClaims — the evidence that will name the failing claim.
// ─────────────────────────────────────────────────────────────────────────────

/** Base64url-encode without padding (test fixture only). */
function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < json.length; i++) {
    acc = (acc << 8) | json.charCodeAt(i);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += alphabet[(acc >> bits) & 63];
    }
  }
  if (bits > 0) out += alphabet[(acc << (6 - bits)) & 63];
  return out;
}

/** A structurally-valid JWT. The signature is a placeholder — never verified here. */
function fakeJwt(payload: Record<string, unknown>, alg = 'HS256'): string {
  return `${b64url({ alg, typ: 'JWT' })}.${b64url(payload)}.c2ln`;
}

function sessionWithToken(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token, user: USER_A } },
    error: null,
  });
}

describe('inspectJwtClaims — safe, local claim facts', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);

  it('reports a healthy token without emitting any token material', async () => {
    sessionWithToken(
      fakeJwt({ sub: USER_A.id, role: 'authenticated', iss: 'supabase', aud: 'authenticated',
        iat: nowSec() - 60, exp: nowSec() + 3540 }),
    );

    const facts = await inspectJwtClaims();

    expect(facts).not.toBeNull();
    expect(facts!.isJwt).toBe(true);
    expect(facts!.alg).toBe('HS256');
    expect(facts!.role).toBe('authenticated');
    expect(facts!.claimsPresent).toEqual(
      expect.arrayContaining(['sub', 'role', 'aud', 'iss', 'iat', 'exp']),
    );
    expect(facts!.expired).toBe(false);
    expect(facts!.issuedInFuture).toBe(false);
    // The raw subject must never be exposed — only a fingerprint.
    expect(facts!.subFingerprint).not.toBe(USER_A.id);
    expect(JSON.stringify(facts)).not.toContain(USER_A.id);
  });

  it('detects an EXPIRED token', async () => {
    sessionWithToken(fakeJwt({ sub: USER_A.id, iat: nowSec() - 7200, exp: nowSec() - 3600 }));

    const facts = await inspectJwtClaims();

    expect(facts!.expired).toBe(true);
    expect(facts!.secondsUntilExpiry).toBeLessThan(0);
  });

  it('detects a token issued in the FUTURE — the clock-skew signature of PGRST303', async () => {
    // The failure mode this whole investigation exists to identify: a token
    // whose `iat` is ahead of the validating clock parses and verifies fine,
    // then fails CLAIMS validation — which is PGRST303, not PGRST301.
    sessionWithToken(fakeJwt({ sub: USER_A.id, iat: nowSec() + 120, exp: nowSec() + 3600 }));

    const facts = await inspectJwtClaims();

    expect(facts!.issuedInFuture).toBe(true);
    expect(facts!.secondsSinceIssued).toBeLessThan(0);
    expect(facts!.expired).toBe(false);
  });

  it('reports a NON-JWT access token as such rather than pretending to parse it', async () => {
    sessionWithToken('sb_publishable_not_a_jwt');

    const facts = await inspectJwtClaims();

    expect(facts!.isJwt).toBe(false);
    expect(facts!.alg).toBeNull();
  });

  it('returns null when there is no session at all', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    expect(await inspectJwtClaims()).toBeNull();
  });

  it('never throws on a malformed payload — diagnostics must not break the app', async () => {
    sessionWithToken('aaa.!!!not-base64!!!.bbb');

    await expect(inspectJwtClaims()).resolves.not.toThrow();
  });
});
