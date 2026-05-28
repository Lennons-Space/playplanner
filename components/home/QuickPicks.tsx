// ─────────────────────────────────────────────────────────────────
// QuickPicks — four one-tap shortcuts into the decision flow.
//
// Each pick maps directly to a curation Mood. They exist to remove the
// "where do I even start" moment: a parent who already knows the vibe
// (rainy day / needs to run / wants calm / watching the budget) skips
// straight to a shortlist. Capped at four — more would reintroduce the
// decision fatigue we are trying to remove.
// ─────────────────────────────────────────────────────────────────

import { Pressable, Text, View } from 'react-native';
import type { Mood } from '@/lib/curation';

const C = {
  ink: '#1D2630',
  mute: '#7B8794',
  paper: '#FFFFFF',
  line: '#E6E2DB',
} as const;

interface Pick {
  mood: Mood;
  emoji: string;
  label: string;
  tint: string;
}

// Order matters: most common parent intents first.
const PICKS: Pick[] = [
  { mood: 'indoor', emoji: '🌧', label: 'Stay dry',     tint: '#E6EEF5' },
  { mood: 'active', emoji: '🏃', label: 'Burn energy',  tint: '#FFE2DE' },
  { mood: 'calm',   emoji: '☕', label: 'Something calm', tint: '#ECE1FF' },
  { mood: 'free',   emoji: '🆓', label: 'Free today',   tint: '#DCF4E4' },
];

export interface QuickPicksProps {
  onPick: (mood: Mood) => void;
}

export function QuickPicks({ onPick }: QuickPicksProps) {
  return (
    <View style={{ paddingHorizontal: 20 }}>
      <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 15, color: C.ink, marginBottom: 10 }}>
        Quick picks
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {PICKS.map((p) => (
          <Pressable
            key={p.mood}
            onPress={() => onPick(p.mood)}
            accessibilityRole="button"
            accessibilityLabel={p.label}
            style={({ pressed }) => ({
              // Two per row: (100% - one gap) / 2
              flexBasis: '47.5%',
              flexGrow: 1,
              backgroundColor: C.paper,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: C.line,
              paddingVertical: 14,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: p.tint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
            </View>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: C.ink, flexShrink: 1 }}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
