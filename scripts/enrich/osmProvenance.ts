// =============================================================================
// scripts/enrich/osmProvenance.ts
//
// Pure function: OSM tags -> AnnotatedFacts (value + provenance per field).
//
// WHY this exists:
//   Phase 2A's extractRawFacts() returns plain values and discards *how* each
//   value was derived. The Phase 2B merge engine needs that distinction:
//   an explicit OSM tag (indoor=yes, wheelchair=no) must beat a Geoapify value,
//   but an OSM *category inference* (leisure=park => outdoor) must lose to a
//   Geoapify *explicit* value. So we re-classify each field as:
//
//     'explicit' — came from a direct OSM tag a surveyor set on this venue
//                  (indoor=, wheelchair=, toilets=, parking=, changing_table=,
//                   amenity=cafe/toilets/parking, ...).
//     'inferred' — derived only from a category tag (tourism=/leisure=/sport=).
//     null       — not assessed (value is null).
//
// This module does NOT re-implement the extraction logic — it calls the
// audited extractRawFacts() for the values, then classifies provenance from the
// same tags. Keeping a single source of truth for values avoids drift.
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import type { AnnotatedFacts, FactProvenance, RawFacts } from '../../types/enrichment';
import { extractRawFacts } from './osmExtract';

// Helper: wrap a value with its provenance. A null value always has null
// provenance (you cannot have "explicitly null" in this model — null means
// "not assessed", never "confirmed absent" unless the value itself is false).
function fv<T>(value: T | null, provenance: FactProvenance): { value: T | null; provenance: FactProvenance | null } {
  return value === null ? { value: null, provenance: null } : { value, provenance };
}

/**
 * Derive AnnotatedFacts from raw OSM tags.
 *
 * Provenance rules (mirrors osmExtract.ts derivation precedence):
 *   indoor_outdoor        explicit IFF indoor=yes|no is set; otherwise inferred
 *                         (from tourism/leisure/building category).
 *   parking_available     explicit (every parking signal is a direct tag).
 *   cafe_available        explicit (amenity=cafe/restaurant/... is a direct tag).
 *   toilets_available     explicit (toilets= or amenity=toilets).
 *   baby_change_available explicit (changing_table / toilets:changing_table).
 *   wheelchair_accessible explicit (wheelchair= is a direct tag).
 *   visit_duration_mins   inferred (estimated from category type).
 *   activity_level        inferred (from leisure/sport/tourism category).
 */
export function annotateOsmFacts(tags: Record<string, string>): AnnotatedFacts {
  const facts: RawFacts = extractRawFacts(tags);

  // indoor_outdoor is the only field whose provenance depends on *which* tag
  // produced it: an explicit indoor= tag vs. a category/building inference.
  const indoorIsExplicit = tags['indoor'] === 'yes' || tags['indoor'] === 'no';

  return {
    indoor_outdoor:        fv(facts.indoor_outdoor,        indoorIsExplicit ? 'explicit' : 'inferred'),
    parking_available:     fv(facts.parking_available,     'explicit'),
    cafe_available:        fv(facts.cafe_available,        'explicit'),
    toilets_available:     fv(facts.toilets_available,     'explicit'),
    baby_change_available: fv(facts.baby_change_available, 'explicit'),
    wheelchair_accessible: fv(facts.wheelchair_accessible, 'explicit'),
    visit_duration_mins:   fv(facts.visit_duration_mins,   'inferred'),
    activity_level:        fv(facts.activity_level,        'inferred'),
  };
}
