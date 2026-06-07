// =============================================================================
// scripts/enrich/__tests__/mergeFacts.test.ts
//
// Tests for the pure merge engine (mergeAnnotatedFacts) and the OSM provenance
// annotator (annotateOsmFacts).
//
// WHY these tests matter:
//   The merge engine is where "OSM explicit wins, Geoapify only fills gaps" is
//   actually enforced, and where the accessibility safety rule lives ("never let
//   Geoapify upgrade a wheelchair/baby-change claim over OSM"). A regression here
//   could let a weak Geoapify guess overwrite a surveyor's explicit OSM tag, or
//   over-promise accessibility to a family that relies on it. Every precedence
//   branch and the accessibility guard are pinned below.
//
// No network, no credits. No '@/' path aliases (runs outside the Expo bundle).
// =============================================================================

import {
  mergeAnnotatedFacts,
  emptyAnnotatedFacts,
} from '../mergeFacts';
import { annotateOsmFacts } from '../osmProvenance';
import { extractGeoapifyAnnotatedFacts, firstProperties } from '../geoapifyExtract';
import type {
  AnnotatedFacts,
  FactProvenance,
  GeoapifyFeatureProperties,
  GeoapifyRawBundle,
} from '../../../types/enrichment';

import willows from './fixtures/geoapify/willows-activity-farm.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an all-null annotated set, then override named fields. */
function facts(overrides: Partial<AnnotatedFacts> = {}): AnnotatedFacts {
  return { ...emptyAnnotatedFacts(), ...overrides };
}
/** Shorthand for a single FactValue. */
function v<T>(value: T | null, provenance: FactProvenance): { value: T | null; provenance: FactProvenance | null } {
  return value === null ? { value: null, provenance: null } : { value, provenance };
}

// =============================================================================
// annotateOsmFacts — provenance classification
// =============================================================================
describe('annotateOsmFacts', () => {
  // Without this: an explicit indoor= tag could be mislabelled inferred and lose
  // to a Geoapify guess during merge.
  it('marks indoor=yes as explicit', () => {
    expect(annotateOsmFacts({ indoor: 'yes' }).indoor_outdoor).toEqual({ value: 'indoor', provenance: 'explicit' });
  });

  // Without this: a category-derived value could be mislabelled explicit and
  // wrongly block a better Geoapify explicit value.
  it('marks category-derived indoor_outdoor as inferred', () => {
    expect(annotateOsmFacts({ leisure: 'park' }).indoor_outdoor).toEqual({ value: 'outdoor', provenance: 'inferred' });
  });

  it('marks facility tags as explicit', () => {
    const f = annotateOsmFacts({ toilets: 'yes', wheelchair: 'no', amenity: 'cafe' });
    expect(f.toilets_available).toEqual({ value: true, provenance: 'explicit' });
    expect(f.wheelchair_accessible).toEqual({ value: 'no', provenance: 'explicit' });
    expect(f.cafe_available).toEqual({ value: true, provenance: 'explicit' });
  });

  it('marks duration and activity_level as inferred', () => {
    const f = annotateOsmFacts({ tourism: 'museum' });
    expect(f.visit_duration_mins).toEqual({ value: 90, provenance: 'inferred' });
    expect(f.activity_level).toEqual({ value: 'low', provenance: 'inferred' });
  });

  it('returns all-null for tags with no recognised signals', () => {
    const f = annotateOsmFacts({ name: 'Somewhere' });
    expect(f.toilets_available).toEqual({ value: null, provenance: null });
    expect(f.indoor_outdoor).toEqual({ value: null, provenance: null });
  });
});

