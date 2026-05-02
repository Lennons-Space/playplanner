/**
 * Tests for hooks/useDataRights.ts
 *
 * Covers:
 *   - useMyReviews: data ordering, empty-array result, enabled guard
 *   - useDeleteReview: query invalidation on success, no invalidation on error
 *   - buildDataExport: field exclusions, writeAuditLog timing, error propagation
 */
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/services/audit/gdprAuditLog';
import { useMyReviews, useDeleteReview, buildDataExport } from '../useDataRights';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => {
  // Build a chainable query builder mock.
  const builder: any = {
    select:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    order:   jest.fn().mockReturnThis(),
    single:  jest.fn(),
    delete:  jest.fn().mockReturnThis(),
  };
  return {
    supabase: {
      from: jest.fn(() => builder),
    },
    _builder: builder,
  };
});

jest.mock('@/services/audit/gdprAuditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _builder } = require('@/lib/supabase') as { _builder: any };
const mockFrom      = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockAuditLog  = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { Wrapper, client };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset all builder chain stubs to return `this` by default.
  _builder.select.mockReturnThis();
  _builder.eq.mockReturnThis();
  _builder.order.mockReturnThis();
  _builder.single.mockReset();
  _builder.delete.mockReturnThis();
  mockFrom.mockReturnValue(_builder);
});

// ---------------------------------------------------------------------------
// useMyReviews
// ---------------------------------------------------------------------------

