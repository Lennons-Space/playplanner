// =============================================================================
// types/enrichment.ts
//
// TypeScript types that mirror the venue_enrichment table (migration 049).
//
// IMPORTANT: Do NOT import from '@/' path aliases here.
// This file is used by scripts running outside the Expo app bundle (ts-node /
// tsx), where the '@/' alias is not configured. Use relative imports only.
// =============================================================================

export type IndoorOutdoor = 'indoor' | 'outdoor' | 'mixed' | 'unknown';
export type WheelchairAccess = 'yes' | 'limited' | 'no' | 'unknown';
export type ActivityLevel = 'low' | 'medium' | 'high' | 'unknown';
export type EnrichmentConfidence = 'low' | 'medium' | 'high';

export type RecommendedForTag =
  | 'rainy_day'
  | 'burn_energy'
  | 'learning'
  | 'budget_friendly'
  | 'accessible'
  | 'parent_friendly'
  | 'indoor'
  | 'outdoor'
  | 'free'
  | 'full_day'
  | 'half_day'
  | 'toddler_friendly'
  | 'family_day_out';

// ── Layer 1: Raw facts ────────────────────────────────────────────────────────
// These are directly verifiable facts from OSM or another data source.
// NULL = not assessed. false = confirmed absent. Never infer from NULL.
export interface RawFacts {
  indoor_outdoor:        IndoorOutdoor | null;
  parking_available:     boolean | null;
  cafe_available:        boolean | null;
  toilets_available:     boolean | null;
  baby_change_available: boolean | null;
  wheelchair_accessible: WheelchairAccess | null;
  visit_duration_mins:   number | null;
  activity_level:        ActivityLevel | null;
}

// ── Layer 2: Intelligence scores ──────────────────────────────────────────────
// Script-computed 0-100 scores. Formulas live in scripts/enrich/intelligence.ts
// and will evolve — they are never stored as generated DB columns.
export interface IntelligenceScores {
  parent_convenience_score: number;
  rainy_day_score:          number;
  active_play_score:        number;
  learning_score:           number;
  budget_score:             number;
  accessibility_score:      number;
}

// ── Score breakdown for audit trail ──────────────────────────────────────────
// Each key is a score component name; value is its point contribution.
// Stored as score_breakdown JSONB in the DB so we can audit formula changes.
export interface ScoreBreakdown {
  parent_convenience: Record<string, number>;
  rainy_day:          Record<string, number>;
  active_play:        Record<string, number>;
  learning:           Record<string, number>;
  budget:             Record<string, number>;
  accessibility:      Record<string, number>;
}

// ── Full enrichment record (matches the DB row exactly) ──────────────────────
export interface VenueEnrichment {
  venue_id: string;

  // Layer 1
  indoor_outdoor:        IndoorOutdoor | null;
  parking_available:     boolean | null;
  cafe_available:        boolean | null;
  toilets_available:     boolean | null;
  baby_change_available: boolean | null;
  wheelchair_accessible: WheelchairAccess | null;
  visit_duration_mins:   number | null;
  activity_level:        ActivityLevel | null;

  // Layer 2
  parent_convenience_score: number | null;
  rainy_day_score:          number | null;
  active_play_score:        number | null;
  learning_score:           number | null;
  budget_score:             number | null;
  accessibility_score:      number | null;

  // Layer 3
  recommended_for: RecommendedForTag[];

  // Provenance
  enrichment_confidence: EnrichmentConfidence;
  enrichment_sources:    string[];
  raw_osm_tags:          Record<string, string> | null;
  raw_geoapify:          unknown | null;
  raw_wikidata:          unknown | null;
  manually_curated:      boolean;
  intelligence_version:  number;
  score_breakdown:       ScoreBreakdown;
  last_enriched_at:      string | null;
  created_at:            string;
  updated_at:            string;
}
