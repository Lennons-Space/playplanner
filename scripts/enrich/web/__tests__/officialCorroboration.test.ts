import {
  corroborateOfficialSite,
  extractIdentityEvidence,
  matchIdentity,
  type IdentityMatchInput,
} from '../officialCorroboration';
import type { WebFetchResult } from '../../../../types/webEnrichment';

function jsonLdPage(obj: Record<string, unknown>, title = 'Home'): string {
  return `<html><head><title>${title}</title><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

const TWYCROSS: IdentityMatchInput = {
  name: 'Twycross Zoo', postcode: 'CV9 3PX', city: 'Atherstone', latitude: 52.6, longitude: -1.6, phone: '01827880250',
};

describe('extractIdentityEvidence', () => {
  it('extracts name/address/phone/geo from a LocalBusiness JSON-LD block', () => {
    const html = jsonLdPage({
      '@type': 'LocalBusiness', name: 'Twycross Zoo', telephone: '01827 880250',
      address: { '@type': 'PostalAddress', streetAddress: '1 Zoo Rd', addressLocality: 'Atherstone', postalCode: 'CV9 3PX' },
      geo: { '@type': 'GeoCoordinates', latitude: 52.6, longitude: -1.6 },
    });
    const ev = extractIdentityEvidence(html, 'https://twycrosszoo.org/');
    expect(ev.name).toBe('Twycross Zoo');
    expect(ev.postcode).toBe('CV9 3PX');
    expect(ev.locality).toBe('Atherstone');
    expect(ev.latitude).toBe(52.6);
    expect(ev.pageTitle).toBe('Home');
  });

  it('ignores JSON-LD blocks of an unrelated schema type', () => {
    const html = jsonLdPage({ '@type': 'BreadcrumbList', name: 'Not a business' });
    const ev = extractIdentityEvidence(html, 'https://x.example/');
    expect(ev.name).toBeNull();
  });

  it('returns nulls (not a throw) for a page with no JSON-LD at all', () => {
    const ev = extractIdentityEvidence('<html><head><title>Plain Page</title></head><body>hi</body></html>', 'https://x.example/');
    expect(ev.name).toBeNull();
    expect(ev.pageTitle).toBe('Plain Page');
  });
});

describe('matchIdentity', () => {
  it('VERIFIED_SAME_VENUE: exact name + postcode match', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'Zoo', name: 'Twycross Zoo', address: { postalCode: 'CV9 3PX' },
    }), 'https://twycrosszoo.org/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).toBe('VERIFIED_SAME_VENUE');
  });

  it('VERIFIED_SAME_VENUE: exact name + matching phone (no postcode on site)', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'LocalBusiness', name: 'Twycross Zoo', telephone: '01827 880 250',
    }), 'https://twycrosszoo.org/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).toBe('VERIFIED_SAME_VENUE');
    expect(r.phoneMatch).toBe(true);
  });

  it('VERIFIED_SAME_VENUE: exact name + tight coordinates only', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'LocalBusiness', name: 'Twycross Zoo', geo: { latitude: 52.6005, longitude: -1.6005 },
    }), 'https://twycrosszoo.org/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).toBe('VERIFIED_SAME_VENUE');
  });

  it('never verifies on name alone — a chain homepage with no address/phone/geo caps below VERIFIED', () => {
    const ev = extractIdentityEvidence(jsonLdPage({ '@type': 'Organization', name: 'Twycross Zoo' }), 'https://twycrosszoo.org/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).not.toBe('VERIFIED_SAME_VENUE');
  });

  it('MISMATCH: same-ish name but the site states a conflicting postcode (wrong branch)', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'LocalBusiness', name: 'Chain Play Barn', address: { postalCode: 'TF1 1AA' },
    }), 'https://chainplaybarn.example/telford');
    const chainInput: IdentityMatchInput = { name: 'Chain Play Barn', postcode: 'SY1 1AD', city: 'Shrewsbury', latitude: 52.7, longitude: -2.75, phone: null };
    const r = matchIdentity(ev, chainInput);
    expect(r.status).toBe('MISMATCH');
  });

  it('MISMATCH: an unrelated business entirely', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'LocalBusiness', name: 'Joe\'s Fish and Chips', address: { postalCode: 'AB1 2CD' },
    }), 'https://joesfish.example/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).toBe('MISMATCH');
  });

  it('PROBABLE: plausible name with only a weak locality signal', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'LocalBusiness', name: 'Twycross Zoo', address: { addressLocality: 'Atherstone' },
    }), 'https://twycrosszoo.org/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).toBe('PROBABLE');
  });

  it('AMBIGUOUS: some evidence present but not enough to decide', () => {
    const ev = extractIdentityEvidence(jsonLdPage({
      '@type': 'LocalBusiness', name: 'Twy Zoo Cafe',
    }), 'https://x.example/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(['AMBIGUOUS', 'PROBABLE']).toContain(r.status);
  });

  it('UNAVAILABLE: no identity evidence extractable on the page at all', () => {
    const ev = extractIdentityEvidence('<html><body>Under construction</body></html>', 'https://x.example/');
    const r = matchIdentity(ev, TWYCROSS);
    expect(r.status).toBe('UNAVAILABLE');
  });
});

describe('corroborateOfficialSite', () => {
  it('never fetches anything when the candidate has no supplied website', async () => {
    const fetchPage = jest.fn();
    const r = await corroborateOfficialSite(null, TWYCROSS, { fetchPage });
    expect(r.status).toBe('UNAVAILABLE');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('only ever fetches the exact candidate-supplied URL — never a derived/guessed one', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ kind: 'ok', page: { finalUrl: 'https://twycrosszoo.org/', html: jsonLdPage({ '@type': 'Zoo', name: 'Twycross Zoo', address: { postalCode: 'CV9 3PX' } }), fromCache: false, page: {} } } as unknown as WebFetchResult);
    await corroborateOfficialSite('https://twycrosszoo.org/', TWYCROSS, { fetchPage });
    expect(fetchPage).toHaveBeenCalledWith('https://twycrosszoo.org/');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('maps a robots-denied fetch outcome to UNAVAILABLE, not a crash', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ kind: 'skipped_robots', note: 'disallowed' } as WebFetchResult);
    const r = await corroborateOfficialSite('https://x.example/', TWYCROSS, { fetchPage });
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('maps a fetch_failed outcome to UNAVAILABLE, not a crash', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ kind: 'fetch_failed', note: 'timeout' } as WebFetchResult);
    const r = await corroborateOfficialSite('https://x.example/', TWYCROSS, { fetchPage });
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('a cached page (fromCache=true) is corroborated identically to a fresh fetch', async () => {
    const html = jsonLdPage({ '@type': 'Zoo', name: 'Twycross Zoo', address: { postalCode: 'CV9 3PX' } });
    const fetchPage = jest.fn().mockResolvedValue({ kind: 'ok', page: { finalUrl: 'https://twycrosszoo.org/', html, fromCache: true, page: {} } } as unknown as WebFetchResult);
    const r = await corroborateOfficialSite('https://twycrosszoo.org/', TWYCROSS, { fetchPage });
    expect(r.status).toBe('VERIFIED_SAME_VENUE');
  });

  it('returns VERIFIED_SAME_VENUE end-to-end for a real match', async () => {
    const html = jsonLdPage({
      '@type': 'LocalBusiness', name: 'Twycross Zoo', telephone: '01827 880250',
      address: { postalCode: 'CV9 3PX', addressLocality: 'Atherstone' },
    });
    const fetchPage = jest.fn().mockResolvedValue({ kind: 'ok', page: { finalUrl: 'https://twycrosszoo.org/', html, fromCache: false, page: {} } } as unknown as WebFetchResult);
    const r = await corroborateOfficialSite('https://twycrosszoo.org/', TWYCROSS, { fetchPage });
    expect(r.status).toBe('VERIFIED_SAME_VENUE');
    expect(r.match?.postcodeMatch).toBe(true);
  });
});
