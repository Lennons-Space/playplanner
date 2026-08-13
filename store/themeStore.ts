// ─────────────────────────────────────────────────────────────────────────
// themeStore — LEGACY. The user's formerly-SAVED appearance preference (Step
// 10A Part 2, dual-theme foundation).
//
// SUPERSEDED (2026-08-13, automatic day/night theme): PlayPlanner's light/
// dark appearance is now resolved entirely from local time — see
// lib/timeAppearance.ts + store/appearanceStore.ts, consumed by
// hooks/useAppTheme.ts. This store's `preference` value is NO LONGER READ
// anywhere in the visual-resolution path (useAppTheme no longer imports this
// file at all). It is kept, unchanged, purely so an already-installed app
// with a persisted AsyncStorage value doesn't hit a migration/parse error —
// there is deliberately no reader left to act on it. app/profile/appearance.tsx
// no longer writes to it either (that screen is now an Automatic-only
// explainer with no picker). Do not wire this back up to useAppTheme without
// re-checking that decision — see the CLAUDE.md automatic-theme task notes.
//
// This store owns exactly one decision: "system" | "light" | "dark" — never
// a RESOLVED mode itself. Keeping the two separate (historically, so
// resolving "system" could read the live OS colour scheme inside a React
// hook) means this store stays a tiny, pure, testable piece of state with no
// dependency on react-native's Appearance module.
//
// Privacy: no PII, no auth coupling, no network. A theme preference is not
// personal data — it's a device-local display setting — so it is persisted
// with plain AsyncStorage (same convention as lib/recentlyViewed.ts), NOT
// expo-secure-store (SecureStore is reserved for consent/PII, see
// .claude/memory feedback on secret handling). The store works identically
// signed-in and signed-out; it is never gated behind auth so that Welcome,
// Login, and every signed-out screen also resolve the user's saved theme.
// ─────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedMode = 'light' | 'dark';

/** Namespaced, versioned AsyncStorage key — bump the version if the shape ever changes. */
export const THEME_PREFERENCE_STORAGE_KEY = 'playplanner.themePreference.v1';

interface ThemeState {
  /** The user's saved choice. Defaults to 'system' — no themed opinion until they pick one. */
  preference: ThemePreference;
  /** True once the persisted value (if any) has been read back from AsyncStorage. */
  hasHydrated: boolean;
  setPreference: (preference: ThemePreference) => void;
  /** Internal — flips true via the persist middleware's onRehydrateStorage hook below. */
  setHasHydrated: (hasHydrated: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      hasHydrated: false,
      setPreference: (preference) => set({ preference }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: THEME_PREFERENCE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // Only the preference itself is worth persisting — hasHydrated is a
      // runtime flag, not data, and re-persisting it would be meaningless.
      partialize: (state) => ({ preference: state.preference }),
      // Runs once rehydration finishes (successfully or not) — flips
      // hasHydrated so app/_layout.tsx's paint gate can stop waiting. Firing
      // this regardless of error means a corrupt/unreadable AsyncStorage
      // value can never hang first paint; it just falls back to 'system'.
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
