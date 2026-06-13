// ─────────────────────────────────────────────────────────────────────────
// Recently viewed venues — LOCAL ONLY (AsyncStorage). No backend, no Supabase
// table, no analytics, no network. Records venues a parent opened so Home can
// offer "continue where you left off".
//
// Stored shape is a SLIM, honest subset of the venue (id/name/photo/category +
// real rating counts). Distance is intentionally NOT stored — it's relative to
// the user's current location, so a saved distance would be stale; the card
// simply omits distance for recents rather than show a wrong number.
// ─────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

export const RECENTLY_VIEWED_KEY = 'playplanner.recentlyViewed.v1';
export const MAX_RECENTLY_VIEWED = 10;

export interface RecentlyViewedVenue {
  id: string;
  name: string;
  cover_photo_url?: string | null;
  average_rating?: number;
  review_count?: number;
  /** Minimal category info for the card tint/label. */
  category?: { slug: string | null } | null;
}

/** Minimal shape we can record — a full Venue is structurally compatible. */
interface RecordableVenue {
  id?: string | null;
  name?: string | null;
  cover_photo_url?: string | null;
  average_rating?: number | null;
  review_count?: number | null;
  category?: { slug?: string | null } | null;
}

/** Map an incoming venue to the slim stored shape. Null if not a real venue. */
function toSlim(venue: RecordableVenue | null | undefined): RecentlyViewedVenue | null {
  if (!venue || !venue.id || !venue.name) return null;
  return {
    id: venue.id,
    name: venue.name,
    cover_photo_url: venue.cover_photo_url ?? null,
    average_rating: typeof venue.average_rating === 'number' ? venue.average_rating : undefined,
    review_count: typeof venue.review_count === 'number' ? venue.review_count : undefined,
    category: venue.category?.slug ? { slug: venue.category.slug } : null,
  };
}

/** Pure: drop duplicate ids, keeping the FIRST occurrence (front-most). */
export function removeDuplicates(list: RecentlyViewedVenue[]): RecentlyViewedVenue[] {
  const seen = new Set<string>();
  const out: RecentlyViewedVenue[] = [];
  for (const v of list) {
    if (v && v.id && !seen.has(v.id)) {
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
}

/** Pure: cap the list to the maximum length (default 10), front-most kept. */
export function keepMaximumTen(
  list: RecentlyViewedVenue[],
  max: number = MAX_RECENTLY_VIEWED,
): RecentlyViewedVenue[] {
  return list.slice(0, max);
}

/** Read the persisted list (most-recent first). Never throws. */
export async function getRecentlyViewed(): Promise<RecentlyViewedVenue[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: only keep well-formed entries.
    return keepMaximumTen(
      removeDuplicates(
        parsed.filter(
          (v): v is RecentlyViewedVenue =>
            !!v && typeof v.id === 'string' && typeof v.name === 'string',
        ),
      ),
    );
  } catch {
    return [];
  }
}

/**
 * Record a venue view: moves it to the front, de-dupes, caps at 10, persists.
 * Returns the updated list. Never throws; a no-op for non-real venues.
 */
export async function addRecentlyViewed(
  venue: RecordableVenue | null | undefined,
): Promise<RecentlyViewedVenue[]> {
  const slim = toSlim(venue);
  if (!slim) return getRecentlyViewed();

  const current = await getRecentlyViewed();
  const next = keepMaximumTen(removeDuplicates([slim, ...current]));
  try {
    await AsyncStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    // Persistence failure is non-fatal — recents are a convenience only.
  }
  return next;
}
