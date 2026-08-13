/**
 * Appearance settings screen (2026-08-13, automatic day/night theme).
 *
 * SUPERSEDED the old System/Light/Dark picker: PlayPlanner's appearance is
 * now a fixed, non-configurable rule — light 07:00–18:59, dark 19:00–06:59,
 * always local device time (lib/timeAppearance.ts, store/appearanceStore.ts,
 * consumed everywhere via hooks/useAppTheme.ts). There is nothing left for
 * the user to choose, so this screen no longer renders a picker or writes to
 * store/themeStore.ts (that store's persisted value is now inert — kept only
 * for AsyncStorage data compatibility, see its own file header). This screen
 * exists purely to explain the automatic behaviour so a returning user who
 * remembers the old System/Light/Dark options isn't confused by their
 * absence.
 *
 * Builds its own small header instead of mounting the shared <V2Header/>
 * (which is intentionally left hard-coded dark this phase — see the scoping
 * note in app/profile/notifications.tsx).
 */
import { useMemo } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { FontFamily, type ThemeTokens, type AccentPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

export default function AppearanceScreen() {
  const { tokens: T, accent: ACCENT, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T, ACCENT), [T, ACCENT]);

  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* ── Header ────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="chevL" size={20} color={T.label} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            Appearance
          </Text>
          <View style={styles.trailing} />
        </View>

        <View style={styles.body}>
          <Text style={styles.explainer}>
            PlayPlanner automatically switches between light and dark to match the time of day —
            no setup needed.
          </Text>

          <GlassSurface style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.iconBox}>
                <Icon name="clock" size={18} color={ACCENT.accent} />
              </View>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardTitle}>Automatic</Text>
                <Text style={styles.cardDescription}>
                  Light during the day, dark at night — based on your device&apos;s clock.
                </Text>
              </View>
            </View>
          </GlassSurface>

          <Text style={styles.footnote}>
            Light: 7am – 7pm{'  ·  '}Dark: 7pm – 7am
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

function createStyles(T: ThemeTokens, ACCENT: AccentPalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    safe: { flex: 1, backgroundColor: 'transparent' },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      gap: 12,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: T.fill,
      borderWidth: 1,
      borderColor: T.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      fontFamily: FontFamily.display,
      fontSize: 19,
      color: T.label,
      letterSpacing: -0.3,
    },
    trailing: {
      minWidth: 40,
    },

    body: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    explainer: {
      fontFamily: FontFamily.body,
      fontSize: 13,
      color: T.label3,
      lineHeight: 19,
      marginBottom: 16,
      paddingHorizontal: 4,
    },

    card: {
      borderRadius: 18,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 16,
      gap: 12,
    },
    iconBox: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: ACCENT.light,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTextWrap: {
      flex: 1,
    },
    cardTitle: {
      fontFamily: FontFamily.heading,
      fontSize: 15,
      color: T.label,
    },
    cardDescription: {
      fontFamily: FontFamily.body,
      fontSize: 12,
      color: T.label3,
      marginTop: 2,
      lineHeight: 17,
    },

    footnote: {
      fontFamily: FontFamily.body,
      fontSize: 12,
      color: T.label4,
      marginTop: 14,
      textAlign: 'center',
    },
  });
}
