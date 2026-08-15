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
import { isTrustedSourceId, type SourceId } from '../sourceTrust';
import { resolveGeoapifyCategorySlug } from './providers/geoapifyCategoryMap';
import type { NormalizedCandidate } from './providers/types';
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
  sourceId: string; // OSM: `${type}/${id}` (matches venues.osm_id convention). Other sources: that source's own stable id.
  /** Which discovery source produced this candidate — carried through so the persisted row is attributed correctly (never hardcoded downstream). */
  source: SourceId;
  candidate?: DedupeCandidate;
  categorySlug?: string;
  categoryMatchKind?: 'structural' | 'name_hint';
  /** Full website URL as supplied by the source (DedupeCandidate only keeps the bare domain, which is all dedupe needs). */
  websiteUrl?: string | null;
  city?: string | null;
  addressLine1?: string | null;
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

/** Everything before dedupe/accept-gate — pure, shared by both the sync (full-pool) and async (spatial-RPC) paths, and by EVERY provider. */
interface PrecheckOk {
  ok: true;
  source: SourceId;
  sourceId: string;
  name: string;
  lat: number;
  lon: number;
  postcode: string | null;
  phone: string | null;
  websiteUrl: string | null;
  city: string | null;
  addressLine1: string | null;
  categorySlug: string;
  categoryMatchKind: 'structural' | 'name_hint';
}
interface PrecheckFail {
  ok: false;
  source: SourceId;
  sourceId: string;
  outcome: Exclude<DiscoveryOutcome, 'candidate'>;
}

/**
 * The provider-neutral shape every discovery source is reduced to before any
 * PlayPlanner-specific logic runs. Adding a source means writing a mapper to
 * this (plus a `categoryEvidence` branch in resolveStructuralSlugFor) — never
 * duplicating the filter/dedupe/accept-gate chain below.
 */
interface NeutralCandidateInput {
  source: SourceId;
  sourceId: string;
  /** Unsanitised — sanitise() is applied inside precheckNeutral so every provider gets identical treatment. */
  rawName: unknown;
  latitude: number | null;
  longitude: number | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  addressLine1: string | null;
  /** OSM: the raw tag map. Geoapify: `{ categories: string[] }`. Interpreted ONLY by resolveStructuralSlugFor. */
  categoryEvidence: Record<string, unknown>;
}

/**
 * Per-source structural category resolution. A source with no resolver here
 * gets `null` (name-hint matching only), which can never auto-accept —
 * finishEvaluation requires a structural match for isTrustedSource. So adding
 * a source and forgetting to add a branch here fails SAFE (everything
 * quarantines), never open.
 */
function resolveStructuralSlugFor(source: SourceId, evidence: Record<string, unknown>): string | null {
  switch (source) {
    case 'osm':
      // The evidence map IS the OSM tag map.
      return resolveStructuralCategorySlug(evidence as Record<string, string>);
    case 'geoapify': {
      const raw = evidence.categories;
      const categories = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
      return resolveGeoapifyCategorySlug(categories);
    }
    default:
      return null;
  }
}

/**
 * Mirrors transformElement's filter order (name -> artifact -> coords -> UK)
 * before resolving a category. PURE — no I/O, no dedupe (that needs a nearby-
 * venue set, supplied by the caller via either the full pool or a spatial
 * lookup — see evaluateElement / evaluateElementWithLookup below).
 */
function precheckNeutral(input: NeutralCandidateInput): PrecheckOk | PrecheckFail {
  const { source, sourceId } = input;

  const name = importTransform.sanitise(input.rawName, 200);
  if (!name) return { ok: false, outcome: 'skipped_no_name', source, sourceId };
  if (importTransform.isStructuralArtifact(name)) return { ok: false, outcome: 'skipped_artifact', source, sourceId };

  const lat = input.latitude;
  const lon = input.longitude;
  if (lat === null || lon === null) return { ok: false, outcome: 'skipped_no_coords', source, sourceId };
  if (!importTransform.isWithinUK(lat, lon)) return { ok: false, outcome: 'skipped_outside_uk', source, sourceId };

  const structuralSlug = resolveStructuralSlugFor(source, input.categoryEvidence);
  const hint = structuralSlug ? null : matchByNameHint(name);
  const categorySlug = structuralSlug ?? hint?.target.categorySlug ?? null;
  const categoryMatchKind: 'structural' | 'name_hint' | null = structuralSlug ? 'structural' : hint ? 'name_hint' : null;
  if (!categorySlug || !categoryMatchKind) return { ok: false, outcome: 'skipped_irrelevant_category', source, sourceId };

  return {
    ok: true,
    source,
    sourceId,
    name,
    lat,
    lon,
    postcode: input.postcode,
    phone: input.phone,
    websiteUrl: input.website,
    city: input.city,
    addressLine1: input.addressLine1,
    categorySlug,
    categoryMatchKind,
  };
}

