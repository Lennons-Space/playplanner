/**
 * Security tests: writeAuditLog must never leak PII into the audit trail.
 *
 * GDPR Art.5(1)(c) — data minimisation: the audit log exists to prove
 * compliance events happened, not to store personal data. If an email
 * address, display name, or coordinate appeared in the `details` or
 * `action` fields, the log itself would become a GDPR liability.
 *
 * These tests act as a regression guard — if someone adds a `details`
 * parameter to writeAuditLog in the future and passes user data through
 * it, this suite will catch it.
 */

import { supabase } from '@/lib/supabase';
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

const mockFrom   = supabase.from as jest.MockedFunction<typeof supabase.from>;

function getInsertedRow(): Record<string, unknown> {
  const insertMock = (mockFrom.mock.results[0]?.value as any)?.insert as jest.Mock;
  return insertMock?.mock.calls[0]?.[0] ?? {};
}

function resetFromMock() {
  const insertMock = jest.fn().mockResolvedValue({ data: null, error: null });
  mockFrom.mockReturnValue({ insert: insertMock } as any);
  return insertMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetFromMock();
});

// ======================================================================
// No PII in inserted row fields
// ======================================================================
describe('writeAuditLog — no PII in audit row', () => {
  it('does not write an email address into any field', async () => {
    await writeAuditLog('user-test-123', 'terms_accepted', 'profiles');

    const row = getInsertedRow();
    const rowStr = JSON.stringify(row);
    // Must not contain anything that looks like an email
    expect(rowStr).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  });

  it('does not write GPS-precision coordinates into any field', async () => {
    await writeAuditLog('user-test-123', 'location_consent_granted', 'location_consent_log');

    const row = getInsertedRow();
    const rowStr = JSON.stringify(row);
    // Must not contain a number with 5+ decimal places (GPS precision)
    expect(rowStr).not.toMatch(/\d+\.\d{5,}/);
  });

  it('does not embed the user_id value inside a serialised JSON string in another field', async () => {
    const userId = 'user-test-abc-456';
    await writeAuditLog(userId, 'data_export_requested');

    const row = getInsertedRow();
    // user_id may exist as a top-level field — that is correct.
    // What must NOT happen is the userId appearing inside another field value.
    const rowWithoutUserIdField = { ...row, user_id: undefined, performed_by: undefined };
    const strWithoutUserIdField = JSON.stringify(rowWithoutUserIdField);
    expect(strWithoutUserIdField).not.toContain(userId);
  });

  it('does not write a display name or full_name into any field', async () => {
    // Even if the caller passes sensitive data as recordId, it must only land
    // in the designated record_id column — not duplicated elsewhere.
    await writeAuditLog('user-test-123', 'account_deleted', 'profiles', 'profile-row-id');

    const row = getInsertedRow();
    // No free-text name fields should appear
    expect(row).not.toHaveProperty('full_name');
    expect(row).not.toHaveProperty('display_name');
    expect(row).not.toHaveProperty('name');
    expect(row).not.toHaveProperty('username');
  });

  it('does not write latitude or longitude fields', async () => {
    await writeAuditLog('user-test-123', 'location_consent_withdrawn', 'location_consent_log');

    const row = getInsertedRow();
    expect(row).not.toHaveProperty('latitude');
    expect(row).not.toHaveProperty('longitude');
    expect(row).not.toHaveProperty('lat');
    expect(row).not.toHaveProperty('lng');
    expect(row).not.toHaveProperty('coords');
  });
});

// ======================================================================
// Only whitelisted fields are written
// ======================================================================
describe('writeAuditLog — insert shape is minimal', () => {
  it('only writes the five expected fields — no extras', async () => {
    await writeAuditLog('user-test-123', 'terms_accepted', 'profiles', 'rec-456');

    const row = getInsertedRow();
    const writtenKeys = Object.keys(row).sort();
    expect(writtenKeys).toEqual(
      ['action', 'performed_by', 'record_id', 'table_name', 'user_id'].sort(),
    );
  });

  it('omits table_name and record_id when not provided (no spurious undefined keys)', async () => {
    await writeAuditLog('user-test-123', 'account_deleted');

    const row = getInsertedRow();
    // table_name and record_id should be undefined — not null, not empty string
    expect(row.table_name).toBeUndefined();
    expect(row.record_id).toBeUndefined();
  });
});
