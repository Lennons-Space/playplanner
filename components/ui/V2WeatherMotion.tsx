// ─────────────────────────────────────────────────────────────────────────
// V2WeatherMotion — the "alive" layer of the v2 Home background.
//
// DARK — a deliberately SMALL set of ambient, condition-specific motion
// elements rendered between V2Background's static gradients and the screen
// content (unchanged, byte-identical to the accepted dark build):
//   sunny  → pulsing warm glow + a few bokeh orbs floating upward
//   cloudy → slow drifting mist bands
//   rain   → thin falling streaks in a slightly rotated field
//   snow   → slow falling flakes with a gentle sway
//   night  → twinkling stars
//
// UPDATE (2026-07-20, app-wide weather-animation repair): the OPTIONAL
// `condition` prop (finer-grained than `atmosphere` — see
// V2WeatherMotionProps) now drives condition-specific MOTION PARAMETERS
// ONLY — never a new palette/colour — inside DARK rain (drizzle vs
// rain/showers/thunderstorm) and DARK cloudy (fog vs overcast vs
// partly_cloudy vs the existing mainly_clear accent, preserved verbatim),
// PLUS a Defect-1 dark MistBand visibility boost (same RGB, stronger opacity
// + wider vertical spread) and LIGHT rain/drizzle warm-toned streaks + per-
// condition warm haze tuning. Omitting `condition` (every pre-existing
// test) reproduces the exact prior formula in every branch — see
// darkRainParamsFor/darkMistParamsFor/lightHazeParamsFor below.
//
// UPDATE (2026-07-20, Foggy/Overcast/Partly-cloudy softening): fog/overcast/
// partly_cloudy used to render as MistBand (dark) / HazeBand (light) — both
// SOLID-FILL rounded rectangles (flat backgroundColor, hard straight top/
// bottom edges) that read as horizontal slabs/bands rather than clouds.
// These three conditions now route through `SoftCloudLayer` instead — a
// feathered SVG RadialGradient ellipse (same Defs/RadialGradient/Rect
// technique V2Background already uses for its glows), so every edge fades
// to transparent instead of stopping at a hard line. MistBand/HazeBand
// THEMSELVES are unchanged and still render for every OTHER condition
// (mainly_clear's dark accent, the generic/no-condition cloudy default, and
// every light atmosphere other than fog/overcast/partly_cloudy) — see
// isSoftCloudCondition/softCloudParamsFor/softCloudNodesFor below.
//
// UPDATE (2026-07-22, visibility repair — the 2026-07-20 softening pass
// over-corrected and made these three conditions near-invisible on device):
// three compounding root causes, all fixed together —
//   1. Peak opacities were at/below the range an earlier audit had already
//      proven invisible against #0C0C11 (0.04–0.05). Raised meaningfully
//      per condition (see SOFT_CLOUD_FOG/OVERCAST/PARTLY_CLOUDY below).
//   2. A 2-stop RadialGradient (peak → 0) decays continuously from a single
//      mathematical point at the centre, so the *mean* alpha over the whole
//      ellipse is roughly a third of the stated peak. Every SoftCloudLayer
//      gradient now has a 3rd, INTERMEDIATE stop (`coreHold`/
//      `coreOpacityFactor`) so the core actually holds near-peak density
//      before the fade-out begins — the outer stop still always reaches
//      exactly 0, so there is still no hard edge anywhere.
//   3. Coverage was sparse (2–5 small ellipses scattered over the FULL
//      screen height via raw `node.y`). Layer counts are larger now, and
//      each condition gets its own vertical bias (`yBase`/`yRange`) instead
//      of the raw full-height spread — partly cloudy upper-to-middle,
//      overcast broad, fog low-and-middle (see the per-shape comments).
// Colour is now ALSO per-condition (not just per-mode) in dark: fog gets a
// muted grey-blue, overcast a cooler/greyer/darker tint, partly_cloudy keeps
// the original MIST_BAND_RGB family verbatim. Light stays warm sandy in
// every condition (R≥G≥B by construction) — see SOFT_CLOUD_RGB below and
// its accompanying note on how the "cool grey-blue" wording in the brief was
// resolved for Light specifically.
//
// UPDATE (2026-07-22, SECOND pass — shape repair, device evidence: partly
// cloudy near-invisible, overcast read only as "a grey glow behind the
// header", fog read as a GREEN-grey wash): two compounding root causes on
// top of the opacity/coverage fix above —
//   1. A large fraction of the perceived colour was never THIS file's doing.
//      components/ui/V2Background.tsx's dark `cloudy` atmosphere glow
//      ('v2bg-cloudy-1') was `rgb(58,50,18)` — OLIVE (R≈G, ~no blue) — at
//      0.24 opacity, roughly DOUBLE this layer's peak alpha, rendered BEHIND
//      every one of fog/overcast/partly_cloudy (all three share the 'cloudy'
//      atmosphere). That olive field is Liam's "grey glow behind the header"
//      AND, mixed with this layer's genuinely blue-neutral fog tint, his
//      "green-grey wash". Fixed at the source (V2Background.tsx, ONE literal
//      changed to a neutral cool slate) — see that file's comment. Nothing
//      in THIS file's colour tables needed to change for that half of the
//      defect.
//   2. Independent of (1): a single feathered radial ellipse is, by
//      construction, a soft GLOW — it can never read as a cloud silhouette
//      no matter how its opacity is tuned, because a cloud's outline is
//      lumpy/irregular, not a smooth oval. `SoftCloudLayer` (one ellipse per
//      node) is REMOVED for these 3 conditions and replaced with two new
//      primitives, both rendered as ONE `<Svg>` per instance with several
//      static `<Ellipse>` children sharing one gradient def (so cost stays
//      "N animated wrappers", never "N × puffs animated wrappers"):
//   • `SoftCloudCluster` (partly_cloudy, overcast) — a cloud SILHOUETTE: 5
//     overlapping puffs at fixed, deterministic offsets (CLUSTER_PUFF_OFFSETS,
//     scaled by the cluster's own bounding box, itself sized off the seeded
//     node's `r` — never Math.random) so the outline is lumpy, not one smooth
//     oval. Each puff carries its own opacityFactor (baked into the offset
//     table) so a single cluster already reads as layered/dimensional.
//     Overcast ADDITIONALLY varies whole-cluster opacity across its 6
//     instances (`clusterDepthFactorFor`) for a genuine two-tier "some
//     clouds nearer, some further back" depth, per Liam's spec.
//   • `FogBank` — STRUCTURALLY different from a cluster, not a reused one:
//     3 wide, flat (rx ≫ ry) lobes (FOG_LOBE_OFFSETS) of differing
//     width/opacity/offset, no scale-breathe animation (fog only drifts, it
//     never "pulses" the way a cloud cluster subtly does), positioned via
//     the SAME yBase/yRange bias mechanism but skewed low-and-middle.
// Every puff/lobe gradient keeps the SAME 3-stop core-hold shape (peak →
// coreHold → 0 at feather) proven in the opacity-repair pass above — outer
// stop is always exactly 0, so there is still no hard edge anywhere, now at
// the level of each individual puff/lobe rather than one whole ellipse.
//
// UPDATE (2026-07-22, THIRD pass — hard-edge/"rectangular panel" defect,
// device evidence: partly_cloudy showing large rectangular blocks/vertical
// seams/hard-edged panels; fog/overcast confirmed structurally fine but
// fixed identically as a precaution): the SECOND pass above already made
// every puff/lobe feather to exactly 0 alpha at its `feather` stop — but the
// RadialGradient's own `r` was a flat 60% for every condition, with no
// `gradientUnits` specified (so it defaults to objectBoundingBox — r=60% is
// therefore 0.6 of the FILLED SHAPE's own bounding box). Because the offset
// axis is a fraction OF that r, the outer stop's true zero-alpha distance
// from centre is `feather × 0.6`: partly_cloudy (feather 0.92) → 0.552, fog
// (0.95) → 0.57 — BOTH greater than 0.5, the shape's own edge (an ellipse's
// edge sits at bbox-distance exactly 0.5 by construction). Past that
// distance the ellipse's fill is hard-CLIPPED by its own boundary while the
// gradient still carries non-zero alpha (≈0.157× peak for partly_cloudy at
// the clip point) — a visible rim. overcast (feather 0.78 → 0.468) happened
// to land just inside 0.5 (only ~3% margin), which is why it read as a soft
// "sheet" rather than showing rims. Because CLUSTER_PUFF_OFFSETS[0] is
// deliberately sized to fill the ENTIRE Svg viewport (rx/ry 50%, tangent to
// all four sides), that rim coincides with the cluster's own rectangular
// bounding box — Liam's "large rectangular blocks, vertical seams and
// hard-edged panels".
//
// Fix (adopts V2Background's proven "radial gradient painted onto an area
// strictly larger than its own falloff" technique, rather than a filled
// Ellipse whose own boundary IS the clip edge):
//   1. Every puff/lobe is now a `<Rect>`, never an `<Ellipse>` — a
//      rectangle's fill region is itself just that rectangle, so there is no
//      CURVED shape rim for a still-nonzero gradient to be clipped against,
//      only straight edges, which (2)+(3) below push comfortably out of
//      reach. This also removes the suspected (c) Android per-element
//      `opacity`-on-a-gradient-fill compositing path (see point 4).
//   2. GRADIENT_ZERO_TARGET (0.4 — exactly "0.8 × the shape's own half-extent
//      of 0.5", the headroom the brief calls for) fixes the gradient's own
//      zero-alpha point at bbox-distance 0.4 for EVERY puff/lobe regardless
//      of its `feather`, by solving `r = 0.4 / feather`
//      (puffGradientRadiusFraction) — a full 0.1 (20%) of clear headroom
//      before that Rect's own edge, for every condition's feather (0.78–0.95).
//   3. CLOUD_CANVAS_PAD (1.3) draws each puff's Rect at its nominal
//      offset-table size divided by 1.3, inside a Svg/wrapper that is itself
//      1.3× the nominal cluster/bank box (same centre point, just a bigger
//      invisible bounding box) — so even that Rect's own edge (already fully
//      transparent per (2)) never touches the Svg's own viewport either,
//      satisfying "no shape may touch the Svg bounds" as an independent,
//      second layer of defence on top of the gradient math, not a
//      replacement for it.
//   4. The old shared per-cluster `<RadialGradient>` + per-Ellipse `opacity`
//      prop (an SVG shape-opacity, composited via an offscreen layer on
//      Android — a known source of rectangular artifacts, Liam's suspected
//      cause (c)) is REMOVED entirely. Each puff/lobe now gets its OWN
//      gradient def with `s.opacityFactor` pre-multiplied into that
//      gradient's own stop alphas — there is no shape-level `opacity` prop
//      anywhere in this file any more.
//   5. Every gradient id is unique per condition AND per puff/lobe instance
//      (`${gradIdPrefix}-${i}`, where gradIdPrefix already carries the
//      condition name — see SoftCloudCluster/FogBank below), so two
//      simultaneously-mounted screens showing the same condition can never
//      collide in react-native-svg's def registry.
// Separately, overcast's raw seededNodes(6, …) draw happens to land all 6
// y-values inside a narrow ~14–31% band with two near-duplicate x pairs —
// six large, heavily-overlapping masses in a tight band reads as ONE solid
// grey sheet no matter how well-fed each cluster is, which is Liam's "still
// reads as one broad grey sheet" note. `overcastClusterLayout` (below,
// near clusterDepthFactorFor) replaces the raw x/y placement for overcast
// ONLY with an explicit staggered-slot + two-band scheme tied to the
// existing depth-tier split — see its own comment.
//
// UPDATE (2026-07-22, FOURTH pass — visibility/identity repair: the THIRD
// pass's hard-edge fix is CONFIRMED GOOD and untouched by this pass, but its
// side effect was quantified as making partly_cloudy/overcast/fog read as
// near-invisible / indistinct from each other and from clear sky. Root cause
// (already derived, not re-derived here): GRADIENT_ZERO_TARGET=0.4 (down
// from feather×0.6) plus CLOUD_CANVAS_PAD=1.3 (each puff/lobe Rect drawn at
// 1/1.3 of its nominal size) together shrank partly_cloudy's visible radius
// to ~31% of its nominal size (~33% of its old painted area) while peak
// opacity stayed flat. Fix uses ONLY the 4 levers that are independent of
// the no-edge invariant (peak opacity, nominal size, coreHold/
// coreOpacityFactor, layer count) — GRADIENT_ZERO_TARGET, CLOUD_CANVAS_PAD,
// puffGradientRadiusFraction and the Rect-not-Ellipse shape are all BYTE-
// IDENTICAL to the THIRD pass; see the regression-guard tests, unchanged.
//   • partly_cloudy: size ×1.5 (recovers the CLOUD_CANVAS_PAD shrink),
//     opacityBase ×1.31/1.27 (dark/light), coreHold 0.45→0.54 (ratio/feather
//     0.5→0.6), coreOpacityFactor 0.85→0.92. Cluster count (4) and placement
//     (yBase/yRange) unchanged — already inside the "3–4 clusters, upper-to-
//     middle" target.
//   • overcast: size ×1.1 width / ×1.5 height (kept narrower than fog's
//     width so fog stays the widest of the three, an existing invariant),
//     opacityBase ×1.23/1.31 (dark/light), coreOpacityFactor 0.88→0.94.
//     coreHold nudged DOWN 0.50→0.47 — a new, explicit ramp-length guard
//     (span = (feather−coreHold)×r must stay ≥~0.15 of the bbox, see the
//     regression test below) proved the THIRD pass's overcast value
//     (ratio coreHold/feather=0.641) was already marginally past that
//     threshold (ramp≈0.144); this pass's lower ratio (0.603, ramp≈0.159)
//     both fixes that latent issue and is more than offset by the
//     coreOpacityFactor/opacity/size increases above. Depth-tier layering
//     (clusterDepthFactorFor/overcastClusterLayout) is UNCHANGED — already
//     satisfies "≥2 distinct opacity levels" from the THIRD pass.
//   • fog: ONLY opacityBase/opacityVar raised, ×1.25 (dark 0.192→0.24, light
//     0.124→0.155) — a further 20–30% on top of the THIRD pass's +13%, per
//     spec ("applied to the current values"). Every other fog parameter
//     (size, feather, coreHold, coreOpacityFactor, yBase/yRange,
//     durationBaseMs, driftFactor) is BYTE-IDENTICAL — fog's shape/placement
//     was already correct on device, only visibility needed raising.
// Rainy/Drizzly (RainStreak/WarmStreak/RAIN_PARAMS_*/darkRainParamsFor) and
// mainly_clear's MistBand accent are untouched — this pass edits nothing
// outside SOFT_CLOUD_FOG/OVERCAST/PARTLY_CLOUDY below.
//
// LIGHT — REJECTED-AND-FIXED (device proof + reference screenshots, see
// project memory): light used to branch by atmosphere the same way as dark
// (mist bands for cloudy, rain streaks for rain, etc), which painted the
// light screen cold blue-grey whenever real weather resolved to
// cloudy/rain. Liam's ruling: light must stay warm sandy cream in EVERY
// weather — the atmosphere must never repaint light's mood. Light therefore
// renders the SAME warm ambient set for every `atmosphere`: SunPulseLight
// (breathe + gentle drift) + BokehOrb (existing, light-toned) + drifting
// warm haze bands + faint golden dust motes floating upward, now with
// condition-specific timing/opacity on the haze bands and (rain-family
// only) an additive warm-toned streak layer (WarmStreak — its own colour,
// never RainStreak's). MistBand / RainStreak / Snowflake / Star NEVER
// render in light — those four stay dark-only, full stop.
//
// Every layer is inside the SAME `if (!animate) return null` guard, so
// reduced motion / backgrounded fully stops both paths identically. All
// nodes use useLoop (wall-clock phased, no per-screen clocks) + module-level
// seededNodes sets (light's HAZE_SUNNY/DUST_LIGHT are separate seeds from
// dark's BOKEH/STREAKS/MIST/STARS/FLAKES — nothing is reused or mutated)
// — this is what keeps continuity across navigation and mode switches with
// zero reseeding.
//
// This is NOT the full WEATHER_BACKGROUNDS.md particle system (68 streaks /
// 52 gusts / leaves) — that spec remains P2. This layer exists to make the
// background feel alive at minimal cost.
//
// Android safety / performance:
//   • ≤~16 animated nodes per render, transform/opacity ONLY (no layout
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
import Svg, { Defs, Rect, RadialGradient, Stop } from 'react-native-svg';
import {
  seededNodes,
  useAppActive,
  useLoop,
  useReducedMotionPref,
  type SeededNode,
} from '@/components/weather/WeatherLayer';
import type { Atmosphere } from '@/lib/weatherTheme';
import type { WeatherCondition } from '@/lib/weather';

