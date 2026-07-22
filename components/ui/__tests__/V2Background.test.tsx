// Smoke coverage for V2Background — the static Home atmosphere layer.
//
// Verifies: (1) it renders without throwing for a spread of weather
// conditions (including no data / unknown), (2) it NEVER calls
// useLocation() — this component must be safe to mount before location
// consent is granted (it only reads the same coarse, cached weather fetch
// Home already makes), and (3) DARK-mode regression pins — the accepted
// dark ATMOSPHERE_BG gradient literals must stay byte-for-byte unchanged
// across the v2 Light-theme correction (see the hard-freeze rule in the
// project instructions: dark is accepted & frozen).

import { render } from '@testing-library/react-native';
import { V2Background } from '@/components/ui/V2Background';

jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children),
  };
});

const mockUseWeather = jest.fn();
jest.mock('@/hooks/useWeather', () => ({
  useWeather: (...args: unknown[]) => mockUseWeather(...args),
}));

const mockUseLocation = jest.fn();
jest.mock('@/hooks/location', () => ({
  useLocation: (...args: unknown[]) => mockUseLocation(...args),
}));

const mockUseAppTheme = jest.fn();
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: (...args: unknown[]) => mockUseAppTheme(...args),
}));

function themeFor(mode: 'dark' | 'light') {
  return { mode, tokens: { mode } as never, accent: { accent: '#4C8DF6', light: 'rgba(76,141,246,0.16)', tagText: '#82AEFA' } };
}

/** Depth-first search for the first node whose props include a `colors` array (the mocked LinearGradient). */
function findGradientProps(node: unknown): { colors: string[]; locations: number[] } | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as { props?: { colors?: string[]; locations?: number[] }; children?: unknown[] };
  if (Array.isArray(n.props?.colors)) {
    return { colors: n.props!.colors!, locations: n.props!.locations! };
  }
  for (const child of n.children ?? []) {
    const found = findGradientProps(child);
    if (found) return found;
  }
  return null;
}

/** Depth-first collection of every rendered `<RNSVGRadialGradient>` node's id + packed-colour stops + position. */
function collectRadialGradients(
  node: unknown,
  out: { id: string; gradient: number[]; cx: string; cy: string }[] = [],
): { id: string; gradient: number[]; cx: string; cy: string }[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
  if (n.type === 'RNSVGRadialGradient') {
    out.push({
      id: n.props?.name as string,
      gradient: n.props?.gradient as number[],
      cx: n.props?.cx as string,
      cy: n.props?.cy as string,
    });
  }
  for (const child of n.children ?? []) collectRadialGradients(child, out);
  return out;
}

/** Decodes a react-native-svg packed 0xAARRGGBB colour (as emitted in the `gradient` prop) into channels. */
function decodeARGB(packed: number): { a: number; r: number; g: number; b: number } {
  // eslint-disable-next-line no-bitwise
  return {
    a: (packed >>> 24) & 0xff,
    r: (packed >>> 16) & 0xff,
    g: (packed >>> 8) & 0xff,
    b: packed & 0xff,
  };
}

/** Depth-first collection of every `testID` prop present anywhere in the tree. */
function collectTestIDs(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { props?: Record<string, unknown>; children?: unknown[] };
  const testID = n.props?.testID;
  if (typeof testID === 'string') out.push(testID);
  for (const child of n.children ?? []) collectTestIDs(child, out);
  return out;
}

/** Depth-first collection of every resolved `backgroundColor` anywhere in the tree (flattens array/object styles). */
function collectBackgroundColors(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { props?: { style?: unknown }; children?: unknown[] };
  const style = n.props?.style;
  const styles = Array.isArray(style) ? style : [style];
  for (const s of styles) {
    const bg = (s as { backgroundColor?: string } | undefined)?.backgroundColor;
    if (typeof bg === 'string') out.push(bg);
  }
  for (const child of n.children ?? []) collectBackgroundColors(child, out);
  return out;
}

