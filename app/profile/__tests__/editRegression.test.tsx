/**
 * Regression tests for EditProfileScreen (app/profile/edit.tsx).
 *
 * REGRESSION 1: Age chips were rendered inline in the edit form.
 *   Fix: removed age chips; replaced with a navigation link to
 *   /profile/children-ages. Tests verify the TouchableOpacity chip
 *   buttons (which had accessibilityRole="checkbox") are absent, and
 *   the navigation row is present.
 *
 * REGRESSION 2: Empty optional fields sent as empty strings to the DB.
 *   Fix: username, bio, postcode now send null when blank (data minimisation).
 *
 * SECURITY: Unauthenticated users must be redirected — never see the form.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { router }    from 'expo-router';
import { useUser, useProfile } from '@/hooks/useAuth';
import { useUpdateProfile, useUploadAvatar } from '@/hooks/useProfile';
import EditProfileScreen from '../edit';

// ---------------------------------------------------------------------------
// Mocks — all jest.mock calls are hoisted; stubs defined inside factories
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
  Stack:  { Screen: 'View' },
}));

jest.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: jest.fn(),
  useUploadAvatar:  jest.fn(),
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser:    jest.fn(),
  useProfile: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() }, from: jest.fn() },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockUseUser       = useUser          as jest.MockedFunction<typeof useUser>;
const mockUseProfile    = useProfile       as jest.MockedFunction<typeof useProfile>;
const mockRouterReplace = router.replace   as jest.Mock;
const mockRouterPush    = router.push      as jest.Mock;

// Stable mock references — set in beforeEach so every render in a test shares
// the same function instance. Avoids the problem where each render creates a
// new jest.fn() via a factory, making it impossible to track calls.
let mockMutateAsync: jest.Mock;

// Profile with NO children's ages so age-range text doesn't appear in the DOM
const FAKE_PROFILE = {
  id:            'user-test-123',
  full_name:     'Test Parent',
  username:      'testparent',
  bio:           'Love playgrounds',
  postcode:      'SW1A 1AA',
  avatar_url:    null,
  children_ages: [],
  is_admin:      false,
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMutateAsync = jest.fn().mockResolvedValue(undefined);
  (useUpdateProfile as jest.Mock).mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false });
  (useUploadAvatar  as jest.Mock).mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false });
  mockUseUser.mockReturnValue({ id: 'user-test-123' } as any);
  mockUseProfile.mockReturnValue(FAKE_PROFILE as any);
});

// ======================================================================
// Auth guard
// ======================================================================
describe('EditProfileScreen — auth guard', () => {
  it('redirects to login when user is null', async () => {
    mockUseUser.mockReturnValue(null);

    render(<EditProfileScreen />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/login');
    });
  });
});

// ======================================================================
// REGRESSION: age chips must not appear inline
// ======================================================================
describe('EditProfileScreen — regression: no inline age chips', () => {
  it('does not render any element with the chip age range labels 0-1, 5-7, 8-10, 11+', () => {
    const { queryByText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    // These were the chip button labels before they were removed.
    // With children_ages: [] in the profile, none should appear anywhere.
    expect(queryByText('0-1')).toBeNull();
    expect(queryByText('5-7')).toBeNull();
    expect(queryByText('8-10')).toBeNull();
    expect(queryByText('11+')).toBeNull();
  });

  it('shows a navigation row to the dedicated children-ages screen', () => {
    const { getByLabelText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    const agesRow = getByLabelText("Manage children's age ranges");
    expect(agesRow).toBeTruthy();
  });

  it('navigates to /profile/children-ages when the ages row is pressed', () => {
    const { getByLabelText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    fireEvent.press(getByLabelText("Manage children's age ranges"));

    expect(mockRouterPush).toHaveBeenCalledWith('/profile/children-ages');
  });
});

// ======================================================================
// Validation
// ======================================================================
describe('EditProfileScreen — validation', () => {
  it('shows "Name required" alert when name is empty and Save is pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    fireEvent.changeText(getByLabelText('Full name'), '');
    fireEvent.press(getByLabelText('Save profile changes'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Name required', expect.any(String));
    });

    alertSpy.mockRestore();
  });
});

// ======================================================================
// REGRESSION: empty optional fields sent as null, not empty string
// ======================================================================
describe('EditProfileScreen — null coalescing for optional fields', () => {
  it('sends null for username when the field is cleared', async () => {
    const { getByLabelText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    fireEvent.changeText(getByLabelText('Full name'),  'Test Parent');
    fireEvent.changeText(getByLabelText('Username'),    '');
    fireEvent.press(getByLabelText('Save profile changes'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ username: null }),
      );
    });
  });

  it('sends null for bio when the field is cleared', async () => {
    const { getByLabelText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    fireEvent.changeText(getByLabelText('Full name'), 'Test Parent');
    fireEvent.changeText(getByLabelText('Bio'),        '');
    fireEvent.press(getByLabelText('Save profile changes'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ bio: null }),
      );
    });
  });
});

// ======================================================================
// Accessibility
// ======================================================================
describe('EditProfileScreen — accessibility', () => {
  it('has accessibilityLabel "Change profile photo" on the photo button', () => {
    const { getAllByLabelText } = render(<EditProfileScreen />, { wrapper: makeWrapper() });

    const photoBtns = getAllByLabelText('Change profile photo');
    expect(photoBtns.length).toBeGreaterThanOrEqual(1);
  });
});
