// =============================================================================
// scripts/enrich/discovery/discoverCandidates.ts
//
// Enrichment 2.0 — Part 6/7/8: new-venue discovery pipeline core.
//
// PURE core (evaluateElement) + a thin I/O shell (discoverFromElements) that
// takes injected deps — mirrors the orchestrate.ts / autonomousCore.ts split
// used elsewhere in this codebase so the decision logic stays unit-testable
// without a live archive file or Supabase connection.
//
// Reuses (does not duplicate):
//   - scripts/import/02_transform_osm.js — sanitise/isStructuralArtifact/
//     isWithinUK (the exact production import filters)
//   - categoryTargets.ts — resolveStructuralCategorySlug/matchByNameHint
//   - discovery/dedupe.ts — dedupeAgainstExisting
//   - discovery/candidateAccept.ts — decideCandidateAccept
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

import { matchByNameHint, resolveStructuralCategorySlug } from './categoryTargets';
import { dedupeAgainstExisting } from './dedupe';
import { decideCandidateAccept } from './candidateAccept';
import { isTrustedSourceId } from '../sourceTrust';
import type {
  CandidateAcceptInput,
  CandidateAcceptResult,
  DedupeCandidate,
  DedupeExistingVenue,
  DedupeResult,
} from '../../../types/enrichmentAutonomy';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const importTransform = require('../../import/02_transform_osm.js') as {
  sanitise: (s: unknown, maxLen?: number) => string | null;
  isStructuralArtifact: (name: string) => boolean;
  isWithinUK: (lat: number, lon: number) => boolean;
};

export interface RawOsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export type DiscoveryOutcome =
  | 'candidate'
  | 'skipped_no_name'
  | 'skipped_artifact'
  | 'skipped_no_coords'
  | 'skipped_outside_uk'
  | 'skipped_irrelevant_category';

export interface DiscoveryEvaluation {
  outcome: DiscoveryOutcome;
  sourceId: string; // `${type}/${id}` — matches venues.osm_id convention
  candidate?: DedupeCandidate;
  categorySlug?: string;
  categoryMatchKind?: 'structural' | 'name_hint';
  dedupe?: DedupeResult;
  acceptInput?: CandidateAcceptInput;
  acceptResult?: CandidateAcceptResult;
}

/** Registrable-ish domain extraction — good enough for a domain-match dedupe signal, not a security boundary. */
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Degrees-latitude box big enough to comfortably contain a 300m dedupe gate, cheap to widen for longitude at any UK latitude. */
const NEARBY_LAT_DEG = 0.01; // ~1.1km
const NEARBY_LON_DEG = 0.02; // ~1.4km at UK latitudes (conservative, errs wide)

function nearbyExisting(all: DedupeExistingVenue[], lat: number, lon: number): DedupeExistingVenue[] {
  return all.filter(
    (v) => Math.abs(v.latitude - lat) <= NEARBY_LAT_DEG && Math.abs(v.longitude - lon) <= NEARBY_LON_DEG,
  );
}

/**
 * Deterministic, conservative confidence score for an OSM-only discovery
 * candidate (0-100). Intentionally hard to max out: this build has no
 * official-site corroboration for NEW venues (that would require crawling an
 * unverified website found via the candidate itself — a separate, riskier
 * feature not in scope here), so the ceiling assumes only OSM completeness.
 * A structural category match plus postcode+phone+website is required to
 * even reach candidateAccept's AUTO_ACCEPT_MIN_SCORE (98) — everything else
 * lands in quarantine for human review, which is the deliberately conservative
 * posture Part 8 asks for.
 */
export function scoreDiscoveryCandidate(
  candidate: DedupeCandidate,
  categoryMatchKind: 'structural' | 'name_hint',
): number {
  let score = categoryMatchKind === 'structural' ? 70 : 50;
  if (candidate.postcode) score += 15;
  if (candidate.phone) score += 10;
  if (candidate.websiteDomain) score += 5;
  return Math.min(100, score);
}

export interface EvaluateOptions {
  /** Existing venues to dedupe against (should be pre-filtered by caller, e.g. one Overpass cell at a time). */
  existingVenues: DedupeExistingVenue[];
}

/**
 * Evaluate a single raw OSM element as a discovery candidate. PURE — no I/O.
 * Mirrors transformElement's filter order (name -> artifact -> coords -> UK)
 * before doing anything discovery-specific (category/dedupe/accept-gate).
 */
