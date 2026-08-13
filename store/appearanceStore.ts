// ─────────────────────────────────────────────────────────────────────────
// appearanceStore — the live, app-wide resolved light/dark THEME state,
// built on the pure resolver in lib/timeAppearance.ts. This is the ONE
// central source hooks/useAppTheme.ts consumes; nothing else in the app may
// independently decide light vs dark.
//
// Resolution is authoritative and NOT influenced by:
//   - the OS colour scheme (react-native's useColorScheme/Appearance) — this
//     module never reads it, and useAppTheme.ts no longer does either.
//   - the legacy store/themeStore.ts 'system'|'light'|'dark' preference —
//     that store (+ its AsyncStorage persistence) is kept as-is only for
//     data compatibility with any already-installed app; it is no longer
//     read anywhere in the visual-resolution path. See
//     app/profile/appearance.tsx for the corresponding UI change (an
//     Automatic-only explainer, no picker, no writes to that store).
//
// Live boundary switching: a single process-wide setTimeout is scheduled for
// the NEXT 07:00/19:00 boundary (lib/timeAppearance.ts#msUntilNextBoundary)
// — never a per-second/per-minute poll.
//
// Foreground/resume: an AppState listener recomputes immediately whenever
// the app becomes 'active'. This is the authoritative resync point (not just
// a nice-to-have): a setTimeout scheduled while the app is backgrounded is
// not guaranteed to fire exactly on time (or at all, on every OS/power
// state) while suspended, so foreground-return re-derives the correct
// appearance straight from the current clock regardless of what the
// background timer did, then reschedules the boundary timer from now.
//
// Both the timer and the AppState subscription are process-wide singletons
// (guarded by `started`) — started once via useAppTheme()'s mount effect,
// not one per component instance, so mounting useAppTheme() on N screens
// simultaneously never creates N timers/listeners.
// ─────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import { resolveTimeAppearance, msUntilNextBoundary, type Appearance } from '@/lib/timeAppearance';

interface AppearanceState {
  /** The resolved app THEME — never null, always derived from the clock. */
  mode: Appearance;
  /** Re-resolves `mode` from `date` (defaults to now). Exposed for tests + the scheduler below. */
  recompute: (date?: Date) => void;
}

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: resolveTimeAppearance(),
  recompute: (date = new Date()) => set({ mode: resolveTimeAppearance(date) }),
}));

let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let started = false;

function scheduleNextBoundary() {
  if (boundaryTimer) clearTimeout(boundaryTimer);
  boundaryTimer = setTimeout(() => {
    useAppearanceStore.getState().recompute();
    scheduleNextBoundary();
  }, msUntilNextBoundary(new Date()));
}

function handleAppStateChange(state: AppStateStatus) {
  if (state === 'active') {
    useAppearanceStore.getState().recompute();
    scheduleNextBoundary();
  }
}

/**
 * Starts the process-wide boundary timer + AppState listener. Idempotent —
 * safe to call from every useAppTheme() mount. Skipped under Jest
 * (NODE_ENV === 'test') by default so unit tests never leak a real
 * setTimeout/AppState subscription across the suite; pass `{ force: true }`
 * to opt in (used only by this module's own scheduler tests, which manage
 * fake timers and explicit teardown via stopAppearanceScheduler()).
 */
export function startAppearanceScheduler(options?: { force?: boolean }): void {
  if (started) return;
  if (process.env.NODE_ENV === 'test' && !options?.force) return;
  started = true;
  scheduleNextBoundary();
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

/** Test-only teardown — clears the timer/listener and resets the idempotency guard. */
export function stopAppearanceScheduler(): void {
  if (boundaryTimer) {
    clearTimeout(boundaryTimer);
    boundaryTimer = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  started = false;
}
