/**
 * authSessionTermination.test.ts
 *
 * Storage-layer proof for the 2026-08-21 sign-out failures, using the REAL
 * chunked SecureStore adapter that lib/supabase.ts hands to createClient() —
 * not a simplified stand-in. The only thing mocked is `expo-secure-store`
 * itself, i.e. the native boundary, backed by an in-memory map so the test can
 * enumerate every key/value the adapter actually writes.
 *
 * What this pins down:
 *   - a realistic Supabase session is large enough to be CHUNKED, so the
 *     adapter writes a manifest key and numbered chunk keys, not one entry;
 *   - purgeLocalAuthSession() removes EVERY artefact of those writes, leaving
 *     no key that begins with the storage key behind;
 *   - the adapter can no longer reconstruct the session afterwards;
 *   - the key that is purged is the key the adapter stored under.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://exampleproj.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

// ---------------------------------------------------------------------------
// The native boundary, backed by a real map. Nothing above it is stubbed.
// ---------------------------------------------------------------------------
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

import {
  ExpoSecureStoreAdapter,
  getAuthStorageKey,
  purgeLocalAuthSession,
  inspectLocalAuthStorage,
  resolveAuthStorageKey,
} from '../authSession';

// ---------------------------------------------------------------------------
// A realistic serialized Supabase session.
//
// Real access/refresh tokens are long; a genuine session comfortably exceeds
// the adapter's 1800-byte chunk threshold, which is the whole reason the
// chunking exists. The fixture is built to match that, so the test exercises
// the chunked path rather than the small-value shortcut.
// ---------------------------------------------------------------------------
function realisticSessionJson(userId = 'a1b2c3d4-0000-4000-8000-000000000001') {
  // Sized like a real Supabase JWT pair: the access token alone runs to about
  // a kilobyte once custom claims are present, and the session carries two.
  const jwtish = (seed: string) =>
    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${seed.repeat(400)}.${seed.repeat(20)}`;
  return JSON.stringify({
    access_token: jwtish('Ab0'),
    refresh_token: jwtish('Zy9'),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'tester@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Test Parent' },
      created_at: '2026-01-01T00:00:00Z',
    },
  });
}

/** Every key currently in storage that belongs to the auth storage key. */
function authArtefacts(): string[] {
  const key = getAuthStorageKey();
  return [...mockStore.keys()].filter((k) => k === key || k.startsWith(`${key}.`) || k.startsWith(`${key}-`)).sort();
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  // Re-establish the default native behaviour. jest.clearAllMocks() clears
  // recorded CALLS but not implementations, so a test that overrides
  // deleteItemAsync would otherwise leak its behaviour into later tests —
  // which is exactly the kind of silent cross-test contamination that lets a
  // storage bug hide.
  const secureStore = jest.requireMock('expo-secure-store') as {
    getItemAsync: jest.Mock;
    setItemAsync: jest.Mock;
    deleteItemAsync: jest.Mock;
  };
  secureStore.getItemAsync.mockImplementation(async (key: string) => mockStore.get(key) ?? null);
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    mockStore.set(key, value);
  });
  secureStore.deleteItemAsync.mockImplementation(async (key: string) => {
    mockStore.delete(key);
  });
});

