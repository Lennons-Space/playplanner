// ─────────────────────────────────────────────────────────────────
// HeroCard — the single most important action on the Home screen.
//
// One tap → the decision flow. This is deliberately the only "loud"
// element on Home: a filled, high-contrast card so a tired parent's eye
// lands on it within a second. Everything else on Home stays quiet.
// ─────────────────────────────────────────────────────────────────

import { Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/ui';

const C = {
  skyDeep: '#1B8A85',
  sky: '#2FB8B0',
  white: '#FFFFFF',
} as const;

export interface HeroCardProps {
  onPress: () => void;
  /** Optional context line (e.g. weather-aware). Falls back to a calm default. */
  subtitle?: string;
}

export function HeroCard({ onPress, subtitle }: HeroCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Find something for us"
      accessibilityHint="Suggests a few good places to take the kids right now"
      style={({ pressed }) => ({
        marginHorizontal: 20,
        backgroundColor: C.skyDeep,
        borderRadius: 28,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        transform: [{ scale: pressed ? 0.985 : 1 }],
        shadowColor: C.skyDeep,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
        elevation: 8,
      })}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 18,
          backgroundColor: 'rgba(255,255,255,0.16)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="sparkle" size={26} color={C.white} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 21, color: C.white, letterSpacing: -0.4 }}>
          Find something for us
        </Text>
        <Text
          style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: 'rgba(255,255,255,0.82)', marginTop: 3 }}
          numberOfLines={2}
        >
          {subtitle ?? 'One tap — we’ll suggest a few good places nearby.'}
        </Text>
      </View>

      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="arrow" size={18} color={C.white} />
      </View>
    </Pressable>
  );
}
