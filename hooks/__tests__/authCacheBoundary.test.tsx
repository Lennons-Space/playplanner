/**
 * authCacheBoundary.test.tsx
 *
 * The auth identity boundary for the React Query cache.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Real-device test, 2026-08-20 (post-067): after signing out, an approved review
 * fetched while authenticated was STILL rendered on the venue-detail screen to a
 * logged-out user. Anonymous callers must currently see zero reviews.
 *
 * ROOT CAUSE, reproduced in `the leak mechanism` block below:
 * `queryClient.clear()` was already called on sign-out and is NOT sufficient on
 * its own. React Query keeps the last successful `data` on a query that
 * subsequently ERRORS. A screen still mounted at sign-out re-fetches immediately
 * after the cache is cleared; for an anonymous caller that re-fetch FAILS
 * (migrations 065/066 leave `anon` with zero privileges on `public_profiles`,
 * which the venue reviews query embeds), so the observer falls back to the
 * previous authenticated result and keeps rendering it.
 *
 * THE FIX: identity-scoped query keys (hooks/useAuthIdentity.ts). When the
 * identity changes the key changes, so the observer moves to a cache entry that
 * has never held another identity's rows.
 *
 * These tests use a REAL QueryClient configured exactly as app/_layout.tsx
 * configures it, and a mocked Supabase whose response depends on the simulated
 * session — so the leak and the fix are both demonstrated, not assumed.
 */
import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Simulated server: what the DB returns depends on who is asking.
// ---------------------------------------------------------------------------
let IDENTITY: string | null = null;

function reviewFor(userId: string) {
  return {
    id: `rev-${userId}`,
    venue_id: 'venue-grove',
    user_id: userId,
    rating: 5,
    title: null,
    body: userId === 'user-a' ? 'Beautiful little park.' : 'User B private view.',
    visit_date: null,
    is_anonymous: false,
    moderation_status: 'approved',
    helpful_count: 0,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    profile: null, // author has show_in_search = false -> "Anonymous parent"
  };
}

/** PostgREST 42501, as raised when `anon` touches public_profiles after 065/066. */
const PERMISSION_DENIED = {
  code: '42501',
  message: 'permission denied for view public_profiles',
  hint: null,
  details: null,
};

let requestCount = 0;

function mockRespond() {
  requestCount += 1;
  if (IDENTITY) return Promise.resolve({ data: [reviewFor(IDENTITY)], error: null });
  return Promise.resolve({ data: null, error: PERMISSION_DENIED });
}

const mockBuilder: any = {
  select: () => mockBuilder,
  eq: () => mockBuilder,
  order: () => mockRespond(),
};

jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => mockBuilder },
}));

// Silence the deliberate diagnostic logging from lib/dbError.
jest.spyOn(console, 'error').mockImplementation(() => {});

import { useVenueReviews } from '@/hooks/useReviews';
import { useAuthStore } from '@/store/authStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAppQueryClient() {
  // Exactly the configuration in app/_layout.tsx.
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 1000 * 60, gcTime: 1000 * 60 * 5 },
      mutations: { retry: 0 },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** Put the app into a signed-in state for `userId`. */
function signIn(userId: string) {
  IDENTITY = userId;
  useAuthStore.setState({
    user: { id: userId } as any,
    session: { user: { id: userId } } as any,
    isLoading: false,
  });
}

/** Put the app into the signed-out state, as the sign-out handler does. */
function signOut(client: QueryClient) {
  IDENTITY = null;
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
  client.clear(); // retained as defence in depth, exactly as the app does
}

beforeEach(() => {
  requestCount = 0;
  signIn('user-a');
});

afterEach(() => {
  useAuthStore.setState({ user: null, session: null, profile: null, isLoading: false });
});

