/**
 * V2Background — the Home (Browse) screen's atmosphere layer.
 *
 * Matches the Claude Design v2 handoff (WEATHER_BACKGROUNDS.md + pp2-home.jsx
 * `WeatherBackground.baseBg`, dark branch, + screens/01-home-dark.png ground
 * truth): a dark vertical base gradient, a soft weather-coloured glow at the
 * top, and an always-on Ocean-blue vignette low in the frame.
 *
 * Static gradient + glow layers, plus a LIGHTWEIGHT ambient motion layer
 * (V2WeatherMotion — ≤14 transform/opacity-only nodes per condition: sun
 * pulse/bokeh, rain streaks, mist drift, star twinkle, snowfall). The
 * handoff's FULL particle system (68 streaks/52 gusts/leaves) remains P2.
 * Motion fully stops (static fallback) under OS reduce-motion or when the
 * app is backgrounded.
 *
 * Condition → atmosphere uses the SAME pure mapping (`resolveAtmosphere`,
 * lib/weatherTheme.ts) already used by the shared `<WeatherBackground/>`, so
 * "night" (time-of-day, not a weather condition on its own) resolves the same
 * way everywhere in the app instead of being reimplemented here. Weather data
 * itself comes from the SAME coarse, cached, non-personal fetch Home already
 * makes (`useWeather(FALLBACK_LOCATION...)`) — this component never calls
 * useLocation() and can never trigger the OS location prompt.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useWeather } from '@/hooks/useWeather';
import { FALLBACK_LOCATION } from '@/constants/location';
import { resolveAtmosphere, type Atmosphere } from '@/lib/weatherTheme';
import type { WeatherCondition } from '@/lib/weather';
import { V2WeatherMotion } from './V2WeatherMotion';

// ── Radial glow spec ───────────────────────────────────────────────────────
// Approximates a CSS `radial-gradient(<sizeX>% <sizeY>% at <posX>% <posY>%, …)`
// as a single SVG RadialGradient (objectBoundingBox units — cx/cy/r are
// fractions of this layer's own box, so they naturally ellipsify against the
// screen's portrait aspect ratio the same way the CSS percentages did). Exact
// CSS-radial parity isn't required (per the design brief) — this reads as the
// same soft top glow / bottom vignette as the screenshot.
interface RadialGlowSpec {
  id: string;
  cx: `${number}%`;
  cy: `${number}%`;
  r: `${number}%`;
  /** "R,G,B" triplet. */
  rgb: string;
  startOpacity: number;
  /** Offset (0–1) at which the glow reaches fully transparent. */
  endOffset: number;
}

interface AtmosphereBg {
  /** Vertical base gradient, top → bottom. */
  linearColors: readonly [string, string, ...string[]];
  linearLocations: readonly [number, number, ...number[]];
  /** Weather-specific glow(s), rendered under the always-on ocean vignette. */
  glows: readonly RadialGlowSpec[];
}

// Always-on Ocean (#4C8DF6) glow low in the frame — the final/top layer in
// every atmosphere (WEATHER_BACKGROUNDS.md, "All-conditions accent vignette").
const OCEAN_VIGNETTE: RadialGlowSpec = {
  id: 'v2bg-ocean-vignette',
  cx: '50%',
  cy: '120%',
  r: '85%',
  rgb: '76,141,246',
  startOpacity: 0.09,
  endOffset: 0.6,
};

