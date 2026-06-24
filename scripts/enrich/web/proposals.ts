// =============================================================================
// scripts/enrich/web/proposals.ts
//
// Pure proposal generation (spec §4/§6). Candidates + a CurrentVenueSnapshot →
// ProposalDraft[]. Responsibilities:
//   - dedup: drop any candidate whose value already equals the current value
//   - conflict detection: flag when an existing non-null value differs
//   - confidence: delegate to confidence.ts (with conflict / opening-issue / personal-email caps)
//   - shape the uniform proposed_value / current_value containers
//
// Reads NO database — the snapshot is fetched by the (impure) orchestrator and
// passed in (arch #7). Authoritative stale-guard hashing is the DB's job, not here.
//
// No I/O, deterministic. No '@/' path alias.
// =============================================================================

import type {
  CurrentVenueSnapshot,
  DayHours,
  FieldCandidate,
  OpeningWeek,
  ProposalDraft,
  WebField,
} from '../../../types/webEnrichment';
import { computeConfidence } from './confidence';
import { looksPersonalEmail, phoneDedupKey } from './fields';

export interface BuildProposalsOptions {
  retrievedAt: string; // ISO8601 — injected for deterministic output
}

export function buildProposals(
  candidates: FieldCandidate[],
  snapshot: CurrentVenueSnapshot,
  opts: BuildProposalsOptions,
): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];

  for (const c of candidates) {
    const currentScalar = currentScalarFor(c.field, snapshot);
    const isHours = c.field === 'opening_hours';

    // Normalised comparison keys for dedup / conflict.
    const proposedKey = isHours
      ? canonicalWeek((c.value as OpeningWeek).days)
      : normaliseScalar(c.field, String(c.value));
    const currentKey = isHours
      ? canonicalWeek(snapshot.opening_hours)
      : currentScalar === null
        ? null
        : normaliseScalar(c.field, currentScalar);

    const currentPresent = isHours ? snapshot.opening_hours.length > 0 : currentScalar !== null;

    // Dedup: proposing the value that is already stored is a no-op (arch #5).
    if (currentPresent && currentKey === proposedKey) continue;

    const conflicts = currentPresent && currentKey !== proposedKey;

    const confidence = computeConfidence({
      field: c.field,
      method: c.method,
      conflictsExisting: conflicts,
      openingIssues: c.openingIssues,
      isPersonalEmail: c.field === 'email' ? looksPersonalEmail(String(c.value)) : false,
    });

    drafts.push({
      field: c.field,
      proposed_value: isHours ? c.value : { v: c.value },
      current_value: isHours
        ? currentPresent
          ? snapshot.opening_hours
          : null
        : currentScalar === null
          ? null
          : { v: currentScalar },
      source_url: c.sourceUrl,
      evidence_snippet: c.evidenceSnippet,
      evidence_raw: c.evidenceRaw ?? null,
      retrieved_at: opts.retrievedAt,
      extraction_method: c.method,
      confidence,
      conflicts_existing: conflicts,
    });
  }

  return drafts;
}

// ── Current-value access ──────────────────────────────────────────────────────

function currentScalarFor(field: WebField, snap: CurrentVenueSnapshot): string | null {
  switch (field) {
    case 'description':
      return snap.description;
    case 'price_range':
      return snap.price_range;
    case 'website':
      return snap.website;
    case 'phone':
      return snap.phone;
    case 'email':
      return snap.email;
    case 'booking_url':
      return null; // no venues.booking_url column yet (deferred) → always "new"
    case 'opening_hours':
    default:
      return null;
  }
}

// ── Normalisation for comparison ──────────────────────────────────────────────

function normaliseScalar(field: WebField, value: string): string {
  const v = value.trim();
  switch (field) {
    case 'website':
    case 'booking_url':
      return v.toLowerCase().replace(/\/+$/, '');
    case 'phone':
      // Use GB-aware canonical key so "+44 1738 561083" and "01738561083"
      // are treated as equal (FIX 1). Falls back to raw digits for non-GB
      // or if phoneDedupKey rejects the value.
      return phoneDedupKey(v) ?? v.replace(/\D/g, '');
    case 'email':
      return v.toLowerCase();
    case 'price_range':
      return v.toLowerCase();
    case 'description':
    default:
      return v.replace(/\s+/g, ' ');
  }
}

/** Canonical string for a (possibly partial) set of day rows → stable compare key. */
function canonicalWeek(days: DayHours[]): string {
  const byDay = new Map<number, string>();
  for (const d of days) {
    const intervals = [...d.intervals]
      .sort((a, b) => a.opens.localeCompare(b.opens))
      .map((i) => `${i.opens}-${i.closes}`)
      .join(',');
    byDay.set(d.day_of_week, d.is_closed || intervals === '' ? 'closed' : intervals);
  }
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) parts.push(`${i}:${byDay.get(i) ?? 'closed'}`);
  return parts.join('|');
}
