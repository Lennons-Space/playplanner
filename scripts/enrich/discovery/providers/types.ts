// =============================================================================
// scripts/enrich/discovery/providers/types.ts
//
// Enrichment 2.1 — Phase E: the discovery-provider abstraction. Lets
// autonomous discovery consume multiple APPROVED sources without coupling the
// orchestrator (or discoverCandidates.ts's already-tested pure core) to any
// one of them.
//
// DELIBERATE SCOPE (per instruction: "without rewriting the existing OSM
// implementation"): a provider's job is only to FETCH and NORMALIZE raw
// source data with clear success/failure semantics. It does NOT duplicate
// discoverCandidates.ts's category/dedupe/accept-gate logic.
//
// NormalizedCandidate IS the pipeline's input: discoverCandidates.ts consumes
// it directly via discoverFromCandidates/evaluateCandidate, so EVERY provider
// — OSM archive, Geoapify, any future one — flows through the same
// normalize -> spatial dedupe -> detailed dedupe -> corroboration ->
// merge_existing/auto_accept/quarantine/reject chain. Adding a source means
// writing a mapper to this shape plus a `categoryEvidence` branch in
// discoverCandidates.ts's resolveStructuralSlugFor; a source with no branch
// there falls back to name-hint matching, which can never auto-accept, so
// forgetting one fails safe rather than open.
//
// (`raw` is retained purely for audit/debugging — the pipeline no longer
// reads it, so a provider whose payload is not OSM-tag-shaped is fully
// supported.)
//
// No I/O in this file — pure type/interface definitions only.
// =============================================================================

import type { SourceId, SourceTier } from '../../sourceTrust';

/** A single normalized fact from a discovery source, before any PlayPlanner-specific category/dedupe logic runs. */
export interface NormalizedCandidate {
  source: SourceId;
  sourceId: string; // stable within that source (e.g. `${osmType}/${osmId}`)
  sourceTier: SourceTier;
  name: string;
  latitude: number;
  longitude: number;
  /** Provider-specific raw category evidence (OSM tags, a Geoapify category array, ...) — kept for audit, not interpreted here. */
  categoryEvidence: Record<string, unknown>;
  addressLine1: string | null;
  postcode: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  /** Provider-specific raw opening-hours representation, if the source supplied one. Not yet parsed into OpeningWeek. */
  openingHoursRaw: unknown | null;
  retrievedAt: string; // ISO8601
  attribution: {
    licence: string; // e.g. 'ODbL-1.0'
    sourceName: string; // e.g. 'OpenStreetMap contributors'
  };
  /** The original provider payload — for OSM this is the RawOsmElement itself, letting existing pipeline code consume it unchanged. */
  raw: unknown;
}

export type ProviderResultKind = 'success' | 'unavailable' | 'failed' | 'rate_limited';

export interface ProviderResult {
  kind: ProviderResultKind;
  providerId: SourceId;
  candidates: NormalizedCandidate[]; // always [] unless kind === 'success'
  /** Required (and shown to the operator) for every kind except 'success'. */
  reason?: string;
  budgetUsed?: number;
  budgetRemaining?: number;
  /**
   * Rows the provider could not turn into a NormalizedCandidate at all
   * (no usable name, or no coordinates). Reported so these never vanish
   * silently between "fetched" and "evaluated" — the downstream pipeline
   * never sees them, so it cannot count them itself.
   */
  droppedUnnormalizable?: number;
}

/** Populated by the Phase F coverage-gap planner; providers may ignore fields they don't support. */
export interface DiscoveryWorkUnit {
  boundingBox?: { south: number; west: number; north: number; east: number };
  categorySlugs?: string[];
  budget?: number;
}

export interface DiscoveryProvider {
  id: SourceId;
  /**
   * True when this provider can only fetch for a bounded area and therefore
   * MUST be driven by coverage-plan work units (a live area-query API);
   * false/absent when it serves a fixed pre-downloaded extract and ignores
   * the bounding box (the OSM archive). Declared here so the orchestrator
   * dispatches by capability rather than by hardcoding provider ids.
   */
  requiresWorkUnit?: boolean;
  fetchCandidates(unit: DiscoveryWorkUnit): Promise<ProviderResult>;
}

export function successResult(providerId: SourceId, candidates: NormalizedCandidate[], budgetUsed?: number, budgetRemaining?: number, droppedUnnormalizable?: number): ProviderResult {
  return { kind: 'success', providerId, candidates, budgetUsed, budgetRemaining, droppedUnnormalizable };
}
export function unavailableResult(providerId: SourceId, reason: string): ProviderResult {
  return { kind: 'unavailable', providerId, candidates: [], reason };
}
export function failedResult(providerId: SourceId, reason: string): ProviderResult {
  return { kind: 'failed', providerId, candidates: [], reason };
}
export function rateLimitedResult(providerId: SourceId, reason: string, budgetUsed?: number, budgetRemaining?: number): ProviderResult {
  return { kind: 'rate_limited', providerId, candidates: [], reason, budgetUsed, budgetRemaining };
}