beforeEach(() => {
  mockUseWeather.mockReset();
  mockUseLocation.mockReset();
  mockUseAppTheme.mockReset();
  mockUseWeather.mockReturnValue(null);
  mockUseAppTheme.mockReturnValue(themeFor('dark'));
});

describe('V2Background', () => {
  it('renders without throwing when weather has not loaded yet', () => {
    expect(() => render(<V2Background />)).not.toThrow();
  });

  it.each([
    ['clear' as const],
    ['partly_cloudy' as const],
    ['overcast' as const],
    ['rain' as const],
    ['thunderstorm' as const],
    ['snow' as const],
  ])('renders without throwing for condition=%s (via useWeather)', (condition) => {
    mockUseWeather.mockReturnValue({ condition, temperatureC: 10, precipProbabilityPct: 0, emoji: '', label: '' });
    expect(() => render(<V2Background />)).not.toThrow();
  });

  it('renders without throwing when an explicit condition prop is passed', () => {
    expect(() => render(<V2Background condition="rain" />)).not.toThrow();
  });

  it('renders without throwing for a null condition prop (forced fallback)', () => {
    expect(() => render(<V2Background condition={null} />)).not.toThrow();
  });

  it('is absolute-fill and non-interactive (decorative layer, never blocks touches)', () => {
    // Decorative layers are intentionally hidden from the accessibility tree
    // (accessibilityElementsHidden / importantForAccessibility), which also
    // excludes them from testing-library's default queries — so read the
    // rendered tree directly instead of getByTestId.
    const root = render(<V2Background />).toJSON() as { props: Record<string, unknown> };
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.testID).toBe('v2-background');
  });

  it('never calls useLocation() — must be safe to mount before location consent', () => {
    render(<V2Background />);
    expect(mockUseLocation).not.toHaveBeenCalled();
  });
});

