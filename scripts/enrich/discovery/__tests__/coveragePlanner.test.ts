import { buildCellCoverage, buildCoveragePlanReport, cellKey, planCoverage, ukGridCells, type CellCoverage, type CoverageGridRow, type GridCell } from '../coveragePlanner';

const NOW = new Date('2026-08-14T00:00:00.000Z');
const TARGETS = ['animal-attraction', 'museum', 'playground'];

function cell(id: string, overrides: Partial<GridCell> = {}): GridCell {
  return { id, latIndex: 3, lngIndex: 6, south: 52, west: -2, north: 53, east: -1, ...overrides };
}
function coverage(c: GridCell, overrides: Partial<CellCoverage> = {}): CellCoverage {
  return { cell: c, venueCount: 10, venuesByCategory: {}, lastDiscoveredAt: null, ...overrides };
}

describe('ukGridCells', () => {
  it('produces a deterministic, stable set of cells matching the 01_fetch_osm.js bounding box', () => {
    const cells = ukGridCells(1.0);
    expect(cells.length).toBeGreaterThan(50); // full UK 1x1deg grid is ~110 cells
    expect(cells[0]!.south).toBe(49.0);
    expect(cells.every((c) => c.south >= 49.0 && c.north <= 61.0 && c.west >= -8.7 && c.east <= 1.8)).toBe(true);
  });

  it('every cell id is unique', () => {
    const cells = ukGridCells(1.0);
    expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
  });
});

describe('planCoverage', () => {
  it('prioritises a cell with zero venues in every target category over a fully-covered, recently-checked cell', () => {
    const gappy = coverage(cell('a'), { venuesByCategory: {}, lastDiscoveredAt: '2026-08-13T00:00:00.000Z' });
    const covered = coverage(cell('b'), { venuesByCategory: { 'animal-attraction': 5, museum: 3, playground: 2 }, lastDiscoveredAt: '2026-08-13T00:00:00.000Z' });
    const plan = planCoverage([gappy, covered], { targetCategorySlugs: TARGETS, now: NOW });
    expect(plan.map((e) => e.cellId)).toEqual(['a']); // fully-covered + recently-checked cell has priority 0, excluded
  });

  it('never-checked cells outrank a recently-checked cell with the same category gaps', () => {
    const neverChecked = coverage(cell('a'), { lastDiscoveredAt: null });
    const recentlyChecked = coverage(cell('b'), { lastDiscoveredAt: '2026-08-13T00:00:00.000Z' });
    const plan = planCoverage([neverChecked, recentlyChecked], { targetCategorySlugs: TARGETS, now: NOW });
    const aIdx = plan.findIndex((e) => e.cellId === 'a');
    const bIdx = plan.findIndex((e) => e.cellId === 'b');
    expect(aIdx).toBeLessThan(bIdx === -1 ? Infinity : bIdx);
  });

  it('dampens (never boosts) a low-density cell, and flags it with an explicit rural caveat', () => {
    const lowDensity = coverage(cell('a'), { venueCount: 1, venuesByCategory: {} });
    const denser = coverage(cell('b'), { venueCount: 20, venuesByCategory: {} });
    const plan = planCoverage([lowDensity, denser], { targetCategorySlugs: TARGETS, now: NOW, lowDensityFloor: 3 });
    const lowEntry = plan.find((e) => e.cellId === 'a')!;
    const denseEntry = plan.find((e) => e.cellId === 'b')!;
    expect(lowEntry.lowDensityCaveat).toBe(true);
    expect(lowEntry.reason).toMatch(/LOW DENSITY/);
    expect(lowEntry.reason).toMatch(/may genuinely be a sparse rural area/);
    expect(lowEntry.priority).toBeLessThan(denseEntry.priority); // same missing-category count, dampened only
  });

  it('respects the maxCellsPerRun bound', () => {
    const cells = Array.from({ length: 30 }, (_, i) => coverage(cell(`c${i}`), { venuesByCategory: {} }));
    const plan = planCoverage(cells, { targetCategorySlugs: TARGETS, now: NOW, maxCellsPerRun: 5 });
    expect(plan).toHaveLength(5);
  });

  it('is resumable — skips cells already in alreadyPlanned', () => {
    const cells = [coverage(cell('a'), { venuesByCategory: {} }), coverage(cell('b'), { venuesByCategory: {} })];
    const plan = planCoverage(cells, { targetCategorySlugs: TARGETS, now: NOW, alreadyPlanned: new Set(['a']) });
    expect(plan.map((e) => e.cellId)).toEqual(['b']);
  });

  it('work unit only lists the categories actually missing in that cell', () => {
    const partial = coverage(cell('a'), { venuesByCategory: { museum: 2 } });
    const plan = planCoverage([partial], { targetCategorySlugs: TARGETS, now: NOW });
    expect(plan[0]!.workUnit.categorySlugs).toEqual(['animal-attraction', 'playground']);
  });

  it('is deterministic — same input always produces the same order', () => {
    const cells = [coverage(cell('a'), { venuesByCategory: {} }), coverage(cell('b'), { venuesByCategory: {} }), coverage(cell('c'), { venuesByCategory: {} })];
    const plan1 = planCoverage(cells, { targetCategorySlugs: TARGETS, now: NOW });
    const plan2 = planCoverage(cells, { targetCategorySlugs: TARGETS, now: NOW });
    expect(plan1.map((e) => e.cellId)).toEqual(plan2.map((e) => e.cellId));
  });
});