/** OSM-element -> neutral mapper. Field-for-field identical to the original inline OSM precheck. */
function precheckElement(element: RawOsmElement): PrecheckOk | PrecheckFail {
  const tags = element.tags ?? {};
  return precheckNeutral({
    source: 'osm',
    sourceId: `${element.type}/${element.id}`,
    rawName: tags.name,
    latitude: element.lat ?? element.center?.lat ?? null,
    longitude: element.lon ?? element.center?.lon ?? null,
    postcode: tags['addr:postcode'] ?? null,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    city: tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'] ?? null,
    addressLine1: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
    categoryEvidence: tags,
  });
}

/** NormalizedCandidate -> neutral mapper. Every provider (including OSM, via its own provider) can use this path. */
function precheckCandidate(nc: NormalizedCandidate): PrecheckOk | PrecheckFail {
  return precheckNeutral({
    source: nc.source,
    sourceId: nc.sourceId,
    rawName: nc.name,
    latitude: nc.latitude,
    longitude: nc.longitude,
    postcode: nc.postcode,
    phone: nc.phone,
    website: nc.website,
    city: nc.city,
    addressLine1: nc.addressLine1,
    categoryEvidence: nc.categoryEvidence,
  });
}

/** Dedupe + score + accept-gate — pure, given an already-narrowed nearby-venue set. Source-agnostic. */
function finishEvaluation(pre: PrecheckOk, nearby: DedupeExistingVenue[]): DiscoveryEvaluation {
  const candidate: DedupeCandidate = {
    name: pre.name,
    latitude: pre.lat,
    longitude: pre.lon,
    postcode: pre.postcode,
    phone: pre.phone,
    websiteDomain: extractDomain(pre.websiteUrl),
    category: pre.categorySlug,
  };

  const dedupe = dedupeAgainstExisting(candidate, nearby);
  const score = scoreDiscoveryCandidate(candidate, pre.categoryMatchKind);

  const acceptInput: CandidateAcceptInput = {
    hasFamilyRelevantCategory: true,
    hasValidUkCoordinates: true,
    hasValidAddress: !!candidate.postcode,
    dedupeDecision: dedupe.decision,
    // Trusted requires BOTH a tier-<=2 source (sourceTrust.ts — resolved from
    // the candidate's OWN source, so a lower-tier source added later is
    // correctly distrusted without touching this line) AND a structural
    // category match — a name-hint-only guess is deliberately NOT trusted
    // enough to ever auto-accept unattended.
    isTrustedSource: pre.categoryMatchKind === 'structural' && isTrustedSourceId(pre.source),
    officialVerification: false, // set by the official-corroboration step (Phase D4), not here
    hasClosureSignal: false, // no crawl history exists yet for a brand-new candidate
    requiredFieldsComplete: !!(candidate.name && candidate.postcode),
    confidenceScore: score,
  };
  const acceptResult = decideCandidateAccept(acceptInput);

  return {
    outcome: 'candidate',
    source: pre.source,
    sourceId: pre.sourceId,
    candidate,
    categorySlug: pre.categorySlug,
    categoryMatchKind: pre.categoryMatchKind,
    websiteUrl: pre.websiteUrl,
    city: pre.city,
    addressLine1: pre.addressLine1,
    dedupe,
    acceptInput,
    acceptResult,
  };
}

/**
 * Evaluate a single raw OSM element as a discovery candidate against a FULL
 * in-memory pool. PURE — no I/O. This is the original Enrichment 2.0 path;
 * kept unchanged (same signature, same behaviour, same tests) as the fixture/
 * test fallback — production discovery now prefers evaluateElementWithLookup
 * (Enrichment 2.1 Phase D), which fetches a small pre-narrowed set from the
 * dedicated spatial RPC instead of scanning the whole venues table per
 * candidate.
 */
