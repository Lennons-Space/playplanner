/**
 * Tests for useNearbyVenues (hooks/useVenues.ts).
 *
 * useNearbyVenues wraps a TanStack React Query useQuery that calls the
 * Supabase `get_nearby_venues` PostGIS RPC. Correctness here matters for
 * two reasons:
 *   1. User experience: wrong params return wrong (or missing) venues.
 *   2. Privacy: passing raw unrounded coordinates to the RPC could expose
 *      precise location data to the database log — callers are expected to
 *      pass already-coarsened coords (see services/location/coordinates.ts).
 *
 * We test that the hook forwards exactly the params it receives to the RPC
 * and that the query is disabled when coords are absent (preventing a
 * spurious network call with undefined lat/lng).
 */

// Must mock before any imports that transitively load lib/supabase.ts
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase }            from '@/lib/supabase';
import { useNearbyVenues }     from '../useVenues';
import type { Coordinates, VenueFilters } from '@/types';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

// Default filters used across tests — matches DEFAULT_FILTERS in types/index.ts
// but with a radius that keeps assertions readable.
const BASE_FILTERS: VenueFilters = {
  categoryIds:   [],
  facilityIds:   [],
  minAge:        null,
  maxAge:        null,
  priceRange:    [],
  maxDistanceKm: 10,
  openNow:       false,
  premiumOnly:   false,
};

const LONDON: Coordinates = { latitude: 51.507, longitude: -0.127 };

// Build a fresh QueryClient for each test so cached data from one test
// cannot leak into another and cause false passes.
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries so tests don't wait for retry back-off on failures.
        retry: false,
        // Treat all data as stale immediately so refetch behaviour is predictable.
        gcTime: 0,
      },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ======================================================================
