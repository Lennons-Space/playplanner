// ─────────────────────────────────────────────────────────────────────────
// V2WeatherMotion — the "alive" layer of the v2 Home background.
//
// A deliberately SMALL set of ambient, condition-specific motion elements
// rendered between V2Background's static gradients and the screen content:
//   sunny  → pulsing warm glow + a few bokeh orbs floating upward
//   cloudy → slow drifting mist bands
//   rain   → thin falling streaks in a slightly rotated field
//   snow   → slow falling flakes with a gentle sway
//   night  → twinkling stars
//
// This is NOT the full WEATHER_BACKGROUNDS.md particle system (68 streaks /
// 52 gusts / leaves) — that spec remains P2. This layer exists to make the
// background feel alive at minimal cost.
//
// Android safety / performance:
//   • ≤14 animated nodes per condition, transform/opacity ONLY (no layout
//     animation, no blur, no BlurView — the dev build lacks the native
//     module and would crash).
//   • Built on the proven toolbox in components/weather/WeatherLayer:
//     useLoop (UI-thread repeat driver), seededNodes (deterministic layout —
//     no Math.random at render, stable in tests), useReducedMotionPref +
//     useAppActive (motion fully stops when the OS reduce-motion setting is
//     on or the app is backgrounded — the static gradients remain as the
//     fallback).
//   • pointerEvents="none", hidden from the accessibility tree.
//
// Privacy: purely decorative; reads no data at all — the atmosphere is
// passed in by V2Background, which uses the same coarse non-personal
// weather fetch Home already makes.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import {
  seededNodes,
  useAppActive,
  useLoop,
  useReducedMotionPref,
  type SeededNode,
} from '@/components/weather/WeatherLayer';
import type { Atmosphere } from '@/lib/weatherTheme';

// ── Single animated node primitives ────────────────────────────────────────

/** Sunny: soft amber orb drifting upward while fading in/out. */
function BokehOrb({ node, animate, screenH }: { node: SeededNode; animate: boolean; screenH: number }) {
  const t = useLoop(animate, 12000 + node.r * 8000, node.delay, false);
  const size = 10 + node.r * 16;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 0.75, 1], [0, 0.5, 0.5, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -0.4 * screenH]) },
      { scale: interpolate(t.value, [0, 1], [0.9, 1.1]) },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: `${8 + node.x * 84}%`,
          top: `${58 + node.y * 34}%`,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(255,195,107,0.16)',
        },
        style,
      ]}
    />
  );
}

/** Sunny: the top glow breathing gently (scale + opacity pulse). */
function SunPulse({ animate }: { animate: boolean }) {
  const t = useLoop(animate, 9000);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.55, 1]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 1.09]) }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: '-28%',
          left: '-10%',
          right: '-10%',
          height: '52%',
          borderRadius: 999,
          backgroundColor: 'rgba(255,178,62,0.10)',
        },
        style,
      ]}
    />
  );
}

/** Rain: one thin streak falling through a rotated field. */
function RainStreak({ node, animate, screenH }: { node: SeededNode; animate: boolean; screenH: number }) {
  const t = useLoop(animate, 620 + node.r * 420, node.delay % 900, false);
  const h = 80 + node.r * 90;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(t.value, [0, 1], [-h - 40, screenH + 40]) }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: `${node.x * 100}%`,
          top: 0,
          width: 1 + node.r,
          height: h,
          borderRadius: 1,
          backgroundColor: `rgba(150,186,216,${0.14 + node.r * 0.14})`,
        },
        style,
      ]}
    />
  );
}

/** Cloudy/fog: a wide soft band drifting slowly sideways. */
function MistBand({ node, animate, screenW }: { node: SeededNode; animate: boolean; screenW: number }) {
  const t = useLoop(animate, 18000 + node.r * 10000, node.delay);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-0.1 * screenW, 0.1 * screenW]) }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: '-20%',
          width: '140%',
          top: `${6 + node.y * 50}%`,
          height: 80 + node.r * 70,
          borderRadius: 999,
          backgroundColor: `rgba(96,104,124,${0.05 + node.r * 0.05})`,
        },
        style,
      ]}
    />
  );
}

/** Night: a tiny star twinkling. */
function Star({ node, animate }: { node: SeededNode; animate: boolean }) {
  const t = useLoop(animate, 1800 + node.r * 2600, node.delay);
  const size = 1.5 + node.r * 1.8;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.15, 0.85]),
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: `${2 + node.x * 96}%`,
          top: `${2 + node.y * 52}%`,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#E8ECF8',
        },
        style,
      ]}
    />
  );
}

/** Snow: a flake falling slowly with a gentle sideways sway. */
function Snowflake({ node, animate, screenH }: { node: SeededNode; animate: boolean; screenH: number }) {
  const t = useLoop(animate, 9000 + node.r * 7000, node.delay, false);
  const size = 3 + node.r * 3;
  const sway = 14 + node.r * 18;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.08, 0.9, 1], [0, 0.75, 0.65, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [-30, screenH + 30]) },
      { translateX: interpolate(t.value, [0, 0.25, 0.5, 0.75, 1], [0, sway, 0, -sway, 0]) },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: `${node.x * 98}%`,
          top: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(235,242,252,0.9)',
        },
        style,
      ]}
    />
  );
}

// Deterministic node sets (seeded — stable across renders and in tests).
const BOKEH = seededNodes(6, 20260709, 6000);
const STREAKS = seededNodes(14, 1101, 900);
const MIST = seededNodes(3, 7, 4000);
const STARS = seededNodes(12, 42, 3000);
const FLAKES = seededNodes(12, 88, 8000);

export interface V2WeatherMotionProps {
  atmosphere: Atmosphere;
}

/**
 * Ambient motion for the v2 Home background. Renders nothing but its
 * absolute-fill container when reduced motion is on or the app is
 * backgrounded — the static V2Background gradients are the fallback look.
 */
export function V2WeatherMotion({ atmosphere }: V2WeatherMotionProps) {
  const reduced = useReducedMotionPref();
  const appActive = useAppActive();
  const animate = appActive && !reduced;
  const { width: screenW, height: screenH } = useWindowDimensions();

  if (!animate) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`v2-weather-motion-${atmosphere}`}
    >
      {atmosphere === 'sunny' && (
        <>
          <SunPulse animate={animate} />
          {BOKEH.map((n, i) => (
            <BokehOrb key={i} node={n} animate={animate} screenH={screenH} />
          ))}
        </>
      )}

      {atmosphere === 'rain' && (
        // Slight 11° tilt so streaks read as wind-blown rain (per the
        // handoff spec's rain container), applied to the field not the nodes.
        <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: '11deg' }] }]}>
          {STREAKS.map((n, i) => (
            <RainStreak key={i} node={n} animate={animate} screenH={screenH} />
          ))}
        </View>
      )}

      {atmosphere === 'cloudy' &&
        MIST.map((n, i) => <MistBand key={i} node={n} animate={animate} screenW={screenW} />)}

      {atmosphere === 'night' && STARS.map((n, i) => <Star key={i} node={n} animate={animate} />)}

      {atmosphere === 'snow' &&
        FLAKES.map((n, i) => <Snowflake key={i} node={n} animate={animate} screenH={screenH} />)}
    </View>
  );
}
