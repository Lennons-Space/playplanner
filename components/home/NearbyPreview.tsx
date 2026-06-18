// ─────────────────────────────────────────────────────────────────
// NearbyPreview — the "Good for today" + "Family favourites" teaser on the
// Home screen.
//
// IMPORTANT (privacy): this component calls useLocation(), which can
// trigger the OS location prompt. It must therefore ONLY be mounted once
// the user has GRANTED location consent (the Home screen guards this via
// useLocationConsent). When consent is missing, Home renders a calm
// prompt card instead — never this.
//
// It is a teaser, not a feed: at most three curated venues.
//   - The top-ranked venue renders as a full-bleed SmartFeaturedCard.
//   - The remaining venues render as VenueCard2 rows under a "Family
//     favourites" heading.
//
// Phase 1 Home reskin: the data pipeline (useLocation -> useNearbyVenues ->
// category enrichment -> calculateRecommendationScore -> curateVenues) is
// UNCHANGED from the previous version — only the presentation components
// changed (VenueCard -> SmartFeaturedCard / VenueCard2). See
// __tests__/NearbyPreview.test.tsx for the category-hydration regression
// coverage this preserves.
// ─────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useLocation } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { curateVenues } from '@/lib/curation';
import { calculateRecommendationScore } from '@/lib/recommendations/familyScore';
import { generateRecommendationReasons } from '@/lib/recommendations/recommendationReasons';
import { SmartFeaturedCard } from './SmartFeaturedCard';
import { GoodForTodayFallback } from './GoodForTodayFallback';
import { ExploreCard } from './ExploreCard';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';
import { FALLBACK_LOCATION } from '@/constants/location';
import { getSeasonalCollection, getCollection } from '@/lib/collections';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue, Category } from '@/types';

export interface NearbyPreviewProps {
  onSeeAll: () => void;
  onVenuePress: (venue: Venue) => void;
  /**
   * Open a Discover collection by key — used by the editorial fallback hero
   * when there's no nearby recommendation. Optional so existing tests need no
   * change; Home always provides it. Routing lives in Home (no expo-router here).
   */
  onOpenCollection?: (key: string) => void;
}

export function NearbyPreview({ onSeeAll, onVenuePress, onOpenCollection }: NearbyPreviewProps) {
  const { tokens, accent } = useAppTheme();
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
    // limit 8 = 1 featured hero + up to 7 horizontal "Continue Exploring"
    // cards. This is a presentation cap on the SAME already-loaded venues — no
    // new query, no change to the ranking algorithm.
    () => curateVenues(ranked, { weather, mood: 'auto' }, { limit: 8 }),
    [ranked, weather],
  );

  const featured = curated[0];
  const rest = curated.slice(1);

  // Editorial fallback so "Good for today" NEVER collapses into dead space.
  // Weather-aware, but only ever surfaces an EXISTING Discover collection (no
  // new query, no fabricated venue): rain → "Rainy Day", otherwise the seasonal
  // hero (Summer Adventures / etc.). Tapping opens the existing collection page.
  const isRain =
    weather?.condition === 'rain' ||
    weather?.condition === 'drizzle' ||
    weather?.condition === 'showers' ||
    weather?.condition === 'thunderstorm';
  const fallbackDef = useMemo(
    () => (isRain ? getCollection('rainy-day') ?? getSeasonalCollection() : getSeasonalCollection()),
    [isRain],
  );

  const isActuallyLoading = (locLoading && !ready) || (ready && isLoading);
  if (isActuallyLoading) {
    return (
      <View style={{ paddingHorizontal: 20 }}>
        <SectionHeading title="Good for today" />
        <View style={{ gap: 10 }}>
          <VenueRowSkeleton />
          <VenueRowSkeleton />
        </View>
      </View>
    );
  }

  // No nearby recommendation (query error OR nothing curated) → the editorial
  // fallback hero. NEVER a cold/apologetic text state: "Good for today" always
  // shows a full hero with somewhere worth going.
  if (error || curated.length === 0) {
    return (
      <View style={{ paddingHorizontal: 18 }}>
        <SectionHeading title="Good for today" />
        <GoodForTodayFallback def={fallbackDef} onPress={() => onOpenCollection?.(fallbackDef.key)} />
      </View>
    );
  }

  return (
    <View>
      {/* ── "Good for today" — the hero. De-bubbled (no translucent paper
          island): the SmartFeaturedCard is a full-bleed magazine cover and the
          dominant object on Home. It carries its own soft shadow. */}
      <View style={{ paddingHorizontal: 18 }}>
        <SectionHeading title="Good for today" />
        {featured != null && (
          <SmartFeaturedCard
            venue={featured.venue}
            onPress={() => onVenuePress(featured.venue)}
            contextReasons={featured.reasons}
          />
        )}
      </View>

      {/* ── "Near You" — a QUIET supporting row of nearby curated venues
          (small cards, lighter heading) so it supports the hero rather than
          competing. NOT "Open right now": this row is distance-curated, not
          open-status-filtered, so we never claim an open state we don't have. */}
      {rest.length > 0 && (
        <>
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 32,
              paddingBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text
              style={{
                fontFamily: FontFamily.bodyStrong,
                fontSize: 14,
                color: tokens.label2,
                letterSpacing: 0.2,
              }}
            >
              Near You
            </Text>
            <TouchableOpacity onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all suggestions">
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: accent.accent }}>See all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}
            style={{ flexGrow: 0 }}
            accessibilityRole="list"
            accessibilityLabel="Places near you"
          >
            {rest.map(({ venue, reasons }) => (
              <ExploreCard
                key={venue.id}
                venue={venue}
                size="sm"
                onPress={() => onVenuePress(venue)}
                contextTag={reasons[0] ?? generateRecommendationReasons(venue)[0] ?? null}
              />
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ── Section heading ─────────────────────────────────────────────────────
// "Good for today" — 20px/700/display, -0.5 tracking (spec section 6).
function SectionHeading({ title }: { title: string }) {
  const { tokens } = useAppTheme();
  return (
    <Text
      style={{
        fontFamily: FontFamily.display,
        fontSize: 20,
        color: tokens.label,
        letterSpacing: -0.5,
        marginBottom: 13,
      }}
    >
      {title}
    </Text>
  );
}