// ===========================================================================
describe('venue reviews across the sign-out boundary', () => {
  it('loads the review while authenticated (control)', async () => {
    const client = makeAppQueryClient();
    const { result } = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(1);
    expect((result.current.data as any)[0].body).toBe('Beautiful little park.');
    client.clear();
  });

  it('does not even issue the request when signed out (anon sees zero reviews)', async () => {
    const client = makeAppQueryClient();
    signOut(client);
    requestCount = 0;

    const { result } = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    // The anonymous request is guaranteed to be refused by RLS, so it is not sent.
    expect(requestCount).toBe(0);
    client.clear();
  });

  it('SECURITY: a screen still mounted at sign-out stops showing the authenticated review', async () => {
    // This is the exact device repro: venue-detail stayed mounted in the
    // navigation stack while the user signed out from the Profile tab.
    const client = makeAppQueryClient();
    const { result, rerender } = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    signOut(client);
    rerender(undefined);

    await waitFor(() => expect(result.current.data).toBeUndefined());
    expect(result.current.data).toBeUndefined();
  });

  it('SECURITY: reopening the venue after sign-out surfaces nothing', async () => {
    const client = makeAppQueryClient();

    const first = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(first.result.current.data).toHaveLength(1));
    first.unmount();

    signOut(client);

    const second = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.data).toBeUndefined();
  });

  it('signing back in works and re-fetches under the new session', async () => {
    const client = makeAppQueryClient();
    const { result, rerender } = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    signOut(client);
    rerender(undefined);
    await waitFor(() => expect(result.current.data).toBeUndefined());

    signIn('user-a');
    rerender(undefined);
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect((result.current.data as any)[0].body).toBe('Beautiful little park.');
    client.clear();
  });
});

// ===========================================================================
describe('account switch safety (User A -> User B)', () => {
  it('SECURITY: User B never sees User A\'s cached authenticated result', async () => {
    const client = makeAppQueryClient();
    const { result, rerender } = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect((result.current.data as any)[0].body).toBe('Beautiful little park.');

    // A signs out, B signs in — WITHOUT any cache clear, to prove the query-key
    // scoping alone is sufficient and does not depend on clean-up being called.
    IDENTITY = null;
    useAuthStore.setState({ user: null, session: null, profile: null });
    signIn('user-b');
    rerender(undefined);

    // At no point may User A's row be observable to User B.
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect((result.current.data as any)[0].user_id).toBe('user-b');
    expect((result.current.data as any)[0].body).not.toBe('Beautiful little park.');
    client.clear();
  });

  it('SECURITY: switching back to User A does not expose User B rows', async () => {
    const client = makeAppQueryClient();
    const { result, rerender } = renderHook(() => useVenueReviews('venue-grove'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    signIn('user-b');
    rerender(undefined);
    await waitFor(() => expect((result.current.data as any)?.[0]?.user_id).toBe('user-b'));

    signIn('user-a');
    rerender(undefined);
    await waitFor(() => expect((result.current.data as any)?.[0]?.user_id).toBe('user-a'));
    client.clear();
  });
});

// ===========================================================================
describe('the leak mechanism (negative control — do not delete)', () => {
  it('an UNSCOPED key retains the previous identity result when the refetch errors', async () => {
    // This documents WHY identity-scoped keys are required rather than relying
    // on queryClient.clear(). It uses a raw useQuery with a fixed key — the
    // shape useVenueReviews had before the fix. If React Query ever stops
    // retaining data across an errored refetch, this test fails and the
    // scoping can be re-evaluated; until then it proves the fix is load-bearing.
    const client = makeAppQueryClient();
    const useUnscoped = () =>
      useQuery({
        queryKey: ['reviews-unscoped', 'venue-grove'],
        queryFn: async () => {
          const { data, error } = await (mockBuilder.select().eq().eq().order() as any);
          if (error) throw new Error('refused');
          return data;
        },
        retry: false,
      });

    const { result } = renderHook(useUnscoped, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    // Sign out, then trigger the refetch a still-mounted screen would trigger.
    IDENTITY = null;
    const requestsBefore = requestCount;
    await client.refetchQueries({ queryKey: ['reviews-unscoped', 'venue-grove'] });

    // The refetch really did run, and really was refused (IDENTITY is null).
    expect(requestCount).toBeGreaterThan(requestsBefore);

    // The authenticated row is STILL readable — this is the leak.
    expect(result.current.data).toHaveLength(1);
    expect((result.current.data as any)[0].body).toBe('Beautiful little park.');

    // AND — the part that makes a UI-level guard useless — the query still
    // reports success, because React Query only moves a query to the 'error'
    // status when it has no data to fall back on. `isError` is FALSE here.
    // So an `if (isError) hide the list` guard on the venue screen would NOT
    // have prevented the leak; only changing the cache key does.
    expect(result.current.status).toBe('success');
    expect(result.current.isError).toBe(false);
    client.clear();
  });
});
