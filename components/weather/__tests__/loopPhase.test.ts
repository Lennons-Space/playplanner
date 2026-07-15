// Regression suite for the shared-clock atmosphere fix.
//
// Context: every v2 screen used to mount its OWN <V2Background/>, and
// useLoop's old driver (withDelay/withRepeat/withTiming) started its
// animation timeline from phase 0 at THAT component's own mount moment — so
// navigating to a new screen visibly restarted the drift/twinkle. The fix
// (components/weather/WeatherLayer.tsx) makes the animation phase a PURE
// function of the shared wall clock (`loopPhaseAt`), so any two instances
// evaluated at the same real timestamp agree, and a remount resumes from
// elapsed time instead of restarting at zero. These tests prove that
// property directly against the pure helper — no rendering, no Reanimated
// mocking required, fully deterministic.
import * as fs from 'fs';
import * as path from 'path';
import { easeInOutSine, loopPhaseAt, seededNodes } from '@/components/weather/WeatherLayer';

describe('easeInOutSine', () => {
  // Sanity-checks the closed-form reproduction of
  // Easing.inOut(Easing.sin) from react-native-reanimated (see the doc
  // comment above loopPhaseAt for the algebraic derivation).
  it('starts at 0, peaks at 1, and is symmetric around the midpoint', () => {
    expect(easeInOutSine(0)).toBeCloseTo(0, 10);
    expect(easeInOutSine(1)).toBeCloseTo(1, 10);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 10);
  });

  it('matches Easing.inOut(Easing.sin) pointwise', () => {
    // Reimplementation of the real reanimated formula (see
    // node_modules/react-native-reanimated/src/Easing.ts): sin(t) = 1 -
    // cos(t*PI/2); inOut(fn)(t) = t<0.5 ? fn(2t)/2 : 1 - fn(2(1-t))/2.
    const sin = (t: number) => 1 - Math.cos((t * Math.PI) / 2);
    const inOutSin = (t: number) => (t < 0.5 ? sin(2 * t) / 2 : 1 - sin(2 * (1 - t)) / 2);
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easeInOutSine(t)).toBeCloseTo(inOutSin(t), 10);
    }
  });
});

