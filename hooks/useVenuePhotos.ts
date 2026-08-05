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
import { decode as decodeBase64 } from 'base64-arraybuffer';
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

/**
 * Generates a filename-safe unique id for a newly uploaded photo.
 *
 * crypto.randomUUID() is expected to be available on the Hermes engine this
 * app ships with, but a repo-wide search found this is the ONLY client-side
 * call site of it in the whole app — there is no other evidence it actually
 * works on-device, and no crypto polyfill (e.g. react-native-get-random-values)
 * is installed as a safety net. If it were ever unavailable, every upload
 * would throw synchronously before any network activity, surfacing as the
 * same generic "Upload failed" error with nothing to distinguish it. This is
 * only used as a storage object-name suffix — not a security boundary or an
 * identifier anyone can enumerate against — so a Math.random()-based
 * fallback is an appropriate, low-risk mitigation rather than a security
 * regression.
 */
function generatePhotoFilename(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${crypto.randomUUID()}.jpg`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.jpg`;
}

// ─── Dev-only diagnostic logging ──────────────────────────────────────────
//
// __DEV__-gated only — no-op and no behaviour change in release builds.
// Marks the boundaries of this multi-stage upload (image conversion ->
// Storage upload -> DB insert -> orphan cleanup) so a future on-device
// failure can be localised from the Metro log without guesswork. Tag:
// "PHOTO_STAGE" — grep the Metro log for it.
//
// Logged fields are deliberately narrow:
//   - booleans/lengths for anything that touches a path, URL, or byte buffer
//   - full Supabase error.code/message/details/hint ARE logged on failure,
//     but only inside this __DEV__-gated diagnostic path — the existing
//     user-facing console.error calls elsewhere in this file are unchanged
//     and still log only safe minimal fields.
//   - venue IDs are logged directly (public, non-personal venue identifiers)
//   - user IDs are NEVER logged directly — only booleans (present? matches
//     the authenticated user?)
// Never logged, anywhere in this block: access/refresh tokens, Authorization
// headers, signed/public URLs, image URIs, storage paths, or raw image bytes.

function logPhotoStage(stage: string, fields?: Record<string, unknown>): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console -- deliberate dev-only diagnostic log
  console.log('PHOTO_STAGE', stage, fields ?? {});
}

/**
 * Best-effort, dev-only check of whether the CURRENT live auth state (read
 * fresh from the Zustand store, not the value this mutation closed over)
 * still has a user, and whether it matches the user this mutation started
 * with. Directly tests the "stale auth closure" hypothesis — if this ever
 * logs `false` at a failure boundary, the session changed under us between
 * mutation start and that boundary. Errors are swallowed (never thrown) so
 * this can never alter the real upload flow.
 */
function devLiveAuthMatches(capturedUserId: string): boolean {
  try {
    return useAuthStore.getState().user?.id === capturedUserId;
  } catch {
    return false;
  }
}

/**
 * Best-effort, dev-only check of whether a Supabase session is present at
 * the moment of the Storage upload call. Wrapped in try/catch so a failure
 * here can never alter the real upload flow's success/failure/timing.
 */
async function devHasActiveSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

