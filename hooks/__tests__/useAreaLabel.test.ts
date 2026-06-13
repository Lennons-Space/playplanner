/**
 * Privacy + behaviour tests for useAreaLabel (hooks/location/useAreaLabel.ts).
 *
 * Guarantees:
 *   - Never REQUESTS permission (only checks it) — no prompt on app load.
 *   - Does nothing unless app-level location consent is 'granted'.
 *   - Reverse-geocodes the last-known position to a locality NAME only.
 *   - Falls back through the place hierarchy and to null when unavailable.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useAreaLabel } from '@/hooks/location/useAreaLabel';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(), // must NEVER be called
}));

const mockConsent = jest.fn();
jest.mock('@/hooks/useLocationConsent', () => ({
  useLocationConsent: () => mockConsent(),
}));

const L = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  jest.clearAllMocks();
  mockConsent.mockReturnValue({ status: 'granted' });
  (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: 51.45, longitude: -2.58 },
  });
  (L.reverseGeocodeAsync as jest.Mock).mockResolvedValue([{ city: 'Bristol' }]);
});

describe('useAreaLabel', () => {
  it('returns the reverse-geocoded city when consent + permission are granted', async () => {
    const { result } = renderHook(() => useAreaLabel());
    await waitFor(() => expect(result.current).toBe('Bristol'));
  });

  it('never requests permission — only checks it', async () => {
    renderHook(() => useAreaLabel());
    await waitFor(() => expect(L.getForegroundPermissionsAsync).toHaveBeenCalled());
    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not touch location when app consent is not granted', async () => {
    mockConsent.mockReturnValue({ status: 'undecided' });
    const { result } = renderHook(() => useAreaLabel());
    await waitFor(() => expect(result.current).toBeNull());
    expect(L.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns null when OS permission is not already granted', async () => {
    (L.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const { result } = renderHook(() => useAreaLabel());
    await waitFor(() => expect(L.getForegroundPermissionsAsync).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(L.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('falls back to district when there is no city', async () => {
    (L.reverseGeocodeAsync as jest.Mock).mockResolvedValue([{ city: null, district: 'Clifton' }]);
    const { result } = renderHook(() => useAreaLabel());
    await waitFor(() => expect(result.current).toBe('Clifton'));
  });

  it('never shows a county (subregion/region are ignored)', async () => {
    // Rural fix that only resolves to a county must NOT display it.
    (L.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
      { city: null, district: null, subregion: 'Shropshire', region: 'England' },
    ]);
    const { result } = renderHook(() => useAreaLabel());
    await waitFor(() => expect(L.reverseGeocodeAsync).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('returns null when there is no last-known position', async () => {
    (L.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    const { result } = renderHook(() => useAreaLabel());
    await waitFor(() => expect(L.getLastKnownPositionAsync).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(L.reverseGeocodeAsync).not.toHaveBeenCalled();
  });
});
