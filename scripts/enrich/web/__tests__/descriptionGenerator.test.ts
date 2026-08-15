import { generateDescription, isEligibleForGeneratedDescription } from '../descriptionGenerator';
import type { VenueFact } from '../venueFacts';

describe('generateDescription', () => {
  it('returns null when there are no substantive facts', () => {
    expect(generateDescription({ venueName: 'X', categoryLabel: 'soft-play centre', city: 'Shrewsbury', facts: [] })).toBeNull();
  });

  it('produces the documented example sentence shape', () => {
    const facts: VenueFact[] = [
      { kind: 'indoor_outdoor', value: 'indoor' },
      { kind: 'facility', slug: 'toddler-area', present: true },
      { kind: 'facility', slug: 'cafe-on-site', present: true },
      { kind: 'facility', slug: 'parking', present: true },
      { kind: 'booking', required: false, recommended: false },
    ];
    const r = generateDescription({ venueName: 'Test', categoryLabel: 'soft-play centre', city: 'Shrewsbury', facts });
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/^Indoor soft-play centre in Shrewsbury\./);
    expect(r!.text).toMatch(/Facilities include a toddler area, an on-site cafe and parking\./);
  });

  it('never includes a facility fact that is explicitly absent (present:false)', () => {
    const facts: VenueFact[] = [
      { kind: 'facility', slug: 'parking', present: false },
      { kind: 'facility', slug: 'toilets', present: true },
    ];
    const r = generateDescription({ venueName: 'X', categoryLabel: 'museum', city: null, facts });
    expect(r!.text).not.toMatch(/parking/i);
    expect(r!.text).toMatch(/toilets/i);
  });

  it('includes a booking-required clause distinctly from booking-recommended', () => {
    const required = generateDescription({ venueName: 'X', categoryLabel: 'farm park', city: null, facts: [{ kind: 'facility', slug: 'parking', present: true }, { kind: 'booking', required: true, recommended: false }] });
    expect(required!.text).toMatch(/Booking is required\./);
    const recommended = generateDescription({ venueName: 'X', categoryLabel: 'farm park', city: null, facts: [{ kind: 'facility', slug: 'parking', present: true }, { kind: 'booking', required: false, recommended: true }] });
    expect(recommended!.text).toMatch(/Booking is recommended\./);
  });

  it('includes an admission clause', () => {
    const free = generateDescription({ venueName: 'X', categoryLabel: 'park', city: null, facts: [{ kind: 'facility', slug: 'parking', present: true }, { kind: 'admission', status: 'free' }] });
    expect(free!.text).toMatch(/Admission is free\./);
    const paid = generateDescription({ venueName: 'X', categoryLabel: 'park', city: null, facts: [{ kind: 'facility', slug: 'parking', present: true }, { kind: 'admission', status: 'paid' }] });
    expect(paid!.text).toMatch(/Admission charges apply\./);
  });

  it('never contains a banned marketing adjective', () => {
    const r = generateDescription({ venueName: 'X', categoryLabel: 'zoo', city: 'Leeds', facts: [{ kind: 'facility', slug: 'parking', present: true }] });
    const banned = ['best', 'great', 'popular', 'amazing', 'safe', 'exciting'];
    for (const word of banned) expect(r!.text.toLowerCase()).not.toContain(word);
  });

  it('reports exactly which facts were used', () => {
    const facts: VenueFact[] = [{ kind: 'facility', slug: 'parking', present: true }, { kind: 'admission', status: 'free' }];
    const r = generateDescription({ venueName: 'X', categoryLabel: 'zoo', city: null, facts });
    expect(r!.factsUsed).toHaveLength(2);
  });

  it('falls back to a generic category label when none is supplied', () => {
    const r = generateDescription({ venueName: 'X', categoryLabel: null, city: null, facts: [{ kind: 'facility', slug: 'parking', present: true }] });
    expect(r!.text).toMatch(/^family venue\./);
  });
});

describe('isEligibleForGeneratedDescription', () => {
  it('is eligible when the current description is null', () => {
    expect(isEligibleForGeneratedDescription(null, 'Test Venue')).toBe(true);
  });
  it('is eligible when the current description is empty/whitespace', () => {
    expect(isEligibleForGeneratedDescription('   ', 'Test Venue')).toBe(true);
  });
  it('is eligible when the current description is just the venue name (a common lazy fallback)', () => {
    expect(isEligibleForGeneratedDescription('Test Venue', 'Test Venue')).toBe(true);
  });
  it('protects a real, meaningful human-written description', () => {
    expect(isEligibleForGeneratedDescription('A charming family-run farm with animals, a tea room and seasonal events throughout the year.', 'Test Venue')).toBe(false);
  });
});
