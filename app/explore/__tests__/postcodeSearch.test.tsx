/**
 * Postcode search feature tests for app/explore/map.tsx — MapScreen.
 *
 * What this file tests:
 *   1. Valid postcode → Edge Function returns coords → animateToRegion called
 *   2. Error classification, one test per category (see lib/postcode.ts):
 *        - INVALID              → "Enter a valid UK postcode."
 *        - NOT_FOUND             → "Postcode not found. Please check and try again."
 *        - SERVICE_UNAVAILABLE   → "Postcode lookup is temporarily unavailable. Please try again."
 *      covering: genuine remote not-found, the gateway 404 (function not
 *      deployed), a non-404 HTTP error, a network failure, and a malformed
 *      2xx response — never collapsed into a single "not found" message.
 *   3. Clear button (x) clears the input without triggering geocode
 *   4. Error message auto-clears after 3-second timeout (fake timers)
 *   5. Geocoding in list mode updates mapCenter but does NOT call animateToRegion
 *
 * ARCHITECTURE NOTE (updated — was previously a single-null architecture):
 * MapScreen's geocoding now goes through the shared `lookupPostcode()` in
 * lib/postcode.ts, which itself calls
 * supabase.functions.invoke('geocode-postcode', ...) and returns a
 * discriminated PostcodeLookupResult (`{ ok: true, ... }` or
 * `{ ok: false, reason }`) instead of a bare nullable. This means a service
 * failure (Edge Function not deployed, network error, 5xx, ...) can never be
 * misreported to the user as "your postcode is wrong" — each reason renders
 * its own honest, distinct message. Map search passes
 * `{ allowPartial: true }` so outward/area codes ("SY13", "M1") still work,
 * preserving the Edge Function's autocomplete strategy for partial input.
 *
 * mapRef is internal to MapScreen — we cannot access it directly in tests.
 * We observe animateToRegion via the mock on ClusterMapView's ref, which is
 * captured by a jest.fn() assigned to the testID'd mock component's ref prop.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { buildLocationConsentRecord } from '@/lib/locationConsentStorage';
import ExploreScreen from '../map';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// All jest.mock() calls are hoisted before imports by Jest's transform.

// authStore: ExploreScreen's default export is wrapped in RequireSession (see
// components/auth/RequireSession.tsx) — default to an authenticated, settled
// session so this file's postcode-search behaviour tests are unaffected.
// Signed-out behaviour (including proof that geocode-postcode is never
// invoked) is covered by map.authGuard.test.tsx.
jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(JSON.stringify({ userId: "user-test-id", grantedAt: "2026-01-01T00:00:00.000Z", consentVersion: "v1.0" })), // account-scoped stored consent → skip prompt
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/location', () => ({
  useLocation: jest.fn(() => ({
    coords: { latitude: 51.5, longitude: -0.1 },
    isLoading: false,
    error: null,
  })),
}));

jest.mock('@/hooks/useVenues', () => ({
  useNearbyVenues: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useCategories: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
}));

jest.mock('@/store/filterStore', () => ({
  useFilterStore: jest.fn((selector) => {
    const state = {
      filters: {
        categoryIds: [],
        facilityIds: [],
        minAge: null,
        maxAge: null,
        priceRange: [],
        maxDistanceKm: 32,
        openNow: false,
        premiumOnly: false,
      },
      activeFilterCount: () => 0,
    };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: 'View',
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ClusterMapView: capture the ref so we can assert on animateToRegion.
// We expose a testID so we can verify map presence/absence in list-mode tests.
let capturedMapRef: React.MutableRefObject<{ animateToRegion: jest.Mock } | null> | null = null;
const mockAnimateToRegion = jest.fn();

jest.mock('react-native-map-clustering', () => {
  const React = require('react');
  const { View } = require('react-native');
  return React.forwardRef(
    (
      { children }: { children?: React.ReactNode },
      ref: React.MutableRefObject<{ animateToRegion: jest.Mock }>
    ) => {
      // Expose the mock method via the forwarded ref so MapScreen's
      // mapRef.current?.animateToRegion(...) calls are trackable.
      React.useImperativeHandle(ref, () => ({
        animateToRegion: mockAnimateToRegion,
      }));
      capturedMapRef = ref;
      return React.createElement(View, { testID: 'cluster-map-view' }, children);
    }
  );
});

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  return {
    Marker: ({ children }: { children?: React.ReactNode }) =>
      <View testID="map-marker">{children}</View>,
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('@/components/filters/FilterSheet', () => {
  const { View } = require('react-native');
  return function MockFilterSheet() {
    return <View testID="filter-sheet" />;
  };
});

jest.mock('@/services/consent/locationConsent', () => ({
  recordLocationConsentGranted: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentWithdrawn: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentDenied: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  // See map.test.tsx for why this no-op mock is sufficient here.
  useFocusEffect: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('@/components/ui/SkeletonLoader', () => {
  const { View } = require('react-native');
  return {
    VenueRowSkeleton: () => <View testID="venue-row-skeleton" />,
  };
});

// lib/supabase: ExploreScreen imports supabase directly for geocodePostcode.
// Without this mock the module evaluates and throws "Missing Supabase env vars"
// before process.env assignments run. The mock also provides functions.invoke
// so per-test scenarios can configure it with mockResolvedValueOnce.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

// mapStore: provides pendingPostcode / setPendingPostcode consumed by MapScreen.
jest.mock('@/store/mapStore', () => ({
  useMapStore: jest.fn(() => ({
    pendingPostcode: null,
    setPendingPostcode: jest.fn(),
  })),
}));

// MapScreen (rendered via ExploreScreen below) calls useWeather() directly.
// Without this mock every render fires a REAL fetch to api.open-meteo.com;
// useWeather's own 5s AbortController + retry:1 means the app-level code
// always resolves to null and every test here still passes, but the
// underlying TLS socket Node opened for that real connection attempt isn't
// reliably torn down by the abort in this sandboxed environment — Jest
// reports it as a leaked TLSWRAP handle and hangs well past test completion.
// Same mock shape as map.test.tsx / map.v2.test.tsx.
jest.mock('@/hooks/useWeather', () => ({
  useWeather: jest.fn(() => null),
}));

// ─── Typed helper ─────────────────────────────────────────────────────────────
const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

/** Drives RequireSession to its authenticated, settled-loading branch. */
function mockAuthenticatedSession() {
  mockUseAuthStore.mockImplementation((selector) =>
    selector({
      session: { access_token: 'tok', user: { id: 'user-test-id' } },
      // PP-018: hooks/useLocationConsent.ts scopes consent by `user.id`.
      user: { id: 'user-test-id' },
      isLoading: false,
    } as unknown as AuthStoreState),
  );
}

