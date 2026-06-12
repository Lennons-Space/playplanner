// Clear night — dusky cool wash with tiny softly-twinkling stars and a warm
// moon glow. Very slow movement. Relaxing bedtime.

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

function Star({ node, animate, w, h, c }: { node: SeededNode; animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const t = useLoop(animate, 3000 + node.r * 4000, node.delay, true);
  const size = 1.5 + node.r * 2.5;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.5, 1], [0.2, 0.85, 0.2]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.85, 1.1]) }],
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: node.x * w,
          top: node.y * h * 0.85,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.particle,
        },
        style,
      ]}
    />
  );
}

function MoonGlow({ animate, w, h, c }: { animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const t = useLoop(animate, 14000, 0, true);
  const size = w * 0.7;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.5, 1], [0.65, 0.85, 0.65]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 1.05]) }],
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          right: -size * 0.2,
          top: h * 0.04,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.tintA,
        },
        style,
      ]}
    />
  );
}

export function NightBackground({ animate, palette }: { animate: boolean; palette?: WeatherPalette }) {
  const { width: w, height: h } = useWindowDimensions();
  const c = palette ?? ATMOSPHERE.night;
  const stars = useMemo(() => seededNodes(18, 606), []);
  return (
    <WeatherLayer atmosphere="night" palette={palette}>
      <AnimatedView style={StyleSheet.absoluteFill}>
        <MoonGlow animate={animate} w={w} h={h} c={c} />
        {stars.map((n, i) => (
          <Star key={`n${i}`} node={n} animate={animate} w={w} h={h} c={c} />
        ))}
      </AnimatedView>
    </WeatherLayer>
  );
}
