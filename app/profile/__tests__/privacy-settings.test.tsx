/**
 * Tests for app/profile/privacy-settings.tsx
 *
 * The screen is informational and read-only. It shows:
 *   - Current OS location permission status (via getForegroundPermissionsAsync — no dialog)
 *   - A link to the data-download screen (GDPR Art.15)
 *   - A privacy note explaining data is never sold
 *
 * GDPR focus:
 *   - Screen must NOT call requestForegroundPermissionsAsync (would violate
 *     ICO Children's Code Standard 10 — geolocation off by default, consent
 *     only on explicit user action).
 *   - Location status displayed as "On" / "Off" read-only.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — must come before importing the screen under test
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

// Mock expo-location — getForegroundPermissionsAsync is the only method the screen uses.
// requestForegroundPermissionsAsync must NOT be called; its presence as a spy
// lets us assert it was never invoked (ICO Children's Code Standard 10).
const mockGetForegroundPermissionsAsync = jest.fn();
const mockRequestForegroundPermissions  = jest.fn();

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync:    mockGetForegroundPermissionsAsync,
  requestForegroundPermissionsAsync: mockRequestForegroundPermissions,
}));

// Icon renders SVG — stub it out so the test environment doesn't need react-native-svg.
jest.mock('@/components/ui', () => ({
  Icon: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PrivacySettingsScreen = require('../privacy-settings').default;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrivacySettingsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the "Privacy & data" header title', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Privacy & data')).toBeTruthy();
    });
  });

  it('shows "Off" status when OS location permission is denied', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Off')).toBeTruthy();
    });
  });

  it('shows "On" status when OS location permission is granted', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('On')).toBeTruthy();
    });
  });

  it('shows "Off" as safe default when getForegroundPermissionsAsync rejects', async () => {
    mockGetForegroundPermissionsAsync.mockRejectedValue(new Error('unavailable'));
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Off')).toBeTruthy();
    });
  });

  it('renders the "Download my data" GDPR Art.15 link', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Download my data')).toBeTruthy();
    });
  });

  it('renders the privacy note confirming data is never sold', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText(/never sold/i)).toBeTruthy();
    });
  });

  it('does NOT call requestForegroundPermissionsAsync — ICO Children\'s Code Standard 10', async () => {
    // This is the key compliance test. The screen must read permission state
    // passively (getForegroundPermissionsAsync) and NEVER trigger the OS permission dialog.
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Privacy & data')).toBeTruthy();
    });
    expect(mockRequestForegroundPermissions).not.toHaveBeenCalled();
  });

  it('renders the "Location access" row label', async () => {
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<PrivacySettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Location access')).toBeTruthy();
    });
  });
});
