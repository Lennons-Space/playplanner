// =============================================================================
// scripts/enrich/web/descriptionGenerator.ts
//
// Enrichment 2.1 — Phase L: deterministic factual venue descriptions from
// verified facts. An intentional, narrow exception to Enrichment 2.0's
// blanket description-never-auto-applies rule (see migration 060 Section C's
// header for exactly why this is safe: template synthesis from already-
// trusted facts is not scraped text, so the copyright concern that rule
// existed for does not apply here).
//
// RULES (all enforced structurally, not just documented):
//   - Short, neutral, factual. No adjectives beyond the plain category name.
//   - Deterministic: same facts in the same order always produce the same
//     sentence — no randomness, no LLM/API call anywhere in this file.
//   - No copied text: every word comes from this file's own fixed templates,
//     never from evidenceSnippet/evidenceRaw.
//   - Returns null (never a placeholder sentence) when there aren't enough
//     facts to say anything substantive — an empty/near-empty generated
//     description is worse than no description.
//
// No I/O, no '@/' path alias.
// =============================================================================

import type { VenueFact } from './venueFacts';
import { isMeaningfulDescription } from './fields';

/** A curated banlist, defence-in-depth against ever emitting marketing language even by accident (Part L explicit ban list). */
const BANNED_WORDS = ['best', 'great', 'popular', 'amazing', 'wonderful', 'must-visit', 'top-rated', 'safe', 'exciting', 'fantastic'];

const FACILITY_LABELS: Partial<Record<Extract<VenueFact, { kind: 'facility' }>['slug'], string>> = {
  'parking': 'parking',
  'cafe-on-site': 'an on-site cafe',
  'toilets': 'toilets',
  'accessible-toilets': 'accessible toilets',
  'baby-change': 'baby changing facilities',
  'wheelchair': 'wheelchair access',
  'buggy': 'buggy access',
  'lockers': 'lockers',
  'dog-friendly': 'a dog-friendly policy',
  'toddler-area': 'a toddler area',
};

export interface DescriptionContext {
  venueName: string;
  categoryLabel: string | null; // human-readable category, e.g. "soft-play centre" — never invented, pass null if unknown
  city: string | null;
  facts: VenueFact[]; // only facts already at trusted/auto-apply-worthy confidence should be passed in
}

export interface GeneratedDescription {
  text: string;
  factsUsed: VenueFact[];
}

function clause(list: string[]): string | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Deterministically synthesize a short factual sentence from verified facts.
 * Returns null when there isn't enough to say (bare category+location alone,
 * with zero facility/booking/admission facts, is not worth generating).
 */
export function generateDescription(ctx: DescriptionContext): GeneratedDescription | null {
  const factsUsed: VenueFact[] = [];
  const indoorOutdoor = ctx.facts.find((f) => f.kind === 'indoor_outdoor');
  const facilityFacts = ctx.facts.filter((f): f is Extract<VenueFact, { kind: 'facility' }> => f.kind === 'facility' && f.present);
  const booking = ctx.facts.find((f) => f.kind === 'booking');
  const admission = ctx.facts.find((f) => f.kind === 'admission');

  if (facilityFacts.length === 0 && !booking && !admission && !indoorOutdoor) {
    return null; // nothing substantive to say
  }

  const parts: string[] = [];

  // Opening clause: [Indoor/Outdoor/Indoor and outdoor] [category] [in city].
  let opener = '';
  if (indoorOutdoor) {
    factsUsed.push(indoorOutdoor);
    const iov = indoorOutdoor.kind === 'indoor_outdoor' ? indoorOutdoor.value : null;
    opener = iov === 'mixed' ? 'Indoor and outdoor' : iov === 'indoor' ? 'Indoor' : 'Outdoor';
  }
  const category = ctx.categoryLabel ?? 'family venue';
  const location = ctx.city ? ` in ${ctx.city}` : '';
  parts.push(`${opener ? `${opener} ` : ''}${category}${location}.`.trim());

  // Facilities clause.
  const facilityLabels = facilityFacts.map((f) => FACILITY_LABELS[f.slug]).filter((s): s is string => !!s);
  if (facilityLabels.length > 0) {
    factsUsed.push(...facilityFacts.filter((f) => FACILITY_LABELS[f.slug]));
    const c = clause(facilityLabels);
    if (c) parts.push(`Facilities include ${c}.`);
  }

  // Booking clause.
  if (booking && booking.kind === 'booking') {
    factsUsed.push(booking);
    if (booking.required) parts.push('Booking is required.');
    else if (booking.recommended) parts.push('Booking is recommended.');
  }

  // Admission clause.
  if (admission && admission.kind === 'admission') {
    factsUsed.push(admission);
    parts.push(admission.status === 'free' ? 'Admission is free.' : 'Admission charges apply.');
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (BANNED_WORDS.some((w) => lower.includes(w))) {
    // Structural impossibility given the fixed templates above, but checked
    // anyway — defence in depth, never trust a "this can't happen" assumption silently.
    return null;
  }

  return { text, factsUsed };
}

/**
 * Eligibility gate: a generated description may only ever apply over an
 * empty/trivial existing description — reuses fields.ts's own
 * isMeaningfulDescription (already used elsewhere in this codebase to decide
 * "is this description worth keeping") rather than inventing new triviality
 * rules. A real human/admin/curated description always fails this check
 * (i.e. is "meaningful") and is therefore always protected.
 */
export function isEligibleForGeneratedDescription(currentDescription: string | null, venueName: string): boolean {
  if (!currentDescription || !currentDescription.trim()) return true;
  return !isMeaningfulDescription(currentDescription, venueName);
}
