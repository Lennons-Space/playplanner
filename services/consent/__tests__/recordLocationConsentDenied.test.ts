/**
 * Tests for recordLocationConsentDenied (services/consent/locationConsent.ts).
 *
 * GDPR / ICO Children's Code Standard 10: when the OS permission dialog is
 * dismissed with "Deny", we must record that the user was asked and refused
 * so we can demonstrate to the ICO that we honoured the refusal and did not
 * re-prompt inappropriately.
 *
 * Security rules verified here:
 *   - No coordinates are ever written (only user_id + consent_version)
 *   - consented_at is null (this is a denial, not a grant)
 *   - Unauthenticated calls return silently — no DB write without a user_id
 *   - DB failures are non-fatal and never propagate to the caller
 */

import { supabase } from '@/lib/supabase';
import { recordLocationConsentDenied } from '../locationConsent';
import { LOCATION_CONSENT_VERSION } from '@/constants/location';

jest.mock('@/lib/supabase', () => {
  const fromMock = jest.fn().mockReturnValue({
    insert: jest.fn().mockResolvedValue({ error: null }),
  });
  return {
    supabase: {
      auth: { getUser: jest.fn() },
      from: fromMock,
    },
  };
});

// writeAuditLog is called after a successful insert — mock it so we don't
// need to wire up the full audit log table in these focused unit tests.
jest.mock('@/services/audit/gdprAuditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockGetUser = supabase.auth.getUser as jest.MockedFunction<typeof supabase.auth.getUser>;
const mockFrom    = supabase.from        as jest.MockedFunction<typeof supabase.from>;

function stubUnauthenticated() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null } as any);
}

function stubAuthenticated(userId = 'user-test-123') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null } as any);
}

function resetFromMock(insertError: object | null = null) {
  const insertMock = jest.fn().mockResolvedValue({ error: insertError });
  mockFrom.mockReturnValue({ insert: insertMock } as any);
  return insertMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetFromMock();
});

// ======================================================================
// Unauthenticated path
// ======================================================================
describe('recordLocationConsentDenied — unauthenticated', () => {
  it('returns silently without any DB write when no user is authenticated', async () => {
    stubUnauthenticated();

    await recordLocationConsentDenied();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not throw when unauthenticated', async () => {
    stubUnauthenticated();

    await expect(recordLocationConsentDenied()).resolves.toBeUndefined();
  });
});

// ======================================================================
// Authenticated path — correct insert shape
// ======================================================================
describe('recordLocationConsentDenied — authenticated', () => {
  it('inserts a denial row with consented_at set to null', async () => {
    stubAuthenticated('user-test-123');
    const insertMock = resetFromMock(null);

    await recordLocationConsentDenied();

    expect(mockFrom).toHaveBeenCalledWith('location_consent_log');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id:      'user-test-123',
        consented_at: null,
      }),
    );
  });

  it('includes the consent_version so we know which wording the user saw', async () => {
    stubAuthenticated();
    const insertMock = resetFromMock(null);

    await recordLocationConsentDenied();

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consent_version: LOCATION_CONSENT_VERSION,
      }),
    );
  });

  // Security: coordinates must NEVER be written in a consent log row.
  // The only purpose is accountability — we record who was asked and when,
  // not where they were.
  it('never writes latitude, longitude, or any coordinate field', async () => {
    stubAuthenticated();
    const insertMock = resetFromMock(null);

    await recordLocationConsentDenied();

    const insertedRow = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow).not.toHaveProperty('latitude');
    expect(insertedRow).not.toHaveProperty('longitude');
    expect(insertedRow).not.toHaveProperty('coords');
    expect(insertedRow).not.toHaveProperty('location');
  });

  it('does not set consent_withdrawn_at on a denial row', async () => {
    stubAuthenticated();
    const insertMock = resetFromMock(null);

    await recordLocationConsentDenied();

    const insertedRow = insertMock.mock.calls[0][0] as Record<string, unknown>;
    // The field should not be present — this is a denial, not a withdrawal.
    // Withdrawals are handled by recordLocationConsentWithdrawn.
    expect(insertedRow.consent_withdrawn_at).toBeUndefined();
  });
});

// ======================================================================
// Non-blocking contract — failures must never propagate
// ======================================================================
describe('recordLocationConsentDenied — non-blocking contract', () => {
  it('does not throw when the DB insert returns an error', async () => {
    stubAuthenticated();
    resetFromMock({ message: 'connection refused', code: '08006' });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(recordLocationConsentDenied()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });

  it('does not throw when supabase.auth.getUser throws', async () => {
    mockGetUser.mockRejectedValue(new Error('auth service unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(recordLocationConsentDenied()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });

  it('does not throw when supabase.from().insert throws', async () => {
    stubAuthenticated();
    mockFrom.mockReturnValue({
      insert: jest.fn().mockRejectedValue(new Error('network timeout')),
    } as any);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(recordLocationConsentDenied()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });
});
