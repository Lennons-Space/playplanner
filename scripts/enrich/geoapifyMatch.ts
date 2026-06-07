// =============================================================================
// scripts/enrich/geoapifyMatch.ts
//
// Pure matching engine: "is this Geoapify candidate actually our venue?"
//
// This is the highest-risk decision in the whole pipeline. A wrong match writes
// a plausible-but-false phone number or "wheelchair: yes" onto the wrong venue.
// So the matcher is a pure, fully-testable function with conservative gates:
//
//   ACCEPT  if  distance <= 150m  AND  score >= 0.70  AND  name_sim >= 0.50
//   REVIEW  if  distance <= 150m  AND  0.55 <= score < 0.70   (logged, not written)
//   REJECT  otherwise
//
//   score = 0.35*confidence + 0.45*name_sim + 0.20*postcode_match
//
// A category sanity check demotes an otherwise-ACCEPT match to REVIEW when the
// Geoapify category is in a clearly non-family-venue family (e.g. our soft-play
// vs. their commercial.car) — guards against coordinate collisions in retail parks.
//
// "Unknown is better than wrong" — when in doubt we REVIEW or REJECT, never write.
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import type {
  GeoapifyFeature,
  GeoapifyResponse,
  MatchDecision,
  MatchResult,
  VenueMatchInput,
} from '../../types/enrichment';

// ── Tunable thresholds (single source of truth) ───────────────────────────────
export const DISTANCE_GATE_M = 150;   // hard geometry gate — past this, auto-reject
export const ACCEPT_SCORE    = 0.70;
export const REVIEW_SCORE    = 0.55;
export const NAME_FLOOR      = 0.50;  // name must be at least this similar to ACCEPT

// Composite score weights (must sum to 1.0).
const W_CONFIDENCE = 0.35;
const W_NAME       = 0.45;
const W_POSTCODE   = 0.20;

// ── Name normalisation + similarity ───────────────────────────────────────────

// Business-name noise we strip before comparing. Keeps "The Willows Farm Ltd"
// comparable to "Willows Activity Farm".
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'ltd', 'limited', 'llp', 'plc', 'co', 'inc',
]);

/** lowercase, strip punctuation, drop stopwords, collapse whitespace. */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .join(' ')
    .trim();
}

function tokens(s: string): string[] {
  return s.length === 0 ? [] : s.split(' ');
}

/** Sørensen–Dice coefficient over the two token *sets* (order-independent). */
function tokenDice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

/** Levenshtein edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Name similarity in [0,1]. Combines token-set Dice (handles word reordering and
 * extra/missing words) with character Levenshtein ratio (handles typos and
 * spelling drift), taking the more generous of the two.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na.length === 0 || nb.length === 0) return 0;
  return Math.max(tokenDice(tokens(na), tokens(nb)), levenshteinRatio(na, nb));
}

// ── Distance (haversine, metres) ──────────────────────────────────────────────

export function haversineMetres(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ── Postcode comparison ───────────────────────────────────────────────────────

function postcodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.toUpperCase().replace(/\s+/g, '');
  return norm(a) === norm(b);
}

// ── Category family sanity check ──────────────────────────────────────────────
// Geoapify top-level categories that are clearly NOT family attractions. If the
// candidate's category sits here while we expected a family venue, the match is
// probably a coordinate collision (the shop next door) — demote to REVIEW.

const NON_FAMILY_TOP_LEVELS = new Set([
  'commercial', 'office', 'building', 'healthcare', 'industrial',
  'service', 'rental', 'production',
]);

function topLevel(category: string | undefined): string | null {
  if (!category) return null;
  return category.split('.')[0] ?? null;
}

function isCategoryMismatch(candidateCategory: string | null): boolean {
  const top = topLevel(candidateCategory ?? undefined);
  return top !== null && NON_FAMILY_TOP_LEVELS.has(top);
}

// ── Candidate coordinate extraction ───────────────────────────────────────────

function candidateLatLon(f: GeoapifyFeature): { lat: number; lon: number } | null {
  const p = f.properties;
  if (typeof p.lat === 'number' && typeof p.lon === 'number') {
    return { lat: p.lat, lon: p.lon };
  }
  // GeoJSON geometry is [lon, lat].
  const c = f.geometry?.coordinates;
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[1], lon: c[0] };
  }
  return null;
}

// ── Per-candidate scoring ─────────────────────────────────────────────────────

interface ScoredCandidate {
  feature:        GeoapifyFeature;
  distance_m:     number | null;
  name_sim:       number;
  postcode_match: boolean;
  confidence:     number;
  score:          number;
  within_gate:    boolean;
}

function scoreCandidate(venue: VenueMatchInput, f: GeoapifyFeature): ScoredCandidate {
  const p = f.properties;
  const coords = candidateLatLon(f);
  const distance_m = coords
    ? haversineMetres(venue.latitude, venue.longitude, coords.lat, coords.lon)
    : null;
  const name_sim = nameSimilarity(venue.name, p.name ?? '');
  const postcode_match = postcodesMatch(venue.postcode, p.postcode);
  const confidence = typeof p.rank?.confidence === 'number' ? p.rank.confidence : 0;

  const score =
    W_CONFIDENCE * confidence +
    W_NAME * name_sim +
    W_POSTCODE * (postcode_match ? 1 : 0);

  return {
    feature: f,
    distance_m,
    name_sim,
    postcode_match,
    confidence,
    score,
    within_gate: distance_m !== null && distance_m <= DISTANCE_GATE_M,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Decide whether any Geoapify candidate is our venue.
 *
 * Picks the best candidate that passes the distance gate (by composite score).
 * If none pass the gate, reports the closest candidate for the audit log but
 * returns REJECT. Never throws; an empty response yields a clean REJECT.
 */
