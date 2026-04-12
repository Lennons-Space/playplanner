/**
 * FilterSheet.test.tsx
 *
 * Regression tests for bugs found and fixed in the FilterSheet review.
 *
 * Each describe/it block has a one-line comment explaining what real-world
 * failure the test would catch if the fix was ever reverted.
 *
 * --- Bugs covered ---
 * 1. Draft reset while sheet is open: a useEffect watching storedFilters
 *    would overwrite in-progress changes whenever the store updated.
 *    Fix: storedFilters intentionally excluded from the useEffect dep array.
 *
 * 2. Apply button: must call setFilters with the current draft, not the
 *    stored filters — otherwise mid-session changes are silently discarded.
 *
 * 3. Reset button: must call resetFilters so the Zustand store is cleared,
 *    not just the local draft.
 *
 * 4. Category error message: old text "Pull to retry" was wrong (there is no
 *    pull-to-refresh on the sheet). Fixed to "Try closing and reopening filters".
 *
 * 5. AgeStepper impossible range: setting maxAge below minAge must pull
 *    minAge down to match; without the fix minAge > maxAge was possible.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Imports after mocks ───────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase';
import { useFilterStore } from '@/store/filterStore';
import { DEFAULT_FILTERS } from '@/types';
import type { VenueFilters } from '@/types';
import FilterSheet from '../FilterSheet';

// ─── Module mocks ──────────────────────────────────────────────────────────────
//
// These must come before the component import so Jest hoists them before
// the module graph is resolved.

// NativeAnimatedTurboModule — Animated.spring with useNativeDriver:true calls into
// the native module, which does not exist in the Jest/JSDOM environment.
// Mocking this module prevents the crash and lets Animated run in JS-only mode.
jest.mock('react-native/Libraries/Animated/NativeAnimatedTurboModule', () => ({
  startAnimatingNode: jest.fn(),
  stopAnimation: jest.fn(),
  connectAnimatedNodes: jest.fn(),
  disconnectAnimatedNodes: jest.fn(),
  createAnimatedNode: jest.fn(),
  dropAnimatedNode: jest.fn(),
  setAnimatedNodeValue: jest.fn(),
  setAnimatedNodeOffset: jest.fn(),
  flattenAnimatedNodeOffset: jest.fn(),
  extractAnimatedNodeOffset: jest.fn(),
  connectAnimatedNodeToView: jest.fn(),
  disconnectAnimatedNodeFromView: jest.fn(),
  restoreDefaultValues: jest.fn(),
  addAnimatedEventToView: jest.fn(),
  removeAnimatedEventFromView: jest.fn(),
  getValue: jest.fn(),
}));

// Supabase — return an empty categories list by default so the component
// renders without hitting the network.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

// filterStore — we control the values returned to the component so each
// test can set up the exact starting state it needs.
jest.mock('@/store/filterStore', () => ({
  useFilterStore: jest.fn(),
}));

// NativeWind / tailwind — not relevant to these tests; stub it out to avoid
// transform errors in the Jest environment.
jest.mock('nativewind', () => ({
  styled: (c: unknown) => c,
}));

// ─── Type helpers ──────────────────────────────────────────────────────────────

const mockUseFilterStore = useFilterStore as jest.MockedFunction<typeof useFilterStore>;
const mockSupabaseFrom   = supabase.from   as jest.Mock;

// ─── QueryClient wrapper ───────────────────────────────────────────────────────
//
// FilterSheet uses useQuery (TanStack React Query) to fetch categories.
// Every render must be wrapped in a QueryClientProvider.
// retry: false keeps tests fast — no 3-retry delay on deliberate errors.

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  // A fresh client per test prevents query cache from leaking between tests.
  const qc = React.useRef(makeQueryClient()).current;
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─── Default store mock ────────────────────────────────────────────────────────
//
// Build a realistic store mock. Individual tests override specific fields.

function buildStoreMock(overrides: Partial<{
  filters:      VenueFilters;
  setFilters:   jest.Mock;
  resetFilters: jest.Mock;
  activeFilterCount: jest.Mock;
}> = {}) {
  return {
    filters:           overrides.filters      ?? { ...DEFAULT_FILTERS },
    setFilters:        overrides.setFilters    ?? jest.fn(),
    resetFilters:      overrides.resetFilters  ?? jest.fn(),
    activeFilterCount: overrides.activeFilterCount ?? jest.fn().mockReturnValue(0),
  };
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Default Supabase behaviour: empty categories, no error.
  mockSupabaseFrom.mockReturnThis();
  (supabase.select as jest.Mock).mockReturnThis();
  (supabase.order  as jest.Mock).mockResolvedValue({ data: [], error: null });

  // Default store mock — all defaults, no-op actions.
  mockUseFilterStore.mockReturnValue(buildStoreMock() as any);
});

// ══════════════════════════════════════════════════════════════════════════════
// describe: FilterSheet
// ══════════════════════════════════════════════════════════════════════════════

describe('FilterSheet', () => {

  // ── Test 1: Draft must not reset while the sheet is open ───────────────────
  //
  // Regression: if storedFilters is added back to the useEffect dep array, any
  // store update (e.g. another screen calling setFilters) would silently
  // overwrite the user's in-progress choices — changes they had not yet applied.

  it('draft does not reset to storedFilters while the sheet is open', async () => {
    // Arrange: start with the store holding default filters.
    const setFilters   = jest.fn();
    const resetFilters = jest.fn();

    mockUseFilterStore.mockReturnValue(
      buildStoreMock({ setFilters, resetFilters }) as any,
    );

    const onClose = jest.fn();
    const { rerender } = render(
      <FilterSheet visible={true} onClose={onClose} />,
      { wrapper: Wrapper },
    );

    // Act: the user presses one of the price chips to change the draft.
    // "Free" chip should be present because PRICE_OPTIONS always renders.
    await waitFor(() => {
      screen.getByLabelText('Free');
    });
    fireEvent.press(screen.getByLabelText('Free'));

    // Simulate a store update arriving from outside (another screen called
    // setFilters). We re-render with a new storedFilters value to trigger any
    // useEffect that watches storedFilters. If the bug were present, the draft
    // would be reset to these new stored filters and "Free" would be deselected.
    mockUseFilterStore.mockReturnValue(
      buildStoreMock({
        filters:      { ...DEFAULT_FILTERS, openNow: true },  // store changed externally
        setFilters,
        resetFilters,
      }) as any,
    );

    await act(async () => {
      rerender(<FilterSheet visible={true} onClose={onClose} />);
    });

    // Assert: "Free" chip must still appear selected.
    // (accessibility state checked=true means selected in our Chip component)
    const freeChip = screen.getByLabelText('Free');
    expect(freeChip.props.accessibilityState?.checked).toBe(true);
  });

  // ── Test 2: Apply calls setFilters with the current draft ──────────────────
  //
  // Regression: if handleApply passed storedFilters instead of the local draft,
  // all in-progress changes would be silently thrown away on Apply.

  it('pressing Apply commits the current draft to the store via setFilters', async () => {
    const setFilters = jest.fn();

    mockUseFilterStore.mockReturnValue(
      buildStoreMock({ setFilters }) as any,
    );

    const onClose = jest.fn();
    render(
      <FilterSheet visible={true} onClose={onClose} />,
      { wrapper: Wrapper },
    );

    // Wait for the sheet to be ready, then press Apply.
    await waitFor(() => {
      screen.getByLabelText('Apply filters');
    });
    fireEvent.press(screen.getByLabelText('Apply filters'));

    // setFilters must have been called exactly once with an object that at
    // minimum contains the DEFAULT_FILTERS shape (the draft starts as a copy
    // of storedFilters, which is DEFAULT_FILTERS here).
    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryIds:   DEFAULT_FILTERS.categoryIds,
        openNow:       DEFAULT_FILTERS.openNow,
        maxDistanceKm: DEFAULT_FILTERS.maxDistanceKm,
      }),
    );
  });

  // ── Test 3: Reset calls resetFilters on the store ──────────────────────────
  //
  // Regression: if handleReset only cleared the local draft (setDraft) and
  // forgot to call resetFilters(), the Zustand store would keep the old values
  // and the map would NOT update — the reset button would appear to do nothing.

  it('pressing Reset calls resetFilters on the store', async () => {
    const resetFilters = jest.fn();

    mockUseFilterStore.mockReturnValue(
      buildStoreMock({ resetFilters }) as any,
    );

    const onClose = jest.fn();
    render(
      <FilterSheet visible={true} onClose={onClose} />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      screen.getByLabelText('Reset all filters');
    });
    fireEvent.press(screen.getByLabelText('Reset all filters'));

    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  // ── Test 4: Category error message is correct ──────────────────────────────
  //
  // Regression: the old error message "Pull to retry" was wrong — the sheet
  // has no pull-to-refresh gesture. The correct message tells the parent to
  // close and reopen the filters. If reverted, parents would try to pull and
  // get no response, thinking the app was broken.

  it('shows the correct error message when category fetch fails', async () => {
    // Override Supabase to return an error for this test only.
    mockSupabaseFrom.mockReturnThis();
    (supabase.select as jest.Mock).mockReturnThis();
    (supabase.order  as jest.Mock).mockResolvedValue({
      data:  null,
      error: { message: 'network error', code: '500' },
    });

    render(
      <FilterSheet visible={true} onClose={jest.fn()} />,
      { wrapper: Wrapper },
    );

    // The correct fixed text must appear.
    await waitFor(() => {
      screen.getByText('Could not load categories. Try closing and reopening filters.');
    });

    // Defensive: the old wrong text must NOT appear.
    expect(() => screen.getByText(/Pull to retry/i)).toThrow();
  });

  // ── Test 5: AgeStepper prevents impossible min > max range ────────────────
  //
  // Regression: if the setMaxAge handler did not also adjust minAge, a parent
  // could set minAge=8, maxAge=3, which is logically impossible. The RPC would
  // either return no results or behave unpredictably, with no UI error shown.

  it('setting maxAge below current minAge pulls minAge down to match', async () => {
    // We test the state logic by inspecting what setFilters is called with
    // after the user presses Apply, having first set up a min > max scenario.
    //
    // The setMaxAge callback in FilterSheet uses functional setState, so we
    // can verify the invariant by checking the draft that Apply commits.

    const setFilters = jest.fn();

    // Start the store with minAge=8, maxAge=12 already applied.
    mockUseFilterStore.mockReturnValue(
      buildStoreMock({
        filters:    { ...DEFAULT_FILTERS, minAge: 8, maxAge: 12 },
        setFilters,
      }) as any,
    );

    const onClose = jest.fn();
    render(
      <FilterSheet visible={true} onClose={onClose} />,
      { wrapper: Wrapper },
    );

    // Wait for the sheet to be ready.
    await waitFor(() => {
      screen.getByLabelText('Apply filters');
    });

    // Decrease Max age from 12 down to below current Min age (8).
    // Each press of "Decrease Max age" decrements by 1 in AgeStepper.
    // We press it 5 times to go 12 → 11 → 10 → 9 → 8 → 7.
    // At 7 the fix should have clamped minAge down to 7 as well.
    //
    // Note: we re-query before each press. Each fireEvent triggers a re-render
    // which invalidates the previous element reference — using a stale ref means
    // subsequent presses silently no-op and maxAge stays at 11.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Decrease Max age'));
      });
    }

    // Commit the draft to see what was built.
    fireEvent.press(screen.getByLabelText('Apply filters'));

    expect(setFilters).toHaveBeenCalledTimes(1);

    const committed: VenueFilters = setFilters.mock.calls[0][0];

    // The fix: both values track together.
    // maxAge should be 7 (5 decrements from 12).
    // minAge (was 8) must have been pulled down to match maxAge (7).
    expect(committed.maxAge).toBe(7);
    expect(committed.minAge).toBe(7); // clamped down from 8
  });
});
