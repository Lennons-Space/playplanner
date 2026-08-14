// =============================================================================
// scripts/enrich/discovery/dedupe.ts
//
// Enrichment 2.0 — Part 7: strong deduplication for candidate new venues
// against existing PlayPlanner venues.
//
// Reuses the proven name/geometry primitives from geoapifyMatch.ts (Part 20:
// "extend existing discovery tooling rather than starting a second discovery
// stack") rather than re-implementing string similarity / haversine distance.
// This module adds the SIGNALS that matter for candidate-vs-existing-venue
// dedup specifically: postcode, phone, and website-domain exact matches, which
// geoapifyMatch.ts's Geoapify-feature-vs-venue matcher does not need in the
// same way.
//
// RULE (Part 7, explicit): "Never merge solely because names are similar."
// Name similarity alone — however high — caps out at 'possible_duplicate',
// never 'duplicate'. A 'duplicate' verdict always requires at least one
// corroborating non-name signal (location within gate, postcode, phone, or
// website domain).
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import { haversineMetres, nameSimilarity } from '../geoapifyMatch';
import type {
  DedupeCandidate,
  DedupeDecision,
  DedupeExistingVenue,
  DedupeResult,
  DedupeSignalBreakdown,
} from '../../../types/enrichmentAutonomy';

/** Candidates further than this from an existing venue are never the same place. */
export const DEDUPE_DISTANCE_GATE_M = 300;

/**
 * Very tight gate — close enough that it is implausible for two distinct
 * family venues to occupy the same footprint. Combined with a postcode match
 * (or alone, if extremely tight), this is strong enough evidence to merge
 * EVEN WHEN THE NAME IS COMPLETELY DIFFERENT (the renamed-venue case).
 */
const TIGHT_DISTANCE_GATE_M = 50;
const EXTREMELY_TIGHT_GATE_M = 20;

/** Very high name similarity even without any other signal — still capped at possible_duplicate. */
const NEAR_IDENTICAL_NAME_FLOOR = 0.92;

/** Floor below which name similarity contributes nothing to a duplicate/possible_duplicate call. */
const NAME_SIM_FLOOR = 0.5;

function normalisePostcode(p: string | null): string | null {
  if (!p) return null;
  return p.toUpperCase().replace(/\s+/g, '');
}

function normalisePhoneDigits(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 9 ? digits.replace(/^0/, '44') : null;
}

/** Category compatibility is a soft signal only — different categories don't rule out a rebrand. */
function categoryCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // unknown -> don't penalise
  return a === b;
}

function scoreAgainst(candidate: DedupeCandidate, existing: DedupeExistingVenue): {
  score: number;
  signals: DedupeSignalBreakdown;
} {
  const distanceM = haversineMetres(candidate.latitude, candidate.longitude, existing.latitude, existing.longitude);
  const nameSim = nameSimilarity(candidate.name, existing.name);
  const postcodeMatch =
    normalisePostcode(candidate.postcode) !== null &&
    normalisePostcode(candidate.postcode) === normalisePostcode(existing.postcode);
  const candPhone = normalisePhoneDigits(candidate.phone);
  const existPhone = normalisePhoneDigits(existing.phone);
  const phoneMatch = candPhone !== null && candPhone === existPhone;
  const domainMatch =
    !!candidate.websiteDomain &&
    !!existing.websiteDomain &&
    candidate.websiteDomain.toLowerCase() === existing.websiteDomain.toLowerCase();
  const catCompatible = categoryCompatible(candidate.category, existing.category);

  const withinGate = distanceM <= DEDUPE_DISTANCE_GATE_M;
  const distanceScore = withinGate ? 1 - distanceM / DEDUPE_DISTANCE_GATE_M : 0;

  // Weighted composite — name matters most but never solely decides 'duplicate'.
  const score =
    0.40 * nameSim +
    0.25 * distanceScore +
    0.15 * (postcodeMatch ? 1 : 0) +
    0.10 * (phoneMatch ? 1 : 0) +
    0.10 * (domainMatch ? 1 : 0);

  return {
    score,
    signals: {
      nameSim: Number(nameSim.toFixed(4)),
      distanceM: Math.round(distanceM),
      postcodeMatch,
      phoneMatch,
      domainMatch,
      categoryCompatible: catCompatible,
    },
  };
}

