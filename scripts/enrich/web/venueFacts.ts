// =============================================================================
// scripts/enrich/web/venueFacts.ts
//
// Enrichment 2.1 — Phase I: the typed rich-fact layer. Deliberately SEPARATE
// from types/webEnrichment.ts's WebField (per instruction: "do not shove all
// rich facts into the existing 7-value WebField enum if that makes the type
// concept incoherent") — WebField stays exactly what it was (the 056/059
// contact/description/opening_hours proposal pipeline); VenueFact is a new,
// independent typed union for facility/family/visiting facts, extracted here
// and consumed by the (Phase K) facility-sync and (Phase E of the original
// autoApplyPolicy-equivalent) auto-apply layers.
//
// HARD RULES (non-negotiable, enforced structurally, not just by convention):
//   - Absence of a mention is NEVER negative evidence. There is no code path
//     in this file that can produce `present: false` from silence — a
//     negative fact requires an EXPLICIT negation phrase, mirroring
//     closureSignals.ts's own "explicit phrase, not inference" design.
//   - No accessibility/SEND claims are inferred from vague phrases — only
//     explicit wheelchair-access statements are extracted, never "family
//     friendly", "welcoming to all", or similar marketing language.
//   - Structured signals (JSON-LD amenityFeature / isAccessibleForFree) are
//     always preferred over text-pattern heuristics when both are present —
//     mirrors htmlExtract.ts's "first tier wins" rule.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import { parseJsonLdObjects } from './htmlExtract';
import { stripHtmlToText } from './closureCheck';

export type IndoorOutdoorValue = 'indoor' | 'outdoor' | 'mixed';

// Deliberately limited to slugs that actually exist in the live `facilities`
// table (Phase 0 finding: 'picnic area' and 'play area' have no matching
// slug — extraction for those is not built here, flagged as a follow-on).
// 'baby-change' (not 'baby-changing') chosen as canonical — see
// ../facilitySync.ts's header for the full duplicate-slug explanation.
// ('baby-changing' is the orphaned seed.sql duplicate; only 'baby-change'
// participates in migration 050's live vote/mirror pipeline. Nothing in this
// pipeline ever emits 'baby-changing'.)
export type FacilitySlug =
  | 'parking' | 'cafe-on-site' | 'toilets' | 'accessible-toilets' | 'baby-change'
  | 'wheelchair' | 'buggy' | 'lockers' | 'dog-friendly' | 'toddler-area';

export type VenueFact =
  | { kind: 'indoor_outdoor'; value: IndoorOutdoorValue }
  | { kind: 'facility'; slug: FacilitySlug; present: boolean } // present:false = EXPLICIT negative only
  | { kind: 'age_range'; minAge: number | null; maxAge: number | null }
  | { kind: 'height_restriction'; minHeightCm: number }
  // No `url` here on purpose: booking URLs come from htmlExtract.ts's
  // booking_url WebField (which parses real anchors) and are decided by
  // bookingUrlPolicy.ts. This fact carries only the required/recommended
  // signal, which is all descriptionGenerator.ts consumes.
  | { kind: 'booking'; required: boolean; recommended: boolean }
  | { kind: 'admission'; status: 'free' | 'paid' };

export interface VenueFactCandidate {
  fact: VenueFact;
  sourceUrl: string;
  evidenceSnippet: string;
  method: 'jsonld' | 'heuristic';
}

function snippetAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + matchLength + 60);
  return text.slice(start, end).trim().slice(0, 512);
}

// ── Tier 1: structured JSON-LD signals ───────────────────────────────────────

function extractFromJsonLd(html: string, sourceUrl: string): VenueFactCandidate[] {
  const out: VenueFactCandidate[] = [];

  for (const obj of parseJsonLdObjects(html)) {
    const o = obj as Record<string, unknown>;

    if (typeof o['isAccessibleForFree'] === 'boolean') {
      out.push({
        fact: { kind: 'admission', status: o['isAccessibleForFree'] ? 'free' : 'paid' },
        sourceUrl,
        evidenceSnippet: `isAccessibleForFree: ${o['isAccessibleForFree']}`,
        method: 'jsonld',
      });
    }

    const amenities = o['amenityFeature'];
    if (Array.isArray(amenities)) {
      for (const a of amenities) {
        if (!a || typeof a !== 'object') continue;
        const spec = a as Record<string, unknown>;
        const name = typeof spec['name'] === 'string' ? spec['name'].toLowerCase() : null;
        const value = spec['value'];
        if (!name || typeof value !== 'boolean') continue;
        const slug = AMENITY_NAME_TO_SLUG[name];
        if (!slug) continue;
        out.push({
          fact: { kind: 'facility', slug, present: value },
          sourceUrl,
          evidenceSnippet: `amenityFeature: ${name}=${value}`,
          method: 'jsonld',
        });
      }
    }
  }

  return out;
}

