/**
 * Tests for app/profile/notifications.tsx
 *
 * v2 restyle (Step 5, feat/exact-v2-design) coverage:
 *   - No duplicate/raw route header: this screen renders exactly ONE
 *     "Notifications" header (its own <V2Header/>), never a second literal
 *     route-name header from the Stack — regression test for the bug fixed
 *     in app/profile/_layout.tsx (headerShown:false).
 *   - Signed-out guard still renders its own header + message, no crash.
 *   - Permission-check/register/unregister behaviour is exercised via the
 *     real usePushNotifications mock surface, unchanged from pre-restyle.
 *   - GDPR/ICO copy (opt-in only, no marketing, tokens deleted on account
 *     deletion) still renders.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useUser } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAppearanceStore } from '@/store/appearanceStore';
import NotificationsScreen from '../notifications';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => cb(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// v2 restyle: stub this screen's <V2Background/> atmosphere mount — covered
// by its own dedicated background test elsewhere.
jest.mock('@/components/ui/V2Background', () => ({
  V2Background: () => null,
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

jest.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ count: 0, error: null }),
      })),
    })),
  },
}));

const mockUseUser = useUser as jest.MockedFunction<typeof useUser>;
const mockUsePushNotifications = usePushNotifications as jest.MockedFunction<typeof usePushNotifications>;
const mockGetPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const mockRegister = jest.fn();
const mockUnregister = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue({ id: 'user-test-id' } as any);
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockUsePushNotifications.mockReturnValue({
    isRegistered: false,
    isLoading: false,
    register: mockRegister,
    unregister: mockUnregister,
  });
  // Step 10A Part 2 (dual-theme foundation): reset to the default so tests
  // above (written before theming existed) stay unaffected by the block below.
  useAppearanceStore.setState({ mode: 'dark' });
});

// ---------------------------------------------------------------------------
// Header — no duplicate / raw route name
// ---------------------------------------------------------------------------

describe('NotificationsScreen — single deliberate header', () => {
  it('renders exactly one "Notifications" header, never the raw route name twice', () => {
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    const matches = screen.getAllByText('Notifications');
    expect(matches.length).toBe(1);
  });

  it('signed-out guard also renders exactly one "Notifications" header', () => {
    mockUseUser.mockReturnValue(null);
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    const matches = screen.getAllByText('Notifications');
    expect(matches.length).toBe(1);
    expect(screen.getByText('Sign in to manage notifications')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Toggle behaviour — unchanged permission logic
// ---------------------------------------------------------------------------

describe('NotificationsScreen — toggle preserves exact permission behaviour', () => {
  it('shows "Disabled" and an off switch when not registered and no existing token', async () => {
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Disabled')).toBeTruthy();
    });
    const sw = screen.getByLabelText('Toggle push notifications');
    expect(sw.props.accessibilityState?.checked).toBe(false);
  });

  it('shows "Enabled" when usePushNotifications reports isRegistered', async () => {
    mockUsePushNotifications.mockReturnValue({
      isRegistered: true,
      isLoading: false,
      register: mockRegister,
      unregister: mockUnregister,
    });
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('Enabled')).toBeTruthy();
    });
  });

  it('calls register() when the switch is toggled on', async () => {
    mockRegister.mockResolvedValue(true);
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    await waitFor(() => screen.getByLabelText('Toggle push notifications'));
    fireEvent(screen.getByLabelText('Toggle push notifications'), 'valueChange', true);
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
  });

  it('shows a "blocked" Alert when register() resolves false (OS permission denied)', async () => {
    mockRegister.mockResolvedValue(false);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    await waitFor(() => screen.getByLabelText('Toggle push notifications'));
    fireEvent(screen.getByLabelText('Toggle push notifications'), 'valueChange', true);
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Notifications blocked',
        expect.any(String),
        expect.any(Array),
      );
    });
    alertSpy.mockRestore();
  });

  it('calls unregister() when the switch is toggled off', async () => {
    mockUsePushNotifications.mockReturnValue({
      isRegistered: true,
      isLoading: false,
      register: mockRegister,
      unregister: mockUnregister,
    });
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    await waitFor(() => screen.getByLabelText('Toggle push notifications'));
    fireEvent(screen.getByLabelText('Toggle push notifications'), 'valueChange', false);
    await waitFor(() => expect(mockUnregister).toHaveBeenCalled());
  });

  it('re-checks OS permission on focus and unregisters if revoked', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(mockUnregister).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// GDPR / privacy copy preserved
// ---------------------------------------------------------------------------

describe('NotificationsScreen — GDPR/ICO copy preserved', () => {
  it('explains what will be sent and that it can be turned off', () => {
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText(/notify you when your reviews are published/i)).toBeTruthy();
  });

  it('states no marketing messages and tokens are deleted on account deletion', () => {
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText(/never send marketing messages/i)).toBeTruthy();
    expect(screen.getByText(/deleted automatically if you delete your account/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Step 10A Part 2 (dual-theme foundation) — proof-set both-theme render
// ---------------------------------------------------------------------------

describe('NotificationsScreen — renders in both light and dark (Step 10A Part 2 proof set)', () => {
  it('renders without crashing in dark mode, with content intact', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText('Push notifications')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
  });

  it('renders without crashing in light mode, with content intact', () => {
    useAppearanceStore.setState({ mode: 'light' });
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText('Push notifications')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
  });

  it('signed-out guard also renders without crashing in light mode', () => {
    useAppearanceStore.setState({ mode: 'light' });
    mockUseUser.mockReturnValue(null);
    render(<NotificationsScreen />, { wrapper: makeWrapper() });
    expect(screen.getByText('Sign in to manage notifications')).toBeTruthy();
  });
});
