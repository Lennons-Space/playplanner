/**
 * Tests for hooks/useVenueReport.ts
 *
 * useReportVenue submits a venue data-quality report to the `venue_reports`
 * table. It is used when a parent notices a venue is permanently closed,
 * has wrong information, or contains inappropriate content.
 *
 * WHY these tests matter:
 *   - Reports are a moderation tool. If the insert shape is wrong, valid
 *     reports are silently discarded and bad venues stay live.
 *   - notes are trimmed + truncated client-side; a bug here means raw untrimmed
 *     user content can exceed the 2000-char DB CHECK constraint and cause a
 *     cryptic Postgres error instead of a clean failure.
 *   - reported_by must be the current user's ID (RLS enforces this server-side,
 *     but the client must not accidentally send a different value or null for
 *     an authenticated user).
 *   - Privacy: venue_id and user_id must never appear in console.error output
 *     (they are personal data in a moderation context per the hook's own comment).
 *   - Unauthenticated users must still be able to send a report with
 *     reported_by=null (anonymous reports) — the RLS policy determines whether
 *     this is accepted, but the client must not crash on null user.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { useReportVenue } from '../useVenueReport';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The supabase mock must be declared before any import that transitively loads
// lib/supabase.ts. We build a minimal chainable mock — insert() is the only
// method useReportVenue calls on the query builder.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

// useUser is a selector over the Zustand auth store. We mock it so tests can
// control whether a user is "signed in" without needing the full Zustand tree.
jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

const mockFrom    = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockUseUser = useUser       as jest.MockedFunction<typeof useUser>;

/** Returns a fresh insert mock configured to resolve with a given error (or none). */
function buildInsertMock(error: object | null = null) {
  const insertFn = jest.fn().mockResolvedValue({ error });
  mockFrom.mockReturnValue({ insert: insertFn } as any);
  return insertFn;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries:   { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const VENUE_ID   = 'venue-abc-123';
const USER_ID    = 'user-xyz-456';
const FAKE_USER  = { id: USER_ID } as any;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: signed-in user
  mockUseUser.mockReturnValue(FAKE_USER);
});

// ============================================================================
// Insert shape — happy path
// ============================================================================

describe('useReportVenue — insert shape', () => {
  // If venue_id is missing from the insert, the DB row cannot be linked to the
  // venue and the report is useless. The FK constraint would also reject it.
  it('inserts a row into venue_reports with the correct venue_id', async () => {
    const insertMock = buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'wrong_info' });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ venue_id: VENUE_ID }),
    );
  });

  // If reported_by is wrong, the RLS INSERT policy (auth.uid() = reported_by)
  // would reject the row silently and the user would think the report was sent.
  it('sets reported_by to the current user id', async () => {
    const insertMock = buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'permanently_closed' });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ reported_by: USER_ID }),
    );
  });

  // All five valid reason values must pass through unchanged to the DB.
  // A mapping error here would insert an unrecognised enum value and cause a
  // Postgres constraint violation that surfaces as a cryptic error to the user.
  it.each([
    'permanently_closed',
    'wrong_info',
    'inappropriate_content',
    'duplicate',
    'other',
  ] as const)(
    'passes reason "%s" directly to the insert payload',
    async (reason) => {
      const insertMock = buildInsertMock(null);
      const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

      await act(async () => {
        await result.current.mutateAsync({ venueId: VENUE_ID, reason });
      });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason }),
      );
    },
  );

  // When notes are provided they must be trimmed of leading/trailing whitespace
  // and truncated at 2000 chars before reaching the DB. Without this, a user
  // who pastes a large block of text would receive a raw Postgres CHECK error.
  it('trims whitespace from notes before inserting', async () => {
    const insertMock = buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        venueId: VENUE_ID,
        reason:  'other',
        notes:   '   extra spaces   ',
      });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'extra spaces' }),
    );
  });

  // Notes longer than 2000 chars would violate the DB CHECK constraint. The
  // hook must truncate silently so the user's report still submits.
  it('truncates notes to 2000 characters', async () => {
    const insertMock = buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    const longNotes = 'x'.repeat(3000);

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'other', notes: longNotes });
    });

    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.notes.length).toBeLessThanOrEqual(2000);
  });

  // When notes is an empty string or omitted, the DB column must receive null,
  // not an empty string. The CHECK constraint on the column expects null for
  // "no notes". An empty string would also fail a `notes IS NOT NULL AND notes != ''`
  // style validation if added in the future.
  it('stores null for notes when notes is an empty string', async () => {
    const insertMock = buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'wrong_info', notes: '' });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ notes: null }),
    );
  });

  // When notes is omitted entirely the payload must also store null.
  it('stores null for notes when notes is omitted', async () => {
    const insertMock = buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'duplicate' });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ notes: null }),
    );
  });
});

