/**
 * Stack layout for all profile sub-screens.
 *
 * Screens under app/profile/ (edit, privacy-settings, data-download, etc.)
 * are pushed on top of the main tab navigator as a modal-style stack.
 */
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: '#FF6B6B' },
        headerTintColor:  '#FFFFFF',
        headerTitleStyle: { fontFamily: 'Nunito-Bold', fontSize: 18 },
        headerBackTitle:  'Back',
      }}
    />
  );
}