// ─── Response shape helpers ───────────────────────────────────────────────────

/** Successful geocode: Edge Function returns coordinates. */
function makeSuccessResponse(lat: number, lng: number) {
  return { data: { latitude: lat, longitude: lng, city: 'London' }, error: null };
}

/** Genuine remote not-found: our function's own 404 body. → NOT_FOUND */
function makeGenuineNotFoundResponse() {
  return {
    data: null,
    error: new FunctionsHttpError({ status: 404, json: async () => ({ error: 'Postcode not found' }) }),
  };
}

/** Gateway 404: the Edge Function itself is not deployed. → SERVICE_UNAVAILABLE */
function makeGatewayNotFoundResponse() {
  return {
    data: null,
    error: new FunctionsHttpError({
      status: 404,
      json: async () => ({ code: 'NOT_FOUND', message: 'Requested function was not found' }),
    }),
  };
}

/** A non-404 HTTP error from the Edge Function (e.g. an upstream 5xx surfaced as 502). → SERVICE_UNAVAILABLE */
function makeServiceErrorResponse(status = 500) {
  return {
    data: null,
    error: new FunctionsHttpError({ status, json: async () => ({ error: 'Internal error' }) }),
  };
}

/** Edge Function returns data but without valid coordinates. → SERVICE_UNAVAILABLE */
function makeMalformedResponse() {
  return { data: { message: 'unexpected shape' }, error: null };
}

// ─── Wrapper / render helpers ─────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/**
 * Render ExploreScreen with stored consent (skips the consent prompt), switch
 * to list mode so the postcode search bar is visible, and wait for the component
 * to settle.
 *
 * WHY list mode: The postcode search bar ("Search by postcode…") is only rendered
 * in list mode. In map mode the screen shows a sand-background feed with the
 * search bar navigating to the Search tab instead. All postcode geocoding tests
 * must run in list mode where the bar is present and interactive.
 *
 * After waiting we reset mockAnimateToRegion so that the initial liveCoords
 * effect (which pans the map to the GPS fix on mount) does not pollute
 * assertions about postcode-triggered calls.
 */
