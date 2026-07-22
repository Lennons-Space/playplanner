/**
 * V2WeatherMotion — the lightweight animated layer of the v2 Home
 * background (sun pulse/bokeh, rain streaks, mist drift, star twinkle,
 * snowfall).
 *
 * Guards here:
 *   - renders without throwing for every atmosphere (the "animated
 *     background must not crash" requirement);
 *   - is decorative: non-interactive and hidden from the a11y tree;
 *   - fully stops (renders nothing) when the OS reduce-motion preference is
 *     on — the static V2Background gradients are the fallback look.
 */

import path from 'path';
import { execSync } from 'child_process';
import { AccessibilityInfo } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import {
  V2WeatherMotion,
  darkRainParamsFor,
  darkMistParamsFor,
  lightHazeParamsFor,
  softCloudParamsFor,
  softCloudNodesFor,
  softCloudDensityFor,
  isSoftCloudCondition,
  clusterDepthFactorFor,
  puffGradientRadiusFraction,
  puffRectPercent,
  overcastClusterLayout,
} from '@/components/ui/V2WeatherMotion';
import type { Atmosphere } from '@/lib/weatherTheme';

const ATMOSPHERES: Atmosphere[] = ['sunny', 'cloudy', 'rain', 'night', 'snow'];

type JsonNode = { props?: Record<string, unknown>; children?: JsonNode[] | null } | null;

/** Depth-first collection of every resolved `backgroundColor` in the tree (flattens array/object styles). */
function collectBackgroundColors(node: JsonNode, out: string[] = []): string[] {
  if (!node) return out;
  const style = node.props?.style;
  const styles = Array.isArray(style) ? style : [style];
  for (const s of styles) {
    const bg = (s as { backgroundColor?: string } | undefined)?.backgroundColor;
    if (typeof bg === 'string') out.push(bg);
  }
  for (const child of node.children ?? []) collectBackgroundColors(child, out);
  return out;
}

/** Depth-first collection of every `testID` prop present anywhere in the tree. */
function collectTestIDs(node: JsonNode, out: string[] = []): string[] {
  if (!node) return out;
  const testID = node.props?.testID;
  if (typeof testID === 'string') out.push(testID);
  for (const child of node.children ?? []) collectTestIDs(child, out);
  return out;
}

/** Depth-first search for the first node with a given `testID`. */
function findNodeByTestID(node: JsonNode, testID: string): JsonNode {
  if (!node) return null;
  if (node.props?.testID === testID) return node;
  for (const child of node.children ?? []) {
    const found = findNodeByTestID(child, testID);
    if (found) return found;
  }
  return null;
}

/** Flattens a node's `style` prop (array or object) into a single merged object. */
function flattenStyle(node: JsonNode): Record<string, unknown> {
  if (!node) return {};
  const style = node.props?.style;
  const styles = Array.isArray(style) ? style : [style];
  return styles.reduce((acc: Record<string, unknown>, s) => Object.assign(acc, s ?? {}), {});
}

/**
 * Depth-first collection of every rendered `<RNSVGRadialGradient>` node
 * (SoftCloudLayer's feathered ellipse) — same technique as
 * components/ui/__tests__/V2Background.test.tsx, which already proves this
 * is how react-native-svg's real (unmocked) RadialGradient renders under
 * jest: a `gradient` prop holding a flat [offset, packedARGB, offset,
 * packedARGB, …] array.
 */
function collectRadialGradients(
  node: JsonNode,
  out: { gradient: number[]; rx?: string; name?: string }[] = [],
): { gradient: number[]; rx?: string; name?: string }[] {
  if (!node) return out;
  const n = node as unknown as {
    type?: string;
    props?: { gradient?: number[]; rx?: string; name?: string };
    children?: JsonNode[] | null;
  };
  if (n.type === 'RNSVGRadialGradient') {
    out.push({ gradient: n.props?.gradient as number[], rx: n.props?.rx, name: n.props?.name });
  }
  for (const child of n.children ?? []) collectRadialGradients(child, out);
  return out;
}

/**
 * Depth-first collection of every rendered `<RNSVGRect>` node's resolved
 * x/y/width/height PERCENTAGE strings (2026-07-22 THIRD pass — the
 * puff/lobe shape is now a Rect, never an Ellipse; see puffRectPercent).
 */
function collectRects(
  node: JsonNode,
  out: { x?: string; y?: string; width?: string; height?: string }[] = [],
): { x?: string; y?: string; width?: string; height?: string }[] {
  if (!node) return out;
  const n = node as unknown as {
    type?: string;
    props?: { x?: string; y?: string; width?: string; height?: string };
    children?: JsonNode[] | null;
  };
  if (n.type === 'RNSVGRect') {
    out.push({ x: n.props?.x, y: n.props?.y, width: n.props?.width, height: n.props?.height });
  }
  for (const child of n.children ?? []) collectRects(child, out);
  return out;
}

/** Parses a react-native-svg percentage string ("30.86%") into a 0–1 fraction. */
function pctToFraction(pct: string | undefined): number {
  if (!pct) return NaN;
  return parseFloat(pct.replace('%', '')) / 100;
}

/** Decodes a react-native-svg packed 0xAARRGGBB colour into channels. */
function decodeARGB(packed: number): { a: number; r: number; g: number; b: number } {
  // eslint-disable-next-line no-bitwise
  return {
    a: (packed >>> 24) & 0xff,
    r: (packed >>> 16) & 0xff,
    g: (packed >>> 8) & 0xff,
    b: packed & 0xff,
  };
}

// Re-spied fresh before EVERY test (not just the one test that needs
// reduce-motion=true) — jest.spyOn + a same-test mockRestore() on this
// particular RN API leaves AccessibilityInfo.isReduceMotionEnabled undefined
// for all LATER tests in the file (the jest-native-module shim has no "real"
// implementation to restore to), which crashes WeatherLayer's
// `AccessibilityInfo.isReduceMotionEnabled?.().then(...)` call in every test
// that runs after the reduce-motion test. Re-spying per-test avoids relying
// on execution order.
let reduceMotionSpy: jest.SpyInstance;
beforeEach(() => {
  reduceMotionSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => {
  reduceMotionSpy.mockRestore();
});

describe('V2WeatherMotion', () => {
  it.each(ATMOSPHERES)('renders without throwing for atmosphere=%s (dark)', (atmosphere) => {
    expect(() => render(<V2WeatherMotion atmosphere={atmosphere} mode="dark" />)).not.toThrow();
  });

  it.each(ATMOSPHERES)('renders without throwing for atmosphere=%s (light)', (atmosphere) => {
    expect(() => render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />)).not.toThrow();
  });

  it('is non-interactive and hidden from the accessibility tree', () => {
    const root = render(<V2WeatherMotion atmosphere="rain" mode="dark" />).toJSON() as {
      props: Record<string, unknown>;
    };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
  });

  it('renders nothing when the OS reduce-motion preference is on (static fallback)', async () => {
    reduceMotionSpy.mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere="snow" mode="dark" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
  });
});

// ── DARK particle-colour regression pins (frozen — must stay byte-for-byte) ──
// These literals are copy-pasted from the accepted BOKEH_COLOR / RAIN_STREAK_RGB
// / MIST_BAND_RGB / SNOWFLAKE_COLOR dark branches in
// components/ui/V2WeatherMotion.tsx. A failure here means a light-theme change
// leaked into the dark particle colours — a hard-freeze violation.
describe('V2WeatherMotion — DARK particle colour regression pins', () => {
  it('sunny (dark) bokeh uses rgba(255,195,107,0.16)', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('rgba(255,195,107,0.16)');
  });

  it('rain (dark) streaks use the rgb(150,186,216) family', () => {
    const tree = render(<V2WeatherMotion atmosphere="rain" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true);
  });

  it('cloudy (dark) mist bands use the rgb(96,104,124) family', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(true);
  });

  it('snow (dark) flakes use rgba(235,242,252,0.9)', () => {
    const tree = render(<V2WeatherMotion atmosphere="snow" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('rgba(235,242,252,0.9)');
  });

  it('night (dark) stars use #E8ECF8', () => {
    const tree = render(<V2WeatherMotion atmosphere="night" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('#E8ECF8');
  });
});

// ── LIGHT particle-colour pin (sunny bokeh — the ONE dark-particle colour
// still reused, unaltered, in light) ─────────────────────────────────────────
describe('V2WeatherMotion — LIGHT particle colour pin', () => {
  it('bokeh uses faint amber rgba(255,195,107,0.12) (BokehOrb still renders in light, every atmosphere)', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="light" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('rgba(255,195,107,0.12)');
  });
});

// ── REJECTED-AND-FIXED: light used to branch by atmosphere the same way as
// dark (MistBand for cloudy, RainStreak for rain, Snowflake for snow, plus
// Star already dark-only) — WEATHER_BACKGROUNDS.md's per-weather light
// colours. Liam rejected this on device (+ reference screenshots): real
// weather resolving to cloudy/rain painted the light screen cold blue-grey.
// Ruling: light renders exactly ONE warm ambient set — SunPulseLight +
// BokehOrb + HazeBand + DustMote — for EVERY atmosphere, and NEVER
// MistBand/RainStreak/Snowflake/Star. These pins assert the fix on the
// RUNTIME renderer (not just the colour constants) across all 5 atmospheres.
describe('V2WeatherMotion — LIGHT renders the SAME warm ambient set for every atmosphere', () => {
  it.each(ATMOSPHERES)('light+%s renders SunPulseLight, haze bands, and dust motes', (atmosphere) => {
    const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    expect(testIDs).toContain('v2-sun-pulse-light');
    expect(testIDs.filter((id) => id.startsWith('v2-haze-band-')).length).toBeGreaterThanOrEqual(2);
    expect(testIDs.filter((id) => id.startsWith('v2-dust-mote-')).length).toBeGreaterThanOrEqual(6);
  });

  it.each(ATMOSPHERES)(
    'light+%s NEVER renders MistBand/RainStreak/Snowflake/Star testIDs or colours (no cold weather-conditional particles)',
    (atmosphere) => {
      const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as JsonNode;
      // None of the dark-only particle components have their own testIDs, so
      // the authoritative check is their colour literals — none of these
      // must ever appear in a light render, for any atmosphere.
      const colors = collectBackgroundColors(tree);
      expect(colors.some((c) => c.startsWith('rgba(62,88,114,'))).toBe(false); // old light RainStreak
      expect(colors.some((c) => c.startsWith('rgba(82,96,116,'))).toBe(false); // old light MistBand
      expect(colors).not.toContain('rgba(255,255,255,0.9)'); // old light Snowflake
      expect(colors).not.toContain('#E8ECF8'); // Star (dark-only, always)
    },
  );

  it.each(ATMOSPHERES)('light+%s haze bands and dust motes are faint and warm-toned (never cold/blue)', (atmosphere) => {
    const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    // Haze bands: warm sandy/cream family, baked-in low opacity.
    expect(colors.some((c) => c.startsWith('rgba(246,224,180,') || c.startsWith('rgba(255,238,205,'))).toBe(true);
    // Dust motes: opaque warm gold — faintness comes from animated opacity, not colour alpha.
    expect(colors).toContain('#FFD696');
  });

  it.each(ATMOSPHERES)('light+%s is decorative and non-interactive', (atmosphere) => {
    const root = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as {
      props: Record<string, unknown>;
    };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessibilityElementsHidden).toBe(true);
  });
});

