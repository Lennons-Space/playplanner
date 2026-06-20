/**
 * LocationConsentPrompt — shown before the OS location permission dialog.
 *
 * ICO Children's Code Standard 10: users must understand WHY location is
 * needed and that it is OFF by default, before the OS dialog appears.
 *
 * Visual: v2 dark editorial — colours/typography via the shared Colors +
 * FontFamily tokens (layout kept as NativeWind utility classes).
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, FontFamily } from '@/constants/theme';

interface Props {
  onAccept: () => void;
  onDecline: () => void;
}

export function LocationConsentPrompt({ onAccept, onDecline }: Props) {
  return (
    <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: Colors.bg }}>
      <Text
        className="text-center mb-3"
        style={{ fontFamily: FontFamily.display, fontSize: 24, color: Colors.label, letterSpacing: -0.4 }}
      >
        Find venues near you?
      </Text>
      <Text
        className="text-center mb-8"
        style={{ fontFamily: FontFamily.body, fontSize: 15, color: Colors.label2, lineHeight: 22 }}
      >
        {/*
          Wording note (GDPR Art.7 — informed consent):
          We must not claim location data is "never stored" or "not saved" —
          network requests and server logs may retain data briefly even when we
          do not store it ourselves. The accurate claim is that we do not store
          coordinates on our servers beyond what is needed to return results.
          ICO Children's Code Standard 10 requires transparency before consent.
        */}
        Play Planner would like to use your location to show nearby soft plays,
        parks, and cafes. Your device's location is used only to find venues near
        you — we do not store your coordinates on our servers.
        {'\n\n'}You can still browse venues without sharing your location — we'll show places across London instead. You can change this anytime in Settings.
      </Text>
      <TouchableOpacity
        className="w-full rounded-2xl items-center justify-center mb-3"
        style={{ height: 52, backgroundColor: Colors.accent }}
        onPress={onAccept}
        accessibilityRole="button"
        accessibilityLabel="Allow location access"
      >
        <Text className="text-lg" style={{ fontFamily: FontFamily.bodyStrong, color: '#FFFFFF' }}>
          Allow location
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="w-full rounded-2xl items-center justify-center"
        style={{ height: 52, borderWidth: 2, borderColor: Colors.accent }}
        onPress={onDecline}
        accessibilityRole="button"
        accessibilityLabel="Browse without location"
      >
        <Text className="text-lg" style={{ fontFamily: FontFamily.bodyStrong, color: Colors.accent }}>
          Not now — browse without location
        </Text>
      </TouchableOpacity>
    </View>
  );
}
