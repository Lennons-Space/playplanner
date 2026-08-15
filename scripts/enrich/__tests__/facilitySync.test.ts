import { decideFacilitySync, FACILITY_SLUGS_VOTE_ELIGIBLE, OFFICIAL_ENRICHMENT_NOTES } from '../facilitySync';
import type { VenueFact } from '../web/venueFacts';

type FacilityFact = Extract<VenueFact, { kind: 'facility' }>;

function positive(slug: FacilityFact['slug'] = 'parking'): FacilityFact {
  return { kind: 'facility', slug, present: true };
}
function negative(slug: FacilityFact['slug'] = 'parking'): FacilityFact {
  return { kind: 'facility', slug, present: false };
}

describe('decideFacilitySync', () => {
  it('publishes a positive fact from a trusted source with no existing row', () => {
    const r = decideFacilitySync(positive(), null, 'osm');
    expect(r.action).toBe('publish');
  });

  it('never overwrites an existing row for a positive fact, regardless of its provenance', () => {
    const r1 = decideFacilitySync(positive(), { notes: 'parent-confirmed' }, 'osm');
    expect(r1.action).toBe('already_present');
    const r2 = decideFacilitySync(positive(), { notes: null }, 'osm');
    expect(r2.action).toBe('already_present');
    const r3 = decideFacilitySync(positive(), { notes: OFFICIAL_ENRICHMENT_NOTES }, 'osm');
    expect(r3.action).toBe('already_present');
  });

  it('publishes for every currently-declared SourceId (all are tier 1-2 today — the untrusted branch is a structural guard for a future lower-tier source, not exercised by any live source yet)', () => {
    for (const source of ['official_website', 'operator_announcement', 'osm', 'geoapify'] as const) {
      expect(decideFacilitySync(positive(), null, source).action).toBe('publish');
    }
  });

  it('takes no action for explicit negative evidence when no row exists yet', () => {
    const r = decideFacilitySync(negative(), null, 'osm');
    expect(r.action).toBe('no_action');
  });

  it('routes a negative fact conflicting with an existing row to exception — never deletes', () => {
    const r = decideFacilitySync(negative(), { notes: 'parent-confirmed' }, 'osm');
    expect(r.action).toBe('exception');
  });

  it('routes a negative fact conflicting with an official-enrichment row to exception too', () => {
    const r = decideFacilitySync(negative(), { notes: OFFICIAL_ENRICHMENT_NOTES }, 'osm');
    expect(r.action).toBe('exception');
  });

  it('routes a negative fact conflicting with an admin row (notes=null) to exception', () => {
    const r = decideFacilitySync(negative(), { notes: null }, 'osm');
    expect(r.action).toBe('exception');
  });

  it('never returns an action that implies deletion — action is always one of the four safe values', () => {
    const allActions = new Set<string>();
    for (const fact of [positive(), negative()]) {
      for (const existing of [null, { notes: 'parent-confirmed' }, { notes: null }, { notes: OFFICIAL_ENRICHMENT_NOTES }]) {
        allActions.add(decideFacilitySync(fact, existing, 'osm').action);
      }
    }
    expect(allActions).toEqual(new Set(['publish', 'already_present', 'no_action', 'exception']));
  });
});

describe('FACILITY_SLUGS_VOTE_ELIGIBLE', () => {
  it('matches migration 050s exact three vote-eligible slugs', () => {
    expect(FACILITY_SLUGS_VOTE_ELIGIBLE).toEqual(new Set(['toilets', 'baby-change', 'parking']));
  });
});
