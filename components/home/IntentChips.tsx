// ─────────────────────────────────────────────────────────────────────────
// IntentChips — the "What do you need today?" horizontal intent selector
// (Play Planner v2 Home). Presentational; state lives in the Home screen.
//
// Spec (README "Intent chips"): horizontal scroll, ~166px min-width chips,
// 18px radius, a 42×42 emoji box (13px radius) + label (14.5/700) + sub
// (12/label3). Inactive: surface bg + 1px separator. Active: intent-colour
// tint bg + 1.5px intent-colour border, label in the intent colour.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Colors, FontFamily } from '@/constants/theme';
import { INTENTS, type IntentKey } from '@/lib/homeIntents';

// hex → rgba with alpha (intent colours are 6-digit hex).
function tint(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export interface IntentChipsProps {
  active: IntentKey | null;
  onToggle: (key: IntentKey) => void;
}

export function IntentChips({ active, onToggle }: IntentChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingVertical: 2 }}
    >
      {INTENTS.map((intent) => {
        const isActive = active === intent.key;
        return (
          <Pressable
            key={intent.key}
            onPress={() => onToggle(intent.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${intent.label}: ${intent.sub}`}
            style={({ pressed }) => ({
              minWidth: 166,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 18,
              backgroundColor: isActive ? tint(intent.color, 0.15) : Colors.surface,
              borderWidth: isActive ? 1.5 : 1,
              borderColor: isActive ? tint(intent.color, 0.55) : Colors.separator,
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tint(intent.color, 0.18),
              }}
            >
              <Text style={{ fontSize: 20 }}>{intent.emoji}</Text>
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text
                style={{
                  fontFamily: FontFamily.caption,
                  fontSize: 14.5,
                  color: isActive ? intent.color : Colors.label,
                }}
                numberOfLines={1}
              >
                {intent.label}
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: Colors.label3 }} numberOfLines={1}>
                {intent.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
