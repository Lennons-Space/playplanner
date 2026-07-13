/**
 * Browse (Home) — Play Planner v2 (EXACT final-jsx pass, 2026-07-08).
 *
 * SOURCE OF TRUTH: the final rendered prototype — `Play Planner v2.html` +
 * `pp2-home.jsx` (local untracked copy: .design-v2-handoff/). Where
 * `screens/01-home-dark.png` or README differ (two-line intent cards, age
 * chips, uppercase section labels, 380px venue-photo featured card), they are
 * an OLDER iteration and are deliberately not followed.
 *
 * Final-jsx section order (top→bottom):
 *   1. Header — "YOUR AREA" overline + area (pin icon) + chevron (→ map);
 *      42px brand mark (→ profile).
 *   2. Greeting — time-based ("Good morning, Liam 🌅") + weather pill;
 *      headline 38/800/display, line-height 1.0; context line (weather ×
 *      time-of-day copy map, lib/homeIntents.getHomeContextLine).
 *   3. Weather-aware pick CTA card — emoji box + condition line + coloured
 *      "Find outdoor spots →" (→ search). Non-personal, renders pre-consent.
 *   4. Search pill — icon + prompt + 34×34 filter box INSIDE the pill (right).
 *      Whole pill routes to search, exactly like the prototype.
 *   5. Intent rail — single-line pills + INLINE Clear (no section label).
 *   6. "Good for today" — 22px sentence-case heading + 192px
 *      EditorialCollectionHero → routes to a REAL /discover collection,
 *      never a venue. Renders pre-consent (editorial, not venue data).
 *   7. Venue list — 22px heading + "Near you · updated just now" + boxed
 *      refresh; VenueCard2 rows (hearts wired to real favourites).
 *      This region ONLY is consent-gated.
 * ("Continue exploring" recently-viewed rail is P2 — deliberately deferred.)
 *
 * PRIVACY (ICO Children's Code, Standard 10 + UK GDPR data minimisation):
 * This screen NEVER calls useLocation() itself. useLocationConsent() only
 * reads a stored yes/no flag (SecureStore, never prompts) and drives a 3-way
 * branch over the VENUE LIST region only:
 *   - 'checking'             → a neutral loader.
 *   - 'granted'              → mounts <HomeResults>, the ONLY place that calls
 *                              useLocation() (so the OS prompt can never fire
 *                              pre-consent).
 *   - 'undecided'/'declined' → a calm nudge card. Everything above (header,
 *                              greeting, CTA, search, chips, collection hero)
 *                              renders identically either way — none of it is
 *                              venue or location data.
 * No default-city venues are ever shown pre-consent.
 *
 * Weather: SAME coarse, cached, non-personal fetch the global
 * WeatherBackground makes (FALLBACK_LOCATION — a GB centroid, never the
 * user's position). Identical React Query cache key → no extra request.
 */

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useProfile } from '@/hooks/useAuth';
import { useAreaLabel, useLocation } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { useSavedVenueIds, useToggleFavourite } from '@/hooks/useFavourites';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, BorderRadius } from '@/constants/theme';
import { FALLBACK_LOCATION } from '@/constants/location';
import { DEFAULT_FILTERS } from '@/types';
import type { Venue, Category } from '@/types';
import { Icon, PPBrandMark, VenueRowSkeleton } from '@/components/ui';
import { V2Background } from '@/components/ui/V2Background';
import { EditorialCollectionHero } from '@/components/home/EditorialCollectionHero';
import { VenueCard2 } from '@/components/home/VenueCard2';
import { IntentChips } from '@/components/home/IntentChips';
import {
  filterHomeVenues,
  getContextTag,
  getHomeContextLine,
  getWeatherCta,
  pickHeroCollection,
  type IntentKey,
} from '@/lib/homeIntents';

// ── Time-based greeting (pp2-home.jsx greeting line) ─────────────────────
function getGreeting(hour: number): { text: string; emoji: string } {
  if (hour < 5) return { text: 'Good night', emoji: '🌙' };
  if (hour < 12) return { text: 'Good morning', emoji: '🌅' };
  if (hour < 17) return { text: 'Good afternoon', emoji: '👋' };
  if (hour < 21) return { text: 'Good evening', emoji: '🌆' };
  return { text: 'Good night', emoji: '🌙' };
}

