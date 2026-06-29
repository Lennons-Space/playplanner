// =============================================================================
// scripts/enrich/web/decision.ts
//
// Pure decision engine (DECISION_CONTRACT.md §7, §7a). Operates per venue over
// ALL candidates per field (not best-only) + CurrentVenueSnapshot.
// Emits FieldDecision[] — the exact shape from types/enrichmentDecision.ts.
//
// Field policies: phone, email, website, opening_hours, description,
// price_range, booking_url per the §7 table.
//
// Description composition (§7a): deterministic, from DB-verified structured
// facts only (name, category slug → label, city). NEVER copies or rewrites
// the site's marketing text.
//
// No I/O, no network, fully deterministic. No '@/' path alias.
// =============================================================================

import type {
  CurrentVenueSnapshot,
  FieldCandidate,
  WebField,
} from '../../../types/webEnrichment';
import type { FieldDecision, ReasonCode } from '../../../types/enrichmentDecision';
import { DECISION_ENGINE_VERSION } from '../../../types/enrichmentDecision';
import { computeConfidence } from './confidence';
import { phoneDedupKey, looksPersonalEmail } from './fields';

// Re-export so orchestrate.ts can stamp without a double-import.
export { DECISION_ENGINE_VERSION };

// ── Venue facts ───────────────────────────────────────────────────────────────

/**
 * DB-sourced facts for description composition. All fields come from the venue
 * row — never from web extraction. The composer never reads candidates.
 */
export interface VenueFacts {
  name: string;
  categorySlug: string | null;
  city: string | null;
}

// ── DecisionInput ─────────────────────────────────────────────────────────────

export interface DecisionInput {
  /** ALL candidates across all fields and pages for this venue. */
  allCandidates: FieldCandidate[];
  snapshot: CurrentVenueSnapshot;
  venueFacts: VenueFacts;
  /** The venue's stored website URL — used for canonical-equivalence check. */
  venueWebsite: string | null;
}

// ── Method-rank table ─────────────────────────────────────────────────────────

const METHOD_RANK: Record<string, number> = {
  jsonld: 0,
  microdata: 1,
  meta: 2,
  heuristic: 3,
};

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Compute a FieldDecision for every field that has candidates, plus description
 * (always attempted from DB facts). Returns 0–7 decisions; never throws.
 */
export function makeFieldDecisions(input: DecisionInput): FieldDecision[] {
  const { allCandidates, snapshot, venueFacts, venueWebsite } = input;
  const byField = groupByField(allCandidates);
  const out: FieldDecision[] = [];

  const phoneCandidates = byField.get('phone') ?? [];
  if (phoneCandidates.length > 0) out.push(decidePhone(phoneCandidates, snapshot));

  const emailCandidates = byField.get('email') ?? [];
  if (emailCandidates.length > 0) out.push(decideEmail(emailCandidates, snapshot));

  const websiteCandidates = byField.get('website') ?? [];
  if (websiteCandidates.length > 0) {
    out.push(decideWebsite(websiteCandidates, snapshot, venueWebsite));
  }

  const hoursCandidates = byField.get('opening_hours') ?? [];
  if (hoursCandidates.length > 0) out.push(decideOpeningHours(hoursCandidates, snapshot));

  const priceCandidates = byField.get('price_range') ?? [];
  if (priceCandidates.length > 0) out.push(decidePriceRange(priceCandidates, snapshot));

  const bookingCandidates = byField.get('booking_url') ?? [];
  if (bookingCandidates.length > 0) out.push(decideBookingUrl(bookingCandidates));

  // Description: always attempt — composer produces report_only when facts are
  // insufficient so the admin is never handed hundreds of blanks to write.
  out.push(decideDescription(byField.get('description') ?? [], snapshot, venueFacts));

  return out;
}

// ── Phone ─────────────────────────────────────────────────────────────────────