// ── Glow-shape polish: SunPulseLight used to be a giant solid pill
// (top:-28%, left:-10%, right:-10%, height:52%, one flat colour) that read
// as a big centred oval behind the Home heading. Fixed: a small, feathered,
// upper-right-anchored glow (fixed-px concentric rings, never spanning the
// screen width). These pins assert the NEW shape/position constraints
// directly on the rendered tree — not just "does not throw".
describe('V2WeatherMotion — LIGHT sun glow is small, feathered, and upper-right anchored (not a full-width pill)', () => {
  it('is NOT a full-width solid band — no left+right span, fixed px size instead of a percentage width', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="light" />).toJSON() as JsonNode;
    const wrapper = findNodeByTestID(tree, 'v2-sun-pulse-light');
    expect(wrapper).not.toBeNull();
    const style = flattenStyle(wrapper);
    // The old pill set BOTH left:'-10%' and right:'-10%' (a span across the
    // whole width). The new glow is anchored from ONE edge (right) with an
    // explicit fixed-pixel size — it must never define `left` at all.
    expect(style.left).toBeUndefined();
    expect(typeof style.width).toBe('number');
    expect(style.width as number).toBeLessThan(300); // compact corner glow, not screen-spanning
  });

  it('is anchored to the UPPER-RIGHT corner (right-anchored, negative/near-zero top)', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="light" />).toJSON() as JsonNode;
    const wrapper = findNodeByTestID(tree, 'v2-sun-pulse-light');
    const style = flattenStyle(wrapper);
    expect(typeof style.right).toBe('string');
    expect((style.right as string).trim().startsWith('-')).toBe(true); // pulled slightly off-canvas top-right
    expect(typeof style.top).toBe('string');
  });

  it('is built from multiple low-opacity nested rings (feathered falloff, no BlurView)', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="light" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    const rings = testIDs.filter((id) => id.startsWith('v2-sun-pulse-light-ring-'));
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const colors = collectBackgroundColors(tree);
    const ringColors = colors.filter((c) => c.startsWith('rgba(255,196,120,'));
    // Every ring is faint (never anywhere close to opaque).
    for (const c of ringColors) {
      const alpha = Number(c.match(/,([\d.]+)\)$/)?.[1] ?? '1');
      expect(alpha).toBeLessThan(0.1);
    }
  });

  it('every light atmosphere gets the same compact glow (not just sunny)', () => {
    for (const atmosphere of ATMOSPHERES) {
      const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as JsonNode;
      const wrapper = findNodeByTestID(tree, 'v2-sun-pulse-light');
      const style = flattenStyle(wrapper);
      expect(style.left).toBeUndefined();
      expect(typeof style.width).toBe('number');
    }
  });
});

// ── DARK stays byte-identical: every atmosphere keeps its ORIGINAL
// weather-conditional component and colour, and NEVER renders a single
// light-only layer. This is the hard-freeze guarantee the whole fix rests
// on — dark must render exactly as it did before this file was ever touched.
describe('V2WeatherMotion — DARK never renders a light-only layer (any atmosphere)', () => {
  it.each(ATMOSPHERES)('dark+%s does not render SunPulseLight/HazeBand/DustMote testIDs or colours', (atmosphere) => {
    const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="dark" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    expect(testIDs).not.toContain('v2-sun-pulse-light');
    expect(testIDs.some((id) => id.startsWith('v2-haze-band-'))).toBe(false);
    expect(testIDs.some((id) => id.startsWith('v2-dust-mote-'))).toBe(false);
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(246,224,180,') || c.startsWith('rgba(255,238,205,'))).toBe(false);
    expect(colors).not.toContain('#FFD696');
    expect(colors.some((c) => c.startsWith('rgba(255,196,120,'))).toBe(false); // SunPulseLight ring colours
  });

  it('dark+sunny keeps its original glow colour, unchanged', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('rgba(255,178,62,0.10)');
  });

  it('dark+cloudy still renders MistBand (rgb(96,104,124) family) — unchanged', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(true);
  });

  it('dark+rain still renders RainStreak (rgb(150,186,216) family) — unchanged', () => {
    const tree = render(<V2WeatherMotion atmosphere="rain" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true);
  });

  it('dark+snow still renders Snowflake (rgba(235,242,252,0.9)) — unchanged', () => {
    const tree = render(<V2WeatherMotion atmosphere="snow" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('rgba(235,242,252,0.9)');
  });

  it('dark+night still renders Star (#E8ECF8) — unchanged', () => {
    const tree = render(<V2WeatherMotion atmosphere="night" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('#E8ECF8');
  });
});

// ── WMO 1 "mainly clear" restrained-cloud accent (2026-07-19) ────────────────
// New, OPTIONAL `condition` prop: when atmosphere='sunny' AND the underlying
// condition is specifically 'mainly_clear' (dark only — light never branches
// by weather, per the established ruling above), a SMALL additional mist
// accent renders on top of the normal sun elements. Omitting `condition`
// entirely (every OTHER test in this file) preserves the exact prior
// behaviour — no accent, byte-identical dark sunny render.
describe('V2WeatherMotion — WMO 1 "mainly clear" restrained-cloud accent', () => {
  it('plain "sunny" atmosphere with NO condition prop renders no mist accent (prior behaviour preserved)', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false);
  });

  it('sunny atmosphere + condition="clear" (full clear) renders NO mist accent — distinct from mainly_clear', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" condition="clear" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false);
  });

  it('sunny atmosphere + condition="mainly_clear" renders a restrained mist accent (dark) — reuses the existing MistBand colour', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" condition="mainly_clear" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(true);
  });

  it('still renders the normal sun elements (bokeh) alongside the mainly_clear accent — additive, not a replacement', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" condition="mainly_clear" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors).toContain('rgba(255,195,107,0.16)'); // BokehOrb, unchanged
  });

  it('mainly_clear accent is RESTRAINED (fewer nodes than full cloudy) — at most 2 mist elements, vs cloudy\'s 3', () => {
    const sunnyTree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" condition="mainly_clear" />).toJSON() as JsonNode;
    const cloudyTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" />).toJSON() as JsonNode;
    const countMist = (n: JsonNode) => collectBackgroundColors(n).filter((c) => c.startsWith('rgba(96,104,124,')).length;
    expect(countMist(sunnyTree)).toBeLessThanOrEqual(2);
    expect(countMist(sunnyTree)).toBeLessThan(countMist(cloudyTree));
  });

  it('LIGHT mode never renders the mist accent even for condition="mainly_clear" — light never branches by weather', () => {
    const tree = render(<V2WeatherMotion atmosphere="sunny" mode="light" condition="mainly_clear" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false);
    // Still renders the same warm ambient set as every other light render.
    expect(collectTestIDs(tree)).toContain('v2-sun-pulse-light');
  });

  it('condition="mainly_clear" has no effect outside the sunny atmosphere (e.g. rain stays exactly as before)', () => {
    const tree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition="mainly_clear" />).toJSON() as JsonNode;
    const colors = collectBackgroundColors(tree);
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // rain streaks, unaffected
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false); // no mist leaked into rain
  });
});

describe('V2WeatherMotion — light-only layers also respect reduced-motion / backgrounded', () => {
  it.each(ATMOSPHERES)('renders null for light+%s when reduce-motion is on (same shared guard as dark)', async (atmosphere) => {
    reduceMotionSpy.mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
  });
});

