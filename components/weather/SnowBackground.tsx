// Snow — warm grey wash with small, soft snow particles drifting very slowly
// with a gentle horizontal sway. Peaceful winter morning, no Christmas styling.

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

function Flake({ node, animate, w, h, c }: { node: SeededNode; animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const fallT = useLoop(animate, 11000 + node.r * 9000, node.delay, false);
  const swayT = useLoop(animate, 4000 + node.r * 3000, node.delay, true);
  const size = 4 + node.r * 5;
  const fall = h * 0.6;
  const startTop = node.y * h - fall / 2;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(fallT.value, [0, 1], [0, fall]) },
      { translateX: interpolate(swayT.value, [0, 1], [-10, 10]) },
    ],
    opacity: interpolate(fallT.value, [0, 0.1, 0.9, 1], [0, 0.9, 0.9, 0]),
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: node.x * w,
          top: startTop,
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

export function SnowBackground({ animate, palette }: { animate: boolean; palette?: WeatherPalette }) {
  const { width: w, height: h } = useWindowDimensions();
  const c = palette ?? ATMOSPHERE.snow;
  const flakes = useMemo(() => seededNodes(14, 505, 8000), []);
  return (
    <WeatherLayer atmosphere="snow" palette={palette}>
      <AnimatedView style={StyleSheet.absoluteFill}>
        {flakes.map((n, i) => (
          <Flake key={`s${i}`} node={n} animate={animate} w={w} h={h} c={c} />
        ))}
      </AnimatedView>
    </WeatherLayer>
  );
}
