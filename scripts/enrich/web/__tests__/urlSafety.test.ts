// =============================================================================
// Tests for urlSafety.ts — SSRF guard (spec matrix rows 21, 22).
// =============================================================================

import { firstUnsafeHop, isSafeIp, isSafeUrl } from '../urlSafety';

describe('isSafeUrl — public hosts', () => {
  it.each([
    'https://willowsactivityfarm.com/',
    'http://example.co.uk/opening-times',
    'https://8.8.8.8/',
  ])('accepts %s', (url) => {
    expect(isSafeUrl(url).safe).toBe(true);
  });
});

describe('isSafeUrl — SSRF rejections (row 21)', () => {
  it.each([
    ['http://localhost:5432', 'localhost'],
    ['http://127.0.0.1/', 'private_ipv4'],
    ['http://10.0.0.5/', 'private_ipv4'],
    ['http://192.168.0.1/', 'private_ipv4'],
    ['http://172.16.5.5/', 'private_ipv4'],
    ['http://169.254.1.1/', 'private_ipv4'],
    ['http://[::1]/', 'private_ipv6'],
    ['http://intranet.local/', 'internal_tld'],
    ['ftp://example.com/', 'disallowed_scheme:ftp'],
    ['not a url', 'unparseable_url'],
  ])('rejects %s', (url, reason) => {
    const r = isSafeUrl(url);
    expect(r.safe).toBe(false);
    expect(r.reason).toBe(reason);
  });

  it('rejects a malformed octet', () => {
    expect(isSafeUrl('http://999.1.1.1/').safe).toBe(false);
  });

  it.each([
    ['http://0177.0.0.1/', 'octal loopback'],
    ['http://0x7f.0.0.1/', 'hex loopback octet'],
    ['http://0x7f000001/', 'hex 32-bit loopback'],
    ['http://2130706433/', 'decimal-integer loopback'],
    ['http://3232235521/', 'decimal-integer 192.168.0.1'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
    ['http://[64:ff9b::7f00:1]/', 'NAT64-embedded loopback'],
  ])('rejects encoded/embedded private address: %s (%s)', (url) => {
    expect(isSafeUrl(url).safe).toBe(false);
  });

  it('still allows a public address in integer form', () => {
    // 93.184.216.34 (example.com) as a 32-bit integer = 1572395042
    expect(isSafeUrl('http://1572395042/').safe).toBe(true);
  });
});

describe('isSafeIp (DNS-result screening)', () => {
  it.each(['10.0.0.5', '127.0.0.1', '169.254.1.1', '::1', 'fe80::1', 'fc00::1', '64:ff9b::7f00:1'])(
    'rejects private/loopback %s',
    (ip) => {
      expect(isSafeIp(ip).safe).toBe(false);
    },
  );
  it.each(['93.184.216.34', '2001:4860:4860::8888'])('accepts public %s', (ip) => {
    expect(isSafeIp(ip).safe).toBe(true);
  });
});

describe('firstUnsafeHop — redirect chain (row 22)', () => {
  it('flags an internal host mid-chain', () => {
    const hop = firstUnsafeHop([
      'https://venue.co.uk/',
      'https://www.venue.co.uk/',
      'http://10.1.2.3/admin',
    ]);
    expect(hop).not.toBeNull();
    expect(hop?.url).toBe('http://10.1.2.3/admin');
    expect(hop?.reason).toBe('private_ipv4');
  });

  it('returns null when every hop is public', () => {
    expect(firstUnsafeHop(['https://a.com/', 'https://b.com/'])).toBeNull();
  });
});