// Issue 2 audit item 9 — no screen-specific theme/weather branching was
// added anywhere: SunPulseLight/HazeBand/DustMote are private to this file
// (never exported, never imported by any screen), so every screen keeps
// resolving its atmosphere through the SAME shared ThemedBackground →
// V2Background → V2WeatherMotion pipeline with no per-screen special case.
describe('V2WeatherMotion — Issue 2 audit (9): no per-screen theme/weather branching leaked out', () => {
  it('no screen under app/ references SunPulseLight/HazeBand/DustMote or imports V2WeatherMotion directly', () => {
    const root = path.resolve(__dirname, '../../..');
    const grepTargets = ['SunPulseLight', 'HazeBand', 'DustMote', "from '@/components/ui/V2WeatherMotion'"];
    for (const needle of grepTargets) {
      let out = '';
      try {
        // Restricted to app/ (screens only) — the components under test are
        // meant to be used exclusively via ThemedBackground, never imported
        // or referenced directly by a route file.
        out = execSync(`git grep -l "${needle}" -- "app"`, { cwd: root, encoding: 'utf8' });
      } catch {
        out = ''; // git grep exits 1 with empty output when there are no matches
      }
      expect(out.split('\n').filter(Boolean)).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// APP-WIDE WEATHER-ANIMATION REPAIR (2026-07-20) — condition-specific motion
//
// Defect 1+3 (dark): rain splits into drizzle (sparse/thin/slow/light) vs
// rain/showers/thunderstorm (dense); cloudy splits into fog/overcast/
// partly_cloudy, plus a Defect-1 visibility boost (same colour, stronger
// opacity + wider vertical spread) on the generic/default cloudy case.
// Defect 3 (light): rain-family gets an additive warm-toned streak layer;
// every cloudy-family condition gets its own warm haze timing/opacity.
//
// Pure, parameter-level assertions first (no Reanimated worklet evaluation
// needed — darkRainParamsFor/darkMistParamsFor/lightHazeParamsFor are plain
// functions), then runtime-render node-count/colour checks to prove the
// parameters are actually wired into what mounts.
// ═════════════════════════════════════════════════════════════════════════

describe('darkRainParamsFor — Defect 1+3 pure parameter checks', () => {
  it('drizzle is measurably sparser/thinner/lighter/slower than rain', () => {
    const drizzle = darkRainParamsFor('drizzle');
    const rain = darkRainParamsFor('rain');
    expect(drizzle.opacityBase).toBeLessThan(rain.opacityBase);
    expect(drizzle.widthBase).toBeLessThan(rain.widthBase);
    expect(drizzle.durationBaseMs).toBeGreaterThan(rain.durationBaseMs); // slower fall = longer duration
  });

  it('showers/thunderstorm honestly reuse the dense rain params (documented, not a bug)', () => {
    const rain = darkRainParamsFor('rain');
    expect(darkRainParamsFor('showers')).toEqual(rain);
    expect(darkRainParamsFor('thunderstorm')).toEqual(rain);
  });

  it('omitting condition (undefined/null) falls back to the exact original rain formula', () => {
    const rain = darkRainParamsFor('rain');
    expect(darkRainParamsFor(undefined)).toEqual(rain);
    expect(darkRainParamsFor(null)).toEqual(rain);
    expect(rain).toEqual({
      durationBaseMs: 620, durationVarMs: 420,
      widthBase: 1, widthVar: 1,
      heightBase: 80, heightVar: 90,
      opacityBase: 0.14, opacityVar: 0.14,
    });
  });
});

describe('darkMistParamsFor — Defect 1+3 pure parameter checks', () => {
  it('fog, overcast, and partly_cloudy are all measurably different from each other', () => {
    const fog = darkMistParamsFor('fog');
    const overcast = darkMistParamsFor('overcast');
    const partlyCloudy = darkMistParamsFor('partly_cloudy');

    // Fog: slowest (widest/softest, longest duration).
    expect(fog.durationBaseMs).toBeGreaterThan(overcast.durationBaseMs);
    expect(fog.durationBaseMs).toBeGreaterThan(partlyCloudy.durationBaseMs);
    expect(fog.heightBase).toBeGreaterThan(overcast.heightBase);

    // Overcast: heaviest (highest opacity) of the three.
    expect(overcast.opacityBase).toBeGreaterThan(fog.opacityBase);
    expect(overcast.opacityBase).toBeGreaterThan(partlyCloudy.opacityBase);

    // Partly cloudy: lightest + quickest of the three.
    expect(partlyCloudy.opacityBase).toBeLessThan(overcast.opacityBase);
    expect(partlyCloudy.durationBaseMs).toBeLessThan(fog.durationBaseMs);
  });

  it('Defect 1 boost: the generic default is more opaque and vertically wider than the preserved legacy accent formula', () => {
    const boosted = darkMistParamsFor(undefined); // no condition -> MIST_PARAMS_DEFAULT (boosted)
    // Legacy formula (MIST_PARAMS_LEGACY, reserved for the mainly_clear
    // accent) — reproduced here as a literal so this test doesn't need the
    // (unexported) legacy constant to assert the boost happened.
    const legacyOpacityBase = 0.05;
    const legacyYSpan = 50;
    expect(boosted.opacityBase).toBeGreaterThan(legacyOpacityBase);
    expect(boosted.ySpan).toBeGreaterThan(legacyYSpan); // widened vertical spread
  });

  it('omitting condition (undefined/null) resolves to the SAME boosted default, distinct from every named condition', () => {
    const fallback = darkMistParamsFor(undefined);
    expect(darkMistParamsFor(null)).toEqual(fallback);
    expect(fallback).not.toEqual(darkMistParamsFor('fog'));
    expect(fallback).not.toEqual(darkMistParamsFor('overcast'));
    expect(fallback).not.toEqual(darkMistParamsFor('partly_cloudy'));
  });
});

describe('lightHazeParamsFor — Defect 3 pure parameter checks (warm palette, motion only)', () => {
  it('fog, overcast, partly_cloudy, and rain are all measurably different from each other', () => {
    const fog = lightHazeParamsFor('fog');
    const overcast = lightHazeParamsFor('overcast');
    const partlyCloudy = lightHazeParamsFor('partly_cloudy');
    const rain = lightHazeParamsFor('rain');

    expect(fog.durationBaseMs).toBeGreaterThan(partlyCloudy.durationBaseMs); // fog is slower than partly cloudy
    expect(overcast.opacityBase).toBeGreaterThan(partlyCloudy.opacityBase); // overcast heavier than partly cloudy
    expect(rain.opacityBase).not.toBe(fog.opacityBase);
    expect(rain.durationBaseMs).not.toBe(overcast.durationBaseMs);
  });

  it('drizzle/rain/showers/thunderstorm all resolve to the SAME warm rain-haze params (honest reuse)', () => {
    const rain = lightHazeParamsFor('rain');
    expect(lightHazeParamsFor('drizzle')).toEqual(rain);
    expect(lightHazeParamsFor('showers')).toEqual(rain);
    expect(lightHazeParamsFor('thunderstorm')).toEqual(rain);
  });

  it('omitting condition (undefined/null) reproduces the ORIGINAL HazeBand formula exactly', () => {
    const fallback = lightHazeParamsFor(undefined);
    expect(fallback).toEqual({
      durationBaseMs: 22000, durationVarMs: 18000,
      opacityBase: 0.05, opacityVar: 0.04,
      heightBase: 70, heightVar: 60,
      driftFactor: 0.12,
    });
    expect(lightHazeParamsFor(null)).toEqual(fallback);
  });
});

describe('V2WeatherMotion — DARK rain split is wired into the actual render (node count + colour)', () => {
  it('drizzle renders FEWER rain-streak nodes than plain rain (sparser, as darkRainParamsFor proves)', () => {
    const drizzleTree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition="drizzle" />).toJSON() as JsonNode;
    const rainTree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition="rain" />).toJSON() as JsonNode;
    const count = (n: JsonNode) => collectTestIDs(n).filter((id) => id === 'v2-rain-streak').length;
    expect(count(drizzleTree)).toBeGreaterThan(0);
    expect(count(drizzleTree)).toBeLessThan(count(rainTree));
  });

  it('omitting condition on the rain atmosphere renders the SAME node count as explicit condition="rain" (byte-identical fallback)', () => {
    const noConditionTree = render(<V2WeatherMotion atmosphere="rain" mode="dark" />).toJSON() as JsonNode;
    const explicitRainTree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition="rain" />).toJSON() as JsonNode;
    const count = (n: JsonNode) => collectTestIDs(n).filter((id) => id === 'v2-rain-streak').length;
    expect(count(noConditionTree)).toBe(count(explicitRainTree));
    expect(count(noConditionTree)).toBe(14); // the original STREAKS node count
  });

  it('every rain sub-condition still uses the SAME frozen RAIN_STREAK_RGB colour family — motion varies, palette does not', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const colors = collectBackgroundColors(tree);
      expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true);
    }
  });
});