export function evaluateElement(element: RawOsmElement, opts: EvaluateOptions): DiscoveryEvaluation {
  const pre = precheckElement(element);
  if (!pre.ok) return { outcome: pre.outcome, source: pre.source, sourceId: pre.sourceId };
  return finishEvaluation(pre, nearbyExisting(opts.existingVenues, pre.lat, pre.lon));
}

/**
 * Provider-neutral sibling of evaluateElement (Enrichment 2.1 Phase E/D3):
 * evaluates ANY provider's NormalizedCandidate through the exact same
 * precheck -> dedupe -> corroboration-ready -> accept-gate chain. This is the
 * function that makes a second discovery source real rather than merely
 * counted.
 */
export function evaluateCandidate(nc: NormalizedCandidate, opts: EvaluateOptions): DiscoveryEvaluation {
  const pre = precheckCandidate(nc);
  if (!pre.ok) return { outcome: pre.outcome, source: pre.source, sourceId: pre.sourceId };
  return finishEvaluation(pre, nearbyExisting(opts.existingVenues, pre.lat, pre.lon));
}

/** Spatial-RPC (production) counterpart of evaluateCandidate — same relationship as evaluateElementWithLookup has to evaluateElement. */
export async function evaluateCandidateWithLookup(
  nc: NormalizedCandidate,
  lookupNearby: (lat: number, lon: number) => Promise<DedupeExistingVenue[]>,
): Promise<DiscoveryEvaluation> {
  const pre = precheckCandidate(nc);
  if (!pre.ok) return { outcome: pre.outcome, source: pre.source, sourceId: pre.sourceId };
  const nearby = await lookupNearby(pre.lat, pre.lon);
  return finishEvaluation(pre, nearby);
}

/**
 * Evaluate a single raw OSM element using an injected async spatial lookup
 * instead of an in-memory full pool (Enrichment 2.1 Phase D). The lookup is
 * only ever called for elements that already passed the free, synchronous
 * precheck (name/artifact/coords/UK/category) — never wastes a DB round-trip
 * on an element that would be rejected anyway.
 */
export async function evaluateElementWithLookup(
  element: RawOsmElement,
  lookupNearby: (lat: number, lon: number) => Promise<DedupeExistingVenue[]>,
): Promise<DiscoveryEvaluation> {
  const pre = precheckElement(element);
  if (!pre.ok) return { outcome: pre.outcome, source: pre.source, sourceId: pre.sourceId };
  const nearby = await lookupNearby(pre.lat, pre.lon);
  return finishEvaluation(pre, nearby);
}

/**
 * Meaningful score bonus for VERIFIED_SAME_VENUE (Enrichment 2.1 Phase D4/H):
 * closes the gap the 2.0 build explicitly flagged — a structurally-tagged,
 * well-identified candidate that is merely missing a phone/website can now
 * reach auto-accept via corroboration instead ("phone/email must not be
 * mandatory if the rest of the identity bundle is exceptionally strong").
 * Never applied to a name-hint-only match — isTrustedSource still requires a
 * structural category match regardless of corroboration (see finishEvaluation).
 */
const OFFICIAL_VERIFICATION_SCORE_BONUS = 15;

/**
 * Re-decides a 'candidate' evaluation after official-site corroboration
 * (Enrichment 2.1 Phase D4/H). Only VERIFIED_SAME_VENUE ever changes the
 * outcome — PROBABLE/AMBIGUOUS/MISMATCH/UNAVAILABLE leave the evaluation
 * exactly as finishEvaluation already decided it (officialVerification stays
 * false, matching the conservative 2.0 default). Pure — takes the
 * corroboration status, not the crawl itself.
 */
