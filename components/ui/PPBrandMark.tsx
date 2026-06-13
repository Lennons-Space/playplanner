// ─────────────────────────────────────────────────────────────────────────
// PPBrandMark — the isometric "cube tower" app-icon mark, ported from the
// design handoff (`pp2-home.jsx` IsoCube/PPBrandMark + README "App Icon Mark").
//
// Geometry and colours are FINAL/SPECIFIED — do not redesign:
//   • squircle radius = size × 0.224
//   • background gradient ~160deg: #4C8DF6 → #1E5FD6 (54%) → #143E9E
//   • gloss: soft white highlight near the top, fading out
//   • inset border: 1px rgba(255,255,255,0.18)
//   • drop shadow: 0 [size*0.1]px [size*0.22]px -[size*0.05]px rgba(14,40,120,0.55)
//   • two isometric cubes (SVG polygons), each with top/left/right faces at
//     #FFFFFF / rgba(255,255,255,0.50) / rgba(255,255,255,0.74)
//
// `expo-blur` is not installed and is not needed here — the gloss is emulated
// with a second LinearGradient (white → transparent), not a blur effect.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon } from 'react-native-svg';

export interface PPBrandMarkProps {
  /** Square size in logical pixels. Default 42 (Home header). */
  size?: number;
  /** Optional press handler — when provided, the mark becomes a button. */
  onPress?: (e: GestureResponderEvent) => void;
  /** Accessibility label for the pressable mark. */
  accessibilityLabel?: string;
}

// ── Isometric cube geometry (viewBox 0 0 100 100) ───────────────────────────
// Ported verbatim from pp2-home.jsx IsoCube. Two stacked cubes:
//   bottom cube: cx=50, topY=40, r=18, h=16
//   top cube:    cx=50, topY=24, r=18, h=16
function cubePoints(cx: number, topY: number, r: number, h: number) {
  const Tt = [cx, topY];
  const Tr = [cx + r, topY + r / 2];
  const Tb = [cx, topY + r];
  const Tl = [cx - r, topY + r / 2];
  const Lb = [cx - r, topY + r / 2 + h];
  const Bb = [cx, topY + r + h];
  const Rb = [cx + r, topY + r / 2 + h];

  const top = [Tt, Tr, Tb, Tl];
  const left = [Tl, Tb, Bb, Lb];
  const right = [Tr, Tb, Bb, Rb];

  const toPoints = (pts: number[][]) => pts.map((p) => p.join(',')).join(' ');
  return {
    top: toPoints(top),
    left: toPoints(left),
    right: toPoints(right),
  };
}

function IsoCube({ cx, topY, r, h }: { cx: number; topY: number; r: number; h: number }) {
  const { top, left, right } = cubePoints(cx, topY, r, h);
  return (
    <>
      <Polygon points={top} fill="#FFFFFF" />
      <Polygon points={left} fill="rgba(255,255,255,0.50)" />
      <Polygon points={right} fill="rgba(255,255,255,0.74)" />
    </>
  );
}

export function PPBrandMark({ size = 42, onPress, accessibilityLabel }: PPBrandMarkProps) {
  const radius = size * 0.224;

  const content = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        position: 'relative',
        // App icon mark shadow — README spec:
        // 0 [size*0.1]px [size*0.22]px -[size*0.05]px rgba(14,40,120,0.55)
        shadowColor: 'rgba(14,40,120,0.55)',
        shadowOffset: { width: 0, height: size * 0.1 },
        shadowOpacity: 1,
        shadowRadius: size * 0.22,
        elevation: 6,
      }}
    >
      {/* Base gradient — approximates linear-gradient(160deg, #4C8DF6 0%, #1E5FD6 54%, #143E9E 100%) */}
      <LinearGradient
        colors={['#4C8DF6', '#1E5FD6', '#143E9E']}
        locations={[0, 0.54, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* Gloss overlay — approximates radial-gradient(115% 78% at 50% -12%, rgba(255,255,255,0.28), transparent 52%) */}
      <LinearGradient
        colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.65 }}
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* Inset border — inset 0 0 0 1px rgba(255,255,255,0.18) */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
        }}
      />
      {/* Isometric cube tower */}
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }}>
        <IsoCube cx={50} topY={40} r={18} h={16} />
        <IsoCube cx={50} topY={24} r={18} h={16} />
      </Svg>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Open profile'}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {content}
    </Pressable>
  );
}
