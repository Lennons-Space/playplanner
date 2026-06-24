// =============================================================================
// Tests for sanitize.ts — HTML escaping (row 23) + PII scrub (row 24) + cap.
// =============================================================================

import { cleanEvidence, escapeHtml, scrubPii, trimSnippet, SNIPPET_MAX } from '../sanitize';

describe('escapeHtml (row 23 — XSS in report)', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersand and apostrophe', () => {
    expect(escapeHtml(`Tom & Jerry's`)).toBe('Tom &amp; Jerry&#x27;s');
  });

  it('neutralises an onerror image payload', () => {
    const out = escapeHtml(`<img src=x onerror='steal()'>`);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});

describe('scrubPii (row 24 — incidental PII)', () => {
  it('redacts email, phone and postcode', () => {
    const out = scrubPii('Contact jane.smith@example.com on 0207 946 0000, AL2 1BB');
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[postcode]');
    expect(out).not.toContain('jane.smith@example.com');
  });

  it('does NOT mistake a time range for a phone number', () => {
    expect(scrubPii('Open 10:00-17:00 daily')).toBe('Open 10:00-17:00 daily');
  });

  it('preserves the field’s own proposed value (keep)', () => {
    const out = scrubPii('Call us on 01727 822106 for bookings', '01727 822106');
    expect(out).toContain('01727 822106');
    expect(out).not.toContain('[phone]');
  });
});

describe('trimSnippet / cleanEvidence', () => {
  it('collapses whitespace and caps length', () => {
    const long = 'a '.repeat(400); // 800 chars pre-trim
    expect(trimSnippet(long).length).toBeLessThanOrEqual(SNIPPET_MAX);
  });

  it('cleanEvidence scrubs then trims', () => {
    const out = cleanEvidence('  email   me   at  a.b@c.com  ');
    expect(out).toBe('email me at [email]');
  });
});
