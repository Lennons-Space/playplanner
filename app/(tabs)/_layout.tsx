import { Tabs, Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { Colors } from '@/constants/theme';
import { MapPin, Search, Heart, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const session = useAuthStore((s) => s.session);
  const insets = useSafeAreaInsets();

  // If not logged in, send to auth flow
  if (!session) return <Redirect href="/(auth)/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.sky,
        tabBarInactiveTintColor: Colors.grey,
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
          title: 'Explore',
          tabBarIcon: ({ color, size }) => <MapPin color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="favourites"
        options={{
          title: 'Favourites',
          tabBarIcon: ({ color, size }) => <Heart color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
