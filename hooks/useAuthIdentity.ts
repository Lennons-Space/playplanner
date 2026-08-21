/**
 * useAuthIdentity — the cache-scope token for the current auth identity.
 *
 * WHY THIS EXISTS
 * ---------------
 * Real-device finding, 2026-08-20: after signing out, an approved review fetched
 * while authenticated was still rendered to the logged-out user on a venue-detail
 * screen that was still mounted in the navigation stack.
 *
 * `queryClient.clear()` was already being called on sign-out, and it is NOT
 * sufficient on its own. React Query keeps the last successful `data` on a query
 * that subsequently ERRORS. A screen still mounted at sign-out re-fetches
 * immediately after the cache is cleared; for an anonymous caller that re-fetch
 * fails (migrations 065/066 leave `anon` with zero privileges on
 * `public_profiles`, which the venue reviews query embeds), so the observer falls
 * back to the previous authenticated result and keeps rendering it. Reproduced in
 * hooks/__tests__/authCacheBoundary.test.tsx.
 *
 * THE STRUCTURAL FIX
 * ------------------
 * Any query whose VISIBILITY depends on who is asking must carry the identity in
 * its query key. When the identity changes, the key changes, so the observer
 * switches to a different cache entry that has never held another identity's
 * data. There is no window in which stale data can be observed, and it holds for
 * account switches (User A -> sign out -> User B) as well as sign-out, without
 * depending on any clean-up call being remembered at every sign-out site.
 *
 * `queryClient.clear()` on sign-out is retained as defence in depth — this hook
 * makes correctness structural rather than procedural.
 *
 * Queries that are identical for every caller (categories, published venues) do
 * not need scoping and are deliberately left unscoped so they survive sign-out.
 */
import { useAuthStore } from '@/store/authStore';

/** Cache scope used when nobody is signed in. */
export const ANON_IDENTITY = 'anon';

/**
 * Reactive cache-scope token. Returns the signed-in user's id, or 'anon'.
 * Use this inside a query key for any identity-dependent query.
 */
export function useAuthIdentity(): string {
  const userId = useAuthStore((s) => s.user?.id);
  return userId ?? ANON_IDENTITY;
}

/** Non-reactive read, for use outside React (listeners, imperative code). */
export function getAuthIdentity(): string {
  return useAuthStore.getState().user?.id ?? ANON_IDENTITY;
}

/** True when a user is signed in. */
export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => !!s.user?.id);
}
