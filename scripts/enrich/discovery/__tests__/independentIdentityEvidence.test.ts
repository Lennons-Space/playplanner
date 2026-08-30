// =============================================================================
// scripts/enrich/discovery/__tests__/independentIdentityEvidence.test.ts
//
// The trust proof for NEW-VENUE creation (Enrichment 2.1 hardening).
//
// Fixtures A-F are the exact scenarios required by the hardening brief. They
// are deliberately written as end-to-end runs through discoverFromCandidates
// (not unit calls to the gate) so they prove the POLICY holds in the real
// pipeline, not merely that a pure function returns the right enum.
//
// NO network, NO Geoapify API calls, NO credits consumed — every provider
// record here is a local fixture object.
// =============================================================================

import { discoverFromCandidates } from '../discoverCandidates';
import {
  buildCrossSourceAgreement,
  computeIdentityEvidence,
  MIN_INDEPENDENT_IDENTITY_EVIDENCE,
} from '../identityEvidence';
import { areSourcesIndependent } from '../../sourceTrust';
import type { NormalizedCandidate } from '../providers/types';
import type { DedupeExistingVenue } from '../../../../types/enrichmentAutonomy';

const NO_EXISTING: DedupeExistingVenue[] = [];
const lookupNone = async (): Promise<DedupeExistingVenue[]> => [];

/** A deliberately PERFECT OSM record: structural category + postcode + phone + website = score 100. */
function completeOsmRecord(over: Partial<NormalizedCandidate> = {}): NormalizedCandidate {
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
    ...over,
  };
}

