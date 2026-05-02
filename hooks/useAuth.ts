import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { migratePendingLocationConsent } from '@/services/consent/locationConsent';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Listens for Supabase auth changes and keeps the store in sync.
 * Call this once at the root of the app in _layout.tsx.
 *
 * WHY queryClient is required here:
 * When a session ends (SIGNED_OUT — via explicit sign-out, token expiry, or
 * revocation), any cached React Query data (venue lists, profiles, favourites)
 * must be wiped immediately. Without this, a subsequent user on a shared device
 * could briefly see the previous user's data before the next fetch fires.
 * queryClient.clear() drops all query and mutation caches in one call.
 */
export function useAuthListener(queryClient: QueryClient) {
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    // Supabase v2 fires INITIAL_SESSION synchronously with any cached session
    // on subscription — this is the single source of truth for startup auth state.
    // A separate getSession() call is redundant and creates a race on slow networks:
    // if getSession() resolves after onAuthStateChange and its catch fires setSession(null),
    // the user is ejected to the welcome screen while already on the home tab.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_IN' && session?.user?.id) {
        // Migrate any pre-auth location consent that was stored locally before
        // the user had an account. Non-blocking — migration failure must never
        // affect the sign-in experience. Placed here (not in login.tsx) so it
        // runs for all sign-in paths (email, OAuth, magic link, etc.) without a
        // race between navigation and the useEffect dependency change.
        migratePendingLocationConsent(session.user.id).catch(() => {});
      }
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        // Clear any pending postcode so it is not visible to the next user
        // on a shared device. The store cannot be cleared by the auth store
        // directly; we reach in via getState() which is safe outside React.
        useMapStore.getState().setPendingPostcode(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession, queryClient]);
}

/**
 * Re-fetches the current user's profile whenever the app returns to the
 * foreground (background → active transition).
 *
 * WHY this is needed (BUG F):
 * fetchProfile() is only called once — at login — via setSession(). If an
 * admin's is_admin flag is revoked in the DB while they are using the app,
 * the Zustand store retains the stale value for the entire session. Any
 * server-side profile change (role revocation, subscription expiry, ban) is
 * invisible until the user signs out and back in.
 *
 * WHY AppState rather than Supabase Realtime:
 * Realtime requires an additional websocket channel and subscription
 * management. AppState foreground detection is zero-cost when the app is
 * backgrounded, fires reliably, and avoids the complexity of Realtime
 * auth + channel teardown on sign-out. The trade-off is that changes are
 * only picked up when the user returns — acceptable for admin-flag revocation.
 *
 * Design decisions:
 * - useEffect with [] — listener registered once; no duplicate listeners.
 * - previousState guard — only fires on genuine background→active transitions.
 *   active→active (which can fire on initial render) is ignored.
 * - Reads from useAuthStore.getState() imperatively inside the callback so
 *   it always sees the current user at fire time, not the stale closure value.
 * - No setInterval, no polling — purely event-driven.
 */
export function useProfileForegroundRefresh() {
  useEffect(() => {
    let previousState = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (previousState !== 'active' && nextState === 'active') {
        // App returned to foreground — re-fetch profile if a user is signed in.
        // Reading from getState() (not the React selector closure) ensures we
        // always see the live value even if the user changed since mount.
        if (useAuthStore.getState().user) {
          useAuthStore.getState().fetchProfile();
        }
      }
      previousState = nextState;
    });

    return () => subscription.remove();
  }, []); // empty deps: listener is set up once and cleaned up on unmount
}

/** Convenience selectors */
export function useUser()    { return useAuthStore((s) => s.user); }
export function useProfile() { return useAuthStore((s) => s.profile); }
export function useIsAdmin() { return useAuthStore((s) => s.profile?.is_admin ?? false); }
export function useSession() { return useAuthStore((s) => s.session); }