// ── Single animated node primitives ────────────────────────────────────────

// Mode-aware colour lookups. Dark values are UNCHANGED from before this
// Phase A pass (byte-identical literals).
//
// BOKEH_COLOR.light is genuinely reachable — BokehOrb renders in BOTH modes
// (it's part of the shared warm ambient set, see V2WeatherMotion below).
//
// RAIN_STREAK_RGB.light / MIST_BAND_RGB.light / SNOWFLAKE_COLOR.light are
// now UNREACHABLE DEAD CODE, kept only so RainStreak/MistBand/Snowflake's
// existing `mode` prop signature doesn't need to change (they still accept
// `mode: 'dark' | 'light'` for type-shape stability, but V2WeatherMotion
// below only ever calls them from the dark-only render branch, so `mode` is
// always 'dark' at every real call site — this is the REJECTED-AND-FIXED
// per-weather light colour scheme: light no longer renders RainStreak,
// MistBand, or Snowflake at all, in any atmosphere). Grep sweep note: the
// `.light` values below ('62,88,114' / '82,96,116') are the exact literals
// a forbidden-cold-value grep will find — they are justified as dead, never
// executed for a light render.
const BOKEH_COLOR: Record<'dark' | 'light', string> = {
  dark: 'rgba(255,195,107,0.16)',
  light: 'rgba(255,195,107,0.12)',
};
const RAIN_STREAK_RGB: Record<'dark' | 'light', string> = {
  dark: '150,186,216',
  light: '62,88,114', // unreachable — see note above
};
const MIST_BAND_RGB: Record<'dark' | 'light', string> = {
  dark: '96,104,124',
  light: '82,96,116', // unreachable — see note above
};
const SNOWFLAKE_COLOR: Record<'dark' | 'light', string> = {
  dark: 'rgba(235,242,252,0.9)',
  light: 'rgba(255,255,255,0.9)', // unreachable — see note above
};

// Cloud-cluster/fog-bank colour family — see SOFT_CLOUD_RGB (per-condition,
// per-mode) further below, next to the SOFT_CLOUD_FOG/OVERCAST/PARTLY_CLOUDY
// shapes it belongs with (2026-07-22 visibility repair: dark tints differ
// PER CONDITION, not just per mode — see the file-header note above).

