/**
 * LocationConsentPrompt — shown before the OS location permission dialog.
 *
 * ICO Children's Code Standard 10: users must understand WHY location is
 * needed and that it is OFF by default, before the OS dialog appears.
 *
 * TODO: Wire this up in the map screen (app/(tabs)/index.tsx) before
 * calling useLocation(). Show this prompt first; only call useLocation
 * after the user taps "Allow location".
 */
import { View, Text, TouchableOpacity } from 'react-native';

interface Props {
  onAccept: () => void;
  onDecline: () => void;
}

export function LocationConsentPrompt({ onAccept, onDecline }: Props) {
  return (
    <View className="flex-1 bg-sand items-center justify-center px-6">
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
        Play Planner would like to use your location to show nearby soft plays,
        parks, and cafes. Your location is{' '}
        <Text style={{ fontFamily: 'Nunito-Bold' }}>never stored</Text>
        {' '}and only used while you search.
      </Text>
      <TouchableOpacity
        className="w-full bg-coral rounded-2xl items-center justify-center mb-3"
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
        className="w-full border-2 border-coral rounded-2xl items-center justify-center"
        style={{ height: 52 }}
        onPress={onDecline}
        accessibilityRole="button"
        accessibilityLabel="Decline location access for now"
      >
        <Text className="text-coral text-lg" style={{ fontFamily: 'Nunito-Bold' }}>
          Not now
        </Text>
      </TouchableOpacity>
    </View>
  );
}