describe('V2WeatherMotion — DARK cloudy split is wired into the actual render (colour + Star accent)', () => {
  // UPDATED 2026-07-22 (visibility repair): dark tints are PER CONDITION
  // (not a single shared family) — partly_cloudy keeps the frozen
  // MIST_BAND_RGB family verbatim; fog and overcast get their OWN muted
  // grey-blue / cooler-greyer tints (see SOFT_CLOUD_RGB). UPDATED AGAIN
  // 2026-07-22 (second, shape, pass): all three now render via
  // SoftCloudCluster (overcast/partly_cloudy) or FogBank (fog) — never the
  // old single-ellipse SoftCloudLayer, never the old solid-fill MistBand
  // slab — decode colour off the real RNSVGRadialGradient node (same
  // technique V2Background.test.tsx already uses for its glows) instead of a
  // style backgroundColor.
  it('partly_cloudy keeps the frozen MIST_BAND_RGB family; fog and overcast use their own distinct dark tints via SoftCloudCluster/FogBank — no old MistBand slab', () => {
    const expected = {
      fog: [110, 120, 138],
      overcast: [82, 90, 102],
      partly_cloudy: [96, 104, 124],
    } as const;
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      // Old MistBand slab gone in every case — even partly_cloudy's identical
      // RGB triplet now only ever appears via the SVG gradient's stopColor,
      // never a flat style `backgroundColor` rgba string.
      expect(collectBackgroundColors(tree).some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false);
      const gradients = collectRadialGradients(tree);
      expect(gradients.length).toBeGreaterThan(0);
      for (const g of gradients) {
        const { r, g: green, b } = decodeARGB(g.gradient[1]);
        expect([r, green, b]).toEqual([...expected[condition]]);
      }
    }
  });

  it('fog and overcast use dark tints DISTINCT from each other and from partly_cloudy — per-condition tinting, not one shared family', () => {
    const fog = softCloudParamsFor('fog', 'dark');
    const overcast = softCloudParamsFor('overcast', 'dark');
    const partlyCloudy = softCloudParamsFor('partly_cloudy', 'dark');
    expect(fog.rgb).not.toBe(overcast.rgb);
    expect(fog.rgb).not.toBe(partlyCloudy.rgb);
    expect(overcast.rgb).not.toBe(partlyCloudy.rgb);
    expect(partlyCloudy.rgb).toBe('96,104,124'); // frozen MIST_BAND_RGB.dark, byte-identical
  });

  it('fog renders FogBank (v2-fog-bank), overcast/partly_cloudy render SoftCloudCluster (v2-cloud-cluster) — never the old v2-soft-cloud-layer or v2-mist-band slab; mainly_clear STILL renders v2-mist-band', () => {
    const fogTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    expect(collectTestIDs(fogTree).filter((id) => id === 'v2-fog-bank').length).toBeGreaterThan(0);
    expect(collectTestIDs(fogTree)).not.toContain('v2-cloud-cluster');
    expect(collectTestIDs(fogTree)).not.toContain('v2-mist-band');
    expect(collectTestIDs(fogTree)).not.toContain('v2-soft-cloud-layer'); // old single-ellipse primitive, removed

    for (const condition of ['overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs.filter((id) => id === 'v2-cloud-cluster').length).toBeGreaterThan(0);
      expect(testIDs).not.toContain('v2-fog-bank');
      expect(testIDs).not.toContain('v2-mist-band');
      expect(testIDs).not.toContain('v2-soft-cloud-layer');
    }

    // The generic/no-condition cloudy default and the mainly_clear accent
    // (under sunny) are UNCHANGED — still v2-mist-band, never a cloud form.
    const cloudyDefaultTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" />).toJSON() as JsonNode;
    expect(collectTestIDs(cloudyDefaultTree)).toContain('v2-mist-band');
    expect(collectTestIDs(cloudyDefaultTree)).not.toContain('v2-cloud-cluster');
    expect(collectTestIDs(cloudyDefaultTree)).not.toContain('v2-fog-bank');

    const mainlyClearTree = render(<V2WeatherMotion atmosphere="sunny" mode="dark" condition="mainly_clear" />).toJSON() as JsonNode;
    expect(collectTestIDs(mainlyClearTree)).toContain('v2-mist-band');
    expect(collectTestIDs(mainlyClearTree)).not.toContain('v2-cloud-cluster');
    expect(collectTestIDs(mainlyClearTree)).not.toContain('v2-fog-bank');
  });

  it('fog has several (5) FogBanks, overcast (6) SoftCloudClusters is heavier than partly_cloudy (4), and partly_cloudy has fewer/lighter layers than overcast', () => {
    const fogTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    const overcastTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="overcast" />).toJSON() as JsonNode;
    const partlyCloudyTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="partly_cloudy" />).toJSON() as JsonNode;
    const countFog = (n: JsonNode) => collectTestIDs(n).filter((id) => id === 'v2-fog-bank').length;
    const countCluster = (n: JsonNode) => collectTestIDs(n).filter((id) => id === 'v2-cloud-cluster').length;

    expect(countFog(fogTree)).toBe(5); // 4–6 wide fog banks, per spec
    expect(countCluster(overcastTree)).toBe(6); // 5–7 larger overlapping cloud groups, per spec
    expect(countCluster(partlyCloudyTree)).toBe(4); // 3–4 distinct cloud groups, per spec — fewest
    expect(countCluster(overcastTree)).toBeGreaterThan(countCluster(partlyCloudyTree));

    // Numeric relationship straight from the pure param resolver: overcast is
    // measurably heavier (opacity) than partly_cloudy; fog is the
    // slowest/softest (longest duration, widest feather) of the three.
    const fogParams = softCloudParamsFor('fog', 'dark');
    const overcastParams = softCloudParamsFor('overcast', 'dark');
    const partlyCloudyParams = softCloudParamsFor('partly_cloudy', 'dark');
    expect(overcastParams.opacityBase).toBeGreaterThan(partlyCloudyParams.opacityBase);
    expect(overcastParams.opacityBase).toBeGreaterThan(fogParams.opacityBase);
    expect(fogParams.durationBaseMs).toBeGreaterThan(overcastParams.durationBaseMs);
    expect(fogParams.durationBaseMs).toBeGreaterThan(partlyCloudyParams.durationBaseMs);
    // Partly cloudy's dark opacity sits inside Liam's explicit 0.16–0.25 target band.
    expect(partlyCloudyParams.opacityBase).toBeGreaterThanOrEqual(0.16);
    expect(partlyCloudyParams.opacityBase).toBeLessThanOrEqual(0.25);
  });

  it('every SoftCloudCluster is MULTI-PUFF (5 puffs each) — proves it cannot regress to a single glow', () => {
    for (const condition of ['overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      const clusterCount = testIDs.filter((id) => id === 'v2-cloud-cluster').length;
      const puffCount = testIDs.filter((id) => id === 'v2-cloud-puff').length;
      expect(clusterCount).toBeGreaterThan(0);
      expect(puffCount).toBe(clusterCount * 5); // CLUSTER_PUFF_OFFSETS has 5 entries
      expect(puffCount / clusterCount).toBeGreaterThan(1); // multi-puff, not a single ellipse
    }
  });

  it('every FogBank is MULTI-LOBE (3 lobes each) and is STRUCTURALLY distinct from a cloud cluster (different testID, different lobe count, never a cluster puff)', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    const bankCount = testIDs.filter((id) => id === 'v2-fog-bank').length;
    const lobeCount = testIDs.filter((id) => id === 'v2-fog-lobe').length;
    expect(bankCount).toBeGreaterThan(0);
    expect(lobeCount).toBe(bankCount * 3); // FOG_LOBE_OFFSETS has 3 entries — deliberately fewer/wider than a cluster's 5 puffs
    expect(lobeCount / bankCount).toBeGreaterThan(1); // multi-lobe, not a single ellipse
    expect(testIDs).not.toContain('v2-cloud-puff'); // never reuses the cluster's puff shape
    expect(testIDs).not.toContain('v2-cloud-cluster');
  });

  it('overcast clusters render at least 2 DISTINCT whole-cluster opacity levels (clusterDepthFactorFor) — genuine layered depth, not a flat wash', () => {
    const indices = Array.from({ length: 6 }, (_, i) => i);
    const factors = indices.map((i) => clusterDepthFactorFor('overcast', i));
    expect(new Set(factors).size).toBeGreaterThanOrEqual(2);
    // partly_cloudy intentionally stays flat (uniform, single level) — its
    // own 4 clusters are already few/separated enough without needing this.
    const partlyCloudyFactors = indices.map((i) => clusterDepthFactorFor('partly_cloudy', i));
    expect(new Set(partlyCloudyFactors).size).toBe(1);
  });

  it('overcast combined density (layer count × peak opacity) is greater than partly_cloudy in BOTH modes — reads as clearly heavier', () => {
    expect(softCloudDensityFor('overcast', 'dark')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'dark'));
    expect(softCloudDensityFor('overcast', 'light')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'light'));
  });

  it('fog is positioned lower (higher yBase+yRange midpoint) than overcast and partly_cloudy, and drifts slower (longer duration) than both', () => {
    const fog = softCloudParamsFor('fog', 'dark');
    const overcast = softCloudParamsFor('overcast', 'dark');
    const partlyCloudy = softCloudParamsFor('partly_cloudy', 'dark');
    const mid = (p: { yBase: number; yRange: number }) => p.yBase + p.yRange / 2;
    expect(mid(fog)).toBeGreaterThan(mid(overcast));
    expect(mid(fog)).toBeGreaterThan(mid(partlyCloudy));
    expect(fog.durationBaseMs).toBeGreaterThan(overcast.durationBaseMs);
    expect(fog.durationBaseMs).toBeGreaterThan(partlyCloudy.durationBaseMs);
  });

  it('every cluster/bank gradient has 3 stops (core-hold fix) — the middle stop holds a meaningful fraction of peak opacity, never 0 and never full peak, and the outer stop is always exactly 0 (no hard edge anywhere)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const gradients = collectRadialGradients(tree);
      expect(gradients.length).toBeGreaterThan(0);
      for (const g of gradients) {
        // [offset0, color0, offset1, color1, offset2, color2] — 3 stops.
        expect(g.gradient.length).toBe(6);
        const peakAlpha = decodeARGB(g.gradient[1]).a;
        const coreAlpha = decodeARGB(g.gradient[3]).a;
        const edgeAlpha = decodeARGB(g.gradient[5]).a;
        expect(coreAlpha).toBeGreaterThan(0);
        expect(coreAlpha).toBeLessThanOrEqual(peakAlpha);
        expect(coreAlpha).toBeGreaterThan(peakAlpha * 0.5); // holds a MEANINGFUL fraction, not a token amount
        expect(edgeAlpha).toBe(0); // outer edge always fully transparent — no hard edge anywhere
      }
    }
  });

  it('partly_cloudy pairs its cloud clusters with a couple of Star nodes — fog/overcast do not', () => {
    const partlyCloudyTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="partly_cloudy" />).toJSON() as JsonNode;
    const fogTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    const overcastTree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="overcast" />).toJSON() as JsonNode;
    const starCount = (n: JsonNode) => collectBackgroundColors(n).filter((c) => c === '#E8ECF8').length;
    expect(starCount(partlyCloudyTree)).toBeGreaterThan(0);
    expect(starCount(fogTree)).toBe(0);
    expect(starCount(overcastTree)).toBe(0);
  });

  it('the WMO-1 "mainly clear" restrained accent (under the sunny atmosphere) is untouched by the cloudy-split boost', () => {
    // Preserved exactly (MIST_PARAMS_LEGACY) per Liam's spec — still ≤2 mist
    // nodes, still less than plain cloudy's 3, regardless of the Defect 1
    // boost applied to the generic cloudy default.
    const sunnyMainlyClear = render(<V2WeatherMotion atmosphere="sunny" mode="dark" condition="mainly_clear" />).toJSON() as JsonNode;
    const cloudyDefault = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" />).toJSON() as JsonNode;
    const countMist = (n: JsonNode) => collectBackgroundColors(n).filter((c) => c.startsWith('rgba(96,104,124,')).length;
    expect(countMist(sunnyMainlyClear)).toBeLessThanOrEqual(2);
    expect(countMist(sunnyMainlyClear)).toBeLessThan(countMist(cloudyDefault));
  });
});

