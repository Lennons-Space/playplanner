/**
 * Onboarding screen 2 — "Honest reviews from parents like you"
 *
 * Navigation: Back → /(auth)/onboarding-1 | Skip → /(auth)/welcome | Next → /(auth)/onboarding-3
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Icon } from '@/components/ui';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { ONBOARDING_KEY } from '.';

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

export default function Onboarding2() {
  return (
    <SafeAreaView style={styles.root}>

      {/* Top row: back + skip */}
      <View style={styles.topRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back to previous onboarding screen"
        >
          <Icon name="chevL" size={24} color={Colors.label} />
        </TouchableOpacity>

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
          {/* Three stars suggesting a review rating */}
          <View style={styles.starsRow}>
            <Icon name="star" size={28} color="#F5A524" />
            <Icon name="star" size={28} color="#F5A524" />
            <Icon name="star" size={28} color="#F5A524" />
          </View>
          {/* Pill shapes suggesting review UI items */}
          <View style={styles.reviewPillsRow}>
            <View style={styles.reviewPill} />
            <View style={styles.reviewPill} />
          </View>
        </View>
      </View>

      {/* Copy */}
      <View style={styles.copyArea}>
        <Text style={styles.headline}>{"Honest reviews from\nparents like you"}</Text>
        <Text style={styles.subtitle}>
          Every review is written by a real parent. No sponsored posts — just
          genuine experiences to help you plan a great day out.
        </Text>
      </View>

      <Dots active={1} />

      {/* Back + Next */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backBtnText}>Back</Text>
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
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
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
    color: Colors.label3,
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
    backgroundColor: Colors.surface2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: Colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.separator,
  },

  // Copy
  copyArea: {
    marginBottom: 32,
  },
  headline: {
    fontFamily: FontFamily.display,
    fontSize: 30,
    color: Colors.label,
    lineHeight: 38,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: Colors.label2,
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
    backgroundColor: Colors.separator,
  },
  dotActive: {
    backgroundColor: Colors.accent,
    width: 22,
    borderRadius: 4,
  },

  // Buttons
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backBtn: {
    flex: 1,
    borderRadius: BorderRadius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.separator,
    backgroundColor: Colors.surface,
  },
  backBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: Colors.label,
  },
  nextBtn: {
    flex: 2,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: '#FFFFFF',
  },
});
