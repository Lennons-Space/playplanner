/**
 * Tests for the location consent logging service (services/consent/locationConsent.ts).
 *
 * GDPR Article 7 requires that consent be demonstrable — the controller must
 * be able to show that a specific person gave specific consent at a specific
 * time. These tests verify that the consent is written correctly in all paths:
 * authenticated users (direct DB write), unauthenticated users (SecureStore
 * pending write), and post-login migration of pending consent.
 *
 * ICO Children's Code Standard 10: geolocation must be off by default and
 * every consent event must be logged with a version stamp so we can tell
 * which wording the user saw. These tests confirm the consent_version field
 * is always written.
 */

import * as SecureStore from 'expo-secure-store';
import { supabase }     from '@/lib/supabase';
import {
  recordLocationConsentGranted,
  migratePendingLocationConsent,
  recordLocationConsentWithdrawn,
} from '../locationConsent';
import { LOCATION_CONSENT_VERSION } from '@/constants/location';

jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(),
  setItemAsync:    jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Mock Supabase before importing the service so the module-level createClient()
// call in lib/supabase.ts does not throw due to missing env vars.
jest.mock('@/lib/supabase', () => {
  // Chainable builder — each method returns an object that can be chained.
  // We build the full chain and let each test override the terminal mock.
  const selectChain = {
    eq:          jest.fn(),
    not:         jest.fn(),
    is:          jest.fn(),
    order:       jest.fn(),
    limit:       jest.fn(),
    maybeSingle: jest.fn(),
  };
  selectChain.eq.mockReturnValue(selectChain);
  selectChain.not.mockReturnValue(selectChain);
  selectChain.is.mockReturnValue(selectChain);
  selectChain.order.mockReturnValue(selectChain);
  selectChain.limit.mockReturnValue(selectChain);
  selectChain.maybeSingle.mockResolvedValue({ data: null, error: null });

  const updateChain = {
    eq: jest.fn().mockResolvedValue({ error: null }),
  };

  const fromMock = jest.fn().mockReturnValue({
    insert: jest.fn().mockResolvedValue({ error: null }),
    select: jest.fn().mockReturnValue(selectChain),
    update: jest.fn().mockReturnValue(updateChain),
  });

  return {
    supabase: {
      auth: {
        getUser: jest.fn(),
      },
      from: fromMock,
    },
  };
});

process.env.EXPO_PUBLIC_SUPABASE_URL     = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockGetItem    = SecureStore.getItemAsync    as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const mockSetItem    = SecureStore.setItemAsync    as jest.MockedFunction<typeof SecureStore.setItemAsync>;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.MockedFunction<typeof SecureStore.deleteItemAsync>;
const mockGetUser    = supabase.auth.getUser       as jest.MockedFunction<typeof supabase.auth.getUser>;
const mockFrom       = supabase.from               as jest.MockedFunction<typeof supabase.from>;

// Helper: make getUser() resolve as though no session exists
function stubUnauthenticated() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null } as any);
}

// Helper: make getUser() resolve as though a user is logged in
function stubAuthenticated(userId = 'user-abc-123') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null } as any);
}

// Helper: re-build the chainable from() mock so individual tests can customise
// the terminal resolved value without affecting other tests.
function resetFromMock({
  insertError = null,
  maybeSingleData = null,
  maybeSingleError = null,
}: {
  insertError?: object | null;
  maybeSingleData?: object | null;
  maybeSingleError?: object | null;
} = {}) {
  const selectChain = {
    eq:          jest.fn(),
    not:         jest.fn(),
    is:          jest.fn(),
    order:       jest.fn(),
    limit:       jest.fn(),
    maybeSingle: jest.fn(),
  };
  selectChain.eq.mockReturnValue(selectChain);
  selectChain.not.mockReturnValue(selectChain);
  selectChain.is.mockReturnValue(selectChain);
  selectChain.order.mockReturnValue(selectChain);
  selectChain.limit.mockReturnValue(selectChain);
  selectChain.maybeSingle.mockResolvedValue({ data: maybeSingleData, error: maybeSingleError });

  const updateChain = {
    eq: jest.fn().mockResolvedValue({ error: null }),
  };

  mockFrom.mockReturnValue({
    insert: jest.fn().mockResolvedValue({ error: insertError }),
    select: jest.fn().mockReturnValue(selectChain),
    update: jest.fn().mockReturnValue(updateChain),
  } as any);

  return { selectChain, updateChain };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
  mockDeleteItem.mockResolvedValue(undefined);
  mockGetItem.mockResolvedValue(null);
  resetFromMock();
});