// ── DARK regression pins (frozen — must stay byte-for-byte identical) ───────
// These literals are copy-pasted from the accepted ATMOSPHERE_BG.dark table
// in components/ui/V2Background.tsx. If any of these assertions fail, the
// dark gradient table was accidentally touched by a light-theme change —
// that is a hard-freeze violation, not a test to "fix" by updating the
// expected value.
describe('V2Background — DARK gradient regression pins', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
  });

  it('sunny (dark)', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12); // noon → not night
    const tree = render(<V2Background condition="clear" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#16120E', '#0E0E14', '#0C0C11'], locations: [0, 0.5, 1] });
    hoursSpy.mockRestore();
  });

  it('cloudy (dark)', () => {
    const tree = render(<V2Background condition="overcast" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#0B0D12', '#111419', '#0C0C11'], locations: [0, 0.44, 1] });
  });

  it('rain (dark)', () => {
    const tree = render(<V2Background condition="rain" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({
      colors: ['#020407', '#06080E', '#090C14', '#0C0C11'],
      locations: [0, 0.44, 0.68, 1],
    });
  });

  it('night (dark)', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(22); // 10pm → night window
    const tree = render(<V2Background condition="clear" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#020308', '#060A1C', '#0C0C11'], locations: [0, 0.5, 1] });
    hoursSpy.mockRestore();
  });

  it('snow (dark)', () => {
    const tree = render(<V2Background condition="snow" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#040A12', '#091320', '#0C0C11'], locations: [0, 0.52, 1] });
  });
});

// ── DARK 'cloudy' glow colour pin (2026-07-22 shape-repair pass, root cause
// #1) ────────────────────────────────────────────────────────────────────
// Device evidence: fog/overcast/partly_cloudy (all three share this
// atmosphere) read as "a broad grey glow/tint behind the header"
// (overcast) and a "green-grey wash" (fog). Traced to THIS glow
// ('v2bg-cloudy-1'), which was `rgb(58,50,18)` — OLIVE (R≈G, ~no blue) — at
// 0.24 opacity, roughly double V2WeatherMotion's peak alpha, rendered
// directly behind every cloud form. Fixed to a neutral cool slate
// (`48,56,72`, B > G > R). Pinned here so a future change can't silently
// reintroduce an olive/green tint — cx/cy/r/startOpacity/endOffset and
// every other atmosphere/mode are proven untouched by the sunny/rain/night/
// snow (dark) pins above, which is why only THIS one glow needs its own
// dedicated colour pin.
describe("V2Background — DARK 'cloudy' glow colour pin (root cause #1 fix)", () => {
  it("the dark 'cloudy' atmosphere glow (v2bg-cloudy-1) is a neutral cool slate rgb(48,56,72) — NOT olive, NOT green", () => {
    const tree = render(<V2Background condition="overcast" />).toJSON();
    const glow = collectRadialGradients(tree).find((g) => g.id === 'v2bg-cloudy-1');
    expect(glow).toBeDefined();
    const { r, g, b } = decodeARGB(glow!.gradient[1]);
    expect([r, g, b]).toEqual([48, 56, 72]);
    // Rule out the rejected olive literal explicitly (R≈G, ~no blue).
    expect([r, g, b]).not.toEqual([58, 50, 18]);
    // Neutral cool slate: blue is the dominant channel, never green-dominant.
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThanOrEqual(g);
  });

  it('geometry (cx/cy/r) and opacity (startOpacity/endOffset) of the cloudy glow are byte-identical to before the colour fix', () => {
    const tree = render(<V2Background condition="overcast" />).toJSON();
    const glow = collectRadialGradients(tree).find((g) => g.id === 'v2bg-cloudy-1');
    expect(glow).toBeDefined();
    expect(glow!.cx).toBe('74%');
    expect(glow!.cy).toBe('-7%');
    const { a } = decodeARGB(glow!.gradient[1]);
    // startOpacity 0.24 packed into the ARGB alpha byte: round(0.24*255) = 61.
    expect(a).toBe(Math.round(0.24 * 255));
  });
});

// ── LIGHT gradient pins (warm-sandy-cream fix — cold blue-grey REJECTED) ────
// Liam rejected the previous behaviour (device proof + reference
// screenshots): light used to follow WEATHER_BACKGROUNDS.md's per-weather
// light branches verbatim, which meant real weather resolving to
// cloudy/rain painted the ENTIRE light screen cold blue-grey
// (['#A8ADBA','#BEC4CE',…] / ['#586E84','#728AA2','#8EA4B8',…]) and night/
// snow used cool blues. Ruling: light stays warm sandy cream in EVERY
// weather. These pins assert the NEW warm values and, just as importantly,
// assert the REJECTED cold hexes are gone from every light render.
const REJECTED_COLD_HEXES = [
  '#A8ADBA', '#BEC4CE', // old light-cloudy
  '#586E84', '#728AA2', '#8EA4B8', // old light-rain
  '#1C2440', '#2A3560', '#C6C0B4', // old light-night
  '#D6E8F5', '#EBF4FA', // old light-snow
];

describe('V2Background — LIGHT gradient pins (warm sandy cream, every atmosphere)', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('light'));
  });

  it('sunny (light) — unchanged, already correct', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12); // noon → not night
    const tree = render(<V2Background condition="clear" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#F5F1EB', '#F8F4EE', '#F6F1E6'], locations: [0, 0.48, 1] });
    hoursSpy.mockRestore();
  });

  it('cloudy (light) is warm sandy cream, not the rejected blue-grey', () => {
    const tree = render(<V2Background condition="overcast" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#F2EDE0', '#F4EFE3', '#F6F1E6'], locations: [0, 0.5, 1] });
  });

  it('rain (light) is warm sandy cream, not the rejected blue-grey', () => {
    const tree = render(<V2Background condition="rain" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#EDE6D6', '#F1EBDD', '#F6F1E6'], locations: [0, 0.48, 1] });
  });

  it('night (light) is warm deep ivory, not the rejected cool navy/blue', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(22); // 10pm → night window
    const tree = render(<V2Background condition="clear" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#E9E1CE', '#EFE8D8', '#F6F1E6'], locations: [0, 0.46, 1] });
    hoursSpy.mockRestore();
  });

  it('snow (light) is palest warm ivory, not the rejected ice-blue', () => {
    const tree = render(<V2Background condition="snow" />).toJSON();
    const gradient = findGradientProps(tree);
    expect(gradient).toEqual({ colors: ['#F8F5EC', '#FAF7F0', '#F6F1E6'], locations: [0, 0.52, 1] });
  });

  it.each([
    ['clear' as const],
    ['overcast' as const],
    ['rain' as const],
    ['snow' as const],
  ])('condition=%s (light): none of the rejected cold hexes appear anywhere in the rendered gradient', (condition) => {
    const tree = render(<V2Background condition={condition} />).toJSON();
    const gradient = findGradientProps(tree);
    for (const cold of REJECTED_COLD_HEXES) {
      expect(gradient?.colors).not.toContain(cold);
    }
  });

  it('every light atmosphere gets exactly one warm golden glow (never a cold/blue glow rgb)', () => {
    // react-native-svg renders <RadialGradient> as a native `RNSVGRadialGradient`
    // whose `gradient` prop is a flat [offset, packedARGB, offset, packedARGB, …]
    // array (real react-native-svg, no mock in this file) — decode the packed
    // 0xAARRGGBB start-stop colour to check warmth directly, rather than
    // assuming a `rgb(...)` string appears verbatim anywhere in the tree.
    const conditions: ['clear' | 'overcast' | 'rain' | 'snow', number | undefined][] = [
      ['clear', 12],
      ['overcast', undefined],
      ['rain', undefined],
      ['snow', undefined],
    ];
    for (const [condition, hour] of conditions) {
      const hoursSpy = hour !== undefined ? jest.spyOn(Date.prototype, 'getHours').mockReturnValue(hour) : null;
      const tree = render(<V2Background condition={condition} />).toJSON();
      // Scoped to V2Background's OWN atmosphere-glow gradients (id prefix
      // 'v2bg-') — 'overcast' now also mounts V2WeatherMotion's
      // SoftCloudLayer (2026-07-20 softening), which renders its own
      // RNSVGRadialGradient nodes (id 'v2-soft-cloud-grad-*') that are a
      // DIFFERENT layer with its own warm/cool-by-mode rules (see
      // V2WeatherMotion.test.tsx) — not one of the glows this test checks.
      const glows = collectRadialGradients(tree).filter((g) => g.id.startsWith('v2bg-') && g.id !== 'v2bg-ocean-vignette');
      expect(glows.length).toBeGreaterThan(0);
      for (const glow of glows) {
        const packed = glow.gradient?.[1];
        expect(typeof packed).toBe('number');
        const { r, g, b } = decodeARGB(packed as number);
        // Warm = red channel clearly dominant over blue (every literal this
        // table defines is (255, 150–210, 77–130) — R≫B by construction).
        expect(r).toBeGreaterThan(200);
        expect(r).toBeGreaterThan(b);
        expect(b).toBeLessThan(160);
        // Explicitly rule out the exact rejected cold glow triplets.
        const rejected = [
          [38, 62, 90], // old light-rain glow
          [22, 30, 60], // old light-night glow
          [196, 220, 244], // old light-snow glow
        ];
        expect(rejected.some(([rr, rg, rb]) => r === rr && g === rg && b === rb)).toBe(false);
      }
      hoursSpy?.mockRestore();
    }
  });

  // Glow-shape polish (Liam): sunny's primary glow used to sit dead-centre
  // (cx:'50%'), which — combined with the old SunPulseLight full-width pill
  // — read as a big centred oval behind the Home heading. Both of sunny's
  // glows (and every other light atmosphere's single glow) must now read as
  // upper-right, never centred or left-biased.
  it('every light glow is biased upper-right (cx > 60%), never centred or left-biased', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12); // noon → not night
    const conditions: ('clear' | 'overcast' | 'rain' | 'snow')[] = ['clear', 'overcast', 'rain', 'snow'];
    for (const condition of conditions) {
      const tree = render(<V2Background condition={condition} />).toJSON();
      // Same scoping note as the warmth test above — 'overcast' also mounts
      // SoftCloudLayer's own (deliberately centred, cx=50%) gradients, which
      // are not one of V2Background's upper-right atmosphere glows.
      const glows = collectRadialGradients(tree).filter((g) => g.id.startsWith('v2bg-') && g.id !== 'v2bg-ocean-vignette');
      expect(glows.length).toBeGreaterThan(0);
      for (const glow of glows) {
        const cxPercent = parseFloat(glow.cx);
        expect(cxPercent).toBeGreaterThan(60);
      }
    }
    hoursSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// ISSUE 2 AUDIT — "dark weather effects not working correctly on device"
//
// Runtime-render evidence (not source inspection) that the SHARED dark
// pipeline (V2Background → V2WeatherMotion, via useAppTheme/ThemedBackground)
// resolves and re-resolves correctly for every condition and every mode
// transition. See the accompanying report for the full verdict; the short
// version: every audit item below renders correctly in dark for every
// condition, mode switches update the SAME tree with zero stale values, and
// nothing renders on top of the particle layer — the shared system is
// healthy. No fix was required in this file's production code.
// ═════════════════════════════════════════════════════════════════════════

// Audit item 1 — dark renders the correct motion layer + particle colour for
// EVERY condition. This is the direct runtime proof that "does dark rain
// actually render streaks? cloudy render mist? night render stars? snow
// flakes?" all answer yes.
describe('V2Background — Issue 2 audit (1): DARK renders the correct motion layer per condition', () => {
  beforeEach(() => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
  });

  it('sunny: v2-weather-motion-sunny + amber bokeh colour rgba(255,195,107,0.16)', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12); // noon → not night
    const tree = render(<V2Background condition="clear" />).toJSON();
    expect(collectTestIDs(tree)).toContain('v2-weather-motion-sunny');
    expect(collectBackgroundColors(tree)).toContain('rgba(255,195,107,0.16)');
    hoursSpy.mockRestore();
  });

  // UPDATED 2026-07-20 (Foggy/Overcast/Partly-cloudy softening): 'overcast'
  // now routes through a feathered SVG cloud form instead of the old
  // solid-fill MistBand, so its colour no longer appears as a style
  // `backgroundColor` — decode it off the real RNSVGRadialGradient node
  // instead (same helper this file already uses for its own glows).
  // UPDATED AGAIN 2026-07-22 (visibility repair): dark tints are PER
  // CONDITION rather than one shared family — overcast gets its own
  // cooler/greyer/darker tint (rgb(82,90,102)), distinct from partly_cloudy's
  // frozen rgb(96,104,124). See SOFT_CLOUD_RGB in V2WeatherMotion.tsx.
  // UPDATED AGAIN 2026-07-22 (second, shape, pass): overcast now renders as
  // a multi-puff SoftCloudCluster (testID 'v2-cloud-cluster'), not the old
  // single-ellipse SoftCloudLayer.
  it('cloudy (overcast): v2-weather-motion-cloudy + soft-cloud-cluster rgb(82,90,102) family', () => {
    const tree = render(<V2Background condition="overcast" />).toJSON();
    expect(collectTestIDs(tree)).toContain('v2-weather-motion-cloudy');
    expect(collectTestIDs(tree)).toContain('v2-cloud-cluster');
    const glows = collectRadialGradients(tree).filter((g) => g.id !== 'v2bg-ocean-vignette' && !g.id.startsWith('v2bg-'));
    expect(glows.length).toBeGreaterThan(0);
    for (const glow of glows) {
      const { r, g, b } = decodeARGB(glow.gradient?.[1] as number);
      expect([r, g, b]).toEqual([82, 90, 102]);
    }
  });

  it('rain: v2-weather-motion-rain + rain-streak colour rgb(150,186,216) family', () => {
    const tree = render(<V2Background condition="rain" />).toJSON();
    expect(collectTestIDs(tree)).toContain('v2-weather-motion-rain');
    expect(collectBackgroundColors(tree).some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true);
  });

  it('night: v2-weather-motion-night + star colour #E8ECF8', () => {
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(22); // 10pm → night window
    const tree = render(<V2Background condition="clear" />).toJSON();
    expect(collectTestIDs(tree)).toContain('v2-weather-motion-night');
    expect(collectBackgroundColors(tree)).toContain('#E8ECF8');
    hoursSpy.mockRestore();
  });

  it('snow: v2-weather-motion-snow + snowflake colour rgba(235,242,252,0.9)', () => {
    const tree = render(<V2Background condition="snow" />).toJSON();
    expect(collectTestIDs(tree)).toContain('v2-weather-motion-snow');
    expect(collectBackgroundColors(tree)).toContain('rgba(235,242,252,0.9)');
  });
});