export function applyCorroboration(
  evaluation: DiscoveryEvaluation,
  corroborationStatus: 'VERIFIED_SAME_VENUE' | 'PROBABLE' | 'AMBIGUOUS' | 'MISMATCH' | 'UNAVAILABLE',
): DiscoveryEvaluation {
  if (evaluation.outcome !== 'candidate' || !evaluation.acceptInput) return evaluation;
  if (corroborationStatus !== 'VERIFIED_SAME_VENUE') return evaluation;

  const acceptInput: CandidateAcceptInput = {
    ...evaluation.acceptInput,
    officialVerification: true,
    confidenceScore: Math.min(100, evaluation.acceptInput.confidenceScore + OFFICIAL_VERIFICATION_SCORE_BONUS),
  };
  return { ...evaluation, acceptInput, acceptResult: decideCandidateAccept(acceptInput) };
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
  /**
   * Per-source breakdown (Enrichment 2.1). Proves at report level that every
   * enabled provider's candidates actually reached a decision, rather than
   * being counted at fetch time and silently dropped before evaluation.
   */
  bySource: Partial<Record<SourceId, DiscoverySourceCounts>>;
}

export interface DiscoverySourceCounts {
  candidatesEvaluated: number;
  mergeExisting: number;
  autoAccepted: number;
  quarantined: number;
  rejectedWeak: number;
}

export function emptyCounts(): DiscoveryCounts {
  return {
    elementsScanned: 0, skippedNoName: 0, skippedArtifact: 0, skippedNoCoords: 0,
    skippedOutsideUk: 0, skippedIrrelevantCategory: 0, candidatesEvaluated: 0,
    exactDuplicatesSkipped: 0, possibleDuplicatesQuarantined: 0,
    autoAccepted: 0, quarantined: 0, rejectedWeak: 0, errors: 0, bySource: {},
  };
}

function sourceCounts(counts: DiscoveryCounts, source: SourceId): DiscoverySourceCounts {
  return (counts.bySource[source] ??= { candidatesEvaluated: 0, mergeExisting: 0, autoAccepted: 0, quarantined: 0, rejectedWeak: 0 });
}

export interface DiscoverDeps {
  /**
   * Full in-memory pool — the Enrichment 2.0 fixture/test fallback path.
   * Ignored when `lookupNearby` is provided (production path, Phase D).
   */
  existingVenues: DedupeExistingVenue[];
  /**
   * Production path (Phase D): per-candidate spatial prefilter, backed by the
   * `enrichment_nearby_venues_for_dedupe` RPC. When provided, this REPLACES
   * the full-pool scan entirely — `existingVenues` is never consulted.
   */
  lookupNearby?: (lat: number, lon: number) => Promise<DedupeExistingVenue[]>;
  /** Upsert one candidate row (on conflict (source, source_id)). Only called when write=true. */
  upsertCandidate?: (row: {
    /** The candidate's OWN source — never assumed by the caller (a hardcoded 'osm' here would mis-attribute every non-OSM row and collide on the (source, source_id) key). */
    source: SourceId;
    sourceId: string;
    candidate: DedupeCandidate;
    websiteUrl: string | null;
    city: string | null;
    addressLine1: string | null;
    dedupe: DedupeResult;
    acceptInput: CandidateAcceptInput;
    acceptResult: CandidateAcceptResult;
  }) => Promise<{ id: string }>;
  /** Call the auto_accept_candidate RPC for an auto_accept-decision candidate. Only called when apply=true. */
  autoAcceptCandidate?: (candidateId: string) => Promise<void>;
  /**
   * Official-site corroboration (Enrichment 2.1 Phase D4/H). Only ever called
   * for a candidate that already has a supplied website AND already reached
   * 'candidate' outcome — never guesses a domain, never called for a
   * category-rejected/duplicate element. Optional: when absent, every
   * candidate's officialVerification stays false (2.0's original, still-safe
   * default).
   */
  corroborate?: (website: string | null, input: { name: string; postcode: string | null; city: string | null; latitude: number; longitude: number; phone: string | null }) => Promise<{ status: 'VERIFIED_SAME_VENUE' | 'PROBABLE' | 'AMBIGUOUS' | 'MISMATCH' | 'UNAVAILABLE' }>;
  write: boolean;
  apply: boolean;
  limit?: number;
}

/**
 * The single downstream pipeline, shared by EVERY provider (Enrichment 2.1):
 *   evaluate (normalize -> precheck -> spatial/detailed dedupe -> accept-gate)
 *   -> official corroboration -> re-decide
 *   -> merge_existing / auto_accept / quarantine / reject -> persist.
 * `evaluateOne` is the only source-specific part, and it only chooses which
 * mapper runs — every decision after it is identical for all sources.
 */
