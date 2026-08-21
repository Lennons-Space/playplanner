import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { purgeLocalAuthSession, resolveAuthStorageKey } from '@/lib/authSession';
import { tombstoneIdentity } from '@/lib/authTombstone';
import { logAuthState, scheduleSignOutVerification } from '@/lib/authDiagnostics';
import { useMapStore } from '@/store/mapStore';
import { clearRecentlyViewed } from '@/lib/recentlyViewed';
import type { Profile } from '@/types';

// ---------------------------------------------------------------------------
// Deliberate-sign-out coordination flag (Auth Session Recovery checkpoint).
//
// Supabase's own SDK already self-heals from a terminal stale-refresh-token
// error (e.g. "Invalid Refresh Token: Refresh Token Not Found"): internally
// it clears its local session and fires the SAME 'SIGNED_OUT' event onto
// onAuthStateChange (hooks/useAuth.ts's useAuthListener) that a genuine
// user-initiated "Sign out" tap also fires — there is no way to tell the two
// apart from the event itself. This module-level flag is set immediately
// before the deliberate `signOut()` action below calls
// `supabase.auth.signOut()`, and consumed (read-and-reset, so it only ever
// applies to the very next SIGNED_OUT) by the listener — so the "your
// session expired" message is shown only for the involuntary case, never
// after a deliberate sign-out.
let deliberateSignOut = false;

