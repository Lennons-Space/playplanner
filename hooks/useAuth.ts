import { useEffect } from 'react';
import { AppState, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuthStore, consumeDeliberateSignOut } from '@/store/authStore';
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
      if (event === 'SIGNED_OUT') {
        // Auth Session Recovery: this event fires for BOTH a deliberate
        // "Sign out" tap AND an involuntary terminal session loss — e.g. the
        // Supabase SDK's own internal recovery from a stale/invalid refresh
        // token ("Invalid Refresh Token: Refresh Token Not Found",
        // refresh_token_already_used, session_not_found, session_expired),
        // which it already handles by clearing its local session and firing
        // this exact same event (see store/authStore.ts's
        // consumeDeliberateSignOut for the full reasoning). Only show the
        // "session expired" message for the involuntary case:
        //   - hadSession guards against firing on a SIGNED_OUT that arrives
        //     when there was nothing to lose (e.g. a duplicate/late event
        //     while already signed out) — keeps this idempotent.
        //   - !wasDeliberate excludes the user-initiated "Sign out" flow,
        //     which already knows why it's signed out.
        // Ordinary temporary errors (offline, timeout, a transient Supabase
        // outage) never reach here at all — the SDK only fires SIGNED_OUT
        // for a genuinely terminal session, never for a retryable fetch
        // failure (see AuthRetryableFetchError in the installed SDK).
        const hadSession = !!useAuthStore.getState().session;
        const wasDeliberate = consumeDeliberateSignOut();
        if (hadSession && !wasDeliberate) {
          Alert.alert('Session expired', 'Your session expired. Please sign in again.');
        }
        queryClient.clear();
        // Clear any pending postcode so it is not visible to the next user
        // on a shared device. The store cannot be cleared by the auth store
        // directly; we reach in via getState() which is safe outside React.
        useMapStore.getState().setPendingPostcode(null);
      }
      setSession(session);
      if (event === 'SIGNED_IN' && session?.user?.id) {
        // Migrate any pre-auth location consent that was stored locally before
        // the user had an account. Non-blocking — migration failure must never
        // affect the sign-in experience. Placed here (not in login.tsx) so it
        // runs for all sign-in paths (email, OAuth, magic link, etc.) without a
        // race between navigation and the useEffect dependency change.
        migratePendingLocationConsent(session.user.id).catch(() => {});
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession, queryClient]);
}

/**
 * Re-fetches the current user's profile whenever the app returns to the
 * foreground (background → active transition), and starts/stops the
 * Supabase SDK's auto-refresh ticker in step with the same transition.
 *
 * WHY profile refresh is needed (BUG F):
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
 * WHY startAutoRefresh()/stopAutoRefresh() live here too (Auth Session
 * Recovery checkpoint), rather than a second AppState listener: Supabase's
 * own React Native guidance calls for exactly this pairing (auto-refresh
 * paused while backgrounded, resumed on foreground) — folding it into this
 * hook's EXISTING single AppState subscription keeps the app to one
 * subscription total rather than adding a second, redundant one. Both calls
 * are safe to make unconditionally (no session → the ticker is a no-op each
 * tick) and are idempotent — stopAutoRefresh() when nothing is running, or
 * startAutoRefresh() when it's already running, are both safe no-ops inside
 * the SDK.
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
        supabase.auth.startAutoRefresh();
        // App returned to foreground — re-fetch profile if a user is signed in.
        // Reading from getState() (not the React selector closure) ensures we
        // always see the live value even if the user changed since mount.
        if (useAuthStore.getState().user) {
          useAuthStore.getState().fetchProfile();
        }
      } else if (previousState === 'active' && nextState !== 'active') {
        supabase.auth.stopAutoRefresh();
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
