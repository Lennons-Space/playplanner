import { extractVenueFacts } from '../venueFacts';

function page(bodyText: string): string {
  return `<html><body><p>${bodyText}</p></body></html>`;
}
function jsonLdPage(obj: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

describe('extractVenueFacts — absence is never negative evidence', () => {
  it('produces zero facts for a page that never mentions any facility', () => {
    const facts = extractVenueFacts(page('Welcome to our lovely venue. We open at 9am.'), 'https://x.example/');
    expect(facts).toHaveLength(0);
  });

  it('does not infer parking=false just because parking is never mentioned', () => {
    const facts = extractVenueFacts(page('We have a cafe and toilets on site.'), 'https://x.example/');
    const parkingFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'parking');
    expect(parkingFact).toBeUndefined();
  });

  it('does not extract a positive parking fact from a bare mention with no availability claim', () => {
    const facts = extractVenueFacts(page('Parking restrictions apply in the town centre on event days.'), 'https://x.example/');
    const parkingFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'parking');
    expect(parkingFact).toBeUndefined();
  });
});

describe('extractVenueFacts — explicit negative evidence', () => {
  it('extracts an explicit "no parking" negative fact', () => {
    const facts = extractVenueFacts(page('Please note there is no parking on site — please use public transport.'), 'https://x.example/');
    const parkingFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'parking');
    expect(parkingFact?.fact).toMatchObject({ present: false });
  });

  it('extracts an explicit "dogs are not allowed" negative fact', () => {
    const facts = extractVenueFacts(page('Please note dogs are not allowed inside the play area.'), 'https://x.example/');
    const dogFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'dog-friendly');
    expect(dogFact?.fact).toMatchObject({ present: false });
  });
});

describe('extractVenueFacts — no SEND/accessibility inference from vague phrases', () => {
  it('does NOT extract a wheelchair fact from "family friendly" or "welcoming to all"', () => {
    const facts = extractVenueFacts(page('We are a family friendly venue, welcoming to all.'), 'https://x.example/');
    const wheelchairFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'wheelchair');
    expect(wheelchairFact).toBeUndefined();
  });

  it('only extracts wheelchair access from an explicit statement', () => {
    const facts = extractVenueFacts(page('The venue is wheelchair accessible throughout.'), 'https://x.example/');
    const wheelchairFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'wheelchair');
    expect(wheelchairFact?.fact).toMatchObject({ present: true });
  });
});

describe('extractVenueFacts — positive facility phrases', () => {
  it.each([
    ['We have free parking available on site.', 'parking'],
    ['Baby changing facilities are located near reception.', 'baby-change'],
    ['Accessible toilets are located near the entrance.', 'accessible-toilets'],
    ['Lockers are available for a small deposit.', 'lockers'],
    ['Dogs are welcome in the outdoor area.', 'dog-friendly'],
    ['A dedicated toddler area is located at the front.', 'toddler-area'],
  ])('extracts %s -> %s', (text, slug) => {
    const facts = extractVenueFacts(page(text), 'https://x.example/');
    const fact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === slug);
    expect(fact?.fact).toMatchObject({ present: true, slug });
  });
});

describe('extractVenueFacts — structured JSON-LD signals preferred over text', () => {
  it('prefers amenityFeature over a conflicting text-heuristic match', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@type': 'LocalBusiness', amenityFeature: [{ name: 'Parking', value: false }],
    })}</script></head><body><p>We have parking available on site.</p></body></html>`;
    const facts = extractVenueFacts(html, 'https://x.example/');
    const parkingFact = facts.find((f) => f.fact.kind === 'facility' && f.fact.slug === 'parking');
    expect(parkingFact?.method).toBe('jsonld');
    expect(parkingFact?.fact).toMatchObject({ present: false }); // structured wins even though text says the opposite
  });

  it('extracts admission status from isAccessibleForFree', () => {
    const facts = extractVenueFacts(jsonLdPage({ '@type': 'TouristAttraction', isAccessibleForFree: true }), 'https://x.example/');
    const admission = facts.find((f) => f.fact.kind === 'admission');
    expect(admission?.fact).toMatchObject({ status: 'free' });
    expect(admission?.method).toBe('jsonld');
  });
});

describe('extractVenueFacts — indoor/outdoor', () => {
  it('extracts mixed when both are explicitly stated', () => {
    const facts = extractVenueFacts(page('This is an indoor and outdoor attraction.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'indoor_outdoor')?.fact).toMatchObject({ value: 'mixed' });
  });

  it('extracts indoor for a fully-indoor claim', () => {
    const facts = extractVenueFacts(page('Fully indoor soft play, perfect for rainy days.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'indoor_outdoor')?.fact).toMatchObject({ value: 'indoor' });
  });
});

describe('extractVenueFacts — age range and height restriction', () => {
  it('extracts an explicit age range', () => {
    const facts = extractVenueFacts(page('Suitable for ages 2 to 8 years.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'age_range')?.fact).toMatchObject({ minAge: 2, maxAge: 8 });
  });

  it('extracts a minimum-age-only claim', () => {
    const facts = extractVenueFacts(page('Suitable for children 5 years and over.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'age_range')?.fact).toMatchObject({ minAge: 5, maxAge: null });
  });

  it('extracts a plausible height restriction', () => {
    const facts = extractVenueFacts(page('Riders must be over 110cm to use this attraction.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'height_restriction')?.fact).toMatchObject({ minHeightCm: 110 });
  });

  it('rejects an implausible height value as a false-positive regex match', () => {
    const facts = extractVenueFacts(page('Minimum height 9cm for the model display case.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'height_restriction')).toBeUndefined();
  });
});

describe('extractVenueFacts — booking and admission text heuristics', () => {
  it('extracts booking required', () => {
    const facts = extractVenueFacts(page('Booking is required for all visits.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'booking')?.fact).toMatchObject({ required: true, recommended: false });
  });

  it('extracts booking recommended (distinct from required)', () => {
    const facts = extractVenueFacts(page('Booking is recommended, especially at weekends.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'booking')?.fact).toMatchObject({ required: false, recommended: true });
  });

  it('extracts free admission', () => {
    const facts = extractVenueFacts(page('Entry is free for all visitors.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'admission')?.fact).toMatchObject({ status: 'free' });
  });

  it('extracts paid admission', () => {
    const facts = extractVenueFacts(page('Admission charges apply for all visitors over 2.'), 'https://x.example/');
    expect(facts.find((f) => f.fact.kind === 'admission')?.fact).toMatchObject({ status: 'paid' });
  });
});

describe('extractVenueFacts — never throws on malformed input', () => {
  it('handles empty HTML gracefully', () => {
    expect(() => extractVenueFacts('', 'https://x.example/')).not.toThrow();
  });
  it('handles malformed JSON-LD gracefully', () => {
    const html = '<html><head><script type="application/ld+json">{not valid</script></head><body>parking available</body></html>';
    expect(() => extractVenueFacts(html, 'https://x.example/')).not.toThrow();
  });
});
