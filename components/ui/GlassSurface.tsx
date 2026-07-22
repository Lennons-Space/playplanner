// ─────────────────────────────────────────────────────────────────────────
// GlassSurface — the shared "dark glass" primitive for Play Planner v2.
//
// CRASH FIX (2026-07-08): this used to wrap expo-blur's BlurView. The
// Android dev build installed on-device was compiled BEFORE expo-blur was
// added to the app, so its native binary has no ExpoBlurView view manager.
// The very first BlurView mount (the tab bar, on Home load) threw a Fabric
// `IllegalViewOperationException` and crashed the app before any screen
// could render. That's a missing-native-module problem, not a rendering
// bug, so it can't be fixed in JS alone without a full native rebuild —
// which we're deliberately avoiding to keep iterating on the existing
// build. BlurView has been removed from this component entirely; it now
// renders a plain translucent tinted View (same rgba(14,14,20,0.82) spec
// colour) with a subtle hairline border added so it still reads as "glass"
// depth without any native blur. Real blur can come back later, but only
// via a native rebuild that bundles expo-blur into the dev client.
//
// `intensity` and `tint` are kept as accepted (but now inert) props purely
// so every existing call site keeps compiling unchanged — only `tintColor`
// and the new hairline border actually affect what's drawn.
//
// Performance note: this is a single plain View composite (no blur cost),
// used for the tab bar (one instance) and the Home hero card's pills (one
// instance per screen) — still not intended for repeated list-row badges,
// where VenueCard2's lighter-weight tinted View pattern is used instead.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';

export interface GlassSurfaceProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** No longer used (BlurView removed) — kept so existing call sites still compile. */
  intensity?: number;
  /** No longer used (BlurView removed) — kept so existing call sites still compile. */
  tint?: 'dark' | 'light' | 'default';
  /** Semi-opaque colour used to hit the exact design rgba. Overrides the mode-resolved default when passed. */
  tintColor?: string;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

// Mode-aware fill + hairline border. Dark values are UNCHANGED from before
// this Phase A pass (byte-identical literals) — only the light branch is new.
const FILL: Record<'dark' | 'light', string> = {
  dark: 'rgba(14,14,20,0.82)',
  light: 'rgba(255,255,255,0.72)',
};
const HAIRLINE: Record<'dark' | 'light', string> = {
  dark: 'rgba(255,255,255,0.08)',
  light: 'rgba(20,18,28,0.08)',
};

export function GlassSurface({
  children,
  style,
  tintColor,
  pointerEvents,
}: GlassSurfaceProps) {
  const { mode } = useAppTheme();
  const resolvedTint = tintColor ?? FILL[mode];
  const hairlineColor = HAIRLINE[mode];
  return (
    <View style={[styles.clip, style]} pointerEvents={pointerEvents}>
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.hairline,
          { backgroundColor: resolvedTint, borderColor: hairlineColor },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  hairline: {
    borderWidth: 1,
  },
});