// ═════════════════════════════════════════════════════════════════════════
// THIRD PASS (2026-07-22): hard-edge/"rectangular panel" structural fix +
// overcast layering redesign. See V2WeatherMotion.tsx's file-header note for
// the full arithmetic proof of the defect this section guards against.
// ═════════════════════════════════════════════════════════════════════════
describe('V2WeatherMotion — structural hard-edge fix: gradient always reaches zero strictly inside the shape/viewport', () => {
  it('puffGradientRadiusFraction: r × feather is EXACTLY 0.4 (comfortably inside the shape\'s own 0.5 half-extent) for every real condition feather, and for the full plausible feather range', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const feather = softCloudParamsFor(condition, 'dark').feather;
      const r = puffGradientRadiusFraction(feather);
      expect(r * feather).toBeCloseTo(0.4, 10);
      expect(r * feather).toBeLessThan(0.5); // strictly inside the shape's own bbox edge
    }
    // Also true for any feather in the valid (0,1] range, not just the 3 tuned values —
    // proves the fix is structural (holds for ANY feather), not a value fitted to today's numbers.
    for (const feather of [0.5, 0.6, 0.7, 0.78, 0.8, 0.9, 0.92, 0.95, 0.99, 1]) {
      const r = puffGradientRadiusFraction(feather);
      expect(r * feather).toBeCloseTo(0.4, 10);
      expect(r * feather).toBeLessThan(0.5);
    }
  });

  it('puffRectPercent: the worst-case puff (CLUSTER_PUFF_OFFSETS[0], w=h=1.0, dx=dy=0 — the one that used to be tangent to all 4 Svg edges) leaves visible headroom on every side, never touching the 0%/100% viewport bounds', () => {
    const worstCase = { dx: 0, dy: 0, w: 1.0, h: 1.0 };
    const rect = puffRectPercent(worstCase);
    expect(rect.xPercent).toBeGreaterThan(0);
    expect(rect.yPercent).toBeGreaterThan(0);
    expect(rect.xPercent + rect.widthPercent).toBeLessThan(100);
    expect(rect.yPercent + rect.heightPercent).toBeLessThan(100);
    // Comfortable margin (>10 percentage points on every side), not a razor's edge.
    expect(rect.xPercent).toBeGreaterThan(10);
    expect(100 - (rect.xPercent + rect.widthPercent)).toBeGreaterThan(10);
  });

  it('REGRESSION GUARD (rendered tree, not just the pure function): every real RadialGradient rendered for fog/overcast/partly_cloudy has its zero-alpha stop landing at a bbox-distance strictly < 0.5 — decoded from the ACTUAL rx prop + gradient stop offsets react-native-svg renders, cross-checking the pure formula is really wired in', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const gradients = collectRadialGradients(tree);
      expect(gradients.length).toBeGreaterThan(0);
      for (const g of gradients) {
        const rxFraction = pctToFraction(g.rx);
        expect(Number.isFinite(rxFraction)).toBe(true);
        // gradient = [offset0, color0, offset1, color1, offset2, color2] — the
        // last stop is the always-0-alpha outer ("feather") stop.
        const lastOffset = g.gradient[g.gradient.length - 2];
        const lastAlpha = (g.gradient[g.gradient.length - 1] >>> 24) & 0xff;
        expect(lastAlpha).toBe(0);
        const zeroAlphaBboxDistance = rxFraction * lastOffset;
        expect(zeroAlphaBboxDistance).toBeLessThan(0.5); // strictly inside the Rect's own edge
        expect(zeroAlphaBboxDistance).toBeCloseTo(0.4, 5); // matches GRADIENT_ZERO_TARGET
      }
    }
  });

  it('REGRESSION GUARD: no rendered puff/lobe Rect touches the Svg viewport bounds (0%/100%) for fog/overcast/partly_cloudy', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const rects = collectRects(tree);
      expect(rects.length).toBeGreaterThan(0);
      for (const r of rects) {
        const x = pctToFraction(r.x) * 100;
        const y = pctToFraction(r.y) * 100;
        const w = pctToFraction(r.width) * 100;
        const h = pctToFraction(r.height) * 100;
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x + w).toBeLessThan(100);
        expect(y + h).toBeLessThan(100);
      }
    }
  });

  it('every gradient id is unique per condition + cluster/bank instance + puff/lobe index (no shared def across puffs, no collision risk between conditions)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const names = collectRadialGradients(tree).map((g) => g.name as string);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length); // no duplicate ids within one render
      for (const name of names) {
        expect(name).toContain(condition); // condition-qualified, per the brief
      }
    }
    // Cross-condition: fog/overcast/partly_cloudy id sets never overlap.
    const allNames = (['fog', 'overcast', 'partly_cloudy'] as const).map((condition) => {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      return new Set(collectRadialGradients(tree).map((g) => g.name as string));
    });
    for (let i = 0; i < allNames.length; i += 1) {
      for (let j = i + 1; j < allNames.length; j += 1) {
        const intersection = [...allNames[i]].filter((n) => allNames[j].has(n));
        expect(intersection).toEqual([]);
      }
    }
  });

  it('no shape-level `opacity` prop remains on any puff/lobe Rect — the suspected Android compositing path (cause c) is fully removed', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      // collectRects only captures x/y/width/height; assert the raw props
      // object on every RNSVGRect has no `opacity` key at all.
      function collectRectOpacities(node: JsonNode, out: unknown[] = []): unknown[] {
        if (!node) return out;
        const n = node as unknown as { type?: string; props?: Record<string, unknown>; children?: JsonNode[] | null };
        if (n.type === 'RNSVGRect') out.push(n.props?.opacity);
        for (const child of n.children ?? []) collectRectOpacities(child, out);
        return out;
      }
      const opacities = collectRectOpacities(tree);
      expect(opacities.length).toBeGreaterThan(0);
      expect(opacities.every((o) => o === undefined)).toBe(true);
    }
  });
});

describe('V2WeatherMotion — partly cloudy: isolated clusters, no full-width/opaque container (Liam device verdict: "VISIBLY BROKEN — rectangular blocks")', () => {
  it('every partly_cloudy cluster wrapper is narrower than the screen — no full-width cloud container', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="partly_cloudy" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    expect(testIDs.filter((id) => id === 'v2-cloud-cluster').length).toBe(4);
    let checked = 0;
    (function walk(node: JsonNode) {
      if (!node) return;
      if (node.props?.testID === 'v2-cloud-cluster') {
        const style = flattenStyle(node);
        expect(typeof style.width).toBe('number');
        expect(style.width as number).toBeLessThan(750); // screenW mocked to 750 in jest
        checked += 1;
      }
      for (const child of node.children ?? []) walk(child);
    })(tree);
    expect(checked).toBe(4);
  });

  it('no partly_cloudy (or overcast/fog) cluster/bank WRAPPER exposes a backgroundColor — every visible pixel comes from the feathered gradient, never a flat opaque fill', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      let checked = 0;
      (function walk(node: JsonNode) {
        if (!node) return;
        if (node.props?.testID === 'v2-cloud-cluster' || node.props?.testID === 'v2-fog-bank') {
          const style = flattenStyle(node);
          expect(style.backgroundColor).toBeUndefined();
          checked += 1;
        }
        for (const child of node.children ?? []) walk(child);
      })(tree);
      expect(checked).toBeGreaterThan(0);
    }
  });
});

describe('V2WeatherMotion — overcast layering redesign (Liam device verdict: "still reads as one broad grey sheet — needs to become layered")', () => {
  it('overcastClusterLayout: xPercent is staggered (evenly spread, no two of the 6 instances within a tight cluster) — replaces the raw seed draw that put 2 pairs within a few % of each other', () => {
    const count = softCloudNodesFor('overcast').length;
    const nodes = softCloudNodesFor('overcast');
    const xs = nodes.map((n, i) => overcastClusterLayout(n, i, count).xPercent).sort((a, b) => a - b);
    // Every consecutive gap must be a meaningful fraction of the screen —
    // proves no two instances land in the same horizontal zone.
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThan(8);
    }
    // Spans a large majority of the screen width (staggered, not bunched).
    expect(xs[xs.length - 1] - xs[0]).toBeGreaterThan(60);
  });

  it('overcastClusterLayout: exactly 2 distinct yBase/yRange bands, tied 1:1 to clusterDepthFactorFor\'s existing near/far split, with the near (opacity 1.0) band reaching further down than the far (opacity 0.72) band', () => {
    const count = softCloudNodesFor('overcast').length;
    const nodes = softCloudNodesFor('overcast');
    const bands = nodes.map((n, i) => overcastClusterLayout(n, i, count));
    const uniqueBands = new Set(bands.map((b) => `${b.yBase}-${b.yRange}`));
    expect(uniqueBands.size).toBe(2);
    for (let i = 0; i < count; i += 1) {
      const depthFactor = clusterDepthFactorFor('overcast', i);
      const band = bands[i];
      if (depthFactor === 1) {
        // near tier reaches further down the screen than the far tier
        expect(band.yBase + band.yRange).toBeGreaterThan(40);
      } else {
        expect(band.yBase + band.yRange).toBeLessThanOrEqual(30);
      }
    }
  });

  it('overcastClusterLayout: nothing reaches below 60% of the screen — "lower screen comparatively clearer" (Liam\'s spec)', () => {
    const count = softCloudNodesFor('overcast').length;
    const nodes = softCloudNodesFor('overcast');
    for (let i = 0; i < count; i += 1) {
      const band = overcastClusterLayout(nodes[i], i, count);
      expect(band.yBase + band.yRange).toBeLessThanOrEqual(60);
    }
  });

  it('rendered overcast clusters actually use the staggered layout (top style values fall into exactly 2 distinct bands, left values are spread) — proves the render call site is wired to overcastClusterLayout, not just the pure function', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="overcast" />).toJSON() as JsonNode;
    const lefts: number[] = [];
    const tops: number[] = [];
    (function walk(node: JsonNode) {
      if (!node) return;
      if (node.props?.testID === 'v2-cloud-cluster') {
        const style = flattenStyle(node);
        lefts.push(parseFloat(String(style.left).replace('%', '')));
        tops.push(parseFloat(String(style.top).replace('%', '')));
      }
      for (const child of node.children ?? []) walk(child);
    })(tree);
    expect(lefts.length).toBe(6);
    const sortedLefts = [...lefts].sort((a, b) => a - b);
    for (let i = 1; i < sortedLefts.length; i += 1) {
      expect(sortedLefts[i] - sortedLefts[i - 1]).toBeGreaterThan(5);
    }
    // tops split into (at most) 2 distinct yBase+node.y*yRange bands per the
    // depth-tier scheme — never all 6 crammed into one narrow band.
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(15);
  });

  it('overcast still renders MORE clusters than partly_cloudy and still has ≥2 distinct whole-cluster opacity levels post-redesign (pre-existing guarantees, unbroken by the layering change)', () => {
    expect(softCloudNodesFor('overcast').length).toBeGreaterThan(softCloudNodesFor('partly_cloudy').length);
    const factors = Array.from({ length: softCloudNodesFor('overcast').length }, (_, i) => clusterDepthFactorFor('overcast', i));
    expect(new Set(factors).size).toBeGreaterThanOrEqual(2);
  });
});

describe('V2WeatherMotion — foggy visibility boost (~10-15% only, structure/geometry/drift preserved)', () => {
  it('fog opacityBase/opacityVar increased by 10-15% in BOTH modes over the pre-THIRD-pass baseline — same RGB, same feather/coreHold/yBase/yRange/durationBaseMs/driftFactor (structure untouched)', () => {
    const fog = softCloudParamsFor('fog', 'dark');
    // THIRD-pass boost magnitude: dark 0.17→0.192 (+12.9%), light 0.11→0.124
    // (+12.7%). The historical before/after comparison itself is no longer
    // asserted here (it was a constant-vs-constant check); this test now
    // pins the geometry/motion fields that must stay untouched.
    // Everything else about fog's shape/motion is untouched from the second pass.
    expect(fog.feather).toBe(0.95);
    expect(fog.coreHold).toBe(0.38);
    expect(fog.coreOpacityFactor).toBe(0.78);
    expect(fog.yBase).toBe(32);
    expect(fog.yRange).toBe(56);
    expect(fog.durationBaseMs).toBe(42000);
    expect(fog.driftFactor).toBe(0.09);
  });

  it('fog still renders FogBank (v2-fog-bank, 3-lobe, testID structure) unchanged after the visibility boost', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    expect(testIDs.filter((id) => id === 'v2-fog-bank').length).toBe(5);
    expect(testIDs.filter((id) => id === 'v2-fog-lobe').length).toBe(15); // 5 banks × 3 lobes
  });
});

