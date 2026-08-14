// =============================================================================
// scripts/enrich/freshness.ts
//
// Enrichment 2.0 — Part 13: freshness / re-enrichment scheduling.
//
// Field-domain TTLs, documented with rationale. "Identity" (website/domain)
// changes rarely, so it gets the longest interval; closure status for a venue
// already showing a suspicion gets the shortest (we want to notice a reopening
// or confirm a closure quickly); opening hours and pricing drift often enough
// (seasonal changes, price rises) to need mid-length checks.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

import type {
  FreshnessCheck,
  FreshnessDomain,
  FreshnessResult,
  VenuePriority,
} from '../../types/enrichmentAutonomy';

export const FRESHNESS_TTL_DAYS: Record<FreshnessDomain, number> = {
  identity: 180,       // website/domain rarely changes
  contact: 120,        // phone/email — moderate drift
  opening_hours: 45,   // seasonal changes are common
  pricing: 60,         // price rises, seasonal offers
  closure_status: 30,  // routine recheck cadence for an active venue
  facilities: 180,     // physical facilities rarely change
  description: 365,    // low priority once a reasonable summary exists
};

/** Shortened TTL for venues already showing a closure suspicion (Part 13). */
export const SUSPICIOUS_CLOSURE_TTL_DAYS = 14;

export function computeFreshness(check: FreshnessCheck, now: Date = new Date()): FreshnessResult {
  const ttlDays =
    check.domain === 'closure_status' && check.suspiciousClosure
      ? SUSPICIOUS_CLOSURE_TTL_DAYS
      : FRESHNESS_TTL_DAYS[check.domain];

  if (!check.lastCheckedAt) {
    return { domain: check.domain, stale: true, ttlDays, ageDays: null };
  }

  const last = new Date(check.lastCheckedAt).getTime();
  const ageMs = now.getTime() - last;
  const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));

  return {
    domain: check.domain,
    stale: ageDays >= ttlDays,
    ttlDays,
    ageDays,
  };
}

export interface VenueFreshnessInput {
  venueId: string;
  checks: FreshnessCheck[];
  /** True when the venue is missing a field considered "critical" (Part 13 priority #1). */
  missingCriticalField?: boolean;
  /** Optional popularity signal (0+) — only used if provided; never invented. */
  popularitySignal?: number;
}

/**
 * Rank venues by enrichment priority (Part 13):
 *   1. Missing critical details (highest)
 *   2. Stale opening hours / contact info
 *   3. Popular venues, if a legitimate usage signal is supplied
 *   4. Everything else, oldest-checked first
 * Never invents a popularity signal — if none is supplied, that factor is 0
 * for every venue and has no effect on ordering (Part 13: "if usage data
 * exists and is legally appropriate to use").
 */
export function prioritiseVenues(inputs: VenueFreshnessInput[], now: Date = new Date()): VenuePriority[] {
  const results: VenuePriority[] = [];

  for (const v of inputs) {
    let priority = 0;
    const reasons: string[] = [];

    if (v.missingCriticalField) {
      priority += 1000;
      reasons.push('missing critical field(s)');
    }

    for (const check of v.checks) {
      const result = computeFreshness(check, now);
      if (result.stale) {
        // Shorter-TTL domains (opening hours, closure) score higher urgency
        // per unit of staleness than long-TTL domains (description).
        const weight = Math.round(100 / result.ttlDays);
        const overdueDays = result.ageDays === null ? result.ttlDays : result.ageDays - result.ttlDays;
        const contribution = weight * (1 + Math.max(0, overdueDays) / result.ttlDays);
        priority += contribution;
        reasons.push(`${check.domain} stale (${result.ageDays ?? 'never checked'}d, ttl ${result.ttlDays}d)`);
      }
    }

    if (typeof v.popularitySignal === 'number' && v.popularitySignal > 0) {
      priority += Math.min(50, v.popularitySignal);
      reasons.push(`popularity signal ${v.popularitySignal}`);
    }

    results.push({ venueId: v.venueId, priority: Math.round(priority), reasons });
  }

  return results.sort((a, b) => b.priority - a.priority);
}