// ===========================================================================
describe('the real chunked SecureStore adapter', () => {
  it('CONTROL: a realistic session is large enough to be chunked', async () => {
    const json = realisticSessionJson();
    expect(json.length).toBeGreaterThan(1800);

    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), json);

    const key = getAuthStorageKey();
    // The payload is NOT under the base key — it is spread across numbered
    // chunk keys with a separate manifest. A purge that only deleted the base
    // key would leave all of the actual bytes on the device.
    expect(mockStore.get(key)).toBeUndefined();
    expect(mockStore.get(`${key}.chunks`)).toBeDefined();
    expect(mockStore.get(`${key}.0`)).toBeDefined();
    expect(Number(mockStore.get(`${key}.chunks`))).toBeGreaterThan(1);
  });

  it('restores the session byte-for-byte through getItem()', async () => {
    const json = realisticSessionJson();
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), json);

    expect(await ExpoSecureStoreAdapter.getItem(getAuthStorageKey())).toBe(json);
  });

  it('purgeLocalAuthSession removes EVERY artefact the adapter wrote', async () => {
    const key = getAuthStorageKey();
    await ExpoSecureStoreAdapter.setItem(key, realisticSessionJson());
    // The SDK also writes these two alongside the session (mirroring
    // GoTrueClient._removeSession()); include them so the purge is tested
    // against the full key set, not just the session.
    await ExpoSecureStoreAdapter.setItem(`${key}-code-verifier`, 'pkce-verifier-value');
    await ExpoSecureStoreAdapter.setItem(`${key}-user`, JSON.stringify({ user: { id: 'x' } }));

    expect(authArtefacts().length).toBeGreaterThan(2);

    const result = await purgeLocalAuthSession();

    expect(result.clean).toBe(true);
    // The strict assertion: NOTHING beginning with the storage key survives.
    expect(authArtefacts()).toEqual([]);
    expect(await ExpoSecureStoreAdapter.getItem(key)).toBeNull();
  });

  it('leaves an unrelated key untouched', async () => {
    mockStore.set('playplanner.unrelated', 'keep-me');
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), realisticSessionJson());

    await purgeLocalAuthSession();

    expect(mockStore.get('playplanner.unrelated')).toBe('keep-me');
  });

  it('the session cannot be reconstructed after a purge', async () => {
    const key = getAuthStorageKey();
    await ExpoSecureStoreAdapter.setItem(key, realisticSessionJson());
    await purgeLocalAuthSession();

    expect(await ExpoSecureStoreAdapter.getItem(key)).toBeNull();
    const state = await inspectLocalAuthStorage();
    expect(state.present).toBe(false);
    expect(state.chunks).toBe(0);
    expect(state.codeVerifierPresent).toBe(false);
  });

  it('purging twice is safe and still reports clean', async () => {
    await ExpoSecureStoreAdapter.setItem(getAuthStorageKey(), realisticSessionJson());

    expect((await purgeLocalAuthSession()).clean).toBe(true);
    expect((await purgeLocalAuthSession()).clean).toBe(true);
  });

  it('reports NOT clean when something rewrites the session mid-purge', async () => {
    const key = getAuthStorageKey();
    const json = realisticSessionJson();
    await ExpoSecureStoreAdapter.setItem(key, json);

    // Simulate auth-js's _saveSession() landing between our delete and our
    // read-back — the exact race an in-flight token refresh produces. It wins
    // every pass, so the purge must REPORT the failure rather than claim
    // success. (In the app the tombstone is what stops the session being
    // adopted; this asserts the purge never lies about the outcome.)
    const secureStore = jest.requireMock('expo-secure-store') as {
      deleteItemAsync: jest.Mock;
    };
    secureStore.deleteItemAsync.mockImplementation(async (k: string) => {
      mockStore.delete(k);
      if (k === key) {
        // The refresh completes and writes the session straight back, on every
        // pass — the pathological case where the purge can never win the race.
        mockStore.set(key, json);
      }
    });

    const result = await purgeLocalAuthSession();
    expect(result.clean).toBe(false);
    expect(result.passes).toBe(2);
  });

  it('a shrinking session cannot leave a readable stale payload behind', async () => {
    const key = getAuthStorageKey();
    // A large (chunked) session, then a small one — the adapter must not leave
    // the old manifest in place, or getItem() would reassemble stale chunks.
    await ExpoSecureStoreAdapter.setItem(key, realisticSessionJson());
    await ExpoSecureStoreAdapter.setItem(key, 'small-value');

    expect(await ExpoSecureStoreAdapter.getItem(key)).toBe('small-value');

    await purgeLocalAuthSession();
    expect(await ExpoSecureStoreAdapter.getItem(key)).toBeNull();
  });
});

// ===========================================================================
// The key itself.
//
// getAuthStorageKey() previously returned a FALLBACK ('sb-auth-token') when
// EXPO_PUBLIC_SUPABASE_URL was absent. For a function whose result decides
// which key is deleted that is the worst possible behaviour: the purge would
// succeed, report success, and remove nothing. It now throws instead — this
// suite pins that down so the fallback cannot come back.
// ===========================================================================
describe('getAuthStorageKey', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  });

  it('derives supabase-js’s own default key format', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
    // Matches `sb-${new URL(url).hostname.split('.')[0]}-auth-token`, the
    // literal expression in supabase-js's SupabaseClient constructor.
    expect(getAuthStorageKey()).toBe('sb-abcdefghijkl-auth-token');
  });

  it('THROWS rather than returning a wrong key when the URL is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(() => getAuthStorageKey()).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });
});

describe('resolveAuthStorageKey', () => {
  it('prefers the LIVE client’s storageKey over re-deriving it', () => {
    expect(resolveAuthStorageKey({ auth: { storageKey: 'sb-live-auth-token' } })).toBe(
      'sb-live-auth-token',
    );
  });

  it('falls back to the derivation when the client does not expose one', () => {
    expect(resolveAuthStorageKey({ auth: {} })).toBe(getAuthStorageKey());
    expect(resolveAuthStorageKey(undefined)).toBe(getAuthStorageKey());
  });
});