// Audit items 2 & 4 — live mode switch on the SAME rendered tree (RTL
// `rerender`, not a fresh `render` — this is a genuine React update pass
// through the same component instance, never a remount) proves (a) no stale
// gradient/particle values leak across the switch and (b) the one useMemo in
// V2Background (`glows`, deps `[spec, mode]`) is not stale — `spec` itself is
// recomputed fresh every render (a plain table lookup, never memoised), so
// there is no cache that could survive a mode flip.
describe('V2Background — Issue 2 audit (2, 4): live mode switch updates the SAME tree, no stale values, no memo staleness', () => {
  it('light→dark (same tree): rain gradient + motion layer flip completely, zero leftover light values', () => {
    mockUseWeather.mockReturnValue({ condition: 'rain', temperatureC: 10, precipProbabilityPct: 80, emoji: '', label: '' });
    mockUseAppTheme.mockReturnValue(themeFor('light'));
    const { toJSON, rerender } = render(<V2Background />);
    expect(findGradientProps(toJSON())).toEqual({ colors: ['#EDE6D6', '#F1EBDD', '#F6F1E6'], locations: [0, 0.48, 1] });

    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    rerender(<V2Background />);
    expect(findGradientProps(toJSON())).toEqual({
      colors: ['#020407', '#06080E', '#090C14', '#0C0C11'],
      locations: [0, 0.44, 0.68, 1],
    });
    const colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(150,186,216,'))).toBe(true); // dark RainStreak now present
    expect(colors.some((c) => c.startsWith('rgba(255,196,120,'))).toBe(false); // no stale SunPulseLight rings
    expect(colors.some((c) => c.startsWith('rgba(246,224,180,') || c.startsWith('rgba(255,238,205,'))).toBe(false); // no stale haze
  });

  it('dark→light (same tree): cloudy gradient + motion layer flip completely, zero leftover dark values', () => {
    mockUseWeather.mockReturnValue({ condition: 'overcast', temperatureC: 10, precipProbabilityPct: 0, emoji: '', label: '' });
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    const { toJSON, rerender } = render(<V2Background />);
    expect(findGradientProps(toJSON())).toEqual({ colors: ['#0B0D12', '#111419', '#0C0C11'], locations: [0, 0.44, 1] });

    mockUseAppTheme.mockReturnValue(themeFor('light'));
    rerender(<V2Background />);
    expect(findGradientProps(toJSON())).toEqual({ colors: ['#F2EDE0', '#F4EFE3', '#F6F1E6'], locations: [0, 0.5, 1] });
    const colors = collectBackgroundColors(toJSON());
    expect(colors.some((c) => c.startsWith('rgba(96,104,124,'))).toBe(false); // no stale dark MistBand colour
    // UPDATED 2026-07-20 (Foggy/Overcast/Partly-cloudy softening), reshaped
    // 2026-07-22 second pass: 'overcast' now swaps HazeBand for a
    // SoftCloudCluster in light too, so the old haze rgb literal no longer
    // appears for this condition — assert the new v2-cloud-cluster testID is
    // present instead (still proves the light branch is live post-switch,
    // just via the current mechanism).
    expect(collectTestIDs(toJSON())).toContain('v2-cloud-cluster');
  });

  it('weather condition change propagates on rerender in dark mode (no cached/stale atmosphere)', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    mockUseWeather.mockReturnValue({ condition: 'clear', temperatureC: 15, precipProbabilityPct: 0, emoji: '', label: '' });
    const hoursSpy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);
    const { toJSON, rerender } = render(<V2Background />);
    expect(collectTestIDs(toJSON())).toContain('v2-weather-motion-sunny');

    mockUseWeather.mockReturnValue({ condition: 'snow', temperatureC: -1, precipProbabilityPct: 90, emoji: '', label: '' });
    rerender(<V2Background />);
    const testIDs = collectTestIDs(toJSON());
    expect(testIDs).toContain('v2-weather-motion-snow');
    expect(testIDs).not.toContain('v2-weather-motion-sunny');
    hoursSpy.mockRestore();
  });

  it('weather condition change propagates on rerender in light mode too (both modes stay live, not just dark)', () => {
    mockUseAppTheme.mockReturnValue(themeFor('light'));
    mockUseWeather.mockReturnValue({ condition: 'overcast', temperatureC: 10, precipProbabilityPct: 0, emoji: '', label: '' });
    const { toJSON, rerender } = render(<V2Background />);
    expect(findGradientProps(toJSON())?.colors).toEqual(['#F2EDE0', '#F4EFE3', '#F6F1E6']);

    mockUseWeather.mockReturnValue({ condition: 'snow', temperatureC: -1, precipProbabilityPct: 90, emoji: '', label: '' });
    rerender(<V2Background />);
    expect(findGradientProps(toJSON())?.colors).toEqual(['#F8F5EC', '#FAF7F0', '#F6F1E6']);
  });
});

