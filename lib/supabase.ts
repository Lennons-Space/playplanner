import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { ExpoSecureStoreAdapter, getAuthStorageKey } from '@/lib/authSession';

// The chunked SecureStore adapter now lives in lib/authSession.ts, alongside
// purgeLocalAuthSession() — the two must use the same storage key, and keeping
// them in one module means a test can exercise the purge without this file
// also constructing a real client from environment variables. Re-exported here
// so existing importers of ExpoSecureStoreAdapter are unaffected.
export { ExpoSecureStoreAdapter } from '@/lib/authSession';

const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing Supabase environment variables. Check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    // Passed EXPLICITLY rather than left to the SDK default. getAuthStorageKey()
    // reproduces that default exactly, so no existing session is invalidated;
    // stating it here guarantees the key the SDK writes and the key
    // purgeLocalAuthSession() deletes can never drift apart.
    storageKey: getAuthStorageKey(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ---- Storage helpers ----

/** Returns the public URL for a file in a Supabase Storage bucket */
export function getStorageUrl(bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/** Upload a local file URI to Supabase Storage */
export async function uploadPhoto(
  bucket: 'venue-photos' | 'review-photos' | 'avatars',
  path: string,
  fileUri: string,
  contentType = 'image/jpeg'
): Promise<string> {
  const response = await fetch(fileUri);
  const blob = await response.blob();
  const { data, error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return getStorageUrl(bucket, data.path);
}
