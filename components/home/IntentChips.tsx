// ─────────────────────────────────────────────────────────────────────────
// IntentChips — the "What do you need today?" intent rail (Play Planner v2
// Home). Presentational; state lives in the Home screen.
//
// DESIGN (2026-07-09 visual-review round 2 — USER OVERRIDE of the final
// pp2-home.jsx plain emoji pills): each intent renders as a proper button
// card — a 38×38 rounded-square icon tile tinted in the intent colour, with
// the label + sub-label column beside it — closer to the intent-card
// treatment in screens/01-home-dark.png. The user's on-device feedback was
// that bare emoji pills read as "loose emojis and text, not designed app
// buttons"; that feedback wins over the final jsx here (recorded decision).
//
// Selected state is unmistakable: intent-colour ring + tinted card fill +
// label in the intent colour + brighter tile. A "Clear" card renders INLINE
// at the end of the rail when an intent is active.
//
// IMPLEMENTATION RULE — static style objects ONLY (no style-as-function):
// the installed dev build's NativeWind 4 interop silently drops Pressable
// function styles on device, which is exactly why the previous pills
// rendered as unstyled emoji-over-text stacks. Press feedback comes from
// android_ripple. Not a BlurView glass surface — Android-safe.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Icon } from '@/components/ui/Icon';
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
  /** Clears the active intent — renders the inline Clear card when active. */
  onClear: () => void;
}

export function IntentChips({ active, onToggle, onClear }: IntentChipsProps) {
  const { tokens } = useAppTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingTop: 2, paddingBottom: 4 }}
    >
      {INTENTS.map((intent) => {
        const isActive = active === intent.key;
        return (
          <Pressable
            key={intent.key}
            testID={`intent-chip-${intent.key}`}
            onPress={() => onToggle(intent.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${intent.label}: ${intent.sub}`}
            android_ripple={{ color: tint(intent.color, 0.14), foreground: true }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              paddingVertical: 7,
              paddingLeft: 7,
              paddingRight: 13,
              borderRadius: 15,
              backgroundColor: isActive ? tint(intent.color, 0.14) : tokens.surface,
              borderWidth: isActive ? 1.5 : 1,
              borderColor: isActive ? tint(intent.color, 0.65) : tokens.separator,
              overflow: 'hidden',
            }}
          >
            {/* Icon tile — rounded square in the intent colour, so the emoji
                reads as designed button art rather than loose text. */}
            <View
              testID={`intent-chip-tile-${intent.key}`}
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tint(intent.color, isActive ? 0.32 : 0.16),
              }}
            >
              <Text style={{ fontSize: 17 }} maxFontSizeMultiplier={1.2}>
                {intent.emoji}
              </Text>
            </View>
            <View>
              <Text
                style={{
                  fontFamily: FontFamily.bodyStrong,
                  fontSize: 13.5,
                  color: isActive ? intent.color : tokens.label,
                }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {intent.label}
              </Text>
              <Text
                style={{
                  fontFamily: FontFamily.body,
                  fontSize: 11,
                  color: tokens.label3,
                  marginTop: 1,
                }}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {intent.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {active != null && (
        <Pressable
          testID="intent-clear"
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          android_ripple={{ color: 'rgba(255,255,255,0.10)', foreground: true }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 16,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: tokens.separator,
            overflow: 'hidden',
          }}
        >
          <Icon name="close" size={11} color={tokens.label3} strokeWidth={2.5} />
          <Text
            style={{ fontFamily: FontFamily.body, fontSize: 13, color: tokens.label3 }}
            maxFontSizeMultiplier={1.2}
          >
            Clear
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
