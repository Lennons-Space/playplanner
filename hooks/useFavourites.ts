// ─────────────────────────────────────────────────────────────────────────
// useFavourites — shared saved-venues helpers.
//
// Favourites already existed inline in two places (app/(tabs)/favourites.tsx
// delete, app/venue/[id].tsx insert/delete). The Play Planner v2 Home + Saved
// screens both need to (a) know which venues are saved and (b) toggle a save,
// so this centralises the SAME pattern (favourites table, user-scoped, RLS is
// the real boundary) into one reusable hook. No new feature — the save action
// is the existing favourites feature surfaced in the v2 UI.
//
// Data minimisation: the saved-ids query selects only `venue_id`.
// ─────────────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';

/**
 * Returns the set of venue IDs the signed-in user has saved. Empty set while
 * loading / signed out. Used to render the correct heart state on cards.
 */
export function useSavedVenueIds() {
  const user = useUser();
  const query = useQuery<Set<string>>({
    queryKey: ['favourites', 'ids', user?.id],
    queryFn: async () => {
      if (!user?.id) return new Set<string>();
      const { data, error } = await supabase
        .from('favourites')
        .select('venue_id')
        .eq('user_id', user.id);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.venue_id as string));
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });
  return { savedIds: query.data ?? new Set<string>(), isLoading: query.isLoading };
}

/**
 * Toggle a venue's saved state. Inserts when not saved, deletes when saved.
 * Invalidates the favourites caches so every screen (Home cards, Saved grid)
 * reflects the change. `.eq('user_id', ...)` is belt-and-braces — RLS on the
 * favourites table is the authoritative security boundary.
 */
export function useToggleFavourite() {
  const user = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ venueId, currentlySaved }: { venueId: string; currentlySaved: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (currentlySaved) {
        const { error } = await supabase
          .from('favourites')
          .delete()
          .eq('user_id', user.id)
          .eq('venue_id', venueId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('favourites')
          .insert({ user_id: user.id, venue_id: venueId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favourites'] });
    },
  });
}
