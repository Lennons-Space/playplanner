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
import { useLocation } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useNearbyVenues } from '@/hooks/useVenues';
import { getWeatherBadge } from '@/lib/weather';
import { curateVenues } from '@/lib/curation';
import { calculateRecommendationScore } from '@/lib/recommendations/familyScore';
import { deriveVenueBadges } from '@/lib/quickFilters';
import { VenueCard } from '@/components/ui';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue } from '@/types';

const C = {
  ink: '#1D2630',
  mute: '#7B8794',
  skyDeep: '#1B8A85',
} as const;

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
    // Only enable when location is resolved AND we have valid coordinates.
    // This prevents the query from firing with the FALLBACK_LOCATION (London)
    // during the brief moment before GPS resolves.
    !locLoading && ready,
  );

  // Pre-sort by recommendation score so that when curateVenues encounters
  // tied curation scores, the tiebreak favours the more family-appropriate
  // venue rather than raw RPC insertion order.
  //
  // WHY this is safe: curateVenues re-sorts entirely by its own scoring, so
  // this pre-sort only affects ties. It does NOT change Supabase calls,
  // discovery_approved filters, or the Venue type. Map markers are unaffected
  // because they use a separate useNearbyVenues call in the map screen.
  const ranked = useMemo(
    () =>
      [...venues].sort(
        (a, b) =>
          calculateRecommendationScore(b).recommendationScore -
          calculateRecommendationScore(a).recommendationScore,
      ),
    [venues],
  );

  // Curate to the top 3 using context. 'auto' lets weather decide the lean.
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
      <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 18, color: C.ink, letterSpacing: -0.3 }}>
        Good right now
      </Text>
      <TouchableOpacity onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all suggestions">
        <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 13, color: C.skyDeep }}>See all</Text>
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;
  // Show skeletons only while location OR venue data is actively loading.
  // If location is not ready (no GPS fix yet) AND we're still loading, show
  // skeletons. But if location is done and venue query is disabled (no coords),
  // fall through to the empty state rather than spinning indefinitely.
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
      <Text style={{ paddingHorizontal: 20, fontFamily: 'Nunito-Regular', fontSize: 13, color: C.mute }}>
        Couldn’t load nearby places. Pull to refresh, or tap “Find something for us”.
      </Text>
    );
  } else if (curated.length === 0) {
    body = (
      <Text style={{ paddingHorizontal: 20, fontFamily: 'Nunito-Regular', fontSize: 13, color: C.mute }}>
        Nothing close by right now — try “Find something for us” to widen the search.
      </Text>
    );
  } else {
    body = (
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {curated.map(({ venue }) => {
          const { recommendationScore } = calculateRecommendationScore(venue);
          return (
            <VenueCard
              key={venue.id}
              venue={venue}
              onPress={() => onVenuePress(venue)}
              weatherBadge={weather ? getWeatherBadge(venue.category?.slug, weather.condition) : null}
              familyBadges={deriveVenueBadges(venue, recommendationScore)}
            />
          );
        })}
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