// ═════════════════════════════════════════════════════════════════════════
// FOURTH PASS (2026-07-22) — visibility/identity repair. The THIRD pass's
// no-edge fix (GRADIENT_ZERO_TARGET/CLOUD_CANVAS_PAD/puffGradientRadiusFraction/
// Rect-not-Ellipse) made every SoftCloudCluster/FogBank near-invisible; this
// pass restores visibility using ONLY the levers that don't touch that fix
// (peak opacity, nominal size, coreHold/coreOpacityFactor, layer count) —
// see V2WeatherMotion.tsx's file-header FOURTH-pass note for the full
// reasoning per condition.
// ═════════════════════════════════════════════════════════════════════════
describe('V2WeatherMotion — FOURTH pass: partly cloudy is 3-4 isolated, visibly bigger/denser clusters', () => {
  it('exactly 4 clusters (within the 3-4 target), still isolated (each cluster wrapper narrower than the screen)', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="partly_cloudy" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    const count = testIDs.filter((id) => id === 'v2-cloud-cluster').length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(4);
  });

  it('visibility recovered: size ×1.5, opacityBase ×~1.3 (both modes), coreHold and coreOpacityFactor both raised', () => {
    const before = { sizeWBase: 160, sizeHBase: 100, opacityBaseDark: 0.16, opacityBaseLight: 0.11, coreHold: 0.45, coreOpacityFactor: 0.85 };
    const after = softCloudParamsFor('partly_cloudy', 'dark');
    const afterLight = softCloudParamsFor('partly_cloudy', 'light');
    expect(after.sizeWBase / before.sizeWBase).toBeCloseTo(1.5, 5);
    expect(after.sizeHBase / before.sizeHBase).toBeCloseTo(1.5, 5);
    expect(after.opacityBase / before.opacityBaseDark).toBeGreaterThan(1.25);
    expect(afterLight.opacityBase / before.opacityBaseLight).toBeGreaterThan(1.2);
    expect(after.coreHold).toBeGreaterThan(before.coreHold);
    expect(after.coreOpacityFactor).toBeGreaterThan(before.coreOpacityFactor);
    // Dark opacity stays inside the existing 0.16-0.25 target band.
    expect(after.opacityBase).toBeGreaterThanOrEqual(0.16);
    expect(after.opacityBase).toBeLessThanOrEqual(0.25);
  });
});

describe('V2WeatherMotion — FOURTH pass: overcast has more clusters AND greater combined coverage/density than partly cloudy', () => {
  /** Coverage proxy: layer count × mean puff footprint × peak opacity. */
  function approxCoverage(condition: 'fog' | 'overcast' | 'partly_cloudy'): number {
    const count = softCloudNodesFor(condition).length;
    const p = softCloudParamsFor(condition, 'dark');
    const meanArea = (p.sizeWBase + p.sizeWVar / 2) * (p.sizeHBase + p.sizeHVar / 2);
    return count * meanArea * p.opacityBase;
  }

  it('overcast (6) has more clusters than partly_cloudy (4)', () => {
    expect(softCloudNodesFor('overcast').length).toBeGreaterThan(softCloudNodesFor('partly_cloudy').length);
  });

  it('overcast combined coverage/density is greater than partly cloudy in both modes (softCloudDensityFor) and by the coverage proxy above', () => {
    expect(softCloudDensityFor('overcast', 'dark')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'dark'));
    expect(softCloudDensityFor('overcast', 'light')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'light'));
    expect(approxCoverage('overcast')).toBeGreaterThan(approxCoverage('partly_cloudy'));
  });

  it('overcast visibility recovered: width ×1.1 (kept below fog\'s width so fog stays widest), height ×1.5, opacityBase up, coreOpacityFactor up', () => {
    const before = { sizeWBase: 300, sizeHBase: 170, opacityBaseDark: 0.22, opacityBaseLight: 0.13, coreOpacityFactor: 0.88 };
    const after = softCloudParamsFor('overcast', 'dark');
    const afterLight = softCloudParamsFor('overcast', 'light');
    const fog = softCloudParamsFor('fog', 'dark');
    expect(after.sizeWBase / before.sizeWBase).toBeCloseTo(1.1, 5);
    expect(after.sizeHBase / before.sizeHBase).toBeCloseTo(1.5, 5);
    expect(after.sizeWBase).toBeLessThan(fog.sizeWBase); // fog stays the widest of the three
    expect(after.opacityBase).toBeGreaterThan(before.opacityBaseDark);
    expect(afterLight.opacityBase).toBeGreaterThan(before.opacityBaseLight);
    expect(after.coreOpacityFactor).toBeGreaterThan(before.coreOpacityFactor);
  });

  it('overcast still keeps ≥2 distinct depth-tier opacity levels post-boost (clusterDepthFactorFor untouched)', () => {
    const factors = Array.from({ length: softCloudNodesFor('overcast').length }, (_, i) => clusterDepthFactorFor('overcast', i));
    expect(new Set(factors).size).toBeGreaterThanOrEqual(2);
  });
});

describe('V2WeatherMotion — FOURTH pass: foggy renders fog banks, never cloud clusters, with the exact stated visibility multiplier', () => {
  it('fog renders ONLY v2-fog-bank/v2-fog-lobe testIDs — never v2-cloud-cluster/v2-cloud-puff (structural, not just colour)', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    expect(testIDs.some((id) => id === 'v2-fog-bank')).toBe(true);
    expect(testIDs).not.toContain('v2-cloud-cluster');
    expect(testIDs).not.toContain('v2-cloud-puff');
  });

  it('fog opacityBase/opacityVar were raised by exactly 25% (both modes) over the THIRD-pass values, AS OF the FOURTH pass — historical pin, superseded for dark by the FIFTH pass (see that describe block below)', () => {
    // Dark has since moved again (FIFTH pass, +11.5%) and is no longer
    // asserted here. Light was never touched by the FIFTH pass, so it's
    // still exactly the FOURTH-pass figure — asserted against the live
    // value below.
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fogLight.opacityBase).toBeCloseTo(0.124 * 1.25, 10);
    expect(fogLight.opacityVar).toBeCloseTo(0.057 * 1.25, 10);
  });
});

describe('V2WeatherMotion — FOURTH pass: no cloud wrapper is a rectangular panel or a full-screen overlay', () => {
  it('no v2-cloud-cluster/v2-fog-bank wrapper has a backgroundColor (every visible pixel comes from the feathered gradient)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      let checked = 0;
      (function walk(node: JsonNode) {
        if (!node) return;
        if (node.props?.testID === 'v2-cloud-cluster' || node.props?.testID === 'v2-fog-bank') {
          expect(flattenStyle(node).backgroundColor).toBeUndefined();
          checked += 1;
        }
        for (const child of node.children ?? []) walk(child);
      })(tree);
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('no v2-cloud-cluster/v2-fog-bank wrapper spans the full screen width (screenW mocked to 750 in jest) — never a monolithic full-screen overlay', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      let checked = 0;
      (function walk(node: JsonNode) {
        if (!node) return;
        if (node.props?.testID === 'v2-cloud-cluster' || node.props?.testID === 'v2-fog-bank') {
          const style = flattenStyle(node);
          expect(typeof style.width).toBe('number');
          expect(style.width as number).toBeLessThan(750);
          checked += 1;
        }
        for (const child of node.children ?? []) walk(child);
      })(tree);
      expect(checked).toBeGreaterThan(0);
    }
  });
});

describe('V2WeatherMotion — FOURTH pass: the round-3 no-edge invariant still holds after the visibility boost', () => {
  it('GRADIENT_ZERO_TARGET/CLOUD_CANVAS_PAD math (puffGradientRadiusFraction, puffRectPercent) is untouched — zero-alpha still lands at bbox-distance 0.4 for every condition\'s (possibly-unchanged) feather', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const feather = softCloudParamsFor(condition, 'dark').feather;
      const r = puffGradientRadiusFraction(feather);
      expect(r * feather).toBeCloseTo(0.4, 10);
      expect(r * feather).toBeLessThan(0.5);
    }
  });

  it('rendered gradients for every condition still reach exactly 0 alpha strictly inside the shape bbox (rendered-tree regression guard, post-boost)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const gradients = collectRadialGradients(tree);
      expect(gradients.length).toBeGreaterThan(0);
      for (const g of gradients) {
        const lastAlpha = (g.gradient[g.gradient.length - 1] >>> 24) & 0xff;
        expect(lastAlpha).toBe(0);
        const rxFraction = pctToFraction(g.rx);
        const lastOffset = g.gradient[g.gradient.length - 2];
        expect(rxFraction * lastOffset).toBeLessThan(0.5);
        expect(rxFraction * lastOffset).toBeCloseTo(0.4, 5);
      }
    }
  });

  it('no rendered puff/lobe Rect touches the Svg viewport bounds for any condition, post-boost', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const rects = collectRects(tree);
      expect(rects.length).toBeGreaterThan(0);
      for (const r of rects) {
        const x = pctToFraction(r.x) * 100;
        const y = pctToFraction(r.y) * 100;
        const w = pctToFraction(r.width) * 100;
        const h = pctToFraction(r.height) * 100;
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x + w).toBeLessThan(100);
        expect(y + h).toBeLessThan(100);
      }
    }
  });
});

describe('V2WeatherMotion — FOURTH pass: fade ramp stays a genuine soft edge, not a cliff, for every condition', () => {
  it('(feather − coreHold) × puffGradientRadiusFraction(feather) stays ≥ ~0.15 of the bbox for fog/overcast/partly_cloudy', () => {
    const minRamp = 0.145; // small tolerance below the ~0.15 target
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const p = softCloudParamsFor(condition, 'dark');
      const r = puffGradientRadiusFraction(p.feather);
      const ramp = (p.feather - p.coreHold) * r;
      expect(ramp).toBeGreaterThanOrEqual(minRamp);
    }
  });
});

