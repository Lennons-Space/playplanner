/**
 * Tests for hooks/useVenuePhotos.ts
 *
 * Three hooks are covered:
 *
 *   useVenuePhotos       — fetches only approved photos for a venue.
 *   useUploadVenuePhoto  — strips EXIF, uploads to Storage, inserts a DB row
 *                          with status='pending', and rolls back Storage on
 *                          DB failure.
 *   useModeratePhoto     — admin action to approve/reject a pending photo.
 *
 * Privacy contract being tested:
 *   - The storage path must be {venueId}/{uuid}.jpg — no user ID in the path.
 *   - Image URIs and user IDs must never appear in console output.
 *   - Status is always 'pending' on insert; the DB/RLS enforces this too, but
 *     the client must also send the correct value.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { supabase }               from '@/lib/supabase';
import * as ImageManipulator      from 'expo-image-manipulator';
import * as FileSystem            from 'expo-file-system/legacy';
import { useAuthStore }           from '@/store/authStore';
import {
  useVenuePhotos,
  useUploadVenuePhoto,
  useModeratePhoto,
} from '../useVenuePhotos';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// All mocks must be declared before any import that touches the real modules.

jest.mock('@/lib/supabase', () => {
  // We need fine-grained control over every method in the chain, so we build
  // stable mock functions and attach them to the supabase object for easy
  // retrieval in tests.
  const _mockUpload      = jest.fn();
  const _mockGetPublicUrl = jest.fn();
  const _mockRemove      = jest.fn();
  const _mockInsert      = jest.fn();
  const _mockUpdate      = jest.fn();
  const _mockEq          = jest.fn().mockReturnThis();
  const _mockSelect      = jest.fn().mockReturnThis();
  const _mockOrder       = jest.fn().mockReturnThis();

  const storageBucket = {
    upload:       _mockUpload,
    getPublicUrl: _mockGetPublicUrl,
    remove:       _mockRemove,
  };

  const supabaseObj = {
    from: jest.fn(() => ({
      select:  _mockSelect,
      insert:  _mockInsert,
      update:  _mockUpdate,
      eq:      _mockEq,
      order:   _mockOrder,
    })),
    storage: {
      from: jest.fn(() => storageBucket),
    },
    // Expose inner mocks for direct access in tests.
    _mockUpload,
    _mockGetPublicUrl,
    _mockRemove,
    _mockInsert,
    _mockUpdate,
    _mockEq,
    _mockSelect,
    _mockOrder,
    _storageBucket: storageBucket,
  };

  return { supabase: supabaseObj };
});

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

// expo-file-system — readAsStringAsync reads the manipulated file as base64
// (the RN-safe alternative to fetch().blob() — see useVenuePhotos.ts Step 2);
// deleteAsync is called in the finally block to clean up the temp file.
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  deleteAsync:        jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
}));

// authStore is mocked so we can control whether a user is signed in.
jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ─── Type helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = supabase as any;

const mockManipulate      = ImageManipulator.manipulateAsync as jest.Mock;
const mockReadAsString    = FileSystem.readAsStringAsync as jest.Mock;
const mockUseAuthStore    = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

// Convenience getters so tests can override individual operations without
// rebuilding the entire mock chain.
const mockOrder       = () => _s._mockOrder       as jest.Mock;
const mockInsert      = () => _s._mockInsert      as jest.Mock;
const mockUpdate      = () => _s._mockUpdate      as jest.Mock;
const mockUpload      = () => _s._mockUpload      as jest.Mock;
const mockGetPublicUrl = () => _s._mockGetPublicUrl as jest.Mock;
const mockRemove      = () => _s._mockRemove      as jest.Mock;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_USER = {
  id: 'user-abc',
  email: 'test@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2024-01-01T00:00:00Z',
};

const VENUE_ID  = 'venue-123';
const PHOTO_ID  = 'photo-456';
const IMAGE_URI = 'file:///tmp/photo.jpg';
const MANIP_URI = 'file:///tmp/photo_stripped.jpg';

const FAKE_PHOTO = {
  id:           PHOTO_ID,
  url:          'https://cdn.example.com/venue-123/abc.jpg',
  storage_path: `${VENUE_ID}/abc.jpg`,
  caption:      null,
  sort_order:   0,
  status:       'approved',
  is_cover:     false,
};

// ─── QueryClient wrapper ──────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries:   { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  // Attach client to wrapper so tests can call invalidateQueries etc.
  (Wrapper as any).__queryClient = client;
  return { Wrapper, client };
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Default: a signed-in user.
  mockUseAuthStore.mockReturnValue(FAKE_USER as any);

  // Default manipulate: return a stripped URI.
  mockManipulate.mockResolvedValue({ uri: MANIP_URI });

  // Default file read: base64 for the ASCII string "data" (non-empty, decodes
  // to a 4-byte ArrayBuffer). This replaces the old fetch().blob() mock — see
  // useVenuePhotos.ts Step 2 for why Blob is not used on React Native.
  mockReadAsString.mockResolvedValue('ZGF0YQ==');

  // Default crypto.randomUUID.
  global.crypto = { randomUUID: jest.fn().mockReturnValue('generated-uuid') } as any;

  // Default Storage mocks.
  mockUpload().mockResolvedValue({ error: null });
  mockGetPublicUrl().mockReturnValue({
    data: { publicUrl: 'https://cdn.example.com/venue-123/generated-uuid.jpg' },
  });
  mockRemove().mockResolvedValue({ error: null });

  // Default DB mocks — order() terminates select chain.
  mockOrder().mockResolvedValue({ data: [], error: null });
  mockInsert().mockResolvedValue({ data: null, error: null });
  mockUpdate().mockReturnThis(); // update returns chainable, then eq().
  _s._mockEq.mockReturnThis();
});

// ══════════════════════════════════════════════════════════════════════════════
// useVenuePhotos
// ══════════════════════════════════════════════════════════════════════════════

describe('useVenuePhotos', () => {
  // If the 'approved' status filter is missing, moderated-out photos would
  // appear publicly — a privacy failure for content the admin has rejected.
  it('filters by status=approved when fetching', async () => {
    mockOrder().mockResolvedValue({ data: [FAKE_PHOTO], error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVenuePhotos(VENUE_ID), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // eq must have been called with both venue_id and status filters.
    expect(_s._mockEq).toHaveBeenCalledWith('venue_id', VENUE_ID);
    expect(_s._mockEq).toHaveBeenCalledWith('status', 'approved');
  });

  // If the hook returned undefined instead of [] for an empty result, any
  // component mapping over photos would crash with "Cannot read length of undefined".
  it('returns an empty array when the venue has no approved photos', async () => {
    mockOrder().mockResolvedValue({ data: null, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVenuePhotos(VENUE_ID), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  // Without the enabled guard, the query would fire with an empty string
  // venue_id, returning photos from every venue or crashing the RPC.
  it('is disabled and makes no DB call when venueId is empty string', () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useVenuePhotos(''), { wrapper: Wrapper });

    // The query must not have started — supabase.from should not be called.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // The data returned should be exactly the array from Supabase, not transformed.
  it('returns the photos array from the DB on success', async () => {
    mockOrder().mockResolvedValue({ data: [FAKE_PHOTO], error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVenuePhotos(VENUE_ID), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([FAKE_PHOTO]);
  });

  // Supabase errors must propagate so React Query can expose isError to UI.
  it('enters error state when Supabase returns an error', async () => {
    mockOrder().mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVenuePhotos(VENUE_ID), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// useUploadVenuePhoto
// ══════════════════════════════════════════════════════════════════════════════

describe('useUploadVenuePhoto', () => {
  // If manipulateAsync is not called, raw EXIF data (including GPS coordinates)
  // would be sent to the server. This is the core privacy protection.
  it('calls manipulateAsync to strip EXIF before upload', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockManipulate).toHaveBeenCalledWith(
      IMAGE_URI,
      [],
      expect.objectContaining({ format: 'jpeg', compress: 0.85 })
    );
  });

  // The storage path must be {venueId}/{uuid}.jpg. Including the userId would
  // violate GDPR data minimisation — the storage layer does not need to know
  // which user uploaded the file.
  it('builds a storage path that contains venueId and uuid but NOT the userId', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const uploadCall = mockUpload().mock.calls[0];
    const storagePath: string = uploadCall[0];

    // Path must start with the venue ID segment.
    expect(storagePath).toMatch(new RegExp(`^${VENUE_ID}/`));
    // Path must NOT contain the user ID anywhere.
    expect(storagePath).not.toContain(FAKE_USER.id);
  });

  // React Native's Blob/fetch layer does not reliably transmit binary data
  // through the multipart body that @supabase/storage-js builds around a
  // Blob (this is documented by storage-js itself). Uploading an ArrayBuffer
  // instead is the fix — regressing back to a Blob here would silently
  // reintroduce the "Upload failed" bug.
  it('uploads an ArrayBuffer (not a Blob) to Supabase Storage', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const uploadedBody = mockUpload().mock.calls[0][1];
    expect(uploadedBody).toBeInstanceOf(ArrayBuffer);
    expect(uploadedBody).not.toBeInstanceOf(Blob);
    // 'ZGF0YQ==' (the default mock read) decodes to the 4 ASCII bytes "data".
    expect((uploadedBody as ArrayBuffer).byteLength).toBe(4);
  });

  // If the manipulated file cannot be read (e.g. the OS evicted the cache
  // file, or a permissions edge case), the failure must surface as a safe,
  // generic message — and the local file path must never reach the logs.
  it('surfaces a safe message and never logs the file path when reading the manipulated file fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockReadAsString.mockRejectedValue(new Error(`File '${MANIP_URI}' does not exist`));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Could not read the photo from your device. Please try again.');
    const allLogArgs = consoleSpy.mock.calls.flat().join(' ');
    expect(allLogArgs).not.toContain(MANIP_URI);
    expect(allLogArgs).not.toContain(IMAGE_URI);

    consoleSpy.mockRestore();
  });

  // If crypto.randomUUID were ever unavailable on-device (no polyfill is
  // installed, and this is the only client call site in the app — see the
  // generatePhotoFilename doc comment), uploads must still work via the
  // Math.random() fallback rather than crashing before any network call.
  it('still builds a valid storage path when crypto.randomUUID is unavailable', async () => {
    const originalCrypto = global.crypto;
    // @ts-expect-error — simulating an environment without crypto.randomUUID.
    global.crypto = undefined;

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const storagePath: string = mockUpload().mock.calls[0][0];
    expect(storagePath).toMatch(new RegExp(`^${VENUE_ID}/.+\\.jpg$`));

    global.crypto = originalCrypto;
  });

  // If the DB insert omits status='pending', the photo could be immediately
  // visible before moderation — a safety risk in a children's app.
  it("inserts the DB row with status='pending'", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockInsert()).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });

  // If the Storage upload fails but we still attempt the DB insert, we create
  // a DB row that points to a file that does not exist — corrupted data.
  it('does not attempt the DB insert when the Storage upload fails', async () => {
    mockUpload().mockResolvedValue({ error: { message: 'Storage quota exceeded' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // The DB insert must never have been called.
    expect(mockInsert()).not.toHaveBeenCalled();
  });

  // Raw Supabase Storage error messages must never reach the thrown error
  // (which the UI's onError handler could one day read) — only a safe,
  // generic message. The raw detail may still be logged, but only via safe
  // fields (name/status), never the full message text.
  it('surfaces a safe generic message (not the raw Storage error) when the Storage upload fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUpload().mockResolvedValue({
      error: { name: 'StorageApiError', status: 400, message: 'Sensitive backend detail: bucket policy denied for path venue-123/abc.jpg' },
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Could not upload photo. Please try again.');
    const allLogArgs = consoleSpy.mock.calls.flat().join(' ');
    expect(allLogArgs).not.toContain('Sensitive backend detail');
    expect(allLogArgs).not.toContain(VENUE_ID); // storage path must not be logged

    consoleSpy.mockRestore();
  });

  // If the DB insert fails after a successful upload, we'd have an orphaned
  // file in Storage with no corresponding DB row — wasted space and a data
  // integrity problem. The rollback must remove the file.
  it('removes the Storage file when the DB insert fails (rollback)', async () => {
    mockInsert().mockResolvedValue({ data: null, error: { message: 'insert failed' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // The remove call must have been made with the path used in the upload.
    const uploadPath: string = mockUpload().mock.calls[0][0];
    expect(mockRemove()).toHaveBeenCalledWith([uploadPath]);
  });

  // Raw Postgres error messages/details must never reach the thrown error.
  // Safe fields (code/hint) may be logged, matching the pattern already used
  // by useCastFacilityVote in useFacilities.ts.
  it('surfaces a safe generic message (not the raw Postgres error) when the DB insert fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockInsert().mockResolvedValue({
      data: null,
      error: { code: '23505', hint: 'duplicate key', message: 'duplicate key value violates unique constraint "venue_photos_pkey" for user user-abc' },
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Could not save photo. Please try again.');
    const allLogArgs = consoleSpy.mock.calls.flat().join(' ');
    expect(allLogArgs).not.toContain(FAKE_USER.id);
    expect(allLogArgs).not.toContain('duplicate key value violates');

    consoleSpy.mockRestore();
  });

  // On success the venuePhotos cache for this venue must be invalidated so
  // the UI can show a pending-approval message or refresh when the photo
  // is eventually approved.
  it('invalidates the venuePhotos query cache on success', async () => {
    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['venuePhotos', VENUE_ID] })
    );
  });

  // The venue detail screen (app/venue/[id].tsx) reads photos via useVenue's
  // own venue_photos join under the ['venue', id] key, NOT via useVenuePhotos
  // (which is never mounted anywhere in the app). Invalidating only
  // 'venuePhotos' would be a silent no-op for the screen users actually look
  // at once a photo is later approved and the venue query is the one that
  // needs a fresh fetch.
  it('also invalidates the venue query key on success so the venue detail screen can refresh', async () => {
    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['venue', VENUE_ID] })
    );
  });

  // Logging the imageUri or userId would expose sensitive data in production
  // log pipelines (crash reporters, analytics). This checks the privacy contract.
  it('does not log the imageUri or userId to the console', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const allLogArgs = consoleSpy.mock.calls.flat().join(' ');
    expect(allLogArgs).not.toContain(IMAGE_URI);
    expect(allLogArgs).not.toContain(FAKE_USER.id);

    consoleSpy.mockRestore();
  });

  // If there is no authenticated user, the mutation must fail immediately
  // without making any network calls — uploading anonymously must be impossible.
  it('throws and makes no network call when user is not authenticated', async () => {
    mockUseAuthStore.mockReturnValue(null as any);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadVenuePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, imageUri: IMAGE_URI });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(mockUpload()).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// useModeratePhoto
// ══════════════════════════════════════════════════════════════════════════════

describe('useModeratePhoto', () => {
  // The update payload must include the moderator's identity and timestamp so
  // there is an audit trail of who approved or rejected each photo. Omitting
  // moderated_by means we lose accountability — a GDPR concern.
  it('sends the correct update payload including moderated_by, moderated_at, status, and notes', async () => {
    // update chain: .update({...}).eq('id', photoId)
    // We need eq to resolve so the mutation can finish.
    _s._mockEq.mockReturnValue({ select: jest.fn().mockResolvedValue({ data: [{ id: PHOTO_ID }], error: null }) });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useModeratePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({
        photoId:          PHOTO_ID,
        venueId:          VENUE_ID,
        status:           'approved',
        moderation_notes: 'Looks good',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate()).toHaveBeenCalledWith(
      expect.objectContaining({
        status:           'approved',
        moderation_notes: 'Looks good',
        moderated_by:     FAKE_USER.id,
        // moderated_at is an ISO timestamp — we just check it is a string.
        moderated_at:     expect.any(String),
      })
    );
    // Must also filter by the correct photo ID.
    expect(_s._mockEq).toHaveBeenCalledWith('id', PHOTO_ID);
  });

  // All three query keys must be invalidated so the moderation queue, the venue
  // photo gallery, and the venue detail page all refresh immediately. Missing
  // even one key would leave a stale UI that confuses admins.
  it('invalidates venuePhotos, pendingPhotos, and venue query keys on success', async () => {
    _s._mockEq.mockReturnValue({ select: jest.fn().mockResolvedValue({ data: [{ id: PHOTO_ID }], error: null }) });

    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useModeratePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ photoId: PHOTO_ID, venueId: VENUE_ID, status: 'rejected' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]);

    expect(invalidatedKeys).toContainEqual(
      expect.objectContaining({ queryKey: ['venuePhotos', VENUE_ID] })
    );
    expect(invalidatedKeys).toContainEqual(
      expect.objectContaining({ queryKey: ['pendingPhotos'] })
    );
    expect(invalidatedKeys).toContainEqual(
      expect.objectContaining({ queryKey: ['venue', VENUE_ID] })
    );
  });

  // If Supabase returns an error, the mutation must surface it as isError so
  // the admin UI can show a failure message. Swallowing the error would leave
  // the admin thinking the moderation action succeeded.
  it('propagates Supabase errors as isError', async () => {
    _s._mockEq.mockReturnValue({ select: jest.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } }) });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useModeratePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ photoId: PHOTO_ID, venueId: VENUE_ID, status: 'approved' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  // An unauthenticated call to moderate is a security hole — any unauthenticated
  // client could approve or reject photos if this guard were missing.
  it('throws immediately when user is not authenticated', async () => {
    mockUseAuthStore.mockReturnValue(null as any);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useModeratePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ photoId: PHOTO_ID, venueId: VENUE_ID, status: 'approved' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockUpdate()).not.toHaveBeenCalled();
  });

  // moderation_notes defaults to null when omitted, so the update payload must
  // not contain the key at all (or send null) — not an empty string, which
  // could break display logic that checks for null.
  it('sends null for moderation_notes when omitted', async () => {
    _s._mockEq.mockReturnValue({ select: jest.fn().mockResolvedValue({ data: [{ id: PHOTO_ID }], error: null }) });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useModeratePhoto(), { wrapper: Wrapper });

    await act(async () => {
      result.current.mutate({ photoId: PHOTO_ID, venueId: VENUE_ID, status: 'rejected' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockUpdate()).toHaveBeenCalledWith(
      expect.objectContaining({ moderation_notes: null })
    );
  });
});
