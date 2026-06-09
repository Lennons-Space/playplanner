// ─────────────────────────────────────────────────────────────────
// HeroCard — the single most important action on the Home screen.
//
// One tap → the decision flow. Deliberately the loudest element on
// Home so a tired parent's eye lands on it within a second.
//
// WHY LinearGradient:
// On Android, a Pressable with elevation but no explicit background
// can render as transparent, making white text invisible. LinearGradient
// guarantees an opaque background at all times.
// ─────────────────────────────────────────────────────────────────

import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { Icon } from '@/components/ui';

// Ocean blue gradient — matches the v2 accent palette.
const GRADIENT_COLORS = [Colors.accent, '#2E72E0', '#1E5FD6'] as const;

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
        borderRadius: BorderRadius.featured,
        overflow: 'hidden',
        shadowColor: Colors.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
        elevation: 8,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={GRADIENT_COLORS}
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
          <Icon name="sparkle" size={28} color="#FFFFFF" />
        </View>

        {/* Text block */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: FontFamily.display, fontSize: 21, color: '#FFFFFF', letterSpacing: -0.4, lineHeight: 26 }}>
            Find something for us
          </Text>
          <Text
            style={{ fontFamily: FontFamily.body, fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 19 }}
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
          <Icon name="arrow" size={18} color="#FFFFFF" />
        </View>
      </LinearGradient>
    </Pressable>
  );
}
