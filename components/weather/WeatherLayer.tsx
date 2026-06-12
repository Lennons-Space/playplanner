// ─────────────────────────────────────────────────────────────────────────
// WeatherLayer — shared infrastructure for the ambient weather backgrounds.
//
// This file is intentionally the "toolbox" the five atmosphere components
// (Sunny/Cloudy/Rain/Snow/Night) build on top of:
//   • ATMOSPHERE       — palette tokens (kept in the warm cream PlayPlanner family)
//   • WeatherLayer     — the absolute-fill, non-interactive container + base wash
//   • useReducedMotionPref / useAppActive — accessibility + battery gating
//   • useLoop          — one repeating UI-thread driver value per animated node
//   • seededOffsets    — deterministic positions (stable across renders + tests)
//
// Design rules honoured here (see brief): effects sit BEHIND content, never
// capture touches, never animate layout, and fully stop when the user prefers
// reduced motion or the app is backgrounded.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Atmosphere, WeatherPalette } from '@/lib/weatherTheme';

export const AnimatedView = Animated.View;

// ── Atmosphere kinds ───────────────────────────────────────────────────────
// Canonical type + condition mapping live in lib/weatherTheme (pure, testable).
// Re-exported here so the many existing `from './WeatherLayer'` imports keep
// working unchanged.
export type { Atmosphere, WeatherPalette } from '@/lib/weatherTheme';

// ── Ambient palette tokens ─────────────────────────────────────────────────
// The DEFAULT (ambient) palette used by Search / Results / Map. Every base
// stays in the cream/sand PlayPlanner family so the near-black chrome text
// (#16151A) keeps contrast on those screens, which do NOT adapt their text.
// Home opts into the cinematic WEATHER_THEMES palette (deep navy rain/night)
// by passing an explicit `palette` override — see WeatherBackground immersive.
export const ATMOSPHERE: Record<Atmosphere, WeatherPalette> = {
  sunny: {
    // Gentle warm top→bottom depth so the restrained (Search/Results/Map)
    // weather wash is perceptible, not a flat single cream. Stays light for
    // the non-adaptive dark chrome on those screens.
    base: ['#FDF8EA', '#FBF0D6', '#F6E5C4'],
    tintA: 'rgba(255, 204, 116, 0.24)',
    tintB: 'rgba(255, 176, 92, 0.12)',
    particle: 'rgba(255, 244, 222, 0.85)',
  },
  cloudy: {
    base: ['#F4F1EA', '#EEEAE0', '#E7E2D6'],
    tintA: 'rgba(255, 255, 255, 0.55)',
    tintB: 'rgba(120, 122, 130, 0.08)',
    particle: 'rgba(255, 255, 255, 0.5)',
  },
  rain: {
    base: ['#E7EAEF', '#DCE1E9', '#D2D9E4'],
    tintA: 'rgba(120, 140, 170, 0.16)',
    tintB: 'rgba(90, 110, 140, 0.10)',
    particle: 'rgba(108, 132, 168, 0.30)',
  },
  snow: {
    base: ['#EEEFF1', '#E7E9EC', '#DEE1E6'],
    tintA: 'rgba(255, 255, 255, 0.6)',
    tintB: 'rgba(150, 160, 175, 0.08)',
    particle: 'rgba(255, 255, 255, 0.92)',
  },
  night: {
    base: ['#DEE2EC', '#D2D8E4', '#C6CDDC'],
    tintA: 'rgba(255, 236, 196, 0.45)', // warm moon glow
    tintB: 'rgba(110, 124, 158, 0.16)',
    particle: 'rgba(255, 255, 255, 0.9)',
  },
};

// ── WeatherLayer container ─────────────────────────────────────────────────
// Absolute-fill, non-interactive, hidden from the a11y tree. Renders the base
// wash gradient; children are the moving shapes for the chosen atmosphere.
export function WeatherLayer({
  atmosphere,
  palette,
  children,
}: {
  atmosphere: Atmosphere;
  /** Optional palette override (immersive mode). Defaults to the ambient set. */
  palette?: WeatherPalette;
  children?: React.ReactNode;
}) {
  const colors = palette ?? ATMOSPHERE[atmosphere];
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <LinearGradient
        colors={colors.base}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

// ── Accessibility: reduced-motion preference ───────────────────────────────
// Built on RN core AccessibilityInfo (well-mocked in jest-expo) rather than
// Reanimated's hook, so it stays robust in tests and decoupled from worklets.
export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (mounted) setReduced(!!v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) =>
      setReduced(!!v),
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

// ── Battery: pause when the app is not foregrounded ────────────────────────
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) =>
      setActive(s === 'active'),
    );
    return () => sub.remove();
  }, []);
  return active;
}

// ── One repeating driver value per animated node ───────────────────────────
// Returns a shared value looping 0→1. When `animate` is false (reduced motion
// or backgrounded) it parks at a sensible resting value and runs nothing.
export function useLoop(
  animate: boolean,
  durationMs: number,
  delayMs = 0,
  reverse = true,
): SharedValue<number> {
  const sv = useSharedValue(reverse ? 0.5 : 0);
  useEffect(() => {
    cancelAnimation(sv);
    if (animate) {
      sv.value = 0;
      sv.value = withDelay(
        delayMs,
        withRepeat(
          withTiming(1, {
            duration: durationMs,
            easing: reverse ? Easing.inOut(Easing.sin) : Easing.linear,
          }),
          -1,
          reverse,
        ),
      );
    } else {
      sv.value = reverse ? 0.5 : 0;
    }
    return () => cancelAnimation(sv);
  }, [animate, durationMs, delayMs, reverse, sv]);
  return sv;
}

// ── Deterministic positions ────────────────────────────────────────────────
// A tiny seeded PRNG (mulberry32) so element layout is stable across renders
// and snapshot-free in tests — never Math.random() at render time.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededNode {
  /** 0–1 fractional horizontal position. */
  x: number;
  /** 0–1 fractional vertical position. */
  y: number;
  /** 0–1 spare value for per-node size/phase variation. */
  r: number;
  /** Per-node animation delay (ms). */
  delay: number;
}

export function seededNodes(count: number, seed: number, maxDelayMs = 6000): SeededNode[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    r: rand(),
    delay: Math.round(rand() * maxDelayMs),
  }));
}
