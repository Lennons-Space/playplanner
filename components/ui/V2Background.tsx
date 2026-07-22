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
 * way everywhere in the app instead of being reimplemented here.
 *
 * Weather + location (2026-07-19 root-cause fix): this component reads THE
 * single shared `useResolvedWeather()` hook (hooks/useResolvedWeather.ts) —
 * the SAME hook Home's weather pill reads, so a badge and a background can
 * never disagree. That hook owns the consent gate: FALLBACK_LOCATION pre-
 * consent/declined (unchanged), the user's ALREADY-CONSENTED coarse location
 * once granted. This component itself never calls the permission-REQUESTING
 * `useLocation()` hook, and mounting it can never trigger the OS location
 * prompt — the shared hook only ever CHECKS an already-granted OS permission
 * and reads a CACHED last-known position, exactly like the accepted
 * hooks/location/useAreaLabel.ts pattern.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useResolvedWeather } from '@/hooks/useResolvedWeather';
import { resolveAtmosphere, type Atmosphere } from '@/lib/weatherTheme';
import type { WeatherCondition } from '@/lib/weather';
import { useAppTheme } from '@/hooks/useAppTheme';
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
// Identical in both modes except `startOpacity` (lighter on the light base so
// it doesn't read as a muddy patch on a bright background) — everything else
// (id, cx, cy, r, rgb, endOffset) is shared, so this stays one lookup keyed
// on mode rather than two near-duplicate objects.
const OCEAN_VIGNETTE_OPACITY: Record<'dark' | 'light', number> = {
  dark: 0.09,
  light: 0.06,
};

function getOceanVignette(mode: 'dark' | 'light'): RadialGlowSpec {
  return {
    id: 'v2bg-ocean-vignette',
    cx: '50%',
    cy: '120%',
    r: '85%',
    rgb: '76,141,246',
    startOpacity: OCEAN_VIGNETTE_OPACITY[mode],
    endOffset: 0.6,
  };
}

