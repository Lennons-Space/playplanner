/**
 * Home — the decision-first landing screen.
 *
 * PRODUCT INTENT:
 * PlayPlanner is shifting from "browse a map" to "help me decide". This screen
 * answers one question for a tired parent in under five seconds: "where can I
 * take the kids right now?"
 *
 * Phase 1 reskin (ported from design handoff pp2-home.jsx / README "1. Home
 * Screen"). Section order (top to bottom):
 *   1. Header — "YOUR AREA" overline + area name + chevron (-> map), brand
 *      mark (-> profile)
 *   2. Greeting + weather pill + two-line headline + context line
 *   3. Search bar (-> search tab)
 *   4. Intent chips (QuickPicks) — "What do you need today?"
 *   5. Age filter chips — "Who's coming?"
 *   6. "Good for today" / nearby teaser (consent-gated)
 *
 * PRIVACY (ICO Children's Code, Standard 10):
 * This screen does NOT request location on mount. It only READS the stored
 * consent flag via useLocationConsent (which never triggers the OS prompt).
 *   • consent granted → we show a small "good for today" nearby teaser
 *     (NearbyPreview, which is the only place that calls useLocation()).
 *   • consent not granted → we show a calm prompt card instead. The OS prompt
 *     happens later, on the results screen, exactly when the parent asks for
 *     suggestions (consent-on-intent).
 *
 * Theming: chrome (text/cards/chips) uses the new useAppTheme() tokens
 * (Themes.dark/Themes.light, additive — see constants/theme.ts). The animated
 * weather background is unchanged and continues to read from
 * useWeatherTheme()/WEATHER_THEMES via WeatherBackground's `paletteMode` prop,
 * which is independent of useAppTheme().
 */

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, type ViewStyle, type TextStyle } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useProfile } from '@/hooks/useAuth';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { useAreaLabel } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, BorderRadius } from '@/constants/theme';
import { Icon, PPBrandMark } from '@/components/ui';
import { QuickPicks } from '@/components/home/QuickPicks';
import { MoodPicks } from '@/components/home/MoodPicks';
import { NearbyPreview } from '@/components/home/NearbyPreview';
import { RecentlyViewedRow } from '@/components/home/RecentlyViewedRow';
import { OpenNowRow } from '@/components/home/OpenNowRow';
import type { MoodId } from '@/lib/moods';
import type { Mood } from '@/lib/curation';
import type { Venue } from '@/types';
import type { ThemeTokens, AccentPalette } from '@/constants/theme';

// ── Age filter pills ─────────────────────────────────────────────────────
// These are display-only UI filters on the home screen; they do not yet
// wire into the results query (a future iteration will add URL param
// support). Emoji + labels ported verbatim from the design handoff's
// AGE_FILTERS (README "Age filter chips").

interface AgeFilter {
  id: string;
  label: string;
  emoji: string;
}

const AGE_FILTERS: AgeFilter[] = [
  { id: 'toddler', label: 'Toddlers', emoji: '👶' },
  { id: 'little',  label: '4–8 yrs',  emoji: '🧒' },
  { id: 'older',   label: '9–12 yrs', emoji: '🧑' },
];

// ── Section bubble ────────────────────────────────────────────────────────
// Soft "floating island" container that groups a section (label + its cards)
// into one premium widget on the warm weather wash. Translucent paper fill so
// the weather background still reads through; large radius; soft warm shadow;
// no harsh border. Shared by the search / intent / age / "good for today"
// sections (see also NearbyPreview). Purely presentational.
const SECTION_BUBBLE: ViewStyle = {
  marginHorizontal: 18,
  borderRadius: 32,
  backgroundColor: 'rgba(255,255,255,0.56)',
  // Soft paper edge for definition (NOT a harsh grey border).
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.55)',
  paddingVertical: 18,
  paddingHorizontal: 20,
  // iOS soft shadow. NOTE: no Android `elevation` here — `elevation` combined
  // with a translucent backgroundColor renders an opaque rectangular shadow-
  // plate artifact on Android (the "random box" inside each bubble). On Android
  // depth comes from the translucent paper layering + soft border instead.
  shadowColor: '#2A1E0A',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.04,
  shadowRadius: 18,
};

// Shared eyebrow heading for utility sections (uppercase, warm grey, wider
// tracking). "Good for today" keeps its larger display title (NearbyPreview).
const EYEBROW: TextStyle = {
  fontFamily: FontFamily.bodyStrong,
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: 2,
  marginBottom: 14,
};

