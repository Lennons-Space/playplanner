import { View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
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
    <View style={{ flex: 1 }}>
      {/* Single global weather layer behind every tab. Ambient (light) family,
          readable with the dark text used across Home/Search/Favourites/Profile.
          Replaces the per-screen WeatherBackground instances that used to live
          in Home (immersive) and Search (ambient) — see the de-dupe in those
          files. It is absolute-fill, non-interactive, pauses when backgrounded
          and respects reduced motion (WeatherLayer). */}
      <WeatherBackground />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.sky,
          tabBarInactiveTintColor: Colors.grey,
          // Let the global weather layer show through each tab's scene.
          sceneStyle: { backgroundColor: 'transparent' },
          tabBarStyle: {
            backgroundColor: Colors.white,
            borderTopColor: Colors.greyLighter,
            paddingBottom: insets.bottom,
            height: 64 + insets.bottom,
          },
          tabBarLabelStyle: {
            fontFamily: 'Nunito-Bold',
            fontSize: 11,
          },
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" color={color} size={size} />,
        }}
      />
      {/* Search is no longer a visible tab (Discover replaces it), but the screen
          and all its logic/tests stay intact — it is reachable from the search
          bar on Discover via router.push('/search'). href:null hides it from the
          tab bar while keeping it a navigable route. */}
      <Tabs.Screen
        name="search"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="favourites"
        options={{
          title: 'Favourites',
          tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
      </Tabs>
    </View>
  );
}
