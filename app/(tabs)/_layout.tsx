import { View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/authStore';
import { Colors } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeatherBackground } from '@/components/weather/WeatherBackground';

export default function TabsLayout() {
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const insets = useSafeAreaInsets();

  // During cold-start session restore, isLoading is true while Supabase replays
  // the cached session via INITIAL_SESSION. Returning null here prevents a
  // premature redirect to auth that would then immediately flip back to tabs —
  // causing a visible flash and potentially breaking deep-link navigation.
  if (isLoading) return null;
  if (!session) return <Redirect href="/(auth)" />;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Play Planner v2 is a DARK app — force LIGHT status-bar icons so they
          read on the dark background. One global instance means switching tabs
          never leaves a stale per-screen mode. */}
      <StatusBar style="light" />
      {/* Single global weather layer behind every tab. Immersive + dark palette
          (the cinematic v2 atmosphere: deep navy rain/night, warm sunny glow).
          Absolute-fill, non-interactive, pauses when backgrounded and respects
          reduced motion (WeatherLayer). */}
      <WeatherBackground mode="immersive" paletteMode="dark" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: Colors.label3,
          // Let the global weather layer show through each tab's scene.
          sceneStyle: { backgroundColor: 'transparent' },
          tabBarStyle: {
            // Dark glass bar (README "Tab Bar"): a near-opaque dark fill with a
            // hairline top border. True backdrop blur needs a native dep, so we
            // approximate the glass with a high-opacity dark fill over the
            // weather layer.
            backgroundColor: 'rgba(14,14,20,0.94)',
            borderTopColor: 'rgba(255,255,255,0.10)',
            borderTopWidth: 0.5,
            paddingBottom: insets.bottom,
            height: 58 + insets.bottom,
          },
          tabBarLabelStyle: {
            fontFamily: 'System',
            fontSize: 10,
            marginTop: -2, // tighten icon→label spacing
          },
        }}
      >
      {/* ── Browse (Home) ─────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      {/* ── Map ───────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" color={color} size={size} />,
        }}
      />
      {/* ── Saved ─────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="favourites"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" color={color} size={size} />,
        }}
      />
      {/* ── Profile ───────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
      {/* Discover is NO LONGER a visible tab (v2 tab bar is Browse/Map/Saved/
          Profile), but the editorial collection experience is preserved: the
          screen and all its routes stay intact and remain reachable from the
          Browse home. href:null hides it from the tab bar while keeping it a
          navigable route. */}
      <Tabs.Screen
        name="discover"
        options={{
          href: null,
        }}
      />
      {/* Search is reachable from the Browse search bar via router.push('/search'). */}
      <Tabs.Screen
        name="search"
        options={{
          href: null,
        }}
      />
      </Tabs>
    </View>
  );
}
