import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

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
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, isLoading: false });
    // CONTRACT: callers must also call queryClient.clear() immediately after this
    // to prevent cached venue/profile data from leaking to the next user on a
    // shared device. The store cannot access queryClient directly (it lives in
    // React context), so this responsibility belongs to the sign-out UI handler.
  },
}));
