// ─────────────────────────────────────────────────────────────────────────
// OpenNowRow — "Open right now / Ready to go". Answers "what can we do RIGHT
// NOW?" — distinct from Good for today (hero) and Recently viewed (memory).
//
// DATA: reuses the SAME already-loaded venues as NearbyPreview via React
// Query (useNearbyVenues with the identical key → cache hit, no new network
// request, no new Supabase query). Open status comes ONLY from the shared
// computeIsOpenNow() utility (single source of truth) — venues without hours or
// with an unknown status are excluded; never a fabricated "Open now".
//
// Sort: distance (closest first); when distance is unavailable, soonest closing
// time first. No popularity / recommendation scoring.
//
// Empty state: renders null (the whole section hides) — no placeholders.
// Privacy: only mounted once location consent is granted (see app/(tabs)/index).
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useLocation } from '@/hooks/location';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { computeIsOpenNow, getOpenUntilLabel } from '@/lib/venueAttributes';
import { ExploreCard } from './ExploreCard';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue, Category } from '@/types';

export interface OpenNowRowProps {
  onVenuePress: (venueId: string) => void;
}

export function OpenNowRow({ onVenuePress }: OpenNowRowProps) {
  const { tokens } = useAppTheme();
  const { coords, isLoading: locLoading } = useLocation();

  const ready = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  const center = ready ? coords : FALLBACK_LOCATION;

  // SAME query as NearbyPreview → React Query serves it from cache (no new fetch).
  const { data: venues = [] } = useNearbyVenues(center, DEFAULT_FILTERS, !locLoading && ready);
  const { data: categories = [] } = useCategories();

  const categoryMap = useMemo<Record<string, Category>>(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const openVenues = useMemo(() => {
    const enriched: Venue[] = venues.map((v) => ({
      ...v,
      category: v.category ?? (v.category_id ? categoryMap[v.category_id] : undefined),
    }));

    return enriched
      // Open status + closing time come ONLY from the shared utility. Venues with
      // no hours / unknown status (computeIsOpenNow !== true) are excluded.
      .filter((v) => computeIsOpenNow(v) === true && getOpenUntilLabel(v) != null)
      .sort((a, b) => {
        const da = a.distance_km;
        const db = b.distance_km;
        if (da != null && db != null) return da - db; // closest first
        if (da != null) return -1; // venues with a known distance rank ahead
        if (db != null) return 1;
        // Neither has distance → soonest closing time first.
        return (getOpenUntilLabel(a) ?? '').localeCompare(getOpenUntilLabel(b) ?? '');
      })
      .slice(0, 8);
  }, [venues, categoryMap]);

  // Nothing open → hide the entire section.
  if (openVenues.length === 0) return null;

  return (
    <View style={{ paddingTop: 28 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: FontFamily.display, fontSize: 20, color: tokens.label, letterSpacing: -0.5 }}>
            Open right now
          </Text>
          {/* Subtle live pill */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: 'rgba(28,140,80,0.14)',
              borderRadius: 999,
              paddingHorizontal: 9,
              paddingVertical: 3,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#1C8C50' }} />
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 11, color: '#1C8C50' }}>Live</Text>
          </View>
        </View>
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label, opacity: 0.65, marginTop: 3 }}>
          Ready to go
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}
        style={{ flexGrow: 0 }}
        accessibilityRole="list"
        accessibilityLabel="Venues open right now"
      >
        {openVenues.map((venue) => (
          <ExploreCard
            key={venue.id}
            venue={venue}
            size="md"
            openUntil={getOpenUntilLabel(venue)}
            onPress={() => onVenuePress(venue.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
