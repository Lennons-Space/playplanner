/**
 * Children's Ages screen — app/profile/children-ages.tsx
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. All
 * hooks, mutation calls and storage semantics are byte-identical to the
 * pre-restyle version.
 *
 * Lets the user select which broad age ranges apply to their children so
 * PlayPlanner can surface venues that are suitable for their family.
 *
 * GDPR Art.5(1)(c) — data minimisation:
 *   We store age ranges (e.g. "2–3"), never exact dates of birth.
 *   An empty selection saves null to the database — we never store an empty array.
 *
 * ICO Children's Code Standard 4 (transparency):
 *   The "Only you can see this" label and plain-English explanation appear before
 *   the controls so users understand what they are consenting to share.
 *
 * ICO Children's Code Standard 9 (high privacy by default):
 *   Children's ages are private by design — they are never exposed via the
 *   public_profiles VIEW, only accessible to the account owner.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useUpdateChildrenAges } from '@/hooks/useProfile';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, ocean } from '@/constants/theme';

const ACCENT = ocean;

/**
 * Age ranges to display as selectable chips.
 * These match the ranges specified in the product brief and stored in the DB.
 * Broad ranges only — exact ages are never collected (data minimisation).
 */
const AGE_RANGES = ['0–1', '2–3', '4–5', '6–8', '9–12', '13+'] as const;
type AgeRange = (typeof AGE_RANGES)[number];

export default function ChildrenAgesScreen() {
  const { tokens: T, mode } = useAppTheme();
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  // See app/profile/my-venues.tsx for why the privacy card is lighter than
  // GlassSurface's mode default; the sticky bar stays close to opaque so
  // action buttons never read as translucent over scrolling content.
  const privacyCardTint = mode === 'dark' ? 'rgba(14,14,20,0.55)' : 'rgba(255,255,255,0.55)';
  const stickyBarTint = mode === 'dark' ? 'rgba(12,12,17,0.92)' : 'rgba(255,255,255,0.92)';
  const user    = useUser();
  const profile = useProfile();
  const { mutateAsync, isPending } = useUpdateChildrenAges();
  const insets = useSafeAreaInsets();

  // Initialise selection from the profile stored in Zustand.
  // We cast because the DB stores text[] and we know our values match AgeRange.
  const [selected, setSelected] = useState<string[]>(
    profile?.children_ages ?? [],
  );

  // Auth guard — redirect unauthenticated users to the login screen.
  useEffect(() => {
    if (user === null) {
      router.replace('/(auth)/login');
    }
  }, [user]);

  function toggleRange(range: AgeRange) {
    setSelected((prev) =>
      prev.includes(range)
        ? prev.filter((r) => r !== range)
        : [...prev, range],
    );
  }

  async function handleSave() {
    try {
      await mutateAsync(selected);
      router.back();
    } catch {
      Alert.alert(
        'Could not save',
        'Something went wrong. Please check your connection and try again.',
      );
    }
  }

  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <V2Header title="Children's Ages" />

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 130 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >

          {/* Privacy notice — shown before the controls (ICO Children's Code Std. 4) */}
          <GlassSurface style={styles.privacyCard} tintColor={privacyCardTint}>
            <View style={styles.privacyIconBox}>
              <Icon name="shield" size={18} color={ACCENT.accent} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.privacyTitle, { color: T.label }]}>Only you can see this</Text>
              <Text style={[styles.privacyBody, { color: T.label3 }]}>
                We use broad age ranges to suggest venues that suit your family.
                We never collect exact dates of birth and this information is
                never visible to other users.
              </Text>
            </View>
          </GlassSurface>

          {/* Heading */}
          <Text style={[styles.heading, { color: T.label }]}>Select your children&apos;s age ranges</Text>
          <Text style={[styles.subheading, { color: T.label3 }]}>Tap all that apply. You can update this any time.</Text>

          {/* Age range chips */}
          <View style={styles.chipRow}>
            {AGE_RANGES.map((range) => {
              const isSelected = selected.includes(range);
              return (
                <TouchableOpacity
                  key={range}
                  style={[
                    styles.chip,
                    isSelected
                      ? styles.chipSelected
                      : [styles.chipUnselected, { backgroundColor: T.surface, borderColor: T.separator }],
                  ]}
                  onPress={() => toggleRange(range)}
                  activeOpacity={0.8}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`Age range ${range} years`}
                >
                  <Text style={[styles.chipText, { color: T.label }, isSelected && styles.chipTextSelected]}>
                    {range} yrs
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* "None" / clear option */}
          {selected.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => setSelected([])}
              accessibilityRole="button"
              accessibilityLabel="Clear all age range selections"
            >
              <Text style={[styles.clearText, { color: T.label3 }]}>Clear selection</Text>
            </TouchableOpacity>
          )}

        </ScrollView>

        {/* Save button — sticky, safe-area aware above Android nav */}
        <GlassSurface
          style={[styles.stickyBar, { paddingBottom: insets.bottom + 14 }]}
          tintColor={stickyBarTint}
        >
          <TouchableOpacity
            style={[styles.saveBtn, isPending && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isPending}
            accessibilityRole="button"
            accessibilityLabel="Save age range selections"
            accessibilityState={{ disabled: isPending }}
          >
            {isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </GlassSurface>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
  },

  privacyCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
    padding: 15,
    marginBottom: 20,
  },
  privacyIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: ACCENT.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 14,
    marginBottom: 4,
  },
  privacyBody: {
    fontFamily: FontFamily.body,
    fontSize: 12.5,
    lineHeight: 18,
  },

  heading: {
    fontFamily: FontFamily.heading,
    fontSize: 16,
    marginBottom: 4,
  },
  subheading: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    marginBottom: 16,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  chipSelected: {
    backgroundColor: ACCENT.accent,
    borderColor: ACCENT.accent,
  },
  chipUnselected: {
    // backgroundColor / borderColor: mode-aware, applied inline.
  },
  chipText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    // color: mode-aware base (T.label), applied inline; overridden white when selected.
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },

  clearBtn: {
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  clearText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    textDecorationLine: 'underline',
  },

  // Sticky save bar
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  saveBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: ACCENT.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: '#FFFFFF',
  },
});