/** Safe error-field extraction shared by every `_failed` PHOTO_STAGE log. */
function devSafeErrorFields(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as {
    code?: unknown; message?: unknown; details?: unknown; hint?: unknown;
    status?: unknown; statusCode?: unknown; name?: unknown;
  };
  return {
    code:    e.code ?? null,
    message: e.message ?? null,
    details: e.details ?? null,
    hint:    e.hint ?? null,
    status:  e.status ?? e.statusCode ?? null,
    name:    e.name ?? null,
  };
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
 * 2. Read the file as base64 and convert to an ArrayBuffer, then upload to
 *    Supabase Storage (NOT a Blob — see the inline comment at Step 2 for why).
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
      logPhotoStage('conversion_started');
      let manipResult: ImageManipulator.ImageResult | null = null;
      manipResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 0.85 }
      );
      logPhotoStage('conversion_succeeded', { hasUri: !!manipResult?.uri });

      // P5 — Always delete the re-encoded temp file when we're done, success or
      // failure. expo-image-manipulator writes a new file each call; without
      // cleanup they accumulate in the device cache across sessions.
      try {
        // Step 2: Read the re-encoded file and convert it to an ArrayBuffer.
        //
        // We deliberately do NOT use fetch(uri).blob() here, even though it
        // looks like the "normal" web pattern. @supabase/storage-js's own
        // upload() documents this explicitly (see StorageFileApi.ts): "For
        // React Native, using either Blob, File or FormData does not work as
        // intended. Upload file using ArrayBuffer from base64 file data
        // instead." React Native's Blob/fetch layer does not reliably carry
        // binary data through the multipart body storage-js builds once it
        // detects a Blob — this can silently produce a truncated/empty
        // object upload while the client only sees a generic failure with no
        // useful diagnostic (this is believed to be the root cause of the
        // "Upload failed" reports). ArrayBuffer is the vendor-documented,
        // verified-working path on RN, and expo-file-system (already a
        // dependency) already gives us base64 for free.
        let base64: string;
        try {
          base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {
          // Never log manipResult.uri — it is a local file path (module
          // docblock: image URIs are never logged).
          console.error('useUploadVenuePhoto: failed to read manipulated image file');
          throw new Error('Could not read the photo from your device. Please try again.');
        }
        if (!base64) throw new Error('Image data is empty.');

        const arrayBuffer = decodeBase64(base64);
        if (arrayBuffer.byteLength === 0) throw new Error('Image data is empty.');

        // Step 3: Generate a filename (falls back off crypto.randomUUID if it's
        // ever unavailable — see generatePhotoFilename doc comment above).
        // We deliberately exclude the user ID from the path — see module docblock.
        const filename = generatePhotoFilename();
        const storagePath = `${venueId}/${filename}`;

        // Step 4: Upload to Storage.
        if (__DEV__) {
          logPhotoStage('storage_upload_started', {
            bodyByteLength:   arrayBuffer.byteLength,
            hasActiveSession: await devHasActiveSession(),
          });
        }
        const { error: uploadError } = await supabase.storage
          .from('venue-photos')
          .upload(storagePath, arrayBuffer, { contentType: 'image/jpeg', upsert: false });

        if (uploadError) {
          // Diagnostic logging moved to the __DEV__-gated PHOTO_STAGE path
          // below (Reliability Repair Sprint instrumentation), which already
          // captures name/status (via devSafeErrorFields) plus more — the
          // plain console.error that used to sit here triggered React
          // Native's on-device LogBox even though it only ever logged safe,
          // minimal fields. No raw Storage error detail is shown to the user
          // either way — see the generic message thrown just below.
          if (__DEV__) {
            logPhotoStage('storage_upload_failed', {
              ...devSafeErrorFields(uploadError),
              venueId,
              hasUserId:             !!user.id,
              userIdMatchesLiveAuth: devLiveAuthMatches(user.id),
            });
          }
          throw new Error('Could not upload photo. Please try again.');
        }
        logPhotoStage('storage_upload_succeeded');

        // Step 5: Get the public URL.
        const { data: urlData } = supabase.storage
          .from('venue-photos')
          .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        // Step 6: Insert the DB row. Status is forced to 'pending' by the RLS
        // insert policy — we also set it here to be explicit and type-safe.
        if (__DEV__) {
          logPhotoStage('database_insert_started', {
            urlLength:         publicUrl?.length ?? 0,
            storagePathLength: storagePath?.length ?? 0,
          });
        }
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
          if (__DEV__) {
            logPhotoStage('database_insert_failed', {
              ...devSafeErrorFields(insertError),
              venueId,
              hasUserId:             !!user.id,
              userIdMatchesLiveAuth: devLiveAuthMatches(user.id),
            });
          }
          // Rollback: delete the storage object so we don't leave orphaned files.
          logPhotoStage('orphan_cleanup_started');
          const { error: cleanupError } = await supabase.storage
            .from('venue-photos')
            .remove([storagePath]);
          if (cleanupError) {
            // Safe diagnostic only — never cleanupError.message (may embed
            // the storage path). GDPR: no user data in logs.
            console.error('useUploadVenuePhoto storage cleanup error:', cleanupError.name, cleanupError.status);
            if (__DEV__) {
              logPhotoStage('orphan_cleanup_failed', {
                ...devSafeErrorFields(cleanupError),
                venueId,
              });
            }
          } else {
            logPhotoStage('orphan_cleanup_succeeded');
          }
          // Diagnostic logging moved to the __DEV__-gated PHOTO_STAGE path
          // above (database_insert_failed) — see the storage_upload_failed
          // comment above for why the plain console.error was removed.
          throw new Error('Could not save photo. Please try again.');
        }
        logPhotoStage('database_insert_succeeded');
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
      // Invalidate the approved-photos cache for this venue (useVenuePhotos).
      // The newly uploaded photo is pending, so it won't appear yet — but if a
      // subsequent approval happens, the next fetch will pick it up.
      queryClient.invalidateQueries({ queryKey: ['venuePhotos', variables.venueId] });
      // Also invalidate ['venue', venueId] — this is the query the venue detail
      // screen (app/venue/[id].tsx) actually reads photos from (useVenue's own
      // venue_photos join; see the comment there: "useVenue already fetches and
      // filters approved photos in its join — no second query needed"). Without
      // this, a photo approved via useModeratePhoto (which correctly invalidates
      // both keys) would still show up, but this hook alone invalidating only
      // the unused 'venuePhotos' key would be a silent no-op on the page users
      // actually look at. Matches the invalidation pattern already used by
      // useReviews.ts, useFacilities.ts and useVenueClaims.ts for this table.
      queryClient.invalidateQueries({ queryKey: ['venue', variables.venueId] });
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
