/**
 * Tests for the venue filter Zustand store (store/filterStore.ts).
 *
 * NOTE: If these tests fail with "Cannot find module '@/types'", the Jest
 * config in package.json needs a moduleNameMapper entry for the @/ alias.
 * See the instructions at the bottom of this file or in the test output.
 */

import { useFilterStore } from './filterStore';
import { DEFAULT_FILTERS } from '../types';

// Reset the store to its initial state before every test so tests
// don't affect each other (shared mutable state = flaky tests).
beforeEach(() => {
  useFilterStore.setState({ filters: { ...DEFAULT_FILTERS } });
});

// ======================================================================
// Default state
// ======================================================================
describe('default state', () => {
  // The store should start with the same defaults defined in types/index.ts
  it('matches DEFAULT_FILTERS on initialisation', () => {
    const { filters } = useFilterStore.getState();
    expect(filters).toEqual(DEFAULT_FILTERS);
  });

  // Confirm specific default values that the app relies on
  it('has maxDistanceKm of 10 by default', () => {
    expect(useFilterStore.getState().filters.maxDistanceKm).toBe(10);
  });

  it('has openNow as false by default', () => {
    expect(useFilterStore.getState().filters.openNow).toBe(false);
  });

  it('has empty categoryIds by default', () => {
    expect(useFilterStore.getState().filters.categoryIds).toEqual([]);
  });

  it('has minAge and maxAge as null by default', () => {
    const { minAge, maxAge } = useFilterStore.getState().filters;
    expect(minAge).toBeNull();
    expect(maxAge).toBeNull();
  });
});

// ======================================================================
// setFilters
// ======================================================================
describe('setFilters', () => {
  // Updating one filter should not reset the others
  it('updates only the specified keys, leaving others unchanged', () => {
    useFilterStore.getState().setFilters({ openNow: true });

    const filters = useFilterStore.getState().filters;
    expect(filters.openNow).toBe(true);
    // Everything else should still match defaults
    expect(filters.maxDistanceKm).toBe(DEFAULT_FILTERS.maxDistanceKm);
    expect(filters.categoryIds).toEqual(DEFAULT_FILTERS.categoryIds);
  });

  // Setting multiple filters at once
  it('can update multiple filters in one call', () => {
    useFilterStore.getState().setFilters({
      openNow: true,
      maxDistanceKm: 25,
      categoryIds: ['cat-1', 'cat-2'],
    });

    const filters = useFilterStore.getState().filters;
    expect(filters.openNow).toBe(true);
    expect(filters.maxDistanceKm).toBe(25);
    expect(filters.categoryIds).toEqual(['cat-1', 'cat-2']);
  });

  // Setting a filter then changing it again should use the latest value
  it('overwrites a previously set filter', () => {
    useFilterStore.getState().setFilters({ maxDistanceKm: 5 });
    useFilterStore.getState().setFilters({ maxDistanceKm: 50 });
    expect(useFilterStore.getState().filters.maxDistanceKm).toBe(50);
  });

  // Age range filters
  it('sets minAge and maxAge correctly', () => {
    useFilterStore.getState().setFilters({ minAge: 3, maxAge: 8 });
    const { minAge, maxAge } = useFilterStore.getState().filters;
    expect(minAge).toBe(3);
    expect(maxAge).toBe(8);
  });
});

// ======================================================================
// resetFilters
// ======================================================================
describe('resetFilters', () => {
  // After changing filters and resetting, state should match defaults exactly
  it('returns all filters to DEFAULT_FILTERS', () => {
    // Change several filters first
    useFilterStore.getState().setFilters({
      openNow: true,
      maxDistanceKm: 50,
      categoryIds: ['cat-1'],
      minAge: 2,
      maxAge: 10,
      priceRange: ['free', 'budget'],
    });

    // Reset
    useFilterStore.getState().resetFilters();

    expect(useFilterStore.getState().filters).toEqual(DEFAULT_FILTERS);
  });
});

