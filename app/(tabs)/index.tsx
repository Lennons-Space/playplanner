/**
 * Home — the decision-first landing screen.
 *
 * PRODUCT INTENT:
 * PlayPlanner is shifting from "browse a map" to "help me decide". This screen
 * answers one question for a tired parent in under five seconds: "where can I
 * take the kids right now?"
 *
 * Home Final pass. Home is a calm hallway, not a magazine: it answers "what
 * should we do today?" with ONE editorial idea (a Discover collection), then a
 * personal "Continue exploring" strip and a quiet Discover link. It never shows
 * a venue as the hero and never lists places — that is Discover / the
 * collection pages. Section order (top→bottom):
 *   1. Header — "YOUR AREA" overline + area name + chevron (-> map), brand
 *      mark (-> profile)
 *   2. Greeting + weather pill + two-line headline + context line
 *   3. Editorial collection hero (ALWAYS shown) — the dominant object
 *   4. Continue exploring (local recently-viewed; hides when empty)
 *   5. Quiet footer link -> Discover
 *
 * PRIVACY (ICO Children's Code, Standard 10):
 * Home no longer reads location or mounts any location-using component. The
 * hero is a weather/season-driven COLLECTION (coarse FALLBACK_LOCATION weather
 * only — the same cached fetch the global WeatherBackground makes; no OS
 * prompt, no consent needed). Location consent is requested later, on the
 * results / map flow (consent-on-intent).
 *
 * Theming: chrome (text/cards/chips) uses the new useAppTheme() tokens
 * (Themes.dark/Themes.light, additive — see constants/theme.ts). The animated
 * weather background is unchanged and continues to read from
 * useWeatherTheme()/WEATHER_THEMES via WeatherBackground's `paletteMode` prop,
 * which is independent of useAppTheme().
 */

import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useProfile } from '@/hooks/useAuth';
import { useAreaLabel } from '@/hooks/location';
import { useWeather } from '@/hooks/useWeather';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, BorderRadius } from '@/constants/theme';
import { Icon, PPBrandMark } from '@/components/ui';
import { EditorialHero } from '@/components/home/EditorialHero';
import { RecentlyViewedRow } from '@/components/home/RecentlyViewedRow';

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

// Single shared horizontal content gutter for every Home section (header,
// greeting, hero, Continue exploring). Nothing on Home begins at x=0.
const GUTTER = 20;

export default function HomeScreen() {
  const profile = useProfile();
  const { tokens, accent, mode } = useAppTheme();

  // Header greeting pill weather only — passed undefined coords so the hook
  // stays inert here (no fetch, returns null) and the pill simply hides. The
  // editorial hero reads its own coarse weather (see EditorialHero).
  const weather = useWeather(undefined, undefined);

  // Rainy-vs-not drives the weather pill tint and the context line — matches
  // the design handoff's binary rain/sunny treatment, generalised to cover
  // all rain-like conditions (rain/drizzle/showers/thunderstorm).
  const isRain =
    weather?.condition === 'rain' ||
    weather?.condition === 'drizzle' ||
    weather?.condition === 'showers' ||
    weather?.condition === 'thunderstorm';

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  // Area label — real data only, never prompts for permission on load:
  //   1. reverse-geocoded city/town when location consent is already granted
  //      AND OS permission already granted (useAreaLabel — no prompt, no GPS
  //      stored, just the locality name).
  //   2. saved profile postcode (typed "approx location — user-visible only").
  //   3. fallback CTA "Choose area" (tapping opens the map).
  const geoArea = useAreaLabel();
  const areaLabel = geoArea || profile?.postcode?.trim() || 'Choose area';

  const openMap = () => router.push('/explore/map');
  const openProfile = () => router.push('/(tabs)/profile');

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
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
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

              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: tokens.label, opacity: 0.65, marginTop: 8 }}>
                {ctxLine}
              </Text>
            </View>
          </Animated.View>

          {/* ── Editorial collection hero — Home's ONE beautiful idea ───────
              Always shown (no consent gate; needs no location). Never a venue:
              it surfaces an existing Discover collection and opens its page. The
              single, obvious Discover handoff lives in this card's Explore pill —
              there is no duplicate bottom CTA. */}
          <Animated.View
            entering={FadeIn.duration(450).delay(100)}
            style={{ paddingHorizontal: GUTTER, paddingTop: 28 }}
          >
            <EditorialHero
              onOpenCollection={(key) =>
                router.push({ pathname: '/discover/[collection]', params: { collection: key } })
              }
            />
          </Animated.View>

          {/* ── Continue exploring (memory; local only; hides itself when empty) ── */}
          <RecentlyViewedRow onVenuePress={(venueId) => router.push(`/venue/${venueId}`)} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
