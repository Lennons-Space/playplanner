/**
 * PP-018 — account-scoped location consent (tri-state + guest ruling).
 *
 * DEFECT THIS FILE REPRODUCES:
 * App-level location consent was persisted under ONE device-global SecureStore
 * key (`location_consent_granted`) holding a bare sentinel value (`'1'`). A bare
 * sentinel carries no evidence of WHO granted it, and the key carries no
 * identity either — so any account signed in on that device read the flag as
 * its own. Account A's consent silently became Account B's consent.
 *
 * This is the same class of defect as PP-017 (the GDPR export cooldown): state
 * that a user is shown, or that is acted upon, must positively identify the
 * account it belongs to. See app/profile/data-download.tsx for the precedent
 * this fix mirrors.
 *
 * WHY IT MATTERS: GDPR Art.7 requires consent to be attributable to a specific
 * data subject, and the ICO Children's Code (Standard 10) requires geolocation
 * to be off by default. Inheriting another account's consent breaks both —
 * PlayPlanner would use precise location for someone who never agreed to it.
 *
 * PRODUCT RULINGS UNDER TEST (2026-08-25):
 *  • TRI-STATE. unknown / granted / declined, all per account. A decline is
 *    PERSISTED, so an account that said no stays declined across sessions
 *    instead of being re-prompted every launch (ICO Standard 7 — nagging for a
 *    decision already made is a dark pattern). Only 'undecided' prompts.
 *  • GUEST. Signed out, precise location is not offered at all: status is
 *    'unavailable', nothing is prompted, nothing is persisted, and no audit
 *    evidence is created that a later account could inherit.
 *  • LEGACY. The pre-existing device-global value is UNATTRIBUTABLE, whether it
 *    reads as granted or as denied. It is never assigned to any account; it is
 *    deleted on sight. We do not manufacture consent, and we do not infer it
 *    from prior location use.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import {
  LEGACY_GLOBAL_LOCATION_CONSENT_KEY,
  locationConsentKey,
  buildLocationConsentRecord,
} from '@/lib/locationConsentStorage';

// ─── Module mocks ────────────────────────────────────────────────────────────

// An in-memory SecureStore so a decision written by one render is visible to
// the next. A jest.fn() returning a fixed value cannot express "A wrote, then B
// read", which is the entire subject of this file.
const store = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// The consent hook writes GDPR audit rows. That path is Supabase-backed and has
// its own suite (services/consent/__tests__/locationConsent.test.ts); here it
// must never block or influence the persisted decision.
const mockRecordGranted = jest.fn().mockResolvedValue(undefined);
const mockRecordDenied = jest.fn().mockResolvedValue(undefined);
const mockRecordWithdrawn = jest.fn().mockResolvedValue(undefined);
jest.mock('@/services/consent/locationConsent', () => ({
  recordLocationConsentGranted: (...args: unknown[]) => mockRecordGranted(...args),
  recordLocationConsentDenied: (...args: unknown[]) => mockRecordDenied(...args),
  recordLocationConsentWithdrawn: (...args: unknown[]) => mockRecordWithdrawn(...args),
}));

// Identity is INJECTED (lib/locationConsentIdentity.tsx), so a test switches
// accounts simply by changing what the provider would supply — exactly the
// transition an account switch produces at runtime.
let mockCurrentUserId: string | null = null;
jest.mock('@/lib/locationConsentIdentity', () => ({
  useLocationConsentIdentity: () => mockCurrentUserId,
}));

const SS = SecureStore as jest.Mocked<typeof SecureStore>;

const USER_A = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  mockCurrentUserId = null;

  SS.getItemAsync.mockImplementation(async (key: string) => store.get(key) ?? null);
  SS.setItemAsync.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  SS.deleteItemAsync.mockImplementation(async (key: string) => {
    store.delete(key);
  });
});

/** Render the consent hook as `userId`, settled past its initial 'checking'. */
async function renderAs(userId: string | null) {
  mockCurrentUserId = userId;
  const view = renderHook(() => useLocationConsent());
  await waitFor(() => expect(view.result.current.status).not.toBe('checking'));
  return view;
}

