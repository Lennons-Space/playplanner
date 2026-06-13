import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getRecentlyViewed, type RecentlyViewedVenue } from '@/lib/recentlyViewed';

export interface UseRecentlyViewed {
  items: RecentlyViewedVenue[];
  loading: boolean;
}

/**
 * Loads the locally-stored "recently viewed" venues. Reloads every time the
 * host screen regains focus (useFocusEffect), so returning to Home after
 * opening a venue shows the freshly-recorded entry without any global state.
 *
 * Local only — no network, no Supabase, no recommendation impact.
 */
export function useRecentlyViewed(): UseRecentlyViewed {
  const [items, setItems] = useState<RecentlyViewedVenue[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getRecentlyViewed()
        .then((list) => {
          if (active) {
            setItems(list);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  return { items, loading };
}
