/**
 * Tests for the GDPR audit log service (services/audit/gdprAuditLog.ts).
 *
 * GDPR Article 5(2) — accountability principle — requires that data controllers
 * be able to demonstrate compliance. writeAuditLog() is the single entry point
 * for all compliance events (consent grants, withdrawals, account deletions,
 * data export requests). These tests ensure every call produces the correct
 * database row shape and that failures are never allowed to propagate to callers.
 */

import { supabase }                    from '@/lib/supabase';
import { writeAuditLog } from '../gdprAuditLog';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

// Helper: build a fresh chainable from() mock so each test gets a clean spy
function resetFromMock(insertResult: { error: object | null } = { error: null }) {
  const insertMock = jest.fn().mockResolvedValue(insertResult);
  mockFrom.mockReturnValue({ insert: insertMock } as any);
  return insertMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetFromMock();
});

// ======================================================================
// writeAuditLog — insert shape
// ======================================================================
describe('writeAuditLog', () => {
  // The primary contract: all required fields must be present on every insert.
  // Missing user_id or action would break the audit trail entirely.
  it('inserts to gdpr_audit_log with all required fields', async () => {
    const insertMock = resetFromMock();

    await writeAuditLog('user-123', 'terms_accepted', 'profiles', 'profile-456');

    expect(mockFrom).toHaveBeenCalledWith('gdpr_audit_log');
    expect(insertMock).toHaveBeenCalledWith({
      user_id:      'user-123',
      action:       'terms_accepted',
      table_name:   'profiles',
      record_id:    'profile-456',
      performed_by: 'user-123',
    });
  });

  // Spot-check: terms_accepted must be accepted as a valid AuditAction.
  // This is the first consent event in the user journey.
  it('accepts the "terms_accepted" audit action', async () => {
    const insertMock = resetFromMock();

    await writeAuditLog('user-abc', 'terms_accepted');

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'terms_accepted' }),
    );
  });

  // Spot-check: account_deleted is the most sensitive event — it must be
  // logged before the account data is removed so we have an erasure trail.
  it('accepts the "account_deleted" audit action', async () => {
    const insertMock = resetFromMock();

    await writeAuditLog('user-abc', 'account_deleted');

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account_deleted' }),
    );
  });

  // When tableNameParam and recordId are omitted the insert object must still
  // be sent, but the optional fields should be undefined — not empty strings,
  // not null strings. This keeps the DB row clean and relies on column defaults.
  it('sends undefined for optional fields when they are omitted', async () => {
    const insertMock = resetFromMock();

    await writeAuditLog('user-abc', 'data_export_requested');

    const insertedObject = insertMock.mock.calls[0][0];
    expect(insertedObject).toHaveProperty('user_id', 'user-abc');
    expect(insertedObject).toHaveProperty('action', 'data_export_requested');
    // The object must NOT have these keys set to a non-undefined value
    expect(insertedObject.table_name).toBeUndefined();
    expect(insertedObject.record_id).toBeUndefined();
  });

  // Non-blocking requirement: if the Supabase insert throws (e.g. a network
  // timeout), writeAuditLog must catch the error and not re-throw it.
  // An audit log failure must never crash the calling flow — a GDPR compliance
  // event (like logging terms acceptance) happening just before the throw
  // must still complete from the caller's point of view.
  it('does not throw when the Supabase insert fails', async () => {
    const insertMock = jest.fn().mockRejectedValue(new Error('network timeout'));
    mockFrom.mockReturnValue({ insert: insertMock } as any);

    await expect(
      writeAuditLog('user-abc', 'location_consent_granted'),
    ).resolves.toBeUndefined();
  });

  // The performed_by field must always equal the userId — it records who
  // initiated the action. In a future admin-action scenario the signatures
  // may diverge, but for now they must match.
  it('sets performed_by to the same value as user_id', async () => {
    const insertMock = resetFromMock();

    await writeAuditLog('user-xyz', 'location_consent_withdrawn');

    const insertedObject = insertMock.mock.calls[0][0];
    expect(insertedObject.performed_by).toBe(insertedObject.user_id);
  });
});
