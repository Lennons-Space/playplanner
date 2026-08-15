// =============================================================================
// scripts/enrich/web/officialCorroboration.ts
//
// Enrichment 2.1 — Phase D4/G: deterministic official-site identity
// corroboration for new discovery candidates.
//
// SCOPE DISCIPLINE (per instruction, non-negotiable):
//   - Only ever fetches a website the candidate/provider ITSELF supplied.
//     Never guesses a domain from the venue name, never searches Google/Bing,
//     never treats a social profile as ownership proof.
//   - Reuses the existing safe crawler unchanged (webClient.ts's WebClient —
//     robots fail-closed, SSRF/DNS protection, redirect limits, per-domain
//     throttle, disk cache) — this file adds no new HTTP logic of its own,
//     only identity-matching on top of a page already safely fetched.
//
// Reuses (does not duplicate):
//   - htmlExtract.ts's parseJsonLdObjects — the exact JSON-LD block finder
//     the existing web-enrichment pipeline already uses.
//   - geoapifyMatch.ts's nameSimilarity/haversineMetres — the same name/
//     distance primitives discovery/dedupe.ts already uses, so "how similar
//     are two venue names" means the same thing everywhere in this codebase.
//   - fields.ts's phoneDedupKey — the same phone-normalisation dedupe.ts uses.
//
// No I/O in this file except the injected fetchPage (webClient.ts's own
// contract) — deterministic given the same HTML.
// =============================================================================

import { parseJsonLdObjects } from './htmlExtract';
import { nameSimilarity, haversineMetres } from '../geoapifyMatch';
import { phoneDedupKey } from './fields';
import type { WebFetchResult } from '../../../types/webEnrichment';

export type IdentityMatchStatus = 'VERIFIED_SAME_VENUE' | 'PROBABLE' | 'AMBIGUOUS' | 'MISMATCH' | 'UNAVAILABLE';

export interface IdentityEvidence {
  name: string | null;
  postcode: string | null;
  locality: string | null;
  streetAddress: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  pageTitle: string | null;
  sourceUrl: string;
}

export interface IdentityMatchInput {
  name: string;
  postcode: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
}

export interface IdentityMatchResult {
  status: IdentityMatchStatus;
  reason: string;
  nameSim: number;
  postcodeMatch: boolean;
  phoneMatch: boolean;
  distanceM: number | null;
}

function normalisePostcode(p: string | null): string | null {
  if (!p) return null;
  return p.toUpperCase().replace(/\s+/g, '');
}

/** Postcode OUTWARD code only (e.g. "SY1" from "SY1 1AA") — a weaker, area-level signal, not a full match. */
function outwardCode(p: string | null): string | null {
  const norm = normalisePostcode(p);
  if (!norm) return null;
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)/.exec(norm);
  return m ? m[1]! : null;
}

// ── Pure: extract identity evidence from already-fetched HTML ───────────────

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

const IDENTITY_TYPES = new Set(['Organization', 'LocalBusiness', 'Place', 'TouristAttraction', 'Zoo', 'Museum', 'AmusementPark']);

function jsonLdTypeMatches(node: Record<string, unknown>): boolean {
  const t = node['@type'];
  if (typeof t === 'string') return IDENTITY_TYPES.has(t) || t.endsWith('Business') || t.endsWith('Attraction');
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && (IDENTITY_TYPES.has(x) || x.endsWith('Business') || x.endsWith('Attraction')));
  return false;
}