/** Sunny: soft amber orb drifting upward while fading in/out. */
function BokehOrb({
  node,
  animate,
  screenH,
  mode,
}: {
  node: SeededNode;
  animate: boolean;
  screenH: number;
  mode: 'dark' | 'light';
}) {
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
          backgroundColor: BOKEH_COLOR[mode],
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

// ── LIGHT-ONLY "sandy daylight" motion ─────────────────────────────────────
// Everything below this line is additive and only ever rendered when
// mode === 'light' (gated at the call sites in V2WeatherMotion, not inside
// these components) — none of it is reachable from a dark render, and none
// of it touches SunPulse/BokehOrb/MistBand/Star/Snowflake/RainStreak above.

// Feathered upper-right sun glow — three concentric, static, low-opacity
// rings (each just a plain View: fixed size + borderRadius + backgroundColor,
// no transform/animation of their own) nested inside the ONE animated
// wrapper below. Progressively smaller + very slightly stronger toward the
// centre fakes a soft radial falloff (a manual, blur-free feather) instead
// of the previous single flat-opacity pill. Sizes are fixed px (not
// percentage-of-screen-width) so this reads as a compact corner light
// source, never a full-width band.
const SUN_GLOW_RINGS = [
  { size: 240, opacity: 0.045 },
  { size: 160, opacity: 0.065 },
  { size: 92, opacity: 0.085 },
] as const;

/**
 * LIGHT (every atmosphere): a small, soft, upper-right-anchored sun glow —
 * gentle breathing (scale + opacity) PLUS a slow, subtle drift, so it feels
 * like sunlight easing across the corner of the sky rather than a shape
 * pulsing in the centre of the screen. Two independent useLoop drivers
 * (different durations/delays) so the drift and the breathe never look
 * synchronised. Polish pass (Liam): replaced a giant left:-10%/right:-10%
 * solid pill (read as a big centred oval behind the Home heading) with this
 * compact, feathered, corner-anchored glow — same wall-clock useLoop
 * animation model, just a different shape/position/size. The dark SunPulse
 * above is completely unchanged — this is a separate component, never a
 * mode branch inside SunPulse itself.
 */
function SunPulseLight({ animate }: { animate: boolean }) {
  const tPulse = useLoop(animate, 9000);
  const tDrift = useLoop(animate, 27000, 4200);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(tPulse.value, [0, 1], [0.55, 1]),
    transform: [
      { scale: interpolate(tPulse.value, [0, 1], [1, 1.07]) },
      { translateX: interpolate(tDrift.value, [0, 1], [-10, 10]) },
      { translateY: interpolate(tDrift.value, [0, 1], [-6, 6]) },
    ],
  }));
  return (
    <Animated.View
      testID="v2-sun-pulse-light"
      style={[
        {
          position: 'absolute',
          top: '-10%',
          right: '-12%',
          width: SUN_GLOW_RINGS[0].size,
          height: SUN_GLOW_RINGS[0].size,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {SUN_GLOW_RINGS.map((ring) => (
        <View
          key={ring.size}
          testID={`v2-sun-pulse-light-ring-${ring.size}`}
          style={{
            position: 'absolute',
            width: ring.size,
            height: ring.size,
            borderRadius: ring.size / 2,
            backgroundColor: `rgba(255,196,120,${ring.opacity})`,
          }}
        />
      ))}
    </Animated.View>
  );
}

// Warm sandy/cream haze bands — alternating tints so a 2–3-node set doesn't
// read as one repeated colour. Faint opacity (0.05–0.09) baked into the
// static backgroundColor (same convention as MistBand); only the transform
// is animated.
const HAZE_BAND_RGB: readonly [string, string] = ['246,224,180', '255,238,205'];

/**
 * Motion-only parameters (never colour) for a drifting band component
 * (HazeBand light / MistBand dark). Splitting these out lets each condition
 * (fog/overcast/partly_cloudy/rain, warm or cold) get visibly different
 * speed/opacity/thickness while the underlying colour family and component
 * stay exactly the same — "vary motion, never palette".
 *
 * Exported (additive) so tests can assert on the resolved parameters
 * directly — pure, no Reanimated worklet evaluation required.
 */
export interface BandParams {
  durationBaseMs: number;
  durationVarMs: number;
  opacityBase: number;
  opacityVar: number;
  heightBase: number;
  heightVar: number;
  driftFactor: number;
}

// Reproduces HazeBand's ORIGINAL hardcoded formula exactly — the fallback
// used whenever no `condition` is supplied (every existing test in this
// file), so that path stays byte-identical to before this pass.
const HAZE_PARAMS_DEFAULT: BandParams = {
  durationBaseMs: 22000, durationVarMs: 18000,
  opacityBase: 0.05, opacityVar: 0.04,
  heightBase: 70, heightVar: 60,
  driftFactor: 0.12,
};

/**
 * LIGHT (every atmosphere): a wide, soft, warm-cream band drifting slowly
 * sideways — "gentle curved atmospheric layers." Same geometry family as
 * MistBand (full-bleed width, rounded, horizontal drift) but its own
 * component/seed set so MistBand's dark behaviour is untouched — MistBand
 * itself never renders in light any more (see V2WeatherMotion below).
 * `params` (Defect 3, 2026-07-20) varies speed/opacity/thickness per
 * condition; defaults to HAZE_PARAMS_DEFAULT (the original formula).
 */
function HazeBand({
  node,
  index,
  animate,
  screenW,
  params = HAZE_PARAMS_DEFAULT,
}: {
  node: SeededNode;
  index: number;
  animate: boolean;
  screenW: number;
  /** Condition-specific motion tuning (Defect 3) — defaults to the original values. */
  params?: BandParams;
}) {
  const t = useLoop(animate, params.durationBaseMs + node.r * params.durationVarMs, node.delay);
  const rgb = HAZE_BAND_RGB[index % 2];
  const opacity = params.opacityBase + node.r * params.opacityVar;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-params.driftFactor * screenW, params.driftFactor * screenW]) }],
  }));
  return (
    <Animated.View
      testID={`v2-haze-band-${index}`}
      style={[
        {
          position: 'absolute',
          left: '-20%',
          width: '140%',
          top: `${8 + node.y * 46}%`,
          height: params.heightBase + node.r * params.heightVar,
          borderRadius: 999,
          backgroundColor: `rgba(${rgb},${opacity})`,
        },
        style,
      ]}
    />
  );
}

/**
 * LIGHT (every atmosphere): a single faint golden dust mote floating slowly
 * upward — "faint floating dust." Same shape family as BokehOrb but its own
 * component/seed set so BOKEH/BokehOrb (used in BOTH modes) stays untouched.
 * Opacity (not colour alpha) carries the faintness so the animated range
 * (0.05–0.10) is the ONLY thing that ever makes it visible.
 */
function DustMote({
  node,
  index,
  animate,
  screenH,
}: {
  node: SeededNode;
  index: number;
  animate: boolean;
  screenH: number;
}) {
  const t = useLoop(animate, 16000 + node.r * 12000, node.delay, false);
  const size = 3 + node.r * 5;
  const maxOpacity = 0.05 + node.r * 0.05;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 0.8, 1], [0, maxOpacity, maxOpacity, 0]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [0, -0.3 * screenH]) }],
  }));
  return (
    <Animated.View
      testID={`v2-dust-mote-${index}`}
      style={[
        {
          position: 'absolute',
          left: `${4 + node.x * 92}%`,
          top: `${38 + node.y * 50}%`,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#FFD696',
        },
        style,
      ]}
    />
  );
}

// Warm sand streak colour — R > G > B by construction, so the blue channel
// can never dominate (the hard "no cold hex in light" rule). Faint alpha
// only (0.05–0.10), same convention as HazeBand/DustMote.
const WARM_STREAK_RGB = '224,196,140';

/**
 * LIGHT (rain/drizzle/showers/thunderstorm ONLY — gated at the call site by
 * a `condition` check, see V2WeatherMotion below): a warm-toned falling
 * streak, the light equivalent of dark's RainStreak but never that cold
 * component/colour. Kept honestly rain-shaped (a falling streak) while
 * staying unmistakably warm sandy cream — this is the "visible warm-toned
 * moving streaks" Defect 3 calls for, built from the HazeBand/DustMote warm
 * family rather than reusing RainStreak's RAIN_STREAK_RGB.
 */
function WarmStreak({ node, animate, screenH }: { node: SeededNode; animate: boolean; screenH: number }) {
  const t = useLoop(animate, 900 + node.r * 700, node.delay % 1200, false);
  const h = 50 + node.r * 50;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(t.value, [0, 1], [-h - 30, screenH + 30]) }],
  }));
  return (
    <Animated.View
      testID="v2-warm-streak"
      style={[
        {
          position: 'absolute',
          left: `${node.x * 100}%`,
          top: 0,
          width: 1 + node.r * 0.6,
          height: h,
          borderRadius: 1,
          backgroundColor: `rgba(${WARM_STREAK_RGB},${0.05 + node.r * 0.05})`,
        },
        style,
      ]}
    />
  );
}

/**
 * Rain motion-only parameters (Defect 1+3, dark rain split). All rain
 * conditions share the SAME colour (RAIN_STREAK_RGB) — only density,
 * thickness, opacity and fall speed vary.
 */
export interface StreakParams {
  durationBaseMs: number;
  durationVarMs: number;
  widthBase: number;
  widthVar: number;
  heightBase: number;
  heightVar: number;
  opacityBase: number;
  opacityVar: number;
}

// Reproduces RainStreak's ORIGINAL hardcoded formula exactly — used for
// condition='rain' AND as the fallback when no `condition` is supplied
// (every existing test in this file calls with atmosphere='rain' only), so
// that path stays byte-identical to before this pass. Also honestly reused
// for 'showers'/'thunderstorm' (rain-like dense weather — see file header).
const RAIN_PARAMS_RAIN: StreakParams = {
  durationBaseMs: 620, durationVarMs: 420,
  widthBase: 1, widthVar: 1,
  heightBase: 80, heightVar: 90,
  opacityBase: 0.14, opacityVar: 0.14,
};

// Drizzle: sparse, thin, slower/lighter streaks — fewer nodes (see
// DRIZZLE_STREAKS below), thinner width, lower opacity, slower fall than
// full rain. Same RAIN_STREAK_RGB colour, motion only.
const RAIN_PARAMS_DRIZZLE: StreakParams = {
  durationBaseMs: 1400, durationVarMs: 900,
  widthBase: 0.6, widthVar: 0.4,
  heightBase: 50, heightVar: 40,
  opacityBase: 0.06, opacityVar: 0.06,
};

/** Rain: one thin streak falling through a rotated field. */
function RainStreak({
  node,
  animate,
  screenH,
  mode,
  params = RAIN_PARAMS_RAIN,
}: {
  node: SeededNode;
  animate: boolean;
  screenH: number;
  mode: 'dark' | 'light';
  /** Condition-specific motion tuning (Defect 1+3) — defaults to the original 'rain' values. */
  params?: StreakParams;
}) {
  const t = useLoop(animate, params.durationBaseMs + node.r * params.durationVarMs, node.delay % 900, false);
  const h = params.heightBase + node.r * params.heightVar;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(t.value, [0, 1], [-h - 40, screenH + 40]) }],
  }));
  return (
    <Animated.View
      testID="v2-rain-streak"
      style={[
        {
          position: 'absolute',
          left: `${node.x * 100}%`,
          top: 0,
          width: params.widthBase + node.r * params.widthVar,
          height: h,
          borderRadius: 1,
          backgroundColor: `rgba(${RAIN_STREAK_RGB[mode]},${params.opacityBase + node.r * params.opacityVar})`,
        },
        style,
      ]}
    />
  );
}

/**
 * Cloudy motion-only parameters (Defect 1+3, dark cloudy split), PLUS the
 * Defect 1 dark-visibility boost baked into the default: legacy opacity
 * (0.05–0.10) was invisible against #0C0C11 on device. `MIST_PARAMS_DEFAULT`
 * lifts that into a perceptible-but-subtle range (no palette change — same
 * MIST_BAND_RGB) and widens the vertical band (yStart/ySpan) so motion isn't
 * confined to the very top, which several screens' opaque heroes bury.
 * `MIST_PARAMS_LEGACY` reproduces the untouched original formula exactly —
 * reserved for the existing WMO-1 "mainly clear" restrained accent, which
 * Liam's spec says to PRESERVE as-is, not boost or vary.
 */
export interface MistParams extends BandParams {
  yStart: number;
  ySpan: number;
}

