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
import { ExploreCard } from './ExploreCard';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';
import { Icon } from '@/components/ui/Icon';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue, Category } from '@/types';

export interface NearbyPreviewProps {
  onSeeAll: () => void;
  onVenuePress: (venue: Venue) => void;
}

export function NearbyPreview({ onSeeAll, onVenuePress }: NearbyPreviewProps) {
  const { tokens, accent } = useAppTheme();
  const { coords, isLoading: locLoading } = useLocation();

  const ready = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  const center = ready ? coords : FALLBACK_LOCATION;

  const weather = useWeather(center.latitude, center.longitude);

  const { data: venues = [], isLoading, error, refetch } = useNearbyVenues(
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

  if (error) {
    return (
      <View style={{ paddingHorizontal: 20 }}>
        <SectionHeading title="Good for today" />
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3 }}>
          Couldn't load nearby places. Pull to refresh, or tap "Find something for us".
        </Text>
      </View>
    );
  }

  if (curated.length === 0) {
    return (
      <View style={{ paddingHorizontal: 20 }}>
        <SectionHeading title="Good for today" />
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3 }}>
          Nothing close by right now — try "Find something for us" to widen the search.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {/* ── "Good for today" — smart featured card, grouped in a soft bubble ──
          Translucent paper island matching the search/intent/age bubbles. The
          hero card stays inside and remains clipped/contained. */}
      <View
        style={{
          // Matches SECTION_BUBBLE in app/(tabs)/index.tsx. No Android `elevation`
          // — elevation + a translucent bg renders an opaque rectangular plate
          // artifact on Android. Depth via translucent paper + soft border.
          marginHorizontal: 18,
          borderRadius: 28,
          backgroundColor: 'rgba(255,255,255,0.56)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.55)',
          paddingVertical: 16,
          paddingHorizontal: 14,
          shadowColor: '#2A1E0A',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.06,
          shadowRadius: 18,
        }}
      >
        <View style={{ paddingHorizontal: 4 }}>
          <SectionHeading title="Good for today" />
        </View>
        {featured != null && (
          <SmartFeaturedCard
            venue={featured.venue}
            onPress={() => onVenuePress(featured.venue)}
            contextReasons={featured.reasons}
          />
        )}
      </View>

      {/* ── "Continue Exploring" — remaining venues as a horizontal card row ── */}
      {rest.length > 0 && (
        <>
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 28,
              paddingBottom: 16,
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: FontFamily.display,
                  fontSize: 20,
                  color: tokens.label,
                  letterSpacing: -0.5,
                }}
              >
                Continue Exploring
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3, marginTop: 3 }}>
                Places near you
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {typeof refetch === 'function' && (
                <TouchableOpacity
                  onPress={() => refetch()}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh suggestions"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 13,
                    backgroundColor: tokens.surface,
                    borderWidth: 1,
                    borderColor: tokens.separator,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="refresh" size={16} color={accent.accent} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all suggestions">
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: accent.accent }}>See all</Text>
              </TouchableOpacity>
            </View>
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