const AMENITY_NAME_TO_SLUG: Record<string, FacilitySlug> = {
  'parking': 'parking',
  'car park': 'parking',
  'cafe': 'cafe-on-site',
  'café': 'cafe-on-site',
  'toilets': 'toilets',
  'restrooms': 'toilets',
  'accessible toilet': 'accessible-toilets',
  'accessible restroom': 'accessible-toilets',
  'baby changing': 'baby-change',
  'baby change': 'baby-change',
  'wheelchair access': 'wheelchair',
  'wheelchair accessible': 'wheelchair',
  'lockers': 'lockers',
};

// ── Tier 2: explicit-phrase text heuristics ──────────────────────────────────
// Every entry has a POSITIVE pattern and, where a facility can plausibly be
// explicitly denied, a NEGATIVE pattern. Neither ever fires from silence.

interface FacilityPhraseSet {
  slug: FacilitySlug;
  positive: RegExp;
  negative?: RegExp;
}

const FACILITY_PHRASES: FacilityPhraseSet[] = [
  { slug: 'parking', positive: /\b(?:(?:free|on[- ]site|ample|plenty of)\s+)?(?:car park|parking)\s+(?:is\s+)?(?:available|on site|onsite|provided)\b/i, negative: /\b(no|not)\s+(on[- ]site\s+)?parking\b/i },
  { slug: 'cafe-on-site', positive: /\b(on[- ]site|our)\s*(caf[ée]|coffee shop|refreshments? area)\b/i },
  { slug: 'toilets', positive: /\b(toilets?|restrooms?)\s+(are\s+|is\s+)?(available|on site|onsite|provided)\b/i, negative: /\b(no|not)\s+toilets?\s+(available|on site)\b/i },
  { slug: 'accessible-toilets', positive: /\b(accessible|disabled)\s+toilet[s]?\b/i },
  { slug: 'baby-change', positive: /\bbaby\s*chang(e|ing)\s*(facilit(y|ies)|area|room)?\b/i },
  { slug: 'wheelchair', positive: /\bwheelchair\s+(access(ible)?|friendly)\b/i, negative: /\b(no|not)\s+wheelchair\s+access\b/i },
  { slug: 'buggy', positive: /\bbuggy(\s|-)?(friendly|accessible)\b|\bpram(s)?\s+(are\s+)?welcome\b/i },
  { slug: 'lockers', positive: /\blockers?\s+(are\s+)?(available|provided)\b/i },
  { slug: 'dog-friendly', positive: /\bdogs?\s+(are\s+)?(welcome|allowed)\b/i, negative: /\b(no dogs|dogs are not allowed|dogs? not permitted)\b/i },
  { slug: 'toddler-area', positive: /\btoddler\s+(area|zone|soft play)\b/i },
];

function extractFacilitiesFromText(text: string, sourceUrl: string): VenueFactCandidate[] {
  const out: VenueFactCandidate[] = [];
  for (const { slug, positive, negative } of FACILITY_PHRASES) {
    if (negative) {
      const negMatch = negative.exec(text);
      if (negMatch) {
        out.push({
          fact: { kind: 'facility', slug, present: false },
          sourceUrl,
          evidenceSnippet: snippetAround(text, negMatch.index, negMatch[0].length),
          method: 'heuristic',
        });
        continue; // explicit negative wins over any coincidental positive match elsewhere on the page
      }
    }
    const posMatch = positive.exec(text);
    if (posMatch) {
      out.push({
        fact: { kind: 'facility', slug, present: true },
        sourceUrl,
        evidenceSnippet: snippetAround(text, posMatch.index, posMatch[0].length),
        method: 'heuristic',
      });
    }
  }
  return out;
}

const INDOOR_OUTDOOR_PHRASES: { value: IndoorOutdoorValue; re: RegExp }[] = [
  { value: 'mixed', re: /\bindoor\s+and\s+outdoor\b/i },
  { value: 'indoor', re: /\bfully\s+indoor\b|\ball[- ]weather\s+indoor\b|\bindoor[- ]only\b/i },
  { value: 'outdoor', re: /\boutdoor[- ]only\b|\bopen[- ]air\s+attraction\b/i },
];

function extractIndoorOutdoor(text: string, sourceUrl: string): VenueFactCandidate[] {
  // Order matters: "indoor and outdoor" must win over a later, narrower "indoor"-only match elsewhere.
  for (const { value, re } of INDOOR_OUTDOOR_PHRASES) {
    const m = re.exec(text);
    if (m) return [{ fact: { kind: 'indoor_outdoor', value }, sourceUrl, evidenceSnippet: snippetAround(text, m.index, m[0].length), method: 'heuristic' }];
  }
  return [];
}

