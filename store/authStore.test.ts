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
import { useAuthStore } from './authStore';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import type { Profile } from '../types';

// jest.mock() is hoisted by Jest before variable assignments.
// Variables declared OUTSIDE the factory are undefined when the factory runs.
//
// Solution: create all jest.fn() instances INSIDE the factory, then export
// them alongside the supabase object so tests can reference them via require().
jest.mock('@/lib/supabase', () => {
  // Stable mock instances — created once, reused by every call to from().
  const _mockSignOut = jest.fn().mockResolvedValue({ error: null });
  const _mockSingle  = jest.fn().mockResolvedValue({ data: null, error: null });
  const _mockEq      = jest.fn().mockReturnThis();
  const _mockSelect  = jest.fn().mockReturnThis();

  // Attach inner mocks directly onto the supabase object so the imported
  // `supabase` reference gives access to them for assertions and overrides.
  const supabaseObj = {
    auth: { signOut: _mockSignOut },
    from: jest.fn(() => ({
      select: _mockSelect,
      eq:     _mockEq,
      single: _mockSingle,
    })),
    _mockSignOut,
    _mockSingle,
  };

  return { supabase: supabaseObj };
});

// Grab stable references to the inner mocks from the imported (mocked) module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s          = supabase as any;
const mockSignOut = _s._mockSignOut as jest.Mock;
const mockSingle  = _s._mockSingle  as jest.Mock;

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
  postcode: null,
  show_in_search: false,
  show_reviews_publicly: true,
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
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  // setSession(null) should NOT trigger fetchProfile
  it('does not call fetchProfile when session is null', () => {
    (supabase.from as jest.Mock).mockClear();

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
    (supabase.from as jest.Mock).mockClear();

    await useAuthStore.getState().fetchProfile();

    expect(supabase.from).not.toHaveBeenCalled();
  });

  /**
   * Stale-fetch identity guard.
   *
   * Scenario: User A signs in → fetchProfile starts for User A → User A
   * signs out and User B signs in → fetchProfile resolves for User A.
   * Without the identity guard, User A's profile data overwrites User B's
   * profile in the store — a serious data leak on shared/family devices.
   *
   * We simulate this by:
   *   1. Starting fetchProfile for User A (mockSingle resolves slowly via a
   *      deferred promise).
   *   2. Swapping the store user to User B before the promise resolves.
   *   3. Resolving the deferred promise (User A's fetch completes).
   *   4. Asserting that the store profile is still null (not User A's data).
   */
  it('does not write profile if user changed between fetch start and resolve', async () => {
    const userA: User = {
      id: 'user-A',
      email: 'a@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00Z',
    } as User;

    const userB: User = {
      id: 'user-B',
      email: 'b@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00Z',
    } as User;

    const profileA: Profile = { ...fakeProfile, id: 'user-A', username: 'user_a' };

    // Deferred promise — lets us control exactly when the fetch "resolves"
    // so we can change the store user in between.
    let resolveDeferred!: (value: { data: Profile; error: null }) => void;
    const deferred = new Promise<{ data: Profile; error: null }>((resolve) => {
      resolveDeferred = resolve;
    });
    mockSingle.mockReturnValueOnce(deferred);

    // Start fetchProfile for User A.
    useAuthStore.setState({ user: userA, profile: null });
    const fetchPromise = useAuthStore.getState().fetchProfile();

    // Before the fetch resolves, switch to User B (simulating sign-out + sign-in).
    useAuthStore.setState({ user: userB, profile: null });

    // Now let User A's fetch complete.
    resolveDeferred({ data: profileA, error: null });
    await fetchPromise;

    // User A's profile must NOT have been written to the store.
    expect(useAuthStore.getState().profile).toBeNull();
    // User B is still the active user.
    expect(useAuthStore.getState().user?.id).toBe('user-B');
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

  // BUG A fix: isLoading must be reset to false on signOut so the app never
  // gets stuck showing a loading spinner after the user logs out and back in.
  // Without this fix, the store keeps isLoading=true from a previous loading
  // cycle, and the app renders a spinner indefinitely on the next session.
  it('sets isLoading to false after signOut', async () => {
    useAuthStore.setState({
      session: fakeSession,
      user: fakeUser,
      profile: fakeProfile,
      isLoading: true,   // simulate an in-progress load at sign-out time
    });

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().isLoading).toBe(false);
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
