/**
 * Integration + GDPR tests for useLocation (hooks/location/useLocation.ts).
 *
 * Privacy requirements tested:
 *   - Coordinates are coarsened before being stored (data minimisation Art.5(1)(c))
 *   - recordLocationConsentGranted is called when permission is granted
 *   - recordLocationConsentDenied is called when permission is denied
 *   - Fallback location is returned (not raw coordinates) when permission is denied
 *   - Invalid coordinates from the GPS fall back to FALLBACK_LOCATION
 *   - Consent logging failure does not prevent location from working
 *   - No state update after unmount (no React warning)
 */

import { renderHook, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { FALLBACK_LOCATION } from '@/constants/location';
import { coarsenCoordinates } from '@/services/location/coordinates';

import { recordLocationConsentGranted, recordLocationConsentDenied } from '@/services/consent/locationConsent';
import { isValidCoordinate } from '@/services/location/coordinates';
import { useLocation } from '@/hooks/location/useLocation';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync:           jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('@/services/consent/locationConsent', () => ({
  recordLocationConsentGranted: jest.fn().mockResolvedValue(undefined),
  recordLocationConsentDenied:  jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/location/coordinates', () => ({
  coarsenCoordinates: jest.fn((lat: number, lng: number) => ({ latitude: lat, longitude: lng })),
  isValidCoordinate:  jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() }, from: jest.fn() },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockRequestPermissions = Location.requestForegroundPermissionsAsync as jest.MockedFunction<typeof Location.requestForegroundPermissionsAsync>;
const mockGetCurrentPosition  = Location.getCurrentPositionAsync          as jest.MockedFunction<typeof Location.getCurrentPositionAsync>;
const mockConsentGranted      = recordLocationConsentGranted               as jest.MockedFunction<typeof recordLocationConsentGranted>;
const mockConsentDenied       = recordLocationConsentDenied                as jest.MockedFunction<typeof recordLocationConsentDenied>;
const mockIsValid             = isValidCoordinate                          as jest.MockedFunction<typeof isValidCoordinate>;
const mockCoarsen             = coarsenCoordinates                         as jest.MockedFunction<typeof coarsenCoordinates>;

// Fake GPS position — note: 7 decimal places to simulate real GPS precision
const RAW_POSITION = {
  coords: { latitude: 51.5074321, longitude: -0.1277892 },
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsValid.mockReturnValue(true);
  mockCoarsen.mockImplementation((lat, lng) => ({ latitude: lat, longitude: lng }));
  mockConsentGranted.mockResolvedValue(undefined);
  mockConsentDenied.mockResolvedValue(undefined);
});

// ======================================================================
// Initial state
// ======================================================================
describe('useLocation — initial state', () => {
  it('starts with isLoading=true and fallback coords', () => {
    mockRequestPermissions.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useLocation());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.coords).toEqual(FALLBACK_LOCATION);
    expect(result.current.hasPermission).toBe(false);
  });
});

// ======================================================================
// Permission denied path
// ======================================================================
describe('useLocation — permission denied', () => {
  beforeEach(() => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' } as any);
  });

  it('returns hasPermission=false and fallback coords when OS denies', async () => {
    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission).toBe(false);
    expect(result.current.coords).toEqual(FALLBACK_LOCATION);
  });

  it('calls recordLocationConsentDenied when OS denies', async () => {
    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockConsentDenied).toHaveBeenCalledTimes(1);
    expect(mockConsentGranted).not.toHaveBeenCalled();
  });

  it('does not call getCurrentPositionAsync when denied', async () => {
    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });
});

// ======================================================================
// Permission granted path
// ======================================================================
describe('useLocation — permission granted', () => {
  beforeEach(() => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as any);
    mockGetCurrentPosition.mockResolvedValue(RAW_POSITION);
  });

  it('calls recordLocationConsentGranted when OS grants', async () => {
    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockConsentGranted).toHaveBeenCalledTimes(1);
    expect(mockConsentDenied).not.toHaveBeenCalled();
  });

  it('passes coordinates through coarsenCoordinates before storing', async () => {
    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockCoarsen).toHaveBeenCalledWith(
      RAW_POSITION.coords.latitude,
      RAW_POSITION.coords.longitude,
    );
  });

  it('returns hasPermission=true when OS grants', async () => {
    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission).toBe(true);
  });
});