export function extractIdentityEvidence(html: string, sourceUrl: string): IdentityEvidence {
  let name: string | null = null;
  let postcode: string | null = null;
  let locality: string | null = null;
  let streetAddress: string | null = null;
  let phone: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;

  for (const obj of parseJsonLdObjects(html)) {
    const o = obj as Record<string, unknown>;
    if (!jsonLdTypeMatches(o)) continue;

    name = name ?? firstNonEmptyString(o['name']);
    phone = phone ?? firstNonEmptyString(o['telephone']);

    const address = o['address'];
    if (address && typeof address === 'object') {
      const a = address as Record<string, unknown>;
      postcode = postcode ?? firstNonEmptyString(a['postalCode']);
      locality = locality ?? firstNonEmptyString(a['addressLocality']);
      streetAddress = streetAddress ?? firstNonEmptyString(a['streetAddress']);
    }

    const geo = o['geo'];
    if (geo && typeof geo === 'object') {
      const g = geo as Record<string, unknown>;
      const lat = typeof g['latitude'] === 'number' ? g['latitude'] : typeof g['latitude'] === 'string' ? parseFloat(g['latitude']) : null;
      const lon = typeof g['longitude'] === 'number' ? g['longitude'] : typeof g['longitude'] === 'string' ? parseFloat(g['longitude']) : null;
      if (lat !== null && !isNaN(lat)) latitude = latitude ?? lat;
      if (lon !== null && !isNaN(lon)) longitude = longitude ?? lon;
    }
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const pageTitle = titleMatch ? titleMatch[1]!.replace(/\s+/g, ' ').trim().slice(0, 200) : null;

  return { name, postcode, locality, streetAddress, phone, latitude, longitude, pageTitle, sourceUrl };
}

// ── Pure: deterministic identity match ───────────────────────────────────────

const VERIFIED_NAME_FLOOR = 0.6;
const PROBABLE_NAME_FLOOR = 0.4;
const TIGHT_DISTANCE_M = 300; // matches discovery/dedupe.ts's own tight-footprint gate

export function matchIdentity(evidence: IdentityEvidence, input: IdentityMatchInput): IdentityMatchResult {
  if (!evidence.name && !evidence.postcode && !evidence.phone && evidence.latitude === null) {
    return { status: 'UNAVAILABLE', reason: 'no identity evidence found on the page (no matching JSON-LD block)', nameSim: 0, postcodeMatch: false, phoneMatch: false, distanceM: null };
  }

  const nameSim = evidence.name ? nameSimilarity(input.name, evidence.name) : 0;
  const postcodeMatch = normalisePostcode(evidence.postcode) !== null && normalisePostcode(evidence.postcode) === normalisePostcode(input.postcode);
  const outwardMatch = !postcodeMatch && outwardCode(evidence.postcode) !== null && outwardCode(evidence.postcode) === outwardCode(input.postcode);
  const evidencePhoneKey = evidence.phone ? phoneDedupKey(evidence.phone) : null;
  const inputPhoneKey = input.phone ? phoneDedupKey(input.phone) : null;
  const phoneMatch = evidencePhoneKey !== null && evidencePhoneKey === inputPhoneKey;
  const distanceM = evidence.latitude !== null && evidence.longitude !== null && input.latitude !== null && input.longitude !== null
    ? haversineMetres(input.latitude, input.longitude, evidence.latitude, evidence.longitude)
    : null;
  const tightDistance = distanceM !== null && distanceM <= TIGHT_DISTANCE_M;

  // Explicit conflict: the site names a DIFFERENT postcode than the candidate
  // (wrong branch / different city with the same chain name) — never
  // upgradeable to a match no matter how similar the name is.
  const postcodeConflict = evidence.postcode !== null && input.postcode !== null && !postcodeMatch && !outwardMatch;

  if (postcodeConflict && nameSim >= PROBABLE_NAME_FLOOR) {
    return { status: 'MISMATCH', reason: 'similar name but the site states a different postcode — likely a different branch/location', nameSim, postcodeMatch, phoneMatch, distanceM };
  }
  if (evidence.name && nameSim < 0.2 && (evidence.postcode || evidence.phone)) {
    return { status: 'MISMATCH', reason: 'the site names a different, unrelated business', nameSim, postcodeMatch, phoneMatch, distanceM };
  }

  // VERIFIED requires strong name similarity AND at least one independent
  // corroborating signal — name alone (even a perfect match) is never enough,
  // exactly like a national chain's generic homepage.
  if (nameSim >= VERIFIED_NAME_FLOOR && (postcodeMatch || phoneMatch || tightDistance)) {
    return { status: 'VERIFIED_SAME_VENUE', reason: `name similarity ${nameSim.toFixed(2)} corroborated by ${[postcodeMatch && 'postcode', phoneMatch && 'phone', tightDistance && 'tight coordinates'].filter(Boolean).join('+')}`, nameSim, postcodeMatch, phoneMatch, distanceM };
  }

  if (nameSim >= PROBABLE_NAME_FLOOR && (outwardMatch || evidence.locality)) {
    return { status: 'PROBABLE', reason: `plausible name match with a weaker area-level signal only — needs a human to confirm`, nameSim, postcodeMatch, phoneMatch, distanceM };
  }

  if (nameSim >= PROBABLE_NAME_FLOOR || evidence.postcode || evidence.phone) {
    return { status: 'AMBIGUOUS', reason: 'some identity evidence present but not strong or corroborated enough to decide either way', nameSim, postcodeMatch, phoneMatch, distanceM };
  }

  return { status: 'MISMATCH', reason: 'no meaningful overlap between the candidate and the page identity evidence', nameSim, postcodeMatch, phoneMatch, distanceM };
}

// ── I/O shell ──────────────────────────────────────────────────────────────

export interface CorroborationDeps {
  fetchPage: (url: string) => Promise<WebFetchResult>;
}

export interface CorroborationResult {
  status: IdentityMatchStatus;
  match: IdentityMatchResult | null;
  evidence: IdentityEvidence | null;
  note?: string;
}

/**
 * Fetch a candidate's OWN supplied website (never a guessed/searched one) and
 * determine whether it corroborates the candidate's identity. Returns
 * UNAVAILABLE (not a thrown error) for any fetch failure/skip — the caller
 * decides how to treat that (candidateAccept.ts already defaults
 * officialVerification to false, so UNAVAILABLE simply never upgrades it).
 */
export async function corroborateOfficialSite(
  website: string | null,
  input: IdentityMatchInput,
  deps: CorroborationDeps,
): Promise<CorroborationResult> {
  if (!website) {
    return { status: 'UNAVAILABLE', match: null, evidence: null, note: 'candidate has no supplied website' };
  }

  const result = await deps.fetchPage(website);
  if (result.kind !== 'ok') {
    return { status: 'UNAVAILABLE', match: null, evidence: null, note: `fetch outcome: ${result.kind}${result.note ? ` (${result.note})` : ''}` };
  }

  const evidence = extractIdentityEvidence(result.page.html, result.page.finalUrl);
  const match = matchIdentity(evidence, input);
  return { status: match.status, match, evidence };
}
