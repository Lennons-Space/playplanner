/**
 * Results — the "Find something for us" payoff screen.
 *
 * FLOW: Home hero / quick pick → here. The parent expressed one intent
 * (mood, via the ?mood= param) and expects a SMALL, confident shortlist —
 * not a feed, not a filter sheet. We fetch nearby venues once and rank them
 * deterministically (lib/curation.ts), attaching an honest "why" to each.
 *
 * PRIVACY (consent-on-intent): this is where we ask for location, because
 * this is the first moment the parent has actively asked for nearby results.
 *   • undecided → LocationConsentPrompt (grant/decline)
 *   • granted   → live GPS via useLocation()
 *   • declined  → fall back to a default area (no GPS), clearly labelled
 *
 * REFINE (not filters): a single quiet row of chips lets the parent nudge
 * the result — Open now (server filter), Indoor / Outdoor / Free (curation
 * constraints). No modal, no long form. "More filters" is intentionally absent.
 */

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocation } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { curateVenues, type Mood, type CuratedVenue } from '@/lib/curation';
import { generateRecommendationReasons } from '@/lib/recommendations/recommendationReasons';
import {
  getQuickFilter,
  HARD_FILTER_IDS,
  type QuickFilter,
  type QuickFilterId,
} from '@/lib/quickFilters';
import type { Category } from '@/types';
import { LocationConsentPrompt } from '@/components/consent';
import { VenueCard, Icon } from '@/components/ui';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Coordinates } from '@/types';

const C = {
  sand: '#FBF6EC',
  paper: '#FFFFFF',
  ink: '#1D2630',
  inkSoft: '#4A5560',
  mute: '#7B8794',
  line: '#E6E2DB',
  sky: '#2FB8B0',
  skyDeep: '#1B8A85',
  skySoft: '#D4F0EE',
} as const;

const VALID_MOODS: Mood[] = ['auto', 'indoor', 'outdoor', 'active', 'calm', 'free', 'surprise'];

function parseMood(raw: string | string[] | undefined): Mood {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (VALID_MOODS as string[]).includes(v ?? '') ? (v as Mood) : 'auto';
}

function headerTitle(mood: Mood): string {
  switch (mood) {
    case 'indoor':  return 'Good indoor picks';
    case 'outdoor': return 'Good outdoor picks';
    case 'active':  return 'Places to burn energy';
    case 'calm':    return 'Calmer picks';
    case 'free':    return 'Free things to do';
    case 'surprise': return 'A few good picks';
    default:        return 'Here’s what we’d pick';
  }
}

// ─── Parse quickFilters URL param ───────────────────────────────────
// Accepts a comma-separated list of known QuickFilterId strings.
// Any unknown or tampered value is silently dropped (never crashes).
const VALID_QUICK_FILTER_IDS = new Set<string>([
  'rainy-day', 'free', 'toddlers', 'burn-energy', 'outdoors', 'indoors',
  'parent-friendly', 'easy-parking', 'has-cafe', 'accessible', 'under-2-hours',
]);

function parseQuickFilters(raw: string | string[] | undefined): QuickFilterId[] {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is QuickFilterId => VALID_QUICK_FILTER_IDS.has(s));
}

// ─── Default export: consent gate ───────────────────────────────────
export default function ResultsScreen() {
  const params = useLocalSearchParams<{ mood?: string; quickFilters?: string }>();
  const mood = parseMood(params.mood);
  // Memoised so the array reference stays stable between renders.
  // Without this, parseQuickFilters creates a new array every render and
  // propagates a false dependency change into ResultsBody's useMemo.
  const quickFilters = useMemo(
    () => parseQuickFilters(params.quickFilters),
    [params.quickFilters],
  );
  const { status, grant, decline } = useLocationConsent();

  if (status === 'checking') {
    return <View style={{ flex: 1, backgroundColor: C.sand }} />;
  }

  if (status === 'undecided') {
    return <LocationConsentPrompt onAccept={grant} onDecline={decline} />;
  }

  if (status === 'granted') {
    return <ResultsWithLocation mood={mood} quickFilters={quickFilters} />;
  }

  // declined — use a default area, no GPS, clearly labelled.
  return (
    <ResultsBody
      mood={mood}
      quickFilters={quickFilters}
      coords={FALLBACK_LOCATION}
      locLoading={false}
      isFallback
    />
  );
}

// ─── Granted: wire up live location ─────────────────────────────────
function ResultsWithLocation({ mood, quickFilters }: { mood: Mood; quickFilters: QuickFilterId[] }) {
  const { coords, isLoading } = useLocation();
  const ready = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  return (
    <ResultsBody
      mood={mood}
      quickFilters={quickFilters}
      coords={ready ? coords : FALLBACK_LOCATION}
      locLoading={isLoading}
      isFallback={false}
    />
  );
}

// ─── Body ───────────────────────────────────────────────────────────
interface ResultsBodyProps {
  mood: Mood;
  /** Quick filters passed from the Home screen chips. May be empty. */
  quickFilters: QuickFilterId[];
  coords: Coordinates;
  locLoading: boolean;
  isFallback: boolean;
}