function decidePhone(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
): FieldDecision {
  const field: WebField = 'phone';

  // Deduplicate using GB-aware phoneDedupKey.
  const validEntries = candidates
    .map((c) => ({ candidate: c, key: phoneDedupKey(String(c.value)) }))
    .filter((e): e is { candidate: FieldCandidate; key: string } => e.key !== null);

  if (validEntries.length === 0) {
    return {
      field,
      decision: 'auto_reject',
      reasons: ['malformed_value'],
      chosen: candidates[0] ? toChosen(candidates[0], field, false) : undefined,
    };
  }

  const currentPhone = snapshot.phone?.trim() ?? '';
  const currentKey = currentPhone ? phoneDedupKey(currentPhone) : null;
  const currentValid = currentKey !== null;

  const distinctKeys = [...new Set(validEntries.map((e) => e.key))];
  const best = bestByMethod(validEntries.map((e) => e.candidate))!;

  // All proposed values equal the stored value → no-op.
  if (currentKey !== null && distinctKeys.every((k) => k === currentKey)) {
    return { field, decision: 'auto_reject', reasons: ['equals_current'], chosen: toChosen(best, field, false) };
  }

  // Multiple distinct valid phones.
  if (distinctKeys.length > 1) {
    const reasons: ReasonCode[] = ['multiple_values_conflict'];
    if (currentValid) reasons.push('would_replace_existing');
    return { field, decision: 'manual_review', reasons, chosen: toChosen(best, field, currentValid) };
  }

  // Single validated value.
  const singleKey = distinctKeys[0]!;

  // Would replace a different valid existing value.
  if (currentValid && currentKey !== singleKey) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['would_replace_existing'],
      chosen: toChosen(best, field, true),
    };
  }

  // Current empty or invalid → auto_apply.
  const emptyReason: ReasonCode = !currentPhone ? 'current_empty' : 'current_invalid';
  return {
    field,
    decision: 'auto_apply',
    reasons: [emptyReason, 'single_validated_value', 'official_domain_source'],
    chosen: toChosen(best, field, false),
  };
}

// ── Email ─────────────────────────────────────────────────────────────────────

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'me.com', 'googlemail.com', 'yahoo.co.uk',
  'hotmail.co.uk', 'live.com', 'live.co.uk',
]);

const PLACEHOLDER_EMAIL_RE = /^(noreply|no-reply|donotreply|do-not-reply|test|example|user|yourname|email)@/i;

function isPlaceholderEmail(email: string): boolean {
  return PLACEHOLDER_EMAIL_RE.test(email) || email.toLowerCase().includes('example.com');
}

function isFreeMailEmail(email: string): boolean {
  const at = email.indexOf('@');
  if (at < 0) return false;
  return FREE_MAIL_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

function decideEmail(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
): FieldDecision {
  const field: WebField = 'email';

  const validEntries = candidates
    .map((c) => ({ candidate: c, key: String(c.value).toLowerCase().trim() }))
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.key));

  if (validEntries.length === 0) {
    return {
      field,
      decision: 'auto_reject',
      reasons: ['malformed_value'],
      chosen: candidates[0] ? toChosen(candidates[0], field, false) : undefined,
    };
  }

  const allPlaceholder = validEntries.every((e) => isPlaceholderEmail(e.key));
  if (allPlaceholder) {
    const best = bestByMethod(validEntries.map((e) => e.candidate))!;
    return { field, decision: 'auto_reject', reasons: ['placeholder_value'], chosen: toChosen(best, field, false) };
  }

  const realEntries = validEntries.filter((e) => !isPlaceholderEmail(e.key));
  const distinctEmails = [...new Set(realEntries.map((e) => e.key))];
  const best = bestByMethod(realEntries.map((e) => e.candidate))!;

  const currentEmail = snapshot.email?.toLowerCase().trim() ?? '';
  const currentValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail) && !isPlaceholderEmail(currentEmail);

  // All proposed values equal the stored value.
  if (currentEmail && distinctEmails.every((e) => e === currentEmail)) {
    return { field, decision: 'auto_reject', reasons: ['equals_current'], chosen: toChosen(best, field, false) };
  }

  // Multiple distinct real emails → competing.
  if (distinctEmails.length > 1) {
    // Surface official-domain vs free-mail pattern specifically.
    const hasFree = distinctEmails.some(isFreeMailEmail);
    const hasOfficial = distinctEmails.some((e) => !isFreeMailEmail(e));
    const reasons: ReasonCode[] = ['competing_email'];
    if (hasFree && hasOfficial) reasons.push('official_domain_email_competes');
    if (currentValid) reasons.push('would_replace_existing');
    return { field, decision: 'manual_review', reasons, chosen: toChosen(best, field, currentValid) };
  }

  // Single email.
  const singleEmail = distinctEmails[0]!;

  // Would replace a different valid existing value.
  if (currentValid && currentEmail !== singleEmail) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['would_replace_existing'],
      chosen: toChosen(best, field, true),
    };
  }

  // Personal (firstname.lastname@) and free-mail (e.g. info@gmail.com) emails cannot
  // be auto-applied — route to manual_review.
  // (no dedicated reason code; use single_validated_value to state what was found).
  if (looksPersonalEmail(singleEmail) || isFreeMailEmail(singleEmail)) {
    const emptyReason: ReasonCode = !currentEmail || !currentValid ? 'current_empty' : 'current_invalid';
    return {
      field,
      decision: 'manual_review',
      reasons: [emptyReason, 'single_validated_value'],
      chosen: toChosen(best, field, false),
    };
  }

  // Current empty or invalid → auto_apply.
  const emptyReason: ReasonCode = !currentEmail || !currentValid ? 'current_empty' : 'current_invalid';
  return {
    field,
    decision: 'auto_apply',
    reasons: [emptyReason, 'single_validated_value', 'official_domain_source'],
    chosen: toChosen(best, field, false),
  };
}