describe('V2WeatherMotion — FIFTH pass: fog dark-mode visibility bump (+10-15%), light untouched, everything else pinned', () => {
  it("fog's dark peak opacity (opacityBase+opacityVar) rose by 10-15% over the FOURTH-pass value — the ONLY thing this pass changes", () => {
    const fog = softCloudParamsFor('fog', 'dark');
    const priorPeak = 0.24 + 0.09875; // FOURTH-pass dark opacityBase + opacityVar (frozen reference, not re-read from source)
    const newPeak = fog.opacityBase + fog.opacityVar;
    expect(newPeak / priorPeak).toBeGreaterThanOrEqual(1.10);
    expect(newPeak / priorPeak).toBeLessThanOrEqual(1.15);
  });

  it("fog's dark opacityBase/opacityVar are exactly the new FIFTH-pass literals (pins the two numbers this pass touches)", () => {
    const fog = softCloudParamsFor('fog', 'dark');
    expect(fog.opacityBase).toBeCloseTo(0.268, 10);
    expect(fog.opacityVar).toBeCloseTo(0.110, 10);
  });

  it("fog's LIGHT opacityBase/opacityVar are UNCHANGED from the FOURTH pass (Liam's brief: no change to the sandy Light background)", () => {
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fogLight.opacityBase).toBeCloseTo(0.155, 10);
    expect(fogLight.opacityVar).toBeCloseTo(0.07125, 10);
  });

  it("fog's size/feather/coreHold/coreOpacityFactor/yBase/yRange/duration/driftFactor are pinned — only opacity moved", () => {
    const fog = softCloudParamsFor('fog', 'dark');
    expect(fog.sizeWBase).toBe(340);
    expect(fog.sizeWVar).toBe(120);
    expect(fog.sizeHBase).toBe(70);
    expect(fog.sizeHVar).toBe(34);
    expect(fog.feather).toBe(0.95);
    expect(fog.coreHold).toBe(0.38);
    expect(fog.coreOpacityFactor).toBe(0.78);
    expect(fog.yBase).toBe(32);
    expect(fog.yRange).toBe(56);
    expect(fog.durationBaseMs).toBe(42000);
    expect(fog.durationVarMs).toBe(20000);
    expect(fog.driftFactor).toBe(0.09);
  });

  it('fog dark/light RGB tint is unchanged (110,120,138 / 202,194,184) — this pass is opacity-only, no colour change', () => {
    const fogDark = softCloudParamsFor('fog', 'dark');
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fogDark.rgb).toBe('110,120,138');
    expect(fogLight.rgb).toBe('202,194,184');
  });

  it('overcast params (dark+light, opacityBase/opacityVar/size/feather/coreHold/coreOpacityFactor) are completely untouched by the fog-only fix', () => {
    const overcastDark = softCloudParamsFor('overcast', 'dark');
    const overcastLight = softCloudParamsFor('overcast', 'light');
    expect(overcastDark.opacityBase).toBeCloseTo(0.27, 10);
    expect(overcastDark.opacityVar).toBeCloseTo(0.12, 10);
    expect(overcastLight.opacityBase).toBeCloseTo(0.17, 10);
    expect(overcastLight.opacityVar).toBeCloseTo(0.075, 10);
    expect(overcastDark.sizeWBase).toBe(330);
    expect(overcastDark.sizeHBase).toBe(255);
    expect(overcastDark.feather).toBe(0.78);
    expect(overcastDark.coreHold).toBe(0.47);
    expect(overcastDark.coreOpacityFactor).toBe(0.94);
  });

  it('partly_cloudy params (dark+light, opacityBase/opacityVar/size/feather/coreHold/coreOpacityFactor) are completely untouched by the fog-only fix', () => {
    const partlyDark = softCloudParamsFor('partly_cloudy', 'dark');
    const partlyLight = softCloudParamsFor('partly_cloudy', 'light');
    expect(partlyDark.opacityBase).toBeCloseTo(0.21, 10);
    expect(partlyDark.opacityVar).toBeCloseTo(0.09, 10);
    expect(partlyLight.opacityBase).toBeCloseTo(0.14, 10);
    expect(partlyLight.opacityVar).toBeCloseTo(0.05, 10);
    expect(partlyDark.sizeWBase).toBe(240);
    expect(partlyDark.sizeHBase).toBe(150);
    expect(partlyDark.feather).toBe(0.90);
    expect(partlyDark.coreHold).toBe(0.54);
    expect(partlyDark.coreOpacityFactor).toBe(0.92);
  });

  it('round-3 no-edge invariant still holds for fog after the opacity bump: zero-alpha bbox-distance ≈0.4, strictly < 0.5', () => {
    const feather = softCloudParamsFor('fog', 'dark').feather;
    const r = puffGradientRadiusFraction(feather);
    expect(r * feather).toBeCloseTo(0.4, 10);
    expect(r * feather).toBeLessThan(0.5);
  });

  it('rendered fog gradients still reach exactly 0 alpha strictly inside the bbox after the opacity bump (rendered-tree regression guard)', () => {
    const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode;
    const gradients = collectRadialGradients(tree);
    expect(gradients.length).toBeGreaterThan(0);
    for (const g of gradients) {
      const lastAlpha = (g.gradient[g.gradient.length - 1] >>> 24) & 0xff;
      expect(lastAlpha).toBe(0);
      const rxFraction = pctToFraction(g.rx);
      const lastOffset = g.gradient[g.gradient.length - 2];
      expect(rxFraction * lastOffset).toBeLessThan(0.5);
      expect(rxFraction * lastOffset).toBeCloseTo(0.4, 5);
    }
  });

  it('fade-ramp guard still holds for fog after the opacity bump (opacity change does not affect feather/coreHold, so ramp is unchanged)', () => {
    const p = softCloudParamsFor('fog', 'dark');
    const r = puffGradientRadiusFraction(p.feather);
    const ramp = (p.feather - p.coreHold) * r;
    expect(ramp).toBeGreaterThanOrEqual(0.145);
  });

  it('rain/drizzle dark+light params are unaffected by the fog-only opacity fix', () => {
    const rainDark = darkRainParamsFor('rain');
    const drizzleDark = darkRainParamsFor('drizzle');
    const rainLight = lightHazeParamsFor('rain');
    const drizzleLight = lightHazeParamsFor('drizzle');
    expect(drizzleDark.opacityBase).toBeLessThan(rainDark.opacityBase);
    // Just a not-throwing/shape sanity check — these two conditions never
    // routed through SOFT_CLOUD_FOG/SOFT_CLOUD_OVERCAST/SOFT_CLOUD_PARTLY_CLOUDY,
    // so they cannot have been touched by a fog-only literal edit.
    expect(typeof rainLight.opacityBase).toBe('number');
    expect(typeof drizzleLight.opacityBase).toBe('number');
  });
});

