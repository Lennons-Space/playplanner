// Cloudy — warm grey/cream wash with large, soft, slow-moving translucent
// cloud shapes. No sharp edges. Quiet and relaxing.

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

function Cloud({ node, animate, w, h, c }: { node: SeededNode; animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const t = useLoop(animate, 22000 + node.r * 14000, node.delay, true);
  const width = 280 + node.r * 220;
  const height = width * 0.42;
  const drift = 20 + node.r * 16;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [-drift, drift]) },
      { translateY: interpolate(t.value, [0, 1], [-4, 4]) },
    ],
    opacity: interpolate(t.value, [0, 0.5, 1], [0.7, 0.95, 0.7]),
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: node.x * w - width / 2,
          top: node.y * h * 0.75,
          width,
          height,
          borderRadius: height / 2,
          backgroundColor: node.r > 0.5 ? c.tintA : c.tintB,
        },
        style,
      ]}
    />
  );
}

export function CloudyBackground({ animate, palette }: { animate: boolean; palette?: WeatherPalette }) {
  const { width: w, height: h } = useWindowDimensions();
  const c = palette ?? ATMOSPHERE.cloudy;
  const clouds = useMemo(() => seededNodes(4, 303), []);
  return (
    <WeatherLayer atmosphere="cloudy" palette={palette}>
      <AnimatedView style={StyleSheet.absoluteFill}>
        {clouds.map((n, i) => (
          <Cloud key={`c${i}`} node={n} animate={animate} w={w} h={h} c={c} />
        ))}
      </AnimatedView>
    </WeatherLayer>
  );
}