const MIST_PARAMS_LEGACY: MistParams = {
  durationBaseMs: 18000, durationVarMs: 10000,
  opacityBase: 0.05, opacityVar: 0.05,
  heightBase: 80, heightVar: 70,
  yStart: 6, ySpan: 50,
  driftFactor: 0.10,
};

// Defect 1 boost: opacity 0.05–0.10 → 0.09–0.19 (still the same RGB, just
// stronger alpha) and vertical spread 6–56% → 6–76% of the screen.
const MIST_PARAMS_DEFAULT: MistParams = {
  durationBaseMs: 18000, durationVarMs: 10000,
  opacityBase: 0.09, opacityVar: 0.10,
  heightBase: 80, heightVar: 70,
  yStart: 6, ySpan: 70,
  driftFactor: 0.10,
};

// Fog: wide, soft, SLOW horizontal fog banks — slower drift, taller/softer
// bands than the default, spread across almost the full screen height.
const MIST_PARAMS_FOG: MistParams = {
  durationBaseMs: 32000, durationVarMs: 18000,
  opacityBase: 0.07, opacityVar: 0.06,
  heightBase: 110, heightVar: 70,
  yStart: 4, ySpan: 78,
  driftFactor: 0.16,
};

// Overcast: heavier (higher opacity), slower cloud drift than the default.
const MIST_PARAMS_OVERCAST: MistParams = {
  durationBaseMs: 26000, durationVarMs: 14000,
  opacityBase: 0.12, opacityVar: 0.12,
  heightBase: 90, heightVar: 70,
  yStart: 6, ySpan: 70,
  driftFactor: 0.09,
};

// Partly cloudy: LIGHTER, quicker cloud drift than the default (thinner
// bands, lower opacity) — paired with a couple of Star nodes at the call
// site so "mixed sun/cloud" still reads as visibly different from full
// overcast.
const MIST_PARAMS_PARTLY_CLOUDY: MistParams = {
  durationBaseMs: 15000, durationVarMs: 9000,
  opacityBase: 0.07, opacityVar: 0.07,
  heightBase: 65, heightVar: 55,
  yStart: 6, ySpan: 60,
  driftFactor: 0.12,
};

/**
 * Resolves the dark cloudy-atmosphere MistBand params for a fine condition
 * (Defect 1+3). Exported (additive) for pure, parameter-level test coverage.
 */
export function darkMistParamsFor(condition: WeatherCondition | null | undefined): MistParams {
  switch (condition) {
    case 'fog':
      return MIST_PARAMS_FOG;
    case 'overcast':
      return MIST_PARAMS_OVERCAST;
    case 'partly_cloudy':
      return MIST_PARAMS_PARTLY_CLOUDY;
    default:
      // Covers undefined/null (no condition supplied) — the boosted-but-
      // generic default, never the untouched legacy accent formula.
      return MIST_PARAMS_DEFAULT;
  }
}

/**
 * Resolves the dark rain-atmosphere RainStreak params for a fine condition
 * (Defect 1+3). Exported (additive) for pure, parameter-level test coverage.
 */
export function darkRainParamsFor(condition: WeatherCondition | null | undefined): StreakParams {
  // showers/thunderstorm honestly reuse the dense 'rain' params (see file
  // header) — only drizzle gets the sparse/lighter treatment. undefined/
  // null (no condition supplied) also falls back to 'rain', which is the
  // exact original formula.
  return condition === 'drizzle' ? RAIN_PARAMS_DRIZZLE : RAIN_PARAMS_RAIN;
}

/** Cloudy/fog: a wide soft band drifting slowly sideways. */
function MistBand({
  node,
  animate,
  screenW,
  mode,
  params = MIST_PARAMS_LEGACY,
}: {
  node: SeededNode;
  animate: boolean;
  screenW: number;
  mode: 'dark' | 'light';
  /** Condition-specific motion tuning (Defect 1+3) — defaults to the original values. */
  params?: MistParams;
}) {
  const t = useLoop(animate, params.durationBaseMs + node.r * params.durationVarMs, node.delay);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-params.driftFactor * screenW, params.driftFactor * screenW]) }],
  }));
  return (
    <Animated.View
      testID="v2-mist-band"
      style={[
        {
          position: 'absolute',
          left: '-20%',
          width: '140%',
          top: `${params.yStart + node.y * params.ySpan}%`,
          height: params.heightBase + node.r * params.heightVar,
          borderRadius: 999,
          backgroundColor: `rgba(${MIST_BAND_RGB[mode]},${params.opacityBase + node.r * params.opacityVar})`,
        },
        style,
      ]}
    />
  );
}

// ── Cloud clusters + fog banks: recognisable FORMS for fog/overcast/
// partly_cloudy (2026-07-22 second pass — shape repair; see file header) ───
// Replaces the single-ellipse `SoftCloudLayer` (2026-07-20/first-pass
// 2026-07-22) for ONLY these three conditions — every other condition keeps
// rendering MistBand/HazeBand exactly as before (see the call sites in
// V2WeatherMotion below). `softCloudParamsFor`/`softCloudNodesFor`/
// `softCloudDensityFor`/`isSoftCloudCondition` are KEPT (same names, same
// signatures) so every pure, parameter-level caller/test is unaffected by
// the render-side shape change underneath them.
export interface SoftCloudParams {
  durationBaseMs: number;
  durationVarMs: number;
  opacityBase: number;
  opacityVar: number;
  sizeWBase: number;
  sizeWVar: number;
  sizeHBase: number;
  sizeHVar: number;
  driftFactor: number;
  /** RadialGradient offset (0–1) at which the ellipse reaches fully transparent — controls how soft/feathered the edge is. */
  feather: number;
  /**
   * RadialGradient offset (0–1) of an INTERMEDIATE stop that holds most of
   * the peak opacity before the fade-out begins (2026-07-22 visibility
   * repair). A plain 2-stop gradient (peak → 0 at `feather`) decays
   * continuously from a single point at the centre, so the ellipse's mean
   * alpha ends up roughly a third of the stated peak — this stop is what
   * makes the core actually read as dense instead of a faint smudge.
   */
  coreHold: number;
  /** Fraction (0–1) of peak opacity retained at the `coreHold` stop. */
  coreOpacityFactor: number;
  /**
   * Vertical placement (2026-07-22 visibility repair): `top = yBase +
   * node.y * yRange` (percent of screen height), replacing the old raw
   * `node.y * 100` full-height spread. Lets each condition bias where its
   * layers sit — e.g. fog low/mid, partly cloudy upper/mid, overcast broad.
   */
  yBase: number;
  yRange: number;
  /** "R,G,B" triplet — SOFT_CLOUD_RGB[condition][mode], resolved by softCloudParamsFor. */
  rgb: string;
}

type SoftCloudCondition = 'fog' | 'overcast' | 'partly_cloudy';

interface SoftCloudShape {
  durationBaseMs: number;
  durationVarMs: number;
  sizeWBase: number;
  sizeWVar: number;
  sizeHBase: number;
  sizeHVar: number;
  driftFactor: number;
  feather: number;
  coreHold: number;
  coreOpacityFactor: number;
  yBase: number;
  yRange: number;
  opacityBase: Record<'dark' | 'light', number>;
  opacityVar: Record<'dark' | 'light', number>;
}

// Colour family (2026-07-22 visibility repair, UNCHANGED by this second
// pass): dark tints are PER CONDITION, not just per mode — fog reads as a
// muted grey-blue, overcast a cooler/greyer/DARKER tint, partly_cloudy keeps
// the ORIGINAL MIST_BAND_RGB family verbatim. Light stays warm sandy in
// EVERY condition (R≥G≥B by construction, the standing "no cold light"
// rule) — the brief's "cool grey"/"grey-blue" wording is resolved as
// DARK-ONLY; in Light the same fog<partly<overcast intensity ordering is
// expressed by de-saturating toward a more neutral stone tone for overcast
// (smaller R-G-B gaps) rather than introducing any blue. These literals are
// NOT touched by the shape repair — device evidence traced the "green-grey
// wash" to V2Background's olive glow (root cause #1, fixed in that file),
// not to these already-blue-neutral tints.
const SOFT_CLOUD_RGB: Record<SoftCloudCondition, Record<'dark' | 'light', string>> = {
  partly_cloudy: { dark: MIST_BAND_RGB.dark, light: '208,198,180' },
  overcast: { dark: '82,90,102', light: '196,190,180' },
  fog: { dark: '110,120,138', light: '202,194,184' },
};

// Fog: 5 wide, low, EXTREMELY slow FogBanks (see `FogBank` below) — the most
// diffuse of the three. Longest duration (slowest sideways drift) of the
// set. Vertical bias is LOW-AND-MIDDLE (yBase 32, yRange 56 → roughly the
// 32%–88% band) per Liam's spec ("strongest through the lower and middle of
// the screen"). Widest feather (0.95) + lowest coreOpacityFactor (0.78) of
// the three: the softest, most feathered lobe edges, achieving "reduced
// contrast" purely through overlapping wide patches (no full-screen scrim,
// per the hard constraint).
// 2026-07-22 THIRD pass — Liam's device verdict: "Foggy: mostly correct,
// reads as horizontal low mist... may be made ~10-15% more visible ONLY."
// opacityBase/opacityVar raised by exactly 13% (dark 0.17→0.192,
// 0.07→0.079; light 0.11→0.124, 0.05→0.057) — same RGB, same lobe geometry
// (FOG_LOBE_OFFSETS untouched), same slow drift (durationBaseMs/driftFactor
// untouched), same yBase/yRange — ONLY the alpha changed, by the requested
// amount, nothing else.
// 2026-07-22 FOURTH pass — fog was the ONE condition Liam confirmed "mostly
// correct" on device; spec asks for a FURTHER 20–30% visibility raise
// "applied to the current [THIRD-pass] values", structure/geometry/drift
// otherwise preserved exactly. opacityBase/opacityVar raised by exactly 25%
// (dark 0.192→0.24, light 0.124→0.155; opacityVar 0.079→0.09875,
// 0.057→0.07125) — every other field below (size, feather, coreHold,
// coreOpacityFactor, yBase/yRange, durationBaseMs, driftFactor) is BYTE-
// IDENTICAL to the THIRD pass.
const SOFT_CLOUD_FOG: SoftCloudShape = {
  durationBaseMs: 42000, durationVarMs: 20000,
  sizeWBase: 340, sizeWVar: 120,
  sizeHBase: 70, sizeHVar: 34,
  driftFactor: 0.09,
  feather: 0.95,
  coreHold: 0.38,
  coreOpacityFactor: 0.78,
  yBase: 32, yRange: 56,
  opacityBase: { dark: 0.268, light: 0.155 }, // dark +11.5% over FOURTH-pass 0.24 (peak 0.339→0.378); light UNCHANGED (Liam: no change to sandy Light background)
  opacityVar: { dark: 0.110, light: 0.07125 }, // dark +11.5% over FOURTH-pass 0.09875 (peak 0.339→0.378); light UNCHANGED
};