async function run(candidates: NormalizedCandidate[], corroboration?: string) {
  const decisions: { source: string; decision: string; reason: string; evidence: number; sources: string[] }[] = [];
  const counts = await discoverFromCandidates(candidates, {
    existingVenues: NO_EXISTING,
    lookupNearby: lookupNone,
    corroborate: corroboration
      ? async () => ({ status: corroboration as 'VERIFIED_SAME_VENUE' })
      : undefined,
    write: true,
    apply: false,
    upsertCandidate: async (row) => {
      decisions.push({
        source: row.source,
        decision: row.acceptResult.decision,
        reason: row.acceptResult.reason,
        evidence: row.acceptInput.independentIdentityEvidenceCount,
        sources: row.acceptInput.identityEvidenceSources ?? [],
      });
      return { id: `cand-${row.sourceId}` };
    },
  });
  return { counts, decisions };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Candidate A — complete OSM record, no official corroboration', () => {
  it('QUARANTINES despite a perfect score of 100', async () => {
    const { counts, decisions } = await run([completeOsmRecord()]);

    expect(counts.autoAccepted).toBe(0);
    expect(counts.quarantined).toBe(1);

    const d = decisions[0]!;
    // The score really is maxed out — this is the whole point of the fixture.
    expect(d.evidence).toBe(1);
    expect(d.sources).toEqual(['osm']);
    expect(d.reason).toMatch(/only 1 independent identity source/);
    expect(d.reason).toMatch(/numeric confidence never substitutes/);
  });

  it('confirms the score really is 100, so the quarantine is caused by evidence and nothing else', async () => {
    const scores: number[] = [];
    await discoverFromCandidates([completeOsmRecord()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupNone,
      write: true,
      apply: false,
      upsertCandidate: async (row) => {
        scores.push(row.acceptInput.confidenceScore);
        return { id: 'x' };
      },
    });
    expect(scores).toEqual([100]);
  });

  it('never calls the auto-accept RPC for a single-source candidate', async () => {
    const queueCandidateForReview = jest.fn();
    await discoverFromCandidates([completeOsmRecord()], {
      existingVenues: NO_EXISTING,
      lookupNearby: lookupNone,
      write: true,
      apply: true,
      upsertCandidate: async () => ({ id: 'cand-1' }),
      queueCandidateForReview,
    });
    expect(queueCandidateForReview).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Candidate B — OSM + VERIFIED official site', () => {
  it('is eligible for AUTO_ACCEPT', async () => {
    const { counts, decisions } = await run([completeOsmRecord()], 'VERIFIED_SAME_VENUE');

    expect(counts.autoAccepted).toBe(1);
    expect(counts.quarantined).toBe(0);
    expect(decisions[0]!.evidence).toBe(2);
    expect(decisions[0]!.sources).toEqual(['osm', 'official_website']);
  });

  it('does NOT auto-accept on a merely PROBABLE or AMBIGUOUS corroboration', async () => {
    for (const status of ['PROBABLE', 'AMBIGUOUS', 'MISMATCH', 'UNAVAILABLE']) {
      const { counts } = await run([completeOsmRecord()], status);
      expect([status, counts.autoAccepted]).toEqual([status, 0]);
      expect([status, counts.quarantined]).toEqual([status, 1]);
    }
  });

  it('counts one website as ONE witness however many of its pages agreed', () => {
    // officialVerification is a single boolean by design — there is no code
    // path that can turn N agreeing pages of one domain into N witnesses.
    const evidence = computeIdentityEvidence({ source: 'osm', officialVerification: true });
    expect(evidence.count).toBe(2);
    expect(evidence.sources).toEqual(['osm', 'official_website']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Candidate C — OSM + a second genuinely independent trusted source', () => {
  // A venue whose category BOTH sources can resolve: OSM structurally
  // (leisure=park), and a non-OSM source by name hint ('country park').
  // 'operator_announcement' is a real SourceId in sourceTrust.ts and is NOT
  // derived from OSM, so it is a legitimate independent witness.
  const osmPark = (): NormalizedCandidate => ({
    ...completeOsmRecord(),
    sourceId: 'node/900',
    name: 'Riverside Country Park',
    categoryEvidence: { name: 'Riverside Country Park', leisure: 'park' },
  });
  const independentRecord = (): NormalizedCandidate => ({
    ...osmPark(),
    source: 'operator_announcement',
    sourceId: 'announcement/2026-08-01',
    attribution: { licence: 'n/a', sourceName: 'Operator announcement' },
  });

  it('counts as 2 independent sources and is eligible for AUTO_ACCEPT', async () => {
    const { counts, decisions } = await run([osmPark(), independentRecord()]);

    const osmDecision = decisions.find((d) => d.source === 'osm')!;
    expect(osmDecision.evidence).toBe(2);
    expect(osmDecision.sources).toEqual(['osm', 'operator_announcement']);
    expect(osmDecision.decision).toBe('auto_accept');
    expect(counts.bySource.osm?.autoAccepted).toBe(1);
  });

  it('still quarantines the partner record itself, because a name-hint-only category match is never a trusted source', async () => {
    // Worth pinning: independent corroboration raises the EVIDENCE count, it
    // does not waive any other gate. The announcement record resolves its
    // category only by name hint, so it stays untrusted and quarantines even
    // though it too has 2 independent witnesses.
    const { counts, decisions } = await run([osmPark(), independentRecord()]);
    const partner = decisions.find((d) => d.source === 'operator_announcement')!;
    expect(partner.evidence).toBe(2);
    expect(partner.decision).toBe('quarantine');
    expect(partner.reason).toMatch(/below the trusted tier/);
    expect(counts.autoAccepted).toBe(1);
    expect(counts.quarantined).toBe(1);
  });

  it('does not corroborate when the two records are NOT the same venue', async () => {
    const elsewhere: NormalizedCandidate = {
      ...independentRecord(),
      name: 'Northside Country Park',
      latitude: 54.9,
      longitude: -1.6,
      postcode: 'NE1 1AA',
      phone: '01910000000',
      website: 'https://different.example',
    };
    const { counts } = await run([osmPark(), elsewhere]);
    expect(counts.autoAccepted).toBe(0);
    expect(counts.quarantined).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Candidate D — records derived from the same upstream source', () => {
  it('treats OSM + Geoapify as ONE witness, because Geoapify is OSM-derived', async () => {
    const geoapifyMirror: NormalizedCandidate = {
      ...completeOsmRecord(),
      source: 'geoapify',
      sourceId: 'place-abc-123',
      categoryEvidence: { categories: ['entertainment.zoo'] },
      attribution: { licence: 'ODbL-1.0', sourceName: 'OpenStreetMap contributors (via Geoapify)' },
    };
    const { counts, decisions } = await run([completeOsmRecord(), geoapifyMirror]);

    // This is the "do not fake independence" rule doing its job.
    expect(counts.autoAccepted).toBe(0);
    expect(counts.quarantined).toBe(2);
    for (const d of decisions) expect(d.evidence).toBe(1);
  });

  it('treats two records from the SAME source as one witness', async () => {
    // e.g. a venue mapped in OSM as both a node and a way.
    const secondOsmRow = { ...completeOsmRecord(), sourceId: 'way/222' };
    const { counts } = await run([completeOsmRecord(), secondOsmRow]);
    expect(counts.autoAccepted).toBe(0);
  });

  it('states the derivation rule directly', () => {
    expect(areSourcesIndependent('osm', 'geoapify')).toBe(false);
    expect(areSourcesIndependent('geoapify', 'osm')).toBe(false);
    expect(areSourcesIndependent('osm', 'osm')).toBe(false);
    expect(areSourcesIndependent('osm', 'official_website')).toBe(true);
    expect(areSourcesIndependent('geoapify', 'official_website')).toBe(true);
  });

  it('never counts a mirror even when it is added alongside a real second witness', () => {
    // osm + geoapify(mirror of osm) + official_website => 2, not 3.
    const evidence = computeIdentityEvidence({
      source: 'osm',
      officialVerification: true,
      agreeingSources: new Set(['geoapify'] as const),
    });
    expect(evidence.count).toBe(2);
    expect(evidence.sources).toEqual(['osm', 'official_website']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Candidate E — strong but ambiguous branch identity', () => {
  it('QUARANTINES a candidate whose identity matches an existing venue only ambiguously', async () => {
    // A same-name branch ~200m away: inside the 300m dedupe gate but with no
    // corroborating postcode/phone/domain, so dedupe can only say "possible".
    const nearbyBranch = async (): Promise<DedupeExistingVenue[]> => [{
      id: 'existing-1',
      name: 'Twycross Zoo',
      latitude: 52.6018,
      longitude: -1.6,
      postcode: null,
      phone: null,
      websiteDomain: null,
      category: 'animal-attraction',
    }];

    const decisions: string[] = [];
    const counts = await discoverFromCandidates([completeOsmRecord()], {
      existingVenues: NO_EXISTING,
      lookupNearby: nearbyBranch,
      corroborate: async () => ({ status: 'VERIFIED_SAME_VENUE' }),
      write: true,
      apply: false,
      upsertCandidate: async (row) => {
        decisions.push(row.acceptResult.reason);
        return { id: 'x' };
      },
    });

    // Ambiguous identity quarantines even WITH official corroboration —
    // corroboration proves the venue exists, not that it is a different venue
    // from the one already published.
    expect(counts.autoAccepted).toBe(0);
    expect(counts.possibleDuplicatesQuarantined).toBe(1);
    expect(decisions[0]).toMatch(/ambiguous duplicate/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the independence requirement is scoped to NEW venues only', () => {
  it('exposes a single documented threshold rather than scattered literals', () => {
    expect(MIN_INDEPENDENT_IDENTITY_EVIDENCE).toBe(2);
  });

  it('cross-source agreement only ever records DUPLICATE-strength matches', () => {
    const a = completeOsmRecord();
    // Same name, ~200m away, no other matching signal => 'possible_duplicate',
    // which must NOT be recorded as confirmed identity agreement.
    const b: NormalizedCandidate = {
      ...completeOsmRecord(),
      source: 'operator_announcement',
      sourceId: 'announcement/1',
      latitude: 52.6018,
      postcode: null,
      phone: null,
      website: null,
    };
    const agreement = buildCrossSourceAgreement([a, b]);
    expect(agreement.get('osm/node/111')!.size).toBe(0);
  });
});
