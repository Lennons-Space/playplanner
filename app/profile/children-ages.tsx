/**
 * Children's Ages screen — app/profile/children-ages.tsx
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
 *
 * Visual: v2 dark editorial — colours/typography via the shared Colors +
 * FontFamily tokens (layout kept as NativeWind utility classes). Logic unchanged.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useUpdateChildrenAges } from '@/hooks/useProfile';
import { Colors, FontFamily } from '@/constants/theme';

/**
 * Age ranges to display as selectable chips.
 * These match the ranges specified in the product brief and stored in the DB.
 * Broad ranges only — exact ages are never collected (data minimisation).
 */
const AGE_RANGES = ['0–1', '2–3', '4–5', '6–8', '9–12', '13+'] as const;
type AgeRange = (typeof AGE_RANGES)[number];

export default function ChildrenAgesScreen() {
  const user    = useUser();
  const profile = useProfile();
  const { mutateAsync, isPending } = useUpdateChildrenAges();

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
    <>
      <Stack.Screen options={{ title: "Children's Ages" }} />
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.bg }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>

          {/* Privacy notice — shown before the controls (ICO Children's Code Std. 4) */}
          <View
            className="rounded-xl px-4 py-4 mb-5 flex-row gap-3"
            style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.separator }}
          >
            <Text className="text-lg">🔒</Text>
            <View className="flex-1">
              <Text className="text-sm mb-1" style={{ fontFamily: FontFamily.bodyStrong, color: Colors.label }}>
                Only you can see this
              </Text>
              <Text className="text-xs" style={{ fontFamily: FontFamily.body, color: Colors.label3, lineHeight: 18 }}>
                We use broad age ranges to suggest venues that suit your family.
                We never collect exact dates of birth and this information is
                never visible to other users.
              </Text>
            </View>
          </View>

          {/* Heading */}
          <Text className="text-base mb-1" style={{ fontFamily: FontFamily.bodyStrong, color: Colors.label }}>
            Select your children's age ranges
          </Text>
          <Text className="text-sm mb-4" style={{ fontFamily: FontFamily.body, color: Colors.label3 }}>
            Tap all that apply. You can update this any time.
          </Text>

          {/* Age range chips */}
          <View className="flex-row flex-wrap gap-3">
            {AGE_RANGES.map((range) => {
              const isSelected = selected.includes(range);
              return (
                <TouchableOpacity
                  key={range}
                  className="px-5 py-3 rounded-full border-2"
                  style={{
                    backgroundColor: isSelected ? Colors.accent : Colors.surface,
                    borderColor: isSelected ? Colors.accent : Colors.separator,
                  }}
                  onPress={() => toggleRange(range)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`Age range ${range} years`}
                >
                  <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 15, color: isSelected ? '#FFFFFF' : Colors.label }}>
                    {range} yrs
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* "None" / clear option */}
          {selected.length > 0 && (
            <TouchableOpacity
              className="mt-4 self-start"
              onPress={() => setSelected([])}
              accessibilityRole="button"
              accessibilityLabel="Clear all age range selections"
            >
              <Text className="text-sm underline" style={{ fontFamily: FontFamily.body, color: Colors.label3 }}>
                Clear selection
              </Text>
            </TouchableOpacity>
          )}

        </ScrollView>

        {/* Save button — sticky at the bottom of the screen */}
        <View
          className="absolute bottom-0 left-0 right-0 px-4 pb-8 pt-3"
          style={{ backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.separator }}
        >
          <TouchableOpacity
            className="rounded-2xl items-center justify-center"
            style={{ height: 56, backgroundColor: Colors.accent }}
            onPress={handleSave}
            disabled={isPending}
            accessibilityRole="button"
            accessibilityLabel="Save age range selections"
          >
            {isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-lg" style={{ fontFamily: FontFamily.bodyStrong, color: '#FFFFFF' }}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </>
  );
}