// Overcast: 6 SoftCloudClusters (see `SoftCloudCluster` below) — fewer than
// fog but the LARGEST/HEAVIEST masses of the three: highest peak opacity,
// biggest bounding box, slowest drift distance (settled, heavy sky), and the
// largest coreOpacityFactor (0.88 — holds density longest), so it reads
// unmistakably heavier than partly_cloudy. Vertical bias is TOP-HALF +
// MIDDLE (yBase 4, yRange 62 → ~4%–66%) per Liam's spec, leaving fog to own
// the lower band. `clusterDepthFactorFor` additionally varies whole-cluster
// opacity across the 6 instances for a genuine two-tier depth ("some
// clouds nearer, some further back") — see that function below.
// 2026-07-22 FOURTH pass — visibility repair: sizeWBase/sizeWVar ×1.1 and
// sizeHBase/sizeHVar ×1.5 (width kept below fog's 340/120 nominal so fog
// stays the widest of the three — an existing invariant, not touched;
// height grows more freely since "tallest/heaviest" was always overcast's
// own distinguishing trait, never width). opacityBase/opacityVar raised
// ~23%/31% (dark 0.22→0.27, light 0.13→0.17; opacityVar 0.10→0.12,
// 0.06→0.075). coreOpacityFactor raised 0.88→0.94 (core holds closer to
// full peak). coreHold moved 0.50→0.47 — NOT a visibility cut: it is the
// new explicit ramp-length guard (span=(feather−coreHold)×r must stay
// ≥~0.15 of the bbox) proving the THIRD pass's 0.50 (ratio 0.641) was
// already marginally past that threshold (ramp≈0.144, see the regression
// test below) — 0.47 (ratio 0.603, ramp≈0.159) is the fix, and the
// resulting tiny reduction in core-hold REACH is more than offset by the
// coreOpacityFactor/opacity/size increases above. feather (0.78) and
// yBase/yRange (4/62, "upper-half + middle" per spec) are unchanged —
// depth-tier layering (clusterDepthFactorFor/overcastClusterLayout) is
// untouched, already satisfying "≥2 distinct opacity levels".
const SOFT_CLOUD_OVERCAST: SoftCloudShape = {
  durationBaseMs: 27000, durationVarMs: 14000,
  sizeWBase: 330, sizeWVar: 143,
  sizeHBase: 255, sizeHVar: 120,
  driftFactor: 0.07,
  feather: 0.78,
  coreHold: 0.47,
  coreOpacityFactor: 0.94,
  yBase: 4, yRange: 62,
  opacityBase: { dark: 0.27, light: 0.17 },
  opacityVar: { dark: 0.12, light: 0.075 },
};

// Partly cloudy: 4 SoftCloudClusters, FEWEST and SMALLEST of the three,
// NEVER full-width — leaves the most base atmosphere/stars visible and
// reads as separated masses rather than a wash. Shortest duration (fastest
// relative drift) of the three, per Liam's spec, while still gentle in
// absolute terms. Upper-to-middle vertical bias (yBase 4, yRange 42 →
// ~4%–46%). Paired with PARTLY_CLOUDY_STARS at the dark call site
// (unchanged, kept, stars visible between the clouds).
// 2026-07-22 FOURTH pass — visibility repair: size ×1.5 (recovers the
// CLOUD_CANVAS_PAD-induced shrink — the THIRD pass's visible radius fell to
// ~31% of nominal size, per the arithmetic proof this pass starts from).
// opacityBase/opacityVar raised ~31%/29% (dark 0.16→0.21, light 0.11→0.14;
// opacityVar 0.07→0.09, 0.04→0.05) — dark stays inside the existing
// 0.16–0.25 target band. coreHold 0.45→0.54 (ratio/feather 0.5→0.6, ramp
// still a comfortable ≈0.16 of the bbox — see the regression test below)
// and coreOpacityFactor 0.85→0.92 make the core hold denser for longer
// before the fade begins. Cluster count (4) and yBase/yRange (4/42, "upper-
// to-middle") are unchanged — already inside spec's "3–4 clusters" target.
const SOFT_CLOUD_PARTLY_CLOUDY: SoftCloudShape = {
  durationBaseMs: 13000, durationVarMs: 8000,
  sizeWBase: 240, sizeWVar: 120,
  sizeHBase: 150, sizeHVar: 75,
  driftFactor: 0.20,
  feather: 0.90,
  coreHold: 0.54,
  coreOpacityFactor: 0.92,
  yBase: 4, yRange: 42,
  opacityBase: { dark: 0.21, light: 0.14 },
  opacityVar: { dark: 0.09, light: 0.05 },
};

/**
 * Pure "combined density" helper (layer count × peak opacity) — lets tests
 * assert the visual-weight ordering (overcast heaviest, then fog, then
 * partly_cloudy) directly, without decoding SVG internals or evaluating a
 * Reanimated worklet. Exported (additive).
 */
export function softCloudDensityFor(condition: SoftCloudCondition, mode: 'dark' | 'light'): number {
  const shape =
    condition === 'fog' ? SOFT_CLOUD_FOG : condition === 'overcast' ? SOFT_CLOUD_OVERCAST : SOFT_CLOUD_PARTLY_CLOUDY;
  // Lazily reads softCloudNodesFor/its node-set constants further down this
  // file — safe: this function body only runs when CALLED, by which point
  // the whole module (every `const` below) has finished initialising.
  return softCloudNodesFor(condition).length * shape.opacityBase[mode];
}

/** True (and narrows) for exactly the 3 conditions that route through SoftCloudCluster/FogBank — every other condition (including undefined/null) keeps its original MistBand/HazeBand treatment. */
export function isSoftCloudCondition(
  condition: WeatherCondition | null | undefined,
): condition is SoftCloudCondition {
  return condition === 'fog' || condition === 'overcast' || condition === 'partly_cloudy';
}

/**
 * Resolves the SoftCloudCluster/FogBank params for one of the 3 swapped
 * conditions, in either mode. Exported (additive) for pure, parameter-level
 * test coverage — proves fog/overcast/partly_cloudy are measurably distinct
 * (layer count is proven separately via softCloudNodesFor's array lengths)
 * without needing to evaluate any Reanimated worklet or decode SVG props.
 */
export function softCloudParamsFor(condition: SoftCloudCondition, mode: 'dark' | 'light'): SoftCloudParams {
  const shape =
    condition === 'fog' ? SOFT_CLOUD_FOG : condition === 'overcast' ? SOFT_CLOUD_OVERCAST : SOFT_CLOUD_PARTLY_CLOUDY;
  return {
    durationBaseMs: shape.durationBaseMs,
    durationVarMs: shape.durationVarMs,
    opacityBase: shape.opacityBase[mode],
    opacityVar: shape.opacityVar[mode],
    sizeWBase: shape.sizeWBase,
    sizeWVar: shape.sizeWVar,
    sizeHBase: shape.sizeHBase,
    sizeHVar: shape.sizeHVar,
    driftFactor: shape.driftFactor,
    feather: shape.feather,
    coreHold: shape.coreHold,
    coreOpacityFactor: shape.coreOpacityFactor,
    yBase: shape.yBase,
    yRange: shape.yRange,
    rgb: SOFT_CLOUD_RGB[condition][mode],
  };
}

/**
 * Overcast-only "depth tier" multiplier applied to a whole cluster's opacity
 * (2026-07-22 second pass) — gives at least two DISTINCT visual layers (some
 * clusters read as nearer/denser, some further back/fainter) rather than one
 * flat wash of identical clouds, per Liam's "layered depth using at least
 * two distinct opacity levels" spec for overcast specifically. Deterministic
 * (alternates on the cluster's own render index — never Math.random).
 * Partly cloudy intentionally returns a constant 1 (its own 4 clusters are
 * already few/separated enough not to need this); fog doesn't use this at
 * all (FogBank has its own per-lobe opacityFactor instead — see
 * FOG_LOBE_OFFSETS). Exported (additive) for pure, parameter-level test
 * coverage of the "at least two distinct levels" requirement.
 */
export function clusterDepthFactorFor(condition: 'overcast' | 'partly_cloudy', index: number): number {
  if (condition !== 'overcast') return 1;
  return index % 2 === 0 ? 1 : 0.72;
}

/**
 * Overcast-only deterministic placement (2026-07-22 THIRD pass — layering
 * repair). Liam's device verdict: overcast "still reads as one broad grey
 * sheet in the upper area... needs to become layered", DESPITE already
 * having 6 clusters and 2 depth/opacity tiers (clusterDepthFactorFor). Root
 * cause, verified against the exact seed (SOFT_CLOUD_OVERCAST_NODES): the 6
 * raw `node.y` draws all land inside a narrow ~0.165–0.437 band (→ ~14–31%
 * of the screen once run through the shared yBase/yRange), and two pairs of
 * `node.x` draws sit within a few percent of each other (~0.17–0.19 and
 * ~0.86–0.90) — six large, similarly-sized masses stacked in one tight
 * horizontal+vertical zone, heavily overlapping, reads as ONE sheet no
 * matter how each individual cluster's own feathering is tuned; this is a
 * placement problem, not a per-cluster rendering defect (overcast's own
 * gradient math was already safe, see file header).
 *
 * This function REPLACES the raw node.x/node.y placement for overcast ONLY
 * (fog and partly_cloudy keep their original seededNodes-driven placement
 * unchanged — partly_cloudy's own 4 positions are already well-spread; see
 * the call site) with an EXPLICIT scheme:
 *   - xPercent: one evenly-spaced horizontal SLOT per instance
 *     ((index+0.5)/count), nudged by a small node.x-derived jitter that can
 *     never push it into a neighbouring slot — GUARANTEES staggered spread
 *     instead of leaving it to that one seed's draw.
 *   - yBase/yRange: alternates between TWO DISTINCT vertical bands, tied 1:1
 *     to clusterDepthFactorFor's existing near/far split (even index,
 *     opacity 1.0 = nearer/denser → the wider, LOWER-reaching band; odd
 *     index, opacity 0.72 = further/fainter → a narrower, upper-only band).
 *     Both bands overlap only in the topmost region (heaviest coverage,
 *     "heavier in the upper half"), only the near tier reaches the middle
 *     ("lighter presence through the middle"), and neither reaches below
 *     60% ("lower screen comparatively clearer") — per Liam's spec.
 * `node.y` (unchanged, still the same per-instance value) continues to be
 * used as the jitter WITHIN whichever band this instance lands in, so
 * placement stays fully deterministic — no Math.random, no new seed/entropy
 * source, just an explicit structure imposed on the existing seeded values.
 */
