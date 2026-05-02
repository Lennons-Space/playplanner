/**
 * useProfile hooks — query and mutation helpers for the authenticated user's profile.
 *
 * These wrap Supabase via TanStack React Query so screens get caching,
 * loading states, and automatic invalidation for free.
 *
 * GDPR Art.5(1)(c) — data minimisation:
 *   useUpdateProfile sends ONLY the fields passed to it, never the whole row.
 *   This avoids accidentally overwriting columns we did not intend to touch.
 *
 *   useUploadAvatar stores the file under avatars/{userId}/{timestamp}.jpg.
 *   The timestamp forces a new path on every upload so the old file can be
 *   deleted from storage after the new URL is saved to the profile row.
 *
 * Privacy notes:
 *   usePublicProfile reads from the public_profiles VIEW — never the full profiles
 *   table. The view exposes only: id, username, full_name, avatar_url, bio,
 *   is_business_owner, show_reviews_publicly. Sensitive columns (children_ages,
 *   subscription_tier, marketing_consent, etc.) are intentionally excluded.
 *
 *   useWithdrawLocationConsent calls the audit-logging service so withdrawal is
 *   recorded with a timestamp — GDPR Art.7(3) requires withdrawal to be as easy
 *   as giving consent, and Art.5(2) requires it to be demonstrable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import type { Profile, PublicProfile } from '@/types';
import { recordLocationConsentWithdrawn } from '@/services/consent/locationConsent';

/** The subset of Profile columns that the user is allowed to update themselves. */
export type ProfileUpdate = Partial<Pick<Profile,
  | 'username'
  | 'full_name'
  | 'bio'
  | 'avatar_url'
  | 'children_ages'
  | 'postcode'
  | 'show_in_search'
  | 'show_reviews_publicly'
  | 'marketing_consent'
>>;

/**
 * Mutation hook for updating the current user's profile.
 *
 * Usage:
 *   const { mutateAsync, isPending } = useUpdateProfile();
 *   await mutateAsync({ full_name: 'Jane', bio: 'Hi!' });
 *
 * On success it optimistically updates the Zustand auth store so the
 * header immediately reflects the change without a full refetch.
 */
