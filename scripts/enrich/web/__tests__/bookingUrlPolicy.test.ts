import { decideBookingUrl, hostsShareIdentity, urlHost } from '../bookingUrlPolicy';

describe('urlHost', () => {
  it('extracts and normalises a host, dropping scheme, www and path', () => {
    expect(urlHost('https://www.Venue.co.uk/book/now?x=1')).toBe('venue.co.uk');
    expect(urlHost('venue.co.uk')).toBe('venue.co.uk');
    expect(urlHost('http://book.venue.co.uk')).toBe('book.venue.co.uk');
  });

  it('refuses a host containing userinfo, so a credential-style URL cannot impersonate the venue domain', () => {
    // The classic trick: this URL actually goes to evil.example.
    expect(urlHost('https://real-venue.co.uk@evil.example/book')).toBeNull();
  });

  it('returns null for empty/garbage input rather than guessing', () => {
    expect(urlHost(null)).toBeNull();
    expect(urlHost('')).toBeNull();
    expect(urlHost('   ')).toBeNull();
  });
});

describe('hostsShareIdentity', () => {
  it('matches equal hosts and subdomains in either direction', () => {
    expect(hostsShareIdentity('venue.co.uk', 'venue.co.uk')).toBe(true);
    expect(hostsShareIdentity('book.venue.co.uk', 'venue.co.uk')).toBe(true);
    expect(hostsShareIdentity('venue.co.uk', 'book.venue.co.uk')).toBe(true);
  });

  it('does NOT match a mere suffix collision — the dot boundary is required', () => {
    expect(hostsShareIdentity('notvenue.co.uk', 'venue.co.uk')).toBe(false);
    expect(hostsShareIdentity('venue.co.uk.evil.example', 'venue.co.uk')).toBe(false);
  });
});

describe('decideBookingUrl', () => {
  const base = { venueWebsite: 'https://venue.co.uk', currentBookingUrl: null };

  it('auto-applies a booking link on the venue’s own host', () => {
    const r = decideBookingUrl({ ...base, proposedUrl: 'https://venue.co.uk/book' });
    expect(r.action).toBe('auto_apply');
    expect(r.proposedHost).toBe('venue.co.uk');
  });

  it('auto-applies a booking link on a subdomain of the venue’s host', () => {
    expect(decideBookingUrl({ ...base, proposedUrl: 'https://book.venue.co.uk/' }).action).toBe('auto_apply');
  });

  it('routes a third-party booking host to human review instead of publishing it', () => {
    const r = decideBookingUrl({ ...base, proposedUrl: 'https://bookwhen.com/venue' });
    expect(r.action).toBe('exception');
    expect(r.reason).toMatch(/not the venue's own host/);
  });

  it('routes to review — never auto-apply — when the venue has no website to verify against', () => {
    const r = decideBookingUrl({ proposedUrl: 'https://anything.example/book', venueWebsite: null, currentBookingUrl: null });
    expect(r.action).toBe('exception');
    // Absence of evidence must never be read as permission.
    expect(r.reason).toMatch(/never treated as permission/);
  });

  it('never overwrites a booking_url that is already set', () => {
    const r = decideBookingUrl({ ...base, proposedUrl: 'https://venue.co.uk/book', currentBookingUrl: 'https://venue.co.uk/existing' });
    expect(r.action).toBe('ignore');
    expect(r.reason).toMatch(/never overwrites/);
  });

  it('refuses a non-https booking link even on the venue’s own host', () => {
    // A parent may enter payment details here — no TLS, no publish.
    expect(decideBookingUrl({ ...base, proposedUrl: 'http://venue.co.uk/book' }).action).toBe('ignore');
  });

  it('refuses a userinfo-disguised link that would otherwise look like the venue host', () => {
    const r = decideBookingUrl({ ...base, proposedUrl: 'https://venue.co.uk@evil.example/book' });
    expect(r.action).toBe('ignore');
    expect(r.proposedHost).toBeNull();
  });

  it('does nothing when there is no booking URL at all', () => {
    expect(decideBookingUrl({ ...base, proposedUrl: null }).action).toBe('ignore');
  });
});
