/**
 * Home — the decision-first landing screen.
 *
 * PRODUCT INTENT:
 * PlayPlanner is shifting from "browse a map" to "help me decide". This screen
 * answers one question for a tired parent in under five seconds: "where can I
 * take the kids right now?" The loud element is a single hero CTA; everything
 * else is quiet support (quick picks, an optional nearby teaser).
 *
 * PRIVACY (ICO Children's Code, Standard 10):
 * This screen does NOT request location on mount. It only READS the stored
 * consent flag via useLocationConsent (which never triggers the OS prompt).
 *   • consent granted → we show a small "good right now" nearby teaser
 *     (NearbyPreview, which is the only place that calls useLocation()).
 *   • consent not granted → we show a calm prompt card instead. The OS prompt
 *     happens later, on the results screen, exactly when the parent asks for
 *     suggestions (consent-on-intent).
 *
 * The map still exists — it is now a secondary surface reached via "Map" in the
 * header (app/explore/map.tsx), not the front door.
 */

import { View, Text, ScrollView, Pressable, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProfile } from '@/hooks/useAuth';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { Icon } from '@/components/ui';
import { HeroCard } from '@/components/home/HeroCard';
import { QuickPicks } from '@/components/home/QuickPicks';
import { NearbyPreview } from '@/components/home/NearbyPreview';
import type { Mood } from '@/lib/curation';
import type { Venue } from '@/types';

const C = {
  sand: '#FBF6EC',
  paper: '#FFFFFF',
  ink: '#1D2630',
  mute: '#7B8794',
  line: '#E6E2DB',
  skyDeep: '#1B8A85',
  skySoft: '#D4F0EE',
} as const;

function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

export default function HomeScreen() {
  const profile = useProfile();
  const { status } = useLocationConsent();

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  const goResults = (mood: Mood) => router.push(`/explore/results?mood=${mood}`);
  const openMap = () => router.push('/explore/map');
  const openVenue = (venue: Venue) => router.push(`/venue/${venue.id}`);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.sand }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: greeting + Map shortcut ───────────────────────── */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 18,
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: C.mute }}>
              {greetingWord()}{firstName ? `, ${firstName}` : ''} 👋
            </Text>
            <Text
              style={{
                fontFamily: 'Nunito-ExtraBold',
                fontSize: 26,
                color: C.ink,
                letterSpacing: -0.5,
                lineHeight: 30,
                marginTop: 2,
              }}
            >
              Let’s find something
            </Text>
          </View>

          <TouchableOpacity
            onPress={openMap}
            accessibilityRole="button"
            accessibilityLabel="Open map"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: C.paper,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: C.line,
            }}
          >
            <Icon name="map" size={15} color={C.skyDeep} />
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: C.ink }}>Map</Text>
          </TouchableOpacity>
        </View>

        {/* ── Hero CTA ──────────────────────────────────────────────── */}
        <View style={{ marginBottom: 22 }}>
          <HeroCard onPress={() => goResults('auto')} />
        </View>

        {/* ── Quick picks ───────────────────────────────────────────── */}
        <View style={{ marginBottom: 26 }}>
          <QuickPicks onPick={goResults} />
        </View>

        {/* ── Nearby teaser (consent-aware) ─────────────────────────── */}
        {status === 'granted' ? (
          <NearbyPreview onSeeAll={() => goResults('auto')} onVenuePress={openVenue} />
        ) : status === 'checking' ? null : (
          <LocationNudge onEnable={() => goResults('auto')} />
        )}
      </ScrollView>
    </SafeAreaView>
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
        accessibilityLabel="See what’s near you"
        style={({ pressed }) => ({
          backgroundColor: C.paper,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: C.line,
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
            backgroundColor: C.skySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="locate" size={20} color={C.skyDeep} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 15, color: C.ink }}>
            See what’s near you
          </Text>
          <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: C.mute, marginTop: 2 }}>
            Turn on location to get suggestions tailored to where you are.
          </Text>
        </View>
        <Icon name="chevR" size={18} color={C.mute} />
      </Pressable>
    </View>
  );
}
