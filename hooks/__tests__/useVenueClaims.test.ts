/**
 * Tests for useVenueClaims hooks.
 *
 * Covers:
 * - useVenueClaimStatus: null when no active claim, returns data when found
 * - useMyVenueClaims: returns user's own claims
 * - useReviewClaim: approve path calls supabase.rpc('review_venue_claim')
 * - useReviewClaim: reject path calls supabase.rpc with decision='rejected'
 * - RLS guard: insert must include user_id matching auth.uid()
 *
 * NOTE: useReviewClaim now uses a single supabase.rpc() call (not three
 * sequential .from() writes). The tests reflect this refactored shape.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useVenueClaimStatus,
  useMyVenueClaims,
  useReviewClaim,
  useAdminVenueClaims,
  derivePhoneLast4,
  isMissingPhoneLast4Column,
} from '../useVenueClaims';

// useAdminVenueClaims scopes its query key by auth identity; the identity value
// itself is irrelevant to the schema-compatibility behaviour under test here.
jest.mock('@/hooks/useAuthIdentity', () => ({
  useAuthIdentity: () => 'admin-user-id',
  ANON_IDENTITY:   'anon',
}));

// ── Mock supabase ─────────────────────────────────────────────────────────────
// chainable mock for the query builder
const mockSingle      = jest.fn();
const mockMaybeSingle = jest.fn();
const mockOrder       = jest.fn();
const mockLimit       = jest.fn();
const mockIn          = jest.fn();
const mockEq          = jest.fn();
const mockSelect      = jest.fn();
const mockFrom        = jest.fn();
// RPC mock — useReviewClaim calls supabase.rpc() directly
const mockRpc         = jest.fn();

const builder: Record<string, jest.Mock> = {
  select:      mockSelect,
  eq:          mockEq,
  in:          mockIn,
  order:       mockOrder,
  limit:       mockLimit,
  single:      mockSingle,
  maybeSingle: mockMaybeSingle,
};

Object.keys(builder).forEach((key) => {
  builder[key].mockReturnValue(builder);
});

mockFrom.mockReturnValue(builder);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc:  (...args: unknown[]) => mockRpc(...args),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ── Test helpers ──────────────────────────────────────────────────────────────
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries:   { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(builder).forEach((key) => {
    builder[key].mockReturnValue(builder);
  });
  mockFrom.mockReturnValue(builder);
});

// ── useVenueClaimStatus ───────────────────────────────────────────────────────
describe('useVenueClaimStatus', () => {
  it('returns null when no active claim exists for the venue', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(
      () => useVenueClaimStatus('venue-123', 'user-abc'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns the claim when a pending claim exists', async () => {
    const claim = { id: 'claim-abc', status: 'pending', created_at: '2026-01-01T00:00:00Z' };
    mockMaybeSingle.mockResolvedValueOnce({ data: claim, error: null });

    const { result } = renderHook(
      () => useVenueClaimStatus('venue-123', 'user-abc'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(claim);
  });

  it('returns the claim when an approved claim exists', async () => {
    const claim = { id: 'claim-def', status: 'approved', created_at: '2026-01-02T00:00:00Z' };
    mockMaybeSingle.mockResolvedValueOnce({ data: claim, error: null });

    const { result } = renderHook(
      () => useVenueClaimStatus('venue-456', 'user-abc'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(claim);
    expect(mockIn).toHaveBeenCalledWith('status', ['pending', 'approved']);
  });

  it('is disabled when venueId is undefined', () => {
    const { result } = renderHook(
      () => useVenueClaimStatus(undefined, 'user-abc'),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('is disabled when userId is undefined', () => {
    const { result } = renderHook(
      () => useVenueClaimStatus('venue-123', undefined),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── useMyVenueClaims ──────────────────────────────────────────────────────────
describe('useMyVenueClaims', () => {
  it('returns the list of claims for the current user', async () => {
    const claims = [
      { id: 'c1', venue_id: 'v1', status: 'pending',  created_at: '2026-01-01T00:00:00Z', admin_notes: null },
      { id: 'c2', venue_id: 'v2', status: 'approved', created_at: '2026-01-02T00:00:00Z', admin_notes: null },
    ];
    // limit() is the last chain call before the query resolves
    mockLimit.mockResolvedValueOnce({ data: claims, error: null });

    const { result } = renderHook(
      () => useMyVenueClaims('user-xyz'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(claims);
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-xyz');
  });

  it('returns an empty array when the user has no claims', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(
      () => useMyVenueClaims('user-xyz'),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is disabled when userId is undefined', () => {
    const { result } = renderHook(
      () => useMyVenueClaims(undefined),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── useReviewClaim ────────────────────────────────────────────────────────────
// useReviewClaim now delegates all DB work to the review_venue_claim RPC so
// the entire approve/reject/partial-failure logic lives in Postgres. The client
// tests verify: (a) the correct RPC name is called, (b) the correct parameters
// are passed, (c) errors are surfaced, and (d) PGRST301 permission errors
// produce a meaningful message.
describe('useReviewClaim', () => {
  it('approve: calls supabase.rpc with decision="approved"', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:  'claim-1',
        venueId:  'venue-1',
        userId:   'user-1',
        decision: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('review_venue_claim', {
      p_claim_id:    'claim-1',
      p_decision:    'approved',
      p_admin_notes: null,
    });
  });

  it('reject: calls supabase.rpc with decision="rejected" and admin notes', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:    'claim-2',
        venueId:    'venue-2',
        userId:     'user-2',
        decision:   'rejected',
        adminNotes: 'Could not verify ownership.',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('review_venue_claim', {
      p_claim_id:    'claim-2',
      p_decision:    'rejected',
      p_admin_notes: 'Could not verify ownership.',
    });
  });

  it('surfaces a permission error when PGRST301 is returned', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PGRST301', message: 'permission denied' },
    });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:  'claim-rls',
        venueId:  'venue-rls',
        userId:   'user-rls',
        decision: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toMatch(/Admin permissions may have changed/);
  });

  it('rethrows raw error when RPC returns a non-permission error', async () => {
    const rawError = { code: '42883', message: 'function does not exist' };
    mockRpc.mockResolvedValueOnce({ error: rawError });

    const { result } = renderHook(() => useReviewClaim(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({
        claimId:  'claim-err',
        venueId:  'venue-err',
        userId:   'user-err',
        decision: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── RLS insert guard ──────────────────────────────────────────────────────────
// NOTE (2026-09-01 privacy remediation): the claim-submission UI is currently
// REMOVED from the app (see app/(tabs)/profile.tsx's "being redesigned for
// security before re-launch" comment) — there is no live insert code path to
// test today. This describes the INTENDED future contract once that flow is
// rebuilt: the client must never construct a payload containing the
// recoverable full phone number — only the minimised representation computed
// server-side (in the edge function, from a keyed HMAC — see
// supabase/migrations_drafts/20260901120000_venue_claims_phone_minimisation.sql).
describe('RLS: venue_claims insert must include user_id, and must never carry the recoverable full phone number', () => {
  it('the future insert payload from claim-verify includes user_id and only the minimised phone fields', () => {
    const insertPayload = {
      venue_id:                  'some-venue',
      user_id:                   'auth-user-id',
      phone_last4:                '7890',
      phone_verification_hmac:    'server-computed-hmac-not-recoverable',
      phone_verified_at:          '2026-09-01T00:00:00.000Z',
      phone_verification_method:  'sms_otp' as const,
      status:                     'pending' as const,
      notes:                      null,
    };

    expect(insertPayload).toHaveProperty('user_id');
    expect(insertPayload.status).toBe('pending');
    expect(insertPayload).not.toHaveProperty('verified_phone');
    expect(insertPayload.phone_last4).toHaveLength(4);
    expect(['null', null]).toContain(
      insertPayload.notes === null ? null : String(insertPayload.notes)
    );
  });
});

// ── useAdminVenueClaims: schema-compatibility adapter ─────────────────────────
//
// TEMPORARY SCHEMA-COMPATIBILITY FALLBACK — remove after 20260901120000 is
// promoted and verified. These tests lock the adapter's contract: it must
// prefer the minimised column, downgrade ONLY on proof the server is still on
// the old schema, and never let a recoverable full phone number escape.
//
// The chain is .from().select().eq().order().limit(); limit() is the terminal
// call that resolves, so each query is staged with one mockLimit resolution.

const FULL_LEGACY_PHONE = '+441632960789'; // last four digits: 0789
const MISSING_COLUMN_ERROR = {
  code:    '42703',
  message: 'column "phone_last4" does not exist',
  details: null,
  hint:    null,
};

function adminRow(extra: Record<string, unknown>) {
  return {
    id:         'claim-1',
    venue_id:   'venue-1',
    user_id:    'user-1',
    status:     'pending',
    notes:      null,
    created_at: '2026-09-01T00:00:00Z',
    venue:      { id: 'venue-1', name: 'Soft Play', address_line1: '1 High St', city: 'Leeds' },
    claimant:   { id: 'user-1', username: 'owner', full_name: 'Owner Person' },
    ...extra,
  };
}

/** The select() argument for the Nth query (1-indexed). */
function selectArg(n: number): string {
  return String(mockSelect.mock.calls[n - 1][0]);
}

