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
  lightRainStreakPlanFor,
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

// ── LIGHT WEATHER PARITY (2026-07-24 ruling — SUPERSEDES the earlier "light
// renders one warm ambient set for every atmosphere" rule). Two prior states
// were both rejected on device: (1) branching by atmosphere like dark painted
// the light screen cold blue-grey; (2) the over-correction collapsed every
// non-sunny weather into the same warm sandy render (rain/fog/overcast/snow
// indistinguishable). The current ruling keeps the warm sandy BASE permanent
// (SunPulseLight + BokehOrb in EVERY light atmosphere) but gives each weather
// its own explicit, VISIBLE, cool-but-restrained layer. These pins assert the
// warm base + the "no dark-particle colour leaks into light" guarantee across
// all 5 atmospheres; per-condition layers are asserted in their own blocks
// lower down.
describe('V2WeatherMotion — LIGHT keeps the permanent warm base for every atmosphere', () => {
  it.each(ATMOSPHERES)('light+%s renders the warm base (SunPulseLight + warm bokeh) and at least some dust', (atmosphere) => {
    const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as JsonNode;
    const testIDs = collectTestIDs(tree);
    expect(testIDs).toContain('v2-sun-pulse-light');
    expect(collectBackgroundColors(tree)).toContain('rgba(255,195,107,0.12)'); // BokehOrb, warm, unchanged
    expect(testIDs.filter((id) => id.startsWith('v2-dust-mote-')).length).toBeGreaterThanOrEqual(2);
  });

  it.each(ATMOSPHERES)(
    'light+%s NEVER renders a DARK-only particle colour (dark RainStreak/MistBand/Snowflake/Star must never leak into light)',
    (atmosphere) => {
      const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" />).toJSON() as JsonNode;
      const colors = collectBackgroundColors(tree);
      expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(false); // dark RainStreak
      expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false); // dark MistBand / dark partly_cloudy tint
      expect(colors).not.toContain('rgba(235,242,252,0.9)'); // dark Snowflake
      expect(colors).not.toContain('#E8ECF8'); // Star (dark-only, always)
    },
  );

  it('sunny/clear (non-weather) keeps the warm haze + golden dust; a weather condition swaps that warm layer out for its own', () => {
    const sunny = render(<V2WeatherMotion atmosphere="sunny" mode="light" condition="clear" />).toJSON() as JsonNode;
    expect(collectTestIDs(sunny).filter((id) => id.startsWith('v2-haze-band-')).length).toBeGreaterThanOrEqual(2);
    expect(collectBackgroundColors(sunny)).toContain('#FFD696'); // warm gold dust
    // Rain (a weather condition) replaces the warm haze with its own cool layer — no warm haze bands.
    const rain = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode;
    expect(collectTestIDs(rain).filter((id) => id.startsWith('v2-haze-band-')).length).toBe(0);
    // Snow likewise — its own flake layer, no warm haze.
    const snow = render(<V2WeatherMotion atmosphere="snow" mode="light" condition="snow" />).toJSON() as JsonNode;
    expect(collectTestIDs(snow).filter((id) => id.startsWith('v2-haze-band-')).length).toBe(0);
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
    expect(countCluster(overcastTree)).toBe(7); // 5–7 larger overlapping cloud groups, per spec (SIXTH pass: 6→7)
    expect(countCluster(partlyCloudyTree)).toBe(4); // 3–4 distinct cloud groups, per spec — fewest
    expect(countCluster(overcastTree)).toBeGreaterThan(countCluster(partlyCloudyTree));

    // Numeric relationship straight from the pure param resolver: overcast is
    // measurably heavier (opacity) than partly_cloudy; fog is the
    // slowest/softest (longest duration, widest feather) of the three.
    const fogParams = softCloudParamsFor('fog', 'dark');
    const overcastParams = softCloudParamsFor('overcast', 'dark');
    const partlyCloudyParams = softCloudParamsFor('partly_cloudy', 'dark');
    expect(overcastParams.opacityBase).toBeGreaterThan(partlyCloudyParams.opacityBase);
    // SIXTH pass: Liam's device verdict for overcast was explicitly
    // "do not raise opacity, this is a structure problem" — this pass
    // LOWERS overcast's raw peak opacity while raising fog's, so overcast is
    // no longer heavier than fog by raw opacityBase alone. It remains the
    // heaviest of the three by COMBINED coverage/density (layer count × size
    // × opacity — see softCloudDensityFor/approxCoverage below), which is
    // asserted instead.
    expect(softCloudDensityFor('overcast', 'dark')).toBeGreaterThan(softCloudDensityFor('fog', 'dark'));
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
    expect(lefts.length).toBe(7); // SIXTH pass: overcast cluster count 6→7
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

  it('visibility recovered (HISTORICAL PIN, THIRD→FOURTH-pass delta only — superseded by the SIXTH-pass pin below, since a further size/opacity change happened after this ratio was captured): size ×1.5, opacityBase ×~1.3 (both modes), coreHold and coreOpacityFactor both raised', () => {
    const before = { sizeWBase: 160, sizeHBase: 100, opacityBaseDark: 0.16, opacityBaseLight: 0.11, coreHold: 0.45, coreOpacityFactor: 0.85 };
    // Frozen FOURTH-pass reference values (not re-read from source) — this
    // is what "after" looked like at the end of the FOURTH pass, before the
    // SIXTH pass changed size/opacity/coreOpacityFactor again.
    const fourthPassAfter = { sizeWBase: 240, sizeHBase: 150, opacityBaseDark: 0.21, opacityBaseLight: 0.14, coreHold: 0.54, coreOpacityFactor: 0.92 };
    expect(fourthPassAfter.sizeWBase / before.sizeWBase).toBeCloseTo(1.5, 5);
    expect(fourthPassAfter.sizeHBase / before.sizeHBase).toBeCloseTo(1.5, 5);
    expect(fourthPassAfter.opacityBaseDark / before.opacityBaseDark).toBeGreaterThan(1.25);
    expect(fourthPassAfter.opacityBaseLight / before.opacityBaseLight).toBeGreaterThan(1.2);
    expect(fourthPassAfter.coreHold).toBeGreaterThan(before.coreHold);
    expect(fourthPassAfter.coreOpacityFactor).toBeGreaterThan(before.coreOpacityFactor);
  });

  it('SIXTH pass (2026-07-23): size raised a further ~13% (not another ×1.5 — a much bigger cluster would eat the "clear sky between clusters" spec on a real, narrow phone screen), opacityBase raised further (dark stays inside the 0.16-0.25 band), coreOpacityFactor raised again; feather/coreHold/cluster-count unchanged', () => {
    const fourthPassAfter = { sizeWBase: 240, sizeHBase: 150, opacityBaseDark: 0.21, opacityBaseLight: 0.14, coreOpacityFactor: 0.92 };
    const after = softCloudParamsFor('partly_cloudy', 'dark');
    const afterLight = softCloudParamsFor('partly_cloudy', 'light');
    expect(after.sizeWBase / fourthPassAfter.sizeWBase).toBeCloseTo(270 / 240, 5);
    expect(after.sizeHBase / fourthPassAfter.sizeHBase).toBeCloseTo(170 / 150, 5);
    expect(after.opacityBase).toBeGreaterThan(fourthPassAfter.opacityBaseDark);
    expect(afterLight.opacityBase).toBeGreaterThan(fourthPassAfter.opacityBaseLight);
    expect(after.coreOpacityFactor).toBeGreaterThan(fourthPassAfter.coreOpacityFactor);
    expect(after.feather).toBe(0.90);
    expect(after.coreHold).toBe(0.54);
    // Dark opacity stays inside the existing 0.16-0.25 target band.
    expect(after.opacityBase).toBeGreaterThanOrEqual(0.16);
    expect(after.opacityBase).toBeLessThanOrEqual(0.25);
    // Still stays below both overcast and fog's width — existing invariant.
    const overcast = softCloudParamsFor('overcast', 'dark');
    const fog = softCloudParamsFor('fog', 'dark');
    expect(after.sizeWBase).toBeLessThan(overcast.sizeWBase);
    expect(after.sizeWBase).toBeLessThan(fog.sizeWBase);
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

  it('overcast (7, SIXTH pass: was 6) has more clusters than partly_cloudy (4)', () => {
    expect(softCloudNodesFor('overcast').length).toBeGreaterThan(softCloudNodesFor('partly_cloudy').length);
  });

  it('overcast combined coverage/density is greater than partly cloudy in both modes (softCloudDensityFor) and by the coverage proxy above', () => {
    expect(softCloudDensityFor('overcast', 'dark')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'dark'));
    expect(softCloudDensityFor('overcast', 'light')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'light'));
    expect(approxCoverage('overcast')).toBeGreaterThan(approxCoverage('partly_cloudy'));
  });

  it('overcast visibility recovered (HISTORICAL PIN, THIRD→FOURTH-pass delta only — superseded by the SIXTH-pass test below, which INTENTIONALLY REVERSES the height/coreOpacityFactor direction on Liam\'s explicit "structure not opacity" instruction): width ×1.1 (kept below fog\'s width so fog stays widest), height ×1.5, opacityBase up, coreOpacityFactor up', () => {
    const before = { sizeWBase: 300, sizeHBase: 170, opacityBaseDark: 0.22, opacityBaseLight: 0.13, coreOpacityFactor: 0.88 };
    // Frozen FOURTH-pass reference values (not re-read from source).
    const fourthPassAfter = { sizeWBase: 330, sizeHBase: 255, opacityBaseDark: 0.27, opacityBaseLight: 0.17, coreOpacityFactor: 0.94 };
    expect(fourthPassAfter.sizeWBase / before.sizeWBase).toBeCloseTo(1.1, 5);
    expect(fourthPassAfter.sizeHBase / before.sizeHBase).toBeCloseTo(1.5, 5);
    expect(fourthPassAfter.opacityBaseDark).toBeGreaterThan(before.opacityBaseDark);
    expect(fourthPassAfter.opacityBaseLight).toBeGreaterThan(before.opacityBaseLight);
    expect(fourthPassAfter.coreOpacityFactor).toBeGreaterThan(before.coreOpacityFactor);
  });

  it('SIXTH pass (2026-07-23) — device verdict "do not raise opacity, this is a structure problem": sizeHBase cut ~24% (stops clusters merging vertically), opacityBase/opacityVar and coreOpacityFactor DELIBERATELY LOWERED from the FOURTH-pass values, cluster count 6→7 and width unchanged', () => {
    const fourthPassAfter = { sizeWBase: 330, sizeHBase: 255, opacityBaseDark: 0.27, opacityBaseLight: 0.17, coreOpacityFactor: 0.94 };
    const after = softCloudParamsFor('overcast', 'dark');
    const afterLight = softCloudParamsFor('overcast', 'light');
    const fog = softCloudParamsFor('fog', 'dark');
    // Width is UNCHANGED this pass — still below fog's width.
    expect(after.sizeWBase).toBe(fourthPassAfter.sizeWBase);
    expect(after.sizeWBase).toBeLessThan(fog.sizeWBase);
    // Height is CUT, not grown — the actual fix for the "grey sheet" defect.
    expect(after.sizeHBase).toBeLessThan(fourthPassAfter.sizeHBase);
    expect(after.sizeHBase / fourthPassAfter.sizeHBase).toBeCloseTo(195 / 255, 5);
    // Opacity and coreOpacityFactor both LOWERED, per Liam's explicit instruction.
    expect(after.opacityBase).toBeLessThan(fourthPassAfter.opacityBaseDark);
    // The SIXTH pass lowered overcast's DARK opacity; its LIGHT opacity was
    // later RAISED by the 2026-07-24 Light-parity ruling (neutral-grey overcast
    // must read on cream), so light is no longer below the FOURTH-pass figure —
    // asserted against the live parity value instead.
    expect(afterLight.opacityBase).toBeCloseTo(0.23, 10);
    expect(after.coreOpacityFactor).toBeLessThan(fourthPassAfter.coreOpacityFactor);
    // Cluster count raised instead (5-7 target range).
    expect(softCloudNodesFor('overcast').length).toBe(7);
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

  it("fog's LIGHT opacity was raised by the 2026-07-24 Light-parity ruling (was the FOURTH/FIFTH-pass 0.155/0.07125) — asserted against the live parity value", () => {
    // Dark has moved across the FOURTH/FIFTH/SIXTH passes; light was untouched
    // until the 2026-07-24 Light-parity ruling raised it so the pearl-grey fog
    // reads on the cream base. Live value asserted below.
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fogLight.opacityBase).toBeCloseTo(0.24, 10);
    expect(fogLight.opacityVar).toBeCloseTo(0.09, 10);
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

describe('V2WeatherMotion — FIFTH pass: fog dark-mode visibility bump (+10-15%), light untouched, everything else pinned (HISTORICAL — see the SIXTH-pass describe block below for the live fog-dark/overcast/partly_cloudy numbers; fog dark has since moved again, and overcast/partly_cloudy are no longer untouched)', () => {
  it("HISTORICAL PIN: fog's dark peak opacity (opacityBase+opacityVar) rose by 10-15% over the FOURTH-pass value at the END of the FIFTH pass (frozen reference values, not re-read from source — the live value has since moved again in the SIXTH pass, see below)", () => {
    const fourthPassPeak = 0.24 + 0.09875;
    const fifthPassPeak = 0.268 + 0.110;
    expect(fifthPassPeak / fourthPassPeak).toBeGreaterThanOrEqual(1.10);
    expect(fifthPassPeak / fourthPassPeak).toBeLessThanOrEqual(1.15);
  });

  it("fog's LIGHT opacityBase/opacityVar were raised by the 2026-07-24 Light-parity ruling (was 0.155/0.07125 through the SIXTH pass) — live parity value", () => {
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fogLight.opacityBase).toBeCloseTo(0.24, 10);
    expect(fogLight.opacityVar).toBeCloseTo(0.09, 10);
  });

  it("fog's size/feather/coreHold/coreOpacityFactor/yBase/yRange/duration/driftFactor are pinned — only opacity has ever moved, across the FOURTH/FIFTH/SIXTH passes", () => {
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

  it('fog dark RGB tint is frozen (110,120,138); light tint became a neutral pearl-grey (210,212,216) in the 2026-07-24 Light-parity ruling', () => {
    const fogDark = softCloudParamsFor('fog', 'dark');
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fogDark.rgb).toBe('110,120,138');
    expect(fogLight.rgb).toBe('210,212,216');
  });

  // The two tests that used to live here ("overcast/partly_cloudy params are
  // completely untouched by the fog-only fix") are REMOVED, not just edited:
  // their entire premise — that this was a fog-only pass — is no longer
  // true. The SIXTH pass (2026-07-23, see the dedicated "FOURTH pass: ..."
  // describe blocks above, which now each carry a SIXTH-pass follow-up test)
  // deliberately changes BOTH overcast and partly_cloudy's size/opacity/
  // coreOpacityFactor, per Liam's device verdict. Coverage of their current
  // values lives in those SIXTH-pass assertions instead of being duplicated
  // here.

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

// ═════════════════════════════════════════════════════════════════════════
// SIXTH PASS (2026-07-23) — device verdict: partly_cloudy still "almost
// invisible"; overcast "reads as a broad grey glow, not clouds" with an
// explicit "do not raise opacity" instruction; fog "mostly correct, raise a
// further ~20%". See V2WeatherMotion.tsx's SIXTH-pass file-header note for
// the full per-condition reasoning. Uses ONLY the levers proven independent
// of the no-edge invariant (peak opacity, nominal size, layer count,
// coreHold/coreOpacityFactor) — GRADIENT_ZERO_TARGET, CLOUD_CANVAS_PAD,
// puffGradientRadiusFraction, every condition's `feather`, and the
// Rect-not-Ellipse shape are BYTE-IDENTICAL to the THIRD pass.
// ═════════════════════════════════════════════════════════════════════════
describe('V2WeatherMotion — SIXTH pass: live literal pins for fog(dark)/overcast/partly_cloudy', () => {
  it('fog: dark opacityBase/opacityVar are the SIXTH-pass literals (dark frozen); light is the NEW 2026-07-24 parity value (raised so pearl-grey fog reads on cream)', () => {
    const fog = softCloudParamsFor('fog', 'dark');
    const fogLight = softCloudParamsFor('fog', 'light');
    expect(fog.opacityBase).toBeCloseTo(0.3216, 10);
    expect(fog.opacityVar).toBeCloseTo(0.132, 10);
    expect(fog.opacityBase / 0.268).toBeCloseTo(1.2, 5);
    expect(fogLight.opacityBase).toBeCloseTo(0.24, 10); // 2026-07-24 Light parity (was 0.155)
    expect(fogLight.opacityVar).toBeCloseTo(0.09, 10); // 2026-07-24 Light parity (was 0.07125)
  });

  it('overcast: cluster count is 7, sizeHBase/sizeHVar and opacityBase/opacityVar/coreOpacityFactor are all the new (LOWERED, except count/size which the brief asks to change the other way) SIXTH-pass literals; sizeWBase/feather/coreHold are pinned unchanged', () => {
    expect(softCloudNodesFor('overcast').length).toBe(7);
    const overcastDark = softCloudParamsFor('overcast', 'dark');
    const overcastLight = softCloudParamsFor('overcast', 'light');
    expect(overcastDark.sizeHBase).toBe(195);
    expect(overcastDark.sizeHVar).toBe(95);
    expect(overcastDark.opacityBase).toBeCloseTo(0.25, 10);
    expect(overcastDark.opacityVar).toBeCloseTo(0.11, 10);
    expect(overcastLight.opacityBase).toBeCloseTo(0.23, 10); // 2026-07-24 Light parity (was 0.15)
    expect(overcastLight.opacityVar).toBeCloseTo(0.09, 10); // 2026-07-24 Light parity (was 0.065)
    expect(overcastDark.coreOpacityFactor).toBeCloseTo(0.85, 10);
    // Pinned, unchanged this pass.
    expect(overcastDark.sizeWBase).toBe(330);
    expect(overcastDark.sizeWVar).toBe(143);
    expect(overcastDark.feather).toBe(0.78);
    expect(overcastDark.coreHold).toBe(0.47);
  });

  it('partly_cloudy: size/opacity/coreOpacityFactor are all the new SIXTH-pass literals; feather/coreHold/cluster-count are pinned unchanged', () => {
    const partlyDark = softCloudParamsFor('partly_cloudy', 'dark');
    const partlyLight = softCloudParamsFor('partly_cloudy', 'light');
    expect(partlyDark.sizeWBase).toBe(270);
    expect(partlyDark.sizeWVar).toBe(135);
    expect(partlyDark.sizeHBase).toBe(170);
    expect(partlyDark.sizeHVar).toBe(85);
    expect(partlyDark.opacityBase).toBeCloseTo(0.23, 10);
    expect(partlyDark.opacityVar).toBeCloseTo(0.10, 10);
    expect(partlyLight.opacityBase).toBeCloseTo(0.19, 10); // 2026-07-24 Light parity (was 0.145)
    expect(partlyLight.opacityVar).toBeCloseTo(0.07, 10); // 2026-07-24 Light parity (was 0.055)
    expect(partlyDark.coreOpacityFactor).toBeCloseTo(0.95, 10);
    // Pinned, unchanged this pass.
    expect(partlyDark.feather).toBe(0.90);
    expect(partlyDark.coreHold).toBe(0.54);
    expect(softCloudNodesFor('partly_cloudy').length).toBe(4);
  });

  it('overcast remains the heaviest of the three by COMBINED density/coverage in both modes, even though its raw peak opacity is now below fog\'s (dark) — this is the intended, documented inversion from Liam\'s "structure not opacity" instruction', () => {
    expect(softCloudDensityFor('overcast', 'dark')).toBeGreaterThan(softCloudDensityFor('fog', 'dark'));
    expect(softCloudDensityFor('overcast', 'dark')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'dark'));
    expect(softCloudDensityFor('overcast', 'light')).toBeGreaterThan(softCloudDensityFor('fog', 'light'));
    expect(softCloudDensityFor('overcast', 'light')).toBeGreaterThan(softCloudDensityFor('partly_cloudy', 'light'));
    // The intentional inversion, stated explicitly and positively (not just
    // as an absence of the old assertion): fog's dark opacityBase is now
    // numerically higher than overcast's.
    const fogDark = softCloudParamsFor('fog', 'dark');
    const overcastDark = softCloudParamsFor('overcast', 'dark');
    expect(fogDark.opacityBase).toBeGreaterThan(overcastDark.opacityBase);
  });

  it('the no-edge invariant (GRADIENT_ZERO_TARGET/CLOUD_CANVAS_PAD/puffGradientRadiusFraction) and the fade-ramp guard both still hold for all three conditions after the SIXTH pass — none of the four frozen levers (feather values, the Rect shape, the two constants) were touched', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const p = softCloudParamsFor(condition, 'dark');
      const r = puffGradientRadiusFraction(p.feather);
      expect(r * p.feather).toBeCloseTo(0.4, 10);
      expect(r * p.feather).toBeLessThan(0.5);
      const ramp = (p.feather - p.coreHold) * r;
      expect(ramp).toBeGreaterThanOrEqual(0.145);

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
      const rects = collectRects(tree);
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        const x = pctToFraction(rect.x) * 100;
        const y = pctToFraction(rect.y) * 100;
        const w = pctToFraction(rect.width) * 100;
        const h = pctToFraction(rect.height) * 100;
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x + w).toBeLessThan(100);
        expect(y + h).toBeLessThan(100);
      }
    }
  });

  it('no cluster/bank wrapper is a full-screen overlay and none exposes a flat backgroundColor, post-SIXTH-pass (screenW mocked to 750 in jest)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition={condition} />).toJSON() as JsonNode;
      let checked = 0;
      (function walk(node: JsonNode) {
        if (!node) return;
        if (node.props?.testID === 'v2-cloud-cluster' || node.props?.testID === 'v2-fog-bank') {
          const style = flattenStyle(node);
          expect(style.backgroundColor).toBeUndefined();
          expect(typeof style.width).toBe('number');
          expect(style.width as number).toBeLessThan(750);
          checked += 1;
        }
        for (const child of node.children ?? []) walk(child);
      })(tree);
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('Rainy/Drizzly are unaffected by the SIXTH pass (dark RainStreak colour + params; light muted-blue-grey LightRainStreak) — no cloud-form testID leaks in', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const darkTree = render(<V2WeatherMotion atmosphere="rain" mode="dark" condition={condition} />).toJSON() as JsonNode;
      const darkColors = collectBackgroundColors(darkTree);
      expect(darkColors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true);
      expect(collectTestIDs(darkTree)).not.toContain('v2-cloud-cluster');
      expect(collectTestIDs(darkTree)).not.toContain('v2-fog-bank');

      const lightTree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition={condition} />).toJSON() as JsonNode;
      expect(collectTestIDs(lightTree).filter((id) => id === 'v2-light-rain-streak').length).toBeGreaterThan(0);
      expect(collectTestIDs(lightTree)).not.toContain('v2-cloud-cluster');
      expect(collectTestIDs(lightTree)).not.toContain('v2-fog-bank');
    }
  });
});

describe('V2WeatherMotion — LIGHT rain family: muted blue-grey streaks + subtle cool veil (cool-but-restrained)', () => {
  it('rain-family conditions render the muted-blue-grey LightRainStreak layer + a subtle cool veil, over the warm base, never the dark RainStreak/MistBand/Star colours', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs.filter((id) => id === 'v2-light-rain-streak').length).toBeGreaterThan(0);
      expect(testIDs.some((id) => id.startsWith('v2-cool-veil-'))).toBe(true);
      const colors = collectBackgroundColors(tree);
      // The ONE cool element — a MUTED blue-grey streak (92,112,140), never the
      // dark RainStreak family, never a background wash.
      expect(colors.some((c) => c.startsWith('rgba(92,112,140,'))).toBe(true);
      expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(false); // dark RainStreak colour
      expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false); // dark MistBand colour
      expect(colors).not.toContain('#E8ECF8'); // Star
      // Warm base persists under the cool layer (permanent sandy identity).
      expect(testIDs).toContain('v2-sun-pulse-light');
      expect(colors).toContain('rgba(255,195,107,0.12)'); // BokehOrb, warm
    }
  });

  it('rain vs drizzle: rain is denser (more streaks) + more intense (higher opacity, thicker, faster) than drizzle', () => {
    const countStreaks = (n: JsonNode) => collectTestIDs(n).filter((id) => id === 'v2-light-rain-streak').length;
    const drizzle = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="drizzle" />).toJSON() as JsonNode;
    const rain = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode;
    expect(countStreaks(drizzle)).toBeGreaterThan(0);
    expect(countStreaks(drizzle)).toBeLessThan(countStreaks(rain));
    // Pure param check: drizzle is lighter/thinner/slower than rain.
    // (Showers is intentionally NOT compared here — it's out of scope for the
    // tuning pass and restored to its pre-task config; see the "density" test below.)
    const d = lightRainStreakPlanFor('drizzle').params;
    const r = lightRainStreakPlanFor('rain').params;
    expect(d.opacityBase).toBeLessThan(r.opacityBase);
    expect(d.widthBase).toBeLessThan(r.widthBase);
    expect(d.durationBaseMs).toBeGreaterThan(r.durationBaseMs); // slower fall
  });

  it('thunderstorm reuses the dense rain streak plan (its distinct signature is the lightning glow, asserted separately)', () => {
    expect(lightRainStreakPlanFor('thunderstorm')).toEqual(lightRainStreakPlanFor('rain'));
  });

  it('non-rain conditions (fog/overcast/partly_cloudy/snow/clear) never render the rain-streak or cool-veil layer', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition={condition} />).toJSON() as JsonNode;
      expect(collectTestIDs(tree)).not.toContain('v2-light-rain-streak');
      expect(collectTestIDs(tree).some((id) => id.startsWith('v2-cool-veil-'))).toBe(false);
    }
    const snow = render(<V2WeatherMotion atmosphere="snow" mode="light" condition="snow" />).toJSON() as JsonNode;
    expect(collectTestIDs(snow)).not.toContain('v2-light-rain-streak');
    const clear = render(<V2WeatherMotion atmosphere="sunny" mode="light" condition="clear" />).toJSON() as JsonNode;
    expect(collectTestIDs(clear)).not.toContain('v2-light-rain-streak');
  });

  it('LIGHT stays RESTRAINED: the warm base marker (#FFD696) is always present, and NO rendered colour is a saturated cold blue (blue never leads R/G by a strong margin) — for every condition', () => {
    const conditions: (import('@/lib/weather').WeatherCondition | undefined)[] = [
      undefined, 'clear', 'mainly_clear', 'partly_cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'showers', 'thunderstorm', 'snow',
    ];
    for (const condition of conditions) {
      const atmosphere =
        condition === 'snow'
          ? 'snow'
          : condition === 'drizzle' || condition === 'rain' || condition === 'showers' || condition === 'thunderstorm'
            ? 'rain'
            : 'sunny';
      const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" condition={condition} />).toJSON() as JsonNode;
      const colors = collectBackgroundColors(tree);
      for (const c of colors) {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) continue; // hex literals (#FFD696) checked separately below
        const [, r, g, b] = m.map(Number) as unknown as [number, number, number, number];
        // Blue may lead a NEUTRAL tone slightly, but never by a strong margin —
        // this rules out the cold slate-blue that was rejected on device.
        expect(b - Math.max(r, g)).toBeLessThanOrEqual(40);
      }
      expect(colors).toContain('#FFD696'); // warm base marker (dust), always
    }
  });

  it('renders the warm base (SunPulseLight + dust) + exactly the right weather layer for every fine condition (cloud-form / rain-streak / snowflake — never warm haze once a weather condition is active)', () => {
    for (const condition of ['fog', 'overcast', 'partly_cloudy', 'drizzle', 'rain', 'snow'] as const) {
      const atmosphere = condition === 'snow' ? 'snow' : condition === 'drizzle' || condition === 'rain' ? 'rain' : 'cloudy';
      const tree = render(<V2WeatherMotion atmosphere={atmosphere} mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs).toContain('v2-sun-pulse-light');
      expect(testIDs.filter((id) => id.startsWith('v2-dust-mote-')).length).toBeGreaterThanOrEqual(2);
      // No warm haze once any weather condition is active.
      expect(testIDs.filter((id) => id.startsWith('v2-haze-band-')).length).toBe(0);
      if (condition === 'fog') {
        // LIGHT fog = soft feathered mist layers (2026-07-24), not the cloud form.
        expect(testIDs.filter((id) => id.startsWith('v2-light-mist-layer-')).length).toBeGreaterThan(0);
        expect(testIDs).not.toContain('v2-fog-bank');
      } else if (isSoftCloudCondition(condition)) {
        // overcast / partly_cloudy — cloud clusters
        expect(testIDs.filter((id) => id === 'v2-cloud-cluster').length).toBeGreaterThan(0);
      } else if (condition === 'snow') {
        expect(testIDs.filter((id) => id === 'v2-light-snowflake').length).toBeGreaterThan(0);
      } else {
        expect(testIDs.filter((id) => id === 'v2-light-rain-streak').length).toBeGreaterThan(0);
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

    // Overcast: MORE clusters than partly_cloudy (SIXTH pass: 6→7), the
    // TALLEST cluster masses of the three, and — as of the SIXTH pass —
    // deliberately LOWER raw peak opacity than fog (Liam's device verdict:
    // overcast's heaviness must come from structure/coverage, not opacity;
    // see the softCloudDensityFor comparison a few tests below, which is
    // where "overcast is heaviest" is now actually asserted).
    expect(softCloudNodesFor('overcast').length).toBe(7);
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

  it('the same distinctness holds in light mode (opacity is dimmer overall; overcast > partly_cloudy by raw opacity in both modes, and overcast > fog by COMBINED density — see softCloudDensityFor below — even though the SIXTH pass makes fog\'s dark opacityBase the numerically higher of the two)', () => {
    const fog = softCloudParamsFor('fog', 'light');
    const overcast = softCloudParamsFor('overcast', 'light');
    const partlyCloudy = softCloudParamsFor('partly_cloudy', 'light');
    expect(overcast.opacityBase).toBeGreaterThan(partlyCloudy.opacityBase);
    expect(softCloudDensityFor('overcast', 'light')).toBeGreaterThan(softCloudDensityFor('fog', 'light'));
    expect(overcast.sizeWBase).toBeGreaterThan(partlyCloudy.sizeWBase);
    // Partly cloudy stays the lightest/narrowest of the three by raw
    // opacity/size, in light too — unaffected by the fog/overcast inversion above.
    expect(partlyCloudy.opacityBase).toBeLessThan(fog.opacityBase);
    expect(partlyCloudy.sizeWBase).toBeLessThan(fog.sizeWBase);
  });

  it('dark uses PER-CONDITION tints (partly_cloudy keeps the frozen MIST_BAND_RGB family; fog/overcast get their own); light uses a NEUTRAL (near-grey, never cold-blue) colour, distinct from the dark family', () => {
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
      // 2026-07-24 parity: light tints are NEUTRAL (pearl/stone-grey), not warm —
      // blue may lead a near-neutral tone slightly but never by a strong margin
      // (never a cold slate-blue).
      expect(b - Math.max(r, g)).toBeLessThanOrEqual(12);
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

describe('V2WeatherMotion — cloud-form LIGHT palette is neutral (not warm, not cold-blue), distinct sizing preserved', () => {
  it('LIGHT fog renders soft feathered mist LAYERS (v2-light-mist-layer), NOT the FogBank cloud form; overcast/partly_cloudy still render v2-cloud-cluster (ACCEPTED, unchanged); never v2-haze-band-*', () => {
    const fogTree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="fog" />).toJSON() as JsonNode;
    const overcastTree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="overcast" />).toJSON() as JsonNode;
    const partlyCloudyTree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="partly_cloudy" />).toJSON() as JsonNode;

    expect(collectTestIDs(fogTree).filter((id) => id.startsWith('v2-light-mist-layer-')).length).toBe(6); // 2026-07-28: raised 4→6
    expect(collectTestIDs(fogTree)).not.toContain('v2-fog-bank'); // light fog uses its own feathered mist layers, not the dark FogBank
    expect(collectTestIDs(fogTree)).not.toContain('v2-cloud-cluster');
    expect(collectTestIDs(overcastTree).filter((id) => id === 'v2-cloud-cluster').length).toBe(7); // accepted, unchanged
    expect(collectTestIDs(partlyCloudyTree).filter((id) => id === 'v2-cloud-cluster').length).toBe(4); // accepted, unchanged
    for (const tree of [fogTree, overcastTree, partlyCloudyTree]) {
      expect(collectTestIDs(tree).some((id) => id.startsWith('v2-haze-band-'))).toBe(false);
    }
  });

  it('the light cloud-CLUSTER gradient colour is NEUTRAL (near-grey, never a saturated cold blue), never the dark MIST_BAND_RGB family — overcast/partly_cloudy (fog no longer uses a gradient)', () => {
    for (const condition of ['overcast', 'partly_cloudy'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition={condition} />).toJSON() as JsonNode;
      const gradients = collectRadialGradients(tree);
      expect(gradients.length).toBeGreaterThan(0);
      for (const grad of gradients) {
        const { r, g, b } = decodeARGB(grad.gradient[1]);
        // Near-neutral: blue never leads R/G by a strong margin (rules out cold blue-grey).
        expect(b - Math.max(r, g)).toBeLessThanOrEqual(12);
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

  it('rain-family conditions in light render their own streak layer, never a cloud-form testID', () => {
    for (const condition of ['drizzle', 'rain', 'showers', 'thunderstorm'] as const) {
      const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition={condition} />).toJSON() as JsonNode;
      const testIDs = collectTestIDs(tree);
      expect(testIDs).not.toContain('v2-cloud-cluster');
      expect(testIDs).not.toContain('v2-fog-bank');
      expect(testIDs.filter((id) => id === 'v2-light-rain-streak').length).toBeGreaterThan(0);
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

// ═════════════════════════════════════════════════════════════════════════
// LIGHT WEATHER PARITY (2026-07-24) — snow visible on cream; thunderstorm
// distinct from rain via a restrained, shared-clock, reduced-motion-respecting
// lightning glow. DARK is unchanged (pinned throughout this file).
// ═════════════════════════════════════════════════════════════════════════
describe('V2WeatherMotion — LIGHT snow is visible on the cream base', () => {
  it('renders off-white LightSnowflakes with restrained grey-blue edging (visible, not vanishing into cream)', () => {
    const tree = render(<V2WeatherMotion atmosphere="snow" mode="light" condition="snow" />).toJSON() as JsonNode;
    expect(collectTestIDs(tree).filter((id) => id === 'v2-light-snowflake').length).toBeGreaterThan(0);
    const flake = findNodeByTestID(tree, 'v2-light-snowflake');
    const style = flattenStyle(flake);
    expect(style.backgroundColor).toBe('rgba(250,251,253,0.95)'); // off-white fill
    expect(style.borderColor).toBe('rgba(150,170,195,0.55)'); // grey-blue edging
    expect((style.borderWidth as number) ?? 0).toBeGreaterThan(0);
  });

  it('does NOT reuse the dark Snowflake colour and still keeps the warm base', () => {
    const tree = render(<V2WeatherMotion atmosphere="snow" mode="light" condition="snow" />).toJSON() as JsonNode;
    expect(collectBackgroundColors(tree)).not.toContain('rgba(235,242,252,0.9)'); // dark flake
    expect(collectTestIDs(tree)).toContain('v2-sun-pulse-light'); // warm base persists
  });

  it('light snow is distinct from a clear/sunny light render (which has NO flakes)', () => {
    const snow = render(<V2WeatherMotion atmosphere="snow" mode="light" condition="snow" />).toJSON() as JsonNode;
    const clear = render(<V2WeatherMotion atmosphere="sunny" mode="light" condition="clear" />).toJSON() as JsonNode;
    expect(collectTestIDs(snow).filter((id) => id === 'v2-light-snowflake').length).toBeGreaterThan(0);
    expect(collectTestIDs(clear)).not.toContain('v2-light-snowflake');
  });
});

describe('V2WeatherMotion — LIGHT thunderstorm is distinct from rain (restrained lightning glow)', () => {
  it('thunderstorm renders a lightning glow that plain rain does NOT — over the same dense rain streak layer', () => {
    const thunder = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="thunderstorm" />).toJSON() as JsonNode;
    const rain = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode;
    expect(collectTestIDs(thunder)).toContain('v2-lightning-glow');
    expect(collectTestIDs(rain)).not.toContain('v2-lightning-glow');
    expect(collectTestIDs(thunder).filter((id) => id === 'v2-light-rain-streak').length).toBeGreaterThan(0);
  });

  it('the lightning glow is RESTRAINED + broad (not a full-screen pure-white flash): a cool-white colour over a partial top region, opacity-driven', () => {
    const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="thunderstorm" />).toJSON() as JsonNode;
    const glow = findNodeByTestID(tree, 'v2-lightning-glow');
    expect(glow).not.toBeNull();
    const style = flattenStyle(glow);
    expect(style.backgroundColor).toBe('rgb(236,242,252)'); // cool-white, applied at low animated opacity
    expect(typeof style.top).toBe('string');
    expect(typeof style.height).toBe('string');
    expect(style.height).not.toBe('100%'); // never the whole screen
  });

  it('the lightning glow uses the shared wall-clock useLoop (no per-instance reseed): two independent mounts render identical trees', () => {
    const a = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="thunderstorm" />).toJSON() as JsonNode;
    const b = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="thunderstorm" />).toJSON() as JsonNode;
    expect(collectTestIDs(a)).toEqual(collectTestIDs(b));
    expect(collectBackgroundColors(a)).toEqual(collectBackgroundColors(b));
  });

  it('the lightning glow (and all thunderstorm motion) stops under reduced-motion (shared guard → null)', async () => {
    reduceMotionSpy.mockResolvedValue(true);
    const rendered = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="thunderstorm" />);
    await waitFor(() => expect(rendered.toJSON()).toBeNull());
  });
});

// ═════════════════════════════════════════════════════════════════════════
// LIGHT visual TUNING PASS (2026-07-24) — Foggy / Drizzly / Rainy only.
// Mainly clear / Partly cloudy / Overcast were accepted on device and must be
// unchanged; Dark is unchanged (pinned throughout this file).
// ═════════════════════════════════════════════════════════════════════════
describe('V2WeatherMotion — LIGHT fog: soft heavily-feathered mist layers (no hard-edged panels/stripes)', () => {
  const fogTree = () => render(<V2WeatherMotion atmosphere="cloudy" mode="light" condition="fog" />).toJSON() as JsonNode;

  it('renders 6 distinct mist LAYERS (each an indexed testID), not one repeated element — MORE than the old 4-layer treatment (2026-07-28: "too close to ordinary clear light mode")', () => {
    const layers = collectTestIDs(fogTree()).filter((id) => id.startsWith('v2-light-mist-layer-'));
    expect(layers.length).toBe(6);
    expect(layers.length).toBeGreaterThan(4); // strictly more than the pre-2026-07-28 count
    expect(new Set(layers).size).toBe(layers.length); // each layer distinct
  });

  it('every mist layer is a FEATHERED SVG blob (radial gradient whose OUTER stop is exactly 0 alpha) — never a solid-fill band/panel/stripe', () => {
    const tree = fogTree();
    // No mist-layer wrapper carries a backgroundColor or a full-bleed width — a
    // solid fill / 140%-wide band is exactly the "flat grey panel" being removed.
    (function walk(node: JsonNode) {
      if (!node) return;
      if (typeof node.props?.testID === 'string' && (node.props.testID as string).startsWith('v2-light-mist-layer-')) {
        const style = flattenStyle(node);
        expect(style.backgroundColor).toBeUndefined();
        expect(style.width).not.toBe('140%');
        expect(typeof style.width).toBe('number');
      }
      for (const child of node.children ?? []) walk(child);
    })(tree);
    // Every radial gradient fades to EXACTLY 0 alpha at its edge → no hard boundary anywhere.
    const gradients = collectRadialGradients(tree);
    expect(gradients.length).toBeGreaterThanOrEqual(3);
    for (const g of gradients) {
      const lastAlpha = (g.gradient[g.gradient.length - 1] >>> 24) & 0xff;
      expect(lastAlpha).toBe(0);
    }
  });

  it('uses a MORE PRONOUNCED cool grey/blue-white tone at a raised-but-capped opacity (2026-07-28: was too close to neutral/ordinary; still never a saturated cold blue, still never washed-out)', () => {
    const gradients = collectRadialGradients(fogTree());
    expect(gradients.length).toBeGreaterThanOrEqual(3);
    const alphas: number[] = [];
    for (const g of gradients) {
      const { r, g: green, b, a } = decodeARGB(g.gradient[1]); // peak stop
      expect(b).toBeGreaterThanOrEqual(green); // slightly cool: blue leads,
      expect(green).toBeGreaterThanOrEqual(r);
      expect(b - r).toBeGreaterThanOrEqual(25); // MORE pronounced than the old ~18 spread — genuinely cooler
      expect(b - r).toBeLessThanOrEqual(40); // …but only marginally — never a cold slate blue
      expect(a).toBeGreaterThan(0);
      // Readability ceiling: raised from the old ~0.16 peak, but deliberately
      // capped so fog never overwhelms text/cards. 0.22 × 255 ≈ 56; 61 gives
      // rounding headroom without opening the ceiling back up to "anything".
      expect(a).toBeLessThanOrEqual(61);
      alphas.push(a);
    }
    // At least one layer is obviously more opaque than the old peak (~0.16 × 255 ≈ 41) —
    // proves the raise is real, not just a ceiling that happens never to be reached.
    expect(Math.max(...alphas)).toBeGreaterThan(41);
  });

  it('layers vary in width, height and vertical position (some behind the header, some lower down)', () => {
    const widths = new Set<number>();
    const heights = new Set<number>();
    const tops: number[] = [];
    (function walk(node: JsonNode) {
      if (!node) return;
      if (typeof node.props?.testID === 'string' && (node.props.testID as string).startsWith('v2-light-mist-layer-')) {
        const style = flattenStyle(node);
        if (typeof style.width === 'number') widths.add(style.width);
        if (typeof style.height === 'number') heights.add(style.height);
        const top = parseFloat(String(style.top));
        if (!Number.isNaN(top)) tops.push(top);
      }
      for (const child of node.children ?? []) walk(child);
    })(fogTree());
    expect(widths.size).toBeGreaterThanOrEqual(3); // varied widths
    expect(heights.size).toBeGreaterThanOrEqual(3); // varied heights
    expect(Math.min(...tops)).toBeLessThan(20); // some high — behind the header
    expect(Math.max(...tops)).toBeGreaterThan(40); // some lower down the page
  });

  it('mist layers now read as wide, FLAT horizontal bands (width clearly exceeds height) rather than round puffs (2026-07-28)', () => {
    const aspects: number[] = [];
    (function walk(node: JsonNode) {
      if (!node) return;
      if (typeof node.props?.testID === 'string' && (node.props.testID as string).startsWith('v2-light-mist-layer-')) {
        const style = flattenStyle(node);
        if (typeof style.width === 'number' && typeof style.height === 'number') {
          aspects.push(style.width / style.height);
        }
      }
      for (const child of node.children ?? []) walk(child);
    })(fogTree());
    expect(aspects.length).toBe(6);
    // Every layer is a clearly-flat band — well beyond the old ~2.1:1 ratio
    // (320–560 wide / 150–270 tall), so this reads as layered haze, not puffs.
    for (const ratio of aspects) {
      expect(ratio).toBeGreaterThan(3);
    }
  });

  it('DARK fog is UNCHANGED — still the FogBank cloud form (5 banks), never the light mist layer', () => {
    const testIDs = collectTestIDs(render(<V2WeatherMotion atmosphere="cloudy" mode="dark" condition="fog" />).toJSON() as JsonNode);
    expect(testIDs.filter((id) => id === 'v2-fog-bank').length).toBe(5);
    expect(testIDs.some((id) => id.startsWith('v2-light-mist-layer-'))).toBe(false);
  });

  it('the same fog renders IDENTICALLY across independent mounts (deterministic seeds + shared wall-clock useLoop → one continuous fog phase carries between Home/Map/Saved with no reseed)', () => {
    const a = fogTree();
    const b = fogTree();
    // Same layers, same positions, same gradient stops — nothing is re-seeded or
    // re-randomised per mount, so every screen shows the SAME fog at the SAME moment.
    expect(collectTestIDs(a)).toEqual(collectTestIDs(b));
    expect(collectRadialGradients(a).map((g) => g.gradient)).toEqual(collectRadialGradients(b).map((g) => g.gradient));
  });
});

describe('V2WeatherMotion — LIGHT drizzle vs rain (tuning pass): drizzle visible but clearly weaker than rain', () => {
  const countStreaks = (n: JsonNode) => collectTestIDs(n).filter((id) => id === 'v2-light-rain-streak').length;

  it('drizzle is NOT effectively invisible — several streaks + opacity above a visibility floor', () => {
    const drizzle = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="drizzle" />).toJSON() as JsonNode;
    expect(countStreaks(drizzle)).toBeGreaterThanOrEqual(6);
    expect(lightRainStreakPlanFor('drizzle').params.opacityBase).toBeGreaterThanOrEqual(0.1);
  });

  it('drizzle stays lighter than rain on every axis: fewer streaks, fainter, thinner, shorter, slower', () => {
    const drizzle = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="drizzle" />).toJSON() as JsonNode;
    const rain = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode;
    expect(countStreaks(drizzle)).toBeLessThan(countStreaks(rain));
    const d = lightRainStreakPlanFor('drizzle').params;
    const r = lightRainStreakPlanFor('rain').params;
    expect(d.opacityBase).toBeLessThan(r.opacityBase);
    expect(d.widthBase).toBeLessThan(r.widthBase);
    expect(d.heightBase + d.heightVar).toBeLessThan(r.heightBase + r.heightVar); // shorter max length
    expect(d.durationBaseMs).toBeGreaterThan(r.durationBaseMs); // slower fall
  });

  it('the density increase is real (drizzle 10 < rain 11) AND rain paints far more total length than drizzle — proving density is real coverage, not just an opacity illusion; Showers is restored to its pre-task value (10) and left out of scope', () => {
    const drizzlePlan = lightRainStreakPlanFor('drizzle');
    const rainPlan = lightRainStreakPlanFor('rain');
    expect(drizzlePlan.nodes.length).toBe(10);
    expect(rainPlan.nodes.length).toBe(11);
    expect(drizzlePlan.nodes.length).toBeLessThan(rainPlan.nodes.length);
    // The raw count gap is small (10 vs 11) by design — the real density
    // signal is TOTAL PAINTED LENGTH (count × each node's actual rendered
    // height, which is driven by node.y since 2026-07-28 — see the
    // decorrelation test below). This must stay far higher for rain even
    // though the count difference alone would not prove it.
    const totalPaintedLength = (plan: typeof drizzlePlan) =>
      plan.nodes.reduce((sum, n) => sum + plan.params.heightBase + n.y * plan.params.heightVar, 0);
    const drizzleTotal = totalPaintedLength(drizzlePlan);
    const rainTotal = totalPaintedLength(rainPlan);
    expect(rainTotal).toBeGreaterThan(drizzleTotal * 1.5); // far higher, not marginal
    // Showers is intentionally NOT tuned by this pass — restored to pre-task 10.
    expect(lightRainStreakPlanFor('showers').nodes.length).toBe(10);
  });

  it('LIGHT rain/drizzle length is decorrelated from width/opacity/speed — a DIFFERENT seeded field (node.y) drives length than drives width/opacity/duration (node.r), fixing the old "longest streak is also thickest/most opaque/slowest" scratches defect', () => {
    const rain = lightRainStreakPlanFor('rain').params;
    const drizzle = lightRainStreakPlanFor('drizzle').params;
    const showers = lightRainStreakPlanFor('showers').params;
    expect(rain.lengthFrom).toBe('y');
    expect(drizzle.lengthFrom).toBe('y');
    // Showers is explicitly out of scope for this tuning pass — must default
    // (undefined ⇒ node.r, the original fully-correlated formula), unchanged.
    expect(showers.lengthFrom).toBeUndefined();

    // Prove it's not just a flag with no effect: for the actual seeded RAIN
    // node set, the ORDER of nodes by rendered height (node.y-driven) must
    // differ from the order by rendered opacity (node.r-driven) — if length
    // were still driven by the same field as opacity, these orders would be
    // identical.
    const { nodes, params } = lightRainStreakPlanFor('rain');
    const byHeight = nodes.map((n, i) => ({ i, v: params.heightBase + n.y * params.heightVar }));
    const byOpacity = nodes.map((n, i) => ({ i, v: params.opacityBase + n.r * params.opacityVar }));
    const heightOrder = [...byHeight].sort((a, b) => a.v - b.v).map((x) => x.i);
    const opacityOrder = [...byOpacity].sort((a, b) => a.v - b.v).map((x) => x.i);
    expect(heightOrder).not.toEqual(opacityOrder);
  });

  it('rain streak length is substantially shorter than before: new max is below the old formula\'s actual max (~106.6px, from heightBase 34 + r_max 0.981 × heightVar 74) and well below the hard 108px ceiling', () => {
    const { nodes, params } = lightRainStreakPlanFor('rain');
    const heights = nodes.map((n) => params.heightBase + n.y * params.heightVar);
    const maxHeight = Math.max(...heights);
    expect(maxHeight).toBeLessThan(108); // hard ceiling from the spec
    expect(maxHeight).toBeLessThan(90); // comfortably below the old actual max (~106.6)
  });
});

describe('V2WeatherMotion — LIGHT showers: BYTE-IDENTICAL pin (explicitly OUT OF SCOPE for the 2026-07-28 rain/drizzle/fog tuning pass)', () => {
  it('showers params are pinned to their exact pre-tuning values (including the absence of lengthFrom)', () => {
    const showers = lightRainStreakPlanFor('showers').params;
    expect(showers).toEqual({
      durationBaseMs: 640,
      durationVarMs: 520,
      widthBase: 1,
      widthVar: 0.9,
      heightBase: 56,
      heightVar: 100,
      opacityBase: 0.17,
      opacityVar: 0.13,
    });
    expect(lightRainStreakPlanFor('showers').nodes.length).toBe(10);
  });

  it('showers RENDERS with the pinned node.r-driven height formula (rendering-level pin, not just params)', () => {
    const tree = render(<V2WeatherMotion atmosphere="rain" mode="light" condition="showers" />).toJSON() as JsonNode;
    const { nodes, params } = lightRainStreakPlanFor('showers');
    const expectedHeights = nodes.map((n) => params.heightBase + n.r * params.heightVar).sort((a, b) => a - b);
    const renderedHeights: number[] = [];
    (function walk(node: JsonNode) {
      if (!node) return;
      if (node.props?.testID === 'v2-light-rain-streak') {
        const style = flattenStyle(node);
        if (typeof style.height === 'number') renderedHeights.push(style.height);
      }
      for (const child of node.children ?? []) walk(child);
    })(tree);
    expect(renderedHeights.sort((a, b) => a - b)).toEqual(expectedHeights);
  });
});

describe('V2WeatherMotion — LIGHT rain (tuning pass): varied streaks, not one uniform treatment', () => {
  /** Collects every v2-light-rain-streak node's rendered height + backgroundColor alpha. */
  function streakHeightsAndAlphas(tree: JsonNode): { heights: number[]; alphas: number[] } {
    const heights: number[] = [];
    const alphas: number[] = [];
    (function walk(node: JsonNode) {
      if (!node) return;
      if (node.props?.testID === 'v2-light-rain-streak') {
        const style = flattenStyle(node);
        if (typeof style.height === 'number') heights.push(style.height);
        const m = String(style.backgroundColor ?? '').match(/,([\d.]+)\)$/);
        if (m) alphas.push(Number(m[1]));
      }
      for (const child of node.children ?? []) walk(child);
    })(tree);
    return { heights, alphas };
  }

  it('rain streaks use VARIED lengths (a mix, not one uniform length) and are never long "scratches" (2026-07-28: max lowered from ~108px to ~70px)', () => {
    const { heights } = streakHeightsAndAlphas(render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode);
    expect(heights.length).toBeGreaterThanOrEqual(8);
    expect(new Set(heights).size).toBeGreaterThanOrEqual(4); // several distinct lengths
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(30); // meaningful short↔medium spread
    expect(Math.max(...heights)).toBeLessThan(108); // never approaches the old 108px "scratch" length
  });

  it('rain streaks use VARIED opacities, not one uniform alpha', () => {
    const { alphas } = streakHeightsAndAlphas(render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode);
    expect(new Set(alphas.map((a) => a.toFixed(3))).size).toBeGreaterThanOrEqual(4);
  });

  it('RENDERED streak length does not rank-order the same way as RENDERED opacity (2026-07-28 decorrelation, proven at the render level, not just in the pure params)', () => {
    const { heights, alphas } = streakHeightsAndAlphas(render(<V2WeatherMotion atmosphere="rain" mode="light" condition="rain" />).toJSON() as JsonNode);
    expect(heights.length).toBe(alphas.length);
    // If length and opacity were still driven by the same field (the old,
    // fully-correlated formula), sorting node indices by rendered height
    // would produce the SAME order as sorting by rendered opacity. They no
    // longer do, because height now tracks node.y and opacity still tracks
    // node.r — two independently-seeded fields.
    const heightOrder = heights.map((v, i) => i).sort((a, b) => heights[a] - heights[b]);
    const alphaOrder = alphas.map((v, i) => i).sort((a, b) => alphas[a] - alphas[b]);
    expect(heightOrder).not.toEqual(alphaOrder);
  });
});

describe('V2WeatherMotion — LIGHT tuning pass leaves the ACCEPTED treatments untouched', () => {
  it('Clear/sunny light is unchanged: warm haze + gold dust, no weather layer', () => {
    const testIDs = collectTestIDs(render(<V2WeatherMotion atmosphere="sunny" mode="light" condition="clear" />).toJSON() as JsonNode);
    expect(testIDs.filter((id) => id.startsWith('v2-haze-band-')).length).toBeGreaterThanOrEqual(2);
    expect(testIDs).not.toContain('v2-light-rain-streak');
    expect(testIDs.some((id) => id.startsWith('v2-light-mist-layer-'))).toBe(false);
    expect(testIDs).not.toContain('v2-light-snowflake');
  });

  it('Partly cloudy + Overcast LIGHT params are UNCHANGED (accepted): tints, opacities and counts pinned', () => {
    const partly = softCloudParamsFor('partly_cloudy', 'light');
    const overcast = softCloudParamsFor('overcast', 'light');
    expect(partly.rgb).toBe('196,192,188');
    expect(partly.opacityBase).toBeCloseTo(0.19, 10);
    expect(overcast.rgb).toBe('172,174,178');
    expect(overcast.opacityBase).toBeCloseTo(0.23, 10);
    expect(softCloudNodesFor('partly_cloudy').length).toBe(4);
    expect(softCloudNodesFor('overcast').length).toBe(7);
  });
});