export function evaluateElement(element: RawOsmElement, opts: EvaluateOptions): DiscoveryEvaluation {
  const sourceId = `${element.type}/${element.id}`;
  const tags = element.tags ?? {};

  const name = importTransform.sanitise(tags.name, 200);
  if (!name) return { outcome: 'skipped_no_name', sourceId };
  if (importTransform.isStructuralArtifact(name)) return { outcome: 'skipped_artifact', sourceId };

  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  if (lat === null || lon === null) return { outcome: 'skipped_no_coords', sourceId };
  if (!importTransform.isWithinUK(lat, lon)) return { outcome: 'skipped_outside_uk', sourceId };

  const structuralSlug = resolveStructuralCategorySlug(tags);
  const hint = structuralSlug ? null : matchByNameHint(name);
  const categorySlug = structuralSlug ?? hint?.target.categorySlug ?? null;
  const categoryMatchKind: 'structural' | 'name_hint' | null = structuralSlug ? 'structural' : hint ? 'name_hint' : null;
  if (!categorySlug || !categoryMatchKind) return { outcome: 'skipped_irrelevant_category', sourceId };

  const candidate: DedupeCandidate = {
    name,
    latitude: lat,
    longitude: lon,
    postcode: tags['addr:postcode'] ?? null,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    websiteDomain: extractDomain(tags.website ?? tags['contact:website']),
    category: categorySlug,
  };

  const dedupe = dedupeAgainstExisting(candidate, nearbyExisting(opts.existingVenues, lat, lon));
  const score = scoreDiscoveryCandidate(candidate, categoryMatchKind);

  const acceptInput: CandidateAcceptInput = {
    hasFamilyRelevantCategory: true,
    hasValidUkCoordinates: true,
    hasValidAddress: !!candidate.postcode,
    dedupeDecision: dedupe.decision,
    // Trusted requires BOTH a tier-<=2 source (sourceTrust.ts — this pipeline is
    // OSM-only today, so always true, but this stays correct if a lower-tier
    // source is ever added) AND a structural tag match — a name-hint-only guess
    // is deliberately NOT trusted enough to ever auto-accept unattended.
    isTrustedSource: categoryMatchKind === 'structural' && isTrustedSourceId('osm'),
    officialVerification: false, // this pipeline never crawls the candidate's own site (out of scope, see file header)
    hasClosureSignal: false, // no crawl history exists yet for a brand-new candidate
    requiredFieldsComplete: !!(candidate.name && candidate.postcode),
    confidenceScore: score,
  };
  const acceptResult = decideCandidateAccept(acceptInput);

  return {
    outcome: 'candidate',
    sourceId,
    candidate,
    categorySlug,
    categoryMatchKind,
    dedupe,
    acceptInput,
    acceptResult,
  };
}

// ── I/O shell ──────────────────────────────────────────────────────────────

export interface DiscoveryCounts {
  elementsScanned: number;
  skippedNoName: number;
  skippedArtifact: number;
  skippedNoCoords: number;
  skippedOutsideUk: number;
  skippedIrrelevantCategory: number;
  candidatesEvaluated: number;
  exactDuplicatesSkipped: number;
  possibleDuplicatesQuarantined: number;
  autoAccepted: number;
  quarantined: number;
  rejectedWeak: number;
  errors: number;
}

export function emptyCounts(): DiscoveryCounts {
  return {
    elementsScanned: 0, skippedNoName: 0, skippedArtifact: 0, skippedNoCoords: 0,
    skippedOutsideUk: 0, skippedIrrelevantCategory: 0, candidatesEvaluated: 0,
    exactDuplicatesSkipped: 0, possibleDuplicatesQuarantined: 0,
    autoAccepted: 0, quarantined: 0, rejectedWeak: 0, errors: 0,
  };
}

export interface DiscoverDeps {
  existingVenues: DedupeExistingVenue[];
  /** Upsert one candidate row (on conflict (source, source_id)). Only called when write=true. */
  upsertCandidate?: (row: {
    sourceId: string;
    candidate: DedupeCandidate;
    dedupe: DedupeResult;
    acceptInput: CandidateAcceptInput;
    acceptResult: CandidateAcceptResult;
  }) => Promise<{ id: string }>;
  /** Call the auto_accept_candidate RPC for an auto_accept-decision candidate. Only called when apply=true. */
  autoAcceptCandidate?: (candidateId: string) => Promise<void>;
  write: boolean;
  apply: boolean;
  limit?: number;
}

export async function discoverFromElements(
  elements: Iterable<RawOsmElement>,
  deps: DiscoverDeps,
): Promise<DiscoveryCounts> {
  const counts = emptyCounts();

  for (const element of elements) {
    if (deps.limit !== undefined && counts.candidatesEvaluated >= deps.limit) break;
    counts.elementsScanned += 1;

    let evaluation: DiscoveryEvaluation;
    try {
      evaluation = evaluateElement(element, { existingVenues: deps.existingVenues });
    } catch {
      counts.errors += 1;
      continue;
    }

    switch (evaluation.outcome) {
      case 'skipped_no_name': counts.skippedNoName += 1; continue;
      case 'skipped_artifact': counts.skippedArtifact += 1; continue;
      case 'skipped_no_coords': counts.skippedNoCoords += 1; continue;
      case 'skipped_outside_uk': counts.skippedOutsideUk += 1; continue;
      case 'skipped_irrelevant_category': counts.skippedIrrelevantCategory += 1; continue;
      case 'candidate': break;
    }

    counts.candidatesEvaluated += 1;
    const { dedupe, acceptResult } = evaluation;
    if (dedupe!.decision === 'duplicate') counts.exactDuplicatesSkipped += 1;
    if (dedupe!.decision === 'possible_duplicate') counts.possibleDuplicatesQuarantined += 1;

    if (acceptResult!.decision === 'auto_accept') counts.autoAccepted += 1;
    else if (acceptResult!.decision === 'quarantine') counts.quarantined += 1;
    else counts.rejectedWeak += 1;

    // Exact duplicates are never written — Part 8: enrich the existing venue, don't create another.
    if (dedupe!.decision === 'duplicate') continue;

    if (deps.write && deps.upsertCandidate) {
      try {
        const row = await deps.upsertCandidate({
          sourceId: evaluation.sourceId,
          candidate: evaluation.candidate!,
          dedupe: evaluation.dedupe!,
          acceptInput: evaluation.acceptInput!,
          acceptResult: evaluation.acceptResult!,
        });
        if (deps.apply && deps.autoAcceptCandidate && acceptResult!.decision === 'auto_accept') {
          await deps.autoAcceptCandidate(row.id);
        }
      } catch {
        counts.errors += 1;
      }
    }
  }

  return counts;
}