export function useUpdateProfile() {
  const queryClient  = useQueryClient();
  const userId       = useAuthStore((s) => s.user?.id);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);

  return useMutation({
    mutationFn: async (updates: ProfileUpdate) => {
      if (!userId) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;
    },

    onSuccess: () => {
      // Refresh the profile in Zustand so the tab header is up-to-date immediately.
      fetchProfile();
      // Invalidate any React Query caches that may hold profile data.
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
}

/**
 * Mutation hook for uploading a new avatar photo.
 *
 * Flow:
 *   1. Launches the system image picker (crop to square).
 *   2. Fetches the chosen image as a blob.
 *   3. Uploads to the `avatars` Supabase Storage bucket under
 *      avatars/{userId}/{timestamp}.jpg — the timestamp means each
 *      upload lands at a unique path, preventing CDN caching of stale images.
 *   4. Saves the new public URL to the profile row via useUpdateProfile.
 *   5. Deletes the previous avatar file from storage (data minimisation).
 *
 * Returns:
 *   mutateAsync()           — triggers the full flow, resolves with the new URL.
 *   isPending               — true while the upload / DB write is in progress.
 *
 * Usage:
 *   const { mutateAsync: uploadAvatar, isPending } = useUploadAvatar();
 *   const newUrl = await uploadAvatar(currentAvatarUrl);
 */
export function useUploadAvatar() {
  const userId            = useAuthStore((s) => s.user?.id);
  const { mutateAsync: updateProfile } = useUpdateProfile();

  return useMutation({
    mutationFn: async (currentAvatarUrl: string | null) => {
      if (!userId) throw new Error('Not authenticated');

      // Ask the OS for photo library permission.
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Photo library permission denied. Please enable it in Settings.');
      }

      // Open the picker — square crop enforced so avatars look consistent.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,   // 75% JPEG quality — good balance of size vs fidelity
      });

      if (result.canceled) return null;   // user dismissed — nothing to do

      const pickedUri = result.assets[0].uri;

      // Re-encode as JPEG to strip all EXIF data, including GPS coordinates that
      // phone cameras embed automatically. Without this, the raw picker file would
      // be uploaded with location data readable by anyone who downloads the avatar.
      const manipResult = await ImageManipulator.manipulateAsync(
        pickedUri,
        [],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 0.75 }
      );

      let newUrl: string;
      try {
        const response = await fetch(manipResult.uri);
        const blob     = await response.blob();

        // Unique path prevents serving the old avatar from CDN cache after update.
        const newPath = `${userId}/${Date.now()}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(newPath, blob, { contentType: 'image/jpeg', upsert: false });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(newPath);

        newUrl = urlData.publicUrl;
      } finally {
        // Delete the temp EXIF-stripped file regardless of upload success/failure.
        await FileSystem.deleteAsync(manipResult.uri, { idempotent: true });
      }

      // Persist the new URL to the profile row.
      await updateProfile({ avatar_url: newUrl! });

      // Delete the old avatar file — data minimisation (GDPR Art.5(1)(c)).
      if (currentAvatarUrl) {
        const marker = '/avatars/';
        const markerIdx = currentAvatarUrl.indexOf(marker);
        if (markerIdx !== -1) {
          const oldPath = currentAvatarUrl.slice(markerIdx + marker.length);
          await supabase.storage.from('avatars').remove([oldPath]).catch(() => {});
        }
      }

      return newUrl!;
    },
  });
}

// ---------------------------------------------------------------------------
// usePublicProfile
// Fetches a safe, public-facing profile by user ID.
// Reads from the `public_profiles` VIEW — NEVER the full profiles table.
// The view exposes only the columns other users are permitted to see.
// ---------------------------------------------------------------------------

export function usePublicProfile(userId: string | undefined) {
  return useQuery<PublicProfile | null>({
    queryKey: ['publicProfile', userId],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await supabase
        .from('public_profiles')
        .select('id, username, full_name, avatar_url, bio, is_business_owner, show_reviews_publicly, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        // Log only the error code — never the userId (personally identifiable).
        console.error('usePublicProfile error:', error.code, error.hint);
        throw new Error('Could not load profile.');
      }

      return (data ?? null) as PublicProfile | null;
    },
    // Only fetch when we actually have a userId to look up.
    enabled: !!userId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useUpdateChildrenAges
// Mutation to replace the authenticated user's children_ages column.
// children_ages is stored as text[] (e.g. ['0-1', '2-3']) — data minimisation:
// we only store broad ranges, never exact ages or dates of birth.
// ---------------------------------------------------------------------------

export function useUpdateChildrenAges() {
  const queryClient  = useQueryClient();
  const userId       = useAuthStore((s) => s.user?.id);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);

  return useMutation({
    mutationFn: async (ages: string[]) => {
      if (!userId) throw new Error('Not authenticated');

      // Store null rather than an empty array — data minimisation means we
      // should not persist an empty [] when the user has no children listed.
      const value = ages.length > 0 ? ages : null;

      const { error } = await supabase
        .from('profiles')
        .update({ children_ages: value })
        .eq('id', userId);

      if (error) {
        console.error('useUpdateChildrenAges error:', error.code, error.hint);
        throw new Error('Could not save age ranges. Please try again.');
      }
    },

    onSuccess: () => {
      // Sync the Zustand store so any screen reading from authStore reflects
      // the update immediately without waiting for a navigation event.
      fetchProfile();
      // Invalidate both the bare key (profile screen) and the scoped key
      // (any query keyed by userId). React Query's invalidateQueries with a
      // prefix key will match all queries whose key starts with 'profile'.
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// ---------------------------------------------------------------------------
// useWithdrawLocationConsent
// Calls the audit-logging service to record the consent withdrawal timestamp,
// then invalidates the location-related query cache so any screen showing
// consent status re-renders immediately.
//
// GDPR Art.7(3): withdrawal must be as easy as giving consent.
// This hook is the mechanism — call it directly from a single button press.
// ---------------------------------------------------------------------------

export function useWithdrawLocationConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // recordLocationConsentWithdrawn writes the withdrawal timestamp to the
      // location_consent_log table. If no active consent record is found it
      // exits silently — that is the correct behaviour (idempotent withdrawal).
      await recordLocationConsentWithdrawn();
    },

    onSuccess: () => {
      // Invalidate the profile query so any screen showing consent status
      // (e.g. the privacy settings screen) re-renders immediately.
      // Also invalidate locationConsent cache for hooks that track it separately.
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['locationConsent'] });
    },
  });
}
