// ─────────────────────────────────────────────────────────────────
// QuickPicks — horizontal scrollable intent chip row.
//
// Each chip has a coloured emoji icon box on the left and a label + sub
// text stack on the right. Six chips map to six parent intents / curation
// Moods. The row scrolls horizontally so it never wraps or truncates.
//
// Phase 1 Home reskin (ported from design handoff pp2-home.jsx INTENTS):
//   - chip: minWidth 166, radius 18 (BorderRadius.chip), padding 12/16/12/12,
//     flex row, gap ~11, 1px separator-inset border (inactive only — no
//     local filter state lives here, see app/(tabs)/index.tsx).
//   - icon box: 42x42, radius 13 (BorderRadius.intentChipIcon), bg = intent
//     colour at low opacity.
//   - label: 14.5px/700/display-ish (FontFamily.bodyStrong), sub: 12px/label3.
//
// Theming: chip surface/border/label colours come from useAppTheme() (the
// new additive Themes.dark/Themes.light tokens), NOT from useWeatherTheme —
// see hooks/useAppTheme.ts for why these are kept separate. Sub text always
// uses tokens.label3 (works in both modes by definition).
// ─────────────────────────────────────────────────────────────────

import { ScrollView, Pressable, Text, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { Mood } from '@/lib/curation';

interface Pick {
  mood: Mood;
  emoji: string;
  label: string;
  sub: string;
  /** Intent colour — drives the icon box tint. */
  color: string;
}

// Order matches the design handoff INTENTS array left-to-right.
// Mood mapping preserved from the previous version (Animal Fix → 'outdoor',
// Toddler Time & Parent Friendly → 'calm') — only emoji/label/sub/colour change.
const PICKS: Pick[] = [
  { mood: 'indoor',  emoji: '🌧️', label: 'Rainy Day',       sub: 'Indoor picks',         color: '#5B9BD5' },
  { mood: 'active',  emoji: '⚡',  label: 'Burn Energy',     sub: 'Wear them right out',  color: '#F2A24B' },
  { mood: 'free',    emoji: '🆓',  label: 'Free Day Out',    sub: 'No entry cost',        color: '#5FD08A' },
  { mood: 'outdoor', emoji: '🐑',  label: 'Animal Fix',      sub: 'Farms & wildlife',     color: '#D7B25A' },
  { mood: 'calm',    emoji: '👶',  label: 'Toddler Time',    sub: 'Under-3s welcome',     color: '#E07FA8' },
  { mood: 'calm',    emoji: '☕',  label: 'Parent Friendly', sub: 'Good coffee on-site',  color: '#B08A6A' },
];

export interface QuickPicksProps {
  onPick: (mood: Mood) => void;
  /**
   * Horizontal inset for the scroll content. Defaults to 20 (full-bleed on the
   * page); lowered when the row sits inside a padded section bubble on Home.
   */
  contentPaddingHorizontal?: number;
}

export function QuickPicks({ onPick, contentPaddingHorizontal = 20 }: QuickPicksProps) {
  const { tokens } = useAppTheme();

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
      accessibilityLabel="Intent chips"
    >
      {PICKS.map((p) => (
        // Vertical tile — coloured icon box on top, label + sub centred below
        // (matches the kids' mood tiles). Consistent width + spacing; the
        // section bubble provides the grouping, so chips no longer carry their
        // own card surface.
        <Pressable
          key={p.label}
          onPress={() => onPick(p.mood)}
          accessibilityRole="button"
          accessibilityLabel={`${p.label} intent`}
          style={({ pressed }) => ({
            width: 92,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          {/* Coloured emoji icon box */}
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              backgroundColor: `${p.color}26` /* ~15% opacity */,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 26 }}>{p.emoji}</Text>
          </View>

          {/* Label + sub, centred below the icon */}
          <Text
            style={{
              marginTop: 12,
              fontFamily: FontFamily.bodyStrong,
              fontSize: 13,
              color: tokens.label,
              textAlign: 'center',
              letterSpacing: -0.2,
            }}
            numberOfLines={2}
          >
            {p.label}
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontFamily: FontFamily.body,
              fontSize: 11,
              color: tokens.label3,
              textAlign: 'center',
              lineHeight: 14,
            }}
            numberOfLines={2}
          >
            {p.sub}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
