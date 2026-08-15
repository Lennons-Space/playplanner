// =============================================================================
// scripts/enrich/discovery/providers/osmArchiveProvider.ts
//
// Enrichment 2.1 — Phase E/R: the OSM archive discovery provider.
//
// Retains the Enrichment 2.0 local-archive-file behaviour (no live network,
// no new format) but fixes the silent no-op the audit found: previously,
// autonomous.ts --discover with a missing archive directory printed "nothing
// to discover this run" and reported zero candidates — indistinguishable from
// "the archive genuinely has zero matching elements". Now it returns an
// explicit `unavailable` result with a clear reason, so the caller (and the
// run report) can say so instead of pretending the provider succeeded.
//
// EXPECTED ARCHIVE PATH/GENERATION (Phase R — documented, not automated here):
//   Default: scripts/enrich/data/raw/osm_archive_20260425 (a directory of
//   `*.json` files, each an array of raw Overpass elements — the exact shape
//   `scripts/import/01_fetch_osm.js` writes to scripts/data/raw/osm/cell_*.json
//   during the one-time import pipeline; the enrichment archive is a renamed/
//   relocated copy of that same output, not a different format).
//   `scripts/enrich/data/` is gitignored (confirmed: matches this repo's
//   general policy of not committing large/regeneratable data dumps) — the
//   directory is intentionally absent from a fresh checkout, not a bug.
//   To populate it: re-run `scripts/import/01_fetch_osm.js` (a fresh Overpass
//   pull, ~6 minutes per its own header comment) and copy/point the archive
//   dir at the resulting `scripts/data/raw/osm/` output, OR restore a
//   previously-generated archive from wherever it was last saved (not tracked
//   by this repo). This build does NOT download a new OSM dataset — that is
//   explicitly out of scope per instruction.
//   Configure a different path via `--osm-archive-dir=<path>` (autonomous.ts).
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';

import type { RawOsmElement } from '../discoverCandidates';
import type { DiscoveryProvider, DiscoveryWorkUnit, NormalizedCandidate, ProviderResult } from './types';
import { successResult, unavailableResult, failedResult } from './types';
import { sourceTierOf } from '../../sourceTrust';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const importTransform = require('../../../import/02_transform_osm.js') as {
  sanitise: (s: unknown, maxLen?: number) => string | null;
};

/** Reads every `*.json` file in `archiveDir` (each an array of raw Overpass elements) and flattens them. Returns [] if the directory doesn't exist — callers that need to distinguish "missing" from "empty" should check existence separately (see createOsmArchiveProvider). */
export function loadOsmArchiveElements(archiveDir: string): RawOsmElement[] {
  if (!fs.existsSync(archiveDir)) return [];
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.json'));
  const elements: RawOsmElement[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8')) as RawOsmElement[];
      elements.push(...raw);
    } catch {
      // A single malformed archive file must not abort discovery for every other file.
    }
  }
  return elements;
}

/**
 * Exported so discoverCandidates.ts's raw-element path and this provider's
 * NormalizedCandidate path can be proven to agree — see
 * providerNeutralPipeline.test.ts's parity test. Two mappers for the same
 * source is a divergence risk; that test is what stops it being a real one.
 */
export function normalizeElement(element: RawOsmElement, retrievedAt: string): NormalizedCandidate | null {
  const tags = element.tags ?? {};
  const name = importTransform.sanitise(tags.name, 200);
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  if (!name || lat === null || lon === null) return null; // deeper validation (artifact/UK/category) stays downstream in evaluateElement

  return {
    source: 'osm',
    sourceId: `${element.type}/${element.id}`,
    sourceTier: sourceTierOf('osm'),
    name,
    latitude: lat,
    longitude: lon,
    categoryEvidence: { ...tags },
    addressLine1: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
    postcode: tags['addr:postcode'] ?? null,
    city: tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'] ?? null,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    openingHoursRaw: tags.opening_hours ?? null,
    retrievedAt,
    attribution: { licence: 'ODbL-1.0', sourceName: 'OpenStreetMap contributors' },
    raw: element,
  };
}

/**
 * Ignores `unit.boundingBox`/`categorySlugs` — the local archive is already a
 * fixed, pre-downloaded UK extract (no live per-region fetch exists), so
 * every call returns the same full archive. `unit.budget`, if set, caps how
 * many candidates are normalized (not how many elements are scanned — the
 * whole archive is small enough that scanning it is cheap; only the returned
 * candidate list is capped, to bound downstream work).
 */
export function createOsmArchiveProvider(archiveDir: string): DiscoveryProvider {
  return {
    id: 'osm',
    // A fixed pre-downloaded UK extract: there is no per-area fetch to drive,
    // so coverage-plan work units cannot narrow it (see the doc comment above).
    requiresWorkUnit: false,
    async fetchCandidates(unit: DiscoveryWorkUnit): Promise<ProviderResult> {
      if (!fs.existsSync(archiveDir)) {
        return unavailableResult('osm', `OSM discovery source unavailable: archive not found at ${archiveDir}`);
      }

      let elements: RawOsmElement[];
      try {
        elements = loadOsmArchiveElements(archiveDir);
      } catch (err) {
        return failedResult('osm', `OSM archive read failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const retrievedAt = new Date().toISOString();
      const candidates: NormalizedCandidate[] = [];
      let dropped = 0;
      for (const element of elements) {
        const nc = normalizeElement(element, retrievedAt);
        if (nc) candidates.push(nc);
        else dropped += 1; // no usable name or no coordinates — reported, never silently swallowed
        if (unit.budget !== undefined && candidates.length >= unit.budget) break;
      }

      return successResult('osm', candidates, undefined, undefined, dropped);
    },
  };
}
