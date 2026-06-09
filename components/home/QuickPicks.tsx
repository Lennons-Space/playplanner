// ─────────────────────────────────────────────────────────────────
// QuickPicks — horizontal scrollable intent chip row.
//
// Each chip has a coloured emoji icon box on the left and a label to the
// right. Six chips map to six parent intents / curation Moods. The row
// scrolls horizontally so it never wraps or truncates.
//
// Design reference: Reference Board.png — "Home — Light" intent chips.
// Chip colours match Colors.intent* tokens (constants/theme.ts).
// ─────────────────────────────────────────────────────────────────

import { ScrollView, Pressable, Text, View } from 'react-native';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import type { Mood } from '@/lib/curation';

interface Pick {
  mood: Mood;
  emoji: string;
  label: string;
  /** Background tint for the emoji icon box. */
  iconBg: string;
}

// Order matches the reference design board left-to-right.
// Animal Fix → 'outdoor' (farms, zoos, petting zoos are outdoor venues).
// Toddler Time & Parent Friendly → 'calm' (relaxed pace, low-pressure venues).
const PICKS: Pick[] = [
  { mood: 'indoor',   emoji: '🌧', label: 'Rainy Day',       iconBg: Colors.intentRain    },
  { mood: 'active',   emoji: '🏃', label: 'Burn Energy',     iconBg: Colors.intentEnergy  },
  { mood: 'free',     emoji: '🆓', label: 'Free Day Out',    iconBg: Colors.intentFree    },
  { mood: 'outdoor',  emoji: '🦁', label: 'Animal Fix',      iconBg: Colors.intentAnimals },
  { mood: 'calm',     emoji: '🧸', label: 'Toddler Time',    iconBg: Colors.intentToddler },
  { mood: 'calm',     emoji: '☕', label: 'Parent Friendly', iconBg: Colors.intentParent  },
];

export interface QuickPicksProps {
  onPick: (mood: Mood) => void;
}

export function QuickPicks({ onPick }: QuickPicksProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 20,
        gap: 10,
        alignItems: 'center',
      }}
      style={{ flexGrow: 0 }}
      accessibilityRole="toolbar"
      accessibilityLabel="Intent chips"
    >
      {PICKS.map((p) => (
        <Pressable
          key={p.label}
          onPress={() => onPick(p.mood)}
          accessibilityRole="button"
          accessibilityLabel={`${p.label} intent`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            backgroundColor: Colors.surface,
            borderRadius: BorderRadius.chip,
            borderWidth: 1,
            borderColor: Colors.separator,
            paddingVertical: 10,
            paddingHorizontal: 12,
            opacity: pressed ? 0.7 : 1,
            // Subtle shadow so chips lift off the bg
            shadowColor: Colors.label,
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.06,
            shadowRadius: 3,
            elevation: 2,
          })}
        >
          {/* Coloured emoji icon box */}
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: BorderRadius.intentChipIcon,
              backgroundColor: p.iconBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 17 }}>{p.emoji}</Text>
          </View>

          {/* Label */}
          <Text
            style={{
              fontFamily: FontFamily.bodyStrong,
              fontSize: 14,
              color: Colors.label,
            }}
          >
            {p.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