describe('buildCoveragePlanReport', () => {
  it('summarises cells considered vs undercovered', () => {
    const cells = [
      coverage(cell('a'), { venuesByCategory: {}, lastDiscoveredAt: '2026-08-13T00:00:00.000Z' }),
      coverage(cell('b'), { venuesByCategory: { 'animal-attraction': 1, museum: 1, playground: 1 }, lastDiscoveredAt: '2026-08-13T00:00:00.000Z' }),
    ];
    const report = buildCoveragePlanReport(cells, { targetCategorySlugs: TARGETS, now: NOW });
    expect(report.cellsConsidered).toBe(2);
    expect(report.undercoveredCells).toBe(1);
    expect(report.categoriesTargeted).toEqual(TARGETS);
  });
});

// ── Enrichment 2.1 review fix: the RPC -> planner mapping (gap: the planner
// was built and tested standalone, with no data source wired to it). ────────
describe('grid cell indices', () => {
  it('gives every cell a unique integer index pair, which is what the RPC joins on', () => {
    const cells = ukGridCells(1.0);
    const keys = new Set(cells.map((c) => cellKey(c.latIndex, c.lngIndex)));
    expect(keys.size).toBe(cells.length);
    expect(cells[0]!.latIndex).toBe(0);
    expect(cells[0]!.lngIndex).toBe(0);
  });

  it('indexes increase with position, so index arithmetic matches the SQL floor() bucketing', () => {
    const cells = ukGridCells(1.0);
    const byKey = new Map(cells.map((c) => [cellKey(c.latIndex, c.lngIndex), c]));
    const first = byKey.get(cellKey(0, 0))!;
    const oneNorth = byKey.get(cellKey(1, 0))!;
    const oneEast = byKey.get(cellKey(0, 1))!;
    expect(oneNorth.south).toBeCloseTo(first.south + 1, 6);
    expect(oneEast.west).toBeCloseTo(first.west + 1, 6);
  });
});

describe('buildCellCoverage', () => {
  const cells = ukGridCells(1.0);
  const target = cells[25]!;

  function row(over: Partial<CoverageGridRow> = {}): CoverageGridRow {
    return { cell_lat_idx: target.latIndex, cell_lng_idx: target.lngIndex, category_slug: 'museum', venue_count: 4, last_discovered_at: null, ...over };
  }

  it('folds sparse RPC rows onto the full grid, summing per category and in total', () => {
    const out = buildCellCoverage(cells, [row(), row({ category_slug: 'playground', venue_count: 2 })]);
    const found = out.find((c) => c.cell.id === target.id)!;
    expect(found.venueCount).toBe(6);
    expect(found.venuesByCategory['museum']).toBe(4);
    expect(found.venuesByCategory['playground']).toBe(2);
  });

  it('keeps cells the RPC returned nothing for, as genuinely empty — dropping them would hide the very gaps being looked for', () => {
    const out = buildCellCoverage(cells, [row()]);
    expect(out).toHaveLength(cells.length);
    const untouched = out.find((c) => c.cell.id !== target.id)!;
    expect(untouched.venueCount).toBe(0);
    expect(untouched.venuesByCategory).toEqual({});
    expect(untouched.lastDiscoveredAt).toBeNull();
  });

  it('counts an uncategorised venue toward the cell total but toward no target category', () => {
    const out = buildCellCoverage(cells, [row({ category_slug: null, venue_count: 3 })]);
    const found = out.find((c) => c.cell.id === target.id)!;
    expect(found.venueCount).toBe(3);
    expect(found.venuesByCategory).toEqual({});
  });

  it('keeps the newest last-discovered timestamp across a cell rows', () => {
    const out = buildCellCoverage(cells, [
      row({ last_discovered_at: '2026-01-01T00:00:00.000Z' }),
      row({ category_slug: 'playground', last_discovered_at: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(out.find((c) => c.cell.id === target.id)!.lastDiscoveredAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('feeds the planner end-to-end: a cell with zero venues is planned, a fully-covered fresh one is not', () => {
    const covered = cells[10]!;
    const rows: CoverageGridRow[] = ['museum', 'playground'].map((slug) => ({
      cell_lat_idx: covered.latIndex, cell_lng_idx: covered.lngIndex,
      category_slug: slug, venue_count: 50, last_discovered_at: '2026-08-14T00:00:00.000Z',
    }));
    const report = buildCoveragePlanReport(buildCellCoverage(cells, rows), {
      targetCategorySlugs: ['museum', 'playground'],
      now: new Date('2026-08-15T00:00:00.000Z'),
      maxCellsPerRun: 200,
    });
    expect(report.planEntries.some((e) => e.cellId === covered.id)).toBe(false);
    expect(report.planEntries.length).toBeGreaterThan(0);
  });
});
