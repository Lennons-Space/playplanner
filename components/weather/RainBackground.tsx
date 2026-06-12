// Rain — cool, dusky version of the cream palette with subtle vertical rain
// streaks and a faint drifting blur shape. Cozy indoor day. Deliberately NOT
// a thunderstorm: no flashes, no cartoon drops, no heavy effects.

import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import {
  ATMOSPHERE,
  AnimatedView,
  WeatherLayer,
  seededNodes,
  useLoop,
  type SeededNode,
  type WeatherPalette,
} from './WeatherLayer';
import { useAnimatedStyle, interpolate } from 'react-native-reanimated';

function Streak({ node, animate, w, h, c }: { node: SeededNode; animate: boolean; w: number; h: number; c: WeatherPalette }) {
  // Non-reversing loop = continuous fall.
  const t = useLoop(animate, 1400 + node.r * 1100, node.delay, false);
  const len = 26 + node.r * 26;
  const fall = h * 0.5;
  const startTop = node.y * h - fall / 2;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(t.value, [0, 1], [0, fall]) }],
    opacity: interpolate(t.value, [0, 0.15, 0.85, 1], [0, 0.5, 0.5, 0]),
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: node.x * w,
          top: startTop,
          width: 1.5,
          height: len,
          borderRadius: 1,
          backgroundColor: c.particle,
        },
        style,
      ]}
    />
  );
}

function Haze({ animate, w, h, c }: { animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const t = useLoop(animate, 20000, 0, true);
  const size = w * 0.9;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-18, 18]) }],
    opacity: interpolate(t.value, [0, 0.5, 1], [0.5, 0.8, 0.5]),
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: w * 0.05,
          top: h * 0.12,
          width: size,
          height: size * 0.5,
          borderRadius: size / 2,
          backgroundColor: c.tintA,
        },
        style,
      ]}
    />
  );
}

export function RainBackground({ animate, palette }: { animate: boolean; palette?: WeatherPalette }) {
  const { width: w, height: h } = useWindowDimensions();
  const c = palette ?? ATMOSPHERE.rain;
  const streaks = useMemo(() => seededNodes(16, 404, 2000), []);
  return (
    <WeatherLayer atmosphere="rain" palette={palette}>
      <AnimatedView style={StyleSheet.absoluteFill}>
        <Haze animate={animate} w={w} h={h} c={c} />
        {streaks.map((n, i) => (
          <Streak key={`r${i}`} node={n} animate={animate} w={w} h={h} c={c} />
        ))}
      </AnimatedView>
    </WeatherLayer>
  );
}
