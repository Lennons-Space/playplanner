// =============================================================================
// Tests for robotsParse.ts — grouping, allow/disallow precedence, wildcards,
// crawl-delay, UA specificity.
// =============================================================================

import { crawlDelayMs, isPathAllowed, parseRobots } from '../robotsParse';

const UA = 'PlayPlannerBot/0.1';

describe('parseRobots + isPathAllowed', () => {
  it('disallows everything under "Disallow: /"', () => {
    const r = parseRobots('User-agent: *\nDisallow: /');
    expect(isPathAllowed(r, UA, '/')).toBe(false);
    expect(isPathAllowed(r, UA, '/opening-times')).toBe(false);
  });

  it('empty robots allows everything', () => {
    expect(isPathAllowed(parseRobots(''), UA, '/anything')).toBe(true);
  });

  it('empty "Disallow:" imposes no restriction', () => {
    expect(isPathAllowed(parseRobots('User-agent: *\nDisallow:'), UA, '/x')).toBe(true);
  });

  it('disallows a specific path but allows others', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private');
    expect(isPathAllowed(r, UA, '/private/x')).toBe(false);
    expect(isPathAllowed(r, UA, '/opening-times')).toBe(true);
  });

  it('Allow wins over a same-length Disallow tie / longest match wins', () => {
    const r = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs/public');
    expect(isPathAllowed(r, UA, '/docs/secret')).toBe(false);
    expect(isPathAllowed(r, UA, '/docs/public/a')).toBe(true);
  });

  it('honours a "$" end-anchored wildcard rule', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isPathAllowed(r, UA, '/menu.pdf')).toBe(false);
    expect(isPathAllowed(r, UA, '/menu.pdf?x=1')).toBe(true);
  });

  it('a specific UA group overrides the * group', () => {
    const r = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: PlayPlannerBot\nDisallow: /private',
    );
    expect(isPathAllowed(r, UA, '/opening-times')).toBe(true); // our group allows it
    expect(isPathAllowed(r, UA, '/private')).toBe(false);
    expect(isPathAllowed(r, 'SomeOtherBot', '/opening-times')).toBe(false); // falls to *
  });
});

describe('ReDoS safety (sec #5)', () => {
  it('matches a wildcard-heavy hostile pattern quickly (no catastrophic backtracking)', () => {
    const evil = `User-agent: *\nDisallow: /${'a*'.repeat(40)}`;
    const r = parseRobots(evil);
    const path = `/${'a'.repeat(5000)}b`; // non-matching tail forces worst case
    const start = Date.now();
    const allowed = isPathAllowed(r, UA, path);
    expect(Date.now() - start).toBeLessThan(200); // linear matcher → fast
    expect(typeof allowed).toBe('boolean');
  });

  it('still matches a normal wildcard rule correctly', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a*c');
    expect(isPathAllowed(r, UA, '/abbbc')).toBe(false);
    expect(isPathAllowed(r, UA, '/abbb')).toBe(true);
  });
});

describe('crawlDelayMs', () => {
  it('returns crawl-delay in milliseconds', () => {
    const r = parseRobots('User-agent: *\nCrawl-delay: 10\nDisallow:');
    expect(crawlDelayMs(r, UA)).toBe(10_000);
  });
  it('returns null when unset', () => {
    expect(crawlDelayMs(parseRobots('User-agent: *\nDisallow:'), UA)).toBeNull();
  });
});
