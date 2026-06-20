/**
 * Browse (Home) — Play Planner v2.
 *
 * The decision-first landing screen: a tired parent answers "where can I take
 * the kids right now?" in seconds. Recreated from the v2 design handoff
 * (claudedesign/design_handoff/pp2-home.jsx + screens/01-home-dark.png).
 *
 * Section order (top→bottom), per the design:
 *   1. Header — "YOUR AREA" overline + area name + chevron (→ map); brand mark (→ profile)
 *   2. Greeting + weather pill + "What's the plan today?" + context line
 *   3. Search bar (→ /search) with a filter button
 *   4. "What do you need today?" — intent chips
 *   5. "Who's coming?" — age chips (+ Clear)
 *   6. "Good for today" — the SmartFeaturedCard (top smart pick)
 *   7. Venue list — "Family favourites" / "More matches" (VenueCard2 rows)
 *
 * SMART PICK + FILTERING (lib/homeIntents, mapped onto REAL venue data — no
 * fabricated intents/ages/reasons):
 *   filter by active intent (or indoor-only when raining) → filter by age →
 *   sort by rating → top = featured, rest = list.
 *
 * PRIVACY (ICO Children's Code, Standard 10 + UK GDPR minimisation):
 *   Home shows nearby venues using useApproxCoords() — last-known coarse coords
 *   ONLY when location consent + OS permission are ALREADY granted (checked,
 *   never requested → no OS prompt on Home), otherwise a fixed public fallback
 *   (no personal location). The real location prompt still lives on the Map /
 *   results flow (consent-on-intent). Weather is the same coarse fetch the
 *   global WeatherBackground already makes.
 */

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useProfile } from '@/hooks/useAuth';
import { useAreaLabel, useApproxCoords } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useNearbyVenues } from '@/hooks/useVenues';
import { useSavedVenueIds, useToggleFavourite } from '@/hooks/useFavourites';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { DEFAULT_FILTERS } from '@/types';
import { Icon, PPBrandMark } from '@/components/ui';
import { SmartFeaturedCard } from '@/components/home/SmartFeaturedCard';
import { VenueCard2 } from '@/components/home/VenueCard2';
import { IntentChips } from '@/components/home/IntentChips';
import { AgeChips } from '@/components/home/AgeChips';
import {
  filterHomeVenues,
  pickFeatured,
  getContextTag,
  type IntentKey,
  type AgeKey,
} from '@/lib/homeIntents';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';