export interface OvercastLayout {
  xPercent: number;
  yBase: number;
  yRange: number;
}

export function overcastClusterLayout(node: SeededNode, index: number, count: number): OvercastLayout {
  const slot = (index + 0.5) / count;
  const jitter = (node.x - 0.5) * (0.6 / count); // stays inside its own slot
  const xPercent = (slot + jitter) * 100;
  const near = index % 2 === 0; // matches clusterDepthFactorFor's even/odd split
  return near ? { xPercent, yBase: 10, yRange: 50 } : { xPercent, yBase: 2, yRange: 24 };
}

// ── Puff/lobe offset tables (fixed, deterministic — NEVER Math.random) ─────
// Each entry is a fraction of the CONTAINING cluster/bank's own half-width/
// half-height (dx/dy = centre offset, w/h = radius), so the whole shape
// scales naturally with that instance's seeded `node.r`-derived bounding box
// — no new randomness, no per-instance reseed, just a fixed geometric
// recipe reused by every cluster/bank of that kind.
interface ShapeOffset {
  dx: number;
  dy: number;
  w: number;
  h: number;
  /** Multiplies the shared gradient's opacity for JUST this puff/lobe (an SVG shape-level `opacity`, not a new gradient) — this is what gives a single cluster/bank internal layered depth without needing N separate gradient defs. */
  opacityFactor: number;
}

// SoftCloudCluster: 5 puffs — one full-size "core" puff at the centre plus 4
// smaller ones offset diagonally around it at varied sizes, so the outline
// is lumpy/irregular (a cloud silhouette) instead of one smooth oval. Core
// puff carries full opacity; the 4 satellite puffs step down in two pairs
// (0.82, then 0.62) for a naturally layered look even within one cluster.
const CLUSTER_PUFF_OFFSETS: readonly ShapeOffset[] = [
  { dx: 0, dy: 0, w: 1.0, h: 1.0, opacityFactor: 1.0 },
  { dx: -0.34, dy: 0.12, w: 0.6, h: 0.68, opacityFactor: 0.82 },
  { dx: 0.32, dy: 0.1, w: 0.64, h: 0.7, opacityFactor: 0.82 },
  { dx: -0.12, dy: -0.28, w: 0.46, h: 0.5, opacityFactor: 0.62 },
  { dx: 0.18, dy: -0.24, w: 0.42, h: 0.46, opacityFactor: 0.62 },
] as const;

// FogBank: 3 lobes, each STRETCHED horizontally (w ≫ h, "rx ≫ ry") rather
// than roughly circular like a cluster puff — this is the structural
// difference from SoftCloudCluster, not just a parameter change. Widths/
// opacities/offsets all differ per lobe so density varies irregularly along
// the bank's length, and both ends (the outermost lobes' feathered edges)
// fade fully to transparent — never a uniform oval, never a solid rounded
// rectangle.
const FOG_LOBE_OFFSETS: readonly ShapeOffset[] = [
  { dx: -0.12, dy: 0, w: 0.52, h: 0.3, opacityFactor: 1.0 },
  { dx: 0.3, dy: 0.1, w: 0.4, h: 0.22, opacityFactor: 0.68 },
  { dx: -0.04, dy: -0.12, w: 0.34, h: 0.18, opacityFactor: 0.5 },
] as const;

// ── Structural hard-edge fix (2026-07-22 THIRD pass) — see the file-header
// note above for the full arithmetic proof. Two independent constants:
//   GRADIENT_ZERO_TARGET — where (bbox-distance from centre, as a fraction of
//     the puff/lobe Rect's OWN half-extent, which is always exactly 0.5 by
//     definition of objectBoundingBox) the gradient must reach zero alpha.
//     0.4 = "0.8 × the shape's own half-extent" — the headroom the brief
//     calls for, independent of any puff's own `feather`.
//   CLOUD_CANVAS_PAD — how much bigger the Svg/wrapper canvas is drawn than
//     the nominal cluster/bank box, so that even a Rect sized/positioned
//     exactly per the ORIGINAL offset table never touches the Svg's own
//     viewport edge either (belt-and-braces on top of the gradient fix).
const GRADIENT_ZERO_TARGET = 0.4;
const CLOUD_CANVAS_PAD = 1.3;

/**
 * The RadialGradient `r` (objectBoundingBox fraction, relative to the
 * INDIVIDUAL puff/lobe Rect it's painted on) that makes the gradient's own
 * zero-alpha point (at gradient-offset `feather`) land at exactly
 * GRADIENT_ZERO_TARGET, for ANY `feather` in (0, 1] — this is what "removes
 * the structural defect" rather than merely lowering opacity: the outer stop
 * is mathematically guaranteed to reach 0 at bbox-distance 0.4, a full 0.1
 * (20%) inside the Rect's own edge at 0.5. Exported (additive) so the
 * regression test can assert this numerically rather than just checking "a
 * 0-opacity stop exists somewhere".
 */
export function puffGradientRadiusFraction(feather: number): number {
  return GRADIENT_ZERO_TARGET / feather;
}

/**
 * Pure geometry helper (additive, exported for the regression test): the
 * Rect x/y/width/height (all Svg-viewport PERCENTAGES, post CLOUD_CANVAS_PAD)
 * for one puff/lobe offset. The worst case — CLUSTER_PUFF_OFFSETS[0]
 * (w=h=1.0, dx=dy=0), the puff that used to be tangent to all four Svg
 * edges — must leave visible headroom on every side; asserted directly by
 * the regression test.
 */
export function puffRectPercent(
  s: Pick<ShapeOffset, 'dx' | 'dy' | 'w' | 'h'>,
): { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } {
  const widthPercent = (s.w * 100) / CLOUD_CANVAS_PAD;
  const heightPercent = (s.h * 100) / CLOUD_CANVAS_PAD;
  const centerXPercent = 50 + (s.dx * 50) / CLOUD_CANVAS_PAD;
  const centerYPercent = 50 + (s.dy * 50) / CLOUD_CANVAS_PAD;
  return {
    xPercent: centerXPercent - widthPercent / 2,
    yPercent: centerYPercent - heightPercent / 2,
    widthPercent,
    heightPercent,
  };
}

/**
 * Shared multi-shape SVG body for both SoftCloudCluster and FogBank — ONE
 * `<Svg>` per cluster/bank instance (animation stays on the wrapper only, so
 * the animated-node budget is unchanged), but now ONE `<RadialGradient>` DEF
 * PER PUFF/LOBE (never shared) — correctness (no hard edge, ever) beats
 * def-count here, per the brief. Every puff/lobe keeps the SAME 3-stop
 * core-hold shape (peak → coreHold → exactly 0 at `feather`) proven in the
 * 2026-07-22 visibility-repair pass, with `s.opacityFactor` now PRE-BAKED
 * into that puff's own stop alphas (peak/coreHold, never the always-0 outer
 * stop) instead of an SVG shape-level `opacity` prop — see the file-header
 * note for why the shape-level prop was removed. Every puff/lobe is drawn as
 * a `<Rect>` (puffRectPercent), never an `<Ellipse>`, sized so the
 * gradient's zero-alpha point (puffGradientRadiusFraction) always lands
 * strictly inside that Rect's own edge — no edge can exist by construction,
 * for any offset in `offsets` or any `feather` this is called with.
 */
function CloudShapeBody({
  gradIdPrefix,
  rgb,
  peakOpacity,
  coreHold,
  coreOpacityFactor,
  feather,
  offsets,
  shapeTestID,
}: {
  /** Already unique per condition + per-cluster/-bank instance — see call sites. */
  gradIdPrefix: string;
  rgb: string;
  peakOpacity: number;
  coreHold: number;
  coreOpacityFactor: number;
  feather: number;
  offsets: readonly ShapeOffset[];
  shapeTestID: string;
}) {
  const coreOpacity = peakOpacity * coreOpacityFactor;
  const gradR = puffGradientRadiusFraction(feather);
  return (
    <Svg width="100%" height="100%">
      <Defs>
        {offsets.map((s, i) => (
          <RadialGradient key={i} id={`${gradIdPrefix}-${i}`} cx="50%" cy="50%" r={`${gradR * 100}%`}>
            <Stop offset={0} stopColor={`rgb(${rgb})`} stopOpacity={peakOpacity * s.opacityFactor} />
            <Stop offset={coreHold} stopColor={`rgb(${rgb})`} stopOpacity={coreOpacity * s.opacityFactor} />
            <Stop offset={feather} stopColor={`rgb(${rgb})`} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {offsets.map((s, i) => {
        const rect = puffRectPercent(s);
        return (
          <Rect
            key={i}
            testID={shapeTestID}
            x={`${rect.xPercent}%`}
            y={`${rect.yPercent}%`}
            width={`${rect.widthPercent}%`}
            height={`${rect.heightPercent}%`}
            fill={`url(#${gradIdPrefix}-${i})`}
          />
        );
      })}
    </Svg>
  );
}

/**
 * Partly cloudy / overcast: a cloud SILHOUETTE built from 5 overlapping,
 * deterministically-offset puffs (CLUSTER_PUFF_OFFSETS) inside one animated
 * bounding box — the wrapping Animated.View carries translateX (drift) +a
 * subtle scale "breathe"; the inner puffs are static (per the spec: animate
 * the bounding box, not the SVG internals). `depthFactor` (overcast only,
 * see clusterDepthFactorFor) additionally scales this WHOLE cluster's
 * opacity for cross-cluster layered depth.
 */
function SoftCloudCluster({
  node,
  index,
  animate,
  screenW,
  params,
  condition,
  depthFactor = 1,
}: {
  node: SeededNode;
  index: number;
  animate: boolean;
  screenW: number;
  params: SoftCloudParams;
  /** Unique per-condition gradient-id qualifier (2026-07-22 THIRD pass) — see file header. */
  condition: 'overcast' | 'partly_cloudy';
  depthFactor?: number;
}) {
  const t = useLoop(animate, params.durationBaseMs + node.r * params.durationVarMs, node.delay);
  const width = params.sizeWBase + node.r * params.sizeWVar;
  const height = params.sizeHBase + node.r * params.sizeHVar;
  // CLOUD_CANVAS_PAD (2026-07-22 THIRD pass): the wrapper/Svg canvas is drawn
  // bigger than the nominal design size, centred on the SAME point — see the
  // file-header note. `width`/`height` above stay the nominal (pre-pad) size
  // fed into CloudShapeBody's own puffRectPercent scaling.
  const canvasWidth = width * CLOUD_CANVAS_PAD;
  const canvasHeight = height * CLOUD_CANVAS_PAD;
  const opacity = (params.opacityBase + node.r * params.opacityVar) * depthFactor;
  const gradIdPrefix = `v2-cloud-cluster-grad-${condition}-${index}`;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [-params.driftFactor * screenW, params.driftFactor * screenW]) },
      { scale: interpolate(t.value, [0, 0.5, 1], [0.97, 1.03, 0.97]) },
    ],
  }));
  return (
    <Animated.View
      testID="v2-cloud-cluster"
      style={[
        {
          position: 'absolute',
          left: `${node.x * 100}%`,
          top: `${params.yBase + node.y * params.yRange}%`,
          width: canvasWidth,
          height: canvasHeight,
          marginLeft: -canvasWidth / 2,
          marginTop: -canvasHeight / 2,
        },
        style,
      ]}
    >
      <CloudShapeBody
        gradIdPrefix={gradIdPrefix}
        rgb={params.rgb}
        peakOpacity={opacity}
        coreHold={params.coreHold}
        coreOpacityFactor={params.coreOpacityFactor}
        feather={params.feather}
        offsets={CLUSTER_PUFF_OFFSETS}
        shapeTestID="v2-cloud-puff"
      />
    </Animated.View>
  );
}