// ── Website ───────────────────────────────────────────────────────────────────

/**
 * Normalise a URL to { host, path } for canonical comparison.
 * Strips www., strips trailing slash, lowercases scheme+host.
 * Leaves path/query/fragment intact — they produce meaningful differences.
 */
function canonicalNorm(raw: string): { host: string; path: string } | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    // path = pathname + search + hash, trailing slash stripped.
    const path = (u.pathname + u.search + u.hash).replace(/\/+$/, '');
    return { host, path };
  } catch {
    return null;
  }
}

/**
 * True when two URLs differ ONLY in www prefix / trailing slash / scheme / host
 * casing — i.e. they point at the same homepage. Returns false for meaningful
 * path, subdomain, or query differences.
 */
export function isCanonicalEquivalentWebsite(a: string, b: string): boolean {
  const na = canonicalNorm(a);
  const nb = canonicalNorm(b);
  if (!na || !nb) return false;
  return na.host === nb.host && na.path === nb.path;
}

function decideWebsite(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
  venueWebsite: string | null,
): FieldDecision {
  const field: WebField = 'website';
  const best = bestByMethod(candidates)!;
  const proposed = String(best.value).trim();

  // The reference URL is whichever is available (they should be the same).
  const storedUrl = venueWebsite ?? snapshot.website ?? '';
  const currentValid = !!storedUrl && /^https?:\/\//i.test(storedUrl);

  // Canonical equivalence — same homepage, different casing / www / slash.
  if (storedUrl && isCanonicalEquivalentWebsite(proposed, storedUrl)) {
    return {
      field,
      decision: 'auto_reject',
      reasons: ['canonical_equivalent_website'],
      chosen: toChosen(best, field, false),
    };
  }

  // Simple normalised equality.
  const normProposed = proposed.toLowerCase().replace(/\/+$/, '');
  const normStored = storedUrl.toLowerCase().replace(/\/+$/, '');
  if (storedUrl && normProposed === normStored) {
    return { field, decision: 'auto_reject', reasons: ['equals_current'], chosen: toChosen(best, field, false) };
  }

  // Would replace a different valid existing URL.
  if (currentValid) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['meaningful_url_difference', 'would_replace_existing'],
      chosen: toChosen(best, field, true),
    };
  }

  // Multiple candidates with distinct normalised URLs.
  if (candidates.length > 1) {
    const norms = candidates.map((c) => canonicalNorm(String(c.value)));
    const keys = new Set(norms.map((n) => (n ? `${n.host}${n.path}` : '')));
    if (keys.size > 1) {
      return {
        field,
        decision: 'manual_review',
        reasons: ['meaningful_url_difference'],
        chosen: toChosen(best, field, false),
      };
    }
  }

  // Current empty or invalid → auto_apply.
  return {
    field,
    decision: 'auto_apply',
    reasons: ['current_empty', 'official_domain_source'],
    chosen: toChosen(best, field, false),
  };
}

// ── Opening hours ─────────────────────────────────────────────────────────────

