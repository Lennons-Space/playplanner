// ─────────────────────────────────────────────────────────────────────────
// TabsLayout — Play Planner v2 tab bar (Browse / Map / Saved / Profile).
//
// v2 spec: dark glass tab bar — translucent background rgba(14,14,20,0.82),
// 0.5px top border, active icon tinted the Ocean accent, inactive icons
// rgba(235,235,245,0.4), label 10px (600 weight active / 400 inactive),
// 22px bottom cushion on top of the device safe area.
//
// CRASH FIX (2026-07-08): the tab bar background used to render a real
// expo-blur BlurView. The on-device Android dev build predates expo-blur
// being added to the app, so it has no native ExpoBlurView manager — the
// tab bar mounts on every Home load, making it the guaranteed first crash
// trigger (Fabric IllegalViewOperationException). Real blur can return
// later via a native rebuild. 2026-07-09: the interim flat GlassSurface
// tint became a vertical gradient fade (see GLASS_GRADIENT below) so the
// bar reads as glass instead of chopping scrolled content off dead.
//
// Discover and Search stay real, navigable routes (href: null hides them from
// the bar only) — Search is reachable from Home's search bar, Discover from
// the Saved-tab empty state and other in-app links.
//
// STEP 8 (v2 dark restyle, 2026-07-16): the previous shared ambient weather
// layer has been REMOVED from this file entirely. Every tab screen now mounts
// its own <V2Background/> (Home, Map, Saved, Profile, and now Search) — the
// per-screen atmosphere pattern documented on components/ui/V2Background.
// There is no shared background left for this layout to own; each screen's
// own atmosphere continues underneath the (still shared) glass tab bar below.
//
// STATUS BAR (Phase A, v2 Light-theme correction, 2026-07-17): this shared
// default is now mode-aware — 'light' content on dark mode, 'dark' content on
// light mode — instead of hardcoded 'dark'. Every tab screen still mounts its
// own local <StatusBar/> that wins while it is focused (expo-status-bar
// stacks mounted instances); this is only the fallback for a future tab added
// without one, and it should match that per-screen behavior rather than
// always assuming dark-mode content.
// ─────────────────────────────────────────────────────────────────────────

import { Platform, StyleSheet, Text, View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '@/store/authStore';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Content height (icon + label) before safe-area/cushion padding is added.
// 46 (was 50, 2026-07-09 round 3): the bar read as a heavy block over Home's
// content on-device; icons+labels still fit comfortably (24 icon + label +
// 6 top padding).
const TAB_BAR_CONTENT_HEIGHT = 46;
// v2 spec: 22px bottom cushion ON TOP OF the device safe area — an iOS
// home-indicator aesthetic. On Android that made the bar needlessly tall and
// it visibly ate into Home's content, so Android uses a slim 6px cushion
// (10 → 6 in the 2026-07-09 round-3 slimming pass); gesture/3-button nav
// insets still stack on top via insets.bottom, so nothing collides with the
// system bar.
const TAB_BAR_BOTTOM_CUSHION = Platform.select({ ios: 22, default: 6 });
// Exact v2 glass spec — deliberately literal values, not theme tokens (the
// design calls out numbers slightly different from the nearest token, e.g.
// 0.4 alpha vs tokens.label3's 0.44).
const INACTIVE_TINT = 'rgba(235,235,245,0.4)';
// Vertical fade replacing the previous FLAT rgba(14,14,20,0.82) fill
// (2026-07-09 visual review): without real blur (BlurView is banned — native
// module missing from the dev build) a flat 0.82 tint chopped scrolling
// content off dead, which read as the bar "covering" section headers.
// A lighter top edge fading to near-opaque behind the icons keeps the icons
// fully legible while letting content passing beneath stay faintly visible —
// the closest honest approximation of frosted glass available to us.
// Lightened again in the round-3 pass (0.40/0.88/0.96 → 0.28/0.80/0.92):
// the bar was still reading as a dark block; the icons sit in the ≥0.80
// zone so legibility holds.
//
// Phase A (v2 Light-theme correction, 2026-07-17): mode-aware. `dark` is
// UNCHANGED from before this pass (byte-identical literals); `light` is new.
const GLASS = {
  dark: {
    border: 'rgba(255,255,255,0.12)',
    gradient: ['rgba(14,14,20,0.28)', 'rgba(14,14,20,0.80)', 'rgba(14,14,20,0.92)'] as const,
  },
  light: {
    border: 'rgba(20,18,28,0.12)',
    gradient: ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.94)'] as const,
  },
} as const;

