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
import { V2Background } from '@/components/ui/V2Background';
import { Themes, FontFamily, ocean } from '@/constants/theme';
import { ONBOARDING_KEY } from '.';

const T = Themes.dark;
const ACCENT = ocean;

async function markOnboardingSeen() {
  await SecureStore.setItemAsync(ONBOARDING_KEY, '1').catch(() => {});
}

function Dots({ active }: { active: 0 | 1 | 2 }) {
  return (
    <View
      style={styles.dotsRow}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${active + 1} of 3`}
    >
      {([0, 1, 2] as const).map((i) => (
        <View key={i} style={[styles.dotBase, i === active && styles.dotActive]} />
      ))}
    </View>
  );
}

export default function Onboarding1() {
  return (
    <View style={styles.root}>
      <V2Background />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>

        {/* Skip — top right */}
        <View style={styles.skipRow}>
          <TouchableOpacity
            onPress={async () => { await markOnboardingSeen(); router.replace('/(auth)/welcome'); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Hero illustration */}
        <View style={styles.heroArea} accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={styles.heroCard}>
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
          <Text style={styles.headline}>{"Find family-friendly\nplaces near you"}</Text>
          <Text style={styles.subtitle}>
            Discover soft plays, parks, cafes, museums and more — all hand-picked
            for families with young children.
          </Text>
        </View>

        <Dots active={0} />

        <TouchableOpacity
          style={styles.nextBtn}
          onPress={() => router.push('/(auth)/onboarding-2')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Next onboarding screen"
        >
          <Text style={styles.nextBtnText}>Next</Text>
        </TouchableOpacity>

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
    color: T.label3,
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
    backgroundColor: T.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: T.separator,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: T.label,
    lineHeight: 38,
    letterSpacing: -0.6,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label2,
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
    backgroundColor: T.fill,
  },
  dotActive: {
    backgroundColor: ACCENT.accent,
    width: 24,
    borderRadius: 4,
  },

  // CTA
  nextBtn: {
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