const HOURS_WARNING_PHRASES = [
  'hours may change',
  'hours may vary',
  'times may change',
  'times may vary',
  'call to confirm',
  'call ahead',
  'call us to confirm',
  'subject to change',
  'check before visiting',
  'check before you visit',
  'may change',
  'may vary',
  'please call',
  'ring to confirm',
  'phone ahead',
  'holiday hours',
  'opening times may',
  'hours are subject',
];

function hasHoursWarning(candidate: FieldCandidate): boolean {
  const combined = `${candidate.evidenceSnippet} ${candidate.evidenceRaw ?? ''}`.toLowerCase();
  return HOURS_WARNING_PHRASES.some((p) => combined.includes(p));
}

function decideOpeningHours(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
): FieldDecision {
  const field: WebField = 'opening_hours';
  const best = bestByMethod(candidates)!;
  const openingIssues = best.openingIssues ?? [];

  const currentPresent = snapshot.opening_hours.length > 0;
  const warningInEvidence = candidates.some(hasHoursWarning);
  const hasSeasonal = openingIssues.includes('seasonal');
  const hasAssumedClosed = openingIssues.includes('assumed_closed_days');

  // Current value present → always manual_review (global never-overwrite rule).
  if (currentPresent) {
    const reasons: ReasonCode[] = ['would_replace_existing'];
    if (warningInEvidence || hasSeasonal) reasons.push('opening_hours_change_warning');
    if (hasAssumedClosed) reasons.push('opening_hours_partial_week');
    return { field, decision: 'manual_review', reasons, chosen: toChosen(best, field, true) };
  }

  // Any temporary / seasonal / "call to confirm" markers → not safe to auto-apply.
  if (warningInEvidence || hasSeasonal) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['opening_hours_change_warning'],
      chosen: toChosen(best, field, false),
    };
  }

  // Partial week (some days assumed closed, not explicitly mentioned) → manual_review.
  if (hasAssumedClosed) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['opening_hours_partial_week'],
      chosen: toChosen(best, field, false),
    };
  }

  // Full 7-day explicit schedule, current empty, no warnings → auto_apply.
  // Note: split_hours is valid (lunch break) and does NOT block auto_apply.
  return {
    field,
    decision: 'auto_apply',
    reasons: ['current_empty', 'complete_week', 'official_domain_source'],
    chosen: toChosen(best, field, false),
  };
}

// ── Description (§7a) ─────────────────────────────────────────────────────────

const BANNED_PHRASES: readonly string[] = [
  'a great day out',
  'fun for all the family',
  'something for everyone',
  'the perfect place',
  'unforgettable experience',
];

/**
 * Category slug → human-readable label for "X is a [label] in [City]."
 * Unknown slugs fall back to slug with hyphens replaced by spaces.
 * All entries come from admin-controlled DB records — treated as verified facts.
 */
const CATEGORY_LABELS: Record<string, string> = {
  'soft-play': 'soft play centre',
  'soft-play-centre': 'soft play centre',
  'indoor-play': 'indoor play centre',
  'indoor-play-centre': 'indoor play centre',
  'outdoor-play': 'outdoor play area',
  'adventure-playground': 'adventure playground',
  'farm': 'farm attraction',
  'farm-attraction': 'farm attraction',
  'petting-farm': 'petting farm',
  'swimming': 'swimming centre',
  'swimming-pool': 'swimming pool',
  'gymnastics': 'gymnastics centre',
  'dance': 'dance school',
  'dance-school': 'dance school',
  'theatre': "children's theatre",
  'childrens-theatre': "children's theatre",
  'museum': 'museum',
  'aquarium': 'aquarium',
  'zoo': 'zoo',
  'theme-park': 'theme park',
  'adventure-park': 'adventure park',
  'trampoline-park': 'trampoline park',
  'climbing': 'climbing centre',
  'climbing-centre': 'climbing centre',
  'pottery': 'pottery studio',
  'arts-and-crafts': 'arts and crafts studio',
  'bowling': 'bowling alley',
  'cinema': 'cinema',
  'crazy-golf': 'crazy golf venue',
  'laser-tag': 'laser tag arena',
  'escape-room': 'escape room',
  'park': 'park and playground',
  'playground': 'playground',
  'sports-centre': 'sports centre',
  'yoga': 'family yoga studio',
  'baby-sensory': 'baby sensory venue',
  'toddler-group': 'toddler group venue',
  'nursery': 'nursery',
  'after-school': 'after-school club venue',
  'soft-play-and-cafe': 'soft play and café',
  'nature-reserve': 'nature reserve',
  'water-park': 'water park',
  'activity-centre': 'activity centre',
  'country-park': 'country park',
  'beach': 'beach destination',
};