const AGE_RANGE_RE = /\b(?:ages?|suitable for|for children)\s+(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*(?:years?|yrs?)?\b/i;
const MIN_AGE_ONLY_RE = /\b(?:ages?|children)\s+(\d{1,2})\+?\s*(?:years?|yrs?)?\s+and\s+(?:over|above|up)\b/i;

function extractAgeRange(text: string, sourceUrl: string): VenueFactCandidate[] {
  const range = AGE_RANGE_RE.exec(text);
  if (range) {
    const minAge = parseInt(range[1]!, 10);
    const maxAge = parseInt(range[2]!, 10);
    if (minAge <= maxAge) {
      return [{ fact: { kind: 'age_range', minAge, maxAge }, sourceUrl, evidenceSnippet: snippetAround(text, range.index, range[0].length), method: 'heuristic' }];
    }
  }
  const minOnly = MIN_AGE_ONLY_RE.exec(text);
  if (minOnly) {
    return [{ fact: { kind: 'age_range', minAge: parseInt(minOnly[1]!, 10), maxAge: null }, sourceUrl, evidenceSnippet: snippetAround(text, minOnly.index, minOnly[0].length), method: 'heuristic' }];
  }
  return [];
}

const HEIGHT_RESTRICTION_RE = /\b(?:minimum height|must be (?:over|at least)|height restriction of)\s+(\d{2,3})\s*cm\b/i;

function extractHeightRestriction(text: string, sourceUrl: string): VenueFactCandidate[] {
  const m = HEIGHT_RESTRICTION_RE.exec(text);
  if (!m) return [];
  const cm = parseInt(m[1]!, 10);
  if (cm < 50 || cm > 250) return []; // implausible — likely a false-positive regex match on unrelated text
  return [{ fact: { kind: 'height_restriction', minHeightCm: cm }, sourceUrl, evidenceSnippet: snippetAround(text, m.index, m[0].length), method: 'heuristic' }];
}

const BOOKING_REQUIRED_RE = /\bbooking\s+is\s+required\b|\bmust\s+(?:be\s+)?(?:pre[- ]?)?book(?:ed)?\b|\badvance\s+booking\s+(?:is\s+)?essential\b/i;
const BOOKING_RECOMMENDED_RE = /\bbooking\s+is\s+recommended\b|\bwe\s+recommend\s+booking\b|\badvance\s+booking\s+(?:is\s+)?recommended\b/i;

function extractBooking(text: string, sourceUrl: string): VenueFactCandidate[] {
  const required = BOOKING_REQUIRED_RE.exec(text);
  if (required) {
    return [{ fact: { kind: 'booking', required: true, recommended: false }, sourceUrl, evidenceSnippet: snippetAround(text, required.index, required[0].length), method: 'heuristic' }];
  }
  const recommended = BOOKING_RECOMMENDED_RE.exec(text);
  if (recommended) {
    return [{ fact: { kind: 'booking', required: false, recommended: true }, sourceUrl, evidenceSnippet: snippetAround(text, recommended.index, recommended[0].length), method: 'heuristic' }];
  }
  return [];
}

const FREE_ADMISSION_RE = /\b(?:admission|entry)\s+is\s+free\b|\bfree\s+(?:admission|entry)\b/i;
const PAID_ADMISSION_RE = /\badmission\s+(?:price|charge)s?\s+apply\b|\bentry\s+fee\s+applies\b|\btickets?\s+(?:are\s+)?required\b/i;

function extractAdmission(text: string, sourceUrl: string): VenueFactCandidate[] {
  const free = FREE_ADMISSION_RE.exec(text);
  if (free) return [{ fact: { kind: 'admission', status: 'free' }, sourceUrl, evidenceSnippet: snippetAround(text, free.index, free[0].length), method: 'heuristic' }];
  const paid = PAID_ADMISSION_RE.exec(text);
  if (paid) return [{ fact: { kind: 'admission', status: 'paid' }, sourceUrl, evidenceSnippet: snippetAround(text, paid.index, paid[0].length), method: 'heuristic' }];
  return [];
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Extract every VenueFact this module knows how to find, structured (JSON-LD)
 * signals first. Deduplicates by (kind, slug-if-any): the first tier to
 * produce a fact for a given (kind, slug) wins, mirroring htmlExtract.ts's
 * "first tier wins" rule — a text-heuristic match never overrides a
 * structured one for the same fact.
 */
export function extractVenueFacts(html: string, sourceUrl: string): VenueFactCandidate[] {
  const structured = extractFromJsonLd(html, sourceUrl);
  const text = stripHtmlToText(html);
  const heuristic = [
    ...extractFacilitiesFromText(text, sourceUrl),
    ...extractIndoorOutdoor(text, sourceUrl),
    ...extractAgeRange(text, sourceUrl),
    ...extractHeightRestriction(text, sourceUrl),
    ...extractBooking(text, sourceUrl),
    ...extractAdmission(text, sourceUrl),
  ];

  const seen = new Set<string>();
  const out: VenueFactCandidate[] = [];
  const keyOf = (c: VenueFactCandidate): string => c.fact.kind === 'facility' ? `facility:${c.fact.slug}` : c.fact.kind;

  for (const c of [...structured, ...heuristic]) {
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
