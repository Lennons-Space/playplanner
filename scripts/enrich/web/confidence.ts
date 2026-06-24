// =============================================================================
// scripts/enrich/web/confidence.ts
//
// Pure confidence scoring (spec §6b). Base level comes from the extraction method;
// then a set of caps demote it. Confidence is ADVISORY ONLY — it never triggers
// auto-apply (MVP rule). It exists to triage reviewer attention.
//
// Caps applied (take the lower of base and each cap):
//   - conflicts with an existing non-null value  → medium
//   - opening_hours with split/seasonal/assumed   → medium
//   - price_range (lossy enum mapping)            → medium
//   - description (must be rewritten on apply)     → medium
//   - personal-looking email                       → low
//
// No I/O, deterministic. No '@/' path alias.
// =============================================================================

import type { Confidence, ExtractionMethod, WebField } from '../../../types/webEnrichment';

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: Confidence[] = ['low', 'medium', 'high'];

function baseFor(method: ExtractionMethod): Confidence {
  switch (method) {
    case 'jsonld':
    case 'microdata':
      return 'high';
    case 'meta':
      return 'medium';
    case 'heuristic':
    default:
      return 'low';
  }
}

function capAt(current: Confidence, cap: Confidence): Confidence {
  return RANK[cap] < RANK[current] ? cap : current;
}

export interface ConfidenceInput {
  field: WebField;
  method: ExtractionMethod;
  conflictsExisting?: boolean;
  /** Issues from the opening-hours parser (split_hours, seasonal, assumed_closed_days, …). */
  openingIssues?: string[];
  /** Set when an email looks personal (firstname.lastname@…). */
  isPersonalEmail?: boolean;
}

export function computeConfidence(input: ConfidenceInput): Confidence {
  let level = baseFor(input.method);

  if (input.field === 'price_range') level = capAt(level, 'medium');
  if (input.field === 'description') level = capAt(level, 'medium');

  if (input.field === 'opening_hours' && (input.openingIssues?.length ?? 0) > 0) {
    level = capAt(level, 'medium');
  }
  if (input.conflictsExisting) level = capAt(level, 'medium');
  if (input.field === 'email' && input.isPersonalEmail) level = capAt(level, 'low');

  return level;
}

/** Exposed for tests / reporting. */
export function rankOf(c: Confidence): number {
  return RANK[c];
}

export { BY_RANK };
