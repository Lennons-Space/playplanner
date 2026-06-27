// =============================================================================
// Tests for htmlExtract.ts (spec matrix rows 1,2,3,4,9,10,11 + tier precedence).
// Fixtures are inline HTML constants — deterministic, no network, no files.
// =============================================================================

import { extractCandidates, normalizeEmail } from '../htmlExtract';
import type { FieldCandidate, OpeningWeek, WebField } from '../../../../types/webEnrichment';

const SRC = 'https://willowsactivityfarm.com/';

function byField(cands: FieldCandidate[], field: WebField): FieldCandidate | undefined {
  return cands.find((c) => c.field === field);
}

describe('tier 1 — JSON-LD (row 1)', () => {
  // Updated for FIX 2b: openingHoursSpecification now needs ≥ 3 days to pass the
  // evidence-sufficiency guard. Fixture expanded from 1-day (Mon only) to 5-day
  // (Mo-Fr) which is the recognised "weekdays open" convention.
  const html = `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Willows Activity Farm',
      description: 'A working farm with indoor and outdoor play.',
      priceRange: '£8.50',
      telephone: '+44 1727 822106',
      email: 'info@willows.co.uk',
      url: 'https://willows.co.uk',
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday',    opens: '09:00', closes: '17:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Tuesday',   opens: '09:00', closes: '17:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Wednesday', opens: '09:00', closes: '17:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Thursday',  opens: '09:00', closes: '17:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Friday',    opens: '09:00', closes: '17:00' },
      ],
      potentialAction: { '@type': 'ReserveAction', target: 'https://willows.co.uk/book' },
    })}</script></head><body></body></html>`;

  const { candidates } = extractCandidates(html, SRC);

  it('extracts every JSON-LD field with method=jsonld', () => {
    for (const f of ['description', 'price_range', 'phone', 'email', 'website', 'opening_hours', 'booking_url'] as WebField[]) {
      expect(byField(candidates, f)?.method).toBe('jsonld');
    }
  });
  it('normalises the phone and maps the price', () => {
    expect(byField(candidates, 'phone')?.value).toBe('+441727822106');
    expect(byField(candidates, 'price_range')?.value).toBe('moderate');
  });
  it('produces a structured 7-day opening week', () => {
    const week = byField(candidates, 'opening_hours')?.value as OpeningWeek;
    expect(week.days).toHaveLength(7);
    expect(week.days[1]?.intervals).toEqual([{ opens: '09:00', closes: '17:00' }]);
  });
});

describe('tier 2 — microdata (row 2)', () => {
  const html = `<div itemscope itemtype="https://schema.org/LocalBusiness">
    <span itemprop="telephone">01727 822106</span>
    <a itemprop="email">hello@farm.co.uk</a>
    <meta itemprop="priceRange" content="£5">
  </div>`;
  const { candidates } = extractCandidates(html, SRC);

  it('reads itemprop telephone/email/price as microdata', () => {
    expect(byField(candidates, 'phone')?.method).toBe('microdata');
    expect(byField(candidates, 'phone')?.value).toBe('01727822106');
    expect(byField(candidates, 'email')?.value).toBe('hello@farm.co.uk');
    expect(byField(candidates, 'price_range')?.value).toBe('budget');
  });
});

describe('tier 3 — meta (row 3) + precedence', () => {
  it('uses meta description when no JSON-LD/microdata', () => {
    const html = `<head><meta name="description" content="Indoor soft play in St Albans."></head>`;
    const { candidates } = extractCandidates(html, SRC);
    expect(byField(candidates, 'description')?.method).toBe('meta');
  });

  it('JSON-LD description wins over meta (first tier wins)', () => {
    const html = `<head>
      <script type="application/ld+json">{"@type":"Place","description":"From JSON-LD"}</script>
      <meta name="description" content="From meta">
    </head>`;
    const { candidates } = extractCandidates(html, SRC);
    const d = byField(candidates, 'description');
    expect(d?.method).toBe('jsonld');
    expect(d?.value).toBe('From JSON-LD');
  });
});

