/**
 * Tests for the auth Zustand store (store/authStore.ts).
 *
 * The Supabase client is mocked so these tests never make real network calls.
 *
 * NOTE: If these tests fail with "Cannot find module '@/lib/supabase'" or
 * "@/types", the Jest config needs moduleNameMapper entries for the @/ alias.
 * See the instructions at the bottom of this file or in the test output.
 */

// ---- Mock Supabase BEFORE importing the store ----
// This must come before any import that touches supabase.
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
const mockSelect = jest.fn().mockReturnThis();
const mockEq = jest.fn().mockReturnThis();
const mockSingle = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: mockSignOut,
    },
    from: jest.fn(() => ({
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
    })),
  },
}));

import { useAuthStore } from './authStore';
import type { Session, User } from '@supabase/supabase-js';
import type { Profile } from '../types';

// ---- Test fixtures ----

/** A minimal fake Supabase Session object for testing */
const fakeUser: User = {
  id: 'user-123',
  email: 'parent@example.com',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2024-01-01T00:00:00Z',
} as User;

const fakeSession: Session = {
  access_token: 'fake-access-token',
  refresh_token: 'fake-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: fakeUser,
} as Session;

const fakeProfile: Profile = {
  id: 'user-123',
  username: 'happy_parent',
  full_name: 'Jane Doe',
  avatar_url: null,
  bio: null,
  is_business_owner: false,
  is_admin: false,
  subscription_tier: 'free',
  subscription_expires_at: null,
  children_ages: ['2-4'],
  marketing_consent: false,
  terms_accepted_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// Reset the store and mocks before each test
beforeEach(() => {
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: true,
  });
  jest.clearAllMocks();
});

// ======================================================================
// Initial state
// ======================================================================
describe('initial state', () => {
  // A freshly loaded app should have no auth data
  it('starts with null session, user, and profile', () => {
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
  });

  // The app shows a loading spinner until auth state is determined
  it('starts with isLoading true', () => {
    expect(useAuthStore.getState().isLoading).toBe(true);
  });
});

// ======================================================================
// setSession
// ======================================================================
describe('setSession', () => {
  // When the user logs in, session and user should both be stored
  it('stores the session and extracts the user from it', () => {
    useAuthStore.getState().setSession(fakeSession);

    const state = useAuthStore.getState();
    expect(state.session).toBe(fakeSession);
    expect(state.user).toBe(fakeUser);
  });

  // After setting a session, loading should be finished
  it('sets isLoading to false', () => {
    useAuthStore.getState().setSession(fakeSession);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  // Setting session to null (logged out / session expired) clears the user
  it('clears user when session is null', () => {
    // First, set a real session
    useAuthStore.getState().setSession(fakeSession);
    // Then clear it
    useAuthStore.getState().setSession(null);

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  // setSession should trigger fetchProfile when there is a user
  it('calls fetchProfile when session has a user', () => {
    // Make the mock return a profile
    mockSingle.mockResolvedValueOnce({ data: fakeProfile, error: null });

    useAuthStore.getState().setSession(fakeSession);

    // fetchProfile is called internally — it queries 'profiles'
    const { supabase } = require('@/lib/supabase');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  // setSession(null) should NOT trigger fetchProfile
  it('does not call fetchProfile when session is null', () => {
    const { supabase } = require('@/lib/supabase');
    supabase.from.mockClear();

    useAuthStore.getState().setSession(null);

    expect(supabase.from).not.toHaveBeenCalled();
  });
});

// ======================================================================
// fetchProfile
// ======================================================================
describe('fetchProfile', () => {
  // When the profile loads successfully, it should be stored in state
  it('stores the profile on successful fetch', async () => {
    // Set up a user first (fetchProfile requires get().user to be set)
    useAuthStore.setState({ user: fakeUser });
    mockSingle.mockResolvedValueOnce({ data: fakeProfile, error: null });

    await useAuthStore.getState().fetchProfile();

    expect(useAuthStore.getState().profile).toEqual(fakeProfile);
  });

  // If the Supabase query fails, profile should remain null (not crash)
  it('leaves profile as null on error', async () => {
    useAuthStore.setState({ user: fakeUser });
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Row not found' },
    });

    await useAuthStore.getState().fetchProfile();

    expect(useAuthStore.getState().profile).toBeNull();
  });

  // If there is no user, fetchProfile should do nothing (guard clause)
  it('does nothing if no user is set', async () => {
    const { supabase } = require('@/lib/supabase');
    supabase.from.mockClear();

    await useAuthStore.getState().fetchProfile();

    expect(supabase.from).not.toHaveBeenCalled();
  });
});

// ======================================================================
// signOut
// ======================================================================
describe('signOut', () => {
  // After signing out, all auth state must be cleared — this is critical
  // for preventing data leaks between users on shared devices
  it('clears session, user, and profile', async () => {
    // Start in a logged-in state
    useAuthStore.setState({
      session: fakeSession,
      user: fakeUser,
      profile: fakeProfile,
      isLoading: false,
    });

    await useAuthStore.getState().signOut();

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
  });

  // It should call Supabase's signOut to invalidate the server-side session
  it('calls supabase.auth.signOut()', async () => {
    await useAuthStore.getState().signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // After signOut, the profile's is_admin must not be accessible
  // (prevents privilege leaks on shared/family devices)
  it('ensures is_admin is not accessible after signOut', async () => {
    useAuthStore.setState({
      session: fakeSession,
      user: fakeUser,
      profile: { ...fakeProfile, is_admin: true },
      isLoading: false,
    });

    await useAuthStore.getState().signOut();

    // profile is null, so is_admin cannot be true
    const profile = useAuthStore.getState().profile;
    expect(profile).toBeNull();
    // Extra safety: even if someone checks profile?.is_admin, it's falsy
    expect(profile?.is_admin).toBeFalsy();
  });
});
