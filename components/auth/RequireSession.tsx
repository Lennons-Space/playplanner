// ─────────────────────────────────────────────────────────────────────────
// RequireSession — auth guard for root-Stack routes that live OUTSIDE the
// (tabs) group.
//
// WHY THIS EXISTS: app/(tabs)/_layout.tsx already gates every screen inside
// the (tabs) group behind a valid Supabase session (redirects to /(auth) when
// signed out). But app/_layout.tsx's root Stack registers several routes
// OUTSIDE that group with no guard of its own — e.g. venue/add (a modal) and,
// via app/(tabs)/map.tsx's re-export, app/explore/map.tsx. Normal in-app
// navigation only reaches those routes from already-gated screens, but a deep
// link (this app registers the `playplanner://` scheme) can open them
// directly while signed out, bypassing the tabs guard entirely.
//
// This component reuses the EXACT SAME guard logic as app/(tabs)/_layout.tsx
// — same store, same isLoading/session read order, same redirect target — so
// there is only one auth-gating mechanism in the app, not two. Do not
// duplicate this logic inline in a screen; wrap the screen's default export
// with <RequireSession> instead (see app/explore/map.tsx and
// app/venue/add.tsx for the pattern).
//
// FLASH PREVENTION: while isLoading is true (cold-start session restore —
// Supabase is still replaying the cached session via INITIAL_SESSION) this
// renders null rather than redirecting, exactly like the tabs layout. Once
// loading completes, a missing session redirects to /(auth) via <Redirect>
// BEFORE `children` is ever returned — the guarded screen's component
// function never executes on that path, so nothing can flash on screen first.
// Only once a session is confirmed present does `children` render.
// ─────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);

  // Mirrors app/(tabs)/_layout.tsx exactly: never redirect while the cached
  // session is still being restored, or a legitimately signed-in user would
  // be bounced to /(auth) and immediately bounced back.
  if (isLoading) return null;
  if (!session) return <Redirect href="/(auth)" />;

  return <>{children}</>;
}
