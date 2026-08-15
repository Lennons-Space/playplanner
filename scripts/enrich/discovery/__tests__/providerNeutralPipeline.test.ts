// =============================================================================
// scripts/enrich/discovery/__tests__/providerNeutralPipeline.test.ts
//
// Enrichment 2.1 review fix: proves that BOTH provider shapes reach a real
// decision through the SAME downstream pipeline, rather than one of them being
// counted at fetch time and dropped before evaluation (which is exactly what
// the first 2.1 pass did to Geoapify).
//
// The chain asserted here per source:
//   NormalizedCandidate -> precheck/normalize -> spatial dedupe (injected
//   lookup) -> detailed dedupe -> official corroboration -> one of
//   MERGE_EXISTING / AUTO_ACCEPT / QUARANTINE / REJECT -> persisted row.
// =============================================================================

import {
  discoverFromCandidates,
  evaluateCandidate,
  evaluateCandidateWithLookup,
  evaluateElement,
} from '../discoverCandidates';
import { normalizeElement } from '../providers/osmArchiveProvider';
import type { NormalizedCandidate } from '../providers/types';
import type { DedupeExistingVenue } from '../../../../types/enrichmentAutonomy';

const NO_EXISTING: DedupeExistingVenue[] = [];

function osmCandidate(overrides: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
  return {
    source: 'osm',
    sourceId: 'node/111',
    sourceTier: 2,
    name: 'Twycross Zoo',
    latitude: 52.6,
    longitude: -1.6,
    categoryEvidence: { name: 'Twycross Zoo', tourism: 'zoo' },
    addressLine1: '1 Zoo Lane',
    postcode: 'CV9 3PX',
    city: 'Atherstone',
    phone: '01827880250',
    website: 'https://twycrosszoo.org',
    openingHoursRaw: null,
    retrievedAt: '2026-08-15T00:00:00.000Z',
    attribution: { licence: 'ODbL-1.0', sourceName: 'OpenStreetMap contributors' },
    raw: {},
    ...overrides,
  };
}

function geoapifyCandidate(overrides: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
  return {
    source: 'geoapify',
    sourceId: 'place-abc-123',
    sourceTier: 2,
    name: 'Sealife Aquarium',
    latitude: 53.8,
    longitude: -1.55,
    // Geoapify's OWN taxonomy — deliberately not OSM tags. If the pipeline
    // could only read OSM tags, this candidate would silently fall out as
    // "irrelevant category".
    categoryEvidence: { categories: ['entertainment.aquarium'] },
    addressLine1: '2 Dock Street',
    postcode: 'LS10 1AA',
    city: 'Leeds',
    phone: '01130000000',
    website: 'https://sealife.example',
    openingHoursRaw: null,
    retrievedAt: '2026-08-15T00:00:00.000Z',
    attribution: { licence: 'ODbL-1.0', sourceName: 'OpenStreetMap contributors (via Geoapify)' },
    raw: {},
    ...overrides,
  };
}