describe('useAdminVenueClaims — A. NEW SCHEMA (phone_last4 present)', () => {
  it('uses phone_last4, issues exactly one query, and never requests verified_phone', async () => {
    mockLimit.mockResolvedValueOnce({
      data:  [adminRow({ phone_last4: '4321' })],
      error: null,
    });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'claim-1', phone_last4: '4321' }),
    ]);

    // No second query occurred.
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);

    // verified_phone was never requested.
    expect(selectArg(1)).toContain('phone_last4');
    expect(selectArg(1)).not.toContain('verified_phone');
  });

  it('preserves the embedded venue and claimant relations', async () => {
    mockLimit.mockResolvedValueOnce({
      data:  [adminRow({ phone_last4: '4321' })],
      error: null,
    });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0].venue).toEqual(
      { id: 'venue-1', name: 'Soft Play', address_line1: '1 High St', city: 'Leeds' }
    );
    expect(result.current.data![0].claimant).toEqual(
      { id: 'user-1', username: 'owner', full_name: 'Owner Person' }
    );
  });
});

describe('useAdminVenueClaims — B. OLD SCHEMA (phone_last4 missing)', () => {
  it('retries with the legacy column, derives last4, and returns no verified_phone', async () => {
    mockLimit
      .mockResolvedValueOnce({ data: null, error: MISSING_COLUMN_ERROR })
      .mockResolvedValueOnce({
        data:  [adminRow({ verified_phone: FULL_LEGACY_PHONE })],
        error: null,
      });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // First query asked for the new column; second asked for the legacy one.
    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(selectArg(1)).toContain('phone_last4');
    expect(selectArg(1)).not.toContain('verified_phone');
    expect(selectArg(2)).toContain('verified_phone');
    expect(selectArg(2)).not.toContain('phone_last4');

    // Correct last four derived from the full legacy value.
    expect(result.current.data![0].phone_last4).toBe('0789');

    // The app-facing shape is identical to the new-schema shape.
    expect(result.current.data![0]).not.toHaveProperty('verified_phone');
    expect(Object.keys(result.current.data![0]).sort()).toEqual(
      ['claimant', 'created_at', 'id', 'notes', 'phone_last4', 'status', 'user_id', 'venue', 'venue_id']
    );
  });

  it('also falls back on the PostgREST schema-cache variant (PGRST204)', async () => {
    mockLimit
      .mockResolvedValueOnce({
        data:  null,
        error: {
          code:    'PGRST204',
          message: "Could not find the 'phone_last4' column of 'venue_claims' in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data:  [adminRow({ verified_phone: FULL_LEGACY_PHONE })],
        error: null,
      });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(result.current.data![0].phone_last4).toBe('0789');
  });

  it('surfaces a legacy-query failure instead of masking it', async () => {
    mockLimit
      .mockResolvedValueOnce({ data: null, error: MISSING_COLUMN_ERROR })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST301', message: 'permission denied' } });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

describe('useAdminVenueClaims — C. NON-SCHEMA FAILURES must not fall back', () => {
  const nonSchemaFailures: [string, unknown][] = [
    ['auth (PGRST301)',           { code: 'PGRST301', message: 'JWT expired' }],
    ['RLS / permission denied',   { code: '42501',    message: 'permission denied for table venue_claims' }],
    ['network failure',           { code: '',         message: 'Network request failed' }],
    ['malformed response',        { message: 'Unexpected end of JSON input' }],
    ['arbitrary PostgREST error', { code: 'PGRST100', message: 'failed to parse select parameter' }],
    ['undefined_table',           { code: '42P01',    message: 'relation "venue_claims" does not exist' }],
    // The decisive case: the right SQLSTATE, but about a DIFFERENT column.
    // That is a genuine bug in this query, not proof of an old schema.
    ['42703 for another column',  { code: '42703',    message: 'column "notes" does not exist' }],
  ];

  it.each(nonSchemaFailures)('does not retry on %s', async (_label, error) => {
    mockLimit.mockResolvedValueOnce({ data: null, error });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Exactly one query — the legacy read was never attempted.
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(selectArg(1)).not.toContain('verified_phone');
  });

  it('rethrows the original error unchanged', async () => {
    const error = { code: 'PGRST301', message: 'JWT expired' };
    mockLimit.mockResolvedValueOnce({ data: null, error });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
  });
});

describe('useAdminVenueClaims — D. PRIVACY: the full legacy number never escapes', () => {
  it('is absent from the returned data and from every console channel', async () => {
    const logSpy   = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockLimit
      .mockResolvedValueOnce({ data: null, error: MISSING_COLUMN_ERROR })
      .mockResolvedValueOnce({
        data:  [adminRow({ verified_phone: FULL_LEGACY_PHONE })],
        error: null,
      });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Not anywhere in the serialised result — including nested relations.
    expect(JSON.stringify(result.current.data)).not.toContain(FULL_LEGACY_PHONE);
    expect(JSON.stringify(result.current.data)).not.toContain('441632960789');

    // Not written to any console channel.
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((a) => String(a))
      .join(' ');
    expect(logged).not.toContain(FULL_LEGACY_PHONE);
    expect(logged).not.toContain('441632960789');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('is absent from the error surfaced when the legacy query fails', async () => {
    mockLimit
      .mockResolvedValueOnce({ data: null, error: MISSING_COLUMN_ERROR })
      .mockResolvedValueOnce({ data: null, error: { code: '500', message: 'internal error' } });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(JSON.stringify(result.current.error)).not.toContain(FULL_LEGACY_PHONE);
  });
});

describe('useAdminVenueClaims — E. NULL / EDGE cases', () => {
  it('null legacy phone yields null last4', async () => {
    mockLimit
      .mockResolvedValueOnce({ data: null, error: MISSING_COLUMN_ERROR })
      .mockResolvedValueOnce({ data: [adminRow({ verified_phone: null })], error: null });

    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].phone_last4).toBeNull();
  });

  it('an empty result set is returned as an empty array', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useAdminVenueClaims(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  describe('derivePhoneLast4', () => {
    it.each([
      ['+441632960789',  '0789'],
      ['07700 900 123',  '0123'],
      ['(0113) 496-0000', '0000'],
      ['1234',           '1234'],
    ])('derives the last four digits of %s', (input, expected) => {
      expect(derivePhoneLast4(input)).toBe(expected);
    });

    it.each([
      ['null',         null],
      ['undefined',    undefined],
      ['a number',     441632960789],
      ['empty string', ''],
      ['too short',    '123'],
      ['no digits',    'not-a-phone'],
      ['only symbols', '+-() '],
    ])('fails closed to null for %s', (_label, input) => {
      expect(derivePhoneLast4(input)).toBeNull();
    });

    it('never returns the whole value when it is shorter than four digits', () => {
      // Returning "the last 2 of a 2-digit value" would be the value itself.
      expect(derivePhoneLast4('12')).toBeNull();
    });
  });

  describe('isMissingPhoneLast4Column', () => {
    it('accepts 42703 and PGRST204 naming phone_last4', () => {
      expect(isMissingPhoneLast4Column(MISSING_COLUMN_ERROR)).toBe(true);
      expect(isMissingPhoneLast4Column({
        code:    'PGRST204',
        message: "Could not find the 'phone_last4' column of 'venue_claims' in the schema cache",
      })).toBe(true);
      // PostgREST may qualify the column with the table name.
      expect(isMissingPhoneLast4Column({
        code: '42703', message: 'column venue_claims.phone_last4 does not exist',
      })).toBe(true);
      // The column name may arrive in details rather than message.
      expect(isMissingPhoneLast4Column({
        code: '42703', message: 'column does not exist', details: 'phone_last4',
      })).toBe(true);
    });

    it('rejects everything else', () => {
      expect(isMissingPhoneLast4Column(null)).toBe(false);
      expect(isMissingPhoneLast4Column(undefined)).toBe(false);
      expect(isMissingPhoneLast4Column('42703')).toBe(false);
      expect(isMissingPhoneLast4Column({})).toBe(false);
      // Right code, wrong column.
      expect(isMissingPhoneLast4Column({ code: '42703', message: 'column "notes" does not exist' })).toBe(false);
      // Right column named, but a code that does not mean "column absent".
      expect(isMissingPhoneLast4Column({ code: 'PGRST301', message: 'phone_last4 denied' })).toBe(false);
      expect(isMissingPhoneLast4Column({ code: '42501', message: 'permission denied' })).toBe(false);
    });
  });
});