/**
 * Compare one discovery candidate against a shortlist of nearby existing
 * venues (callers should pre-filter to a bounding box before calling this —
 * this function itself has no distance pre-filter beyond the dedupe gate
 * applied per-candidate below) and return the strongest match verdict.
 */
export function dedupeAgainstExisting(
  candidate: DedupeCandidate,
  existingVenues: DedupeExistingVenue[],
): DedupeResult {
  if (existingVenues.length === 0) {
    return {
      decision: 'distinct',
      score: 0,
      matchedVenueId: null,
      signals: {
        nameSim: 0,
        distanceM: null,
        postcodeMatch: false,
        phoneMatch: false,
        domainMatch: false,
        categoryCompatible: true,
      },
      reasons: ['no existing venues to compare against'],
    };
  }

  let best: { venue: DedupeExistingVenue; score: number; signals: DedupeSignalBreakdown } | null = null;
  for (const existing of existingVenues) {
    const { score, signals } = scoreAgainst(candidate, existing);
    if (!best || score > best.score) best = { venue: existing, score, signals };
  }
  // best is guaranteed non-null: existingVenues.length > 0 above.
  const { venue, score, signals } = best!;

  const distanceM = signals.distanceM;
  const withinWideGate = distanceM !== null && distanceM <= DEDUPE_DISTANCE_GATE_M;
  const withinTightGate = distanceM !== null && distanceM <= TIGHT_DISTANCE_GATE_M;
  const withinExtremelyTightGate = distanceM !== null && distanceM <= EXTREMELY_TIGHT_GATE_M;
  const nearIdenticalName = signals.nameSim >= NEAR_IDENTICAL_NAME_FLOOR;
  const usableName = signals.nameSim >= NAME_SIM_FLOOR;

  // "Same footprint" — implausible for two distinct family venues to share:
  // tight distance corroborated by a postcode match, or coordinates so close
  // they are effectively identical even without a postcode to check.
  const sameFootprint = (withinTightGate && signals.postcodeMatch) || withinExtremelyTightGate;

  const reasons: string[] = [];
  let decision: DedupeDecision;

  if (signals.phoneMatch) {
    // An exact public business phone number is essentially never shared by two
    // distinct venues — strong enough evidence alone, independent of name/location.
    decision = 'duplicate';
    reasons.push('exact phone number match');
  } else if (sameFootprint) {
    // Same physical footprint. Strong enough to merge even if the name is
    // completely different (renamed-venue pattern) — but NOT if the only
    // signal is a shared postcode at ordinary distance (postcodes cover many
    // neighbouring properties; see the possible_duplicate branch below).
    decision = 'duplicate';
    reasons.push('same physical footprint (tight distance + postcode, or near-identical coordinates)');
  } else if (signals.domainMatch && withinTightGate) {
    decision = 'duplicate';
    reasons.push('website domain match at the same footprint');
  } else if (usableName && withinWideGate && (signals.postcodeMatch || withinTightGate)) {
    // "Same venue, formatting difference" — plausible name overlap AND a
    // corroborating location signal within the ordinary gate.
    decision = 'duplicate';
    reasons.push('name overlap corroborated by postcode/tight-distance match');
  } else if (signals.postcodeMatch || (signals.domainMatch && withinWideGate) || nearIdenticalName) {
    // Postcode alone (different name — could be a neighbouring distinct
    // business), OR a shared domain at ordinary (not tight) distance (likely a
    // different branch of the same chain), OR a near-identical name with no
    // corroborating location (could be miles apart — checked below) all land
    // here for human review rather than an automatic merge.
    decision = nearIdenticalName && !withinWideGate ? 'distinct' : 'possible_duplicate';
    reasons.push(
      nearIdenticalName && !withinWideGate
        ? 'near-identical name but far outside the distance gate — treated as a distinct venue'
        : 'a single corroborating signal without a footprint match — needs human review',
    );
  } else if (usableName && withinWideGate) {
    decision = 'possible_duplicate';
    reasons.push('name and location both plausible but neither strong enough alone');
  } else {
    decision = 'distinct';
    reasons.push(`composite score ${score.toFixed(2)} — no meaningful overlap`);
  }

  return {
    decision,
    score: Number(score.toFixed(4)),
    matchedVenueId: decision === 'distinct' ? null : venue.id,
    signals,
    reasons,
  };
}
