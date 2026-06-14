/**
 * Tests for lib/seasonalPicks.ts — deterministic month → season theme mapping
 * and the guarantee that every theme uses only REAL category slugs.
 */

import { getSeasonalTheme } from '@/lib/seasonalPicks';

const at = (month: number, day = 15) => new Date(2026, month, day);

// The real category slugs from constants/categories.ts.
const KNOWN_SLUGS = new Set([
  'soft-play', 'park', 'cafe', 'indoor-play', 'swimming', 'trampoline',
  'farm', 'bowling', 'arts', 'sports', 'library', 'sensory', 'outdoor-sports',
]);

describe('getSeasonalTheme — month mapping', () => {
  it('December → Christmas Magic', () => {
    expect(getSeasonalTheme(at(11)).id).toBe('christmas');
    expect(getSeasonalTheme(at(11)).title).toBe('Christmas Magic');
  });

  it('January & February → Cosy Winter Days', () => {
    expect(getSeasonalTheme(at(0)).id).toBe('winter');
    expect(getSeasonalTheme(at(1)).id).toBe('winter');
  });

  it('March & May → Spring Explorers', () => {
    expect(getSeasonalTheme(at(2)).id).toBe('spring');
    expect(getSeasonalTheme(at(4)).id).toBe('spring');
  });

  it('April → Easter Fun', () => {
    expect(getSeasonalTheme(at(3)).id).toBe('easter');
  });

  it('June–August → Summer Adventures', () => {
    [5, 6, 7].forEach((m) => expect(getSeasonalTheme(at(m)).id).toBe('summer'));
  });

  it('September–November → Autumn Walks', () => {
    [8, 9, 10].forEach((m) => expect(getSeasonalTheme(at(m)).id).toBe('autumn'));
  });

  it('is deterministic for a given date', () => {
    expect(getSeasonalTheme(at(6)).id).toBe(getSeasonalTheme(at(6)).id);
  });

  it('every theme uses only real category slugs (no fabricated categories)', () => {
    [11, 0, 2, 3, 4, 5, 8].forEach((m) => {
      getSeasonalTheme(at(m)).slugs.forEach((s) => expect(KNOWN_SLUGS.has(s)).toBe(true));
    });
  });
});
