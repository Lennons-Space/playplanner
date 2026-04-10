import { Tabs, Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { Colors } from '@/constants/theme';
import { MapPin, Search, Heart, User } from 'lucide-react-native';

export default function TabsLayout() {
  const session = useAuthStore((s) => s.session);

  // If not logged in, send to auth flow
  if (!session) return <Redirect href="/(auth)/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.coral,
        tabBarInactiveTintColor: Colors.grey,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.greyLighter,
          paddingBottom: 4,
          height: 60,
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