describe('evaluateCandidate — provider-neutral category resolution', () => {
  it('resolves an OSM candidate structurally from its tag evidence', () => {
    const r = evaluateCandidate(osmCandidate(), { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('candidate');
    expect(r.categoryMatchKind).toBe('structural');
    expect(r.source).toBe('osm');
  });

  it('resolves a GEOAPIFY candidate structurally from its own category taxonomy', () => {
    const r = evaluateCandidate(geoapifyCandidate(), { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('candidate');
    expect(r.categorySlug).toBe('animal-attraction');
    expect(r.categoryMatchKind).toBe('structural');
    expect(r.source).toBe('geoapify');
  });

  it('carries the candidate’s own source through — never a hardcoded one', () => {
    expect(evaluateCandidate(geoapifyCandidate(), { existingVenues: NO_EXISTING }).source).toBe('geoapify');
    expect(evaluateCandidate(osmCandidate(), { existingVenues: NO_EXISTING }).source).toBe('osm');
  });

  it('reports the source even on a skip outcome, so skips are attributable too', () => {
    const r = evaluateCandidate(geoapifyCandidate({ name: '   ' }), { existingVenues: NO_EXISTING });
    expect(r.outcome).toBe('skipped_no_name');
    expect(r.source).toBe('geoapify');
  });

  it('falls back to name-hint matching for a source with no structural resolver, and that can never be trusted enough to auto-accept', () => {
    const r = evaluateCandidate(
      // 'operator_announcement' has no structural branch — fails SAFE.
      osmCandidate({ source: 'operator_announcement', name: 'Riverside Country Park', categoryEvidence: {} }),
      { existingVenues: NO_EXISTING },
    );
    expect(r.outcome).toBe('candidate');
    expect(r.categoryMatchKind).toBe('name_hint');
    expect(r.acceptInput?.isTrustedSource).toBe(false);
    expect(r.acceptResult?.decision).toBe('quarantine');
  });
});

describe('evaluateCandidateWithLookup — spatial prefilter path', () => {
  it('only consults the spatial lookup after the free precheck passes', async () => {
    const lookup = jest.fn().mockResolvedValue([]);
    await evaluateCandidateWithLookup(geoapifyCandidate({ name: '' }), lookup);
    expect(lookup).not.toHaveBeenCalled();

    await evaluateCandidateWithLookup(geoapifyCandidate(), lookup);
    expect(lookup).toHaveBeenCalledWith(53.8, -1.55);
  });

  it('routes an exact spatial duplicate to MERGE_EXISTING, not to a second venue row', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { id: 'existing-1', name: 'Sealife Aquarium', latitude: 53.8, longitude: -1.55, postcode: 'LS10 1AA', phone: '01130000000', websiteDomain: 'sealife.example', category: 'animal-attraction' },
    ] satisfies DedupeExistingVenue[]);

    const r = await evaluateCandidateWithLookup(geoapifyCandidate(), lookup);
    expect(r.dedupe?.decision).toBe('duplicate');
    expect(r.acceptResult?.decision).toBe('merge_existing');
  });
});

describe('discoverFromCandidates — one pipeline, both sources', () => {
  const lookupNone = async (): Promise<DedupeExistingVenue[]> => [];

  it('evaluates OSM and Geoapify candidates in a single mixed stream and decides both', async () => {
    const upserted: { source: string; sourceId: string; website: string | null; city: string | null }[] = [];
    const counts = await discoverFromCandidates([osmCandidate(), geoapifyCandidate()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupNone,
      write: true,
      apply: false,
      upsertCandidate: async (row) => {
        upserted.push({ source: row.source, sourceId: row.sourceId, website: row.websiteUrl, city: row.city });
        return { id: `cand-${row.sourceId}` };
      },
    });

    expect(counts.candidatesEvaluated).toBe(2);
    // The core regression guard: Geoapify is not merely counted at fetch time.
    expect(counts.bySource.geoapify?.candidatesEvaluated).toBe(1);
    expect(counts.bySource.osm?.candidatesEvaluated).toBe(1);

    // Each row is attributed to its OWN source (a hardcoded 'osm' would both
    // mis-label this and collide on the (source, source_id) unique key).
    expect(upserted.map((u) => u.source).sort()).toEqual(['geoapify', 'osm']);
    // ...and real website/city values are persisted, not dropped to null.
    expect(upserted.find((u) => u.source === 'geoapify')?.website).toBe('https://sealife.example');
    expect(upserted.find((u) => u.source === 'geoapify')?.city).toBe('Leeds');
  });

  // A Geoapify candidate with no phone scores 90 — below the strict 98
  // new-venue bar — so it is exactly the "phone must not be mandatory when
  // the rest of the identity bundle is strong" case corroboration exists for.
  const noPhone = () => geoapifyCandidate({ phone: null });

  it('runs official corroboration for a Geoapify candidate, letting a phone-less one reach auto-accept', async () => {
    const corroborate = jest.fn().mockResolvedValue({ status: 'VERIFIED_SAME_VENUE' });
    const counts = await discoverFromCandidates([noPhone()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupNone,
      corroborate,
      write: false,
      apply: false,
    });

    expect(corroborate).toHaveBeenCalledWith('https://sealife.example', expect.objectContaining({ name: 'Sealife Aquarium', city: 'Leeds' }));
    expect(counts.bySource.geoapify?.autoAccepted).toBe(1);
  });

  it('leaves that same candidate in quarantine when corroboration is ambiguous', async () => {
    const counts = await discoverFromCandidates([noPhone()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupNone,
      corroborate: async () => ({ status: 'AMBIGUOUS' }),
      write: false,
      apply: false,
    });
    expect(counts.bySource.geoapify?.quarantined).toBe(1);
    expect(counts.autoAccepted).toBe(0);
  });

  it('counts a merge_existing per source without double-counting it as a rejection', async () => {
    const lookupDup = async (): Promise<DedupeExistingVenue[]> => [
      { id: 'existing-1', name: 'Sealife Aquarium', latitude: 53.8, longitude: -1.55, postcode: 'LS10 1AA', phone: '01130000000', websiteDomain: 'sealife.example', category: 'animal-attraction' },
    ];
    const upsertCandidate = jest.fn();
    const counts = await discoverFromCandidates([geoapifyCandidate()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupDup,
      write: true,
      apply: true,
      upsertCandidate,
    });

    expect(counts.bySource.geoapify?.mergeExisting).toBe(1);
    expect(counts.bySource.geoapify?.rejectedWeak).toBe(0);
    expect(counts.exactDuplicatesSkipped).toBe(1);
    // An exact duplicate is never written as a new candidate row.
    expect(upsertCandidate).not.toHaveBeenCalled();
  });

  it('makes zero writes when write=false, however many candidates are evaluated', async () => {
    const upsertCandidate = jest.fn();
    const autoAcceptCandidate = jest.fn();
    const counts = await discoverFromCandidates([osmCandidate(), geoapifyCandidate()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupNone,
      write: false,
      apply: false,
      upsertCandidate,
      autoAcceptCandidate,
    });
    expect(counts.candidatesEvaluated).toBe(2);
    expect(upsertCandidate).not.toHaveBeenCalled();
    expect(autoAcceptCandidate).not.toHaveBeenCalled();
  });
});

// ── Parity guard ─────────────────────────────────────────────────────────────
// There are two OSM mappers: discoverCandidates.ts's raw-element path
// (evaluateElement — the Enrichment 2.0 API, now used by fixtures/tests only)
// and osmArchiveProvider.normalizeElement (the production path, feeding
// discoverFromCandidates). They must not drift apart.
describe('OSM raw-element path and NormalizedCandidate path agree', () => {
  const element = {
    type: 'node', id: 111, lat: 52.6, lon: -1.6,
    tags: {
      name: 'Twycross Zoo', tourism: 'zoo', 'addr:postcode': 'CV9 3PX',
      phone: '01827880250', website: 'https://twycrosszoo.org',
      'addr:housenumber': '1', 'addr:street': 'Zoo Lane', 'addr:city': 'Atherstone',
    },
  };

  it('produces the same decision, category, score and identity fields either way', () => {
    const viaElement = evaluateElement(element, { existingVenues: NO_EXISTING });
    const nc = normalizeElement(element, '2026-08-15T00:00:00.000Z')!;
    const viaCandidate = evaluateCandidate(nc, { existingVenues: NO_EXISTING });

    const shape = (e: typeof viaElement) => ({
      outcome: e.outcome, source: e.source, sourceId: e.sourceId,
      categorySlug: e.categorySlug, categoryMatchKind: e.categoryMatchKind,
      decision: e.acceptResult?.decision, score: e.acceptInput?.confidenceScore,
      candidate: e.candidate, city: e.city, addressLine1: e.addressLine1, websiteUrl: e.websiteUrl,
    });
    expect(shape(viaCandidate)).toEqual(shape(viaElement));
  });

  it('agrees on a rejected element too, not just a happy one', () => {
    const petrol = { type: 'node', id: 5, lat: 52, lon: -1, tags: { name: 'Shell Garage', amenity: 'fuel' } };
    const viaElement = evaluateElement(petrol, { existingVenues: NO_EXISTING });
    const nc = normalizeElement(petrol, '2026-08-15T00:00:00.000Z')!;
    const viaCandidate = evaluateCandidate(nc, { existingVenues: NO_EXISTING });
    expect(viaElement.outcome).toBe('skipped_irrelevant_category');
    expect(viaCandidate.outcome).toBe(viaElement.outcome);
  });
});
