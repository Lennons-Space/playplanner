/**
 * Tests for store/themeStore.ts (Step 10A Part 2, dual-theme foundation).
 *
 * Covers: default preference, setPreference reactivity, the AsyncStorage
 * persistence round-trip (via the jest.setup.js global async-storage-mock),
 * the hasHydrated flag app/_layout.tsx's paint gate depends on, and that the
 * store has zero auth coupling (works identically signed-in or signed-out).
 */
import fs from 'fs';
import path from 'path';
import { waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStore, THEME_PREFERENCE_STORAGE_KEY } from './themeStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  useThemeStore.setState({ preference: 'system', hasHydrated: false });
});

describe('themeStore — default state', () => {
  it('defaults preference to "system"', () => {
    expect(useThemeStore.getState().preference).toBe('system');
  });
});

describe('themeStore — setPreference', () => {
  it('updates preference to "light"', () => {
    useThemeStore.getState().setPreference('light');
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('updates preference to "dark"', () => {
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('can be set back to "system"', () => {
    useThemeStore.getState().setPreference('dark');
    useThemeStore.getState().setPreference('system');
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('notifies subscribers immediately — mounted consumers re-render on change', () => {
    const listener = jest.fn();
    const unsubscribe = useThemeStore.subscribe(listener);
    useThemeStore.getState().setPreference('dark');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('themeStore — AsyncStorage persistence round-trip', () => {
  it('persists the preference under the namespaced, versioned storage key', async () => {
    useThemeStore.getState().setPreference('dark');

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
      expect(raw).toBeTruthy();
    });

    const raw = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.preference).toBe('dark');
  });

  it('the storage key itself is the documented playplanner.themePreference.v1', () => {
    expect(THEME_PREFERENCE_STORAGE_KEY).toBe('playplanner.themePreference.v1');
  });

  it('only persists `preference` — hasHydrated is a runtime flag, never written to storage', async () => {
    useThemeStore.getState().setPreference('light');

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
      expect(raw).toBeTruthy();
    });

    const raw = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    const parsed = JSON.parse(raw as string);
    expect(parsed.state).not.toHaveProperty('hasHydrated');
  });

  it('a fresh rehydrate reads back a preference written directly to storage (simulated app restart)', async () => {
    // Write directly to the (mocked) AsyncStorage in the exact shape the
    // persist middleware writes, bypassing the live store instance — calling
    // useThemeStore.setState() here would itself re-trigger a persist write
    // and defeat the "simulated restart" (persist wraps ALL state changes,
    // including setState, not just setPreference).
    await AsyncStorage.setItem(
      THEME_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ state: { preference: 'dark' }, version: 0 }),
    );

    await useThemeStore.persist.rehydrate();

    await waitFor(() => {
      expect(useThemeStore.getState().preference).toBe('dark');
    });
  });
});

describe('themeStore — hydration flag gates first paint', () => {
  it('starts false (testable at store level) then flips true once rehydration completes', async () => {
    useThemeStore.setState({ hasHydrated: false });
    expect(useThemeStore.getState().hasHydrated).toBe(false);

    await useThemeStore.persist.rehydrate();

    await waitFor(() => {
      expect(useThemeStore.getState().hasHydrated).toBe(true);
    });
  });

  it('flips true even when there is nothing persisted yet (first-ever launch)', async () => {
    await AsyncStorage.clear();
    useThemeStore.setState({ preference: 'system', hasHydrated: false });

    await useThemeStore.persist.rehydrate();

    await waitFor(() => {
      expect(useThemeStore.getState().hasHydrated).toBe(true);
    });
    // No persisted value existed, so the default is untouched.
    expect(useThemeStore.getState().preference).toBe('system');
  });
});

describe('themeStore — signed-out / auth-independent', () => {
  it('never imports anything auth-related — zero auth coupling by construction', () => {
    const src = fs.readFileSync(path.join(__dirname, 'themeStore.ts'), 'utf8');
    // Checks actual import statements only (not prose in comments, which
    // freely discusses "signed-in/signed-out" and "auth" as context).
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/authStore|supabase|useAuth/i);
    }
  });

  it('resolves and updates preference with no signed-in user/session in play at all', () => {
    // Nothing in this test touches auth — the store must work in complete
    // isolation, exactly as it does on Welcome/Login (signed-out screens).
    expect(useThemeStore.getState().preference).toBe('system');
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
  });
});
