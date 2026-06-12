// Sunny — warm cream wash, a few slow-drifting golden light blobs, and a
// scatter of almost-imperceptible floating dust motes. Calm, optimistic.

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

function LightBlob({ node, animate, w, h, c }: { node: SeededNode; animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const t = useLoop(animate, 16000 + node.r * 10000, node.delay, true);
  const size = 240 + node.r * 180;
  const drift = 14 + node.r * 10;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [-drift, drift]) },
      { translateY: interpolate(t.value, [0, 1], [drift, -drift]) },
      { scale: interpolate(t.value, [0, 1], [1, 1.08]) },
    ],
    opacity: interpolate(t.value, [0, 1], [0.75, 1]),
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: node.x * w - size / 2,
          top: node.y * h * 0.7 - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: node.r > 0.5 ? c.tintA : c.tintB,
        },
        style,
      ]}
    />
  );
}

function Dust({ node, animate, w, h, c }: { node: SeededNode; animate: boolean; w: number; h: number; c: WeatherPalette }) {
  const t = useLoop(animate, 9000 + node.r * 7000, node.delay, true);
  const size = 3 + node.r * 3;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(t.value, [0, 1], [6, -6]) },
      { translateX: interpolate(t.value, [0, 1], [-3, 3]) },
    ],
    opacity: interpolate(t.value, [0, 0.5, 1], [0.15, 0.6, 0.15]),
  }));
  return (
    <AnimatedView
      style={[
        {
          position: 'absolute',
          left: node.x * w,
          top: node.y * h,
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

export function SunnyBackground({ animate, palette }: { animate: boolean; palette?: WeatherPalette }) {
  const { width: w, height: h } = useWindowDimensions();
  const c = palette ?? ATMOSPHERE.sunny;
  const blobs = useMemo(() => seededNodes(3, 101), []);
  const dust = useMemo(() => seededNodes(8, 202), []);
  return (
    <WeatherLayer atmosphere="sunny" palette={palette}>
      <AnimatedView style={StyleSheet.absoluteFill}>
        {blobs.map((n, i) => (
          <LightBlob key={`b${i}`} node={n} animate={animate} w={w} h={h} c={c} />
        ))}
        {dust.map((n, i) => (
          <Dust key={`d${i}`} node={n} animate={animate} w={w} h={h} c={c} />
        ))}
      </AnimatedView>
    </WeatherLayer>
  );
}