describe('tier 4 — heuristics (rows 4, 9, 10, 11)', () => {
  it('parses opening hours from a table (row 4)', () => {
    // Updated for FIX 2b: 2-day fixture (Mon + Sat) now fails the evidence-sufficiency
    // guard. Expanded to 5 days (Mon–Fri) which passes as a recognised complete-week
    // convention and is representative of a real nursery/farm timetable.
    const html = `<table>
      <tr><td>Monday</td><td>9:00 - 17:00</td></tr>
      <tr><td>Tuesday</td><td>9:00 - 17:00</td></tr>
      <tr><td>Wednesday</td><td>9:00 - 17:00</td></tr>
      <tr><td>Thursday</td><td>9:00 - 17:00</td></tr>
      <tr><td>Friday</td><td>9:00 - 17:00</td></tr>
    </table>`;
    const { candidates } = extractCandidates(html, SRC);
    const oh = byField(candidates, 'opening_hours');
    expect(oh?.method).toBe('heuristic');
    expect((oh?.value as OpeningWeek).days[1]?.intervals).toEqual([{ opens: '09:00', closes: '17:00' }]);
  });

  it('SUPPRESSES heuristic body-text price (hardening): a bare £N is too ambiguous', () => {
    // Previously this emitted price_range 'moderate'. The heuristic price path is
    // disabled for the pilot — only structured jsonld/microdata priceRange counts.
    const html = `<p>Admission £8.50 for adults, under 2s free.</p>`;
    const { candidates } = extractCandidates(html, SRC);
    expect(byField(candidates, 'price_range')).toBeUndefined();
  });

  it('still extracts STRUCTURED jsonld priceRange (unambiguous venue-level pricing)', () => {
    const html = `<script type="application/ld+json">
      {"@type":"LocalBusiness","name":"X","priceRange":"£10"}</script>`;
    const { candidates } = extractCandidates(html, SRC);
    const price = byField(candidates, 'price_range');
    expect(price?.method).toBe('jsonld');
    expect(price?.value).toBe('moderate');
  });

  it('drops a parked-domain meta description encoded as numeric HTML entities (Torre case)', () => {
    // &#20248;&#28216; … is CJK gambling spam. decodeEntities must surface the
    // real characters so isSaneDescription can reject it (not wave through ASCII).
    const html = `<meta name="description" content="&#20248;&#28216;&#24179;&#21488;&#24635;&#20195;&#27880;&#20876;&#30331;&#38470;&#27880;&#20876;&#30331;&#24405;&#20248;&#28216;">`;
    const { candidates } = extractCandidates(html, SRC);
    expect(byField(candidates, 'description')).toBeUndefined();
  });

  it('extracts a mailto personal email (row 10)', () => {
    const html = `<a href="mailto:jane.smith@farm.co.uk">Email Jane</a>`;
    const { candidates } = extractCandidates(html, SRC);
    expect(byField(candidates, 'email')?.value).toBe('jane.smith@farm.co.uk');
  });

  it('detects a booking link (row 11) and rejects unsafe hrefs', () => {
    const html = `
      <a href="https://digitickets.co.uk/buy">Book tickets</a>
      <a href="http://127.0.0.1/book">Book internal</a>`;
    const { candidates } = extractCandidates(html, SRC);
    expect(byField(candidates, 'booking_url')?.value).toBe('https://digitickets.co.uk/buy');
  });
});

describe('robustness', () => {
  it('never throws on malformed JSON-LD or empty input', () => {
    expect(() => extractCandidates('<script type="application/ld+json">{bad</script>', SRC)).not.toThrow();
    expect(extractCandidates('', SRC).candidates).toEqual([]);
  });
});

// =============================================================================
// M1 — normalizeEmail unit tests (spec requirement A, cases 1–6)
// =============================================================================

