import { isTrustedSourceId, NO_SCRAPE_SOURCES, sourceTierOf, SOURCE_TIERS } from '../sourceTrust';

describe('sourceTrust', () => {
  it('tiers official sources as tier 1', () => {
    expect(sourceTierOf('official_website')).toBe(1);
    expect(sourceTierOf('operator_announcement')).toBe(1);
  });

  it('tiers OSM and Geoapify as tier 2', () => {
    expect(sourceTierOf('osm')).toBe(2);
    expect(sourceTierOf('geoapify')).toBe(2);
  });

  it('treats tier 1 and tier 2 sources as trusted', () => {
    expect(isTrustedSourceId('official_website')).toBe(true);
    expect(isTrustedSourceId('osm')).toBe(true);
    expect(isTrustedSourceId('geoapify')).toBe(true);
  });

  it('every declared source has a tier <= 3', () => {
    for (const tier of Object.values(SOURCE_TIERS)) {
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(3);
    }
  });

  it('the no-scrape list names the explicitly forbidden sources', () => {
    expect(NO_SCRAPE_SOURCES).toEqual(
      expect.arrayContaining(['google_maps', 'google_search', 'tripadvisor']),
    );
  });
});
