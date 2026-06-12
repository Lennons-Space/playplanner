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
import type { WeatherTheme } from '@/lib/weatherTheme';

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
  /**
   * Optional WeatherTheme. On a dark/"glass" theme (rain/night on Home) the
   * chips become frosted glass with light labels so they belong to the weather
   * environment; the bright emoji icon boxes are kept (they pop on the dark sky
   * and let a parent read the mood instantly). Omitted / light theme → the
   * original solid white paper chips.
   */
  theme?: WeatherTheme;
}

export function QuickPicks({ onPick, theme }: QuickPicksProps) {
  const glass = theme?.card.style === 'glass';
  const chipBg = glass ? theme!.card.background : Colors.surface;
  const chipBorder = glass ? theme!.card.border : Colors.separator;
  const labelColor = glass ? theme!.text.primary : Colors.label;
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
            backgroundColor: chipBg,
            borderRadius: BorderRadius.chip,
            borderWidth: 1,
            borderColor: chipBorder,
            paddingVertical: 10,
            paddingHorizontal: 12,
            opacity: pressed ? 0.7 : 1,
            // Solid chips lift off the paper bg with a tight shadow. Glass chips
            // use a softer, more diffuse drop and no Android elevation.
            shadowColor: glass ? '#000000' : Colors.label,
            shadowOffset: { width: 0, height: glass ? 6 : 1 },
            shadowOpacity: glass ? 0.16 : 0.06,
            shadowRadius: glass ? 12 : 3,
            elevation: glass ? 0 : 2,
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
              color: labelColor,
            }}
          >
            {p.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
