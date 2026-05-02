import { create } from 'zustand';

interface MapStore {
  pendingPostcode: string | null;
  setPendingPostcode: (postcode: string | null) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  pendingPostcode: null,
  setPendingPostcode: (postcode) => set({ pendingPostcode: postcode }),
}));
