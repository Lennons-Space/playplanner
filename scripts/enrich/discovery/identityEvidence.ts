// =============================================================================
// scripts/enrich/discovery/identityEvidence.ts
//
// Enrichment 2.1 hardening — INDEPENDENT IDENTITY EVIDENCE for new-venue
// creation.
//
// THE PROBLEM THIS EXISTS FOR: a fully-populated OSM record scores 100
// (structural category 70 + postcode 15 + phone 10 + website 5) and therefore
// cleared the old auto-accept bar of 98 on its own. That meant ONE community-
// editable record could publish a public venue with no human review. A high
// score says "we parsed this record well"; it cannot say "this place exists
// and is what the record claims". Those are different questions, and only the
// second one should be allowed to publish.
//
// WHAT COUNTS AS ONE UNIT OF INDEPENDENT IDENTITY EVIDENCE
//   1. The discovery record itself                                   (always 1)
//   2. VERIFIED official-site corroboration — the venue's own domain
//      confirming name + an independent signal (postcode/phone/tight
//      coordinates). See web/officialCorroboration.ts.                    (+1)
//   3. A record from a genuinely INDEPENDENT trusted source that resolves to
//      the same physical venue.                                    (+1 each)
//
// WHAT EXPLICITLY DOES NOT COUNT (mirrors the instruction "do not fake
// independence"), enforced structurally below rather than by convention:
//   - More tags on the same OSM record. One record is one witness.
//   - More pages crawled from the same venue website. One domain is one
//     witness — corroboration contributes at most +1 no matter how many pages
//     agreed.
//   - A provider that MIRRORS another provider's data. Geoapify is
//     OSM-derived (see sourceTrust.ts's SOURCE_DERIVED_FROM), so OSM +
//     Geoapify is one witness heard twice, not two witnesses.
//   - The same source appearing twice in the candidate stream (e.g. a venue
//     mapped as both a node and a way in OSM) — deduplicated by source.
//
// This module is PURE and has no I/O; the cross-source agreement it computes
// is derived from the candidate stream the providers already returned, so it
// costs no extra network or database work.
// =============================================================================

import { dedupeAgainstExisting } from './dedupe';
import { areSourcesIndependent, type SourceId } from '../sourceTrust';
import type { DedupeCandidate, DedupeExistingVenue } from '../../../types/enrichmentAutonomy';
import type { NormalizedCandidate } from './providers/types';

/** Minimum independent attestations before automation may PUBLISH a brand-new venue unattended. */
export const MIN_INDEPENDENT_IDENTITY_EVIDENCE = 2;

export interface IdentityEvidence {
  /** Distinct, mutually-independent sources attesting to this venue's identity. Always includes the candidate's own source. */
  sources: SourceId[];
  count: number;
}

/**
 * A candidate reshaped as a dedupe target, so cross-source agreement reuses
 * the EXACT same matching rules as candidate-vs-existing-venue dedupe
 * (dedupe.ts) — including its "never merge on name similarity alone" rule.
 * Inventing a second, looser notion of "same venue" here would be the easiest
 * possible way to accidentally manufacture fake corroboration.
 */
function asDedupeCandidate(nc: NormalizedCandidate): DedupeCandidate {
  return {
    name: nc.name,
    latitude: nc.latitude,
    longitude: nc.longitude,
    postcode: nc.postcode,
    phone: nc.phone,
    websiteDomain: extractDomain(nc.website),
    category: null,
  };
}

function asDedupeExisting(nc: NormalizedCandidate, index: number): DedupeExistingVenue {
  return {
    id: `nc-${index}`,
    name: nc.name,
    latitude: nc.latitude,
    longitude: nc.longitude,
    postcode: nc.postcode,
    phone: nc.phone,
    websiteDomain: extractDomain(nc.website),
    category: null,
  };
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Index of cross-source agreement across ONE discovery run's candidate stream.
 *
 * For each candidate (keyed `source/sourceId`), records which OTHER sources
 * produced a record that dedupe.ts calls the same venue ('duplicate' only —
 * 'possible_duplicate' is deliberately NOT strong enough to be treated as
 * confirmed identity agreement, exactly as it is not strong enough to merge).
 */
export function buildCrossSourceAgreement(candidates: NormalizedCandidate[]): Map<string, Set<SourceId>> {
  const agreement = new Map<string, Set<SourceId>>();
  const keyOf = (nc: NormalizedCandidate): string => `${nc.source}/${nc.sourceId}`;

  for (const nc of candidates) agreement.set(keyOf(nc), new Set());

  for (let i = 0; i < candidates.length; i += 1) {
    const self = candidates[i]!;
    // Only records from an INDEPENDENT source can ever corroborate — a second
    // record from the same source (or a mirror of it) is filtered out here,
    // before any matching runs, so it cannot contribute even accidentally.
    const others = candidates
      .map((c, idx) => ({ c, idx }))
      .filter(({ c, idx }) => idx !== i && areSourcesIndependent(self.source, c.source));
    if (others.length === 0) continue;

    const matches = dedupeAgainstExisting(
      asDedupeCandidate(self),
      others.map(({ c, idx }) => asDedupeExisting(c, idx)),
    );
    if (matches.decision !== 'duplicate' || !matches.matchedVenueId) continue;

    const matchedIdx = Number(matches.matchedVenueId.replace('nc-', ''));
    const matched = candidates[matchedIdx];
    if (!matched) continue;
    agreement.get(keyOf(self))!.add(matched.source);
  }

  return agreement;
}

export interface IdentityEvidenceInput {
  /** The source that produced this candidate. */
  source: SourceId;
  /** True only for a VERIFIED_SAME_VENUE result from the venue's OWN website (never PROBABLE/AMBIGUOUS). */
  officialVerification: boolean;
  /** Independent sources that separately resolved to this same venue — from buildCrossSourceAgreement. */
  agreeingSources?: ReadonlySet<SourceId>;
}

/**
 * Count the mutually-independent attestations for one candidate.
 *
 * Every accepted source is checked for independence against every source
 * ALREADY counted, so a third source that mirrors an existing one adds
 * nothing. Official-site verification counts once and only once, however many
 * pages of that site agreed.
 */
export function computeIdentityEvidence(input: IdentityEvidenceInput): IdentityEvidence {
  const sources: SourceId[] = [input.source];

  const tryAdd = (candidateSource: SourceId): void => {
    if (sources.every((s) => areSourcesIndependent(s, candidateSource))) {
      sources.push(candidateSource);
    }
  };

  // The venue's own website is the strongest identity witness there is, and is
  // independent of every structured aggregator by construction.
  if (input.officialVerification) tryAdd('official_website');

  // Deterministic order so the resulting list (which is persisted for audit)
  // never depends on Set iteration order.
  for (const s of Array.from(input.agreeingSources ?? []).sort()) tryAdd(s);

  return { sources, count: sources.length };
}