async function renderExplore() {
  const utils = render(<ExploreScreen />, { wrapper: makeWrapper() });
  // Wait for the SecureStore check to complete and the toggle pill to appear.
  await waitFor(() => {
    expect(utils.getByLabelText('Map view')).toBeTruthy();
  });

  // Switch to list mode so the postcode search bar is rendered.
  // In map mode the screen shows a feed layout; the search input is only
  // visible in list mode (rendered absolutely above the venue list).
  await act(async () => {
    fireEvent.press(utils.getByLabelText('List view'));
  });

  // Wait for the postcode input to appear before returning.
  await waitFor(() => {
    expect(utils.getByPlaceholderText('Search by postcode…')).toBeTruthy();
  });

  // Reset after mount-time animateToRegion from the liveCoords useEffect.
  mockAnimateToRegion.mockClear();
  return utils;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticatedSession();
  mockAnimateToRegion.mockClear();
  capturedMapRef = null;
  // Default: invoke returns a successful geocode for SW1A 1AA.
  // Individual tests override this with mockResolvedValueOnce as needed.
  mockInvoke.mockResolvedValue(makeSuccessResponse(51.501, -0.1419));
});

afterEach(() => {
  jest.useRealTimers();
});

// =============================================================================
// 1. Valid postcode → geocode called, input cleared, no error shown
// =============================================================================
describe('Postcode search — valid full postcode', () => {
  it('calls the Edge Function, clears the input, and shows no error when a valid postcode is submitted', async () => {
    // Tests run in list mode (see renderExplore). In list mode the map component
    // is NOT mounted, so animateToRegion is never called. The correct assertions
    // are: (a) invoke was called with the sanitised postcode, (b) input is cleared.
    mockInvoke.mockResolvedValueOnce(makeSuccessResponse(51.501, -0.1419));

    const { getByPlaceholderText, queryByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    // The Edge Function must have been called with the sanitised postcode.
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'geocode-postcode',
        expect.objectContaining({ body: { postcode: 'SW1A1AA' } }),
      );
    });

    // Input should be cleared after a successful geocode.
    expect(input.props.value).toBe('');

    // No error message should be visible.
    expect(queryByText(/Postcode not found/)).toBeNull();
  });

  it('strips spaces and uppercases the postcode before sending to the Edge Function', async () => {
    mockInvoke.mockResolvedValueOnce(makeSuccessResponse(53.4808, -2.2426));

    const { getByPlaceholderText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'm1 1ae'); // lowercase, space
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'geocode-postcode',
        expect.objectContaining({ body: { postcode: 'M11AE' } }),
      );
    });
  });
});

// =============================================================================
// 2. Error classification — one test per category. Never blame the user's
//    postcode for a service failure: each reason renders its own distinct,
//    honest message (see lib/postcode.ts POSTCODE_ERROR_MESSAGES).
// =============================================================================
describe('Postcode search — error classification', () => {
  it('INVALID: a malformed postcode never reaches the network', async () => {
    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'NOTAPOSTCODE');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Enter a valid UK postcode.')).toBeTruthy();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('NOT_FOUND: the function\'s own 404 body ({"error":"Postcode not found"}) shows the not-found message', async () => {
    mockInvoke.mockResolvedValueOnce(makeGenuineNotFoundResponse() as any);

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99 9ZZ');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode not found. Please check and try again.')).toBeTruthy();
    });

    // animateToRegion must NOT have been called.
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
    // Input should remain populated so the user can correct it.
    expect(input.props.value).toBe('ZZ99 9ZZ');
  });

  it('SERVICE_UNAVAILABLE: a gateway 404 ({"code":"NOT_FOUND",...}, function not deployed) is never shown as a bad postcode', async () => {
    mockInvoke.mockResolvedValueOnce(makeGatewayNotFoundResponse() as any);

    const { getByPlaceholderText, getByText, queryByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    // A genuinely valid, real postcode — proves the message is about the
    // service, not the postcode.
    fireEvent.changeText(input, 'SY13 1NX');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });
    expect(queryByText(/Postcode not found/)).toBeNull();
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('SERVICE_UNAVAILABLE: a non-404 HTTP error (e.g. 5xx) shows the service-unavailable message', async () => {
    mockInvoke.mockResolvedValueOnce(makeServiceErrorResponse(500) as any);

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });
  });

  it('SERVICE_UNAVAILABLE: a network failure (invoke rejects) shows the service-unavailable message, not "not found"', async () => {
    mockInvoke.mockRejectedValueOnce(new FunctionsFetchError(new TypeError('Network request failed')));

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });

    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('SERVICE_UNAVAILABLE: a malformed 2xx response (missing coordinates) is never shown as a bad postcode', async () => {
    mockInvoke.mockResolvedValueOnce(makeMalformedResponse() as any);

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });

    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('SERVICE_UNAVAILABLE: null data with no error shows the service-unavailable message', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null } as any);

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });
  });
});

