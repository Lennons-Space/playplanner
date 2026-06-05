// ─────────────────────────────────────────────────────────────────
// HeroCard — the single most important action on the Home screen.
//
// One tap → the decision flow. This is deliberately the only "loud"
// element on Home: a high-contrast gradient card so a tired parent's
// eye lands on it within a second. Everything else on Home stays quiet.
//
// WHY LinearGradient:
// The previous version used a plain backgroundColor. On Android this can
// fail to render (elevation + no background = transparent card) which made
// text appear white-on-sand. Using a LinearGradient as the outer wrapper
// gives the card a guaranteed opaque background at all times.
// ─────────────────────────────────────────────────────────────────

import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '@/components/ui';

const C = {
  skyDeep:  '#1B8A85',
  skyDeeper: '#146B67',
  sky:      '#2FB8B0',
  white:    '#FFFFFF',
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
        borderRadius: 28,
        overflow: 'hidden',
        // Shadow must be on the outer Pressable, not the LinearGradient child,
        // because overflow:hidden clips the shadow otherwise.
        shadowColor: C.skyDeep,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
        elevation: 8,
        opacity: pressed ? 0.92 : 1,
        // transform gives the subtle press-in feel without needing scale
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      {/* LinearGradient ensures the card always has an opaque background.
          On Android, a Pressable with elevation but no explicit background can
          render as transparent, making white text invisible on the sand page. */}
      <LinearGradient
        colors={[C.sky, C.skyDeep, C.skyDeeper]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          padding: 22,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Icon bubble */}
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="sparkle" size={28} color={C.white} />
        </View>

        {/* Text block */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 21, color: C.white, letterSpacing: -0.4, lineHeight: 26 }}>
            Find something for us
          </Text>
          <Text
            style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 19 }}
            numberOfLines={2}
          >
            {subtitle ?? "One tap — we'll suggest a few good places nearby."}
          </Text>
        </View>

        {/* Arrow */}
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 13,
            backgroundColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrow" size={18} color={C.white} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}