async function runDiscovery<T>(
  items: Iterable<T>,
  evaluateOne: (item: T) => Promise<DiscoveryEvaluation>,
  deps: DiscoverDeps,
): Promise<DiscoveryCounts> {
  const counts = emptyCounts();

  for (const item of items) {
    if (deps.limit !== undefined && counts.candidatesEvaluated >= deps.limit) break;
    counts.elementsScanned += 1;

    let evaluation: DiscoveryEvaluation;
    try {
      evaluation = await evaluateOne(item);

      // Corroboration only ever runs for a real candidate with its own
      // supplied website, and only matters (dedupe already runs first) when
      // the candidate isn't already a known duplicate — cheap early-out
      // avoids an unnecessary crawl for a candidate that's about to be
      // skipped/merged regardless of what corroboration would say.
      if (deps.corroborate && evaluation.outcome === 'candidate' && evaluation.candidate?.websiteDomain && evaluation.dedupe?.decision !== 'duplicate') {
        const c = evaluation.candidate;
        // Prefer the source's full URL (keeps any path); fall back to the bare
        // domain dedupe kept. Never invents a URL the source didn't supply.
        const website = evaluation.websiteUrl ?? (c.websiteDomain ? `https://${c.websiteDomain}` : null);
        const corroboration = await deps.corroborate(website, { name: c.name, postcode: c.postcode, city: evaluation.city ?? null, latitude: c.latitude, longitude: c.longitude, phone: c.phone });
        evaluation = applyCorroboration(evaluation, corroboration.status);
      }
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
    const per = sourceCounts(counts, evaluation.source);
    per.candidatesEvaluated += 1;
    const { dedupe, acceptResult } = evaluation;
    if (dedupe!.decision === 'duplicate') counts.exactDuplicatesSkipped += 1;
    if (dedupe!.decision === 'possible_duplicate') counts.possibleDuplicatesQuarantined += 1;

    if (acceptResult!.decision === 'auto_accept') { counts.autoAccepted += 1; per.autoAccepted += 1; }
    else if (acceptResult!.decision === 'quarantine') { counts.quarantined += 1; per.quarantined += 1; }
    else if (acceptResult!.decision === 'reject') { counts.rejectedWeak += 1; per.rejectedWeak += 1; }
    else if (acceptResult!.decision === 'merge_existing') { per.mergeExisting += 1; }
    // 'merge_existing' is already fully captured by exactDuplicatesSkipped in
    // the run total (the two are 1:1 — see candidateAccept.ts) — only the
    // per-source breakdown names it explicitly.

    // Exact duplicates are never written — Part 8: enrich the existing venue, don't create another.
    if (dedupe!.decision === 'duplicate') continue;

    if (deps.write && deps.upsertCandidate) {
      try {
        const row = await deps.upsertCandidate({
          source: evaluation.source,
          sourceId: evaluation.sourceId,
          candidate: evaluation.candidate!,
          websiteUrl: evaluation.websiteUrl ?? null,
          city: evaluation.city ?? null,
          addressLine1: evaluation.addressLine1 ?? null,
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

/** OSM raw-element entry point (Enrichment 2.0's original signature, unchanged). */
export async function discoverFromElements(
  elements: Iterable<RawOsmElement>,
  deps: DiscoverDeps,
): Promise<DiscoveryCounts> {
  return runDiscovery(
    elements,
    async (element) =>
      deps.lookupNearby
        ? evaluateElementWithLookup(element, deps.lookupNearby)
        : evaluateElement(element, { existingVenues: deps.existingVenues }),
    deps,
  );
}

/**
 * Provider-neutral entry point (Enrichment 2.1): consumes ANY provider's
 * NormalizedCandidates — including several providers' output concatenated
 * into one stream — through the identical downstream pipeline above. This is
 * what autonomous.ts --discover now calls.
 */
export async function discoverFromCandidates(
  candidates: Iterable<NormalizedCandidate>,
  deps: DiscoverDeps,
): Promise<DiscoveryCounts> {
  return runDiscovery(
    candidates,
    async (nc) =>
      deps.lookupNearby
        ? evaluateCandidateWithLookup(nc, deps.lookupNearby)
        : evaluateCandidate(nc, { existingVenues: deps.existingVenues }),
    deps,
  );
}
