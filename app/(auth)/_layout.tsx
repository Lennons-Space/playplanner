import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export default function AuthLayout() {
  const session   = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);

  // Wait for SecureStore to resolve before acting — prevents a flash of the
  // login screen for authenticated users while the session is being read.
  if (isLoading) return null;

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
