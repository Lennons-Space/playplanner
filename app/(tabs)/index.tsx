/**
 * Home — the decision-first landing screen.
 *
 * PRODUCT INTENT:
 * PlayPlanner is shifting from "browse a map" to "help me decide". This screen
 * answers one question for a tired parent in under five seconds: "where can I
 * take the kids right now?" The layout follows the reference design board:
 *   1. Location row (city label + filter icon)
 *   2. Greeting + weather pill ("Hi Liam 👋  Sunny today ☀️")
 *   3. Hero heading ("What's the plan today?")
 *   4. Search pill (taps into the search tab)
 *   5. Intent chip row (horizontal scroll — 6 moods)
 *   6. Age filter pills (Toddlers / 4–8 yrs / 9–12 yrs)
 *   7. "Good for today" venue list (consent-gated)
 *
 * PRIVACY (ICO Children's Code, Standard 10):
 * This screen does NOT request location on mount. It only READS the stored
 * consent flag via useLocationConsent (which never triggers the OS prompt).
 *   • consent granted → we show a small "good for today" nearby teaser
 *     (NearbyPreview, which is the only place that calls useLocation()).
 *   • consent not granted → we show a calm prompt card instead. The OS prompt
 *     happens later, on the results screen, exactly when the parent asks for
 *     suggestions (consent-on-intent).
 */

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProfile } from '@/hooks/useAuth';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { useWeather } from '@/hooks/useWeather';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { Icon } from '@/components/ui';
import { QuickPicks } from '@/components/home/QuickPicks';
import { NearbyPreview } from '@/components/home/NearbyPreview';
import { WeatherBackground } from '@/components/weather/WeatherBackground';
import type { Mood } from '@/lib/curation';
import type { Venue } from '@/types';

// ── Age filter pills ─────────────────────────────────────────────────────
// These are display-only UI filters on the home screen; they do not yet
// wire into the results query (a future iteration will add URL param support).
// The chips are shown as simple toggleable pills matching the reference design.

interface AgeFilter {
  id: string;
  label: string;
}

const AGE_FILTERS: AgeFilter[] = [
  { id: 'toddlers',  label: 'Toddlers'  },
  { id: '4-8',       label: '4–8 yrs' },
  { id: '9-12',      label: '9–12 yrs' },
];

