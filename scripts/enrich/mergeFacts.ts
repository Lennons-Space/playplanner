// =============================================================================
// scripts/enrich/mergeFacts.ts
//
// Pure merge engine: OSM annotated facts  ⊕  Geoapify annotated facts.
//
// Precedence (highest wins):
//   1. OSM explicit          (indoor=no, wheelchair=yes, toilets=no, ...)
//   2. Geoapify explicit     (facilities.toilets, wheelchair, ...)
//   3. OSM inferred          (leisure=park => outdoor)
//   4. Geoapify inferred     (category => indoor)
//   5. null / unknown        (kept — "unknown is better than wrong")
//
// Core rule: OSM explicit always wins; Geoapify only fills gaps (OSM null) or
// beats OSM *inference* when Geoapify is explicit. Disagreements are logged in
// `conflicts` and never silently override.
//
// SAFETY — accessibility fields (wheelchair_accessible, baby_change_available):
//   Geoapify may ONLY fill these when OSM is null. It may NEVER override a
//   non-null OSM accessibility value (no "upgrade" to a more-accessible claim on
//   weaker authority). Over-promising accessibility harms the families we serve.
//
// manually_curated rows are handled by the caller (skipped before they ever
// reach this function) — this module assumes it is only given mergeable venues.
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import type {
  AnnotatedFacts,
  FactValue,
  FieldConflict,
  FieldSource,
  MergedField,
  MergeResult,
  RawFacts,
} from '../../types/enrichment';

// The eight Layer-1 fields, in stable report order.
const FACT_FIELDS: (keyof RawFacts)[] = [
  'indoor_outdoor',
  'parking_available',
  'cafe_available',
  'toilets_available',
  'baby_change_available',
  'wheelchair_accessible',
  'visit_duration_mins',
  'activity_level',
];

// Fields where we apply the extra "never upgrade over OSM" accessibility guard.
const ACCESSIBILITY_FIELDS = new Set<keyof RawFacts>([
  'wheelchair_accessible',
  'baby_change_available',
]);

function osmSource(p: 'explicit' | 'inferred' | null): FieldSource {
  return p === 'explicit' ? 'osm_explicit' : 'osm_inferred';
}
function geoSource(p: 'explicit' | 'inferred' | null): FieldSource {
  return p === 'explicit' ? 'geoapify_explicit' : 'geoapify_inferred';
}

interface FieldMergeOutcome {
  merged:    MergedField<unknown>;
  conflict:  FieldConflict | null;
  applied:   boolean; // Geoapify filled or changed the value vs. OSM
}

