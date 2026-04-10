import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// SecureStore adapter — stores the Supabase session token safely on the device
// (much safer than AsyncStorage which is not encrypted)
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
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