// ======================================================================
// activeFilterCount
// ======================================================================
describe('activeFilterCount', () => {
  // No filters changed = count is 0
  it('returns 0 when all filters are at defaults', () => {
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });

  // Changing openNow should add 1
  it('counts openNow as 1 active filter', () => {
    useFilterStore.getState().setFilters({ openNow: true });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Changing maxDistanceKm from default (10) should add 1
  it('counts a changed maxDistanceKm as 1 active filter', () => {
    useFilterStore.getState().setFilters({ maxDistanceKm: 25 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Setting maxDistanceKm to the default value should NOT count
  it('does not count maxDistanceKm when it equals the default', () => {
    useFilterStore.getState().setFilters({ maxDistanceKm: DEFAULT_FILTERS.maxDistanceKm });
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });

  // Adding categories should add 1 (not 1 per category)
  it('counts non-empty categoryIds as 1 active filter', () => {
    useFilterStore.getState().setFilters({ categoryIds: ['cat-1', 'cat-2', 'cat-3'] });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // facilityIds are stored but intentionally excluded from the count
  // (the venue RPC doesn't filter on them yet — counting would show a
  // non-zero badge while search results are unchanged, which is misleading)
  it('does not count facilityIds (RPC not yet wired up)', () => {
    useFilterStore.getState().setFilters({ facilityIds: ['fac-1'] });
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });

  // minAge alone counts as 1
  it('counts minAge as 1 active filter', () => {
    useFilterStore.getState().setFilters({ minAge: 3 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // maxAge alone counts as 1
  it('counts maxAge as 1 active filter', () => {
    useFilterStore.getState().setFilters({ maxAge: 12 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // minAge + maxAge together count as 2 (they are separate filter criteria)
  it('counts minAge and maxAge as 2 separate active filters', () => {
    useFilterStore.getState().setFilters({ minAge: 2, maxAge: 8 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(2);
  });

  // priceRange counts as 1
  it('counts non-empty priceRange as 1 active filter', () => {
    useFilterStore.getState().setFilters({ priceRange: ['free', 'budget'] });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Multiple filters active at once — verify they all add up.
  // facilityIds is present but must NOT increment the count (excluded).
  it('counts all active filters correctly when several are set', () => {
    useFilterStore.getState().setFilters({
      openNow: true,           // +1
      maxDistanceKm: 25,       // +1
      categoryIds: ['cat-1'],  // +1
      facilityIds: ['fac-1'],  //  0 (excluded — RPC not yet wired up)
      minAge: 2,               // +1
      maxAge: 10,              // +1
      priceRange: ['free'],    // +1
    });
    expect(useFilterStore.getState().activeFilterCount()).toBe(6);
  });

  // After reset, count goes back to 0
  it('returns 0 after resetFilters', () => {
    useFilterStore.getState().setFilters({ openNow: true, maxDistanceKm: 50 });
    useFilterStore.getState().resetFilters();
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });
});

// ======================================================================
// filterStore — regression
//
// These tests lock in fixes for specific bugs found in the review.
// Each test has a comment explaining what real-world failure it guards.
// ======================================================================
describe('filterStore — regression', () => {

  // ── setFilters ────────────────────────────────────────────────────────

  // Regression: if setFilters ever replaced the whole object instead of
  // merging, setting openNow would silently wipe categoryIds, priceRange,
  // and every other field the user had already chosen.
  it('setFilters with a partial update merges — does not wipe other fields', () => {
    // Establish a non-default baseline across several fields
    useFilterStore.getState().setFilters({
      categoryIds:    ['cat-softplay'],
      priceRange:     ['free', 'budget'],
      minAge:         2,
      maxAge:         8,
      maxDistanceKm:  25,
      openNow:        false,
    });

    // Now apply a single-field partial update
    useFilterStore.getState().setFilters({ openNow: true });

    const f = useFilterStore.getState().filters;
    // The partial update must be applied…
    expect(f.openNow).toBe(true);
    // …and every other field must be untouched
    expect(f.categoryIds).toEqual(['cat-softplay']);
    expect(f.priceRange).toEqual(['free', 'budget']);
    expect(f.minAge).toBe(2);
    expect(f.maxAge).toBe(8);
    expect(f.maxDistanceKm).toBe(25);
    expect(f.premiumOnly).toBe(DEFAULT_FILTERS.premiumOnly);
    expect(f.facilityIds).toEqual(DEFAULT_FILTERS.facilityIds);
  });

  // ── resetFilters ──────────────────────────────────────────────────────

  // Regression: if resetFilters only cleared some fields (e.g. forgot
  // categoryIds or minAge), stale filter values would silently persist and
  // the map would keep showing wrong results after the user hit Reset.
  it('resetFilters restores every field to DEFAULT_FILTERS exactly', () => {
    // Dirty every field that DEFAULT_FILTERS defines
    useFilterStore.getState().setFilters({
      categoryIds:   ['cat-1', 'cat-2'],
      facilityIds:   ['fac-1'],
      minAge:        3,
      maxAge:        12,
      priceRange:    ['moderate', 'premium'],
      maxDistanceKm: 1,
      openNow:       true,
      premiumOnly:   true,
    });

    useFilterStore.getState().resetFilters();

    // Every field must exactly match the canonical defaults
    expect(useFilterStore.getState().filters).toEqual(DEFAULT_FILTERS);
  });

  // ── activeFilterCount ─────────────────────────────────────────────────

  // Regression: if activeFilterCount returned > 0 at startup (e.g. it
  // accidentally counted a default value), the filter badge would show a
  // non-zero count before the user had touched anything, which is misleading.
  it('activeFilterCount returns 0 when all filters are at defaults', () => {
    // Store was reset to DEFAULT_FILTERS in beforeEach
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });

  // Regression: if categoryIds was not counted, selecting categories would
  // never increment the badge and users would not know filters are active.
  it('activeFilterCount increments by 1 when categoryIds is non-empty', () => {
    useFilterStore.getState().setFilters({ categoryIds: ['cat-parks'] });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Regression: priceRange not counted → user sets price filter, badge
  // stays at 0, user thinks filter was not applied.
  it('activeFilterCount increments by 1 when priceRange is non-empty', () => {
    useFilterStore.getState().setFilters({ priceRange: ['free'] });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Regression: minAge not counted → age filter silently applied with no
  // badge feedback; parent confused why results look different.
  it('activeFilterCount increments by 1 when minAge is set', () => {
    useFilterStore.getState().setFilters({ minAge: 2 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Regression: maxAge not counted → same hidden-filter confusion as minAge.
  it('activeFilterCount increments by 1 when maxAge is set', () => {
    useFilterStore.getState().setFilters({ maxAge: 10 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Regression: openNow not counted → "Open now" toggle has no visual
  // confirmation in the badge; user reopens sheet confused why it was on.
  it('activeFilterCount increments by 1 when openNow is true', () => {
    useFilterStore.getState().setFilters({ openNow: true });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Regression: maxDistanceKm change not counted → user changes distance
  // from the 10 km default, sees no badge increment, assumes it did nothing.
  it('activeFilterCount increments by 1 when maxDistanceKm differs from the default', () => {
    useFilterStore.getState().setFilters({ maxDistanceKm: 5 });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
  });

  // Regression: if the count logic forgets the exclusion and starts counting
  // facilityIds, the badge would increment for a filter that the RPC ignores,
  // showing "2 filters active" while search results are unchanged — deceptive.
  it('activeFilterCount does NOT count facilityIds (excluded — RPC not yet wired up)', () => {
    useFilterStore.getState().setFilters({ facilityIds: ['fac-parking', 'fac-cafe'] });
    // facilityIds must not contribute to the badge count
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });

  // Regression: same exclusion for premiumOnly — counting it before the RPC
  // supports it would show an incremented badge with no effect on results.
  it('activeFilterCount does NOT count premiumOnly (excluded — RPC not yet wired up)', () => {
    useFilterStore.getState().setFilters({ premiumOnly: true });
    // premiumOnly must not contribute to the badge count
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });

  // Regression: all six counted fields together must each contribute exactly
  // 1, giving a total of 6. If any field is double-counted or skipped the
  // badge number shown to parents would be wrong.
  it('activeFilterCount adds up all six counted fields when set simultaneously', () => {
    useFilterStore.getState().setFilters({
      categoryIds:   ['cat-1'],   // +1
      priceRange:    ['free'],    // +1
      minAge:        2,           // +1
      maxAge:        10,          // +1
      openNow:       true,        // +1
      maxDistanceKm: 1,           // +1 (differs from default of 10)
      // These two must NOT contribute even when set alongside the rest:
      facilityIds:   ['fac-1'],
      premiumOnly:   true,
    });
    expect(useFilterStore.getState().activeFilterCount()).toBe(6);
  });
});
