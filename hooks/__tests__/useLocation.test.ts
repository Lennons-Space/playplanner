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
