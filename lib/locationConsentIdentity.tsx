// ─────────────────────────────────────────────────────────────────────────
// LocationConsentIdentity — explicit injection of "whose consent is this?"
//
// WHY THIS EXISTS
// PP-018 scopes location consent to the signed-in account, so both consent
// readers (hooks/useLocationConsent.ts and hooks/useResolvedWeather.ts) need
// the current user id. The obvious way to get it — importing store/authStore —
// drags lib/supabase into hooks/useResolvedWeather.ts, which is mounted by
// every <V2Background/> instance on nearly every screen. That would make a
// decorative background gradient transitively depend on a live DB client, the
// exact coupling constants/location.ts was written to avoid.
//
// So identity is INJECTED from the layer that already owns auth state
// (app/_layout.tsx, which mounts useAuthListener) rather than reached for from
// the bottom of the tree. This module imports React and nothing else.
//
// WHY A CONTEXT AND NOT A MIRROR STORE
// A mirrored/derived identity store was considered and REJECTED. Any store
// that copies the auth identity can, in principle, lag it — and a lagging
// identity is not a cosmetic bug here: if it still reported Account A while
// Account B was signed in, B would read A's consent record, find it valid for
// A, and act on it. That is precisely the cross-account leak PP-018 closes.
//
// React context cannot lag. The provider's value is part of the same render
// pass that changed it, so every consumer observes the new identity in the
// same commit as the auth store change that caused it — synchronously, with no
// second source of truth to fall out of step.
//
// FAILURE MODE: the default is `null`, i.e. "no signed-in account", which
// every consumer treats as "no precise location". A missing provider therefore
// degrades to the privacy-safe answer, never to a false grant.
// ─────────────────────────────────────────────────────────────────────────

import { createContext, useContext, type ReactNode } from 'react';

const LocationConsentIdentityContext = createContext<string | null>(null);

/**
 * Supplies the signed-in account id to the consent readers beneath it.
 * Mounted once, at the root (app/_layout.tsx). `userId` must be null whenever
 * nobody is signed in — never a stale value from a previous session.
 */
export function LocationConsentIdentityProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  return (
    <LocationConsentIdentityContext.Provider value={userId}>
      {children}
    </LocationConsentIdentityContext.Provider>
  );
}

/**
 * The account whose location consent applies right now, or null when signed
 * out. Null means precise location is not available at all — see
 * hooks/useLocationConsent.ts's 'unavailable' status.
 */
export function useLocationConsentIdentity(): string | null {
  return useContext(LocationConsentIdentityContext);
}
