import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// SecureStore adapter with chunking support.
//
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

const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing Supabase environment variables. Check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage: ExpoSecureStoreAdapter,
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
