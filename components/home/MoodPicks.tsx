// ─────────────────────────────────────────────────────────────────
// MoodPicks — compact, horizontally-scrollable "kids' mood" selector for the
// Home discovery bubble. Smaller and tighter than QuickPicks: a soft pastel
// icon tile + short label, single-select (tap toggles via the parent).
//
// Presentational only — selection state is owned by the Home screen (see
// app/(tabs)/index.tsx). Tapping calls onSelect(id); the parent toggles. No
// network request, no query, no recommendation-ranking change (see lib/moods).
// ─────────────────────────────────────────────────────────────────

import { ScrollView, Pressable, Text, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { MOODS, type MoodId } from '@/lib/moods';

export interface MoodPicksProps {
  /** Currently selected mood, or null when none is selected. */
  selected: MoodId | null;
  /** Called with the tapped mood id. The parent decides select vs deselect. */
  onSelect: (id: MoodId) => void;
  /** Horizontal inset for the scroll content (matches the section bubble pad). */
  contentPaddingHorizontal?: number;
}

export function MoodPicks({ selected, onSelect, contentPaddingHorizontal = 20 }: MoodPicksProps) {
  const { tokens, accent } = useAppTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: contentPaddingHorizontal,
        gap: 14,
        alignItems: 'flex-start',
      }}
      style={{ flexGrow: 0 }}
      accessibilityRole="toolbar"
      accessibilityLabel="Kids' mood options"
    >
      {MOODS.map((m) => {
        const on = selected === m.id;
        return (
          <Pressable
            key={m.id}
            onPress={() => onSelect(m.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${m.label}${on ? ', selected' : ''}`}
            style={({ pressed }) => ({ width: 92, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}
          >
            {/* Soft pastel icon tile */}
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: m.tile,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: on ? 2 : 1,
                borderColor: on ? accent.accent : 'rgba(255,255,255,0.6)',
              }}
            >
              <Text style={{ fontSize: 26 }}>{m.emoji}</Text>
            </View>
            <Text
              numberOfLines={1}
              style={{
                marginTop: 12,
                fontSize: 12.5,
                textAlign: 'center',
                fontFamily: on ? FontFamily.bodyStrong : FontFamily.body,
                color: on ? accent.accent : tokens.label2,
              }}
            >
              {m.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