// =============================================================================
// mergeAnnotatedFacts — general precedence
// =============================================================================
describe('mergeAnnotatedFacts — precedence', () => {
  // Rule 1: OSM explicit always wins.
  it('keeps OSM explicit over a disagreeing Geoapify explicit and logs a conflict', () => {
    const osm = facts({ indoor_outdoor: v('indoor', 'explicit') });
    const geo = facts({ indoor_outdoor: v('outdoor', 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.indoor_outdoor).toBe('indoor');
    expect(r.field_sources.indoor_outdoor).toBe('osm_explicit');
    expect(r.applied_fields).not.toContain('indoor_outdoor');
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ field: 'indoor_outdoor', resolution: 'osm_explicit' });
  });

  // Rule 2: OSM null → Geoapify fills the gap (this is the whole point).
  it('fills an OSM null with a Geoapify explicit value', () => {
    const osm = facts(); // toilets null
    const geo = facts({ toilets_available: v(true, 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.toilets_available).toBe(true);
    expect(r.field_sources.toilets_available).toBe('geoapify_explicit');
    expect(r.applied_fields).toContain('toilets_available');
    expect(r.conflicts).toHaveLength(0);
  });

  it('fills an OSM null with a Geoapify inferred value', () => {
    const osm = facts();
    const geo = facts({ activity_level: v('high', 'inferred') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.activity_level).toBe('high');
    expect(r.field_sources.activity_level).toBe('geoapify_inferred');
    expect(r.applied_fields).toContain('activity_level');
  });

  // Rule 3: Geoapify explicit beats an OSM *inference*.
  it('lets a Geoapify explicit value override an OSM inferred value (with conflict)', () => {
    const osm = facts({ indoor_outdoor: v('outdoor', 'inferred') });
    const geo = facts({ indoor_outdoor: v('indoor', 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.indoor_outdoor).toBe('indoor');
    expect(r.field_sources.indoor_outdoor).toBe('geoapify_explicit');
    expect(r.applied_fields).toContain('indoor_outdoor');
    expect(r.conflicts[0]).toMatchObject({ field: 'indoor_outdoor', resolution: 'geoapify_explicit' });
  });

  it('does not flag a conflict when Geoapify explicit agrees with OSM inferred', () => {
    const osm = facts({ indoor_outdoor: v('indoor', 'inferred') });
    const geo = facts({ indoor_outdoor: v('indoor', 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.indoor_outdoor).toBe('indoor');
    expect(r.field_sources.indoor_outdoor).toBe('geoapify_explicit');
    expect(r.applied_fields).not.toContain('indoor_outdoor'); // value unchanged
    expect(r.conflicts).toHaveLength(0);
  });

  // Rule 4: both inferred and disagree → keep OSM, log it.
  it('keeps OSM when both sources are inferred and disagree', () => {
    const osm = facts({ activity_level: v('low', 'inferred') });
    const geo = facts({ activity_level: v('high', 'inferred') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.activity_level).toBe('low');
    expect(r.field_sources.activity_level).toBe('osm_inferred');
    expect(r.applied_fields).not.toContain('activity_level');
    expect(r.conflicts[0]).toMatchObject({ field: 'activity_level', resolution: 'osm_inferred' });
  });

  it('keeps OSM explicit when Geoapify has nothing', () => {
    const osm = facts({ parking_available: v(true, 'explicit') });
    const geo = facts();
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.parking_available).toBe(true);
    expect(r.field_sources.parking_available).toBe('osm_explicit');
    expect(r.conflicts).toHaveLength(0);
  });

  it('leaves a field null and source "none" when neither source has it', () => {
    const r = mergeAnnotatedFacts(facts(), facts());
    expect(r.facts.cafe_available).toBeNull();
    expect(r.field_sources.cafe_available).toBe('none');
  });
});

// =============================================================================
// mergeAnnotatedFacts — accessibility safety guard
// =============================================================================
describe('mergeAnnotatedFacts — accessibility guard', () => {
  // THE critical safety rule: never upgrade an accessibility claim over OSM.
  it('never upgrades wheelchair=no (OSM) to yes (Geoapify); logs a sensitive conflict', () => {
    const osm = facts({ wheelchair_accessible: v('no', 'explicit') });
    const geo = facts({ wheelchair_accessible: v('yes', 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.wheelchair_accessible).toBe('no');
    expect(r.field_sources.wheelchair_accessible).toBe('osm_explicit');
    expect(r.applied_fields).not.toContain('wheelchair_accessible');
    expect(r.conflicts[0]).toMatchObject({
      field: 'wheelchair_accessible',
      resolution: 'osm_explicit',
      accessibility_sensitive: true,
    });
  });

  // Even when OSM accessibility is non-null, Geoapify must never override it.
  it('never overrides a non-null OSM baby-change value with Geoapify', () => {
    const osm = facts({ baby_change_available: v(true, 'explicit') });
    const geo = facts({ baby_change_available: v(false, 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.baby_change_available).toBe(true);
    expect(r.conflicts[0]).toMatchObject({ accessibility_sensitive: true });
  });

  // Filling a genuine gap (OSM null) is still allowed — even a downgrade to 'no'.
  it('fills an OSM-null accessibility field from Geoapify (gap fill allowed)', () => {
    const osm = facts(); // wheelchair null
    const geo = facts({ wheelchair_accessible: v('yes', 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.wheelchair_accessible).toBe('yes');
    expect(r.field_sources.wheelchair_accessible).toBe('geoapify_explicit');
    expect(r.applied_fields).toContain('wheelchair_accessible');
    expect(r.conflicts).toHaveLength(0);
  });

  it('allows an OSM-null → Geoapify "no" downgrade with no conflict', () => {
    const osm = facts();
    const geo = facts({ wheelchair_accessible: v('no', 'explicit') });
    const r = mergeAnnotatedFacts(osm, geo);
    expect(r.facts.wheelchair_accessible).toBe('no');
    expect(r.conflicts).toHaveLength(0);
  });
});

// =============================================================================
// mergeAnnotatedFacts — sources array
// =============================================================================
describe('mergeAnnotatedFacts — sources', () => {
  it('lists only osm_archive when Geoapify contributed nothing', () => {
    const osm = facts({ parking_available: v(true, 'explicit') });
    const r = mergeAnnotatedFacts(osm, facts());
    expect(r.sources).toEqual(['osm_archive']);
  });

  it('adds geoapify when at least one field came from Geoapify', () => {
    const r = mergeAnnotatedFacts(facts(), facts({ toilets_available: v(true, 'explicit') }));
    expect(r.sources).toEqual(['osm_archive', 'geoapify']);
  });
});

// =============================================================================
// emptyAnnotatedFacts
// =============================================================================
describe('emptyAnnotatedFacts', () => {
  it('returns an all-null annotated set', () => {
    const e = emptyAnnotatedFacts();
    for (const key of Object.keys(e) as (keyof typeof e)[]) {
      expect(e[key]).toEqual({ value: null, provenance: null });
    }
  });

  // Without this: a shared reference could let one venue's merge mutate another's.
  it('returns independent objects per call (no shared references)', () => {
    const a = emptyAnnotatedFacts();
    const b = emptyAnnotatedFacts();
    expect(a.toilets_available).not.toBe(b.toilets_available);
  });
});

// =============================================================================
// Integration: real OSM tags ⊕ real Geoapify fixture
// =============================================================================
describe('integration — annotateOsmFacts ⊕ extractGeoapifyAnnotatedFacts', () => {
  // A sparsely-tagged OSM venue (only knows it's a farm-ish park) enriched by the
  // Willows Place Details fixture. Proves the end-to-end gap-fill we want from 2B.
  it('fills missing OSM facts from the Geoapify Willows fixture', () => {
    const osm = annotateOsmFacts({ leisure: 'park' }); // outdoor (inferred) only
    const geoProps = firstProperties(
      (willows as unknown as GeoapifyRawBundle).place_details,
    ) as GeoapifyFeatureProperties;
    const geo = extractGeoapifyAnnotatedFacts(geoProps);

    const r = mergeAnnotatedFacts(osm, geo);

    // Gaps filled by Geoapify:
    expect(r.facts.toilets_available).toBe(true);
    expect(r.facts.cafe_available).toBe(true);
    expect(r.facts.parking_available).toBe(true);
    expect(r.facts.wheelchair_accessible).toBe('yes');
    expect(r.applied_fields).toEqual(
      expect.arrayContaining(['toilets_available', 'cafe_available', 'parking_available', 'wheelchair_accessible']),
    );

    // OSM inferred 'outdoor' agrees with Geoapify's inferred 'outdoor' → kept as OSM.
    expect(r.facts.indoor_outdoor).toBe('outdoor');
    expect(r.field_sources.indoor_outdoor).toBe('osm_inferred');

    expect(r.sources).toEqual(['osm_archive', 'geoapify']);
  });
});