interface ComposedDescription {
  text: string;
  /** Identified uncertainties; 1 → manual_review; 0 → auto_apply eligible. */
  uncertainties: string[];
}

/**
 * Compose a deterministic UK-English 1-sentence description from DB facts.
 * Returns null when no category slug is available (report_only path).
 * NEVER reads web-extracted description candidates.
 */
function composeDescription(facts: VenueFacts): ComposedDescription | null {
  const { name, categorySlug, city } = facts;
  if (!categorySlug?.trim()) return null;

  const slug = categorySlug.trim();
  const knownLabel = CATEGORY_LABELS[slug];
  const label = knownLabel ?? slug.replace(/-/g, ' ');
  const uncertainties: string[] = [];

  if (!knownLabel) {
    // Slug not in our label map → label is uncertain (slug→spaces fallback).
    uncertainties.push('unknown_category_label');
  }

  // Pattern A: name + category + city (preferred).
  if (city?.trim()) {
    return { text: `${name} is a ${label} in ${city.trim()}.`, uncertainties };
  }

  // Pattern B: name + category only.
  return { text: `${name} is a ${label}.`, uncertainties };
}

/**
 * Validate the composed description against quality gates.
 * Returns an empty array when it passes all checks.
 */
function checkDescriptionQuality(
  text: string,
  descriptionCandidates: FieldCandidate[],
): ReasonCode[] {
  const failures: ReasonCode[] = [];

  // Length: 20–250 characters (one short sentence).
  if (text.length < 20 || text.length > 250) {
    failures.push('description_failed_validation');
  }

  // No HTML tags.
  if (/<[^>]+>/.test(text)) {
    failures.push('description_failed_validation');
  }

  // No banned filler phrases.
  const lower = text.toLowerCase();
  if (BANNED_PHRASES.some((p) => lower.includes(p))) {
    failures.push('description_failed_validation');
  }

  // Similarity check: no verbatim 6-word run from the site's description.
  // Since our text is composed from DB facts, not from the page, this will
  // virtually never fire — it's a final safety net against accidental copying.
  if (descriptionCandidates.length > 0) {
    const sourceText = String(descriptionCandidates[0]!.value).toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const RUN = 6;
    if (words.length >= RUN) {
      for (let i = 0; i <= words.length - RUN; i++) {
        const phrase = words.slice(i, i + RUN).join(' ');
        if (sourceText.includes(phrase)) {
          failures.push('description_failed_similarity');
          break;
        }
      }
    }
  }

  return [...new Set(failures)];
}

function decideDescription(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
  facts: VenueFacts,
): FieldDecision {
  const field: WebField = 'description';

  // Attempt composition from DB facts (never from candidate text).
  const composed = composeDescription(facts);

  if (!composed) {
    // Insufficient structured facts — record for audit / future retry.
    return { field, decision: 'report_only', reasons: ['insufficient_description_evidence'] };
  }

  // Quality gates.
  const failReasons = checkDescriptionQuality(composed.text, candidates);
  if (failReasons.length > 0) {
    return { field, decision: 'auto_reject', reasons: failReasons, generatedText: composed.text };
  }

  // One identified uncertainty in the composed facts → manual_review.
  // "Never make the admin write from scratch" — we always provide the draft.
  if (composed.uncertainties.length > 0) {
    const reasons: ReasonCode[] = ['description_one_uncertainty', 'description_facts_sufficient'];
    if (snapshot.description?.trim()) reasons.push('would_replace_existing');
    return { field, decision: 'manual_review', reasons, generatedText: composed.text };
  }

  // Current description present → would replace.
  if (snapshot.description?.trim()) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['would_replace_existing', 'description_facts_sufficient'],
      generatedText: composed.text,
    };
  }

  // Description is NEVER auto_apply — the RPC returns validation_failed for description
  // auto-applies, so an auto_apply row would be orphaned. Admin must approve via manual_review.
  return {
    field,
    decision: 'manual_review',
    reasons: ['description_facts_sufficient'],
    generatedText: composed.text,
  };
}