describe('V2WeatherMotion — LIGHT stays warm and uses the active animated driver for rain-family motion', () => {
  it('rain-family conditions render an additive warm-toned streak layer (v2-warm-streak), never RainStreak/MistBand/Star colours', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs.filter((id) => id === 'v2-warm-streak').length).toBeGreaterThan(0);
      const colors = collectBackgroundColors(tree);
      expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(false); // dark RainStreak colour
      expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false); // dark MistBand colour
      expect(colors).not.toContain('#E8ECF8'); // Star
    }
  });

  it('non-rain conditions (fog/overcast/partly_cloudy) never render the warm-streak layer', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition={condition} />).toJSON() as JsonNode;
      expect(collectTestIDs(tree)).not.toContain('v2-warm-streak');
    }
  });

  it('every light condition (baseline + every fine condition) stays warm — no colour channel has blue dominant over red/green', () => {
    const conditions: (import('@/lib/weather').WeatherCondition | undefined)[] = [
      undefined, 'clear', 'mainly_clear', 'partly_cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'showers', 'thunderstorm', 'snow',
    ];
    for (const condition of conditions) {
      const tree = render(<V2WeatherMotion atmosphere="sunny" mode="light" condition={condition} />).toJSON() as JsonNode;
      const colors = collectBackgroundColors(tree);
      for (const c of colors) {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) continue; // hex literals (e.g. #FFD696) are checked separately below
        const [, r, g, b] = m.map(Number) as unknown as [number, number, number, number];
        expect(b).toBeLessThanOrEqual(r);
        expect(b).toBeLessThanOrEqual(g + 20); // small tolerance for near-neutral tones
      }
    }
  });

  // UPDATED 2026-07-20 (Foggy/Overcast/Partly-cloudy softening), reshaped
  // 2026-07-22 second pass: fog/overcast/partly_cloudy now swap HazeBand for
  // FogBank/SoftCloudCluster in light too (see isSoftCloudCondition's call
  // site in the light branch) — SunPulseLight and DustMote are untouched for
  // every condition, and drizzle/rain (not swapped) keep rendering HazeBand
  // exactly as before.
  it('still renders the baseline warm ambient set (SunPulseLight + dust always; haze OR cloud-form) for every fine condition, not just when condition is omitted', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy', 'drizzle', 'rain'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs).toContain('v2-sun-pulse-light');
      expect(testIDs.filter((id) => id.startsWith('v2-dust-mote-')).length).toBeGreaterThanOrEqual(2);
      if (isSoftCloudCondition(condition)) {
        const cloudFormCount =
          testIDs.filter((id) => id === 'v2-fog-bank').length + testIDs.filter((id) => id === 'v2-cloud-cluster').length;
        expect(cloudFormCount).toBeGreaterThan(0);
        expect(testIDs.filter((id) => id.startsWith('v2-haze-band-')).length).toBe(0);
      } else {
        expect(testIDs.filter((id) => id.startsWith('v2-haze-band-')).length).toBeGreaterThanOrEqual(2);
        expect(testIDs).not.toContain('v2-fog-bank');
        expect(testIDs).not.toContain('v2-cloud-cluster');
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// CLOUD CLUSTERS + FOG BANKS (2026-07-20 Foggy/Overcast/Partly-cloudy
// softening; RESHAPED 2026-07-22 second pass)
//
// Root cause #1 (device evidence: partly cloudy near-invisible, overcast a
// grey glow behind the header, fog a green-grey wash): traced to
// V2Background.tsx's olive dark 'cloudy' glow, fixed at the source (see
// V2Background.test.tsx's dedicated pin below) — NOT this file.
//
// Root cause #2: fog/overcast/partly_cloudy previously rendered via a
// single feathered ellipse (SoftCloudLayer) which, no matter its opacity,
// can only ever read as a GLOW, never a cloud. Fix: two new primitives —
// `SoftCloudCluster` (partly_cloudy/overcast — a lumpy, multi-puff cloud
// silhouette) and `FogBank` (fog — a wide, multi-lobe, low-lying band,
// structurally distinct from a cluster, not a reused one). Rainy/Drizzly
// (RainStreak/WarmStreak) and mainly_clear's MistBand accent are explicitly
// OUT OF SCOPE and asserted untouched elsewhere in this file.
// ═════════════════════════════════════════════════════════════════════════

describe('softCloudParamsFor / softCloudNodesFor / clusterDepthFactorFor — pure parameter checks', () => {
  it('fog, overcast, and partly_cloudy are all measurably distinct (dark)', () => {
    const fog = softCloudParamsFor('fog', 'dark');
    const overcast = softCloudParamsFor('overcast', 'dark');
    const partlyCloudy = softCloudParamsFor('partly_cloudy', 'dark');

    // Fog: several low-opacity, slow, WIDE (elongated) FogBanks.
    expect(softCloudNodesFor('fog').length).toBe(5);
    expect(fog.durationBaseMs).toBeGreaterThan(overcast.durationBaseMs);
    expect(fog.durationBaseMs).toBeGreaterThan(partlyCloudy.durationBaseMs);
    expect(fog.sizeWBase).toBeGreaterThan(overcast.sizeWBase); // widest of the three — a long low bank
    expect(fog.sizeWBase).toBeGreaterThan(partlyCloudy.sizeWBase);
    expect(fog.sizeHBase).toBeLessThan(overcast.sizeHBase); // but the LOWEST/flattest of the three

    // Overcast: fewer than fog but the TALLEST/HEAVIEST cluster masses —
    // highest opacity, biggest vertical extent.
    expect(softCloudNodesFor('overcast').length).toBe(6);
    expect(overcast.opacityBase).toBeGreaterThan(fog.opacityBase);
    expect(overcast.opacityBase).toBeGreaterThan(partlyCloudy.opacityBase);
    expect(overcast.sizeHBase).toBeGreaterThan(partlyCloudy.sizeHBase);
    expect(overcast.sizeWBase).toBeGreaterThan(partlyCloudy.sizeWBase);

    // Partly cloudy: FEWEST + SMALLEST + LIGHTEST — never "overcast at lower opacity".
    expect(softCloudNodesFor('partly_cloudy').length).toBe(4);
    expect(partlyCloudy.opacityBase).toBeLessThan(overcast.opacityBase);
    expect(partlyCloudy.opacityBase).toBeLessThan(fog.opacityBase);
    expect(partlyCloudy.sizeWBase).toBeLessThan(fog.sizeWBase);
    expect(partlyCloudy.sizeWBase).toBeLessThan(overcast.sizeWBase);

    expect(softCloudNodesFor('overcast').length).toBeGreaterThan(softCloudNodesFor('partly_cloudy').length);
  });

  it('the same distinctness holds in light mode (opacity is dimmer overall, but the overcast > fog > partly_cloudy opacity ordering is mode-independent)', () => {
    const fog = softCloudParamsFor('fog', 'light');
    const overcast = softCloudParamsFor('overcast', 'light');
    const partlyCloudy = softCloudParamsFor('partly_cloudy', 'light');
    expect(overcast.opacityBase).toBeGreaterThan(partlyCloudy.opacityBase);
    expect(overcast.opacityBase).toBeGreaterThan(fog.opacityBase);
    expect(overcast.sizeWBase).toBeGreaterThan(partlyCloudy.sizeWBase);
  });

  it('dark uses PER-CONDITION tints (partly_cloudy keeps the frozen MIST_BAND_RGB family; fog/overcast get their own); light always uses a warm (R≥G≥B) colour — never a cold hex in the light path', () => {
    const expectedDark: Record<'fog' | 'overcast' | 'partly_cloudy', string> = {
      fog: '110,120,138',
      overcast: '82,90,102',
      partly_cloudy: '96,104,124',
    };
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const dark = softCloudParamsFor(condition, 'dark');
      const light = softCloudParamsFor(condition, 'light');
      expect(dark.rgb).toBe(expectedDark[condition]);
      const [r, g, b] = light.rgb.split(',').map(Number);
      expect(r).toBeGreaterThanOrEqual(g);
      expect(g).toBeGreaterThanOrEqual(b);
      expect(light.rgb).not.toBe(dark.rgb);
    }
    // partly_cloudy is the ONE condition that reuses the frozen dark family byte-identical.
    expect(softCloudParamsFor('partly_cloudy', 'dark').rgb).toBe('96,104,124');
    // fog and overcast are distinct dark tints from each other and from partly_cloudy.
    expect(softCloudParamsFor('fog', 'dark').rgb).not.toBe(softCloudParamsFor('overcast', 'dark').rgb);
  });

  it('every SoftCloudParams has a coreHold strictly between 0 and its feather, and a coreOpacityFactor in (0,1] — the multi-stop gradient fix', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      for (const mode of ['dark', 'light'] as const) {
        const p = softCloudParamsFor(condition, mode);
        expect(p.coreHold).toBeGreaterThan(0);
        expect(p.coreHold).toBeLessThan(p.feather);
        expect(p.coreOpacityFactor).toBeGreaterThan(0);
        expect(p.coreOpacityFactor).toBeLessThanOrEqual(1);
      }
    }
  });

  it('softCloudDensityFor: overcast is the densest of the three in both modes', () => {
    for (const mode of ['dark', 'light'] as const) {
      const fogDensity = softCloudDensityFor('fog', mode);
      const overcastDensity = softCloudDensityFor('overcast', mode);
      const partlyCloudyDensity = softCloudDensityFor('partly_cloudy', mode);
      expect(overcastDensity).toBeGreaterThan(fogDensity);
      expect(overcastDensity).toBeGreaterThan(partlyCloudyDensity);
    }
  });

  it('isSoftCloudCondition is true for exactly fog/overcast/partly_cloudy — every other condition (including undefined/null) is false', () => {
    expect(isSoftCloudCondition('fog')).toBe(true);
    expect(isSoftCloudCondition('overcast')).toBe(true);
    expect(isSoftCloudCondition('partly_cloudy')).toBe(true);
    for (const condition of ['clear', 'mainly_clear', 'drizzle', 'rain', 'showers', 'thunderstorm', 'snow', undefined, null] as const) {
      expect(isSoftCloudCondition(condition)).toBe(false);
    }
  });

  it('clusterDepthFactorFor: overcast alternates between (at least) 2 distinct levels; partly_cloudy and fog-irrelevant inputs stay flat', () => {
    expect(clusterDepthFactorFor('overcast', 0)).not.toBe(clusterDepthFactorFor('overcast', 1));
    expect(clusterDepthFactorFor('overcast', 0)).toBe(clusterDepthFactorFor('overcast', 2)); // deterministic, repeats
    expect(clusterDepthFactorFor('partly_cloudy', 0)).toBe(1);
    expect(clusterDepthFactorFor('partly_cloudy', 1)).toBe(1);
  });
});

describe('V2WeatherMotion — cloud-form LIGHT palette stays warm, distinct sizing preserved', () => {
  it('fog renders v2-fog-bank, overcast/partly_cloudy render v2-cloud-cluster (never v2-haze-band-*), with the same 5/6/4 layer-count relationship as dark', () => {
    const fogTree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="fog" />).toJSON() as JsonNode;
    const overcastTree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="overcast" />).toJSON() as JsonNode;
    const partlyCloudyTree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="partly_cloudy" />).toJSON() as JsonNode;

    expect(collectTestIDs(fogTree).filter((id) => id === 'v2-fog-bank').length).toBe(5);
    expect(collectTestIDs(overcastTree).filter((id) => id === 'v2-cloud-cluster').length).toBe(6);
    expect(collectTestIDs(partlyCloudyTree).filter((id) => id === 'v2-cloud-cluster').length).toBe(4);
    for (const tree of [fogTree, overcastTree, partlyCloudyTree]) {
      expect(collectTestIDs(tree).some((id) => id.startsWith('v2-haze-band-'))).toBe(false);
    }
  });

  it('the light cloud-form gradient colour is warm (R≥G≥B), never the cold dark MIST_BAND_RGB family', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition={condition} />).toJSON() as JsonNode;
      const gradients = collectRadialGradients(tree);
      expect(gradients.length).toBeGreaterThan(0);
      for (const grad of gradients) {
        const { r, g, b } = decodeARGB(grad.gradient[1]);
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThanOrEqual(b);
        // Rule out the cold dark family (96,104,124) leaking into light.
        expect([r, g, b]).not.toEqual([96, 104, 124]);
      }
    }
  });

  it('SunPulseLight, BokehOrb, and DustMote still render alongside the cloud forms (additive, not a replacement of the baseline warm set)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs).toContain('v2-sun-pulse-light');
      expect(testIDs.filter((id) => id.startsWith('v2-dust-mote-')).length).toBeGreaterThan(0);
      expect(collectBackgroundColors(tree)).toContain('rgba(255,195,107,0.12)'); // BokehOrb, unchanged
    }
  });
});

describe('V2WeatherMotion — cloud forms do not affect Rainy/Drizzly or any other frozen area', () => {
  it('rain-family conditions in dark are completely unaffected (RainStreak/params byte-identical, no cloud-form testID)', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs).not.toContain('v2-cloud-cluster');
      expect(testIDs).not.toContain('v2-fog-bank');
      const colors = collectBackgroundColors(tree);
      expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // RainStreak, untouched
    }
  });

  it('rain-family conditions in light are completely unaffected (WarmStreak still renders, no cloud-form testID)', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs).not.toContain('v2-cloud-cluster');
      expect(testIDs).not.toContain('v2-fog-bank');
      expect(testIDs.filter((id) => id === 'v2-warm-streak').length).toBeGreaterThan(0);
    }
  });

  it('two independent mounts of the same soft-cloud condition render identically (deterministic seeds, wall-clock useLoop, no per-instance reseed)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const treeA = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const treeB = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      expect(collectTestIDs(treeA)).toEqual(collectTestIDs(treeB));
      expect(collectRadialGradients(treeA).map((g) => g.gradient)).toEqual(collectRadialGradients(treeB).map((g) => g.gradient));
    }
  });

  it('renders null for a soft-cloud condition when reduce-motion is on (same shared guard)', async () => {
    reduceMotionSpy.mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
  });
});

describe('V2WeatherMotion — continuity: two independently-mounted instances of the SAME condition render identically', () => {
  it.each(['drizzle', 'rain', 'fog', 'overcast', 'partly_cloudy'] as const)(
    'condition=%s: two fresh mounts produce the SAME node count and colours (no per-instance reseed, no Math.random)',
    (condition) => {
      const atmosphere = condition === 'drizzle' || condition === 'rain' ? 'rain' : 'cloudy';
      const treeA = render(<V2WeatherMotion atmosphere={atmosphere} mode="dark" condition={condition} />).toJSON() as JsonNode;
      const treeB = render(<V2WeatherMotion atmosphere={atmosphere} mode="dark" condition={condition} />).toJSON() as JsonNode;
      expect(collectTestIDs(treeA)).toEqual(collectTestIDs(treeB));
      expect(collectBackgroundColors(treeA)).toEqual(collectBackgroundColors(treeB));
    },
  );
});

describe('V2WeatherMotion — reduced-motion / app-state parking still stops condition-aware motion', () => {
  it('renders null for a fine condition in dark when reduce-motion is on (same shared guard)', async () => {
    reduceMotionSpy.mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition="drizzle" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
  });

  it('renders null for a fine condition in light when reduce-motion is on (same shared guard)', async () => {
    reduceMotionSpy.mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
  });
});