// Deterministic shuffle so the "refresh" icon re-orders the list predictably
// for a given seed (no flicker on re-render, fresh order on each press).
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed + 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const GUTTER = 20;
const MAX_LIST = 20;

// ── Venue list (location consent confirmed) ──────────────────────────────
// Only mounted when consentStatus === 'granted' → useLocation() (and the OS
// prompt) can never fire pre-consent.
interface HomeResultsProps {
  activeIntent: IntentKey | null;
  isRain: boolean;
  refreshSeed: number;
  onShuffle: () => void;
  onClearFilter: () => void;
}

function HomeResults({ activeIntent, isRain, refreshSeed, onShuffle, onClearFilter }: HomeResultsProps) {
  const { tokens, accent } = useAppTheme();
  const { coords, isLoading: locLoading } = useLocation();

  const ready = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  const center = ready ? coords : FALLBACK_LOCATION;

  const { data: venues = [], isLoading } = useNearbyVenues(center, DEFAULT_FILTERS, !locLoading && ready);
  const { data: categories = [] } = useCategories();
  const { savedIds } = useSavedVenueIds();
  const toggleFav = useToggleFavourite();

  const categoryMap = useMemo<Record<string, Category>>(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  // get_nearby_venues returns category_id only (no joined category object —
  // see supabase/migrations/045). Enrich the same way
  // app/discover/[collection].tsx and NearbyPreview do, so the category-slug
  // predicates in lib/homeIntents (rain/energy/toddler/etc.) actually match
  // real venues instead of silently going dead.
  const filtered = useMemo(() => {
    const enriched: Venue[] = venues.map((v) => ({
      ...v,
      category: v.category ?? (v.category_id ? categoryMap[v.category_id] : undefined),
    }));
    return filterHomeVenues(enriched, activeIntent, null, isRain);
  }, [venues, categoryMap, activeIntent, isRain]);

  const list = useMemo(() => seededShuffle(filtered, refreshSeed).slice(0, MAX_LIST), [filtered, refreshSeed]);

  const isActuallyLoading = (locLoading && !ready) || (ready && isLoading);
  const listLabel = activeIntent != null ? 'More matches' : 'Family favourites';

  return (
    <>
      {/* ── List header: 22px title + sub + 38×38 boxed refresh (jsx) ── */}
      <View
        style={{
          paddingHorizontal: GUTTER,
          paddingTop: 22,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: FontFamily.display,
              fontSize: 22,
              color: tokens.label,
              letterSpacing: -0.6,
            }}
          >
            {listLabel}
          </Text>
          <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3, marginTop: 3 }}>
            Near you · updated just now
          </Text>
        </View>
        <Pressable
          onPress={onShuffle}
          accessibilityRole="button"
          accessibilityLabel="Shuffle list"
          android_ripple={{ color: 'rgba(255,255,255,0.10)', foreground: true }}
          style={{
            width: 38,
            height: 38,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tokens.surface,
            borderWidth: 1,
            borderColor: tokens.separator,
            overflow: 'hidden',
          }}
        >
          <Icon name="refresh" size={16} color={accent.accent} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: GUTTER, gap: 12 }}>
        {isActuallyLoading ? (
          <>
            <VenueRowSkeleton />
            <VenueRowSkeleton />
            <VenueRowSkeleton />
          </>
        ) : list.length > 0 ? (
          list.map((venue) => (
            <VenueCard2
              key={venue.id}
              venue={venue}
              contextTag={getContextTag(venue, activeIntent, null)}
              onPress={() => router.push(`/venue/${venue.id}`)}
              saved={savedIds.has(venue.id)}
              onToggleSave={() =>
                toggleFav.mutate({ venueId: venue.id, currentlySaved: savedIds.has(venue.id) })
              }
            />
          ))
        ) : (
          // Honest empty state (prototype copy). We never pad the list with
          // non-matching venues just to avoid an empty state.
          <View style={{ alignItems: 'center', paddingVertical: 32, gap: 12 }}>
            <Text
              style={{
                fontFamily: FontFamily.body,
                fontSize: 15,
                color: tokens.label3,
                textAlign: 'center',
                lineHeight: 24,
              }}
            >
              {activeIntent != null ? 'No other venues match this combination.' : 'No venues found nearby.'}
            </Text>
            {activeIntent != null && (
              <Pressable
                onPress={onClearFilter}
                accessibilityRole="button"
                accessibilityLabel="Clear filters"
                android_ripple={{ color: 'rgba(255,255,255,0.10)', foreground: true }}
                style={{
                  borderWidth: 1,
                  borderColor: tokens.separator,
                  borderRadius: BorderRadius.pill,
                  paddingHorizontal: 18,
                  paddingVertical: 9,
                  overflow: 'hidden',
                }}
              >
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: accent.accent }}>
                  Clear filters
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </>
  );
}

