/**
 * authSession.ts — the local persistence layer for the Supabase auth session.
 *
 * WHY THIS FILE EXISTS (split out of lib/supabase.ts on 2026-08-21)
 * ----------------------------------------------------------------
 * Real-device retest, 2026-08-21: after tapping "Sign out", an approved review
 * fetched while Account A was signed in was STILL rendered on the venue-detail
 * screen. Identity-scoped query keys (hooks/useAuthIdentity.ts) did not prevent
 * it, because the identity had never actually changed — the sign-out had not
 * ended the session at all.
 *
 * The mechanism is in the installed auth-js (2.103.0), GoTrueClient._signOut():
 *
 *     const { error } = await this.admin.signOut(accessToken, scope);
 *     if (error) {
 *       // ignore 404s / 401s / 403s
 *       if (!((isAuthApiError(error) && (404 | 401 | 403)) || isAuthSessionMissingError(error))) {
 *         return this._returnResult({ error });   // <-- RETURNS HERE
 *       }
 *     }
 *     if (scope !== 'others') {
 *       await this._removeSession();              // <-- NEVER REACHED
 *     }
 *
 * So when the server-side revoke fails for ANY reason other than 401/403/404 —
 * a plain network failure on mobile is the common one — signOut() resolves with
 * an error and the local session SURVIVES on disk. No 'SIGNED_OUT' event is
 * emitted either, because that is fired by _removeSession().
 *
 * The app then showed a signed-out UI over a live session, and the SDK's own
 * auto-refresh ticker could re-adopt that session and push Account A back into
 * the store — at which point every identity-scoped query legitimately fetched
 * Account A's rows again.
 *
 * THE REMEDY THIS FILE PROVIDES
 * -----------------------------
 * `purgeLocalAuthSession()` removes the persisted session directly, through the
 * same storage adapter the SDK writes it with. That is sufficient to fully
 * de-authenticate the client without an app restart, because:
 *   - GoTrueClient.__loadSession() re-reads the session from storage on EVERY
 *     _useSession() call (it does not serve a long-lived in-memory copy), and
 *   - SupabaseClient._getAccessToken() calls auth.getSession() for EVERY
 *     PostgREST/Storage request, falling back to the anon key when there is no
 *     session.
 * Both were verified against the installed packages, not assumed.
 *
 * It lives in its own module (rather than in lib/supabase.ts) so that tests can
 * exercise the real purge against a mocked `expo-secure-store` without the
 * module also constructing a real Supabase client from environment variables.
 */
import * as SecureStore from 'expo-secure-store';

// Android's SecureStore has a hard 2048-byte limit per entry. Supabase session
// tokens exceed this. This adapter splits large values into 1800-byte chunks,
// stores each chunk separately, and reassembles them on read.
// (1800 bytes leaves headroom for base64 encoding overhead.)
const CHUNK_SIZE = 1800;

