// ─────────────────────────────────────────────────────────────────────────
// Collection page — ONE reusable route for every Discover collection. Reads the
// [collection] key, resolves it (lib/collections), and renders a calm editorial
// page of REAL matching venues. No collection-specific screen, no stubs.
//
// DATA: reuses the SAME cached venues as the Home rows via React Query
// (useNearbyVenues with the identical key → cache hit, no new Supabase query).
// Membership is the collection's real-data predicate (def.match). Open-now is
// the shared computeIsOpenNow utility (single source of truth). Nothing is
// fabricated; sections with no real data are hidden entirely.
//
// PRIVACY: location is OFF by default. We read consent via useLocationConsent
// (SecureStore only — never prompts). The child that calls useLocation() is
// mounted ONLY when consent is 'granted', so the OS prompt can never fire here
// pre-consent. Without consent we show a nudge into the proper consent flow
// rather than silently falling back to a default city (which would mislead).
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { ScrollView, Text, View, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';

import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useLocation } from '@/hooks/location';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { computeIsOpenNow, getOpenUntilLabel } from '@/lib/venueAttributes';
import { getCollection, type CollectionDef } from '@/lib/collections';
import { Icon, VenueCard, VenueRowSkeleton } from '@/components/ui';
import { ExploreCard } from '@/components/home/ExploreCard';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue, Category } from '@/types';

const INK = '#1C1408';

// ── Shared header (back chevron) ───────────────────────────────────────────
function CollectionHeader() {
  const { tokens } = useAppTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover'))}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={10}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: tokens.surface,
          borderWidth: 1,
          borderColor: tokens.separator,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="chevL" size={20} color={tokens.label} />
      </Pressable>
    </View>
  );
}

// ── Editorial hero ─────────────────────────────────────────────────────────
function CollectionHero({ def }: { def: CollectionDef }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 22 }}>
      <LinearGradient
        colors={def.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 28, paddingHorizontal: 24, paddingVertical: 28 }}
      >
        <Text style={{ fontSize: 46 }} accessibilityElementsHidden importantForAccessibility="no">
          {def.emoji}
        </Text>
        <Text style={{ fontFamily: FontFamily.display, fontSize: 30, color: INK, letterSpacing: -0.6, marginTop: 12 }}>
          {def.title}
        </Text>
        <Text style={{ fontFamily: FontFamily.body, fontSize: 15.5, color: 'rgba(28,20,8,0.7)', marginTop: 6 }}>
          {def.tagline}
        </Text>
      </LinearGradient>
    </View>
  );
}