describe('loopPhaseAt — shared wall-clock phase', () => {
  describe('1. same-instant agreement across "instances"', () => {
    it('two calls at the same mocked timestamp give identical phase, regardless of a different simulated mount time', () => {
      const now = 1_752_500_000_000; // arbitrary fixed epoch ms
      // Simulate "instance A" (mounted long ago) and "instance B" (mounted
      // just now) — loopPhaseAt takes no mount-time argument at all, so
      // both reads at the same `now` must agree by construction. This is
      // the property that makes two on-screen components stay in sync.
      const instanceA = loopPhaseAt(now, 9000, 0, true);
      const instanceB = loopPhaseAt(now, 9000, 0, true);
      expect(instanceA).toBe(instanceB);
    });

    it('agreement holds across duration/delay/reverse combinations', () => {
      const now = 1_700_000_123_456;
      const cases: [number, number, boolean][] = [
        [620, 0, false],
        [12000, 4000, false],
        [1800, 900, true],
        [18000, 12000, true],
      ];
      for (const [durationMs, delayMs, reverse] of cases) {
        expect(loopPhaseAt(now, durationMs, delayMs, reverse)).toBe(
          loopPhaseAt(now, durationMs, delayMs, reverse),
        );
      }
    });
  });

  describe('2. continuation — remounts resume, they do not restart at 0', () => {
    it('non-reverse: phase at T and T+delta differ by exactly the elapsed fraction (linear leg)', () => {
      const T = 10_000;
      const durationMs = 1000;
      const delta = 250;
      const phaseAtT = loopPhaseAt(T, durationMs, 0, false);
      const phaseAtTPlusDelta = loopPhaseAt(T + delta, durationMs, 0, false);
      expect(phaseAtTPlusDelta - phaseAtT).toBeCloseTo(delta / durationMs, 10);
    });

    it('a later timestamp does NOT reproduce the phase a fresh mount would show at time 0 (no restart-on-remount)', () => {
      const durationMs = 9000;
      const initialMountPhase = loopPhaseAt(0, durationMs, 0, true); // what the OLD per-mount driver started at
      const laterRemountPhase = loopPhaseAt(37_412, durationMs, 0, true); // "remount" deep into a cycle
      expect(laterRemountPhase).not.toBeCloseTo(initialMountPhase, 6);
    });

    it('reverse: a later time only reproduces the same phase once the cycle has genuinely wrapped back to it', () => {
      const durationMs = 1000; // cycle = 2000
      const cycleMs = durationMs * 2;
      const t0 = 12_345;
      const phaseAtT0 = loopPhaseAt(t0, durationMs, 0, true);
      // A full cycle later: must match (genuine wrap).
      expect(loopPhaseAt(t0 + cycleMs, durationMs, 0, true)).toBeCloseTo(phaseAtT0, 10);
      // A partial step later: must NOT match (still mid-cycle).
      expect(loopPhaseAt(t0 + cycleMs / 3, durationMs, 0, true)).not.toBeCloseTo(phaseAtT0, 3);
    });
  });

  describe('3. wrap correctness (reverse + non-reverse, boundary instants, huge timestamps)', () => {
    it('non-reverse sawtooth: 0 at t=0, wraps to 0 again at exactly t=duration', () => {
      expect(loopPhaseAt(0, 1000, 0, false)).toBeCloseTo(0, 10);
      expect(loopPhaseAt(500, 1000, 0, false)).toBeCloseTo(0.5, 10);
      expect(loopPhaseAt(1000, 1000, 0, false)).toBeCloseTo(0, 10); // wrapped
      expect(loopPhaseAt(1999, 1000, 0, false)).toBeCloseTo(0.999, 3);
    });

    it('reverse triangle: 0 at t=0, 1 at exactly t=duration, back to 0 at t=2*duration', () => {
      expect(loopPhaseAt(0, 1000, 0, true)).toBeCloseTo(0, 10);
      expect(loopPhaseAt(500, 1000, 0, true)).toBeCloseTo(0.5, 6); // mid-rise
      expect(loopPhaseAt(1000, 1000, 0, true)).toBeCloseTo(1, 10); // peak, boundary instant
      expect(loopPhaseAt(1500, 1000, 0, true)).toBeCloseTo(0.5, 6); // mid-fall
      expect(loopPhaseAt(2000, 1000, 0, true)).toBeCloseTo(0, 10); // wrapped, boundary instant
    });

    it('holds across several different durations', () => {
      for (const durationMs of [200, 900, 4000, 18000, 45_000]) {
        expect(loopPhaseAt(0, durationMs, 0, false)).toBeCloseTo(0, 10);
        expect(loopPhaseAt(durationMs, durationMs, 0, false)).toBeCloseTo(0, 10);
        expect(loopPhaseAt(durationMs, durationMs, 0, true)).toBeCloseTo(1, 10);
        expect(loopPhaseAt(durationMs * 2, durationMs, 0, true)).toBeCloseTo(0, 10);
      }
    });

    it('handles very large / real-world epoch timestamps without drifting or throwing', () => {
      const nowRealEpoch = Date.now(); // ~1.7e12 as of 2026
      expect(() => loopPhaseAt(nowRealEpoch, 9000, 3000, true)).not.toThrow();
      const v = loopPhaseAt(nowRealEpoch, 9000, 3000, true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isNaN(v)).toBe(false);
    });

    it('never returns NaN or a negative value for negative-raw inputs (delay > now) — double-mod safety', () => {
      const v1 = loopPhaseAt(50, 1000, 5000, false); // now - delay = -4950
      const v2 = loopPhaseAt(50, 1000, 5000, true);
      for (const v of [v1, v2]) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('guards durationMs <= 0 and non-finite input instead of dividing by zero / producing NaN', () => {
      expect(Number.isNaN(loopPhaseAt(1000, 0, 0, true))).toBe(false);
      expect(Number.isNaN(loopPhaseAt(1000, -5, 0, true))).toBe(false);
      expect(Number.isNaN(loopPhaseAt(NaN, 1000, 0, true))).toBe(false);
      expect(Number.isNaN(loopPhaseAt(Infinity, 1000, 0, true))).toBe(false);
      // Resting values match useLoop's animate=false park value.
      expect(loopPhaseAt(1000, 0, 0, true)).toBe(0.5);
      expect(loopPhaseAt(1000, 0, 0, false)).toBe(0);
    });
  });
});

describe('4. source-scan — no route/pathname identity in the shared animation layer', () => {
  const forbiddenPatterns = [/usePathname/, /useRoute\(/, /useSegments/, /useLocalSearchParams/];
  const files = [
    'components/weather/WeatherLayer.tsx',
    'components/ui/V2WeatherMotion.tsx',
    'components/ui/V2Background.tsx',
  ];

  it.each(files)('%s contains no route/pathname keying', (relPath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
    for (const pattern of forbiddenPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });
});

describe('5. deterministic seeded positions are unchanged', () => {
  // Regression fixture captured from the UNTOUCHED mulberry32/seededNodes
  // implementation (components/weather/WeatherLayer.tsx) — if this ever
  // fails, either the seeding algorithm changed or a different seed/count
  // was passed, both of which would visibly reshuffle node layout, which is
  // explicitly out of scope for this fix.
  it('seededNodes(3, 42, 3000) reproduces the exact known deterministic sequence', () => {
    expect(seededNodes(3, 42, 3000)).toEqual([
      { x: 0.6011037519201636, y: 0.44829055899754167, r: 0.8524657934904099, delay: 2009 },
      { x: 0.17481389874592423, y: 0.5265925421845168, r: 0.2732279943302274, delay: 1874 },
      { x: 0.8654746483080089, y: 0.4723170551005751, r: 0.24992373422719538, delay: 2646 },
    ]);
  });

  it('is stable across repeated calls with the same seed (no Math.random at render time)', () => {
    expect(seededNodes(5, 20260709, 6000)).toEqual(seededNodes(5, 20260709, 6000));
  });
});