// ── Context line ────────────────────────────────────────────────────────
// Varies by weather/day/time. Pure function of the clock + weather condition;
// no personal data.
function getContextLine(isRain: boolean): string {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;
  if (isRain) {
    return isWeekend ? "Wet weekend? We've got you." : 'Rainy day ideas, sorted.';
  }
  if (isWeekend) {
    return hour < 12 ? 'Weekend morning sorted.' : 'Make the most of today.';
  }
  return hour < 12 ? 'Morning activity ideas ready.' : hour < 16 ? 'Afternoon sorted.' : 'After school, after stress.';
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

export default function HomeScreen() {
  const profile = useProfile();

  // Coarse coords for the venue + weather queries — NEVER prompts (see header).
  const { coords } = useApproxCoords();
  const weather = useWeather(coords.latitude, coords.longitude);

  const isRain =
    weather?.condition === 'rain' ||
    weather?.condition === 'drizzle' ||
    weather?.condition === 'showers' ||
    weather?.condition === 'thunderstorm';

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  // Area label — real data only, never prompts (useAreaLabel checks permission,
  // never requests it). Falls back to saved postcode, then a "Choose area" CTA.
  const geoArea = useAreaLabel();
  const areaLabel = geoArea || profile?.postcode?.trim() || 'Choose area';

  // Home's local filter state (independent of the global FilterSheet store).
  const [activeIntent, setActiveIntent] = useState<IntentKey | null>(null);
  const [activeAge, setActiveAge] = useState<AgeKey | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);

  const { data: venues = [], isLoading } = useNearbyVenues(coords, DEFAULT_FILTERS);

  // Saved state + toggle for the featured card's heart (existing favourites feature).
  const { savedIds } = useSavedVenueIds();
  const toggleFav = useToggleFavourite();

  const filtered = useMemo(
    () => filterHomeVenues(venues, activeIntent, activeAge, !!isRain),
    [venues, activeIntent, activeAge, isRain],
  );
  const { featured, rest } = useMemo(() => pickFeatured(filtered), [filtered]);
  const list = useMemo(() => seededShuffle(rest, refreshSeed).slice(0, MAX_LIST), [rest, refreshSeed]);

  const hasFilter = activeIntent != null || activeAge != null;
  const ctxLine = getContextLine(!!isRain);

  const openMap = () => router.push('/explore/map');
  const openProfile = () => router.push('/(tabs)/profile');
  const openSearch = () => router.push('/(tabs)/search');

  const toggleIntent = (key: IntentKey) => setActiveIntent((cur) => (cur === key ? null : key));
  const toggleAge = (key: AgeKey) => setActiveAge((cur) => (cur === key ? null : key));
  const clearFilters = () => {
    setActiveIntent(null);
    setActiveAge(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header: YOUR AREA + area + chevron, brand mark ─────────────── */}
          <Animated.View entering={FadeIn.duration(450)}>
            <View
              style={{
                paddingHorizontal: GUTTER,
                paddingTop: 10,
                paddingBottom: 4,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Pressable
                onPress={openMap}
                accessibilityRole="button"
                accessibilityLabel={`Your area: ${areaLabel} — open map`}
                style={({ pressed }) => ({ gap: 5, opacity: pressed ? 0.7 : 1 })}
              >
                <Text
                  style={{
                    fontFamily: FontFamily.bodyStrong,
                    fontSize: 11,
                    color: Colors.label3,
                    textTransform: 'uppercase',
                    letterSpacing: 1.32,
                  }}
                >
                  Your area
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Icon name="locate" size={14} color={Colors.accent} />
                  <Text
                    style={{ fontFamily: FontFamily.bodyStrong, fontSize: 17, color: Colors.label, letterSpacing: -0.3 }}
                    numberOfLines={1}
                  >
                    {areaLabel}
                  </Text>
                  <Icon name="chevD" size={13} color={Colors.label2} />
                </View>
              </Pressable>

              <PPBrandMark size={42} onPress={openProfile} accessibilityLabel="Open profile" />
            </View>
          </Animated.View>

          {/* ── Greeting + weather pill + headline + context line ──────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(60)}>
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: FontFamily.body, fontSize: 14.5, color: Colors.label3 }}>
                  {`Hi ${firstName ?? 'there'} 👋`}
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

              <Text
                style={{
                  fontFamily: FontFamily.display,
                  fontSize: 30,
                  color: Colors.label,
                  letterSpacing: -0.8,
                  lineHeight: 32,
                }}
              >
                {"What's the\nplan today?"}
              </Text>

              <Text style={{ fontFamily: FontFamily.body, fontSize: 14.5, color: Colors.label3, marginTop: 8 }}>
                {ctxLine}
              </Text>
            </View>
          </Animated.View>

          {/* ── Search bar (→ /search) + filter button ─────────────────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(100)}>
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 18 }}>
              <Pressable
                onPress={openSearch}
                accessibilityRole="button"
                accessibilityLabel="Search venues"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: Colors.surface2,
                  borderRadius: BorderRadius.chip,
                  borderWidth: 1,
                  borderColor: Colors.separator,
                  paddingVertical: 14,
                  paddingLeft: 16,
                  paddingRight: 14,
                  opacity: pressed ? 0.92 : 1,
                })}
              >
                <Icon name="search" size={18} color={Colors.label3} />
                <Text
                  style={{ flex: 1, fontFamily: FontFamily.body, fontSize: 15, color: Colors.label3 }}
                  numberOfLines={1}
                >
                  What are the kids in the mood for?
                </Text>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: Colors.accentLight,
                  }}
                >
                  <Icon name="sliders" size={16} color={Colors.accent} />
                </View>
              </Pressable>
            </View>
          </Animated.View>

          {/* ── Intent chips ───────────────────────────────────────────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(140)}>
            <Text style={[styleLabel]}>What do you need today?</Text>
            <IntentChips active={activeIntent} onToggle={toggleIntent} />
          </Animated.View>

          {/* ── Age chips ──────────────────────────────────────────────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(170)}>
            <Text style={[styleLabel]}>Who&apos;s coming?</Text>
            <AgeChips active={activeAge} onToggle={toggleAge} showClear={hasFilter} onClear={clearFilters} />
          </Animated.View>

          {/* ── "Good for today" featured card ─────────────────────────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(200)}>
            <Text style={[styleLabel, { marginTop: 24 }]}>Good for today</Text>
            <View style={{ paddingHorizontal: GUTTER }}>
              {isLoading ? (
                <View style={{ height: 440, borderRadius: BorderRadius.featured, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.separator }} />
              ) : featured ? (
                <SmartFeaturedCard
                  venue={featured}
                  onPress={() => router.push(`/venue/${featured.id}`)}
                  saved={savedIds.has(featured.id)}
                  onToggleSave={() => toggleFav.mutate({ venueId: featured.id, currentlySaved: savedIds.has(featured.id) })}
                />
              ) : (
                <View
                  style={{
                    borderRadius: BorderRadius.featured,
                    backgroundColor: Colors.surface,
                    borderWidth: 1,
                    borderColor: Colors.separator,
                    padding: 24,
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Icon name="map" size={28} color={Colors.label3} />
                  <Text style={{ fontFamily: FontFamily.heading, fontSize: 16, color: Colors.label, textAlign: 'center' }}>
                    No matches right now
                  </Text>
                  <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: Colors.label3, textAlign: 'center' }}>
                    {hasFilter ? 'Try a different filter or clear them.' : 'Pull to refresh or explore the map.'}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>

          {/* ── Venue list ─────────────────────────────────────────────────── */}
          {(isLoading || list.length > 0) && (
            <Animated.View entering={FadeIn.duration(450).delay(240)} style={{ marginTop: 24 }}>
              <View
                style={{
                  paddingHorizontal: GUTTER,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontFamily: FontFamily.display, fontSize: 20, color: Colors.label, letterSpacing: -0.5 }}>
                  {hasFilter ? 'More matches' : 'Family favourites'}
                </Text>
                {list.length > 0 && (
                  <Pressable
                    onPress={() => setRefreshSeed((s) => s + 1)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Shuffle list"
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Icon name="refresh" size={20} color={Colors.label3} />
                  </Pressable>
                )}
              </View>

              <View style={{ paddingHorizontal: GUTTER, gap: 10 }}>
                {isLoading ? (
                  <>
                    <VenueRowSkeleton />
                    <VenueRowSkeleton />
                    <VenueRowSkeleton />
                  </>
                ) : (
                  list.map((venue) => (
                    <VenueCard2
                      key={venue.id}
                      venue={venue}
                      contextTag={getContextTag(venue, activeIntent, activeAge)}
                      onPress={() => router.push(`/venue/${venue.id}`)}
                    />
                  ))
                )}
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// Shared section label ("What do you need today?", "Who's coming?", "Good for today").
const styleLabel = {
  fontFamily: FontFamily.caption,
  fontSize: 12,
  color: Colors.label3,
  textTransform: 'uppercase' as const,
  letterSpacing: 1.1,
  paddingHorizontal: GUTTER,
  marginTop: 22,
  marginBottom: 12,
};
