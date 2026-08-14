import {
  discoverFromElements,
  evaluateElement,
  scoreDiscoveryCandidate,
  type RawOsmElement,
} from '../discoverCandidates';
import type { DedupeExistingVenue } from '../../../../types/enrichmentAutonomy';

const NO_EXISTING: DedupeExistingVenue[] = [];

function zooElement(overrides: Partial<RawOsmElement['tags']> = {}): RawOsmElement {
  return {
    type: 'node',
    id: 111,
    lat: 52.6,
    lon: -1.6,
    tags: {
      name: 'Twycross Zoo',
      tourism: 'zoo',
      'addr:postcode': 'CV9 3PX',
      phone: '01827880250',
      website: 'https://twycrosszoo.org',
      ...overrides,
    },
  };
}

describe('evaluateElement', () => {
  it('skips elements with no name', () => {
    const r = evaluateElement({ type: 'node', id: 1, lat: 52, lon: -1, tags: { tourism: 'zoo' } }, { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('skipped_no_name');
  });

  it('skips structural artifacts (mine shafts etc.)', () => {
    const r = evaluateElement({ type: 'node', id: 2, lat: 52, lon: -1, tags: { name: 'Chimney', tourism: 'zoo' } }, { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('skipped_artifact');
  });

  it('skips elements with no coordinates', () => {
    const r = evaluateElement({ type: 'node', id: 3, tags: { name: 'Somewhere', tourism: 'zoo' } }, { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('skipped_no_coords');
  });

  it('skips elements outside UK territory', () => {
    const r = evaluateElement({ type: 'node', id: 4, lat: 48.8, lon: 2.3, tags: { name: 'Paris Zoo', tourism: 'zoo' } }, { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('skipped_outside_uk');
  });

  it('skips irrelevant POIs (not blindly importing everything)', () => {
    const r = evaluateElement({ type: 'node', id: 5, lat: 52, lon: -1, tags: { name: 'Shell Garage', amenity: 'fuel' } }, { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('skipped_irrelevant_category');
  });

  it('produces a candidate for a structurally-tagged zoo with high confidence', () => {
    const r = evaluateElement(zooElement(), { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('candidate');
    expect(r.categorySlug).toBe('animal-attraction');
    expect(r.categoryMatchKind).toBe('structural');
    expect(r.acceptResult?.decision).toBe('auto_accept');
  });

  it('produces a candidate for a name-hint-only farm park, never auto-accepted', () => {
    const el: RawOsmElement = {
      type: 'node', id: 6, lat: 52.1, lon: -1.2,
      tags: { name: "Sunnyvale Children's Farm", 'addr:postcode': 'B1 1AA', phone: '0121', website: 'https://sunnyvale.example' },
    };
    const r = evaluateElement(el, { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('candidate');
    expect(r.categoryMatchKind).toBe('name_hint');
    expect(r.acceptResult?.decision).not.toBe('auto_accept');
  });

  it('flags an exact duplicate against an existing venue with a matching phone number', () => {
    const existing: DedupeExistingVenue[] = [{
      id: 'venue-1', name: 'Twycross Zoo', latitude: 52.6, longitude: -1.6,
      postcode: 'CV9 3PX', phone: '01827880250', websiteDomain: 'twycrosszoo.org', category: 'animal-attraction',
    }];
    const r = evaluateElement(zooElement(), { existingVenues: existing });
    expect(r.dedupe?.decision).toBe('duplicate');
    expect(r.acceptResult?.decision).toBe('reject');
  });

  it('confidence score never exceeds 100 and rewards structural + complete data', () => {
    const structuralComplete = scoreDiscoveryCandidate(
      { name: 'x', latitude: 0, longitude: 0, postcode: 'X', phone: 'X', websiteDomain: 'x.com', category: 'y' },
      'structural',
    );
    expect(structuralComplete).toBe(100);
    const nameHintBare = scoreDiscoveryCandidate(
      { name: 'x', latitude: 0, longitude: 0, postcode: null, phone: null, websiteDomain: null, category: 'y' },
      'name_hint',
    );
    expect(nameHintBare).toBe(50);
  });
});

describe('discoverFromElements', () => {
  function* elements(): Generator<RawOsmElement> {
    yield zooElement();
    yield { type: 'node', id: 999, lat: 52, lon: -1, tags: { name: 'Shell Garage', amenity: 'fuel' } };
    yield { type: 'node', id: 1000, lat: 52, lon: -1 }; // no tags at all -> skipped_no_name, not an error
  }

  it('dry run (write=false) never calls upsertCandidate', async () => {
    const upsert = jest.fn();
    const counts = await discoverFromElements(elements(), { existingVenues: NO_EXISTING, write: false, apply: false, upsertCandidate: upsert });
    expect(upsert).not.toHaveBeenCalled();
    expect(counts.candidatesEvaluated).toBe(1);
    expect(counts.skippedIrrelevantCategory).toBe(1);
    expect(counts.elementsScanned).toBe(3);
  });

  it('write mode calls upsertCandidate for a non-duplicate candidate', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'cand-1' });
    const counts = await discoverFromElements([zooElement()], { existingVenues: NO_EXISTING, write: true, apply: false, upsertCandidate: upsert });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(counts.autoAccepted).toBe(1);
  });

  it('apply mode calls autoAcceptCandidate only for auto_accept decisions', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'cand-2' });
    const autoAccept = jest.fn().mockResolvedValue(undefined);
    await discoverFromElements([zooElement()], {
      existingVenues: NO_EXISTING, write: true, apply: true, upsertCandidate: upsert, autoAcceptCandidate: autoAccept,
    });
    expect(autoAccept).toHaveBeenCalledWith('cand-2');
  });

  it('apply mode does NOT call autoAcceptCandidate for a quarantined candidate', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'cand-3' });
    const autoAccept = jest.fn().mockResolvedValue(undefined);
    const nameHintOnly: RawOsmElement = {
      type: 'node', id: 7, lat: 52.1, lon: -1.2, tags: { name: "Little Farm Park" },
    };
    await discoverFromElements([nameHintOnly], {
      existingVenues: NO_EXISTING, write: true, apply: true, upsertCandidate: upsert, autoAcceptCandidate: autoAccept,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(autoAccept).not.toHaveBeenCalled();
  });

  it('never upserts an exact duplicate', async () => {
    const existing: DedupeExistingVenue[] = [{
      id: 'venue-1', name: 'Twycross Zoo', latitude: 52.6, longitude: -1.6,
      postcode: 'CV9 3PX', phone: '01827880250', websiteDomain: 'twycrosszoo.org', category: 'animal-attraction',
    }];
    const upsert = jest.fn();
    const counts = await discoverFromElements([zooElement()], { existingVenues: existing, write: true, apply: false, upsertCandidate: upsert });
    expect(upsert).not.toHaveBeenCalled();
    expect(counts.exactDuplicatesSkipped).toBe(1);
  });

  it('respects the limit and stops evaluating further elements', async () => {
    function* many(): Generator<RawOsmElement> {
      for (let i = 0; i < 5; i++) yield zooElement({ name: `Zoo ${i}` });
    }
    const counts = await discoverFromElements(many(), { existingVenues: NO_EXISTING, write: false, apply: false, limit: 2 });
    expect(counts.candidatesEvaluated).toBe(2);
  });

  it('one bad element does not abort the whole run', async () => {
    const upsert = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ id: 'ok' });
    const counts = await discoverFromElements(
      [zooElement({ name: 'Zoo A' }), zooElement({ name: 'Zoo B' })],
      { existingVenues: NO_EXISTING, write: true, apply: false, upsertCandidate: upsert },
    );
    expect(counts.errors).toBe(1);
    expect(counts.candidatesEvaluated).toBe(2);
  });
});