// ── Location-consent nudge (consent not granted) ────────────────────────
// Replaces the venue list ONLY — never a default-city venue list. Routes into
// the existing consent-on-intent flow (results screen), matching the pattern
// in app/discover/[collection].tsx.
function LocationNudge() {
  const { tokens, accent } = useAppTheme();
  return (
    <View style={{ paddingHorizontal: GUTTER, marginTop: 26 }}>
      <Pressable
        onPress={() => router.push('/explore/results?mood=auto')}
        accessibilityRole="button"
        accessibilityLabel="Turn on location to see venues near you"
        android_ripple={{ color: 'rgba(255,255,255,0.08)', foreground: true }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          backgroundColor: tokens.surface,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: tokens.separator,
          padding: 16,
          overflow: 'hidden',
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
            Turn on location for local ideas — venues, distances and what&apos;s open now.
          </Text>
        </View>
        <Icon name="chevR" size={16} color={tokens.label3} />
      </Pressable>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const profile = useProfile();
  const { tokens, accent } = useAppTheme();
  const { status: consentStatus } = useLocationConsent();

  // Tab-safe zone (2026-07-09 round 4): the scroll VIEWPORT itself ends above
  // the absolute tab bar (marginBottom on the ScrollView), so screen content
  // can NEVER sit or pass beneath the bar — at rest or mid-scroll. The bar
  // only ever overlays the V2Background atmosphere layer, which is mounted at
  // the screen root and continues behind it (that's what keeps the glass
  // reading as glass). Padding-only clearance could not deliver this: with an
  // overlay viewport, content always passes under the bar while scrolling.
  // Defensive floor: the bar's known minimum geometry (46 content + 6 Android
  // cushion — see app/(tabs)/_layout.tsx) + the system nav inset, in case the
  // navigator-reported height ever under-reports.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const tabSafeZone = Math.max(tabBarHeight, 52 + insets.bottom);

  // SAME coarse, cached, non-personal fetch the global WeatherBackground
  // already makes (FALLBACK_LOCATION, a GB centroid — never the user's real
  // position). Identical React Query cache key → reuses that fetch.
  const weather = useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  const condition = weather?.condition ?? null;
  const isRain =
    condition === 'rain' || condition === 'drizzle' || condition === 'showers' || condition === 'thunderstorm';

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  // Area label — real data only, never prompts (useAreaLabel checks
  // permission, never requests it). Falls back to saved postcode, then a
  // PASSIVE "Near you" label. There is no manual area-picker flow: the row's
  // only action is to open the Map (the location surface), so the fallback
  // must NOT read as a "Choose area" CTA (which would imply a picker that
  // does not exist and cannot fake a chosen town).
  const geoArea = useAreaLabel();
  const areaLabel = geoArea || profile?.postcode?.trim() || 'Near you';

  // Home's local filter state (independent of the global FilterSheet store).
  const [activeIntent, setActiveIntent] = useState<IntentKey | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);

  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const ctxLine = getHomeContextLine(condition, now);
  const weatherCta = getWeatherCta(condition);
  const hero = pickHeroCollection(condition, activeIntent, now.getMonth(), now.getHours());

  const openMap = () => router.push('/explore/map');
  const openProfile = () => router.push('/(tabs)/profile');
  const openSearch = () => router.push('/(tabs)/search');
  const openHeroCollection = () =>
    router.push({ pathname: '/discover/[collection]', params: { collection: hero.key } });

  const toggleIntent = (key: IntentKey) => setActiveIntent((cur) => (cur === key ? null : key));
  const clearFilters = () => setActiveIntent(null);

  return (
    <View style={{ flex: 1 }}>
      {/* Atmosphere layer: dark base gradient + weather glow + Ocean vignette
          (static approximation of the prototype's animated background —
          animation is P2). */}
      <V2Background />
      {/* Home renders dark by design (v2). The shared <StatusBar style="dark">
          in app/(tabs)/_layout stays "dark" for the 3 legacy light screens —
          expo-status-bar stacks mounted instances, so this local override wins
          while Home is focused and reverts on other tabs. */}
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView
          testID="home-scroll"
          style={{ marginBottom: tabSafeZone }}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Header (jsx: '54px 20px 0' — status bar via SafeArea) ── */}
          <Animated.View entering={FadeIn.duration(450)}>
            <View
              style={{
                paddingHorizontal: GUTTER,
                paddingTop: 6,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {/* NO function styles anywhere on this screen: the installed
                  dev build's NativeWind 4 interop silently DROPS style-as-
                  function props on Pressable (verified on-device 2026-07-09 —
                  every "invisible bubble"/"stacked row" report traced to
                  this). Static style objects only; press feedback via
                  android_ripple. */}
              <Pressable
                onPress={openMap}
                accessibilityRole="button"
                accessibilityLabel={`Your area: ${areaLabel} — open map`}
                style={{ gap: 3 }}
              >
                <Text
                  style={{
                    fontFamily: FontFamily.caption,
                    fontSize: 11,
                    color: tokens.label3,
                    textTransform: 'uppercase',
                    letterSpacing: 1.32, // 0.12em @ 11px
                  }}
                >
                  Your area
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Icon name="pin" size={14} color={accent.accent} strokeWidth={2.2} />
                  <Text
                    style={{
                      fontFamily: FontFamily.caption,
                      fontSize: 17,
                      color: tokens.label,
                      letterSpacing: -0.3,
                    }}
                    numberOfLines={1}
                  >
                    {areaLabel}
                  </Text>
                  <Icon name="chevD" size={13} color={tokens.label2} strokeWidth={2.4} />
                </View>
              </Pressable>

              <PPBrandMark size={42} onPress={openProfile} accessibilityLabel="Open profile" />
            </View>
          </Animated.View>

          {/* ── 2. Greeting + weather pill + headline + context line ────── */}
          <Animated.View entering={FadeIn.duration(450).delay(50)}>
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: FontFamily.body, fontSize: 14.5, color: tokens.label3 }}>
                  {`${greeting.text}, ${firstName ?? 'there'} ${greeting.emoji}`}
                </Text>

                {weather != null && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      backgroundColor: isRain ? 'rgba(91,155,213,0.16)' : 'rgba(255,178,62,0.16)',
                      borderWidth: 1,
                      borderColor: isRain ? 'rgba(91,155,213,0.3)' : 'rgba(255,178,62,0.3)',
                      borderRadius: BorderRadius.pill,
                      paddingVertical: 3,
                      paddingLeft: 8,
                      paddingRight: 11,
                    }}
                    accessibilityRole="text"
                    accessibilityLabel={`Weather: ${weather.label}`}
                  >
                    <Text style={{ fontSize: 12 }}>{weather.emoji}</Text>
                    <Text
                      style={{
                        fontFamily: FontFamily.bodyStrong,
                        fontSize: 12,
                        color: isRain ? '#8FBEE8' : '#FFC976',
                      }}
                    >
                      {weather.label}
                    </Text>
                  </View>
                )}
              </View>

              {/* jsx: 38/800/display, letterSpacing -1.2, line-height 1.0 */}
              <Text
                style={{
                  fontFamily: FontFamily.display,
                  fontSize: 38,
                  color: tokens.label,
                  letterSpacing: -1.2,
                  lineHeight: 38,
                }}
              >
                {"What's the\nplan today?"}
              </Text>

              <Text style={{ fontFamily: FontFamily.body, fontSize: 14.5, color: tokens.label3, marginTop: 6 }}>
                {ctxLine}
              </Text>
            </View>
          </Animated.View>

          {/* ── 3. Weather-aware pick CTA (jsx wCTA card) ────────────────
              Coarse public forecast + a search link — no location, no venue
              data, renders identically pre- and post-consent. Hidden only
              while weather data hasn't arrived yet. */}
          {weatherCta != null && (
            <Animated.View entering={FadeIn.duration(450).delay(90)}>
              <View style={{ paddingHorizontal: GUTTER, paddingTop: 12 }}>
                <Pressable
                  testID="home-weather-cta"
                  onPress={openSearch}
                  accessibilityRole="button"
                  accessibilityLabel={`${weatherCta.line} ${weatherCta.cta}`}
                  android_ripple={{ color: 'rgba(255,255,255,0.08)', foreground: true }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    backgroundColor: tokens.surface,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: tokens.separator,
                    paddingVertical: 11,
                    paddingHorizontal: 16,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      flexShrink: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${weatherCta.color}38`, // ~0.22 alpha
                    }}
                  >
                    <Text style={{ fontSize: 21 }}>{weatherCta.icon}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3, marginBottom: 2 }}
                      numberOfLines={1}
                    >
                      {weatherCta.line}
                    </Text>
                    <Text
                      style={{
                        fontFamily: FontFamily.caption,
                        fontSize: 15,
                        color: weatherCta.color,
                        letterSpacing: -0.2,
                      }}
                      numberOfLines={1}
                    >
                      {`${weatherCta.cta} →`}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* ── 4. Search pill — filter box INSIDE, right (jsx) ──────────
              One fixed-height pill. The 34×34 filter box is pinned to the
              pill's right edge with absolute positioning (top/bottom anchored,
              centred) — it is in the SAME pill, on the SAME row, and cannot
              wrap, drop or stack below the prompt under any width or Android
              font-scale setting. The prompt row reserves its width via
              paddingRight so text can never run underneath it. */}
          <Animated.View entering={FadeIn.duration(450).delay(120)}>
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 12 }}>
              <Pressable
                testID="home-search-pill"
                onPress={openSearch}
                accessibilityRole="button"
                accessibilityLabel="Search venues"
                android_ripple={{ color: 'rgba(255,255,255,0.08)', foreground: true }}
                style={{
                  minHeight: 56, // 11 + 34 (filter box) + 11 — compressed 2026-07-09 round 3
                  justifyContent: 'center',
                  backgroundColor: tokens.surface,
                  borderRadius: BorderRadius.chip,
                  borderWidth: 1,
                  borderColor: tokens.separator,
                  paddingLeft: 16,
                  paddingRight: 14 + 34 + 11, // filter box zone + jsx gap
                  overflow: 'hidden',
                }}
              >
                <View
                  testID="home-search-pill-row"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}
                >
                  <Icon name="search" size={18} color={tokens.label3} strokeWidth={2.2} />
                  <Text
                    style={{ flex: 1, fontFamily: FontFamily.body, fontSize: 15, color: tokens.label3 }}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                  >
                    What are the kids in the mood for?
                  </Text>
                </View>
                <View
                  testID="home-filter-anchor"
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    right: 14,
                    justifyContent: 'center',
                  }}
                >
                  <View
                    testID="home-filter-button"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 11,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: accent.light,
                    }}
                  >
                    <Icon name="filter" size={17} color={accent.accent} strokeWidth={2.1} />
                  </View>
                </View>
              </Pressable>
            </View>
          </Animated.View>

          {/* ── 5. Intent rail (no section label; Clear inline) ─────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(150)}>
            <View style={{ paddingTop: 12 }}>
              <IntentChips active={activeIntent} onToggle={toggleIntent} onClear={clearFilters} />
            </View>
          </Animated.View>

          {/* ── 6. "Good for today" — editorial collection hero ──────────
              Editorial content about a REAL collection (never a venue), so it
              renders pre-consent too. */}
          <Animated.View entering={FadeIn.duration(450).delay(180)}>
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 18 }}>
              <Text
                style={{
                  fontFamily: FontFamily.display,
                  fontSize: 22,
                  color: tokens.label,
                  letterSpacing: -0.6,
                  marginBottom: 10,
                }}
              >
                Good for today
              </Text>
              <EditorialCollectionHero coll={hero} onPress={openHeroCollection} />
            </View>
          </Animated.View>

          {/* ── 7. Venue list — the ONLY consent-gated region ───────────── */}
          {consentStatus === 'checking' ? (
            <View style={{ paddingTop: 36, alignItems: 'center' }}>
              <ActivityIndicator color={tokens.label3} />
            </View>
          ) : consentStatus === 'granted' ? (
            <HomeResults
              activeIntent={activeIntent}
              isRain={!!isRain}
              refreshSeed={refreshSeed}
              onShuffle={() => setRefreshSeed((s) => s + 1)}
              onClearFilter={clearFilters}
            />
          ) : (
            <LocationNudge />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