// ── Context line ────────────────────────────────────────────────────────
// Ported verbatim from pp2-home.jsx ctxLine logic — varies by weather/day/
// time. Pure function of the clock + weather condition; no personal data.
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

export default function HomeScreen() {
  const profile = useProfile();
  const { status } = useLocationConsent();
  const { tokens, accent, mode } = useAppTheme();

  // Weather hook needs coords — we use undefined here so it fetches nothing
  // until NearbyPreview (which has real coords) mounts. We read weather from
  // the same React Query cache key that NearbyPreview populates, so the pill
  // appears once NearbyPreview has loaded weather. For the header pill we
  // pass undefined and let the hook return null gracefully.
  const weather = useWeather(undefined, undefined);

  // Rainy-vs-not drives the weather pill tint and the context line — matches
  // the design handoff's binary rain/sunny treatment, generalised to cover
  // all rain-like conditions (rain/drizzle/showers/thunderstorm).
  const isRain =
    weather?.condition === 'rain' ||
    weather?.condition === 'drizzle' ||
    weather?.condition === 'showers' ||
    weather?.condition === 'thunderstorm';

  // Age filter toggle state (single-select, display-only for now).
  const [activeAge, setActiveAge] = useState<string | null>(null);

  // Kids' mood selection (single-select, local UI only — see lib/moods). Tapping
  // the active mood deselects it. Does not alter queries or ranking (TASK 6).
  const [activeMood, setActiveMood] = useState<MoodId | null>(null);

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  // Area label — real data only, never prompts for permission on load:
  //   1. reverse-geocoded city/town when location consent is already granted
  //      AND OS permission already granted (useAreaLabel — no prompt, no GPS
  //      stored, just the locality name).
  //   2. saved profile postcode (typed "approx location — user-visible only").
  //   3. fallback CTA "Choose area" (tapping opens the map).
  const geoArea = useAreaLabel();
  const areaLabel = geoArea || profile?.postcode?.trim() || 'Choose area';

  const toggleAge = (id: string) => {
    setActiveAge((prev) => (prev === id ? null : id));
  };

  const toggleMood = (id: MoodId) => {
    setActiveMood((prev) => (prev === id ? null : id));
  };

  // Navigate to results, carrying the selected mood/intent.
  const goResults = (mood: Mood) => {
    router.push(`/explore/results?${new URLSearchParams({ mood }).toString()}`);
  };

  const openMap = () => router.push('/explore/map');
  const openProfile = () => router.push('/(tabs)/profile');
  const openVenue = (venue: Venue) => router.push(`/venue/${venue.id}`);

  const ctxLine = getContextLine(isRain);

  return (
    // Transparent — the single global WeatherBackground in app/(tabs)/_layout
    // renders behind every tab now (no per-screen weather layer here).
    <View style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header: "YOUR AREA" + Bristol + chevron, brand mark ─────── */}
          <Animated.View entering={FadeIn.duration(450)}>
            <View
              style={{
                paddingHorizontal: 20,
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
                    color: tokens.label3,
                    textTransform: 'uppercase',
                    letterSpacing: 1.32, // 0.12em @ 11px
                  }}
                >
                  Your area
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Icon name="locate" size={14} color={accent.accent} />
                  <Text
                    style={{
                      fontFamily: FontFamily.bodyStrong,
                      fontSize: 17,
                      color: tokens.label,
                      letterSpacing: -0.3,
                    }}
                    numberOfLines={1}
                  >
                    {areaLabel}
                  </Text>
                  <Icon name="chevD" size={13} color={tokens.label2} />
                </View>
              </Pressable>

              <PPBrandMark size={42} onPress={openProfile} accessibilityLabel="Open profile" />
            </View>
          </Animated.View>

          {/* ── Greeting + weather pill + headline + context line ───────── */}
          <Animated.View entering={FadeIn.duration(450).delay(60)}>
            <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: FontFamily.body, fontSize: 14.5, color: tokens.label3 }}>
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
                        color: isRain
                          ? (mode === 'light' ? '#3E6EA0' : '#8FBEE8')
                          : (mode === 'light' ? '#A66A12' : '#FFC976'),
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
                  fontSize: 40,
                  fontWeight: '800',
                  color: tokens.label,
                  letterSpacing: -1,
                  lineHeight: 44,
                }}
              >
                {"What's the\nplan today?"}
              </Text>

              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: tokens.label, opacity: 0.65, marginTop: 12 }}>
                {ctxLine}
              </Text>
            </View>
          </Animated.View>

          {/* ── Kids' mood discovery bubble (replaces the old search field) ── */}
          <Animated.View entering={FadeIn.duration(450).delay(100)}>
            <View style={[SECTION_BUBBLE, { marginTop: 28, paddingHorizontal: 0 }]}>
              <Text style={[EYEBROW, { color: tokens.label3, paddingHorizontal: 20 }]}>
                What are the kids in the mood for?
              </Text>
              <MoodPicks selected={activeMood} onSelect={toggleMood} contentPaddingHorizontal={20} />
            </View>
          </Animated.View>

          {/* ── Intent chips ─────────────────────────────────────────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(120)}>
            <View style={[SECTION_BUBBLE, { marginTop: 28, paddingHorizontal: 0 }]}>
              <Text style={[EYEBROW, { color: tokens.label3, paddingHorizontal: 20 }]}>
                What do you need today?
              </Text>
              <QuickPicks onPick={goResults} contentPaddingHorizontal={20} />
            </View>
          </Animated.View>

          {/* ── Age filter tiles (emoji on top, centred label) ───────────── */}
          <Animated.View entering={FadeIn.duration(450).delay(140)}>
            <View style={[SECTION_BUBBLE, { marginTop: 28 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <Text style={[EYEBROW, { color: tokens.label3, marginBottom: 0 }]}>Who&apos;s coming?</Text>
                {activeAge != null && (
                  <Pressable
                    onPress={() => setActiveAge(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Clear age filter"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Icon name="close" size={12} color={tokens.label3} />
                    <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12.5, color: tokens.label3 }}>Clear</Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                {AGE_FILTERS.map((f) => {
                  const active = activeAge === f.id;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => toggleAge(f.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Age filter: ${f.label}${active ? ', selected' : ''}`}
                      style={({ pressed }) => ({ width: 84, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}
                    >
                      {/* Emoji tile — soft fill, accent ring when selected */}
                      <View
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 18,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: active ? accent.light : tokens.fill,
                          borderWidth: active ? 1.5 : 0,
                          borderColor: active ? accent.accent : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 30 }}>{f.emoji}</Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={{
                          marginTop: 12,
                          fontFamily: FontFamily.bodyStrong,
                          fontSize: 13,
                          textAlign: 'center',
                          color: active ? accent.accent : tokens.label2,
                        }}
                      >
                        {f.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Animated.View>

          {/* ── Nearby teaser (consent-aware) ────────────────────────────── */}
          <View style={{ paddingTop: 28 }}>
            {status === 'granted' ? (
              <NearbyPreview onSeeAll={() => goResults('auto')} onVenuePress={openVenue} />
            ) : status === 'checking' ? null : (
              <LocationNudge onEnable={() => goResults('auto')} tokens={tokens} accent={accent} />
            )}
          </View>

          {/* ── Recently viewed (local only; hides itself when empty) ─────── */}
          <RecentlyViewedRow onVenuePress={(venueId) => router.push(`/venue/${venueId}`)} />

          {/* ── Open right now (consent-gated; reuses cached venues; hides when none) ── */}
          {status === 'granted' && (
            <OpenNowRow onVenuePress={(venueId) => router.push(`/venue/${venueId}`)} />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── LocationNudge ───────────────────────────────────────────────────
// Shown when location consent has not been granted. Calm, honest, no dark
// patterns: it explains the benefit and routes into the results flow, where
// the actual consent prompt is presented (consent-on-intent).
//
// This card is NOT in the design handoff (the prototype has no consent
// concept) — it is a legal requirement (ICO Children's Code) and is restyled
// here with the new useAppTheme() tokens to match the rest of Home.
function LocationNudge({
  onEnable,
  tokens,
  accent,
}: {
  onEnable: () => void;
  tokens: ThemeTokens;
  accent: AccentPalette;
}) {
  return (
    <Animated.View entering={FadeIn.duration(450).delay(160)}>
      <View style={{ paddingHorizontal: 20 }}>
        <Pressable
          onPress={onEnable}
          accessibilityRole="button"
          accessibilityLabel="See what's near you"
          style={({ pressed }) => ({
            backgroundColor: tokens.surface,
            borderRadius: BorderRadius.card,
            borderWidth: 1,
            borderColor: tokens.separator,
            padding: 18,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            opacity: pressed ? 0.8 : 1,
          })}
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
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: FontFamily.heading, fontSize: 15, color: tokens.label }}>
              {"See what's near you"}
            </Text>
            <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3, marginTop: 2 }}>
              Turn on location to get suggestions tailored to where you are.
            </Text>
          </View>
          <Icon name="chevR" size={18} color={tokens.label3} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