// ── Price range ───────────────────────────────────────────────────────────────

const VALID_PRICE_BANDS = new Set(['free', 'budget', 'moderate', 'premium']);

function decidePriceRange(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
): FieldDecision {
  const field: WebField = 'price_range';
  const best = bestByMethod(candidates)!;
  const proposed = String(best.value);

  // Guard: never infer from venue type (heuristic extractor is already suppressed
  // upstream, but defensive check ensures the rule is never bypassed).
  if (candidates.every((c) => c.method === 'heuristic')) {
    return { field, decision: 'auto_reject', reasons: ['off_domain_source'], chosen: toChosen(best, field, false) };
  }

  if (!VALID_PRICE_BANDS.has(proposed)) {
    return { field, decision: 'auto_reject', reasons: ['malformed_value'], chosen: toChosen(best, field, false) };
  }

  const currentPrice = snapshot.price_range?.trim() ?? '';

  if (currentPrice === proposed) {
    return { field, decision: 'auto_reject', reasons: ['equals_current'], chosen: toChosen(best, field, false) };
  }

  // Multiple distinct price bands → ambiguous.
  const distinctBands = new Set(
    candidates.map((c) => String(c.value)).filter((v) => VALID_PRICE_BANDS.has(v)),
  );
  if (distinctBands.size > 1) {
    const conflicts = !!currentPrice;
    return {
      field,
      decision: 'manual_review',
      reasons: ['price_ambiguous'],
      chosen: toChosen(best, field, conflicts),
    };
  }

  // Would replace a valid existing value.
  if (currentPrice && currentPrice !== proposed) {
    return {
      field,
      decision: 'manual_review',
      reasons: ['would_replace_existing'],
      chosen: toChosen(best, field, true),
    };
  }

  return {
    field,
    decision: 'auto_apply',
    reasons: ['current_empty', 'pricing_unambiguous', 'official_domain_source'],
    chosen: toChosen(best, field, false),
  };
}

// ── Booking URL ───────────────────────────────────────────────────────────────

function decideBookingUrl(candidates: FieldCandidate[]): FieldDecision {
  const field: WebField = 'booking_url';
  const best = bestByMethod(candidates)!;
  // Always report_only: no target column in the current DB schema (§7).
  return {
    field,
    decision: 'report_only',
    reasons: ['booking_url_no_target_column'],
    chosen: {
      value: best.value,
      sourceUrl: best.sourceUrl,
      evidenceSnippet: best.evidenceSnippet,
      evidenceRaw: best.evidenceRaw ?? null,
      method: best.method,
      confidence: computeConfidence({ field, method: best.method }),
      conflictsExisting: false,
    },
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Select the candidate with the lowest method rank (jsonld=0 wins). */
function bestByMethod(candidates: FieldCandidate[]): FieldCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => {
    const rb = METHOD_RANK[best.method] ?? 99;
    const rc = METHOD_RANK[c.method] ?? 99;
    return rc < rb ? c : best;
  });
}

/** Group candidates by field. */
function groupByField(candidates: FieldCandidate[]): Map<WebField, FieldCandidate[]> {
  const map = new Map<WebField, FieldCandidate[]>();
  for (const c of candidates) {
    const list = map.get(c.field) ?? [];
    list.push(c);
    map.set(c.field, list);
  }
  return map;
}

/** Build the FieldDecision.chosen entry for a candidate. */
function toChosen(
  candidate: FieldCandidate,
  field: WebField,
  conflictsExisting: boolean,
): NonNullable<FieldDecision['chosen']> {
  return {
    value: candidate.value,
    sourceUrl: candidate.sourceUrl,
    evidenceSnippet: candidate.evidenceSnippet,
    evidenceRaw: candidate.evidenceRaw ?? null,
    method: candidate.method,
    confidence: computeConfidence({
      field,
      method: candidate.method,
      conflictsExisting,
      openingIssues: candidate.openingIssues,
      isPersonalEmail: field === 'email' ? looksPersonalEmail(String(candidate.value)) : false,
    }),
    conflictsExisting,
  };
}

// Re-export internal helpers for tests (isCanonicalEquivalentWebsite is already exported above).
export { composeDescription, checkDescriptionQuality, hasHoursWarning };
export type { ComposedDescription };
