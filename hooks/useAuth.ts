import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

/**
 * Listens for Supabase auth changes and keeps the store in sync.
 * Call this once at the root of the app in _layout.tsx.
 */
export function useAuthListener() {
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    // Get the session that already exists (e.g. app re-opened)
    // .catch ensures getSession() failure (network error, corrupted storage) still
    // clears isLoading — without this the splash screen would hang forever.
    supabase.auth.getSession()
      .then(({ data: { session } }) => setSession(session))
      .catch(() => setSession(null));

    // Listen for sign-in / sign-out events
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession]);
}

/** Convenience selectors */
export function useUser()    { return useAuthStore((s) => s.user); }
export function useProfile() { return useAuthStore((s) => s.profile); }
export function useIsAdmin() { return useAuthStore((s) => s.profile?.is_admin ?? false); }
export function useSession() { return useAuthStore((s) => s.session); }