export const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    // Check if a chunked value was stored for this key
    const chunkCountStr = await SecureStore.getItemAsync(`${key}.chunks`);
    if (chunkCountStr) {
      const chunkCount = parseInt(chunkCountStr, 10);
      const chunks: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunk = await SecureStore.getItemAsync(`${key}.${i}`);
        if (chunk == null) return null; // Incomplete — treat as missing
        chunks.push(chunk);
      }
      return chunks.join('');
    }
    // Fall back to a plain (non-chunked) entry
    return SecureStore.getItemAsync(key);
  },

  setItem: async (key: string, value: string): Promise<void> => {
    if (value.length <= CHUNK_SIZE) {
      // Small enough to store directly — clean up any old chunks first
      await SecureStore.deleteItemAsync(`${key}.chunks`);
      await SecureStore.setItemAsync(key, value);
      return;
    }
    // Split into chunks and store each one
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, chunks[i]);
    }
    await SecureStore.setItemAsync(`${key}.chunks`, String(chunks.length));
    // Remove any plain (non-chunked) entry that may have existed before
    await SecureStore.deleteItemAsync(key);
  },

  removeItem: async (key: string): Promise<void> => {
    const chunkCountStr = await SecureStore.getItemAsync(`${key}.chunks`);
    if (chunkCountStr) {
      const chunkCount = parseInt(chunkCountStr, 10);
      for (let i = 0; i < chunkCount; i++) {
        await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
      await SecureStore.deleteItemAsync(`${key}.chunks`);
    }
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * The storage key the Supabase client persists its session under.
 *
 * This reproduces supabase-js's own default EXACTLY:
 *   `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
 * and lib/supabase.ts passes the result back into createClient() as an explicit
 * `storageKey`, so the value the SDK writes and the value we purge can never
 * drift apart. Because it equals the default, existing sessions on already
 * installed devices keep working — nobody is signed out by this change.
 */
export function getAuthStorageKey(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) {
    // Deliberately THROWS rather than returning a fallback.
    //
    // A previous version returned 'sb-auth-token' when the variable was
    // missing. That is the worst possible behaviour for a function whose
    // result decides which key gets deleted: a purge against the wrong key
    // succeeds, reports success, and removes nothing. The project's own test
    // suite caught exactly that divergence once the value was compared against
    // the live client. Failing loudly is the only safe direction here.
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is required to resolve the auth storage key.');
  }
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

/**
 * The storage key the LIVE client is actually using.
 *
 * GoTrueClient assigns `this.storageKey = settings.storageKey`, so reading it
 * back off the constructed client is ground truth rather than a re-derivation.
 * `purgeLocalAuthSession()` takes this in preference to `getAuthStorageKey()`
 * so the key that is deleted cannot drift from the key that was written — the
 * two are the same object's property, not two independent computations.
 *
 * Falls back to the derivation only if the property is absent (a future SDK
 * could rename it), which is why the derivation must still be correct.
 */
export function resolveAuthStorageKey(client?: unknown): string {
  // `unknown` rather than a structural type: SupabaseClient's `auth` is a
  // SupabaseAuthClient whose storageKey is not part of its public type, so a
  // structural parameter would reject the real client at the call site. The
  // read below is fully guarded, so nothing is assumed about the shape.
  const live = (client as { auth?: { storageKey?: unknown } } | undefined)?.auth?.storageKey;
  if (typeof live === 'string' && live.length > 0) return live;
  return getAuthStorageKey();
}

/**
 * The suffixes appended to the storage key by the SDK, mirroring EXACTLY the
 * key set GoTrueClient._removeSession() deletes in the installed version:
 *
 *     await removeItemAsync(this.storage, this.storageKey);
 *     await removeItemAsync(this.storage, this.storageKey + '-code-verifier');
 *     await removeItemAsync(this.storage, this.storageKey + '-user');
 *
 * Every one of them goes through THIS adapter, so each is removed through
 * `ExpoSecureStoreAdapter.removeItem` too — which is what expands a logical key
 * into its `<key>.chunks` manifest and `<key>.<n>` chunk entries. There is no
 * second deletion scheme anywhere: the adapter that wrote the bytes is the
 * adapter that deletes them.
 */
const AUTH_KEY_SUFFIXES = ['', '-code-verifier', '-user'] as const;

/** Result of a purge attempt. `clean` is VERIFIED by reading storage back. */
export interface PurgeResult {
  /** True only if a read-back through the adapter returned null afterwards. */
  clean: boolean;
  /** How many passes were needed (2 means the first pass left something). */
  passes: number;
}

/**
 * Removes the locally persisted Supabase session, unconditionally, without any
 * network call, and VERIFIES the result by reading it back.
 *
 * Safe to call repeatedly — it is also the remedy applied when a late refresh
 * writes a terminated session back to disk (see lib/authTombstone.ts).
 *
 * Verification matters because the failure this exists for is precisely "we
 * believed the session was gone and it was not". A caller that trusts a
 * resolved promise learns nothing; `clean` is derived from an actual read.
 */
export async function purgeLocalAuthSession(storageKey?: string): Promise<PurgeResult> {
  // Callers in the app pass the LIVE client's own storageKey (see
  // resolveAuthStorageKey) so the key deleted is provably the key written.
  const key = storageKey ?? getAuthStorageKey();

  const removeAll = async () => {
    for (const suffix of AUTH_KEY_SUFFIXES) {
      await ExpoSecureStoreAdapter.removeItem(`${key}${suffix}`);
    }
  };

  await removeAll();
  if ((await ExpoSecureStoreAdapter.getItem(key)) === null) {
    return { clean: true, passes: 1 };
  }

  // Something re-wrote the session between our delete and our read — the exact
  // race an in-flight token refresh produces. Try once more, then report
  // honestly rather than claiming success.
  await removeAll();
  const clean = (await ExpoSecureStoreAdapter.getItem(key)) === null;
  return { clean, passes: 2 };
}

/**
 * Safe, non-secret facts about what is currently persisted, for __DEV__
 * diagnostics. Deliberately returns NO token material and no session contents —
 * only presence and shape.
 */
export async function inspectLocalAuthStorage(storageKey?: string): Promise<{
  present: boolean;
  chunks: number;
  codeVerifierPresent: boolean;
}> {
  const key = storageKey ?? getAuthStorageKey();
  try {
    const chunkCountStr = await SecureStore.getItemAsync(`${key}.chunks`);
    const chunks = chunkCountStr ? parseInt(chunkCountStr, 10) : 0;
    const value = await ExpoSecureStoreAdapter.getItem(key);
    const codeVerifier = await SecureStore.getItemAsync(`${key}-code-verifier`);
    return {
      present: value !== null,
      chunks: Number.isFinite(chunks) ? chunks : 0,
      codeVerifierPresent: codeVerifier !== null,
    };
  } catch {
    return { present: false, chunks: 0, codeVerifierPresent: false };
  }
}
