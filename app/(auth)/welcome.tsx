/**
 * Welcome screen — first screen after onboarding (or for returning users).
 *
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY. Both
 * CTAs' destinations, the legal footer semantics, and accessibility labels
 * are byte-identical to the pre-restyle version — only styling changed.
 *
 * Step 10A Part 2 (dual-theme foundation, proof set): mounts
 * <ThemedBackground/> instead of a direct <V2Background/> — the dark path is
 * byte-identical (ThemedBackground selects the same V2Background component
 * unchanged), and tokens now come from useAppTheme() so this screen also
 * renders correctly in light mode (see components/ui/ThemedBackground.tsx
 * for why the light surface is a temporary placeholder, not final).
 *
 * ICO Children's Code + UK GDPR:
 *  - No location requested here. Location is opt-in, prompted only when needed.
 *  - No data collected on this screen.
 *  - Privacy strip shown before account creation (GDPR Art.13 transparency).
 *  - Both CTAs are equal weight — no dark patterns (ICO Standard 7).
 *  - Terms and Privacy Policy linked before sign-up.
 */

import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '@/components/ui';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { GlassButton } from '@/components/ui/GlassButton';
import { FontFamily, type ThemeTokens, type AccentPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

export default function WelcomeScreen() {
  const { tokens: T, accent: ACCENT, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T, ACCENT), [T, ACCENT]);

  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {/* ── Hero card ────────────────────────────────────────────────── */}
          <GlassSurface style={styles.heroCard} tintColor="rgba(18,18,26,0.86)">
            <LinearGradient
              colors={['rgba(76,141,246,0.22)', 'rgba(124,79,204,0.14)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroHalo}
              pointerEvents="none"
            />

            <View
              style={styles.heroIllustration}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            >
              {/* Leaf map pin */}
              <View style={styles.pinLeafOuter}>
                <View style={styles.pinLeafInner}>
                  <Icon name="leaf" size={22} color="#FFFFFF" />
                </View>
              </View>
              {/* Sparkle map pin */}
              <View style={styles.pinAccentOuter}>
                <View style={styles.pinAccentInner}>
                  <Icon name="sparkle" size={22} color="#FFFFFF" />
                </View>
              </View>
            </View>

            <View style={styles.heroTextWrap}>
              <Text style={styles.eyebrow}>Play Planner</Text>
              <Text style={styles.headline}>{"Family days out,\nsorted by parents."}</Text>
              <Text style={styles.subtitle}>
                Find soft plays, parks and cafés nearby — with honest reviews from real families.
              </Text>
            </View>
          </GlassSurface>

          {/* ── Privacy strip (ICO Standard 10: location off by default) ─── */}
          <GlassSurface style={styles.privacyStrip} tintColor="rgba(14,14,20,0.5)">
            <Icon name="shield" size={18} color={ACCENT.accent} />
            <Text style={styles.privacyText}>
              Location is{' '}
              <Text style={styles.privacyBold}>off by default</Text>
              {'. We never sell your data.'}
            </Text>
          </GlassSurface>

          {/* ── CTAs ─────────────────────────────────────────────────────── */}
          {/* Both buttons are equal-prominence — no nudge technique (ICO Standard 7) */}
          <View style={styles.ctaBlock}>
            <GlassButton
              onPress={() => router.push('/(auth)/register')}
              accessibilityLabel="Create a free account"
              label="Create free account"
              style={styles.primaryBtnLayout}
            />

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

          {/* ── Legal footer — passive notice only, NOT pre-ticked consent ── */}
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

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function createStyles(T: ThemeTokens, ACCENT: AccentPalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    safe: { flex: 1, backgroundColor: 'transparent' },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 24,
    },

    // ── Hero ────────────────────────────────────────────────────────────────
    heroCard: {
      borderRadius: 28,
      padding: 22,
      minHeight: 260,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    heroHalo: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 180,
    },
    heroIllustration: {
      position: 'absolute',
      top: 24,
      left: 0,
      right: 0,
      height: 120,
    },
    // Teardrop shape: three rounded corners + one sharp corner, rotated -45deg
    pinLeafOuter: {
      position: 'absolute',
      top: 8,
      left: 36,
      width: 52,
      height: 64,
      borderTopLeftRadius: 34,
      borderTopRightRadius: 34,
      borderBottomLeftRadius: 34,
      borderBottomRightRadius: 0,
      backgroundColor: '#3AA36A',
      transform: [{ rotate: '-45deg' }],
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Counter-rotate icon so it stays upright inside the pin
    pinLeafInner: {
      transform: [{ rotate: '45deg' }],
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pinAccentOuter: {
      position: 'absolute',
      top: 24,
      right: 44,
      width: 52,
      height: 64,
      borderTopLeftRadius: 34,
      borderTopRightRadius: 34,
      borderBottomLeftRadius: 34,
      borderBottomRightRadius: 0,
      backgroundColor: ACCENT.accent,
      transform: [{ rotate: '-45deg' }],
      alignItems: 'center',
      justifyContent: 'center',
    },
    pinAccentInner: {
      transform: [{ rotate: '45deg' }],
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTextWrap: {
      marginTop: 100,
    },
    eyebrow: {
      fontFamily: FontFamily.caption,
      fontSize: 12,
      letterSpacing: 1.5,
      color: ACCENT.tagText,
      textTransform: 'uppercase',
    },
    headline: {
      fontFamily: FontFamily.display,
      fontSize: 28,
      color: T.label,
      lineHeight: 34,
      letterSpacing: -0.6,
      marginTop: 8,
    },
    subtitle: {
      fontFamily: FontFamily.body,
      fontSize: 14.5,
      color: T.label2,
      lineHeight: 21,
      marginTop: 10,
    },

    // ── Privacy strip ──────────────────────────────────────────────────────
    privacyStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 16,
      gap: 10,
    },
    privacyText: {
      flex: 1,
      fontFamily: FontFamily.body,
      fontSize: 13,
      color: T.label2,
      lineHeight: 18,
    },
    privacyBold: {
      fontFamily: FontFamily.bodyStrong,
      color: T.label,
    },

    // ── CTAs ────────────────────────────────────────────────────────────────
    ctaBlock: {
      marginTop: 20,
      gap: 12,
    },
    // Phase 3 (glass button system): "Create free account" is now a
    // <GlassButton/> — layout only survives here, colour comes from its own
    // variant/active resolution (never a style override).
    primaryBtnLayout: {
      height: 54,
      borderRadius: 16,
    },
    secondaryBtn: {
      height: 54,
      backgroundColor: T.fill,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: T.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: {
      fontFamily: FontFamily.bodyStrong,
      fontSize: 16,
      color: T.label,
    },

    // ── Legal ───────────────────────────────────────────────────────────────
    legalBlock: {
      marginTop: 16,
    },
    legalText: {
      fontFamily: FontFamily.body,
      fontSize: 11.5,
      color: T.label3,
      textAlign: 'center',
      lineHeight: 17,
    },
    legalLink: {
      fontFamily: FontFamily.bodyStrong,
      textDecorationLine: 'underline',
      color: T.label2,
    },
  });
}