export function TabBarBackground({ mode }: { mode: 'dark' | 'light' }) {
  const glass = GLASS[mode];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={glass.gradient}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.topBorder, { backgroundColor: glass.border }]} />
    </View>
  );
}

function TabLabel({ title, focused, color }: { title: string; focused: boolean; color: string }) {
  return (
    <Text
      style={{
        fontFamily: 'System',
        fontSize: 10,
        fontWeight: focused ? '600' : '400',
        color,
        marginTop: -2,
      }}
    >
      {title}
    </Text>
  );
}

export default function TabsLayout() {
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const insets = useSafeAreaInsets();
  const { accent, mode } = useAppTheme();

  // During cold-start session restore, isLoading is true while Supabase replays
  // the cached session via INITIAL_SESSION. Returning null here prevents a
  // premature redirect to auth that would then immediately flip back to tabs —
  // causing a visible flash and potentially breaking deep-link navigation.
  if (isLoading) return null;
  if (!session) return <Redirect href="/(auth)" />;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: accent.accent,
          tabBarInactiveTintColor: INACTIVE_TINT,
          // Let each screen's own <V2Background/> show through — every tab
          // screen (Home, Map, Saved, Profile, Search) now mounts its own,
          // so this stays transparent for all of them.
          sceneStyle: { backgroundColor: 'transparent' },
          tabBarBackground: () => <TabBarBackground mode={mode} />,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            height: TAB_BAR_CONTENT_HEIGHT + insets.bottom + TAB_BAR_BOTTOM_CUSHION,
            paddingBottom: insets.bottom + TAB_BAR_BOTTOM_CUSHION,
            paddingTop: 6,
          },
        }}
      >
        {/* ── Browse (Home) ───────────────────────────────────────────── */}
        <Tabs.Screen
          name="index"
          options={{
            title: 'Browse',
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
            tabBarLabel: ({ focused, color }) => <TabLabel title="Browse" focused={focused} color={color} />,
          }}
        />
        {/* ── Map ──────────────────────────────────────────────────────── */}
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" color={color} size={size} />,
            tabBarLabel: ({ focused, color }) => <TabLabel title="Map" focused={focused} color={color} />,
          }}
        />
        {/* ── Saved ────────────────────────────────────────────────────── */}
        <Tabs.Screen
          name="favourites"
          options={{
            title: 'Saved',
            tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" color={color} size={size} />,
            tabBarLabel: ({ focused, color }) => <TabLabel title="Saved" focused={focused} color={color} />,
          }}
        />
        {/* ── Profile ──────────────────────────────────────────────────── */}
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
            tabBarLabel: ({ focused, color }) => <TabLabel title="Profile" focused={focused} color={color} />,
          }}
        />
        {/* Discover is no longer a visible tab (v2 tab bar is Browse/Map/
            Saved/Profile), but the editorial collection experience stays
            intact and reachable (e.g. the Saved-tab empty state links to
            /discover) — href:null hides it from the bar while keeping the
            route navigable. */}
        <Tabs.Screen name="discover" options={{ href: null }} />
        {/* Search is reachable from Home's search bar via router.push('/(tabs)/search'). */}
        <Tabs.Screen name="search" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  topBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 0.5,
  },
});
