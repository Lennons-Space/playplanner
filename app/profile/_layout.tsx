/**
 * Stack layout for all profile sub-screens.
 *
 * Screens under app/profile/ (edit, privacy-settings, data-download, etc.)
 * are pushed on top of the main tab navigator as a modal-style stack.
 *
 * The shared navigation header uses the dark v2 theme tokens (it was previously
 * a hardcoded coral header, which clashed with the dark reskin). Screens that
 * render their OWN in-screen header (notifications, privacy-settings) hide this
 * Stack header to avoid a double header; the rest rely on it for back + title.
 */
import { Stack } from 'expo-router';
import { Colors, FontFamily } from '@/constants/theme';

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.label,
        headerTitleStyle: { fontFamily: FontFamily.heading, fontSize: 18, color: Colors.label },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        // Dark base behind every pushed screen.
        contentStyle: { backgroundColor: Colors.bg },
      }}
    >
      {/* These screens render their own dark in-screen header — hide the Stack
          header so they don't show two stacked headers. */}
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="privacy-settings" options={{ headerShown: false }} />
    </Stack>
  );
}