export default function HomeScreen() {
  const profile = useProfile();
  const { status } = useLocationConsent();

  // Weather hook needs coords — we use undefined here so it fetches nothing
  // until NearbyPreview (which has real coords) mounts. We read weather from
  // the same React Query cache key that NearbyPreview populates, so the pill
  // appears once NearbyPreview has loaded weather. For the header pill we
  // pass undefined and let the hook return null gracefully.
  const weather = useWeather(undefined, undefined);

  // Age filter toggle state (single-select for now)
  const [activeAge, setActiveAge] = useState<string | null>(null);

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  const toggleAge = (id: string) => {
    setActiveAge((prev) => (prev === id ? null : id));
  };

  // Navigate to results, carrying the selected mood/intent.
  const goResults = (mood: Mood) => {
    router.push(`/explore/results?${new URLSearchParams({ mood }).toString()}`);
  };

  const openSearch = () => router.push('/(tabs)/search');
  const openMap = () => router.push('/explore/map');
  const openVenue = (venue: Venue) => router.push(`/venue/${venue.id}`);

  // Weather pill text — only shown when weather data is available.
  const weatherPill =
    weather != null ? `${weather.label} today ${weather.emoji}` : null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.warm }}>
      <WeatherBackground />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Location row ───────────────────────────────────────────── */}
        {/* Shows city/area label on the left and a filter/map shortcut on the right. */}
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
          {/* Location label — static for now; a future iteration will use reverse geocode. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="locate" size={13} color={Colors.label3} />
            <Text
              style={{ fontFamily: FontFamily.body, fontSize: 13, color: Colors.label3 }}
              accessibilityRole="text"
              accessibilityLabel="Your area"
            >
              Bristol
            </Text>
          </View>

          {/* Map shortcut — preserved from previous layout */}
          <TouchableOpacity
            onPress={openMap}
            accessibilityRole="button"
            accessibilityLabel="Open map"
            hitSlop={8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              paddingHorizontal: 11,
              paddingVertical: 7,
              borderRadius: BorderRadius.pill,
              backgroundColor: Colors.surface,
              borderWidth: 1,
              borderColor: Colors.separator,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.06,
              shadowRadius: 3,
              elevation: 2,
            }}
          >
            <Icon name="map" size={14} color={Colors.accent} />
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: Colors.label }}>
              Map
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Greeting row + weather pill ────────────────────────────── */}
        {/* "Hi Liam 👋" with an inline weather badge pill to the right. */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 6,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: Colors.label2 }}>
            {`Hi ${firstName ?? 'there'} 👋`}
          </Text>

          {weatherPill != null && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: BorderRadius.pill,
                backgroundColor: Colors.surface,
                borderWidth: 1,
                borderColor: Colors.separator,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 2,
                elevation: 1,
              }}
              accessibilityRole="text"
              accessibilityLabel={`Weather: ${weatherPill}`}
            >
              <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: Colors.label2 }}>
                {weatherPill}
              </Text>
            </View>
          )}
        </View>

        {/* ── Hero heading ───────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>
          <Text
            style={{
              fontFamily: FontFamily.display,
              fontSize: 32,
              color: Colors.label,
              letterSpacing: -0.8,
              lineHeight: 38,
            }}
          >
            {"What's the plan today?"}
          </Text>
        </View>

        {/* ── Search pill ───────────────────────────────────────────── */}
        {/* Full-width tappable pill. Pressing opens the search tab. */}
        <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
          <Pressable
            onPress={openSearch}
            accessibilityRole="search"
            accessibilityLabel="Search for places"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: Colors.surface,
              borderRadius: BorderRadius.pill,
              borderWidth: 1,
              borderColor: Colors.separator,
              paddingHorizontal: 16,
              paddingVertical: 13,
              gap: 10,
              opacity: pressed ? 0.85 : 1,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.06,
              shadowRadius: 4,
              elevation: 2,
            })}
          >
            <Icon name="search" size={17} color={Colors.label3} />
            <Text
              style={{
                flex: 1,
                fontFamily: FontFamily.body,
                fontSize: 15,
                color: Colors.label3,
              }}
              numberOfLines={1}
            >
              What do you want to do today?
            </Text>
            {/* Filter shortcut icon on the right of the search pill */}
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                backgroundColor: Colors.fill,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="filter" size={15} color={Colors.label2} />
            </View>
          </Pressable>
        </View>

        {/* ── Intent chips ──────────────────────────────────────────── */}
        {/* Horizontal scroll row — each chip maps to a Mood + curation. */}
        <View style={{ marginBottom: 18 }}>
          <QuickPicks onPick={goResults} />
        </View>

        {/* ── Age filter pills ──────────────────────────────────────── */}
        {/* Single-row, horizontally scrollable pill row below intent chips. */}
        <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {AGE_FILTERS.map((f) => {
              const active = activeAge === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => toggleAge(f.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Age filter: ${f.label}${active ? ', selected' : ''}`}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: BorderRadius.pill,
                    backgroundColor: active ? Colors.accent : Colors.surface2,
                    borderWidth: 1,
                    borderColor: active ? Colors.accent : Colors.separator,
                    opacity: pressed ? 0.75 : 1,
                    shadowColor: Colors.label,
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: active ? 0 : 0.05,
                    shadowRadius: 2,
                    elevation: active ? 0 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily: FontFamily.bodyStrong,
                      fontSize: 13,
                      color: active ? '#FFFFFF' : Colors.label,
                    }}
                  >
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Nearby teaser (consent-aware) ─────────────────────────── */}
        {status === 'granted' ? (
          <NearbyPreview onSeeAll={() => goResults('auto')} onVenuePress={openVenue} />
        ) : status === 'checking' ? null : (
          <LocationNudge onEnable={() => goResults('auto')} />
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
function LocationNudge({ onEnable }: { onEnable: () => void }) {
  return (
    <View style={{ paddingHorizontal: 20 }}>
      <Pressable
        onPress={onEnable}
        accessibilityRole="button"
        accessibilityLabel="See what's near you"
        style={({ pressed }) => ({
          backgroundColor: Colors.surface,
          borderRadius: BorderRadius.card,
          borderWidth: 1,
          borderColor: Colors.separator,
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
            backgroundColor: Colors.accentLight,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="locate" size={20} color={Colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: FontFamily.heading, fontSize: 15, color: Colors.label }}>
            {"See what's near you"}
          </Text>
          <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: Colors.label3, marginTop: 2 }}>
            Turn on location to get suggestions tailored to where you are.
          </Text>
        </View>
        <Icon name="chevR" size={18} color={Colors.label3} />
      </Pressable>
    </View>
  );
}