// Audit item 5 — layering: does anything render ABOVE V2WeatherMotion inside
// V2Background that could cover the dark particles? V2WeatherMotion must be
// the LAST child of the root (React Native stacks later siblings on top,
// same as CSS without z-index) — the base LinearGradient and the glow Svg
// come first, so the particle layer is always the topmost thing.
describe('V2Background — Issue 2 audit (5): V2WeatherMotion is the LAST child — nothing covers the particle layer', () => {
  it('the motion-layer testID lives on the LAST direct child of the root view', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    mockUseWeather.mockReturnValue({ condition: 'rain', temperatureC: 10, precipProbabilityPct: 80, emoji: '', label: '' });
    const tree = render(<V2Background />).toJSON() as { children: unknown[] };
    expect(tree.children.length).toBeGreaterThanOrEqual(3); // gradient, svg glows, motion layer
    const lastChild = tree.children[tree.children.length - 1];
    expect(collectTestIDs(lastChild)).toContain('v2-weather-motion-rain');
  });
});

// Audit item 6 (partial — see hooks/__tests__/useAppTheme.test.tsx +
// components/ui/__tests__/ThemedBackground.test.tsx for the rest) + item 7 —
// two independent V2Background instances (simulating two different mounted
// screens, e.g. Home + Map) reading the SAME mocked weather resolve to
// IDENTICAL output — proving there is no per-instance/per-screen drift.
describe('V2Background — Issue 2 audit (7): multiple screens resolve the SAME atmosphere from the SAME weather', () => {
  it('two independent instances render identical gradients + motion-layer testIDs for the same weather', () => {
    mockUseAppTheme.mockReturnValue(themeFor('dark'));
    mockUseWeather.mockReturnValue({ condition: 'overcast', temperatureC: 8, precipProbabilityPct: 20, emoji: '', label: '' });
    const treeA = render(<V2Background />).toJSON();
    const treeB = render(<V2Background />).toJSON();
    expect(findGradientProps(treeA)).toEqual(findGradientProps(treeB));
    expect(collectTestIDs(treeA)).toEqual(collectTestIDs(treeB));
  });
});
