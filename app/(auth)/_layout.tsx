import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export default function AuthLayout() {
  const session = useAuthStore((s) => s.session);

  // If user is already logged in, send them to the main app
  if (session) return <Redirect href="/(tabs)" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome"  />
      <Stack.Screen name="login"    />
      <Stack.Screen name="register" />
    </Stack>
  );
}
