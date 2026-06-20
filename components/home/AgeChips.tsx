// ─────────────────────────────────────────────────────────────────────────
// AgeChips — the "Who's coming?" age-group selector (Play Planner v2 Home).
// Presentational; state lives in the Home screen.
//
// Spec (README "Age filter chips"): 3 pills (Toddlers 👶 / 4–8 yrs 🧒 /
// 9–12 yrs 🧑), 9px vertical / 16px horizontal padding. Active: accent fill +
// white text + soft accent shadow. Inactive: surface bg + 1px separator. A
// "Clear" pill appears on the far right when any filter (intent or age) is
// active — it clears ALL active Home filters.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { AGE_GROUPS, type AgeKey } from '@/lib/homeIntents';

export interface AgeChipsProps {
  active: AgeKey | null;
  onToggle: (key: AgeKey) => void;
  /** Shown when any Home filter is active; clears intent + age. */
  showClear: boolean;
  onClear: () => void;
}

export function AgeChips({ active, onToggle, showClear, onClear }: AgeChipsProps) {
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
              paddingHorizontal: 16,
              borderRadius: BorderRadius.pill,
              backgroundColor: isActive ? Colors.accent : Colors.surface,
              borderWidth: isActive ? 0 : 1,
              borderColor: Colors.separator,
              opacity: pressed ? 0.92 : 1,
              ...(isActive
                ? {
                    shadowColor: Colors.accent,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.5,
                    shadowRadius: 12,
                    elevation: 4,
                  }
                : null),
            })}
          >
            <Text style={{ fontSize: 14 }}>{age.emoji}</Text>
            <Text
              style={{
                fontFamily: FontFamily.bodyStrong,
                fontSize: 14,
                color: isActive ? '#FFFFFF' : Colors.label,
              }}
            >
              {age.label}
            </Text>
          </Pressable>
        );
      })}

      {showClear && (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          style={({ pressed }) => ({
            marginLeft: 'auto',
            paddingVertical: 9,
            paddingHorizontal: 14,
            borderRadius: BorderRadius.pill,
            backgroundColor: Colors.fill,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: Colors.label2 }}>Clear</Text>
        </Pressable>
      )}
    </View>
  );
}