export function matchVenue(venue: VenueMatchInput, resp: GeoapifyResponse | null | undefined): MatchResult {
  const features = resp?.features ?? [];

  if (features.length === 0) {
    return {
      decision: 'reject',
      score: 0,
      distance_m: null,
      name_sim: 0,
      postcode_match: false,
      confidence: 0,
      place_id: null,
      candidate_name: null,
      candidate_category: null,
      category_mismatch: false,
      reasons: ['no candidates returned by Geoapify'],
    };
  }

  const scored = features.map((f) => scoreCandidate(venue, f));

  // Prefer the highest-scoring candidate within the distance gate. If none are
  // within the gate, fall back to the closest one purely so the report shows
  // *why* we rejected (distance) rather than a misleadingly high-scoring far one.
  const inGate = scored.filter((c) => c.within_gate);
  const best = inGate.length > 0
    ? inGate.reduce((a, b) => (b.score > a.score ? b : a))
    : scored.reduce((a, b) => {
        const da = a.distance_m ?? Infinity;
        const db = b.distance_m ?? Infinity;
        return db < da ? b : a;
      });

  const p = best.feature.properties;
  const candidate_category = p.category ?? (p.categories?.[0] ?? null);
  const category_mismatch = isCategoryMismatch(candidate_category);

  const reasons: string[] = [];
  let decision: MatchDecision;

  if (!best.within_gate) {
    decision = 'reject';
    reasons.push(
      best.distance_m === null
        ? 'candidate has no coordinates'
        : `distance ${Math.round(best.distance_m)}m > ${DISTANCE_GATE_M}m gate`,
    );
  } else if (best.score >= ACCEPT_SCORE && best.name_sim >= NAME_FLOOR) {
    if (category_mismatch) {
      decision = 'review';
      reasons.push(
        `score ${best.score.toFixed(2)} passes, but category '${candidate_category}' ` +
        'is non-family — demoted to REVIEW for human check',
      );
    } else {
      decision = 'accept';
      reasons.push(`score ${best.score.toFixed(2)} >= ${ACCEPT_SCORE}, name_sim ${best.name_sim.toFixed(2)} >= ${NAME_FLOOR}`);
    }
  } else if (best.score >= REVIEW_SCORE) {
    decision = 'review';
    reasons.push(
      best.name_sim < NAME_FLOOR
        ? `name_sim ${best.name_sim.toFixed(2)} < ${NAME_FLOOR} floor — REVIEW`
        : `score ${best.score.toFixed(2)} in [${REVIEW_SCORE}, ${ACCEPT_SCORE}) — REVIEW`,
    );
  } else {
    decision = 'reject';
    reasons.push(`score ${best.score.toFixed(2)} < ${REVIEW_SCORE} — REJECT`);
  }

  return {
    decision,
    score: Number(best.score.toFixed(4)),
    distance_m: best.distance_m === null ? null : Math.round(best.distance_m),
    name_sim: Number(best.name_sim.toFixed(4)),
    postcode_match: best.postcode_match,
    confidence: best.confidence,
    place_id: p.place_id ?? null,
    candidate_name: p.name ?? null,
    candidate_category,
    category_mismatch,
    reasons,
  };
}