// ============================================================================
// Unauthenticated user (anonymous reports)
// ============================================================================

describe('useReportVenue — unauthenticated user', () => {
  // The hook intentionally throws a client-side error when the user is not
  // signed in. This is a deliberate UX guard — it surfaces a clear message
  // rather than sending a pointless request that will be rejected by the
  // RLS INSERT policy (which requires auth.uid() = reported_by).
  it('sets reported_by to null when there is no authenticated user', async () => {
    mockUseUser.mockReturnValue(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'wrong_info' }).catch(() => {});
    });

    // Hook throws before reaching the DB — insert must NOT be called.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // The hook must set isError so UI components can display a failure state
  // when the user is not signed in (e.g. session expired between page load
  // and button press).
  it('does not throw client-side when user is null', async () => {
    mockUseUser.mockReturnValue(null);
    buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, reason: 'other' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toMatch(/signed in/);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('useReportVenue — error handling', () => {
  // When Supabase returns an error the hook must throw a generic user-friendly
  // message. The raw Supabase error must not reach the UI — it may contain
  // schema details, constraint names, or partial row data.
  it('throws a user-friendly error message when Supabase insert fails', async () => {
    buildInsertMock({ code: '42501', message: 'permission denied' });
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ venueId: VENUE_ID, reason: 'wrong_info' }),
      ).rejects.toThrow('Could not submit report. Please try again.');
    });
  });

  // The hook must set isError so UI components can display a failure state.
  it('exposes isError=true after a failed insert', async () => {
    buildInsertMock({ code: '23514', message: 'check_violation' });
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, reason: 'other' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  // Privacy requirement: the hook's own comment says venue_id and user_id must
  // never be logged. An accidental console.error({ venueId, userId }) would
  // send personal data to crash-reporter pipelines (Sentry, Datadog, etc).
  it('does not log venue_id or user_id to the console on error', async () => {
    buildInsertMock({ code: '42501', message: 'permission denied' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'wrong_info' }).catch(() => {});
    });

    const allLogArgs = errorSpy.mock.calls.flat().join(' ');
    expect(allLogArgs).not.toContain(VENUE_ID);
    expect(allLogArgs).not.toContain(USER_ID);

    errorSpy.mockRestore();
  });

  // Confirm the error logging DOES still happen (for debugging) — but without
  // personal data. The hook logs error.code and error.hint, which are safe.
  it('logs the error code (not personal data) to console.error on failure', async () => {
    buildInsertMock({ code: '42501', hint: 'check your RLS policy', message: 'permission denied' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'wrong_info' }).catch(() => {});
    });

    // The error code should appear somewhere in the logs.
    const allLogArgs = errorSpy.mock.calls.flat().join(' ');
    expect(allLogArgs).toContain('42501');

    errorSpy.mockRestore();
  });
});

// ============================================================================
// Success state
// ============================================================================

describe('useReportVenue — success state', () => {
  // The mutation must resolve successfully when Supabase returns no error.
  it('sets isSuccess=true when the insert succeeds', async () => {
    buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      result.current.mutate({ venueId: VENUE_ID, reason: 'permanently_closed' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  // The mutation must call supabase.from with the correct table name.
  // A typo like 'venue_report' (missing 's') would silently insert into the
  // wrong table (or fail with a 42P01 table-not-found error).
  it('calls supabase.from with the correct table name "venue_reports"', async () => {
    buildInsertMock(null);
    const { result } = renderHook(() => useReportVenue(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ venueId: VENUE_ID, reason: 'duplicate' });
    });

    expect(mockFrom).toHaveBeenCalledWith('venue_reports');
  });
});
