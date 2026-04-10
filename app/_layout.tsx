import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthListener } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutInner() {
  useAuthListener(); // starts listening to Supabase auth events
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)"   />
      <Stack.Screen name="(tabs)"   />
      <Stack.Screen name="venue/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="venue/add"  options={{ presentation: 'modal' }} />
      <Stack.Screen name="business/dashboard" />
      <Stack.Screen name="admin/moderation"   />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Nunito-Regular':   require('../assets/fonts/Nunito-Regular.ttf'),
    'Nunito-Medium':    require('../assets/fonts/Nunito-Medium.ttf'),
    'Nunito-Bold':      require('../assets/fonts/Nunito-Bold.ttf'),
    'Nunito-ExtraBold': require('../assets/fonts/Nunito-ExtraBold.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
          <RootLayoutInner />
        </StripeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