// useNearbyVenues — RPC call shape
// ======================================================================
describe('useNearbyVenues', () => {
  // The RPC must be called with the exact parameter names that the SQL function
  // expects. A typo here (e.g. 'radius' instead of 'p_radius_km') would silently
  // return no venues and confuse users who see an empty map.
  it('calls get_nearby_venues RPC with the correct parameter names and values', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null } as any);

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, BASE_FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('get_nearby_venues', {
      lat:             LONDON.latitude,
      lng:             LONDON.longitude,
      p_radius_km:     BASE_FILTERS.maxDistanceKm,
      category_ids:    null,    // empty array → null (no filter)
      p_min_age:       null,
      p_max_age:       null,
      price_ranges:    null,    // empty array → null (no filter)
      open_now:        false,
      p_facility_ids:  null,    // empty array → null (no filter)
      p_premium_only:  false,
    });
  });

  // While the query is in-flight the hook must return an empty-ish state
  // without crashing. This prevents a TypeError on undefined data before the
  // first successful fetch.
  it('returns isLoading true and no data while the query is in flight', () => {
    // Never resolve — simulates a slow network request
    mockRpc.mockReturnValue(new Promise(() => {}) as any);

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, BASE_FILTERS),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  // The hook must forward the resolved venue array directly so callers can
  // render it without any additional transformation. Latitude/longitude must
  // arrive as real JS numbers even if the RPC serialised them as strings
  // (PostgreSQL `numeric` → string in the Supabase JS client). This is the
  // guarantee that stops "pins appear briefly then disappear" on the map.
  it('returns the venue list with numeric latitude/longitude', async () => {
    const rpcRows = [
      // As the RPC would actually return them — numeric serialised to string
      { id: 'venue-1', name: 'Soft Play Central', latitude: '51.507', longitude: '-0.127', distance_km: 1.2, has_hours: true },
      // Also accept rows that are already numeric (future-proofing for the
      // float8 migration)
      { id: 'venue-2', name: 'Park Lane', latitude: 51.508, longitude: -0.128, distance_km: 2.5, has_hours: false },
    ];
    mockRpc.mockResolvedValue({ data: rpcRows, error: null } as any);

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, BASE_FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Both rows must survive, and both must have numeric coords.
    expect(result.current.data).toHaveLength(2);
    expect(typeof result.current.data![0].latitude).toBe('number');
    expect(typeof result.current.data![0].longitude).toBe('number');
    expect(result.current.data![0].latitude).toBe(51.507);
    expect(result.current.data![0].longitude).toBe(-0.127);
    expect(result.current.data![1].latitude).toBe(51.508);
  });

  // Regression guard: rows where latitude/longitude cannot be coerced to a
  // finite number must be dropped, not passed through. A corrupt row reaching
  // react-native-maps causes the native layer to drop ALL markers silently,
  // which was the visible "pins flash then disappear" bug.
  it('drops rows with non-finite latitude or longitude', async () => {
    const rpcRows = [
      { id: 'ok',       name: 'Valid',    latitude: '51.5', longitude: '-0.1', distance_km: 1.0, has_hours: true },
      { id: 'bad-lat',  name: 'Bad lat',  latitude: null,   longitude: '-0.1', distance_km: 1.0, has_hours: true },
      { id: 'bad-lng',  name: 'Bad lng',  latitude: '51.5', longitude: 'xyz',  distance_km: 1.0, has_hours: true },
      { id: 'no-coord', name: 'No coord', distance_km: 1.0, has_hours: true },
    ];
    mockRpc.mockResolvedValue({ data: rpcRows, error: null } as any);

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, BASE_FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe('ok');
  });

  // Regression guard: if the caller passes non-finite coords (e.g. a stale
  // closure or uninitialised state), the hook must refuse to fire the RPC.
  // This stops a bogus request reaching PostGIS and causing an error response
  // that would flash empty venues on the map.
  it('does not fire the RPC when coords are non-finite', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null } as any);

    const BAD: Coordinates = { latitude: Number.NaN, longitude: -0.127 };
    renderHook(
      () => useNearbyVenues(BAD, BASE_FILTERS),
      { wrapper: makeWrapper() },
    );

    // Give React Query a tick to settle — the query must stay idle.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // Security/privacy note: useNearbyVenues does NOT currently guard against
  // null coords — it accesses coords.latitude unconditionally at queryKey
  // construction time, so passing null throws a TypeError.
  //
  // This test verifies the current behaviour (the hook is always enabled when
  // mounted with valid coords) and acts as a regression anchor. A future
  // improvement should add `enabled: !!coords` to the query options so that
  // callers do not need to guard before invoking the hook — this would prevent
  // accidental RPC calls with undefined lat/lng values reaching the database.
  //
  // WHAT THIS TEST CHECKS: with valid coords the hook fires the RPC immediately
  // (i.e. the query is enabled and not idle).
  it('fires the RPC immediately when valid coords are provided (query is enabled)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null } as any);

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, BASE_FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The RPC must have been called at least once — query was not disabled
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  // When a category filter is active, the IDs must be forwarded as an array
  // to the RPC. An empty array collapses to null (no filter), but a non-empty
  // array must be passed through so the SQL function filters by category.
  it('passes active category IDs to the RPC', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null } as any);

    const filtersWithCategory: VenueFilters = {
      ...BASE_FILTERS,
      categoryIds: ['cat-softplay', 'cat-park'],
    };

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, filtersWithCategory),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith(
      'get_nearby_venues',
      expect.objectContaining({
        category_ids: ['cat-softplay', 'cat-park'],
      }),
    );
  });

  // Price range filter: a non-empty priceRange array must be forwarded.
  // If it collapsed to null incorrectly, premium-only or budget-only searches
  // would return all venues regardless of price.
  it('passes active price range filter to the RPC', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null } as any);

    const filtersWithPrice: VenueFilters = {
      ...BASE_FILTERS,
      priceRange: ['free', 'budget'],
    };

    const { result } = renderHook(
      () => useNearbyVenues(LONDON, filtersWithPrice),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith(
      'get_nearby_venues',
      expect.objectContaining({
        price_ranges: ['free', 'budget'],
      }),
    );
  });
});

// ── VENUE_SELECT_BASE regression ───────────────────────────────────────────
// Ensures category slug is always selected so plan-visit tips and checklists
// work correctly. If someone removes slug from the select, this test breaks.
// ── VENUE_SELECT_BASE regression ───────────────────────────────────────────
// Ensures category slug is always selected so plan-visit tips and checklists
// work correctly. If someone removes slug from the select, this test breaks.
describe('VENUE_SELECT_BASE includes category slug', () => {
  it('contains slug in the category join', () => {
    // Import is already hoisted at the top of this file via jest.mock —
    // use require() to stay in CommonJS module mode (dynamic import() is
    // not supported without --experimental-vm-modules in this Jest config).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { VENUE_SELECT_BASE } = require('../useVenues');
    expect(VENUE_SELECT_BASE).toContain('slug');
  });
});