describe('normalizeEmail (M1)', () => {
  // Case 1: strip lowercase mailto: prefix
  it('strips a leading mailto: prefix', () => {
    expect(normalizeEmail('mailto:test@example.com')).toBe('test@example.com');
  });

  // Case 2: case-insensitive strip; address case preserved as-is
  it('strips MAILTO: prefix case-insensitively, preserving address case', () => {
    expect(normalizeEmail('MAILTO:Test@Example.com')).toBe('Test@Example.com');
  });

  // Case 3: remove query string (mailto: hrefs often carry ?subject=…)
  it('removes a query string from a mailto: href value', () => {
    expect(normalizeEmail('mailto:test@example.com?subject=Hello')).toBe('test@example.com');
  });

  // Case 4: safely percent-decode — %40 is @, so this round-trips to a valid email
  it('percent-decodes a safely encoded email address', () => {
    expect(normalizeEmail('mailto:test%40example.com')).toBe('test@example.com');
  });

  // Case 5: normal business email passes through unchanged
  it('passes a normal valid business email through unchanged', () => {
    expect(normalizeEmail('info@playcentre.co.uk')).toBe('info@playcentre.co.uk');
  });

  // Case 6: invalid value (no @) returns null — no candidate should be added
  it('returns null for a value that is not a valid email', () => {
    expect(normalizeEmail('mailto:notanemail')).toBeNull();
    expect(normalizeEmail('notanemail')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });

  // Integration: invalid JSON-LD email is not added to candidates
  it('integration: a JSON-LD email with no @ is not added as a candidate', () => {
    const html = `<script type="application/ld+json">
      {"@type":"LocalBusiness","email":"notvalid"}</script>`;
    const { candidates } = extractCandidates(html, SRC);
    expect(candidates.find((c) => c.field === 'email')).toBeUndefined();
  });

  // Integration: a mailto: href with a query string is normalised to just the address
  it('integration: heuristic mailto: href with query string yields clean email', () => {
    const html = `<a href="mailto:info@farm.co.uk?subject=Booking">Email us</a>`;
    const { candidates } = extractCandidates(html, SRC);
    // The value must be the normalized address (no query string)
    expect(candidates.find((c) => c.field === 'email')?.value).toBe('info@farm.co.uk');
  });

  // ── M1 residual fix — decode-before-strip for percent-encoded separators ──────

  // Case 7: uppercase %3F — decoding happens before the query-strip so the
  // encoded '?' becomes a literal '?' which is then removed.
  it('strips an uppercase %3F-encoded query separator (decode-before-strip fix)', () => {
    expect(normalizeEmail('mailto:info@example.com%3Fsubject=hello')).toBe('info@example.com');
  });

  // Case 8: lowercase %3f — percent-encoding is case-insensitive per RFC 3986.
  it('strips a lowercase %3f-encoded query separator and handles MAILTO: casing', () => {
    expect(normalizeEmail('MAILTO:info@example.com%3fsubject=hello')).toBe('info@example.com');
  });

  // Case 9: encoded '@' (%40) combined with an encoded query separator — the
  // decode step resolves both before the query is removed and the address validated.
  it('resolves an encoded @ (%40) combined with an encoded query separator (%3F)', () => {
    expect(normalizeEmail('mailto:info%40example.com%3Fsubject=hello')).toBe('info@example.com');
  });

  // Case 10: malformed percent sequence — decodeURIComponent throws, the catch
  // falls back to the pre-decode string, and the function returns without throwing.
  it('does not throw on a malformed percent sequence (try/catch guard)', () => {
    expect(() => normalizeEmail('mailto:info@example.com%')).not.toThrow();
    const result = normalizeEmail('mailto:info@example.com%');
    // The permissive fallback returns a string or null; neither is an exception.
    expect(result === null || typeof result === 'string').toBe(true);
  });

  // Case 11: ordinary valid email — must pass through both the old and new code
  // paths unchanged (regression guard: the reorder must not break the happy path).
  it('leaves an ordinary valid email unchanged (regression guard)', () => {
    expect(normalizeEmail('info@playcentre.co.uk')).toBe('info@playcentre.co.uk');
  });
});
