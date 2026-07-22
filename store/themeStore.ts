// ─────────────────────────────────────────────────────────────────────────
// themeStore — the user's SAVED appearance preference (Step 10A Part 2,
// dual-theme foundation).
//
// This store owns exactly one decision: "system" | "light" | "dark" — never
// the RESOLVED mode itself (that's useAppTheme's job, since resolving
// "system" requires the live OS colour scheme via useColorScheme(), which
// only makes sense to read inside a React hook). Keeping the two separate
// means this store stays a tiny, pure, testable piece of state with no
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
