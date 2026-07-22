/**
 * Appearance settings screen — System / Light / Dark theme preference.
 *
 * Step 10A Part 2 (dual-theme foundation): reads + writes
 * store/themeStore.ts's `preference` directly. Changing it updates the whole
 * app immediately via useAppTheme() (plain Zustand reactivity — no reload,
 * no navigation round-trip needed). Works fully signed-out too: the theme
 * store has no auth dependency at all (see store/themeStore.ts), and this
 * screen itself never reads or gates on a user.
 *
 * Builds its own small header instead of mounting the shared <V2Header/>
 * (which is intentionally left hard-coded dark this phase — see the scoping
 * note in app/profile/notifications.tsx). Because this is a brand-new
 * screen, it can be theme-correct in both modes from the start with no
 * shared-component conflict to work around.
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
import { useThemeStore, type ThemePreference } from '@/store/themeStore';

interface AppearanceOption {
  value: ThemePreference;
  label: string;
  description: string;
}

const OPTIONS: AppearanceOption[] = [
  { value: 'system', label: 'System', description: "Match your device's setting" },
  { value: 'light', label: 'Light', description: 'Always use light mode' },
  { value: 'dark', label: 'Dark', description: 'Always use dark mode' },
];

export default function AppearanceScreen() {
  const { tokens: T, accent: ACCENT, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T, ACCENT), [T, ACCENT]);
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

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
            Choose how PlayPlanner looks. &quot;System&quot; follows your device&apos;s own
            light/dark setting automatically.
          </Text>

          <GlassSurface style={styles.optionGroup} tintColor="rgba(14,14,20,0.55)">
            {OPTIONS.map((option, index) => {
              const selected = preference === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionRow,
                    index < OPTIONS.length - 1 ? styles.optionRowBorder : styles.optionRowLast,
                  ]}
                  onPress={() => setPreference(option.value)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected, checked: selected }}
                >
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                  {selected && (
                    <View style={styles.checkBox}>
                      <Icon name="check" size={16} color={ACCENT.accent} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </GlassSurface>
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

    optionGroup: {
      borderRadius: 18,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    optionRowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: T.separator,
    },
    optionRowLast: {
      borderBottomWidth: 0,
    },
    optionTextWrap: {
      flex: 1,
    },
    optionLabel: {
      fontFamily: FontFamily.heading,
      fontSize: 15,
      color: T.label,
    },
    optionDescription: {
      fontFamily: FontFamily.body,
      fontSize: 12,
      color: T.label3,
      marginTop: 2,
    },
    checkBox: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: ACCENT.light,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