// ── Section heading ────────────────────────────────────────────────────────
function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { tokens } = useAppTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
      <Text style={{ fontFamily: FontFamily.display, fontSize: 20, color: tokens.label, letterSpacing: -0.5 }}>
        {title}
      </Text>
      {subtitle != null && (
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3, marginTop: 3 }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

// ── Footer: path back to the real Search ───────────────────────────────────
function SearchAllFooter() {
  const { tokens, accent } = useAppTheme();
  return (
    <Pressable
      onPress={() => router.push('/search')}
      accessibilityRole="button"
      accessibilityLabel="Search all venues"
      style={({ pressed }) => ({
        marginHorizontal: 20,
        marginTop: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: tokens.surface,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: tokens.separator,
        paddingVertical: 14,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name="search" size={16} color={accent.accent} />
      <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 14, color: accent.accent }}>
        Search all venues
      </Text>
    </Pressable>
  );
}

// ── Results (location consent confirmed) ────────────────────────────────────
// Only mounted when consent is 'granted' → useLocation() (and the OS prompt)
// can never fire pre-consent.
function CollectionResults({ def }: { def: CollectionDef }) {
  const { tokens } = useAppTheme();
  const { coords, isLoading: locLoading } = useLocation();

  const ready = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  const center = ready ? coords : FALLBACK_LOCATION;

  // SAME query/key as the Home rows → React Query serves it from cache (no new fetch).
  const { data: venues = [], isLoading, error } = useNearbyVenues(center, DEFAULT_FILTERS, !locLoading && ready);
  const { data: categories = [] } = useCategories();

  const categoryMap = useMemo<Record<string, Category>>(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  // Enrich with the joined category (the RPC returns category_id only) so the
  // slug-based predicates work — mirrors NearbyPreview's enrichment.
  const matching = useMemo(() => {
    const enriched: Venue[] = venues.map((v) => ({
      ...v,
      category: v.category ?? (v.category_id ? categoryMap[v.category_id] : undefined),
    }));
    return enriched
      .filter((v) => def.match(v))
      .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  }, [venues, categoryMap, def]);

  // "Great today" = matching venues confirmed open now (shared utility only).
  const openNow = useMemo(
    () => matching.filter((v) => computeIsOpenNow(v) === true && getOpenUntilLabel(v) != null).slice(0, 8),
    [matching],
  );

  const isActuallyLoading = (locLoading && !ready) || (ready && isLoading);

  if (isActuallyLoading) {
    return (
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <VenueRowSkeleton />
        <VenueRowSkeleton />
        <VenueRowSkeleton />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: tokens.label3 }}>
          Couldn&apos;t load places right now. Pull back and try again in a moment.
        </Text>
      </View>
    );
  }

  // Honest empty state — no placeholders, no fake venues.
  if (matching.length === 0) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8, alignItems: 'center' }}>
        <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 16, color: tokens.label, textAlign: 'center', marginBottom: 6 }}>
          Nothing here just yet
        </Text>
        <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: tokens.label3, textAlign: 'center' }}>
          We couldn&apos;t find {def.title.toLowerCase()} places near you right now. Try widening your search.
        </Text>
        <SearchAllFooter />
      </View>
    );
  }

  return (
    <View>
      {/* Great today — only when something is genuinely open now */}
      {openNow.length > 0 && (
        <View style={{ paddingBottom: 28 }}>
          <SectionHeading title="Great today" subtitle="Open right now" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
            style={{ flexGrow: 0 }}
            accessibilityRole="list"
            accessibilityLabel={`${def.title} venues open now`}
          >
            {openNow.map((venue) => (
              <ExploreCard
                key={venue.id}
                venue={venue}
                size="md"
                openUntil={getOpenUntilLabel(venue)}
                onPress={() => router.push(`/venue/${venue.id}`)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* The full collection — real matching venues, nearest first */}
      <SectionHeading
        title="Places near you"
        subtitle={`${matching.length} ${matching.length === 1 ? 'place' : 'places'}`}
      />
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        {matching.map((venue) => (
          <VenueCard key={venue.id} venue={venue} saved={false} onPress={() => router.push(`/venue/${venue.id}`)} />
        ))}
      </View>

      <SearchAllFooter />
    </View>
  );
}

// ── Location-consent nudge (consent not granted) ────────────────────────────
function LocationNudge() {
  const { tokens, accent } = useAppTheme();
  return (
    <Pressable
      onPress={() => router.push('/explore/results?mood=auto')}
      accessibilityRole="button"
      accessibilityLabel="Turn on location to see venues near you"
      style={{
        marginHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: tokens.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: tokens.separator,
        padding: 16,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: accent.light,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="locate" size={20} color={accent.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FontFamily.heading, fontSize: 14, color: tokens.label }}>
          See places near you
        </Text>
        <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: tokens.label3, marginTop: 2 }}>
          Turn on location for local results.
        </Text>
      </View>
      <Icon name="chevR" size={16} color={tokens.label3} />
    </Pressable>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────
export default function CollectionScreen() {
  const { tokens } = useAppTheme();
  const params = useLocalSearchParams<{ collection?: string }>();
  const key = Array.isArray(params.collection) ? params.collection[0] : params.collection;
  const def = getCollection(key);

  const { status: consentStatus } = useLocationConsent();

  // Unknown collection key → defensive guard (not a placeholder collection page).
  if (!def) {
    return (
      <View style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <CollectionHeader />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 16, color: tokens.label, textAlign: 'center' }}>
              Collection not found
            </Text>
            <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: tokens.label3, textAlign: 'center', marginTop: 6 }}>
              This collection isn&apos;t available.
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Weather background lives once, globally, in app/(tabs)/_layout — but the
          collection page is a stack route outside (tabs), so it sits on the warm
          app background; the hero gradient carries the colour. */}
      <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg }} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36 }}>
          <CollectionHeader />
          <CollectionHero def={def} />

          {consentStatus === 'checking' ? (
            <View style={{ paddingTop: 24, alignItems: 'center' }}>
              <ActivityIndicator color={tokens.label3} />
            </View>
          ) : consentStatus === 'granted' ? (
            <CollectionResults def={def} />
          ) : (
            <LocationNudge />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