// Per-mode base gradients + glows per atmosphere. `dark` is taken verbatim
// from pp2-home.jsx's `baseBg` dark branch / WEATHER_BACKGROUNDS.md — tokens.bg
// (#0C0C11) and tokens.warm (#0E0E14) are inlined as literals (matches
// constants/theme.ts Themes.dark) rather than imported, so this stays a pure
// lookup table. `light` is the equivalent literal set derived from the same
// WEATHER_BACKGROUNDS.md spec's light branch (Phase A of the v2 Light-theme
// correction) — same shape, mode-appropriate colours; `dark` is UNCHANGED
// from before this Phase A pass (byte-identical values, only relocated under
// a `dark` key).
const ATMOSPHERE_BG: Record<'dark' | 'light', Record<Atmosphere, AtmosphereBg>> = {
  dark: {
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
      // FIXED (2026-07-22, shape-repair pass, root cause #1): this glow was
      // `rgb(58,50,18)` — OLIVE (R≈G, essentially zero blue) — at 0.24
      // opacity, roughly DOUBLE V2WeatherMotion's peak alpha for fog/
      // overcast/partly_cloudy (all three share this 'cloudy' atmosphere),
      // rendered directly BEHIND them. On device this read as "a broad grey
      // glow/tint behind the header" for overcast and, mixed with fog's own
      // genuinely blue-neutral tint, a "green-grey wash" for fog — and it
      // drowned out partly_cloudy's much lighter clusters entirely. Changed
      // to `48,56,72` — a neutral COOL SLATE (B > G > R by construction, the
      // "grey-blue neutral tone, not green" the brief calls for) — distinct
      // from every SOFT_CLOUD_RGB dark tint in V2WeatherMotion.tsx, so this
      // stays its own single, deliberate literal, not a duplicate of theirs.
      // cx/cy/r/startOpacity/endOffset and every OTHER atmosphere/mode in
      // this table are untouched — this is the ONE literal changed.
      glows: [
        { id: 'v2bg-cloudy-1', cx: '74%', cy: '-7%', r: '65%', rgb: '48,56,72', startOpacity: 0.24, endOffset: 0.46 },
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
  },
  // REJECTED-AND-FIXED (device proof + reference screenshots — see project
  // memory): this table used to follow WEATHER_BACKGROUNDS.md's per-weather
  // light branches verbatim (light-cloudy = blue-grey ['#A8ADBA','#BEC4CE',…],
  // light-rain = darker blue-grey ['#586E84','#728AA2','#8EA4B8',…], light-
  // night/-snow = cool blues). On device, real weather resolving to
  // cloudy/rain painted the ENTIRE light screen cold blue-grey — Liam's
  // ruling: light must stay warm sandy cream in EVERY weather; the
  // atmosphere must never repaint light's mood the way it legitimately does
  // in dark. Every light atmosphere below is now a gentle variation WITHIN
  // the warm cream family (same #F6F1E6 final stop as before — the
  // WEATHER_BACKGROUNDS.md weather-warm token, NOT Themes.light.warm
  // #FBFAFC, which is the separate CHROME warm token for surfaces/cards) —
  // no blue-grey, no cool hue, blue channel never dominates red/green in any
  // stop. Sunny is unchanged (it was already correct and matches the
  // references). Every non-sunny atmosphere gets exactly ONE soft diffused
  // golden glow upper-right (sunny's own upper-right glow, just dimmer) —
  // the old cold glows (rain rgb 38,62,90 @0.84, night 22,30,60, snow
  // 196,220,244) are deleted, not just recoloured.
  light: {
    sunny: {
      // Base gradient UNCHANGED — already correct, matches the reference
      // screenshots. Glow POSITION corrected (Liam's polish pass): sunny-1
      // used to sit dead-centre (cx:'50%'), which combined with
      // SunPulseLight's old full-width pill read as a big centred oval
      // behind the Home heading. Biased to upper-right (matching sunny-2 and
      // every other light atmosphere's single glow) so the two glows
      // together read as ONE soft sunlight source entering from the
      // upper-right corner — never a centred panel. Opacities unchanged.
      linearColors: ['#F5F1EB', '#F8F4EE', '#F6F1E6'],
      linearLocations: [0, 0.48, 1],
      glows: [
        { id: 'v2bg-sunny-1-light', cx: '76%', cy: '-16%', r: '85%', rgb: '255,200,90', startOpacity: 0.09, endOffset: 0.56 },
        { id: 'v2bg-sunny-2-light', cx: '85%', cy: '9%', r: '65%', rgb: '255,154,77', startOpacity: 0.05, endOffset: 0.52 },
      ],
    },
    cloudy: {
      // Softer, slightly less golden than sunny — still entirely warm sandy
      // cream, no grey, no blue.
      linearColors: ['#F2EDE0', '#F4EFE3', '#F6F1E6'],
      linearLocations: [0, 0.5, 1],
      glows: [
        { id: 'v2bg-cloudy-1-light', cx: '82%', cy: '-6%', r: '62%', rgb: '255,196,110', startOpacity: 0.07, endOffset: 0.5 },
      ],
    },
    rain: {
      // Slightly deeper/more muted sandy beige than cloudy — reads as an
      // overcast warm day, never a cold wet one.
      linearColors: ['#EDE6D6', '#F1EBDD', '#F6F1E6'],
      linearLocations: [0, 0.48, 1],
      glows: [
        { id: 'v2bg-rain-1-light', cx: '80%', cy: '-8%', r: '60%', rgb: '255,190,100', startOpacity: 0.06, endOffset: 0.5 },
      ],
    },
    night: {
      // Deepest warm ivory of the set (evening warmth, not cold dusk) — the
      // "night" mood in light comes from being the darkest stop in the warm
      // family, never from a blue tint.
      linearColors: ['#E9E1CE', '#EFE8D8', '#F6F1E6'],
      linearLocations: [0, 0.46, 1],
      glows: [
        { id: 'v2bg-night-1-light', cx: '78%', cy: '-5%', r: '58%', rgb: '255,182,90', startOpacity: 0.055, endOffset: 0.48 },
      ],
    },
    snow: {
      // Palest ivory of the set — brightest/whitest while staying warm
      // (never the cool #D6E8F5 ice-blue it used to be).
      linearColors: ['#F8F5EC', '#FAF7F0', '#F6F1E6'],
      linearLocations: [0, 0.52, 1],
      glows: [
        { id: 'v2bg-snow-1-light', cx: '84%', cy: '-8%', r: '60%', rgb: '255,205,130', startOpacity: 0.05, endOffset: 0.5 },
      ],
    },
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
  // THE single shared resolved-weather source (hooks/useResolvedWeather.ts)
  // — owns consent-gated location (FALLBACK_LOCATION pre-consent/declined,
  // the user's already-consented coarse location once granted), the __DEV__
  // weather-tester override, and force-night. Home's weather pill reads the
  // SAME hook, so badge and background can never disagree. Called
  // unconditionally (rules of hooks); the `condition` prop, when supplied,
  // simply overrides the resolved value below (used by tests + any future
  // caller that wants to force a specific look without touching the store).
  const resolved = useResolvedWeather();
  const effective = condition === undefined ? resolved.condition : condition;
  const { mode } = useAppTheme();

  // Night/atmosphere: when the caller passes an explicit `condition` prop we
  // still want the SAME time-aware/force-night resolution the shared hook
  // already computed (no second, divergent isNightNow() call) — but that
  // resolution was computed for `resolved.condition`, not necessarily the
  // overriding `condition` prop, so we re-resolve here using the shared
  // hook's already-correct `night` flag. This keeps exactly one source of
  // "is it night" (the shared hook), while still honouring the `condition`
  // prop override for atmosphere purposes.
  const atmosphere = resolveAtmosphere(effective, resolved.night);
  const spec = ATMOSPHERE_BG[mode][atmosphere];

  const glows = useMemo(() => [...spec.glows, getOceanVignette(mode)], [spec, mode]);

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
      <V2WeatherMotion atmosphere={atmosphere} mode={mode} condition={effective} />
    </View>
  );
}
