import { create } from 'zustand';
import { VenueFilters, DEFAULT_FILTERS } from '@/types';

interface FilterState {
  filters: VenueFilters;
  setFilters: (filters: Partial<VenueFilters>) => void;
  resetFilters: () => void;
  activeFilterCount: () => number;
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filters: DEFAULT_FILTERS,

  setFilters: (partial) =>
    set((state) => ({ filters: { ...state.filters, ...partial } })),

  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  // How many filters are active (shown as a badge on the filter button)
  activeFilterCount: () => {
    const f = get().filters;
    let count = 0;
    if (f.categoryIds.length)  count++;
    if (f.facilityIds.length)  count++;
    if (f.minAge !== null)     count++;
    if (f.maxAge !== null)     count++;
    if (f.priceRange.length)   count++;
    if (f.openNow)             count++;
    if (f.maxDistanceKm !== DEFAULT_FILTERS.maxDistanceKm) count++;
    return count;
  },
}));