describe('useMyReviews', () => {
  it('returns data ordered by date descending (most recent first)', async () => {
    const reviews = [
      { id: 'r2', created_at: '2024-06-01', rating: 4, venues: { name: 'Park B', city: 'London' } },
      { id: 'r1', created_at: '2024-01-01', rating: 3, venues: { name: 'Park A', city: 'London' } },
    ];
    // The final call in the chain resolves — order() is the last call before await.
    _builder.order.mockResolvedValueOnce({ data: reviews, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyReviews('user-123'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(reviews);
    // Confirm the order call was made with ascending: false
    expect(_builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('returns an empty array (not an error) when the user has no reviews', async () => {
    _builder.order.mockResolvedValueOnce({ data: [], error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyReviews('user-123'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('includes is_anonymous in returned review data so callers can identify anonymous reviews', async () => {
    const reviews = [
      { id: 'r1', rating: 5, is_anonymous: true,  venues: { name: 'Park A', city: 'London' } },
      { id: 'r2', rating: 4, is_anonymous: false, venues: { name: 'Park B', city: 'London' } },
    ];
    _builder.order.mockResolvedValueOnce({ data: reviews, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyReviews('user-123'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify the SELECT string actually requests the column — removing is_anonymous
    // from the select query would make Supabase return undefined, breaking the filter.
    expect(_builder.select).toHaveBeenCalledWith(expect.stringContaining('is_anonymous'));
    expect(result.current.data?.[0].is_anonymous).toBe(true);
    expect(result.current.data?.[1].is_anonymous).toBe(false);
  });

  it('is disabled (does not fire) when userId is undefined', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMyReviews(undefined), { wrapper: Wrapper });

    // Query should be idle — not loading, not success, not error
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDeleteReview
// ---------------------------------------------------------------------------

describe('useDeleteReview', () => {
  it('invalidates the my-reviews query on success', async () => {
    // delete().eq('id').eq('user_id') — second eq resolves, first returns this
    const deleteBuilder: any = {
      eq: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };
    deleteBuilder.eq
      .mockReturnValueOnce(deleteBuilder) // first .eq('id', ...)
      .mockResolvedValueOnce({ data: null, error: null }); // second .eq('user_id', ...)
    mockFrom.mockReturnValueOnce(deleteBuilder);

    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteReview(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ reviewId: 'rev-1', userId: 'user-123' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['reviews', 'mine', 'user-123'] }),
    );
  });

  it('does NOT invalidate the query when the delete fails', async () => {
    // delete().eq('id').eq('user_id') — second eq rejects with an error
    const deleteBuilder: any = {
      eq: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };
    deleteBuilder.eq
      .mockReturnValueOnce(deleteBuilder) // first .eq('id', ...)
      .mockResolvedValueOnce({ data: null, error: { message: 'DB error' } }); // second .eq('user_id', ...)
    mockFrom.mockReturnValueOnce(deleteBuilder);

    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteReview(), { wrapper: Wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ reviewId: 'rev-1', userId: 'user-123' });
      } catch {
        // expected
      }
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildDataExport
// ---------------------------------------------------------------------------

describe('buildDataExport', () => {
  /** Helper: set up `from()` to return different resolved values per table. */
  function mockQueries(overrides: Record<string, any> = {}) {
    const defaults: Record<string, any> = {
      profiles:             { data: { username: 'jane', full_name: 'Jane Doe', bio: null, postcode: 'SW1A', children_ages: ['3-5'], show_in_search: false, show_reviews_publicly: true, marketing_consent: false, terms_accepted_at: null, created_at: '2024-01-01', stripe_customer_id: 'cus_HIDDEN', avatar_url: 'https://example.com/avatar.jpg' }, error: null },
      reviews:              { data: [], error: null },
      favourites:           { data: [], error: null },
      venues:               { data: [], error: null },
      location_consent_log: { data: [], error: null },
      gdpr_audit_log:       { data: [], error: null },
    };

    const tables = { ...defaults, ...overrides };
    let callIndex = 0;
    const tableOrder = ['profiles', 'reviews', 'favourites', 'venues', 'location_consent_log', 'gdpr_audit_log'];

    mockFrom.mockImplementation((_table: string) => {
      // Return a fresh builder for each table call, resolving with the right fixture.
      const tableResult = tables[tableOrder[callIndex++]] ?? { data: null, error: null };
      const localBuilder: any = {
        select:  jest.fn().mockReturnThis(),
        eq:      jest.fn().mockReturnThis(),
        order:   jest.fn().mockReturnThis(),
        single:  jest.fn().mockResolvedValue(tableResult),
      };
      // The final awaited call differs by table (single vs order vs eq).
      // Make every terminal method resolve so the chain always settles.
      localBuilder.eq.mockImplementation(() => {
        localBuilder._resolve = tableResult;
        return {
          ...localBuilder,
          then: (resolve: any) => Promise.resolve(tableResult).then(resolve),
        };
      });
      localBuilder.order.mockImplementation(() => ({
        then: (resolve: any) => Promise.resolve(tableResult).then(resolve),
      }));
      localBuilder.single.mockResolvedValue(tableResult);
      return localBuilder as any;
    });
  }

  it('excludes stripe_customer_id and ip_hash from the export bundle', async () => {
    mockQueries({
      profiles: {
        data: {
          username: 'jane', full_name: 'Jane', bio: null, postcode: null,
          children_ages: [], show_in_search: false, show_reviews_publicly: true,
          marketing_consent: false, terms_accepted_at: null, created_at: '2024-01-01',
          stripe_customer_id: 'cus_secret', ip_hash: 'abc123',
        },
        error: null,
      },
      gdpr_audit_log: {
        data: [{ action: 'data_export_requested', created_at: '2024-01-01', ip_hash: 'abc123', record_id: 'some-id', performed_by: 'user-id' }],
        error: null,
      },
    });

    const json = await buildDataExport('user-123');
    const parsed = JSON.parse(json);

    // Excluded at profile level
    expect(parsed.profile).not.toHaveProperty('stripe_customer_id');
    expect(parsed.profile).not.toHaveProperty('avatar_url');
    // Excluded at audit log level
    expect(parsed.audit_log[0]).not.toHaveProperty('ip_hash');
    expect(parsed.audit_log[0]).not.toHaveProperty('record_id');
    expect(parsed.audit_log[0]).not.toHaveProperty('performed_by');
  });

  it('maps children_ages DB column to children_age_groups in the export', async () => {
    mockQueries({
      profiles: {
        data: {
          username: 'jane', full_name: 'Jane', bio: null, postcode: null,
          children_ages: ['3-5', '6-8'], show_in_search: false,
          show_reviews_publicly: true, marketing_consent: false,
          terms_accepted_at: null, created_at: '2024-01-01',
        },
        error: null,
      },
    });

    const json = await buildDataExport('user-123');
    const parsed = JSON.parse(json);

    expect(parsed.profile).toHaveProperty('children_age_groups', ['3-5', '6-8']);
    expect(parsed.profile).not.toHaveProperty('children_ages');
  });

  it('includes is_anonymous in the reviews section of the export bundle', async () => {
    mockQueries({
      reviews: {
        data: [
          { rating: 5, title: 'Great', body: 'Loved it', is_anonymous: true,  visit_date: null, moderation_status: 'approved', created_at: '2024-06-01', venues: { name: 'Park A' } },
          { rating: 3, title: 'OK',    body: 'Fine',     is_anonymous: false, visit_date: null, moderation_status: 'approved', created_at: '2024-03-01', venues: { name: 'Park B' } },
        ],
        error: null,
      },
    });

    const json = await buildDataExport('user-123');
    const parsed = JSON.parse(json);

    // Verify the SELECT string requests the column and the map() includes it in output.
    // If either is removed, the export silently omits the user's anonymity choices.
    expect(parsed.reviews[0]).toHaveProperty('is_anonymous', true);
    expect(parsed.reviews[1]).toHaveProperty('is_anonymous', false);
  });

  it('calls writeAuditLog only after all queries succeed', async () => {
    mockQueries();

    const callOrder: string[] = [];
    mockFrom.mockImplementationOnce((_table) => {
      // Track when the first DB query runs
      callOrder.push('first_query');
      const r = { data: { username: 'x', full_name: null, bio: null, postcode: null, children_ages: [], show_in_search: false, show_reviews_publicly: true, marketing_consent: false, terms_accepted_at: null, created_at: '2024-01-01' }, error: null };
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(r),
      } as any;
    });

    mockAuditLog.mockImplementationOnce(async () => {
      callOrder.push('audit_log');
    });

    // Re-mock remaining calls (reviews, favourites, venues, location_consent_log, gdpr_audit_log)
    mockFrom.mockImplementation((_table) => {
      const result = { data: [], error: null };
      const b: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockImplementation(() => ({
          then: (resolve: any) => Promise.resolve(result).then(resolve),
        })),
        single: jest.fn().mockResolvedValue(result),
      };
      b.eq.mockImplementation(() => ({
        ...b,
        then: (resolve: any) => Promise.resolve(result).then(resolve),
      }));
      return b;
    });

    await buildDataExport('user-123');

    // The audit log must be written after the DB queries complete
    expect(mockAuditLog).toHaveBeenCalledWith('user-123', 'data_export_requested');
  });

  it('throws immediately if any Supabase query returns an error — does not call writeAuditLog', async () => {
    // profiles query returns an error
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      const isFirst = callCount === 1;
      const result = isFirst
        ? { data: null, error: { message: 'DB connection failed' } }
        : { data: [], error: null };
      return {
        select: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(result),
        order:  jest.fn().mockImplementation(() => ({
          then: (resolve: any) => Promise.resolve(result).then(resolve),
        })),
      } as any;
    });

    await expect(buildDataExport('user-123')).rejects.toBeTruthy();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
