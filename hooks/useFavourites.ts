// ─────────────────────────────────────────────────────────────────────────
// useFavourites — shared saved-venues helpers for the Play Planner v2 Home.
//
// Favourites already existed inline in two places:
//   - app/(tabs)/favourites.tsx  — list query key ['favourites', user?.id],
//     delete-only mutation.
//   - app/venue/[id].tsx         — per-venue query key
//     ['favourite', user?.id, venueId], insert/delete mutation that
//     invalidates BOTH ['favourite', user?.id, venueId] and
//     ['favourites', user?.id].
//
// This hook centralises the SAME pattern (favourites table, user-scoped, RLS
// is the real security boundary) for the new v2 Home cards, which need to (a)
// know which venues are saved and (b) toggle a save. It is purely additive —
// app/(tabs)/favourites.tsx and app/venue/[id].tsx are NOT modified.
//
// CACHE INVALIDATION — why we invalidate THREE keys, not one:
// React Query's invalidateQueries is prefix-matched, so invalidating
// ['favourites'] catches both this hook's own ids query
// (['favourites','ids',user?.id]) and the Saved-tab list
// (['favourites', user?.id]) — but it does NOT catch the venue detail
// screen's singular key (['favourite', user?.id, venueId]), because
// 'favourite' and 'favourites' are different first segments. Without the
// explicit third invalidation below, toggling save from a v2 Home card would
// leave a stale heart icon on the venue detail page for that venue until its
// own query happened to refetch for an unrelated reason.
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
 * Invalidates every favourites cache so every screen (Home cards, Saved grid,
 * venue detail heart) reflects the change. `.eq('user_id', ...)` is
 * belt-and-braces — RLS on the favourites table is the authoritative
 * security boundary.
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
    onSuccess: (_data, variables) => {
      // Catches ['favourites','ids',user?.id] (this hook) and
      // ['favourites', user?.id] (the Saved tab list) — prefix match.
      queryClient.invalidateQueries({ queryKey: ['favourites'] });
      // Does NOT overlap with the prefix above ('favourite' !== 'favourites')
      // — the venue detail screen's own heart would otherwise go stale.
      queryClient.invalidateQueries({ queryKey: ['favourite', user?.id, variables.venueId] });
    },
  });
}