/** @internal — consumed only by hooks/useAuth.ts's useAuthListener. */
export function consumeDeliberateSignOut(): boolean {
  const was = deliberateSignOut;
  deliberateSignOut = false;
  return was;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  // Actions
  setSession: (session: Session | null) => void;
  fetchProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: true,

  setSession: (session) => {
    set({ session, user: session?.user ?? null, isLoading: false });
    if (session?.user) {
      get().fetchProfile();
    }
  },

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;
    // Migration 064 removed column-level SELECT on the privileged profile
    // columns (children_ages, postcode, subscription_*, is_admin, …) from the
    // `authenticated` role, so that no user can read another user's row. The
    // caller's OWN full row now comes from this SECURITY DEFINER RPC, which
    // takes no argument and resolves auth.uid() server-side — there is no
    // parameter to tamper with. stripe_customer_id is never returned by it,
    // preserving the original rule that it must not reach client memory.
    const { data, error } = await supabase
      .rpc('get_my_profile')
      .single();
    if (error) {
      // Log so developers can diagnose — without this, a broken profile fetch
      // is completely invisible (profile stays null with no explanation).
      console.error('fetchProfile failed:', error.code);
      return;
    }
    // Identity guard: if the user changed while this async fetch was in-flight
    // (e.g. sign-out → sign-in as a different account on a shared device),
    // discard the stale result. `user` is the captured value from the start
    // of this call; get().user is who is signed in now.
    if (data && get().user?.id === user.id) set({ profile: data as Profile });
  },

  signOut: async () => {
    deliberateSignOut = true;

    // ARM THE TOMBSTONE FIRST — before the SDK is asked to do anything.
    //
    // 2026-08-21 second real-device failure: purging storage is necessary but
    // NOT sufficient. A token refresh that started before the purge completes
    // after it, and auth-js's _callRefreshToken() then calls _saveSession()
    // unconditionally — writing the terminated session straight back to disk
    // and emitting TOKEN_REFRESHED. stopAutoRefresh() does not cancel a refresh
    // already in flight. Arming here (not after the await) means an event that
    // races the sign-out is already covered. See lib/authTombstone.ts.
    const outgoingUserId = get().user?.id ?? null;
    tombstoneIdentity(outgoingUserId);

    void logAuthState('BEFORE SIGNOUT');

    // Whether the SDK itself ended the session. See below — this is NOT the
    // same thing as "signOut() returned".
    let sdkTerminatedSession = false;

    try {
      // supabase.auth.signOut() resolves { error } rather than throwing in the
      // installed SDK version — even when the server no longer recognises the
      // refresh token, 401/403/404 from the underlying admin sign-out call are
      // already treated as "already signed out, proceed" internally.
      const { error } = await supabase.auth.signOut();
      if (error) {
        // Code/message only — never the raw error object.
        console.error('signOut error:', error.code ?? error.message);
      } else {
        sdkTerminatedSession = true;
      }
    } catch (err) {
      console.error('signOut threw:', err instanceof Error ? err.message : 'unknown');
    }

    // ---------------------------------------------------------------------
    // THE 2026-08-21 REAL-DEVICE BUG.
    //
    // Clearing the store is NOT enough, and treating a returned error as
    // "signed out anyway" is wrong. In the installed auth-js (2.103.0),
    // GoTrueClient._signOut() returns EARLY when the server-side revoke fails
    // for any reason other than 401/403/404 — a plain network failure being
    // the common one on mobile — and therefore never calls _removeSession().
    // The session stays on disk, no 'SIGNED_OUT' event is emitted, the
    // auto-refresh ticker keeps running, and the SDK can push the previous
    // user straight back into this store via a later TOKEN_REFRESHED /
    // SIGNED_IN event. Every identity-scoped query then legitimately re-fetches
    // the PREVIOUS account's rows, which is exactly how an approved review
    // stayed visible on the venue screen after signing out.
    //
    // So: if the SDK did not confirm termination, remove the persisted session
    // ourselves. GoTrueClient.__loadSession() re-reads storage on every call
    // and SupabaseClient._getAccessToken() calls getSession() for every
    // request, so this de-authenticates the client immediately, with no
    // restart and no network access required.
    // ---------------------------------------------------------------------
    // Stop the refresh ticker regardless of how signOut() went. It only clears
    // the interval — it CANNOT cancel a refresh already in flight, which is why
    // the tombstone above is the actual defence — but it stops new ticks from
    // starting one.
    try { await supabase.auth.stopAutoRefresh(); } catch { /* best effort */ }

    // Purge on EVERY path, not only the failure path. A successful online
    // signOut() calls _removeSession() itself, but an in-flight refresh can
    // still re-save afterwards; purging unconditionally costs one storage
    // round-trip and removes a whole class of ordering assumptions.
    try {
      const result = await purgeLocalAuthSession(resolveAuthStorageKey(supabase));
      if (!result.clean) {
        console.error('purgeLocalAuthSession: storage still populated after 2 passes');
      }
    } catch (err) {
      console.error('purgeLocalAuthSession failed:', err instanceof Error ? err.message : 'unknown');
    }

    // VERIFY, do not assume. getSession() reads back from storage, so this is
    // a real check that the device is no longer authenticated rather than a
    // restatement of what we just tried to do.
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        // The store and the SDK disagreed — the very divergence this fix is
        // about. Arm the tombstone with the identity the SESSION carries, so
        // it is covered even though the store never knew about it, then take
        // the session out again.
        tombstoneIdentity(data.session.user?.id ?? outgoingUserId);
        await purgeLocalAuthSession(resolveAuthStorageKey(supabase));
      }
    } catch (err) {
      console.error('post-signOut session check failed:', err instanceof Error ? err.message : 'unknown');
    }

    void logAuthState('AFTER LOCAL PURGE');
    // Re-checks the invariant past the refresh-retry window, so a device
    // retest shows whether anything rewrote the session later. __DEV__ only.
    scheduleSignOutVerification();

    // Local state is cleared in a finally-equivalent position: every path
    // above is individually guarded, so no failure can skip this. The previous
    // implementation cleared only after an unguarded await, which meant a
    // throwing signOut() left the user in the store — the call site in
    // app/(tabs)/profile.tsx already assumed otherwise in its comment.
    set({ session: null, user: null, profile: null, isLoading: false });

    // A pending postcode is location data belonging to the person who just
    // signed out. The SIGNED_OUT listener clears it, but that event does NOT
    // fire when we had to purge the session ourselves, so clear it here too —
    // this path always runs. Same reasoning for locally cached browsing
    // history (recently viewed venues), which is personal data about the
    // outgoing user and must not be visible to the next account on the device.
    try { useMapStore.getState().setPendingPostcode(null); } catch { /* best effort */ }
    void clearRecentlyViewed();

    if (!sdkTerminatedSession) {
      // No 'SIGNED_OUT' event was emitted, so nothing will consume the flag.
      // Leaving it set would suppress the "session expired" message on the
      // NEXT, genuinely involuntary sign-out. When the SDK did terminate the
      // session the event has already fired and consumed it synchronously.
      deliberateSignOut = false;
    }

    // CONTRACT: callers must also call queryClient.clear() immediately after this
    // to prevent cached venue/profile data from leaking to the next user on a
    // shared device. The store cannot access queryClient directly (it lives in
    // React context), so this responsibility belongs to the sign-out UI handler.
  },
}));
