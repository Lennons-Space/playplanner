// =============================================================================
// scripts/enrich/discovery/coveragePlanner.ts
//
// Enrichment 2.1 — Phase F: a bounded, deterministic, checkpointable coverage-
// gap planner. Produces DiscoveryWorkUnits (the exact shape providers/types.ts
// already defines) instead of sweeping the whole UK uniformly.
//
// GRID: reuses scripts/import/01_fetch_osm.js's exact UK bounding box and 1°
// cell size (LAT 49-61, LNG -8.7-1.8, STEP 1.0 — the same ~110-cell grid that
// script already fetches OSM data over) rather than inventing a new one — the
// whole point of a "coverage gap" is relative to what's already been
// imported, so using a different grid would make the two incomparable.
//
// CONSERVATISM (explicit instruction: "do not assume every rural low-density
// area is missing data"): a cell with few venues is flagged with a caveat and
// a DAMPENED priority, never boosted — a genuinely sparse rural area should
// not crowd out denser-but-still-gappy areas in the plan.
//
// HONEST LIMITATION: "distance to populated settlements" (one of the
// suggested scoring factors) is not implemented — this codebase has no
// settlement/population dataset to compute it from, and fabricating one
// would be worse than omitting it. Flagged, not silently faked.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type { DiscoveryWorkUnit } from './providers/types';

// Matches scripts/import/01_fetch_osm.js's LAT_START/LAT_END/LNG_START/LNG_END/STEP exactly.
export const UK_GRID_BOUNDS = { latStart: 49.0, latEnd: 61.0, lngStart: -8.7, lngEnd: 1.8 };

