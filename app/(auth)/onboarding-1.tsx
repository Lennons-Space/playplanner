/**
 * Onboarding screen 1 — "Find family-friendly places near you"
 *
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY.
 * SecureStore onboarding-seen write, navigation targets, and accessibility
 * labels are byte-identical to the pre-restyle version — only styling
 * changed, same rule as Steps 1-5. Mounts <V2Background/> as the first
 * child of a transparent root, matching the frozen per-screen background
 * architecture (see app/(tabs)/profile.tsx, app/profile/edit.tsx).
 *
 * Privacy note: no data collected here. Screen shown before account creation.
 * Navigation: Skip → /(auth)/welcome | Next → /(auth)/onboarding-2
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { Icon } from '@/components/ui';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { GlassButton } from '@/components/ui/GlassButton';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, ocean } from '@/constants/theme';
import { ONBOARDING_KEY } from '.';

const ACCENT = ocean;

async function markOnboardingSeen() {
  await SecureStore.setItemAsync(ONBOARDING_KEY, '1').catch(() => {});
}

function Dots({ active }: { active: 0 | 1 | 2 }) {
  const { tokens: T } = useAppTheme();
  return (
    <View
      style={styles.dotsRow}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${active + 1} of 3`}
    >
      {([0, 1, 2] as const).map((i) => (
        <View
          key={i}
          style={[styles.dotBase, { backgroundColor: T.fill }, i === active && styles.dotActive]}
        />
      ))}
    </View>
  );
}

export default function Onboarding1() {
  const { tokens: T, mode } = useAppTheme();
  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe}>

        {/* Skip — top right */}
        <View style={styles.skipRow}>
          <TouchableOpacity
            onPress={async () => { await markOnboardingSeen(); router.replace('/(auth)/welcome'); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
          >
            <Text style={[styles.skipText, { color: T.label3 }]}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Hero illustration */}
        <View style={styles.heroArea} accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={[styles.heroCard, { backgroundColor: T.surface, borderColor: T.separator }]}>
            {/* Pin icon centred in a soft circle */}
            <View style={styles.pinCircle}>
              <Icon name="pin" size={32} color={ACCENT.accent} />
            </View>
            {/* Accent dots — purely decorative */}
            <View style={[styles.dot, { backgroundColor: T.star, top: 28, right: 36 }]} />
            <View style={[styles.dot, { backgroundColor: '#7C4FCC', bottom: 40, left: 28 }]} />
            <View style={[styles.dot, { backgroundColor: ACCENT.accent, bottom: 28, right: 52 }]} />
          </View>
        </View>

        {/* Copy */}
        <View style={styles.copyArea}>
          <Text style={[styles.headline, { color: T.label }]}>{"Find family-friendly\nplaces near you"}</Text>
          <Text style={[styles.subtitle, { color: T.label2 }]}>
            Discover soft plays, parks, cafes, museums and more — all hand-picked
            for families with young children.
          </Text>
        </View>

        <Dots active={0} />

        <GlassButton
          onPress={() => router.push('/(auth)/onboarding-2')}
          accessibilityLabel="Next onboarding screen"
          label="Next"
          style={styles.nextBtnLayout}
        />

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  skipRow: {
    alignItems: 'flex-end',
    paddingTop: 12,
    paddingBottom: 4,
  },
  skipText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
  },

  // Hero card
  heroArea: {
    flex: 1,
    maxHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  heroCard: {
    width: 200,
    height: 200,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // backgroundColor / borderColor: mode-aware, applied inline.
  },
  pinCircle: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: ACCENT.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Small accent dots scattered on the card
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 999,
  },

  // Copy
  copyArea: {
    marginBottom: 32,
  },
  headline: {
    fontFamily: FontFamily.display,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.6,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    lineHeight: 22,
  },

  // Dots
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  dotBase: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // backgroundColor: mode-aware, applied inline (T.fill).
  },
  dotActive: {
    backgroundColor: ACCENT.accent,
    width: 24,
    borderRadius: 4,
  },

  // CTA — Phase 3 (glass button system): "Next" is now a <GlassButton/>;
  // only layout survives here.
  nextBtnLayout: {
    borderRadius: 16,
    paddingVertical: 16,
  },
});
