/**
 * Welcome screen — first screen after onboarding (or for returning users).
 *
 * ICO Children's Code + UK GDPR:
 *  - No location requested here. Location is opt-in, prompted only when needed.
 *  - No data collected on this screen.
 *  - Privacy strip shown before account creation (GDPR Art.13 transparency).
 *  - Both CTAs are equal weight — no dark patterns (ICO Standard 7).
 *  - Terms and Privacy Policy linked before sign-up.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '@/components/ui';

// ─── Design tokens (pp- system) ─────────────────────────────────────────────
const C = {
  ink: '#1D2630',
  inkSoft: '#4A5560',
  line: '#E6E2DB',
  sand: '#FBF6EC',
  sky: '#2FB8B0',
  skyDeep: '#1B8A85',
  skySoft: '#D4F0EE',
  skyWash: '#EEF9F8',
  coral: '#FF6B6B',
  sun: '#FFD66B',
  leaf: '#5BC08A',
  leafSoft: '#DCF4E4',
} as const;

export default function WelcomeScreen() {

  // ── TODO: Google OAuth via Supabase ──────────────────────────────────────
  // When OAuth is ready, uncomment and wire up this handler + button below.
  //
  // import { supabase } from '@/lib/supabase';
  // async function handleGoogleSignIn() {
  //   const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  //   if (error) console.error('Google sign-in error:', error.message);
  // }
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root}>

      {/* ── Hero card ──────────────────────────────────────────────────────── */}
      <View style={styles.heroWrapper} accessible={false} importantForAccessibility="no-hide-descendants">
        <LinearGradient
          colors={['#D4F0EE', '#FFD66B44', '#FFE8E8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          {/* Clouds */}
          <View style={[styles.cloud, { width: 90, height: 28, top: 28, left: 20 }]} />
          <View style={[styles.cloud, { width: 60, height: 30, top: 18, left: 80 }]} />
          <View style={[styles.cloud, { width: 70, height: 22, top: 38, right: 30 }]} />

          {/* Sun with glow ring */}
          <View style={styles.sunGlow} accessible={false}>
            <View style={styles.sun} />
          </View>

          {/* Leaf map pin (bottom-left) */}
          <View style={styles.pinLeafOuter}>
            <View style={styles.pinLeafInner}>
              <Icon name="leaf" size={24} color="#fff" />
            </View>
          </View>

          {/* Coral map pin (bottom-right) */}
          <View style={styles.pinCoralOuter}>
            <View style={styles.pinCoralInner}>
              <Icon name="sparkle" size={24} color="#fff" />
            </View>
          </View>

          {/* Ground strip */}
          <LinearGradient
            colors={['#DCF4E4', '#5BC08A55']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.ground}
          />
        </LinearGradient>
      </View>

      {/* ── Copy block ────────────────────────────────────────────────────── */}
      <View style={styles.copyBlock}>
        <Text style={styles.eyebrow}>Play Planner</Text>
        <Text style={styles.headline}>{"Family days out,\nsorted by parents."}</Text>
        <Text style={styles.subtitle}>
          Find soft plays, parks and cafés nearby — with honest reviews from real families.
        </Text>
      </View>

      {/* ── Privacy strip (ICO Standard 10: location off by default) ─────── */}
      <View style={styles.privacyStrip}>
        <Icon name="shield" size={18} color={C.skyDeep} />
        <Text style={styles.privacyText}>
          Location is{' '}
          <Text style={styles.privacyBold}>off by default</Text>
          {'. We never sell your data.'}
        </Text>
      </View>

      {/* ── CTAs ──────────────────────────────────────────────────────────── */}
      {/* Both buttons are equal-prominence — no nudge technique (ICO Standard 7) */}
      <View style={styles.ctaBlock}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push('/(auth)/register')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Create a free account"
        >
          <Text style={styles.primaryBtnText}>Create free account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.push('/(auth)/login')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Sign in to your existing account"
        >
          <Text style={styles.secondaryBtnText}>Sign in</Text>
        </TouchableOpacity>
      </View>

      {/* ── Legal footer — passive notice only, NOT pre-ticked consent ───── */}
      <View style={styles.legalBlock}>
        <Text style={styles.legalText}>
          {'By continuing you agree to our '}
          <Text
            style={styles.legalLink}
            onPress={() => router.push('/(auth)/terms')}
            accessibilityRole="link"
            accessibilityLabel="Read Terms of Service"
          >
            Terms of Service
          </Text>
          {' and '}
          <Text
            style={styles.legalLink}
            onPress={() => router.push('/(auth)/privacy')}
            accessibilityRole="link"
            accessibilityLabel="Read Privacy Policy"
          >
            Privacy Policy
          </Text>
          {'.'}
        </Text>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FBF6EC',
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroWrapper: {
    flex: 1,
    minHeight: 140,
    paddingHorizontal: 20,
    paddingTop: 16,
    // flex:1 lets the hero expand to fill available space above the copy
  },
  heroCard: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E6E2DB',
    overflow: 'hidden',
  },
  cloud: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    opacity: 0.9,
  },
  sunGlow: {
    position: 'absolute',
    top: 18,
    right: 22,
    width: 66,
    height: 66,
    borderRadius: 999,
    backgroundColor: '#FFD66B33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sun: {
    width: 46,
    height: 46,
    borderRadius: 999,
    backgroundColor: '#FFD66B',
  },
  // Teardrop shape: three rounded corners + one sharp corner, rotated -45deg
  pinLeafOuter: {
    position: 'absolute',
    bottom: 44,
    left: 40,
    width: 56,
    height: 68,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 0,
    backgroundColor: '#5BC08A',
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Counter-rotate icon so it stays upright inside the pin
  pinLeafInner: {
    transform: [{ rotate: '45deg' }],
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinCoralOuter: {
    position: 'absolute',
    bottom: 44,
    right: 52,
    width: 56,
    height: 68,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 0,
    backgroundColor: '#FF6B6B',
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinCoralInner: {
    transform: [{ rotate: '45deg' }],
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 32,
  },

  // ── Copy ──────────────────────────────────────────────────────────────────
  copyBlock: {
    paddingHorizontal: 28,
    paddingTop: 20,
    gap: 6,
  },
  eyebrow: {
    fontFamily: 'Nunito-Bold',
    fontSize: 12,
    letterSpacing: 1.5,
    color: '#1B8A85',
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 32,
    color: '#1D2630',
    lineHeight: 38,
    letterSpacing: -0.5,
    marginTop: 8,
  },
  subtitle: {
    fontFamily: 'Nunito-Medium',
    fontSize: 15,
    color: '#4A5560',
    lineHeight: 22,
    marginTop: 10,
  },

  // ── Privacy strip ─────────────────────────────────────────────────────────
  privacyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF9F8',
    borderWidth: 1,
    borderColor: '#D4F0EE',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 24,
    marginTop: 24,
    marginBottom: 14,
    gap: 10,
  },
  privacyText: {
    flex: 1,
    fontFamily: 'Nunito-Medium',
    fontSize: 12,
    color: '#4A5560',
    lineHeight: 18,
  },
  privacyBold: {
    fontFamily: 'Nunito-Bold',
    color: '#4A5560',
  },

  // ── CTAs ──────────────────────────────────────────────────────────────────
  ctaBlock: {
    paddingHorizontal: 24,
    paddingBottom: 34,
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#1D2630',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#E6E2DB',
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 16,
    color: '#1D2630',
  },

  // ── Legal ─────────────────────────────────────────────────────────────────
  legalBlock: {
    paddingHorizontal: 24,
    marginTop: 8,
    marginBottom: 4,
  },
  legalText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 11,
    color: '#7B8794',
    textAlign: 'center',
    lineHeight: 16,
  },
  legalLink: {
    fontFamily: 'Nunito-Bold',
    textDecorationLine: 'underline',
    color: '#4A5560',
  },
});
