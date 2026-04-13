/**
 * LocationConsentPrompt — shown before the OS location permission dialog.
 *
 * ICO Children's Code Standard 10: users must understand WHY location is
 * needed and that it is OFF by default, before the OS dialog appears.
 */
import { View, Text, TouchableOpacity } from 'react-native';

interface Props {
  onAccept: () => void;
  onDecline: () => void;
}

export function LocationConsentPrompt({ onAccept, onDecline }: Props) {
  return (
    <View className="flex-1 bg-slate items-center justify-center px-6">
      <Text
        className="text-2xl text-charcoal text-center mb-3"
        style={{ fontFamily: 'Nunito-ExtraBold' }}
      >
        Find venues near you?
      </Text>
      <Text
        className="text-base text-grey text-center mb-8"
        style={{ fontFamily: 'Nunito-Regular' }}
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
        className="w-full bg-sky rounded-2xl items-center justify-center mb-3"
        style={{ height: 52 }}
        onPress={onAccept}
        accessibilityRole="button"
        accessibilityLabel="Allow location access"
      >
        <Text className="text-white text-lg" style={{ fontFamily: 'Nunito-Bold' }}>
          Allow location
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className="w-full border-2 border-sky rounded-2xl items-center justify-center"
        style={{ height: 52 }}
        onPress={onDecline}
        accessibilityRole="button"
        accessibilityLabel="Browse without location"
      >
        <Text className="text-sky text-lg" style={{ fontFamily: 'Nunito-Bold' }}>
          Not now — browse without location
        </Text>
      </TouchableOpacity>
    </View>
  );
}
