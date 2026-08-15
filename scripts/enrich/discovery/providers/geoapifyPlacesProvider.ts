// =============================================================================
// scripts/enrich/discovery/providers/geoapifyPlacesProvider.ts
//
// Enrichment 2.1 — Phase D3: Geoapify Places discovery provider.
//
// DISABLED BY DEFAULT — see GEOAPIFY_2_1_COMPLIANCE.md. Geoapify's own
// published terms (fetched live this session, not assumed from old code)
// leave two things genuinely ambiguous: exactly what "some limitations" means
// for free-tier production use, and whether long-term storage of Places
// results in a third-party database is within terms at all (the terms page
// is silent, not affirmatively permissive). Per instruction — "if anything is
// uncertain, implement behind configuration and disable by default" — this
// provider is fully built and tested but NEVER included in autonomous.ts's
// active provider list unless BOTH of the following are true:
//   - process.env.GEOAPIFY_DISCOVERY_ENABLED === 'true'
//   - a valid GEOAPIFY_API_KEY is present
// Neither is set by this build. No live call has been made from this file.
//
// Reuses (does not duplicate): geoapifyClient.ts's throttling/budget/retry/
// key-redaction machinery (this file adds no new HTTP logic of its own).
// =============================================================================

import type { GeoapifyClient } from '../../geoapifyClient';
import type { GeoapifyFeature, GeoapifyResponse } from '../../../../types/enrichment';
import type { DiscoveryProvider, DiscoveryWorkUnit, NormalizedCandidate, ProviderResult } from './types';
import { successResult, unavailableResult, failedResult, rateLimitedResult } from './types';
import { allMappedGeoapifyCategories, resolveGeoapifyCategorySlug, GEOAPIFY_CATEGORY_MAP } from './geoapifyCategoryMap';
import { sourceTierOf } from '../../sourceTrust';

/** Default search radius when a work unit doesn't specify a bounding box — deliberately small; this is a coverage-gap-driven provider (Phase F), not a broad sweep. */
const DEFAULT_SEARCH_RADIUS_M = 5000;

function normalizeFeature(feature: GeoapifyFeature, retrievedAt: string): NormalizedCandidate | null {
  const p = feature.properties;
  const name = p.name?.trim();
  const lat = p.lat ?? feature.geometry?.coordinates?.[1] ?? null;
  const lon = p.lon ?? feature.geometry?.coordinates?.[0] ?? null;
  if (!name || lat === null || lon === null || !p.place_id) return null;

  return {
    source: 'geoapify',
    sourceId: p.place_id,
    sourceTier: sourceTierOf('geoapify'),
    name,
    latitude: lat,
    longitude: lon,
    categoryEvidence: { categories: p.categories ?? (p.category ? [p.category] : []) },
    addressLine1: null, // Places API's default response doesn't include a structured street line without requesting extra features (Phase D3 scope: category/coords/contact only)
    postcode: p.postcode ?? null,
    city: p.city ?? null,
    phone: p.contact?.phone ?? null,
    website: p.website ?? p.contact?.website ?? null,
    openingHoursRaw: p.opening_hours ?? null,
    retrievedAt,
    attribution: { licence: 'ODbL-1.0', sourceName: 'OpenStreetMap contributors (via Geoapify) — Geoapify attribution also required on the free plan' },
    raw: feature,
  };
}

export interface GeoapifyProviderConfig {
  isEnabled: () => boolean; // injected so tests don't need real env vars
  client: GeoapifyClient;
}

export function createGeoapifyPlacesProvider(config: GeoapifyProviderConfig): DiscoveryProvider {
  return {
    id: 'geoapify',
    // A live area-query API — it can only ever fetch a bounded region, so the
    // orchestrator must drive it from coverage-plan work units.
    requiresWorkUnit: true,
    async fetchCandidates(unit: DiscoveryWorkUnit): Promise<ProviderResult> {
      if (!config.isEnabled()) {
        return unavailableResult(
          'geoapify',
          'Geoapify discovery is disabled by default (unresolved compliance ambiguity — see GEOAPIFY_2_1_COMPLIANCE.md). ' +
          'Set GEOAPIFY_DISCOVERY_ENABLED=true to opt in after reading that document.',
        );
      }
      if (!unit.boundingBox) {
        return failedResult('geoapify', 'geoapifyPlacesProvider requires a bounding box work unit (no whole-UK sweep supported).');
      }

      const centerLat = (unit.boundingBox.north + unit.boundingBox.south) / 2;
      const centerLon = (unit.boundingBox.east + unit.boundingBox.west) / 2;
      const categories = unit.categorySlugs?.length
        ? allMappedGeoapifyCategories().filter((code) => unit.categorySlugs!.includes(GEOAPIFY_CATEGORY_MAP[code]!))
        : allMappedGeoapifyCategories();

      let result;
      try {
        result = await config.client.placesSearch({
          categories,
          filterCircleLat: centerLat,
          filterCircleLon: centerLon,
          filterCircleRadiusM: DEFAULT_SEARCH_RADIUS_M,
          limit: unit.budget ? Math.min(unit.budget, 500) : 100,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('credit budget reached')) {
          return rateLimitedResult('geoapify', message, config.client.credits);
        }
        if (message.includes('HTTP 429')) {
          return rateLimitedResult('geoapify', message, config.client.credits);
        }
        return failedResult('geoapify', message);
      }

      const response = result.response as GeoapifyResponse;
      const retrievedAt = new Date().toISOString();
      const candidates: NormalizedCandidate[] = [];
      let dropped = 0;
      for (const feature of response.features ?? []) {
        const nc = normalizeFeature(feature, retrievedAt);
        if (!nc) {
          dropped += 1; // no usable name, coordinates or place_id — reported, never silently swallowed
          continue;
        }
        // Category filtering deliberately stays here as a cheap fetch-side
        // narrowing only. The pipeline re-resolves the category itself
        // (resolveStructuralSlugFor in discoverCandidates.ts) — this is not
        // the authoritative decision, so a candidate that slips through is
        // still correctly category-checked downstream.
        if (resolveGeoapifyCategorySlug((nc.categoryEvidence.categories as string[]) ?? [])) {
          candidates.push(nc);
        } else {
          dropped += 1;
        }
      }

      return successResult('geoapify', candidates, result.credits, undefined, dropped);
    },
  };
}

/** Real (non-test) enable check — reads the environment once, at call time (not at import time). */
export function isGeoapifyDiscoveryEnabled(): boolean {
  return process.env['GEOAPIFY_DISCOVERY_ENABLED'] === 'true';
}