/**
 * Fog: a long, low FOG BANK built from 3 overlapping, horizontally-stretched
 * lobes (FOG_LOBE_OFFSETS) — structurally different from SoftCloudCluster,
 * not a reused cluster: wide/flat (rx ≫ ry) lobes instead of roughly-round
 * puffs, and NO scale-breathe (fog only drifts sideways, it never subtly
 * pulses the way a cloud cluster does) — only `translateX` is animated.
 */
function FogBank({
  node,
  index,
  animate,
  screenW,
  params,
}: {
  node: SeededNode;
  index: number;
  animate: boolean;
  screenW: number;
  params: SoftCloudParams;
}) {
  const t = useLoop(animate, params.durationBaseMs + node.r * params.durationVarMs, node.delay);
  const width = params.sizeWBase + node.r * params.sizeWVar;
  const height = params.sizeHBase + node.r * params.sizeHVar;
  // See SoftCloudCluster's identical comment — same CLOUD_CANVAS_PAD fix.
  const canvasWidth = width * CLOUD_CANVAS_PAD;
  const canvasHeight = height * CLOUD_CANVAS_PAD;
  const opacity = params.opacityBase + node.r * params.opacityVar;
  const gradIdPrefix = `v2-fog-bank-grad-fog-${index}`;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-params.driftFactor * screenW, params.driftFactor * screenW]) }],
  }));
  return (
    <Animated.View
      testID="v2-fog-bank"
      style={[
        {
          position: 'absolute',
          left: `${node.x * 100}%`,
          top: `${params.yBase + node.y * params.yRange}%`,
          width: canvasWidth,
          height: canvasHeight,
          marginLeft: -canvasWidth / 2,
          marginTop: -canvasHeight / 2,
        },
        style,
      ]}
    >
      <CloudShapeBody
        gradIdPrefix={gradIdPrefix}
        rgb={params.rgb}
        peakOpacity={opacity}
        coreHold={params.coreHold}
        coreOpacityFactor={params.coreOpacityFactor}
        feather={params.feather}
        offsets={FOG_LOBE_OFFSETS}
        shapeTestID="v2-fog-lobe"
      />
    </Animated.View>
  );
}

/**
 * Shared fog/cluster render dispatch for the `isSoftCloudCondition` branch —
 * used identically by both the dark and light render blocks below (see
 * V2WeatherMotion) so the overcast layering fix can't drift between modes.
 * Resolves FogBank vs SoftCloudCluster, and for 'overcast' specifically
 * overrides x/yBase/yRange with overcastClusterLayout's explicit staggered
 * slot + depth-tier band instead of the raw seeded node position — see that
 * function's own comment for why the raw draw needed overriding. fog and
 * partly_cloudy are unaffected — their original seededNodes-driven placement
 * is untouched.
 */
