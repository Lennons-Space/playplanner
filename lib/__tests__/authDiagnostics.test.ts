/**
 * authDiagnostics.test.ts
 *
 * The __DEV__ auth diagnostics exist because two rounds of unit tests passed
 * while the phone failed. They log auth-session facts on a real device — which
 * makes them a privacy surface in their own right, so what they may and may not
 * emit is pinned down here.
 *
 * The rule from CLAUDE.md is absolute: no secrets, no personal data, and no
 * location data in logs. A user id is a personal identifier, so it is reduced
 * to a short non-reversible fingerprint — enough to answer "is this the same
 * user as a moment ago?", useless as an identifier.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://exampleproj.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

const mockSession = {
  current: null as { user: { id: string } } | null,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      storageKey: 'sb-exampleproj-auth-token',
      getSession: async () => ({ data: { session: mockSession.current }, error: null }),
    },
  },
}));

import { fingerprint, logAuthState, logAuthEvent, assertStorageKeyMatchesClient } from '../authDiagnostics';
import { getAuthStorageKey, ExpoSecureStoreAdapter } from '../authSession';
import { tombstoneIdentity, __resetAuthTombstoneForTests } from '../authTombstone';

const REAL_USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.SUPER-SECRET-ACCESS-TOKEN.signature';

let logged: string[] = [];

beforeEach(() => {
  mockStore.clear();
  mockSession.current = null;
  __resetAuthTombstoneForTests();
  logged = [];
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  __resetAuthTombstoneForTests();
});

describe('fingerprint', () => {
  it('never returns the value it was given', () => {
    expect(fingerprint(REAL_USER_ID)).not.toContain('a1b2c3d4');
    expect(fingerprint(REAL_USER_ID)).not.toBe(REAL_USER_ID);
  });

  it('is stable, short, and comparable for equality', () => {
    const a = fingerprint(REAL_USER_ID);
    expect(a).toHaveLength(6);
    expect(a).toBe(fingerprint(REAL_USER_ID));
    expect(a).not.toBe(fingerprint('b1b2c3d4-0000-4000-8000-000000000002'));
  });

  it('reports absence rather than inventing a value', () => {
    expect(fingerprint(null)).toBe('none');
    expect(fingerprint(undefined)).toBe('none');
    expect(fingerprint('')).toBe('none');
  });
});

describe('logAuthState', () => {
  it('reports presence/absence without emitting any token material', async () => {
    await ExpoSecureStoreAdapter.setItem(
      getAuthStorageKey(),
      JSON.stringify({ access_token: ACCESS_TOKEN, user: { id: REAL_USER_ID } }),
    );
    mockSession.current = { user: { id: REAL_USER_ID } };

    await logAuthState('BEFORE SIGNOUT');

    const line = logged.join('\n');
    expect(line).toContain('storage=present');
    expect(line).toContain('session=present');
    // The privacy assertions — these are the point of the suite.
    expect(line).not.toContain(ACCESS_TOKEN);
    expect(line).not.toContain('SUPER-SECRET');
    expect(line).not.toContain(REAL_USER_ID);
    expect(line).not.toContain('access_token');
  });

  it('reports the terminated state after a purge', async () => {
    mockSession.current = null;

    await logAuthState('AFTER LOCAL PURGE');

    const line = logged.join('\n');
    expect(line).toContain('storage=null');
    expect(line).toContain('session=null');
    expect(line).toContain('user=none');
  });

  it('shows whether the sign-out tombstone is active', async () => {
    await logAuthState('off');
    expect(logged.join('\n')).toContain('tombstone=off');

    logged = [];
    tombstoneIdentity(REAL_USER_ID);
    await logAuthState('on');
    expect(logged.join('\n')).toContain('tombstone=active');
  });
});

describe('logAuthEvent', () => {
  it('records the outcome without the user id', () => {
    logAuthEvent('TOKEN_REFRESHED', { user: { id: REAL_USER_ID } }, 'REJECTED (tombstoned)');

    const line = logged.join('\n');
    expect(line).toContain('TOKEN_REFRESHED');
    expect(line).toContain('REJECTED (tombstoned)');
    expect(line).not.toContain(REAL_USER_ID);
  });
});

describe('assertStorageKeyMatchesClient', () => {
  it('confirms the purge key is the key the live client uses', () => {
    expect(assertStorageKeyMatchesClient()).toBe(true);
  });
});
