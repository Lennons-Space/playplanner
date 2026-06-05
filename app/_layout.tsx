import '../global.css';
import { useEffect, useState } from 'react';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import { PAYMENTS_ENABLED } from '@/constants/features';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useAuthListener, useProfileForegroundRefresh } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

// Set once at app boot — controls how notifications appear while the app is
// in the foreground. Placing this here (not in a hook file) avoids a global
// side effect firing on every module import.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// NativeWind v4: third-party components need cssInterop to accept className props.
// Core react-native components (View, Text, etc.) are handled automatically.
cssInterop(SafeAreaView, { className: 'style' });

SplashScreen.preventAutoHideAsync();

// queryClient is threaded down from RootLayout so useAuthListener can call
// queryClient.clear() on SIGNED_OUT, preventing cached user data from leaking
// to the next session on a shared device.
function RootLayoutInner({ queryClient }: { queryClient: QueryClient }) {
  useAuthListener(queryClient); // starts listening to Supabase auth events
  useProfileForegroundRefresh(); // re-fetches profile on foreground — catches server-side changes (BUG F)
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
      {/* Profile group — registered so Expo Router treats it as intentional */}
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      {/* Business upgrade — modal sheet for the subscription upsell flow */}
      <Stack.Screen name="business/upgrade" options={{ headerShown: false, presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // QueryClient inside component so it is not shared across hot reloads in dev.
  // retry:1 avoids hammering Supabase on transient errors; staleTime prevents
  // unnecessary refetches every time the user switches tabs.
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 1000 * 60,      // 1 min — data stays fresh across tab switches
        gcTime:    1000 * 60 * 5,  // 5 min — cache kept in memory
      },
      mutations: {
        retry: 0,
      },
    },
  }));

  const [fontsLoaded] = useFonts({
    'Nunito-Regular':   require('../assets/fonts/Nunito-Regular.ttf'),
    'Nunito-Medium':    require('../assets/fonts/Nunito-Medium.ttf'),
    'Nunito-Bold':      require('../assets/fonts/Nunito-Bold.ttf'),
    'Nunito-ExtraBold': require('../assets/fonts/Nunito-ExtraBold.ttf'),
  });

  if (!fontsLoaded) return null;

  // Payments are postponed until after launch validation (see constants/features.ts).
  // When the Stripe key is absent (e.g. EAS preview / beta), we must NOT mount
  // StripeProvider — initialising it without a publishable key throws and would
  // crash the app on boot. We render the same tree without the provider instead;
  // every payment CTA is guarded by PAYMENTS_ENABLED so nothing reaches Stripe.
  const tree = <RootLayoutInner queryClient={queryClient} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        {PAYMENTS_ENABLED ? (
          <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
            {tree}
          </StripeProvider>
        ) : (
          tree
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
