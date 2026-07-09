// ─────────────────────────────────────────────────────────────────────────
// AgeChips — the "Who's coming?" age-group selector (Play Planner v2 Home).
// Presentational; state lives in the Home screen.
//
// Spec (README "Age filter chips"): 3 pills (Toddlers 👶 / 4–8 yrs 🧒 /
// 9–12 yrs 🧑). Active: accent fill + white text + soft accent shadow.
// Inactive: surface bg + 1px separator.
//
// 2026-07-08 Android correction pass: the "Clear" control moved OUT of this
// row and into the "Who's coming?" section-label row (see Home's SectionLabel
// `trailing` prop) — with Clear inline, the four-item row wrapped on narrow
// Android widths and the orphaned Clear pill on its own line read as broken.
// Three compact pills always fit one line at ≥360dp; flexWrap stays on purely
// as a font-scaling safety net.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { FontFamily, BorderRadius } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { AGE_GROUPS, type AgeKey } from '@/lib/homeIntents';

export interface AgeChipsProps {
  active: AgeKey | null;
  onToggle: (key: AgeKey) => void;
}

export function AgeChips({ active, onToggle }: AgeChipsProps) {
  const { tokens, accent } = useAppTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 }}>
      {AGE_GROUPS.map((age) => {
        const isActive = active === age.key;
        return (
          <Pressable
            key={age.key}
            onPress={() => onToggle(age.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={age.label}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: BorderRadius.pill,
              backgroundColor: isActive ? accent.accent : tokens.surface,
              borderWidth: isActive ? 0 : 1,
              borderColor: tokens.separator,
              opacity: pressed ? 0.92 : 1,
              ...(isActive
                ? {
                    shadowColor: accent.accent,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.5,
                    shadowRadius: 12,
                    elevation: 4,
                  }
                : null),
            })}
          >
            <Text style={{ fontSize: 13 }}>{age.emoji}</Text>
            <Text
              style={{
                fontFamily: FontFamily.bodyStrong,
                fontSize: 13.5,
                color: isActive ? '#FFFFFF' : tokens.label,
              }}
            >
              {age.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
