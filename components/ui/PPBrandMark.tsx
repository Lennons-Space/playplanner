// ─────────────────────────────────────────────────────────────────────────
// PPBrandMark — the PlayPlanner compact brand mark (Home header, top-right).
//
// 2026-08-13: reverted to the compact map-only PP3 icon (not the full PP2
// lockup — that stays Welcome-only). Renders PP3-transparent.png, an
// alpha-repaired derivative of the canonical assets/design/PP3.png (the
// artwork itself is untouched, only a real alpha channel was added, so no
// checkerboard/box shows behind it). This component previously rendered the
// full PP2 lockup for a brief pass; that history is why the source/props
// look revised rather than original.
//
// Sizing is a fixed numeric width/height pair directly on the Image (never
// a percentage width + style-level aspectRatio) — that combination is what
// made the Welcome hero briefly render its logo huge/cropped on Android;
// numeric width/height sidesteps that bug class entirely.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, type GestureResponderEvent } from 'react-native';

export interface PPBrandMarkProps {
  /** Square size in logical pixels. Default 50 — a small, subtle compact
   *  mark (not the wide PP2 lockup). Also clears the 48dp minimum touch
   *  target on its own, with hitSlop as extra headroom on top. */
  size?: number;
  /** Optional press handler — when provided, the mark becomes a button. */
  onPress?: (e: GestureResponderEvent) => void;
  /** Accessibility label for the pressable mark. */
  accessibilityLabel?: string;
}

export function PPBrandMark({ size = 50, onPress, accessibilityLabel }: PPBrandMarkProps) {
  const content = (
    <Image
      source={require('../../assets/design/PP3-transparent.png')}
      resizeMode="contain"
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
    />
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Open profile'}
      // No function style: NativeWind 4 interop drops style-as-function props
      // on device. Feedback is intentionally omitted (mark is a small nav
      // affordance; ripple would bleed past the artwork bounds).
      hitSlop={6}
    >
      {content}
    </Pressable>
  );
}
