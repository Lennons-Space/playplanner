import { checkPagesForClosure, stripHtmlToText } from '../closureCheck';

describe('stripHtmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(stripHtmlToText('<html><body><p>Hello   <b>world</b></p></body></html>')).toBe('Hello world');
  });

  it('removes script and style content entirely', () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><script>alert(1)</script>Real text</body></html>';
    expect(stripHtmlToText(html)).toBe('Real text');
  });
});

describe('checkPagesForClosure', () => {
  const AT = '2026-08-14T10:00:00.000Z';

  it('returns no signals for normal pages', () => {
    const signals = checkPagesForClosure({ 'https://v.example/': '<p>Open Monday to Friday 9am-5pm</p>' }, AT);
    expect(signals).toHaveLength(0);
  });

  it('detects a closure signal and tags it tier 1 (own website)', () => {
    const signals = checkPagesForClosure(
      { 'https://v.example/': '<p>We have now closed permanently. Thanks for the memories.</p>' },
      AT,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]!.sourceTier).toBe(1);
    expect(signals[0]!.kind).toBe('explicit_official_text');
  });

  it('does not treat a temporary-closure phrase as a closure signal', () => {
    const signals = checkPagesForClosure({ 'https://v.example/': '<p>Closed for refurbishment until spring.</p>' }, AT);
    expect(signals).toHaveLength(0);
  });

  it('scans every page in the map, not just the first', () => {
    const signals = checkPagesForClosure(
      {
        'https://v.example/': '<p>Welcome!</p>',
        'https://v.example/contact': '<p>This attraction has closed down.</p>',
      },
      AT,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]!.sourceUrl).toBe('https://v.example/contact');
  });
});