// ======================================================================
// recordLocationConsentGranted
// ======================================================================
describe('recordLocationConsentGranted', () => {
  // When no user session exists the consent cannot be written to the database.
  // It must be persisted locally in SecureStore under 'pending_location_consent'
  // so it can be migrated once an account is created or the user logs in.
  it('writes pending consent to SecureStore when user is unauthenticated', async () => {
    stubUnauthenticated();

    await recordLocationConsentGranted();

    expect(mockSetItem).toHaveBeenCalledWith(
      'pending_location_consent',
      expect.stringContaining('"consent_version":"' + LOCATION_CONSENT_VERSION + '"'),
    );
    // Must not attempt a DB write
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // If SecureStore throws (e.g. device is locked), the function must swallow
  // the error and return. The consent prompt will be shown again next session.
  // A thrown error here would crash the app at an inopportune moment.
  it('swallows SecureStore errors when unauthenticated — does not throw', async () => {
    stubUnauthenticated();
    mockSetItem.mockRejectedValue(new Error('device locked'));

    await expect(recordLocationConsentGranted()).resolves.toBeUndefined();
  });

  // When the user is authenticated, the consent must be written directly to
  // the database with all required fields: user_id, consented_at, and
  // consent_version (needed to prove which wording the user saw — GDPR Art.7).
  it('inserts a consent record with correct fields when user is authenticated', async () => {
    stubAuthenticated('user-abc-123');
    resetFromMock({ insertError: null });

    await recordLocationConsentGranted();

    expect(mockFrom).toHaveBeenCalledWith('location_consent_log');
    const fromInstance = mockFrom.mock.results[0].value;
    expect(fromInstance.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id:         'user-abc-123',
        consent_version: LOCATION_CONSENT_VERSION,
        consented_at:    expect.any(String),
      }),
    );
  });

  // A DB insert failure must be logged as a warning but must NOT throw.
  // Logging failures must never block the user — the map should open regardless.
  it('logs a warning and does not throw when the DB insert fails', async () => {
    stubAuthenticated();
    resetFromMock({ insertError: { message: 'DB error' } });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(recordLocationConsentGranted()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('PlayPlanner:'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });
});

// ======================================================================
// migratePendingLocationConsent
// ======================================================================
describe('migratePendingLocationConsent', () => {
  // If there is no pending consent in SecureStore, migration should be a no-op.
  // We must not make any DB call — that would be a spurious insert.
  it('does nothing when no pending consent exists in SecureStore', async () => {
    mockGetItem.mockResolvedValue(null);

    await migratePendingLocationConsent('user-abc-123');

    expect(mockFrom).not.toHaveBeenCalled();
  });

  // Happy path: pending consent exists → insert it to the DB linked to the
  // newly authenticated user, then remove the local copy so it is not
  // migrated twice on the next login.
  it('inserts pending consent to DB and deletes the SecureStore key on success', async () => {
    const pending = {
      consented_at:    '2024-01-15T10:00:00.000Z',
      consent_version: 'v1.0',
    };
    mockGetItem.mockResolvedValue(JSON.stringify(pending));
    resetFromMock({ insertError: null });

    await migratePendingLocationConsent('user-xyz-456');

    expect(mockFrom).toHaveBeenCalledWith('location_consent_log');
    const fromInstance = mockFrom.mock.results[0].value;
    expect(fromInstance.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id:         'user-xyz-456',
        consented_at:    pending.consented_at,
        consent_version: pending.consent_version,
      }),
    );
    // Delete the local copy only after a confirmed DB write
    expect(mockDeleteItem).toHaveBeenCalledWith('pending_location_consent');
  });

  // If the DB insert fails, the local SecureStore copy must be kept so the
  // migration can be retried on the next login. Deleting it on failure would
  // mean the consent record is lost entirely — a GDPR accountability gap.
  it('retains the SecureStore key when the DB insert fails', async () => {
    const pending = {
      consented_at:    '2024-01-15T10:00:00.000Z',
      consent_version: 'v1.0',
    };
    mockGetItem.mockResolvedValue(JSON.stringify(pending));
    resetFromMock({ insertError: { message: 'network error' } });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await migratePendingLocationConsent('user-xyz-456');

    // The local copy must NOT be deleted — it will be retried next login
    expect(mockDeleteItem).not.toHaveBeenCalledWith('pending_location_consent');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

// ======================================================================
// recordLocationConsentWithdrawn
// ======================================================================
describe('recordLocationConsentWithdrawn', () => {
  // GDPR Art.7(3) requires that withdrawal be as easy as giving consent.
  // If there is no user, the function must return silently — no DB calls.
  it('returns without any DB call when no user is authenticated', async () => {
    stubUnauthenticated();

    await recordLocationConsentWithdrawn();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  // When an active consent record exists, it must be marked as withdrawn by
  // setting consent_withdrawn_at. The record is found by querying for rows
  // with no withdrawal date yet (the most recently granted consent).
  it('updates the active consent record with a withdrawal timestamp', async () => {
    stubAuthenticated('user-abc-123');
    const { updateChain } = resetFromMock({
      maybeSingleData: { id: 'consent-row-id' },
    });

    await recordLocationConsentWithdrawn();

    // Must have queried for the active consent record
    expect(mockFrom).toHaveBeenCalledWith('location_consent_log');
    // Must then update the found record
    const fromInstance = mockFrom.mock.results[0].value;
    expect(fromInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        consent_withdrawn_at: expect.any(String),
      }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'consent-row-id');
  });

  // If no active consent exists (e.g. the user revokes before ever granting,
  // or has already withdrawn), the function should do nothing rather than
  // throwing or inserting a spurious record.
  it('does nothing when no active consent record is found', async () => {
    stubAuthenticated('user-abc-123');
    resetFromMock({ maybeSingleData: null });

    await recordLocationConsentWithdrawn();

    // select was called to look up the record...
    expect(mockFrom).toHaveBeenCalledWith('location_consent_log');
    // ...but update must not have been called (nothing to withdraw)
    const fromInstance = mockFrom.mock.results[0].value;
    expect(fromInstance.update).not.toHaveBeenCalled();
  });
});
