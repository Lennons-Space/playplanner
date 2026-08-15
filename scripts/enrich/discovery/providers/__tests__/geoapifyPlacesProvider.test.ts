import { createGeoapifyPlacesProvider, isGeoapifyDiscoveryEnabled } from '../geoapifyPlacesProvider';
import type { GeoapifyClient } from '../../../geoapifyClient';
import type { GeoapifyResponse } from '../../../../../types/enrichment';

function fakeClient(response: GeoapifyResponse, credits = 1): GeoapifyClient {
  return {
    placesSearch: jest.fn().mockResolvedValue({ response, raw: response, credits }),
    get credits() { return credits; },
  } as unknown as GeoapifyClient;
}

const UNIT = { boundingBox: { south: 52.0, west: -2.0, north: 52.2, east: -1.8 } };

describe('createGeoapifyPlacesProvider', () => {
  it('returns unavailable when disabled — the safe default', async () => {
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => false, client: fakeClient({ features: [] }) });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.kind).toBe('unavailable');
    expect(result.reason).toMatch(/disabled by default/);
    expect(result.candidates).toHaveLength(0);
  });

  it('requires a bounding box work unit', async () => {
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client: fakeClient({ features: [] }) });
    const result = await provider.fetchCandidates({});
    expect(result.kind).toBe('failed');
    expect(result.reason).toMatch(/bounding box/);
  });

  it('normalizes a successful response into candidates with correct attribution', async () => {
    const response: GeoapifyResponse = {
      features: [{
        properties: {
          place_id: 'pid1', name: 'Test Zoo', lat: 52.1, lon: -1.9, postcode: 'AB1 2CD', city: 'Testville',
          categories: ['entertainment.zoo'], website: 'https://testzoo.example', contact: { phone: '01234' },
        },
      }],
    };
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client: fakeClient(response) });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.kind).toBe('success');
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0]!;
    expect(c.source).toBe('geoapify');
    expect(c.sourceTier).toBe(2); // derived from sourceTrust.ts's canonical tier table, not a local literal
    expect(c.sourceId).toBe('pid1');
    expect(c.attribution.licence).toBe('ODbL-1.0');
    expect(c.attribution.sourceName).toMatch(/Geoapify attribution also required/);
  });

  it('drops features with no mappable category', async () => {
    const response: GeoapifyResponse = {
      features: [{ properties: { place_id: 'pid2', name: 'Random Shop', lat: 52.1, lon: -1.9, categories: ['commercial.supermarket'] } }],
    };
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client: fakeClient(response) });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.candidates).toHaveLength(0);
  });

  it('drops features missing name/coords/place_id', async () => {
    const response: GeoapifyResponse = {
      features: [{ properties: { name: 'No place_id', lat: 52.1, lon: -1.9, categories: ['entertainment.zoo'] } }],
    };
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client: fakeClient(response) });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.candidates).toHaveLength(0);
  });

  it('maps a credit-budget-exhausted error to rate_limited, not failed', async () => {
    const client = {
      placesSearch: jest.fn().mockRejectedValue(new Error('Geoapify credit budget reached (300/300). Aborting to stay within the free tier.')),
      get credits() { return 300; },
    } as unknown as GeoapifyClient;
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.kind).toBe('rate_limited');
  });

  it('maps an HTTP 429 error to rate_limited', async () => {
    const client = {
      placesSearch: jest.fn().mockRejectedValue(new Error('Geoapify places categories=[x] failed: HTTP 429')),
      get credits() { return 5; },
    } as unknown as GeoapifyClient;
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.kind).toBe('rate_limited');
  });

  it('maps any other error to failed, not a thrown exception', async () => {
    const client = {
      placesSearch: jest.fn().mockRejectedValue(new Error('network error')),
      get credits() { return 0; },
    } as unknown as GeoapifyClient;
    const provider = createGeoapifyPlacesProvider({ isEnabled: () => true, client });
    const result = await provider.fetchCandidates(UNIT);
    expect(result.kind).toBe('failed');
  });
});

describe('isGeoapifyDiscoveryEnabled', () => {
  const original = process.env['GEOAPIFY_DISCOVERY_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['GEOAPIFY_DISCOVERY_ENABLED'];
    else process.env['GEOAPIFY_DISCOVERY_ENABLED'] = original;
  });

  it('defaults to disabled when the env var is unset', () => {
    delete process.env['GEOAPIFY_DISCOVERY_ENABLED'];
    expect(isGeoapifyDiscoveryEnabled()).toBe(false);
  });

  it('is disabled for any value other than the literal string "true"', () => {
    process.env['GEOAPIFY_DISCOVERY_ENABLED'] = '1';
    expect(isGeoapifyDiscoveryEnabled()).toBe(false);
  });

  it('is enabled only when explicitly set to "true"', () => {
    process.env['GEOAPIFY_DISCOVERY_ENABLED'] = 'true';
    expect(isGeoapifyDiscoveryEnabled()).toBe(true);
  });
});