function mergeOneField(
  field: keyof RawFacts,
  osm:   FactValue<unknown>,
  geo:   FactValue<unknown>,
): FieldMergeOutcome {
  const accessibilitySensitive = ACCESSIBILITY_FIELDS.has(field);

  // ── Accessibility guard: geo fills only when OSM is null ────────────────────
  if (accessibilitySensitive) {
    if (osm.value !== null) {
      // Keep OSM regardless. If Geoapify disagrees (and isn't null), log it but
      // never act on it — this is the deliberate "no accessibility upgrade" rule.
      const conflict: FieldConflict | null =
        geo.value !== null && geo.value !== osm.value
          ? {
              field,
              osm_value: osm.value,
              geoapify_value: geo.value,
              resolution: osmSource(osm.provenance),
              accessibility_sensitive: true,
              note:
                'accessibility field: OSM value kept; Geoapify never upgrades/overrides ' +
                'a non-null OSM accessibility claim',
            }
          : null;
      return {
        merged: { value: osm.value, source: osmSource(osm.provenance) },
        conflict,
        applied: false,
      };
    }
    // OSM null → Geoapify may fill (including a downgrade to 'no'/false).
    if (geo.value !== null) {
      return {
        merged: { value: geo.value, source: geoSource(geo.provenance) },
        conflict: null,
        applied: true,
      };
    }
    return { merged: { value: null, source: 'none' }, conflict: null, applied: false };
  }

  // ── General precedence ──────────────────────────────────────────────────────

  // 1. OSM explicit wins outright.
  if (osm.value !== null && osm.provenance === 'explicit') {
    const conflict: FieldConflict | null =
      geo.value !== null && geo.provenance === 'explicit' && geo.value !== osm.value
        ? {
            field,
            osm_value: osm.value,
            geoapify_value: geo.value,
            resolution: 'osm_explicit',
            accessibility_sensitive: false,
            note: 'OSM explicit vs Geoapify explicit disagree — OSM kept',
          }
        : null;
    return { merged: { value: osm.value, source: 'osm_explicit' }, conflict, applied: false };
  }

  // 2. OSM null → take Geoapify (the gap-fill we want), explicit or inferred.
  if (osm.value === null) {
    if (geo.value !== null) {
      return {
        merged: { value: geo.value, source: geoSource(geo.provenance) },
        conflict: null,
        applied: true,
      };
    }
    return { merged: { value: null, source: 'none' }, conflict: null, applied: false };
  }

  // 3. OSM is inferred (non-null). Geoapify explicit beats inference.
  if (geo.value !== null && geo.provenance === 'explicit') {
    const changed = geo.value !== osm.value;
    const conflict: FieldConflict | null = changed
      ? {
          field,
          osm_value: osm.value,
          geoapify_value: geo.value,
          resolution: 'geoapify_explicit',
          accessibility_sensitive: false,
          note: 'OSM inference overridden by Geoapify explicit value',
        }
      : null;
    return { merged: { value: geo.value, source: 'geoapify_explicit' }, conflict, applied: changed };
  }

  // 4. Both inferred. Keep OSM; log if they disagree.
  if (geo.value !== null && geo.provenance === 'inferred' && geo.value !== osm.value) {
    return {
      merged: { value: osm.value, source: 'osm_inferred' },
      conflict: {
        field,
        osm_value: osm.value,
        geoapify_value: geo.value,
        resolution: 'osm_inferred',
        accessibility_sensitive: false,
        note: 'both sources inferred and disagree — OSM kept',
      },
      applied: false,
    };
  }

  // 5. Geoapify null or agrees — keep OSM inferred value.
  return { merged: { value: osm.value, source: 'osm_inferred' }, conflict: null, applied: false };
}

/**
 * Merge OSM and Geoapify annotated facts into a single fact set with full
 * provenance, conflicts, and the list of fields Geoapify actually contributed.
 *
 * @param osm  AnnotatedFacts from annotateOsmFacts()
 * @param geo  AnnotatedFacts from extractGeoapifyAnnotatedFacts() — pass an
 *             all-null set when there was no Geoapify match (e.g. REJECT).
 */
export function mergeAnnotatedFacts(osm: AnnotatedFacts, geo: AnnotatedFacts): MergeResult {
  const facts = {} as RawFacts;
  const field_sources = {} as Record<keyof RawFacts, FieldSource>;
  const applied_fields: (keyof RawFacts)[] = [];
  const conflicts: FieldConflict[] = [];

  for (const field of FACT_FIELDS) {
    const outcome = mergeOneField(field, osm[field], geo[field]);
    // The cast is safe: mergeOneField preserves the field's own value type.
    (facts as unknown as Record<string, unknown>)[field] = outcome.merged.value;
    field_sources[field] = outcome.merged.source;
    if (outcome.applied) applied_fields.push(field);
    if (outcome.conflict) conflicts.push(outcome.conflict);
  }

  const usedGeoapify = Object.values(field_sources).some((s) => s.startsWith('geoapify'));
  const sources = usedGeoapify ? ['osm_archive', 'geoapify'] : ['osm_archive'];

  return { facts, field_sources, applied_fields, conflicts, sources };
}

/** An all-null AnnotatedFacts set — use when there is no Geoapify match. */
export function emptyAnnotatedFacts(): AnnotatedFacts {
  const empty = { value: null, provenance: null } as const;
  return {
    indoor_outdoor:        { ...empty },
    parking_available:     { ...empty },
    cafe_available:        { ...empty },
    toilets_available:     { ...empty },
    baby_change_available: { ...empty },
    wheelchair_accessible: { ...empty },
    visit_duration_mins:   { ...empty },
    activity_level:        { ...empty },
  };
}
