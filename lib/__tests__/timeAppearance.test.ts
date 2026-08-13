/**
 * Tests for lib/timeAppearance.ts — the pure 07:00/19:00 local-time resolver
 * behind PlayPlanner's automatic day/night theme (2026-08-13).
 *
 * Deliberately never touches the real wall clock: every case constructs an
 * explicit local Date and passes it in, per the CLAUDE.md requirement that
 * this resolver "accept/inject a Date or clock dependency so tests can
 * explicitly test times."
 */
import { resolveTimeAppearance, msUntilNextBoundary, DAY_START_HOUR, NIGHT_START_HOUR } from '../timeAppearance';

/** Builds a LOCAL Date at the given hour/minute (arbitrary fixed day). */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 15, hour, minute, 0, 0);
}

describe('resolveTimeAppearance — 07:00/19:00 boundary rule', () => {
  it.each([
    [6, 59, 'dark'],
    [7, 0, 'light'],
    [12, 0, 'light'],
    [18, 59, 'light'],
    [19, 0, 'dark'],
    [23, 30, 'dark'],
    [0, 0, 'dark'],
  ] as const)('%i:%s → %s', (hour, minute, expected) => {
    expect(resolveTimeAppearance(at(hour, minute))).toBe(expected);
  });

  it('the constants match the documented rule (07:00 light start, 19:00 dark start)', () => {
    expect(DAY_START_HOUR).toBe(7);
    expect(NIGHT_START_HOUR).toBe(19);
  });

  it('uses LOCAL time (Date#getHours), never UTC — a Date constructed with explicit local components resolves on its local hour', () => {
    const d = at(8, 0);
    expect(d.getHours()).toBe(8);
    expect(resolveTimeAppearance(d)).toBe('light');
  });

  it('defaults to the real current time when no date is supplied, and always returns a valid Appearance', () => {
    expect(['light', 'dark']).toContain(resolveTimeAppearance());
  });

  it('is a pure function — same input always produces the same output', () => {
    const d = at(19, 0);
    expect(resolveTimeAppearance(d)).toBe(resolveTimeAppearance(d));
  });
});

describe('msUntilNextBoundary', () => {
  it('from 06:00 → next boundary is 07:00 the same day (1h)', () => {
    expect(msUntilNextBoundary(at(6, 0))).toBe(60 * 60 * 1000);
  });

  it('from exactly 07:00 → next boundary is 19:00 the same day (12h), not 0', () => {
    expect(msUntilNextBoundary(at(7, 0))).toBe(12 * 60 * 60 * 1000);
  });

  it('from 12:00 → next boundary is 19:00 the same day (7h)', () => {
    expect(msUntilNextBoundary(at(12, 0))).toBe(7 * 60 * 60 * 1000);
  });

  it('from 18:59 → next boundary is 19:00, 1 minute away', () => {
    expect(msUntilNextBoundary(at(18, 59))).toBe(60 * 1000);
  });

  it('from exactly 19:00 → next boundary is 07:00 the NEXT day (12h), not 0', () => {
    expect(msUntilNextBoundary(at(19, 0))).toBe(12 * 60 * 60 * 1000);
  });

  it('from 23:30 → next boundary is 07:00 the next day (7.5h)', () => {
    expect(msUntilNextBoundary(at(23, 30))).toBe(7.5 * 60 * 60 * 1000);
  });

  it('from 00:00 → next boundary is 07:00 the same day (7h)', () => {
    expect(msUntilNextBoundary(at(0, 0))).toBe(7 * 60 * 60 * 1000);
  });

  it('always returns a strictly positive delay for every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      expect(msUntilNextBoundary(at(h, 0))).toBeGreaterThan(0);
    }
  });
});
