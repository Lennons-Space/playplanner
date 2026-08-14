// =============================================================================
// scripts/enrich/discovery/__tests__/dedupe.test.ts
//
// Regression tests for the candidate-venue dedup scorer (Enrichment 2.0
// Part 7). This exact scenario list is mandated by the spec: a wrong verdict
// here either floods the discovery pipeline with duplicate venues (false
// 'distinct') or silently merges two genuinely different venues (false
// 'duplicate') — both are user-facing data-integrity failures.
//
// No network, deterministic coordinates only.
// =============================================================================

import { dedupeAgainstExisting } from '../dedupe';
import type { DedupeCandidate, DedupeExistingVenue } from '../../../../types/enrichmentAutonomy';

const BASE_LAT = 52.7;
const BASE_LON = -2.75;

/** Offset the base coordinate northward by roughly `metres`. */
function offset(metres: number): { latitude: number; longitude: number } {
  return { latitude: BASE_LAT + metres / 111_320, longitude: BASE_LON };
}

function candidate(overrides: Partial<DedupeCandidate>): DedupeCandidate {
  return {
    name: 'Willows Farm',
    latitude: BASE_LAT,
    longitude: BASE_LON,
    postcode: 'SY4 1AA',
    phone: null,
    websiteDomain: null,
    category: null,
    ...overrides,
  };
}

function existing(overrides: Partial<DedupeExistingVenue>): DedupeExistingVenue {
  return {
    id: 'venue-1',
    name: 'Willows Farm',
    latitude: BASE_LAT,
    longitude: BASE_LON,
    postcode: 'SY4 1AA',
    phone: null,
    websiteDomain: null,
    category: null,
    ...overrides,
  };
}

describe('dedupeAgainstExisting — Part 7 regression matrix', () => {
  it('1. same venue, formatting difference -> duplicate', () => {
    const c = candidate({ name: 'Willows Farm' });
    const e = existing({ name: 'The Willows Farm Ltd', ...offset(20) });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).toBe('duplicate');
    expect(r.matchedVenueId).toBe(e.id);
  });

  it('2. same chain, different branch, miles apart -> NOT duplicate', () => {
    const c = candidate({ name: 'Jump Inc Manchester', ...offset(5000), postcode: 'M1 1AA', websiteDomain: 'jumpinc.co.uk' });
    const e = existing({ name: 'Jump Inc Leeds', postcode: 'LS1 1AA', websiteDomain: 'jumpinc.co.uk' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).not.toBe('duplicate');
  });

  it('3. same postcode, genuinely different venue -> possible_duplicate (quarantine, not auto-merge)', () => {
    const c = candidate({ name: 'Tiny Toes Nursery', ...offset(150) });
    const e = existing({ name: 'Bounce Arena' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).toBe('possible_duplicate');
  });

  it('4. renamed venue at the same location -> duplicate despite an unrelated name', () => {
    const c = candidate({ name: 'Adventure Zone', ...offset(10) });
    const e = existing({ name: 'Jungle Gym Play Centre' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).toBe('duplicate');
  });

  it('5. near-identical names several miles apart -> distinct', () => {
    const c = candidate({ name: 'Willows Activity Farm', ...offset(8000), postcode: 'AB1 2CD' });
    const e = existing({ name: 'Willows Activity Farm', postcode: 'XY9 8ZZ' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).toBe('distinct');
  });

  it('6. same official domain, branch-specific pages, different location -> NOT duplicate', () => {
    const c = candidate({
      name: 'SoftPlay World Bristol',
      ...offset(6000),
      postcode: 'BS1 1AA',
      websiteDomain: 'softplayworld.co.uk',
    });
    const e = existing({ name: 'SoftPlay World Cardiff', postcode: 'CF1 1AA', websiteDomain: 'softplayworld.co.uk' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).not.toBe('duplicate');
  });

  it('7. OSM+Geoapify duplicate of an existing venue -> duplicate', () => {
    const c = candidate({ name: 'Willows Farm', ...offset(15), phone: '01743 850066' });
    const e = existing({ name: 'Willows Farm', phone: '01743850066' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).toBe('duplicate');
  });
});

describe('dedupeAgainstExisting — general behaviour', () => {
  it('never merges solely on name similarity without ANY corroborating signal or location match', () => {
    const c = candidate({ name: 'Willows Farm', ...offset(9000), postcode: null });
    const e = existing({ name: 'Willows Farm', postcode: null });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).not.toBe('duplicate');
  });

  it('an exact phone match alone is strong enough to merge regardless of distance', () => {
    const c = candidate({ name: 'Totally Different Name', ...offset(20000), phone: '01743850066' });
    const e = existing({ name: 'Original Name', phone: '01743850066' });
    const r = dedupeAgainstExisting(c, [e]);
    expect(r.decision).toBe('duplicate');
  });

  it('returns distinct with no reasons crash when there are no existing venues to compare', () => {
    const r = dedupeAgainstExisting(candidate({}), []);
    expect(r.decision).toBe('distinct');
    expect(r.matchedVenueId).toBeNull();
  });

  it('picks the best-scoring match among several candidates', () => {
    const c = candidate({ name: 'Willows Farm', ...offset(10) });
    const far = existing({ id: 'far', name: 'Willows Farm', ...offset(9000) });
    const near = existing({ id: 'near', name: 'Willows Farm', ...offset(15) });
    const r = dedupeAgainstExisting(c, [far, near]);
    expect(r.matchedVenueId).toBe('near');
  });
});