function CloudOrFogNode({
  condition,
  node,
  index,
  mode,
  animate,
  screenW,
}: {
  condition: SoftCloudCondition;
  node: SeededNode;
  index: number;
  mode: 'dark' | 'light';
  animate: boolean;
  screenW: number;
}) {
  const params = softCloudParamsFor(condition, mode);
  if (condition === 'fog') {
    return <FogBank node={node} index={index} animate={animate} screenW={screenW} params={params} />;
  }
  const depthFactor = clusterDepthFactorFor(condition, index);
  if (condition === 'overcast') {
    const layout = overcastClusterLayout(node, index, softCloudNodesFor('overcast').length);
    const layoutNode: SeededNode = { ...node, x: layout.xPercent / 100 };
    const layoutParams: SoftCloudParams = { ...params, yBase: layout.yBase, yRange: layout.yRange };
    return (
      <SoftCloudCluster
        node={layoutNode}
        index={index}
        animate={animate}
        screenW={screenW}
        params={layoutParams}
        condition={condition}
        depthFactor={depthFactor}
      />
    );
  }
  return (
    <SoftCloudCluster
      node={node}
      index={index}
      animate={animate}
      screenW={screenW}
      params={params}
      condition={condition}
      depthFactor={depthFactor}
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
function Snowflake({
  node,
  animate,
  screenH,
  mode,
}: {
  node: SeededNode;
  animate: boolean;
  screenH: number;
  mode: 'dark' | 'light';
}) {
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
          backgroundColor: SNOWFLAKE_COLOR[mode],
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
// WMO 1 "mainly clear" (2026-07-19 product decision) — a "restrained cloud"
// accent, DARK ONLY (see the `mode === 'light'` early-return above: light
// never branches by weather/condition at all, per Liam's established
// ruling, so this set is simply never reached in light). Deliberately just
// 2 nodes (vs cloudy's 3 MIST nodes) reusing the EXISTING MistBand
// component/colour — the smallest honest mechanism: no new visual language,
// no palette change, just fewer of the same element so a "mostly sunny, a
// little cloud" day reads as visibly different from both full 'clear' (zero
// cloud) and 'partly_cloudy' (full cloudy atmosphere, no sun elements at
// all). Per Liam's explicit instruction, dark cloudy's EXISTING mist values
// are NOT boosted here — only this new, additive, opt-in set exists.
const MAINLY_CLEAR_MIST = seededNodes(2, 20260719, 5000);

// Dark rain split (Defect 1+3) — drizzle gets its OWN, smaller node set
// (sparse) rather than reusing STREAKS at a lower opacity, so the reduced
// density is real, not just a visual illusion from opacity alone.
const DRIZZLE_STREAKS = seededNodes(6, 20260720, 1400);

// Dark cloudy split (Defect 1+3) — partly_cloudy pairs its lighter mist
// bands with a couple of Star nodes (see the render below), so a "mixed
// sun/cloud" day reads as visibly different from a fully overcast one, not
// just a lighter grey. Independent seed — never overlaps STARS (night-only).
const PARTLY_CLOUDY_STARS = seededNodes(2, 20260722, 3000);

// Cloud-cluster/fog-bank node sets (2026-07-20 softening; counts updated
// 2026-07-22 FIRST pass for real coverage on device, updated AGAIN in this
// SECOND (shape) pass to land inside Liam's per-condition target ranges) —
// brand-new seeds, shared between dark and light (same positions/sizes in
// both modes; only SOFT_CLOUD_RGB and opacity differ per condition+mode).
// Never mutates or reuses MIST/HAZE_SUNNY/STARS/any other set above. Counts:
// fog (5, within the "4–6 wide fog banks" target), overcast (6, within
// "5–7 larger overlapping cloud groups" — still the highest per-condition
// density via softCloudDensityFor), partly_cloudy (4, within "3–4 distinct
// cloud groups", fewest, never full-width).
const SOFT_CLOUD_FOG_NODES = seededNodes(5, 202607201, 12000);
const SOFT_CLOUD_OVERCAST_NODES = seededNodes(6, 202607202, 14000);
const SOFT_CLOUD_PARTLY_CLOUDY_NODES = seededNodes(4, 202607203, 8000);

/** Resolves the seeded node set for one of the 3 cloud-cluster/fog-bank conditions. */
export function softCloudNodesFor(condition: 'fog' | 'overcast' | 'partly_cloudy'): SeededNode[] {
  switch (condition) {
    case 'fog':
      return SOFT_CLOUD_FOG_NODES;
    case 'overcast':
      return SOFT_CLOUD_OVERCAST_NODES;
    case 'partly_cloudy':
      return SOFT_CLOUD_PARTLY_CLOUDY_NODES;
  }
}

// LIGHT-ONLY node sets — brand new seeds, never overlapping or mutating any
// of the sets above (BOKEH/STREAKS/MIST/STARS/FLAKES keep driving the dark
// path exactly as before). HAZE_SUNNY/DUST_LIGHT/BOKEH drive EVERY light
// atmosphere unconditionally (unchanged); WARM_STREAKS/DUST_LIGHT_REDUCED
// are ADDITIVE, only rendered for rain-family conditions (see below) — they
// never replace or mutate the always-on baseline the existing tests pin.
const HAZE_SUNNY = seededNodes(3, 305, 12000); // 2–3 warm haze bands, every light atmosphere
// 6 (not the full 6–10 range) keeps light's total animated-node count
// (1 sun + 6 bokeh + 3 haze + 6 dust = 16) close to the file's existing
// ≤14-per-condition Android safety budget while still reading as "richer".
const DUST_LIGHT = seededNodes(6, 9111, 14000); // faint floating dust motes
// Defect 3 (light rain/drizzle motion) — a small warm-toned streak set,
// rendered ALONGSIDE (not instead of) the baseline warm ambient set.
const WARM_STREAKS = seededNodes(5, 20260720, 1200);
// Paired with WARM_STREAKS so a rain-family light render stays close to the
// ~16-node Android budget: swaps in for the full 6-node DUST_LIGHT only when
// warm streaks are also rendering (1 sun + 6 bokeh + 3 haze + 5 streak + 3
// dust = 18) — independent seed, never mutates DUST_LIGHT.
const DUST_LIGHT_REDUCED = seededNodes(3, 91112, 14000);

/**
 * Light-mode HazeBand motion tuning per condition (Defect 3) — the warm
 * palette itself NEVER changes (same HAZE_BAND_RGB), only speed/opacity/
 * thickness, exactly mirroring the dark cloudy split above. `HAZE_PARAMS_DEFAULT`
 * (fallback for no/undefined condition) reproduces HazeBand's original
 * formula exactly, so every existing test (which never passes a `condition`
 * to light) stays byte-identical.
 */
const LIGHT_HAZE_FOG: BandParams = {
  durationBaseMs: 34000, durationVarMs: 22000,
  opacityBase: 0.06, opacityVar: 0.04,
  heightBase: 90, heightVar: 70,
  driftFactor: 0.18,
};
const LIGHT_HAZE_OVERCAST: BandParams = {
  durationBaseMs: 30000, durationVarMs: 20000,
  opacityBase: 0.09, opacityVar: 0.05,
  heightBase: 85, heightVar: 65,
  driftFactor: 0.10,
};
const LIGHT_HAZE_PARTLY_CLOUDY: BandParams = {
  durationBaseMs: 16000, durationVarMs: 12000,
  opacityBase: 0.04, opacityVar: 0.03,
  heightBase: 60, heightVar: 50,
  driftFactor: 0.14,
};
const LIGHT_HAZE_RAIN: BandParams = {
  durationBaseMs: 26000, durationVarMs: 16000,
  opacityBase: 0.07, opacityVar: 0.05,
  heightBase: 75, heightVar: 55,
  driftFactor: 0.11,
};

/**
 * Resolves the light-mode HazeBand params for a fine condition (Defect 3).
 * Exported (additive) for pure, parameter-level test coverage.
 */
export function lightHazeParamsFor(condition: WeatherCondition | null | undefined): BandParams {
  switch (condition) {
    case 'fog':
      return LIGHT_HAZE_FOG;
    case 'overcast':
      return LIGHT_HAZE_OVERCAST;
    case 'partly_cloudy':
      return LIGHT_HAZE_PARTLY_CLOUDY;
    case 'drizzle':
    case 'rain':
    case 'showers':
    case 'thunderstorm':
      return LIGHT_HAZE_RAIN;
    default:
      return HAZE_PARAMS_DEFAULT;
  }
}

export function isRainFamily(condition: WeatherCondition | null | undefined): boolean {
  return condition === 'drizzle' || condition === 'rain' || condition === 'showers' || condition === 'thunderstorm';
}

export interface V2WeatherMotionProps {
  atmosphere: Atmosphere;
  /** Resolved theme mode (see hooks/useAppTheme) — drives colour-only branches below. */
  mode: 'dark' | 'light';
  /**
   * OPTIONAL, ADDITIVE (2026-07-19, extended 2026-07-20): the actual
   * resolved WeatherCondition, finer-grained than `atmosphere` (mainly_clear/
   * clear/partly_cloudy/overcast all collapse to either 'sunny' or 'cloudy'
   * at the atmosphere level — see lib/weatherTheme.ts resolveAtmosphere).
   * Drives condition-specific MOTION PARAMETERS ONLY (density/speed/
   * thickness/opacity) within the sunny/cloudy/rain atmospheres in BOTH
   * modes — never a new palette, never a new atmosphere. Omitting this prop
   * (or passing null) falls back to each atmosphere's original/generic
   * treatment, preserving prior behaviour exactly where no test or caller
   * supplies a condition.
   */
  condition?: WeatherCondition | null;
}

/**
 * Ambient motion for the v2 Home background. Renders nothing but its
 * absolute-fill container when reduced motion is on or the app is
 * backgrounded — the static V2Background gradients are the fallback look.
 */
export function V2WeatherMotion({ atmosphere, mode, condition }: V2WeatherMotionProps) {
  const reduced = useReducedMotionPref();
  const appActive = useAppActive();
  const animate = appActive && !reduced;
  const { width: screenW, height: screenH } = useWindowDimensions();

  if (!animate) return null;

  // LIGHT: the SAME warm ambient set for EVERY atmosphere (Liam's rejection
  // — device proof + reference screenshots: light must stay warm sandy
  // cream regardless of weather), now with condition-specific MOTION layered
  // on top (Defect 3, 2026-07-20) — never a new palette, never
  // MistBand/RainStreak/Snowflake/Star (all four stay cold/dark-media-only).
  // Omitting `condition` (every pre-existing test) reproduces the exact
  // prior render: HAZE_PARAMS_DEFAULT on HazeBand, no warm streaks, full
  // 6-node DUST_LIGHT.
  if (mode === 'light') {
    const hazeParams = lightHazeParamsFor(condition);
    const rainy = isRainFamily(condition);
    const dustNodes = rainy ? DUST_LIGHT_REDUCED : DUST_LIGHT;
    return (
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`v2-weather-motion-${atmosphere}`}
      >
        <SunPulseLight animate={animate} />
        {BOKEH.map((n, i) => (
          <BokehOrb key={`bokeh-${i}`} node={n} animate={animate} screenH={screenH} mode={mode} />
        ))}
        {/* Fog/overcast/partly_cloudy (2026-07-20 softening, reshaped
            2026-07-22 second/third passes): swap the solid-fill HazeBand for
            recognisable cloud FORMS via the shared CloudOrFogNode dispatch
            (FogBank for fog, SoftCloudCluster for overcast/partly_cloudy,
            overcast additionally re-laid-out per overcastClusterLayout).
            Every other condition (undefined/clear/mainly_clear/rain-family/
            snow) keeps the original HazeBand + lightHazeParamsFor tuning,
            unchanged. */}
        {isSoftCloudCondition(condition)
          ? softCloudNodesFor(condition).map((n, i) => (
              <CloudOrFogNode
                key={`cloud-fog-${i}`}
                condition={condition}
                node={n}
                index={i}
                mode={mode}
                animate={animate}
                screenW={screenW}
              />
            ))
          : HAZE_SUNNY.map((n, i) => (
              <HazeBand key={`haze-${i}`} node={n} index={i} animate={animate} screenW={screenW} params={hazeParams} />
            ))}
        {/* Rain/drizzle/showers/thunderstorm ONLY: warm-toned falling
            streaks (never RainStreak/RAIN_STREAK_RGB) alongside a reduced
            dust-mote count so this stays close to the ~16-node budget. */}
        {rainy &&
          WARM_STREAKS.map((n, i) => (
            <WarmStreak key={`warm-streak-${i}`} node={n} animate={animate} screenH={screenH} />
          ))}
        {dustNodes.map((n, i) => (
          <DustMote key={`dust-${i}`} node={n} index={i} animate={animate} screenH={screenH} />
        ))}
      </View>
    );
  }

  // DARK: sunny/night/snow stay byte-identical to the accepted, frozen dark
  // render (same components/props/conditions as before any light-theme work
  // touched this file). rain/cloudy now vary MOTION PARAMETERS ONLY by the
  // fine `condition` (Defect 1+3, 2026-07-20) — same RAIN_STREAK_RGB/
  // MIST_BAND_RGB colours, same components, just different density/speed/
  // opacity/thickness. Omitting `condition` resolves to each atmosphere's
  // original formula (darkRainParamsFor/darkMistParamsFor's `default` case),
  // so every pre-existing test (which never passes a condition to plain
  // 'rain'/'cloudy') stays byte-identical. Never reads a light-only
  // component or seed set.
  const rainParams = darkRainParamsFor(condition);
  const rainNodes = condition === 'drizzle' ? DRIZZLE_STREAKS : STREAKS;
  const mistParams = darkMistParamsFor(condition);

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
            <BokehOrb key={i} node={n} animate={animate} screenH={screenH} mode={mode} />
          ))}
          {/* WMO 1 "mainly clear" restrained-cloud accent — see MAINLY_CLEAR_MIST
              above. Reuses the existing MistBand component/colour verbatim,
              PRESERVED exactly (MIST_PARAMS_LEGACY, not the Defect 1 boosted
              default) — Liam's spec explicitly says keep this one as-is. */}
          {condition === 'mainly_clear' &&
            MAINLY_CLEAR_MIST.map((n, i) => (
              <MistBand key={`mainly-clear-mist-${i}`} node={n} animate={animate} screenW={screenW} mode={mode} />
            ))}
        </>
      )}

      {atmosphere === 'rain' && (
        // Slight 11° tilt so streaks read as wind-blown rain (per the
        // handoff spec's rain container), applied to the field not the nodes.
        // Drizzle: sparse/thin/slow/light (DRIZZLE_STREAKS + RAIN_PARAMS_DRIZZLE).
        // rain/showers/thunderstorm/undefined: dense (STREAKS + RAIN_PARAMS_RAIN,
        // the original formula).
        <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: '11deg' }] }]}>
          {rainNodes.map((n, i) => (
            <RainStreak key={i} node={n} animate={animate} screenH={screenH} mode={mode} params={rainParams} />
          ))}
        </View>
      )}

      {atmosphere === 'cloudy' && (
        <>
          {/* Fog/overcast/partly_cloudy (2026-07-20 softening, reshaped
              2026-07-22 second/third passes): swap the solid-fill MistBand
              for recognisable cloud FORMS via the shared CloudOrFogNode
              dispatch (FogBank for fog, SoftCloudCluster for overcast/
              partly_cloudy, overcast additionally re-laid-out per
              overcastClusterLayout). The generic/no-condition cloudy default
              (and mainly_clear's dark accent under the sunny atmosphere,
              below) keep rendering MistBand unchanged. */}
          {isSoftCloudCondition(condition)
            ? softCloudNodesFor(condition).map((n, i) => (
                <CloudOrFogNode
                  key={`cloud-fog-${i}`}
                  condition={condition}
                  node={n}
                  index={i}
                  mode={mode}
                  animate={animate}
                  screenW={screenW}
                />
              ))
            : MIST.map((n, i) => (
                <MistBand key={i} node={n} animate={animate} screenW={screenW} mode={mode} params={mistParams} />
              ))}
          {/* Partly cloudy: a couple of Star nodes alongside the lighter
              cloud layer, so "mixed sun/cloud" reads as visibly different
              from a fully overcast sky, not just a lighter grey. */}
          {condition === 'partly_cloudy' &&
            PARTLY_CLOUDY_STARS.map((n, i) => <Star key={`partly-cloudy-star-${i}`} node={n} animate={animate} />)}
        </>
      )}

      {atmosphere === 'night' && STARS.map((n, i) => <Star key={i} node={n} animate={animate} />)}

      {atmosphere === 'snow' &&
        FLAKES.map((n, i) => <Snowflake key={i} node={n} animate={animate} screenH={screenH} mode={mode} />)}
    </View>
  );
}
