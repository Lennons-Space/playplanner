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

// =============================================================================
// Phase 2B: Geoapify enrichment types (no-network foundation)
//
// These power the pure matching / extraction / merge modules in
// scripts/enrich/{geoapifyMatch,geoapifyExtract,osmProvenance,mergeFacts}.ts.
// Nothing here performs I/O — the HTTP client (a later phase) will produce the
// GeoapifyResponse shapes below; for Phase 2B-0 they come from saved fixtures.
// =============================================================================

// ── Raw Geoapify GeoJSON shapes ───────────────────────────────────────────────
// We only type the properties we actually read. Real responses carry far more;
// the unread fields are preserved verbatim in raw_geoapify for audit.

export interface GeoapifyRank {
  confidence?: number;   // 0..1 — how sure Geoapify is this matched a real place
  match_type?: string;   // e.g. 'full_match', 'inner_part'
}

export interface GeoapifyContact {
  phone?:   string;
  website?: string;
  email?:   string;
}

export interface GeoapifyFeatureProperties {
  place_id?:      string;
  name?:          string;
  lat?:           number;
  lon?:           number;
  postcode?:      string;
  city?:          string;
  country_code?:  string;
  category?:      string;    // single primary category (Geocoding API)
  categories?:    string[];  // category list (Place Details API)
  rank?:          GeoapifyRank;
  opening_hours?: string;    // raw OSM-syntax opening hours string
  website?:       string;
  contact?:       GeoapifyContact;
  wheelchair?:    string;    // 'yes' | 'limited' | 'no' | 'designated' | ...
  facilities?:    Record<string, boolean | string>;
  catering?:      Record<string, boolean | string>;
  parking?:       Record<string, boolean | string>;
}

export interface GeoapifyFeature {
  type?:      string;
  properties: GeoapifyFeatureProperties;
  geometry?:  { type?: string; coordinates?: [number, number] }; // [lon, lat]
}

export interface GeoapifyResponse {
  type?:    string;
  features: GeoapifyFeature[];
}

// ── Matchable snapshot of one of OUR venues (input to the matcher) ────────────
export interface VenueMatchInput {
  id:             string;
  name:           string;
  latitude:       number;
  longitude:      number;
  postcode:       string | null;
  city?:          string | null;
  category_slug?: string | null;
}

// ── Raw fixture / cache bundle (mirrors what raw_geoapify will store) ─────────
// This is the documented "raw response fixture format". One file = one venue.
export interface GeoapifyRawBundle {
  venue:          VenueMatchInput;   // snapshot of the venue we tried to match
  geocode:        GeoapifyResponse;  // raw Geocoding API response (candidates)
  place_details?: GeoapifyResponse;  // raw Place Details response (after a match)
}

// ── Match result ──────────────────────────────────────────────────────────────
export type MatchDecision = 'accept' | 'review' | 'reject';

export interface MatchResult {
  decision:           MatchDecision;
  score:              number;          // composite 0..1
  distance_m:         number | null;   // metres to the chosen candidate
  name_sim:           number;          // 0..1 normalised name similarity
  postcode_match:     boolean;
  confidence:         number;          // Geoapify rank.confidence (0 if absent)
  place_id:           string | null;
  candidate_name:     string | null;
  candidate_category: string | null;
  category_mismatch:  boolean;         // venue family clearly disagrees
  reasons:            string[];        // human-readable audit trail
}

// ── Field-level provenance (drives the merge engine) ──────────────────────────
export type FactProvenance = 'explicit' | 'inferred';

export interface FactValue<T> {
  value:      T | null;
  provenance: FactProvenance | null;   // null exactly when value is null
}

// A full RawFacts set where each field also carries how it was derived.
export type AnnotatedFacts = { [K in keyof RawFacts]: FactValue<RawFacts[K]> };

export type FieldSource =
  | 'osm_explicit'
  | 'osm_inferred'
  | 'geoapify_explicit'
  | 'geoapify_inferred'
  | 'none';

export interface FieldConflict {
  field:                   keyof RawFacts;
  osm_value:               unknown;
  geoapify_value:          unknown;
  resolution:              FieldSource;   // which source's value was kept
  accessibility_sensitive: boolean;       // wheelchair / baby-change → extra care
  note:                    string;
}

export interface MergedField<T> {
  value:  T | null;
  source: FieldSource;
}

// Capture-only fields Geoapify can provide that have no DB column yet (2B-4).
export interface GeoapifyExtras {
  opening_hours: string | null;
  website:       string | null;
  phone:         string | null;
  email:         string | null;
  categories:    string[];
}

export interface MergeResult {
  facts:          RawFacts;                       // flattened merged values
  field_sources:  Record<keyof RawFacts, FieldSource>;
  applied_fields: (keyof RawFacts)[];             // fields Geoapify filled/changed
  conflicts:      FieldConflict[];
  sources:        string[];                       // e.g. ['osm_archive','geoapify']
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