export interface GridCell {
  id: string; // "lat_lng", e.g. "52.0_-2.7" — stable, deterministic, checkpoint-friendly
  /**
   * Integer offsets from the grid origin. These — not the formatted `id` and
   * not the float bounds — are what the `enrichment_coverage_grid` RPC returns
   * and what cell matching compares, so JS float formatting and SQL numeric
   * formatting never have to agree (a classic source of silently mis-bucketed
   * geo data). See that function's header in migration 060 Section G.
   */
  latIndex: number;
  lngIndex: number;
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The key both sides of the RPC boundary agree on. */
export function cellKey(latIndex: number, lngIndex: number): string {
  return `${latIndex}:${lngIndex}`;
}

export function ukGridCells(stepDeg = 1.0): GridCell[] {
  const cells: GridCell[] = [];
  let latIndex = 0;
  for (let lat = UK_GRID_BOUNDS.latStart; lat < UK_GRID_BOUNDS.latEnd; lat += stepDeg, latIndex += 1) {
    let lngIndex = 0;
    for (let lng = UK_GRID_BOUNDS.lngStart; lng < UK_GRID_BOUNDS.lngEnd; lng += stepDeg, lngIndex += 1) {
      cells.push({
        id: `${lat.toFixed(1)}_${lng.toFixed(1)}`,
        latIndex,
        lngIndex,
        south: lat, north: Math.min(lat + stepDeg, UK_GRID_BOUNDS.latEnd),
        west: lng, east: Math.min(lng + stepDeg, UK_GRID_BOUNDS.lngEnd),
      });
    }
  }
  return cells;
}

export interface CellCoverage {
  cell: GridCell;
  venueCount: number;
  /** How many venues exist per target category slug in this cell — sparse/absent keys mean zero. */
  venuesByCategory: Partial<Record<string, number>>;
  /** null = never discovery-checked. */
  lastDiscoveredAt: string | null;
}

/** One row exactly as `enrichment_coverage_grid` (migration 060 Section G) returns it. */
export interface CoverageGridRow {
  cell_lat_idx: number;
  cell_lng_idx: number;
  /** null when the venue has no category assigned — counted toward venueCount, never toward a target category. */
  category_slug: string | null;
  venue_count: number;
  last_discovered_at: string | null;
}

/**
 * Fold the RPC's sparse (cell, category) rows onto the FULL grid — PURE, so
 * the mapping is unit-tested without a database. Cells the RPC returned no
 * rows for are genuinely empty and are emitted with venueCount 0, which is
 * what makes a never-imported area visible to the planner at all (dropping
 * them would hide exactly the gaps this is supposed to find).
 */
export function buildCellCoverage(cells: GridCell[], rows: CoverageGridRow[]): CellCoverage[] {
  const byCell = new Map<string, { total: number; byCategory: Record<string, number>; lastAt: string | null }>();

  for (const row of rows) {
    const key = cellKey(row.cell_lat_idx, row.cell_lng_idx);
    const entry = byCell.get(key) ?? { total: 0, byCategory: {}, lastAt: null };
    const n = Number(row.venue_count) || 0;
    entry.total += n;
    if (row.category_slug) entry.byCategory[row.category_slug] = (entry.byCategory[row.category_slug] ?? 0) + n;
    // Every row of a given cell repeats that cell's last-discovered timestamp;
    // keep the newest defensively rather than trusting them to be identical.
    if (row.last_discovered_at && (!entry.lastAt || row.last_discovered_at > entry.lastAt)) entry.lastAt = row.last_discovered_at;
    byCell.set(key, entry);
  }

  return cells.map((cell) => {
    const entry = byCell.get(cellKey(cell.latIndex, cell.lngIndex));
    return {
      cell,
      venueCount: entry?.total ?? 0,
      venuesByCategory: entry?.byCategory ?? {},
      lastDiscoveredAt: entry?.lastAt ?? null,
    };
  });
}

export interface CoveragePlanEntry {
  cellId: string;
  workUnit: DiscoveryWorkUnit;
  priority: number;
  reason: string;
  lowDensityCaveat: boolean;
}

export interface PlanCoverageOptions {
  targetCategorySlugs: string[];
  now: Date;
  /** Below this absolute venue count, a cell is flagged low-density and its score is DAMPENED, never boosted. */
  lowDensityFloor?: number;
  /** Cells checked more recently than this are deprioritised (still eligible, just lower). */
  staleDays?: number;
  /** Hard cap on how many work units one planning pass returns — bounded, per instruction. */
  maxCellsPerRun?: number;
  /** Skip cell ids already present here (resumable — see coveragePlanner.test.ts). */
  alreadyPlanned?: ReadonlySet<string>;
}

const DEFAULT_LOW_DENSITY_FLOOR = 3;
const DEFAULT_STALE_DAYS = 90;
const DEFAULT_MAX_CELLS = 20;
const LOW_DENSITY_DAMPENING = 0.5;

/**
 * Deterministic priority: missing-category count (how many of the target
 * categories have ZERO venues in this cell) is the dominant signal, plus a
 * staleness bonus for never/long-ago-checked cells. Low-density cells are
 * dampened (never boosted) — see file header.
 */
export function planCoverage(cells: CellCoverage[], opts: PlanCoverageOptions): CoveragePlanEntry[] {
  const lowDensityFloor = opts.lowDensityFloor ?? DEFAULT_LOW_DENSITY_FLOOR;
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const maxCells = opts.maxCellsPerRun ?? DEFAULT_MAX_CELLS;

  const entries: CoveragePlanEntry[] = [];

  for (const c of cells) {
    if (opts.alreadyPlanned?.has(c.cell.id)) continue;

    const missingCategories = opts.targetCategorySlugs.filter((slug) => !(c.venuesByCategory[slug] ?? 0));
    const missingCount = missingCategories.length;

    const ageDays = c.lastDiscoveredAt ? Math.floor((opts.now.getTime() - new Date(c.lastDiscoveredAt).getTime()) / 86_400_000) : Infinity;
    const staleBonus = ageDays === Infinity ? 20 : ageDays >= staleDays ? Math.min(10, Math.round(ageDays / staleDays)) : 0;

    let priority = missingCount + staleBonus;
    const lowDensity = c.venueCount < lowDensityFloor;
    if (lowDensity) priority *= LOW_DENSITY_DAMPENING;

    if (priority <= 0) continue; // fully covered, recently checked — nothing to plan here

    const reasonParts = [`${missingCount}/${opts.targetCategorySlugs.length} target categories have zero venues in this cell`];
    if (ageDays === Infinity) reasonParts.push('never discovery-checked');
    else if (ageDays >= staleDays) reasonParts.push(`last checked ${ageDays}d ago`);
    if (lowDensity) reasonParts.push(`LOW DENSITY (${c.venueCount} venues total) — may genuinely be a sparse rural area, not missing data; priority dampened, not boosted`);

    entries.push({
      cellId: c.cell.id,
      workUnit: { boundingBox: { south: c.cell.south, west: c.cell.west, north: c.cell.north, east: c.cell.east }, categorySlugs: missingCategories.length > 0 ? missingCategories : undefined },
      priority,
      reason: reasonParts.join('; '),
      lowDensityCaveat: lowDensity,
    });
  }

  entries.sort((a, b) => b.priority - a.priority || a.cellId.localeCompare(b.cellId));
  return entries.slice(0, maxCells);
}

export interface CoveragePlanReport {
  cellsConsidered: number;
  undercoveredCells: number;
  categoriesTargeted: string[];
  planEntries: CoveragePlanEntry[];
}

export function buildCoveragePlanReport(cells: CellCoverage[], opts: PlanCoverageOptions): CoveragePlanReport {
  const planEntries = planCoverage(cells, opts);
  return {
    cellsConsidered: cells.length,
    undercoveredCells: planEntries.length,
    categoriesTargeted: opts.targetCategorySlugs,
    planEntries,
  };
}
