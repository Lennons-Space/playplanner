/**
 * Onboarding screen 3 — "Your privacy matters"
 *
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY. Same
 * preservation rule as onboarding-1/2.tsx — the consent/location messaging,
 * navigation targets, and accessibility labels are byte-identical to the
 * pre-restyle version; only styling changed.
 *
 * Satisfies GDPR Art.13 transparency: users see our data practices before any
 * personal data is collected (account creation happens on the next screen).
 *
 * Navigation: Back → /(auth)/onboarding-2 | Get Started → /(auth)/welcome
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { Icon, IconName } from '@/components/ui';
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

// Plain-English privacy promises — shown before sign-up (GDPR Art.13)
const PRIVACY_POINTS: { icon: IconName; text: string }[] = [
  { icon: 'shield', text: 'Your data is never sold to third parties' },
  { icon: 'pin',    text: 'Location is opt-in and never stored without consent' },
  { icon: 'check',  text: 'GDPR-compliant — delete your account and all data at any time' },
  { icon: 'user',   text: 'Your profile is private by default' },
];

export default function Onboarding3() {
  const { tokens: T, mode } = useAppTheme();
  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe}>

        {/* Top row: back only — no skip on the last screen */}
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Go back to previous onboarding screen"
          >
            <Icon name="chevL" size={24} color={T.label} />
          </TouchableOpacity>
        </View>

        {/* Hero illustration */}
        <View style={styles.heroArea} accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={[styles.heroCard, { backgroundColor: T.surface, borderColor: T.separator }]}>
            <Icon name="shield" size={48} color={ACCENT.accent} />
          </View>
        </View>

        {/* Copy + privacy bullet list */}
        <View style={styles.copyArea}>
          <Text style={[styles.headline, { color: T.label }]}>{"Your privacy\nmatters"}</Text>
          <Text style={[styles.subtitle, { color: T.label2 }]}>
            PlayPlanner is built privacy-first. Here is what that means for you:
          </Text>

          <View style={styles.bulletList}>
            {PRIVACY_POINTS.map((point) => (
              <View key={point.icon} style={styles.bulletRow}>
                <View style={styles.bulletIconWrap}>
                  <Icon name={point.icon} size={20} color={ACCENT.accent} />
                </View>
                <Text style={[styles.bulletText, { color: T.label }]}>{point.text}</Text>
              </View>
            ))}
          </View>
        </View>

        <Dots active={2} />

        {/* Back + Get Started */}
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

          <GlassButton
            onPress={async () => { await markOnboardingSeen(); router.replace('/(auth)/welcome'); }}
            accessibilityLabel="Get started with PlayPlanner"
            label="Get Started"
            style={styles.getStartedBtnLayout}
          />
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
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  // Phase 3 (glass button system): "Get Started" is now a <GlassButton/>;
  // only layout survives here ("Back" stays a plain TouchableOpacity — see
  // the same note in onboarding-2.tsx).
  getStartedBtnLayout: {
    flex: 2,
    borderRadius: 16,
    paddingVertical: 16,
  },
});
