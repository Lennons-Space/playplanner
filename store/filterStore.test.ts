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

  // Adding facilities should add 1
  it('counts non-empty facilityIds as 1 active filter', () => {
    useFilterStore.getState().setFilters({ facilityIds: ['fac-1'] });
    expect(useFilterStore.getState().activeFilterCount()).toBe(1);
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

  // Multiple filters active at once — verify they all add up
  it('counts all active filters correctly when several are set', () => {
    useFilterStore.getState().setFilters({
      openNow: true,           // +1
      maxDistanceKm: 25,       // +1
      categoryIds: ['cat-1'],  // +1
      facilityIds: ['fac-1'],  // +1
      minAge: 2,               // +1
      maxAge: 10,              // +1
      priceRange: ['free'],    // +1
    });
    expect(useFilterStore.getState().activeFilterCount()).toBe(7);
  });

  // After reset, count goes back to 0
  it('returns 0 after resetFilters', () => {
    useFilterStore.getState().setFilters({ openNow: true, maxDistanceKm: 50 });
    useFilterStore.getState().resetFilters();
    expect(useFilterStore.getState().activeFilterCount()).toBe(0);
  });
});