// Dark-mode base gradients + glows per atmosphere, taken from pp2-home.jsx's
// `baseBg` dark branch / WEATHER_BACKGROUNDS.md. tokens.bg (#0C0C11) and
// tokens.warm (#0E0E14) are inlined as literals (matches constants/theme.ts
// Themes.dark) rather than imported, so this stays a pure lookup table.
const ATMOSPHERE_BG: Record<Atmosphere, AtmosphereBg> = {
  sunny: {
    linearColors: ['#16120E', '#0E0E14', '#0C0C11'],
    linearLocations: [0, 0.5, 1],
    glows: [
      { id: 'v2bg-sunny-1', cx: '50%', cy: '-15%', r: '90%', rgb: '255,195,107', startOpacity: 0.19, endOffset: 0.54 },
      { id: 'v2bg-sunny-2', cx: '85%', cy: '9%', r: '65%', rgb: '255,138,91', startOpacity: 0.11, endOffset: 0.5 },
    ],
  },
  cloudy: {
    linearColors: ['#0B0D12', '#111419', '#0C0C11'],
    linearLocations: [0, 0.44, 1],
    glows: [
      { id: 'v2bg-cloudy-1', cx: '74%', cy: '-7%', r: '65%', rgb: '58,50,18', startOpacity: 0.24, endOffset: 0.46 },
    ],
  },
  // Covers rain, drizzle, showers and thunderstorm — all collapse to the
  // 'rain' atmosphere via resolveAtmosphere().
  rain: {
    linearColors: ['#020407', '#06080E', '#090C14', '#0C0C11'],
    linearLocations: [0, 0.44, 0.68, 1],
    glows: [
      { id: 'v2bg-rain-1', cx: '50%', cy: '-22%', r: '110%', rgb: '12,20,36', startOpacity: 0.78, endOffset: 0.54 },
    ],
  },
  night: {
    linearColors: ['#020308', '#060A1C', '#0C0C11'],
    linearLocations: [0, 0.5, 1],
    glows: [
      { id: 'v2bg-night-1', cx: '50%', cy: '-8%', r: '70%', rgb: '2,4,14', startOpacity: 0.96, endOffset: 0.52 },
    ],
  },
  snow: {
    linearColors: ['#040A12', '#091320', '#0C0C11'],
    linearLocations: [0, 0.52, 1],
    glows: [
      { id: 'v2bg-snow-1', cx: '50%', cy: '-9%', r: '75%', rgb: '20,36,58', startOpacity: 0.62, endOffset: 0.52 },
    ],
  },
};

export interface V2BackgroundProps {
  /**
   * Explicit weather condition (skips the internal fetch). Pass `null` to
   * force the unknown/no-data fallback. Omit to fetch the same coarse,
   * cached weather Home already reads.
   */
  condition?: WeatherCondition | null;
}

/**
 * Absolute-fill, non-interactive atmosphere layer for Home. Render as the
 * FIRST child of the screen root, with content on top.
 */
export function V2Background({ condition }: V2BackgroundProps) {
  // SAME coarse, cached, non-personal fetch Home already makes — identical
  // arguments (FALLBACK_LOCATION, never the user's real position) means an
  // identical React Query cache key, so this always reuses Home's fetch
  // rather than firing a second network request, and it never calls
  // useLocation(). Called unconditionally (rules of hooks); the `condition`
  // prop, when supplied, simply overrides the fetched value below.
  const fetched = useWeather(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
  const effective = condition === undefined ? (fetched?.condition ?? null) : condition;

  // Unknown/no-data resolves via the same time-aware fallback used elsewhere
  // in the app (clear sky by day, night after dark) rather than a hard-coded
  // "always sunny" — this is also the only path that ever exercises the
  // 'night' atmosphere below, so it's necessary, not just a nicety.
  const atmosphere = resolveAtmosphere(effective);
  const spec = ATMOSPHERE_BG[atmosphere];

  const glows = useMemo(() => [...spec.glows, OCEAN_VIGNETTE], [spec]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="v2-background"
    >
      <LinearGradient
        colors={spec.linearColors}
        locations={spec.linearLocations}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          {glows.map((g) => (
            <RadialGradient key={g.id} id={g.id} cx={g.cx} cy={g.cy} r={g.r}>
              <Stop offset={0} stopColor={`rgb(${g.rgb})`} stopOpacity={g.startOpacity} />
              <Stop offset={g.endOffset} stopColor={`rgb(${g.rgb})`} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {glows.map((g) => (
          <Rect key={g.id} x={0} y={0} width="100%" height="100%" fill={`url(#${g.id})`} />
        ))}
      </Svg>
      <V2WeatherMotion atmosphere={atmosphere} />
    </View>
  );
}
