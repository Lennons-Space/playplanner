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

  // How many filters are active (shown as a badge on the filter button).
  //
  // TODO: premiumOnly and facilityIds are excluded from the count because they
  // are not yet wired up to the get_nearby_venues SQL RPC — counting them would
  // show an incremented badge while results remain unchanged, misleading users.
  // Re-enable these once the RPC supports premium and facility filtering.
  activeFilterCount: () => {
    const f = get().filters;
    let count = 0;
    if (f.categoryIds.length)  count++;
    // facilityIds — excluded until SQL RPC supports facility filtering
    if (f.minAge !== null)     count++;
    if (f.maxAge !== null)     count++;
    if (f.priceRange.length)   count++;
    if (f.openNow)             count++;
    if (f.maxDistanceKm !== DEFAULT_FILTERS.maxDistanceKm) count++;
    // premiumOnly — excluded until SQL RPC supports premium filtering
    return count;
  },
}));
