/**
 * Hooks for venue photo upload, display, and admin moderation.
 *
 * Privacy notes:
 * - EXIF (including GPS coordinates) is stripped by re-encoding through
 *   expo-image-manipulator before any bytes leave the device.
 * - Storage path is {venueId}/{uuid}.jpg — no user ID in the path (GDPR
 *   data minimisation: the storage layer does not need to know who uploaded).
 * - Image URIs and storage paths are never logged.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import type { VenuePhoto, PendingPhotoWithVenue } from '../types';

// ─── useVenuePhotos ────────────────────────────────────────────────────────────

/**
 * Fetches all APPROVED photos for a given venue.
 * We apply an eq filter so the DB only returns approved rows — the RLS policy
 * also enforces this, but a client-side column filter is a fast second defence.
 */
export function useVenuePhotos(venueId: string) {
  return useQuery({
    queryKey: ['venuePhotos', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_photos')
        // storage_path is intentionally excluded — it is an internal storage
        // reference that must never reach the client. Only the public url is needed.
        .select('id, url, caption, sort_order, status, is_cover')
        .eq('venue_id', venueId)
        .eq('status', 'approved')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return (data ?? []) as VenuePhoto[];
    },
    staleTime: 60_000,
    enabled: !!venueId,
  });
}

// ─── useUploadVenuePhoto ───────────────────────────────────────────────────────

interface UploadPhotoInput {
  venueId: string;
  imageUri: string;
  caption?: string;
}

/**
 * Mutation that handles the full photo upload flow:
 * 1. Strip EXIF/GPS by re-encoding as JPEG via expo-image-manipulator.
 * 2. Convert to blob and upload to Supabase Storage.
 * 3. Insert a DB row with status='pending' (awaits moderation before going live).
 * 4. If either step fails, the other is rolled back to avoid orphaned data.
 */
export function useUploadVenuePhoto() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  return useMutation({
    mutationFn: async ({ venueId, imageUri, caption }: UploadPhotoInput) => {
      if (!user) throw new Error('You must be signed in to upload a photo.');

      // Step 1: Re-encode as JPEG — this strips all EXIF data including GPS.
      // Actions array is empty because we only want re-encoding (no resize/crop).
      // Declared outside the try block so the finally clause can safely reference
      // it. Initialised to null so the finally guard (manipResult?.uri) works
      // correctly even if manipulateAsync throws before assigning.
      let manipResult: ImageManipulator.ImageResult | null = null;
      manipResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 0.85 }
      );

      // P5 — Always delete the re-encoded temp file when we're done, success or
      // failure. expo-image-manipulator writes a new file each call; without
      // cleanup they accumulate in the device cache across sessions.
      try {
        // Step 2: Read as a blob. We use fetch() because React Native's FileSystem
        // blob support is limited; fetch() works reliably with local file:// URIs.
        const response = await fetch(manipResult.uri);
        if (!response.ok) throw new Error('Failed to read image data from device.');
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('Image data is empty.');

        // Step 3: Generate a filename. crypto.randomUUID() is available in RN/Hermes.
        // We deliberately exclude the user ID from the path — see module docblock.
        const filename = `${crypto.randomUUID()}.jpg`;
        const storagePath = `${venueId}/${filename}`;

        // Step 4: Upload to Storage.
        const { error: uploadError } = await supabase.storage
          .from('venue-photos')
          .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: false });

        if (uploadError) throw uploadError;

        // Step 5: Get the public URL.
        const { data: urlData } = supabase.storage
          .from('venue-photos')
          .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        // Step 6: Insert the DB row. Status is forced to 'pending' by the RLS
        // insert policy — we also set it here to be explicit and type-safe.
        const { error: insertError } = await supabase
          .from('venue_photos')
          .insert({
            venue_id:    venueId,
            uploaded_by: user.id,
            storage_path: storagePath,
            url:         publicUrl,
            caption:     caption ?? null,
            status:      'pending',
          });

        if (insertError) {
          // Rollback: delete the storage object so we don't leave orphaned files.
          const { error: cleanupError } = await supabase.storage
            .from('venue-photos')
            .remove([storagePath]);
          if (cleanupError) {
            // Log path only — no user data (GDPR). Send to error tracker in production.
            console.error('[useUploadVenuePhoto] Storage cleanup failed:', cleanupError.message);
          }
          throw insertError;
        }
      } finally {
        // Delete the temp re-encoded JPEG regardless of success or failure.
        // Guard on manipResult?.uri in case manipulateAsync itself threw before
        // setting manipResult — without the guard, this line would throw a
        // ReferenceError that masks the original error from manipulateAsync.
        if (manipResult?.uri) {
          await FileSystem.deleteAsync(manipResult.uri, { idempotent: true });
        }
      }
    },
    onSuccess: (_data, variables) => {
      // Invalidate the approved-photos cache for this venue.
      // The newly uploaded photo is pending, so it won't appear yet — but if a
      // subsequent approval happens, the next fetch will pick it up.
      queryClient.invalidateQueries({ queryKey: ['venuePhotos', variables.venueId] });
    },
  });
}

// ─── useModeratePhoto ─────────────────────────────────────────────────────────

interface ModeratePhotoInput {
  photoId: string;
  venueId: string;
  status: 'approved' | 'rejected';
  moderation_notes?: string;
}

/**
 * Admin-only mutation to approve or reject a pending photo.
 * Updates status, records who moderated and when, and optionally stores a note.
 * On success, invalidates all relevant caches so the UI reflects the change.
 */
export function useModeratePhoto() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  return useMutation({
    mutationFn: async ({ photoId, status, moderation_notes }: ModeratePhotoInput) => {
      if (!user) throw new Error('Admin authentication required.');

      const { data, error } = await supabase
        .from('venue_photos')
        .update({
          status,
          moderation_notes: moderation_notes ?? null,
          moderated_by:     user.id,
          moderated_at:     new Date().toISOString(),
        })
        .eq('id', photoId)
        .select('id, storage_path');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Photo no longer exists or could not be updated.');
      }

      // When rejecting, delete the file from storage so it cannot be accessed
      // via its public URL even after the DB row is marked rejected.
      // Best-effort: a cleanup failure must not block the moderation action.
      if (status === 'rejected') {
        const storagePath = (data[0] as { id: string; storage_path: string | null }).storage_path;
        if (storagePath) {
          await supabase.storage
            .from('venue-photos')
            .remove([storagePath])
            .catch(() => {});
        }
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['venuePhotos', variables.venueId] });
      queryClient.invalidateQueries({ queryKey: ['pendingPhotos'] });
      queryClient.invalidateQueries({ queryKey: ['venue', variables.venueId] });
    },
  });
}

// Re-export the joined type so consumers can import from one place.
export type { PendingPhotoWithVenue };
