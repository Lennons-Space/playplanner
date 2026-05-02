/**
 * Tests for app/profile/data-download.tsx
 *
 * Covers: info copy renders, download button renders, loading disables button,
 * cooldown message shown within 24h.
 *
 * The component uses expo-secure-store (SecureStore.getItemAsync / setItemAsync)
 * to persist the last-export timestamp — NOT AsyncStorage.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { buildDataExport } from '@/hooks/useDataRights';
import DataDownloadScreen from '../data-download';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  Stack: {
    Screen: 'View',
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({ user: { id: 'user-123' } }),
}));

jest.mock('@/hooks/useDataRights', () => ({
  buildDataExport: jest.fn().mockResolvedValue('{}'),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///tmp/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

// expo-sharing is not yet installed (requires: npx expo install expo-sharing).
// We use { virtual: true } so Jest can mock the module without it being on disk.
jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

// The component uses SecureStore — mock at the SecureStore boundary.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('date-fns', () => ({
  format: jest.fn(() => '1 Jan 2025 at 12:00'),
}));

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const mockBuildExport  = buildDataExport as jest.MockedFunction<typeof buildDataExport>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataDownloadScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemAsync.mockResolvedValue(null);
    mockBuildExport.mockResolvedValue('{}');
  });

  it('renders the transparency info copy', async () => {
    render(<DataDownloadScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Your download includes your profile/)).toBeTruthy();
    });
    expect(screen.getByText(/It does not include payment information/)).toBeTruthy();
  });

  it('renders the "Request download" button', async () => {
    render(<DataDownloadScreen />);

    await waitFor(() => {
      expect(screen.getByText('Request download')).toBeTruthy();
    });
  });

  it('button is not disabled when no cooldown is active', async () => {
    render(<DataDownloadScreen />);

    await waitFor(() => {
      const btn = screen.getByLabelText('Request data download');
      expect(btn.props.accessibilityState?.disabled).toBeFalsy();
    });
  });

  it('shows cooldown message when last export was within 24h', async () => {
    // Set last export timestamp to 1 hour ago
    const oneHourAgo = (Date.now() - 3_600_000).toString();
    mockGetItemAsync.mockResolvedValue(oneHourAgo);

    render(<DataDownloadScreen />);

    await waitFor(() => {
      expect(screen.getByText(/You downloaded your data recently/)).toBeTruthy();
    });
  });

  it('does not show cooldown message when last export was over 24h ago', async () => {
    // Set last export timestamp to 25 hours ago
    const twentyFiveHoursAgo = (Date.now() - 90_000_000).toString();
    mockGetItemAsync.mockResolvedValue(twentyFiveHoursAgo);

    render(<DataDownloadScreen />);

    await waitFor(() => {
      expect(screen.getByText('Request download')).toBeTruthy();
    });

    expect(screen.queryByText(/You downloaded your data recently/)).toBeNull();
  });

  it('disables the button while a download is in progress', async () => {
    // Make buildDataExport pend indefinitely to simulate a slow network
    let resolveExport!: (v: string) => void;
    mockBuildExport.mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveExport = resolve; }),
    );

    render(<DataDownloadScreen />);

    await waitFor(() => screen.getByText('Request download'));

    act(() => {
      fireEvent.press(screen.getByLabelText('Request data download'));
    });

    // After pressing, the button should be disabled (loading state)
    await waitFor(() => {
      const btn = screen.getByLabelText('Request data download');
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    });

    // Clean up: resolve the pending promise so no open handles remain
    act(() => { resolveExport('{}'); });
  });
});