// =============================================================================
// 3. Clear button clears input without triggering geocode
// =============================================================================
describe('Postcode search — clear button', () => {
  it('clears the input and hides the clear button when the clear button is pressed', async () => {
    // Ensure invoke is never called — the clear button must not geocode.
    mockInvoke.mockClear();

    const { getByPlaceholderText, getByLabelText, queryByLabelText } =
      await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');

    // Type something to make the clear button appear.
    fireEvent.changeText(input, 'SW1A');

    // Clear button should be visible.
    const clearButton = getByLabelText('Clear postcode search');
    expect(clearButton).toBeTruthy();

    // Press the clear button.
    await act(async () => {
      fireEvent.press(clearButton);
    });

    // Input must be empty.
    expect(input.props.value).toBe('');

    // Clear button must be gone (no text in input → button not rendered).
    await waitFor(() => {
      expect(queryByLabelText('Clear postcode search')).toBeNull();
    });

    // invoke must never have been called.
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('clears any existing error message when the clear button is pressed', async () => {
    // Produce an error state first (genuine remote not-found — a real
    // postcode-format input, ZZ99 is not a real UK postcode).
    mockInvoke.mockResolvedValueOnce(makeGenuineNotFoundResponse());

    const { getByPlaceholderText, getByLabelText, getByText, queryByText } =
      await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99 9ZZ');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    // Confirm error appeared.
    await waitFor(() => {
      expect(getByText('Postcode not found. Please check and try again.')).toBeTruthy();
    });

    // Type something new so the clear button appears.
    fireEvent.changeText(input, 'S');
    const clearButton = getByLabelText('Clear postcode search');

    await act(async () => {
      fireEvent.press(clearButton);
    });

    // Error must be cleared immediately.
    await waitFor(() => {
      expect(queryByText(/Postcode not found/)).toBeNull();
    });
  });
});

// =============================================================================
// 4. Error message auto-clears after 3-second timeout
// =============================================================================
describe('Postcode search — error auto-clear', () => {
  it('clears the error message after 3 seconds', async () => {
    jest.useFakeTimers();

    mockInvoke.mockResolvedValueOnce(makeGenuineNotFoundResponse());

    const { getByPlaceholderText, getByText, queryByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99 9ZZ');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    // Confirm error appeared.
    await waitFor(() => {
      expect(getByText('Postcode not found. Please check and try again.')).toBeTruthy();
    });

    // Advance timers past the 3-second timeout.
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });

    // Error must be gone.
    await waitFor(() => {
      expect(queryByText(/Postcode not found/)).toBeNull();
    });
  });

  it('does NOT clear the error before the 3-second timeout elapses', async () => {
    jest.useFakeTimers();

    mockInvoke.mockResolvedValueOnce(makeGenuineNotFoundResponse());

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99 9ZZ');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText('Postcode not found. Please check and try again.')).toBeTruthy();
    });

    // Advance only 2 seconds — error should still be visible.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(getByText('Postcode not found. Please check and try again.')).toBeTruthy();
  });
});

// =============================================================================
// 5. Geocoding in list mode updates mapCenter but does NOT call animateToRegion
// =============================================================================
describe('Postcode search — list mode behaviour', () => {
  it('does NOT call animateToRegion when geocoding in list mode (map is unmounted)', async () => {
    mockInvoke.mockResolvedValueOnce(makeSuccessResponse(51.501, -0.1419));

    const { getByPlaceholderText, getByLabelText, queryByTestId } = await renderExplore();

    // Switch to list mode — ClusterMapView unmounts.
    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });
    await waitFor(() => {
      expect(queryByTestId('cluster-map-view')).toBeNull();
    });

    // The postcode search bar is still rendered in list mode.
    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    // Allow async geocoding to complete.
    await waitFor(() => {
      // Input is cleared on success.
      expect(input.props.value).toBe('');
    });

    // animateToRegion must NOT have been called — the map is not mounted.
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('still shows the postcode search bar in list mode', async () => {
    const { getByLabelText, getByPlaceholderText } = await renderExplore();

    await act(async () => {
      fireEvent.press(getByLabelText('List view'));
    });

    await waitFor(() => {
      expect(getByPlaceholderText('Search by postcode…')).toBeTruthy();
    });
  });
});