/** Render as `userId`, make a decision, unmount. Models one whole session. */
async function sessionAs(userId: string, decision: 'grant' | 'decline') {
  const view = await renderAs(userId);
  await act(async () => {
    await (decision === 'grant' ? view.result.current.grant() : view.result.current.decline());
  });
  const status = view.result.current.status;
  view.unmount();
  return status;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Account B must not inherit Account A's decision.
// ─────────────────────────────────────────────────────────────────────────────

describe('PP-018 — consent does not cross account boundaries', () => {
  it('A grants consent; B signs in and is UNDECIDED, not granted', async () => {
    expect(await sessionAs(USER_A, 'grant')).toBe('granted');

    // Account switch: same device, same SecureStore, different identity.
    const b = await renderAs(USER_B);
    expect(b.result.current.status).toBe('undecided');
  });

  it('A grants, B declines, and neither decision alters the other', async () => {
    expect(await sessionAs(USER_A, 'grant')).toBe('granted');
    expect(await sessionAs(USER_B, 'decline')).toBe('declined');

    const a = await renderAs(USER_A);
    expect(a.result.current.status).toBe('granted');
    a.unmount();

    const b = await renderAs(USER_B);
    expect(b.result.current.status).toBe('declined');
  });

  it('A revoking does not alter B', async () => {
    await sessionAs(USER_A, 'grant');
    await sessionAs(USER_B, 'grant');

    // A withdraws from settings.
    const a = await renderAs(USER_A);
    await act(async () => {
      await a.result.current.revoke();
    });
    expect(a.result.current.status).toBe('declined');
    a.unmount();

    // B is untouched.
    const b = await renderAs(USER_B);
    expect(b.result.current.status).toBe('granted');
  });

  it('A = granted, B = declined survives repeated A → B → A → B switching', async () => {
    await sessionAs(USER_A, 'grant');
    await sessionAs(USER_B, 'decline');

    for (let i = 0; i < 4; i++) {
      const a = await renderAs(USER_A);
      expect(a.result.current.status).toBe('granted');
      a.unmount();

      const b = await renderAs(USER_B);
      expect(b.result.current.status).toBe('declined');
      b.unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Decline is persisted per account (tri-state ruling).
// ─────────────────────────────────────────────────────────────────────────────

describe('PP-018 — a decline is remembered for the account that made it', () => {
  it('B declines, signs out and returns — still DECLINED, and is not re-prompted', async () => {
    expect(await sessionAs(USER_B, 'decline')).toBe('declined');

    // Sign out, then back in as the same account.
    const signedOut = await renderAs(null);
    expect(signedOut.result.current.status).toBe('unavailable');
    signedOut.unmount();

    const b = await renderAs(USER_B);
    // 'undecided' would mean the prompt reappears — the nagging this ruling bans.
    expect(b.result.current.status).toBe('declined');
  });

  it('a declined account can change its mind later (the settings path back)', async () => {
    await sessionAs(USER_B, 'decline');

    const b = await renderAs(USER_B);
    expect(b.result.current.status).toBe('declined');
    await act(async () => {
      await b.result.current.grant();
    });
    expect(b.result.current.status).toBe('granted');
    b.unmount();

    // And it survives the next session.
    const again = await renderAs(USER_B);
    expect(again.result.current.status).toBe('granted');
  });

  it('a granted account can withdraw, and the withdrawal persists', async () => {
    await sessionAs(USER_A, 'grant');

    const a = await renderAs(USER_A);
    await act(async () => {
      await a.result.current.revoke();
    });
    a.unmount();

    const again = await renderAs(USER_A);
    expect(again.result.current.status).toBe('declined');
  });

  it('records the correct GDPR audit event for each transition', async () => {
    const a = await renderAs(USER_A);
    await act(async () => {
      await a.result.current.grant();
    });
    expect(mockRecordGranted).toHaveBeenCalled();

    await act(async () => {
      await a.result.current.revoke();
    });
    expect(mockRecordWithdrawn).toHaveBeenCalled();
    a.unmount();

    const b = await renderAs(USER_B);
    await act(async () => {
      await b.result.current.decline();
    });
    // A first refusal is a denial, not a withdrawal — they are distinct events.
    expect(mockRecordDenied).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Identity-safe async reads.
// ─────────────────────────────────────────────────────────────────────────────

describe('PP-018 — stale async reads cannot cross identities', () => {
  it('a slow read issued for A cannot mark B as granted after a switch', async () => {
    await sessionAs(USER_A, 'grant');

    // Make A's read resolve LATE — after the identity has already moved to B.
    // Without a generation/identity guard the late resolution writes 'granted'
    // into the hook that is now rendering for B.
    let releaseSlowRead: (v: string | null) => void = () => {};
    const slow = new Promise<string | null>((resolve) => {
      releaseSlowRead = resolve;
    });

    let firstCall = true;
    SS.getItemAsync.mockImplementation((key: string) => {
      if (firstCall) {
        firstCall = false;
        return slow;
      }
      return Promise.resolve(store.get(key) ?? null);
    });

    mockCurrentUserId = USER_B;
    const b = renderHook(() => useLocationConsent());

    await act(async () => {
      releaseSlowRead(buildLocationConsentRecord(USER_A, 'v1.0', 'granted'));
      await Promise.resolve();
    });

    await waitFor(() => expect(b.result.current.status).not.toBe('checking'));
    expect(b.result.current.status).toBe('undecided');
  });

  it('never reports a status derived from another account, even for one render', async () => {
    await sessionAs(USER_A, 'grant');

    mockCurrentUserId = USER_B;
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const c = useLocationConsent();
      seen.push(c.status);
      return c;
    });
    await waitFor(() => expect(result.current.status).not.toBe('checking'));

    // Every observed status must be 'checking' or 'undecided'. A single
    // 'granted' frame means B rendered on A's decision.
    expect(seen).not.toContain('granted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The legacy device-global value is unattributable.
// ─────────────────────────────────────────────────────────────────────────────

describe('PP-018 — legacy device-global consent is retired, never attributed', () => {
  it('a legacy global "granted" value is NOT treated as the current account’s consent', async () => {
    store.set(LEGACY_GLOBAL_LOCATION_CONSENT_KEY, '1');

    const a = await renderAs(USER_A);
    expect(a.result.current.status).toBe('undecided');
  });

  it('a legacy global "denied"/unrecognised value is NOT treated as a decline either', async () => {
    store.set(LEGACY_GLOBAL_LOCATION_CONSENT_KEY, '0');

    const a = await renderAs(USER_A);
    // Must be 'undecided' — inheriting a denial is as wrong as inheriting a
    // grant, and would suppress a prompt this account never answered.
    expect(a.result.current.status).toBe('undecided');
  });

  it('a legacy global value is deleted on sight so it cannot leak to a later account', async () => {
    store.set(LEGACY_GLOBAL_LOCATION_CONSENT_KEY, '1');

    const a = await renderAs(USER_A);
    await waitFor(() =>
      expect(SS.deleteItemAsync).toHaveBeenCalledWith(LEGACY_GLOBAL_LOCATION_CONSENT_KEY),
    );
    expect(store.has(LEGACY_GLOBAL_LOCATION_CONSENT_KEY)).toBe(false);
    a.unmount();

    const b = await renderAs(USER_B);
    expect(b.result.current.status).toBe('undecided');
  });

  it('a record naming a DIFFERENT account is discarded, not honoured', async () => {
    // Simulate a value landing under B's key that names A — the account-
    // confusion failure mode PP-016/PP-017 actually produced on a device.
    store.set(locationConsentKey(USER_B), buildLocationConsentRecord(USER_A, 'v1.0', 'granted'));

    const b = await renderAs(USER_B);
    expect(b.result.current.status).toBe('undecided');
  });

  it('a malformed record is discarded rather than honoured', async () => {
    store.set(locationConsentKey(USER_A), 'not-json-at-all');

    const a = await renderAs(USER_A);
    expect(a.result.current.status).toBe('undecided');
  });

  it('a record with no valid decision is discarded (fails closed)', async () => {
    store.set(
      locationConsentKey(USER_A),
      JSON.stringify({ userId: USER_A, decision: 'maybe', decidedAt: 'x', consentVersion: 'v1.0' }),
    );

    const a = await renderAs(USER_A);
    expect(a.result.current.status).toBe('undecided');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Signed-out (guest) behaviour — precise location is not offered at all.
// ─────────────────────────────────────────────────────────────────────────────

describe('PP-018 — guests are never offered precise-location consent', () => {
  it('a signed-out user is UNAVAILABLE, not undecided (so nothing prompts)', async () => {
    const guest = await renderAs(null);
    // 'undecided' is the state that makes screens render the consent prompt.
    // A guest must never reach it.
    expect(guest.result.current.status).toBe('unavailable');
  });

  it('a guest grant() is inert — no state change, nothing written, nothing audited', async () => {
    const guest = await renderAs(null);
    await act(async () => {
      await guest.result.current.grant();
    });

    expect(guest.result.current.status).toBe('unavailable');
    expect(SS.setItemAsync).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    // No audit evidence may be created for someone with no identity.
    expect(mockRecordGranted).not.toHaveBeenCalled();
  });

  it('a guest decline() is equally inert', async () => {
    const guest = await renderAs(null);
    await act(async () => {
      await guest.result.current.decline();
    });

    expect(guest.result.current.status).toBe('unavailable');
    expect(SS.setItemAsync).not.toHaveBeenCalled();
    expect(mockRecordDenied).not.toHaveBeenCalled();
  });

  it('signing in after guest activity does NOT inherit anything', async () => {
    const guest = await renderAs(null);
    await act(async () => {
      await guest.result.current.grant();
    });
    guest.unmount();

    const a = await renderAs(USER_A);
    expect(a.result.current.status).toBe('undecided');
  });

  it('signing out returns to unavailable and does not leak the account’s decision', async () => {
    await sessionAs(USER_A, 'grant');

    const guest = await renderAs(null);
    expect(guest.result.current.status).toBe('unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Consent still works normally for the account that made the decision.
// ─────────────────────────────────────────────────────────────────────────────

describe('PP-018 — consent still functions normally for its owner', () => {
  it('a grant persists across remounts for the SAME account', async () => {
    await sessionAs(USER_A, 'grant');

    const second = await renderAs(USER_A);
    expect(second.result.current.status).toBe('granted');
  });

  it('the persisted record names its owner and its decision', async () => {
    await sessionAs(USER_A, 'grant');

    const raw = store.get(locationConsentKey(USER_A));
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.userId).toBe(USER_A);
    expect(parsed.decision).toBe('granted');
    // Never the old device-global pair.
    expect(store.has(LEGACY_GLOBAL_LOCATION_CONSENT_KEY)).toBe(false);
  });

  it('a SecureStore read failure fails safe to undecided, never to granted', async () => {
    SS.getItemAsync.mockRejectedValue(new Error('keychain unavailable'));
    const a = await renderAs(USER_A);
    expect(a.result.current.status).toBe('undecided');
  });

  it('a SecureStore WRITE failure still applies the decision for this session', async () => {
    const a = await renderAs(USER_A);
    SS.setItemAsync.mockRejectedValue(new Error('device locked'));

    await act(async () => {
      await a.result.current.grant();
    });

    // The user's action is honoured now; losing it means being asked again
    // next launch, never being wrongly granted.
    expect(a.result.current.status).toBe('granted');
  });
});
