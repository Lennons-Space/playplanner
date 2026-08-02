import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
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
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, username, full_name, avatar_url, bio, is_business_owner, is_admin, ' +
        'subscription_tier, subscription_expires_at, children_ages, ' +
        'marketing_consent, postcode, show_in_search, show_reviews_publicly, ' +
        'terms_accepted_at, created_at, updated_at'
      )
      // stripe_customer_id is intentionally excluded — it must never reach client memory.
      .eq('id', user.id)
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
    // supabase.auth.signOut() resolves { error } rather than throwing in the
    // installed SDK version — even when the server no longer recognises the
    // refresh token, 401/403/404 from the underlying admin sign-out call are
    // already treated as "already signed out, proceed" internally. Log
    // defensively (code only, never raw error content) but always clear
    // local state below regardless of the result — a server-side failure
    // must never leave this device still appearing signed in.
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('signOut error:', error.code ?? error.message);
    }
    set({ session: null, user: null, profile: null, isLoading: false });
    // CONTRACT: callers must also call queryClient.clear() immediately after this
    // to prevent cached venue/profile data from leaking to the next user on a
    // shared device. The store cannot access queryClient directly (it lives in
    // React context), so this responsibility belongs to the sign-out UI handler.
  },
}));