function ResultsBody({ mood: paramMood, quickFilters, coords, locLoading, isFallback }: ResultsBodyProps) {
  // Refine state. `mood` can be nudged by the Indoor/Outdoor/Free chips.
  const [mood, setMood] = useState<Mood>(paramMood);
  const [openNow, setOpenNow] = useState(false);

  const weather = useWeather(coords.latitude, coords.longitude);

  const filters = useMemo(() => ({ ...DEFAULT_FILTERS, openNow }), [openNow]);

  const {
    data: venues = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useNearbyVenues(coords, filters, !locLoading);

  // ── Category enrichment ──────────────────────────────────────────────────
  // get_nearby_venues RPC returns `category_id` (UUID) but no `category` object.
  // Quick filter tests and getVenueAttributes() both need `venue.category.slug`
  // to match against indoor/outdoor/toddler slug sets. Without this enrichment,
  // every category-based test fails silently and filters show 0 or wrong results.
  const { data: categories = [] } = useCategories();
  const categoryMap = useMemo<Record<string, Category>>(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );
  const enrichedVenues = useMemo(
    () =>
      venues.map((v) => ({
        ...v,
        // Only set category if the RPC didn't already include it (it never does,
        // but guard with ?? so we don't accidentally overwrite detail-page data).
        category: v.category ?? (v.category_id ? categoryMap[v.category_id] : undefined),
      })),
    [venues, categoryMap],
  );

  // ── Curated results with quick-filter support ────────────────────────────
  //
  // Hard filters (free, easy-parking, has-cafe, accessible) are strict promises:
  //   apply them first. If nothing passes, return [] so we can show a helpful
  //   "no confirmed data yet" message rather than unrelated venues.
  //
  // Soft filters (rainy-day, toddlers, burn-energy, etc.) are ranking hints:
  //   curate a larger pool (20 instead of 6), then re-sort the pool by how
  //   many soft filters each venue matches and take the top 6. This guarantees
  //   results always appear — matching venues simply surface first.
  const curated = useMemo(() => {
    const hardFilterIds = quickFilters.filter((id) => HARD_FILTER_IDS.has(id));
    const softFilterIds  = quickFilters.filter((id) => !HARD_FILTER_IDS.has(id));

    // Hard filter pass 1: exclude venues that don't confirm the feature.
    const hardCandidates =
      hardFilterIds.length > 0
        ? enrichedVenues.filter((v) =>
            hardFilterIds.every((id) => {
              const f = getQuickFilter(id);
              return f ? f.test(v).passes : true;
            }),
          )
        : enrichedVenues;

    // If hard filters applied but zero venues confirmed → return [] so the
    // "no confirmed data" empty state renders (not the generic empty state).
    if (hardFilterIds.length > 0 && hardCandidates.length === 0) return [];

    // Curate. Use a larger pool when soft filters will re-rank.
    const pool = curateVenues(
      hardCandidates,
      { weather: weather ?? null, mood },
      { limit: softFilterIds.length > 0 ? 20 : 6 },
    );

    if (softFilterIds.length === 0) return pool;

    // Soft filter pass 2: boost matching venues to the top of the curated pool.
    const softFilters = softFilterIds
      .map((id) => getQuickFilter(id))
      .filter((f): f is QuickFilter => f !== undefined);

    return [...pool]
      .map((item) => ({
        item,
        softScore: softFilters.filter((f) => f.test(item.venue).passes).length,
      }))
      .sort((a, b) => b.softScore - a.softScore)
      .slice(0, 6)
      .map((s) => s.item);
  }, [enrichedVenues, weather, mood, quickFilters]);

  // True only when a hard-promise filter was active and zero venues confirmed it.
  // Used to show a specific "no confirmed data" message rather than the generic
  // "nothing nearby" empty state, so parents understand they can try a different chip.
  const hardFilterEmpty =
    curated.length === 0 && quickFilters.some((id) => HARD_FILTER_IDS.has(id));

  const radiusMiles = Math.round(DEFAULT_FILTERS.maxDistanceKm * 0.621371);

  // Toggle one of the single-select mood chips; tapping the active one resets
  // to the original intent the parent arrived with.
  const toggleMood = (m: Mood) => setMood((cur) => (cur === m ? paramMood : m));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.sand }} edges={['top']}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{
              width: 38, height: 38, borderRadius: 12,
              backgroundColor: C.paper, borderWidth: 1, borderColor: C.line,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="chevL" size={18} color={C.ink} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 20, color: C.ink, letterSpacing: -0.4, flex: 1 }}>
            {headerTitle(mood)}
          </Text>
        </View>

        {/* Context line: weather + radius */}
        <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: C.mute, marginTop: 6, marginLeft: 48 }}>
          {weather ? `${weather.emoji} ${weather.label} · ` : ''}within {radiusMiles} miles
          {isFetching && !isLoading ? ' · updating…' : ''}
        </Text>

        {isFallback && (
          <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: C.inkSoft, marginTop: 4, marginLeft: 48 }}>
            Showing a default area — turn on location for picks near you.
          </Text>
        )}
      </View>

      {/* ── Refine chips ─────────────────────────────────────────── */}
      {/* The outer View with an explicit height is the pattern used throughout
          this app (see search.tsx quick-filter row) to prevent the horizontal
          ScrollView from being vertically clipped by its flex parent. Without
          the fixed height, the SafeAreaView/flex layout squeezes the row and
          cuts off the chip text top and bottom. */}
      <View style={{ height: 52 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12, alignItems: 'center', height: 52 }}
        style={{ flexGrow: 0 }}
      >
        <RefineChip label="Open now" active={openNow} onPress={() => setOpenNow((v) => !v)} />
        <RefineChip label="Indoor" active={mood === 'indoor'} onPress={() => toggleMood('indoor')} />
        <RefineChip label="Outdoor" active={mood === 'outdoor'} onPress={() => toggleMood('outdoor')} />
        <RefineChip label="Free" active={mood === 'free'} onPress={() => toggleMood('free')} />
      </ScrollView>
      </View>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        {locLoading || isLoading ? (
          <>
            <VenueRowSkeleton />
            <VenueRowSkeleton />
            <VenueRowSkeleton />
          </>
        ) : error ? (
          <ErrorState onRetry={() => refetch()} />
        ) : hardFilterEmpty ? (
          <HardFilterEmptyState onOpenMap={() => router.push('/explore/map')} />
        ) : curated.length === 0 ? (
          <EmptyState onOpenMap={() => router.push('/explore/map')} />
        ) : (
          curated.map((item) => (
            <CuratedResult key={item.venue.id} item={item} onPress={() => router.push(`/venue/${item.venue.id}`)} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── CuratedResult ──────────────────────────────────────────────────
// A standard VenueCard plus the honest "why" — the reasons that put this
// venue on the shortlist. The reasons are the trust payload of this screen.
function CuratedResult({ item, onPress }: { item: CuratedVenue; onPress: () => void }) {
  const reasons = generateRecommendationReasons(item.venue);
  return (
    <View>
      <VenueCard venue={item.venue} onPress={onPress} />
      {reasons.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginLeft: 4 }}>
          {reasons.map((r) => (
            <View
              key={r}
              style={{
                backgroundColor: C.skySoft,
                borderRadius: 999,
                paddingHorizontal: 9,
                paddingVertical: 3,
              }}
            >
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 11, color: C.skyDeep }}>{r}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── RefineChip ─────────────────────────────────────────────────────
function RefineChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? C.skyDeep : C.paper,
        borderWidth: 1,
        borderColor: active ? C.skyDeep : C.line,
      }}
    >
      <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: active ? '#FFFFFF' : C.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── HardFilterEmptyState ────────────────────────────────────────────
// Shown when a hard-promise filter (Free Entry, Easy Parking, Has Cafe,
// Accessible) matched zero venues — meaning we don't have confirmed data yet,
// not that there are no nearby venues. A specific message prevents confusion.
function HardFilterEmptyState({ onOpenMap }: { onOpenMap: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <Text style={{ fontSize: 40 }}>🔍</Text>
      <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 16, color: C.ink, marginTop: 12, textAlign: 'center' }}>
        We don't have enough data for this filter yet
      </Text>
      <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: C.mute, marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
        Try another idea — we can't confirm this feature for venues near you right now.
      </Text>
      <TouchableOpacity
        onPress={onOpenMap}
        accessibilityRole="button"
        accessibilityLabel="Open the map"
        style={{ marginTop: 16, backgroundColor: C.skyDeep, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 }}
      >
        <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: '#FFFFFF' }}>Explore the map</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── EmptyState ─────────────────────────────────────────────────────
function EmptyState({ onOpenMap }: { onOpenMap: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <Text style={{ fontSize: 40 }}>🧭</Text>
      <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 16, color: C.ink, marginTop: 12, textAlign: 'center' }}>
        Nothing matched just now
      </Text>
      <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: C.mute, marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
        Try turning off a refine above, or explore the map to widen your search.
      </Text>
      <TouchableOpacity
        onPress={onOpenMap}
        accessibilityRole="button"
        accessibilityLabel="Open the map"
        style={{ marginTop: 16, backgroundColor: C.skyDeep, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 }}
      >
        <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: '#FFFFFF' }}>Open the map</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── ErrorState ─────────────────────────────────────────────────────
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <Text style={{ fontSize: 40 }}>⚠️</Text>
      <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 16, color: C.ink, marginTop: 12, textAlign: 'center' }}>
        Couldn’t load suggestions
      </Text>
      <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: C.mute, marginTop: 6, textAlign: 'center' }}>
        Check your connection and try again.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={{ marginTop: 16, backgroundColor: C.skyDeep, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 }}
      >
        <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: '#FFFFFF' }}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}
