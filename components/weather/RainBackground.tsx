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
} from './WeatherLayer';
import { useAnimatedStyle, interpolate } from 'react-native-reanimated';

const C = ATMOSPHERE.rain;

function Streak({ node, animate, w, h }: { node: SeededNode; animate: boolean; w: number; h: number }) {
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
          backgroundColor: C.particle,
        },
        style,
      ]}
    />
  );
}

function Haze({ animate, w, h }: { animate: boolean; w: number; h: number }) {
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
          backgroundColor: C.tintA,
        },
        style,
      ]}
    />
  );
}

export function RainBackground({ animate }: { animate: boolean }) {
  const { width: w, height: h } = useWindowDimensions();
  const streaks = useMemo(() => seededNodes(16, 404, 2000), []);
  return (
    <WeatherLayer atmosphere="rain">
      <AnimatedView style={StyleSheet.absoluteFill}>
        <Haze animate={animate} w={w} h={h} />
        {streaks.map((n, i) => (
          <Streak key={`r${i}`} node={n} animate={animate} w={w} h={h} />
        ))}
      </AnimatedView>
    </WeatherLayer>
  );
}
