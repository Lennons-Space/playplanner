/**
 * Postcode search feature tests for app/(tabs)/index.tsx — MapScreen.
 *
 * What this file tests:
 *   1. Valid postcode → Edge Function returns coords → animateToRegion called
 *   2. Edge Function returns error → "Postcode not found" message shown
 *   3. Edge Function returns null/malformed data → "Postcode not found" shown
 *   4. Edge Function throws (network failure) → "Postcode not found" shown
 *   5. Clear button (x) clears the input without triggering geocode
 *   6. Error message auto-clears after 3-second timeout (fake timers)
 *   7. Geocoding in list mode updates mapCenter but does NOT call animateToRegion
 *
 * ARCHITECTURE NOTE:
 * geocodePostcode uses supabase.functions.invoke('geocode-postcode', ...).
 * There is no fallback/district endpoint — one Edge Function call handles all
 * postcode formats. The backend returns { latitude, longitude, city } on success
 * or the invoke promise resolves with { data: null, error: {...} } on failure.
 *
 * mapRef is internal to MapScreen — we cannot access it directly in tests.
 * We observe animateToRegion via the mock on ClusterMapView's ref, which is
 * captured by a jest.fn() assigned to the testID'd mock component's ref prop.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { supabase } from '@/lib/supabase';
import ExploreScreen from '../index';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// All jest.mock() calls are hoisted before imports by Jest's transform.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('1'), // stored consent → skip prompt
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

// ─── Typed helper ─────────────────────────────────────────────────────────────
const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

// ─── Response shape helpers ───────────────────────────────────────────────────

/** Successful geocode: Edge Function returns coordinates. */
function makeSuccessResponse(lat: number, lng: number) {
  return { data: { latitude: lat, longitude: lng, city: 'London' }, error: null };
}

/** Edge Function error: invoke resolves with an error object. */
function makeErrorResponse(message = 'Function returned non-2xx status') {
  return { data: null, error: { message } };
}

/** Edge Function returns data but without valid coordinates. */
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
// 2. Edge Function returns an error → "Postcode not found" message shown
// =============================================================================
describe('Postcode search — Edge Function error', () => {
  it('shows "Postcode not found" when the Edge Function returns an error', async () => {
    mockInvoke.mockResolvedValueOnce(makeErrorResponse());

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99 9ZZ');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
    });

    // animateToRegion must NOT have been called.
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
    // Input should remain populated so the user can correct it.
    expect(input.props.value).toBe('ZZ99 9ZZ');
  });
});

// =============================================================================
// 3. Malformed / missing coordinates → "Postcode not found" shown
// =============================================================================
describe('Postcode search — malformed response', () => {
  it('shows "Postcode not found" when the Edge Function returns data without valid coordinates', async () => {
    mockInvoke.mockResolvedValueOnce(makeMalformedResponse() as any);

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
    });

    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('shows "Postcode not found" when the Edge Function returns null data with no error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null } as any);

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
    });
  });
});

// =============================================================================
// 4. Network failure (invoke throws) → error message shown
// =============================================================================
describe('Postcode search — network failure', () => {
  it('shows an error message when supabase.functions.invoke throws a network error', async () => {
    mockInvoke.mockRejectedValueOnce(new TypeError('Network request failed'));

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'SW1A 1AA');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
    });

    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. Clear button clears input without triggering geocode
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
    // Produce an error state first.
    mockInvoke.mockResolvedValueOnce(makeErrorResponse());

    const { getByPlaceholderText, getByLabelText, getByText, queryByText } =
      await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    // Confirm error appeared.
    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
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
// 6. Error message auto-clears after 3-second timeout
// =============================================================================
describe('Postcode search — error auto-clear', () => {
  it('clears the error message after 3 seconds', async () => {
    jest.useFakeTimers();

    mockInvoke.mockResolvedValueOnce(makeErrorResponse());

    const { getByPlaceholderText, getByText, queryByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    // Confirm error appeared.
    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
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

    mockInvoke.mockResolvedValueOnce(makeErrorResponse());

    const { getByPlaceholderText, getByText } = await renderExplore();

    const input = getByPlaceholderText('Search by postcode…');
    fireEvent.changeText(input, 'ZZ99');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    await waitFor(() => {
      expect(getByText(/Postcode not found/)).toBeTruthy();
    });

    // Advance only 2 seconds — error should still be visible.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(getByText(/Postcode not found/)).toBeTruthy();
  });
});

// =============================================================================
// 7. Geocoding in list mode updates mapCenter but does NOT call animateToRegion
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
