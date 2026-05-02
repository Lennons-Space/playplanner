/**
 * Onboarding screen 3 — "Your privacy matters"
 *
 * Satisfies GDPR Art.13 transparency: users see our data practices before any
 * personal data is collected (account creation happens on the next screen).
 *
 * Navigation: Back → /(auth)/onboarding-2 | Get Started → /(auth)/welcome
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Icon, IconName } from '@/components/ui';
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

// Plain-English privacy promises — shown before sign-up (GDPR Art.13)
const PRIVACY_POINTS: { icon: IconName; text: string }[] = [
  { icon: 'shield', text: 'Your data is never sold to third parties' },
  { icon: 'pin',    text: 'Location is opt-in and never stored without consent' },
  { icon: 'check',  text: 'GDPR-compliant — delete your account and all data at any time' },
  { icon: 'user',   text: 'Your profile is private by default' },
];

export default function Onboarding3() {
  return (
    <SafeAreaView style={styles.root}>

      {/* Top row: back only — no skip on the last screen */}
      <View style={styles.topRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back to previous onboarding screen"
        >
          <Icon name="chevL" size={24} color="#1D2630" />
        </TouchableOpacity>
      </View>

      {/* Hero illustration */}
      <View style={styles.heroArea} accessible={false} importantForAccessibility="no-hide-descendants">
        <View style={styles.heroCard}>
          <Icon name="shield" size={48} color="#1B8A85" />
        </View>
      </View>

      {/* Copy + privacy bullet list */}
      <View style={styles.copyArea}>
        <Text style={styles.headline}>{"Your privacy\nmatters"}</Text>
        <Text style={styles.subtitle}>
          PlayPlanner is built privacy-first. Here is what that means for you:
        </Text>

        <View style={styles.bulletList}>
          {PRIVACY_POINTS.map((point) => (
            <View key={point.icon} style={styles.bulletRow}>
              <View style={styles.bulletIconWrap}>
                <Icon name={point.icon} size={20} color="#1B8A85" />
              </View>
              <Text style={styles.bulletText}>{point.text}</Text>
            </View>
          ))}
        </View>
      </View>

      <Dots active={2} />

      {/* Back + Get Started */}
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
          style={styles.getStartedBtn}
          onPress={async () => { await markOnboardingSeen(); router.replace('/(auth)/welcome'); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Get started with PlayPlanner"
        >
          <Text style={styles.getStartedText}>Get Started</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FBF6EC',
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  topRow: {
    paddingTop: 12,
    paddingBottom: 4,
  },

  // Hero card
  heroArea: {
    flex: 1,
    maxHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  heroCard: {
    width: 200,
    height: 200,
    backgroundColor: '#DCF4E4',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Copy
  copyArea: {
    marginBottom: 32,
  },
  headline: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 30,
    color: '#1D2630',
    lineHeight: 38,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Nunito-Regular',
    fontSize: 15,
    color: '#4A5560',
    lineHeight: 22,
    marginBottom: 20,
  },

  // Privacy bullet list
  bulletList: {
    gap: 14,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  // Wrapper keeps icon vertically aligned with first line of text
  bulletIconWrap: {
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontFamily: 'Nunito-Regular',
    fontSize: 15,
    color: '#1D2630',
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
    backgroundColor: '#E6E2DB',
  },
  dotActive: {
    backgroundColor: '#2FB8B0',
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
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E6E2DB',
    backgroundColor: 'transparent',
  },
  backBtnText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 16,
    color: '#1D2630',
  },
  getStartedBtn: {
    flex: 2,
    backgroundColor: '#2FB8B0',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  getStartedText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
