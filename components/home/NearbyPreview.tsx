// ─────────────────────────────────────────────────────────────────
// NearbyPreview — a short "good right now" teaser on the Home screen.
//
// IMPORTANT (privacy): this component calls useLocation(), which can
// trigger the OS location prompt. It must therefore ONLY be mounted once
// the user has GRANTED location consent (the Home screen guards this via
// useLocationConsent). When consent is missing, Home renders a calm
// prompt card instead — never this.
//
// It is a teaser, not a feed: at most three curated cards, then a clear
// "See all" into the full decision flow.
// ─────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, FontFamily } from '@/constants/theme';
import { useLocation } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { getWeatherBadge } from '@/lib/weather';
import { curateVenues } from '@/lib/curation';
import { calculateRecommendationScore } from '@/lib/recommendations/familyScore';
import { generateRecommendationReasons } from '@/lib/recommendations/recommendationReasons';
import { VenueCard } from '@/components/ui';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue, Category } from '@/types';

export interface NearbyPreviewProps {
  onSeeAll: () => void;
  onVenuePress: (venue: Venue) => void;
}

export function NearbyPreview({ onSeeAll, onVenuePress }: NearbyPreviewProps) {
  const { coords, isLoading: locLoading } = useLocation();

  const ready = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  const center = ready ? coords : FALLBACK_LOCATION;

  const weather = useWeather(center.latitude, center.longitude);

  const { data: venues = [], isLoading, error } = useNearbyVenues(
    center,
    DEFAULT_FILTERS,
    !locLoading && ready,
  );

  // ── Category enrichment ──────────────────────────────────────────────────
  // get_nearby_venues RPC returns `category_id` (UUID) but no `category` object
  // (see supabase/migrations/045). Without a joined `category`, every
  // category-slug-driven signal goes dead: weather badges, time-of-day /
  // temperature / indoor-outdoor curation boosts, mood scoring, and the
  // "Great For Toddlers" / "Rainy Day Winner" / "Burn Energy" reason badges
  // from generateRecommendationReasons() all silently no-op.
  //
  // This mirrors the proven pattern in app/explore/results.tsx (~line 172-191)
  // so Home and the full Results screen rank/curate venues consistently.
  const { data: categories = [] } = useCategories();
  const categoryMap = useMemo<Record<string, Category>>(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );
  const enrichedVenues = useMemo(
    () =>
      venues.map((v) => ({
        ...v,
        category: v.category ?? (v.category_id ? categoryMap[v.category_id] : undefined),
      })),
    [venues, categoryMap],
  );

  // Pre-sort by recommendation score so that curation tiebreaks favour
  // the more family-appropriate venue rather than raw RPC insertion order.
  const ranked = useMemo(
    () =>
      [...enrichedVenues].sort(
        (a, b) =>
          calculateRecommendationScore(b).recommendationScore -
          calculateRecommendationScore(a).recommendationScore,
      ),
    [enrichedVenues],
  );

  const curated = useMemo(
    () => curateVenues(ranked, { weather, mood: 'auto' }, { limit: 3 }),
    [ranked, weather],
  );

  const header = (
    <View
      style={{
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}
    >
      <Text style={{ fontFamily: FontFamily.heading, fontSize: 18, color: Colors.label, letterSpacing: -0.3 }}>
        Good for today
      </Text>
      <TouchableOpacity onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all suggestions">
        <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: Colors.accent }}>See all</Text>
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;
  const isActuallyLoading = (locLoading && !ready) || (ready && isLoading);
  if (isActuallyLoading) {
    body = (
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <VenueRowSkeleton />
        <VenueRowSkeleton />
      </View>
    );
  } else if (error) {
    body = (
      <Text style={{ paddingHorizontal: 20, fontFamily: FontFamily.body, fontSize: 13, color: Colors.label3 }}>
        Couldn't load nearby places. Pull to refresh, or tap "Find something for us".
      </Text>
    );
  } else if (curated.length === 0) {
    body = (
      <Text style={{ paddingHorizontal: 20, fontFamily: FontFamily.body, fontSize: 13, color: Colors.label3 }}>
        Nothing close by right now — try "Find something for us" to widen the search.
      </Text>
    );
  } else {
    body = (
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {curated.map(({ venue }) => (
          <VenueCard
            key={venue.id}
            venue={venue}
            onPress={() => onVenuePress(venue)}
            weatherBadge={weather ? getWeatherBadge(venue.category?.slug, weather.condition) : null}
            familyBadges={generateRecommendationReasons(venue)}
          />
        ))}
      </View>
    );
  }

  return (
    <View>
      {header}
      {body}
    </View>
  );
}