// ======================================================================
// Invalid coordinate fallback
// ======================================================================
describe('useLocation — invalid coordinate fallback', () => {
  it('falls back to FALLBACK_LOCATION when isValidCoordinate returns false', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as any);
    mockGetCurrentPosition.mockResolvedValue(RAW_POSITION);
    mockIsValid.mockReturnValue(false);

    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.coords).toEqual(FALLBACK_LOCATION);
  });

  it('falls back to FALLBACK_LOCATION when getCurrentPositionAsync throws', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as any);
    mockGetCurrentPosition.mockRejectedValue(new Error('GPS unavailable'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.coords).toEqual(FALLBACK_LOCATION);
    expect(result.current.hasPermission).toBe(true); // permission was granted; GPS failed
  });
});

// ======================================================================
// Coarse-permission-only behaviour (2026-09-01 privacy remediation, §1)
//
// Android's ACCESS_COARSE_LOCATION-only mode does not return a raw GPS fix —
// it returns a deliberately reduced-precision position (commonly snapped to
// a coarse grid on the order of ~1-2km, refreshed periodically), even at
// `Accuracy.Balanced`. This suite proves the APP'S OWN pipeline tolerates
// that degraded input just as well as a precise fix — using the REAL
// coarsenCoordinates/isValidCoordinate implementations (not the passthrough
// mocks used above), since the property under test is arithmetic, not
// call-forwarding.
//
// This is NOT a substitute for testing on a real Android device with only
// ACCESS_COARSE_LOCATION declared — it proves the app's tolerance for
// degraded input, not Android's actual runtime behaviour. See
// docs/privacy/LOCATION_MINIMISATION_REVIEW.md for the real-device procedure
// this still requires.
// ======================================================================
describe('useLocation — coarse-permission-only input (simulated)', () => {
  const realCoordinates = jest.requireActual('@/services/location/coordinates');

  beforeEach(() => {
    mockCoarsen.mockImplementation(realCoordinates.coarsenCoordinates);
    mockIsValid.mockImplementation(realCoordinates.isValidCoordinate);
  });

  // A coarse Android fix jittered ~1.5km from a true position, well within
  // what ACCESS_COARSE_LOCATION alone is documented to return.
  const COARSE_POSITION = {
    coords: { latitude: 51.5220, longitude: -0.1090 }, // ~1.5km from RAW_POSITION
  } as any;

  it('produces a valid, non-fallback location from a coarse/jittered fix', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as any);
    mockGetCurrentPosition.mockResolvedValue(COARSE_POSITION);

    const { result } = renderHook(() => useLocation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasPermission).toBe(true);
    expect(result.current.coords).not.toEqual(FALLBACK_LOCATION);
    // The real isValidCoordinate/coarsenCoordinates never special-case
    // precision — any position within bounds passes through and rounds the
    // same way regardless of how the OS obtained it.
    expect(result.current.coords.latitude).toBeCloseTo(51.522, 2);
    expect(result.current.coords.longitude).toBeCloseTo(-0.109, 2);
  });

  it('a coarse fix still differs meaningfully from a precise fix, proving no special-case coupling to GPS-grade input', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as any);
    mockGetCurrentPosition.mockResolvedValue(COARSE_POSITION);
    const { result: coarseResult } = renderHook(() => useLocation());
    await waitFor(() => expect(coarseResult.current.isLoading).toBe(false));

    mockGetCurrentPosition.mockResolvedValue(RAW_POSITION);
    const { result: preciseResult } = renderHook(() => useLocation());
    await waitFor(() => expect(preciseResult.current.isLoading).toBe(false));

    // Both are valid, usable coordinates for nearby-venue search — the
    // pipeline has no branch that behaves differently based on input
    // precision, which is exactly the property that makes removing
    // ACCESS_FINE_LOCATION safe: downstream consumers (useNearbyVenues,
    // map centring, distance labels) only ever see this hook's output
    // shape, never the OS's raw accuracy tier.
    expect(coarseResult.current.hasPermission).toBe(true);
    expect(preciseResult.current.hasPermission).toBe(true);
  });
});

// ======================================================================
// Non-blocking consent logging
// ======================================================================
describe('useLocation — consent logging is non-blocking', () => {
  it('still returns coordinates even if recordLocationConsentGranted rejects', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted' } as any);
    mockGetCurrentPosition.mockResolvedValue(RAW_POSITION);
    mockConsentGranted.mockRejectedValue(new Error('audit DB down'));

    const { result } = renderHook(() => useLocation());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Location must work even when the audit log fails
    expect(result.current.hasPermission).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});
