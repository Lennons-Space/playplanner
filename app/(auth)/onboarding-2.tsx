/**
 * Onboarding screen 2 — "Honest reviews from parents like you"
 *
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY. Same
 * preservation rule as onboarding-1.tsx — navigation targets and
 * accessibility labels are byte-identical; only styling changed.
 *
 * Navigation: Back → /(auth)/onboarding-1 | Skip → /(auth)/welcome | Next → /(auth)/onboarding-3
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { Icon } from '@/components/ui';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
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

export default function Onboarding2() {
  const { tokens: T, mode } = useAppTheme();
  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe}>

        {/* Top row: back + skip */}
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Go back to previous onboarding screen"
          >
            <Icon name="chevL" size={24} color={T.label} />
          </TouchableOpacity>

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
            {/* Three stars suggesting a review rating */}
            <View style={styles.starsRow}>
              <Icon name="star" size={28} color={T.star} />
              <Icon name="star" size={28} color={T.star} />
              <Icon name="star" size={28} color={T.star} />
            </View>
            {/* Pill shapes suggesting review UI items */}
            <View style={styles.reviewPillsRow}>
              <View style={[styles.reviewPill, { backgroundColor: T.surface2, borderColor: T.separator }]} />
              <View style={[styles.reviewPill, { backgroundColor: T.surface2, borderColor: T.separator }]} />
            </View>
          </View>
        </View>

        {/* Copy */}
        <View style={styles.copyArea}>
          <Text style={[styles.headline, { color: T.label }]}>{"Honest reviews from\nparents like you"}</Text>
          <Text style={[styles.subtitle, { color: T.label2 }]}>
            Every review is written by a real parent. No sponsored posts — just
            genuine experiences to help you plan a great day out.
          </Text>
        </View>

        <Dots active={1} />

        {/* Back + Next */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.backBtn, { borderColor: T.separator }]}
            onPress={() => router.back()}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={[styles.backBtnText, { color: T.label }]}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.nextBtn}
            onPress={() => router.push('/(auth)/onboarding-3')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Next onboarding screen"
          >
            <Text style={styles.nextBtnText}>Next</Text>
          </TouchableOpacity>
        </View>

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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    gap: 16,
    // backgroundColor / borderColor: mode-aware, applied inline.
  },
  starsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  reviewPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  // Narrow pill shapes to suggest review list items
  reviewPill: {
    width: 80,
    height: 20,
    borderRadius: 999,
    borderWidth: 1,
    // backgroundColor / borderColor: mode-aware, applied inline.
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

  // Buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
    // borderColor: mode-aware, applied inline.
  },
  backBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    // color: mode-aware, applied inline (T.label).
  },
  nextBtn: {
    flex: 2,
    backgroundColor: ACCENT.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: '#FFFFFF',
  },
});
