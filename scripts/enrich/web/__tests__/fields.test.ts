// =============================================================================
// Tests for fields.ts — price mapping (row 9), personal email (row 10),
// phone normalisation, booking heuristic (row 11),
// phoneDedupKey (FIX 1), isMeaningfulDescription (FIX 4).
// =============================================================================

import { isLikelyBookingUrl, isMeaningfulDescription, isSaneDescription, looksPersonalEmail, mapPriceToBand, normalisePhone, normaliseTelHref, phoneDedupKey } from '../fields';

describe('mapPriceToBand (row 9)', () => {
  it.each([
    ['Free entry for all', 'free'],
    ['Tickets £4', 'budget'],
    ['Admission £8.50 for adults', 'moderate'],
    ['Adults £20, children £15', 'premium'],
  ])('maps %s → %s', (text, band) => {
    expect(mapPriceToBand(text)).toBe(band);
  });

  it('returns null when there is no price signal', () => {
    expect(mapPriceToBand('A great day out for the family')).toBeNull();
  });
});

describe('looksPersonalEmail (row 10)', () => {
  it('flags firstname.lastname addresses', () => {
    expect(looksPersonalEmail('jane.smith@example.com')).toBe(true);
  });
  it.each(['info@example.com', 'bookings@example.com', 'jsmith@example.com'])(
    'does not flag %s',
    (email) => {
      expect(looksPersonalEmail(email)).toBe(false);
    },
  );
});

describe('normalisePhone', () => {
  it('keeps + and digits for an international number', () => {
    expect(normalisePhone('+44 1727 822106')).toBe('+441727822106');
  });
  it('keeps a national number', () => {
    expect(normalisePhone('01727 822106')).toBe('01727822106');
  });
  it('rejects too-short input', () => {
    expect(normalisePhone('123 456')).toBeNull();
  });
});

describe('isLikelyBookingUrl (row 11)', () => {
  it('detects a ticket link', () => {
    expect(isLikelyBookingUrl('https://digitickets.co.uk/x', 'Book tickets')).toBe(true);
  });
  it('ignores an ordinary link', () => {
    expect(isLikelyBookingUrl('https://venue.co.uk/about', 'About us')).toBe(false);
  });
});

// ── FIX 1: phoneDedupKey ──────────────────────────────────────────────────────

describe('phoneDedupKey (FIX 1 — GB phone dedup)', () => {
  // Apple Tree Nursery regression: all four forms of the same GB number → equal key.
  it.each([
    ['+44 1738 561083', '+441738561083'],
    ['01738 561083',    '+441738561083'],
    ['01738561083',     '+441738561083'],
    ['+441738561083',   '+441738561083'],
  ])('canonicalises %s → %s', (input, expected) => {
    expect(phoneDedupKey(input)).toBe(expected);
  });

  it('a genuinely different GB number produces a different key', () => {
    expect(phoneDedupKey('+44 1738 561083')).not.toBe(phoneDedupKey('+44 1738 999999'));
    expect(phoneDedupKey('01738 561083')).not.toBe(phoneDedupKey('01738 999999'));
  });

  it('a non-UK international number is NOT coerced to GB (preserved as-is)', () => {
    // +1 212 555 0123 must NOT become a +44 number
    const key = phoneDedupKey('+1 212 555 0123');
    expect(key).not.toBeNull();
    expect(key!.startsWith('+44')).toBe(false);
    expect(key).toBe('+12125550123');
  });

  it('two distinct non-UK numbers produce different keys', () => {
    expect(phoneDedupKey('+1 212 555 0123')).not.toBe(phoneDedupKey('+1 212 555 9999'));
  });

  it('rejects a too-short number (returns null)', () => {
    expect(phoneDedupKey('12345')).toBeNull();
  });

  it('handles various GB formats: spaces, hyphens, brackets', () => {
    const key = phoneDedupKey('+441738561083');
    expect(phoneDedupKey('+44-1738-561083')).toBe(key);
    expect(phoneDedupKey('+44 (0)1738 561083')).toBe(key);
  });

  it('UK mobile 07911 123456 canonicalises to +44 form', () => {
    // 07911123456 is 11 digits starting with 0 → +447911123456
    expect(phoneDedupKey('07911 123456')).toBe('+447911123456');
    expect(phoneDedupKey('07911123456')).toBe('+447911123456');
  });

  it('+44 (0)1738 561083 dedupes correctly with 01738 561083', () => {
    // The (0) trunk indicator form is stripped before digit extraction.
    expect(phoneDedupKey('+44 (0)1738 561083')).toBe(phoneDedupKey('01738 561083'));
    expect(phoneDedupKey('+44 (0)1738 561083')).toBe('+441738561083');
  });

  it('0044 IDD-prefix form is NOT coerced — treated as a distinct key (accepted trade-off)', () => {
    // "0044 1738 561083" uses the international trunk digit (IDD). It has 14 digits,
    // which exceeds the 10–11 digit UK-national branch, so it falls through to the
    // raw-digit return path ("00441738561083"). This does NOT match "+441738561083"
    // and will surface as a conflict for human review rather than a silent dedup.
    // This is an accepted trade-off: the 0044 format is rare and a conflict is safe
    // (the human sees both values and can reconcile). Coercing it risks false dedup
    // with an unrelated 14-digit number from another country.
    const idd = phoneDedupKey('0044 1738 561083');
    const e164 = phoneDedupKey('+44 1738 561083');
    expect(idd).not.toBeNull();
    expect(idd).not.toBe(e164); // intentionally distinct — flagged, not silently deduped
    // The raw digit string is returned for the IDD form.
    expect(idd).toBe('00441738561083');
  });

  it('non-UK +1 number stays distinct from any +44 GB number', () => {
    const us = phoneDedupKey('+1 212 555 0123');
    const gb = phoneDedupKey('+44 1738 561083');
    expect(us).not.toBeNull();
    expect(gb).not.toBeNull();
    expect(us).not.toBe(gb);
    // US key starts with +1, not +44
    expect(us!.startsWith('+1')).toBe(true);
    expect(us!.startsWith('+44')).toBe(false);
  });

  it('junk input (too short) returns null and proposals layer falls back safely', () => {
    expect(phoneDedupKey('123')).toBeNull();
    expect(phoneDedupKey('')).toBeNull();
    expect(phoneDedupKey('   ')).toBeNull();
  });

  it('junk input (too long, > 15 digits) returns null', () => {
    expect(phoneDedupKey('1234567890123456')).toBeNull(); // 16 digits
  });
});

// ── FIX 4: isMeaningfulDescription ────────────────────────────────────────────

describe('isMeaningfulDescription (FIX 4)', () => {
  const venueName = 'Little People at The Limes';
  const venueNameApple = 'Apple Tree Nursery';

  // Regression: description that is exactly the venue name → rejected
  it('rejects a description identical to the venue name', () => {
    expect(isMeaningfulDescription(venueName, venueName)).toBe(false);
  });

  // Name with trivial suffix (e.g. "– Nursery") → rejected
  it('rejects a description that is just the venue name plus a trivial suffix', () => {
    expect(isMeaningfulDescription(`${venueName} – Nursery`, venueName)).toBe(false);
  });

  // A genuine multi-sentence description → kept
  it('keeps a genuine multi-sentence description (Apple Tree Nursery case)', () => {
    const real =
      'Apple Tree Nursery offers a warm, caring environment for children aged 0–5. ' +
      'We follow the EYFS framework and offer flexible sessions to suit working parents. ' +
      'Our outdoor space is available year-round.';
    expect(isMeaningfulDescription(real, venueNameApple)).toBe(true);
  });

  // Short title-like string with no sentence end → rejected
  it('rejects a very short string with no sentence punctuation', () => {
    expect(isMeaningfulDescription('Play centre for kids', 'Unrelated Venue')).toBe(false);
  });

  // Slightly longer string that is clearly descriptive → kept
  it('keeps a description that has sentence structure and sufficient word count', () => {
    const desc = 'A fun indoor soft-play centre for children from 0 to 12 years. Open seven days a week.';
    expect(isMeaningfulDescription(desc, 'Different Venue Name')).toBe(true);
  });

  // Case/whitespace insensitivity for name comparison
  it('is case-insensitive when comparing against venue name', () => {
    expect(isMeaningfulDescription('LITTLE PEOPLE AT THE LIMES', venueName)).toBe(false);
  });

  // Genuine description that opens with the venue name followed by real content.
  // Rule 2 substring check: extra words must be >= 4 beyond the matched name.
  it('keeps a genuine description that contains the venue name plus rich content', () => {
    // normText = "welcome to little people at the limes a warm nursery for ages 0 5"
    // normName = "little people at the limes"
    // extra after replace = "welcome to  a warm nursery for ages 0 5" → 9 words >= 4
    const desc = 'Welcome to Little People at The Limes, a warm nursery for ages 0–5.';
    expect(isMeaningfulDescription(desc, venueName)).toBe(true);
  });

  // Name-as-suffix with trivial prefix (e.g. "Welcome to Little People at The Limes")
  // is a borderline case — "Welcome to" = 2 extra words < 4 → correctly rejected.
  it('rejects a description that is just "Welcome to <venue name>" (trivial prefix, < 4 extra words)', () => {
    expect(isMeaningfulDescription(`Welcome to ${venueName}`, venueName)).toBe(false);
  });

  // Venue name with regex-special characters does not cause replace() to throw.
  it('handles venue names containing punctuation (no regex injection in Rule 2 replace)', () => {
    const nameWithPunct = "St. Peter's (Soft Play)";
    // normName = "st  peter s  soft play " (punct stripped to spaces, then collapsed)
    // After norm: "st  peter s  soft play" → "st peter s soft play"
    // A description that genuinely describes the venue passes.
    const desc = "St. Peter's (Soft Play) offers a safe indoor space for children under 5. Open daily.";
    expect(() => isMeaningfulDescription(desc, nameWithPunct)).not.toThrow();
    expect(isMeaningfulDescription(desc, nameWithPunct)).toBe(true);
  });

  // The venue name appearing twice in the text: String.replace replaces only the first
  // occurrence. The second occurrence remains in extraText, inflating the word count —
  // which makes the description MORE likely to pass, never to be falsely rejected.
  it('venue name appearing twice does not cause false rejection (replace is first-occurrence only)', () => {
    // "little people at the limes" appears twice; after replace of first occurrence:
    // extra = " at little people at the limes today open for sessions" → many words
    const desc = 'Little People at The Limes: at Little People at The Limes today, open for sessions.';
    expect(isMeaningfulDescription(desc, venueName)).toBe(true);
  });
});


// =============================================================================
// HARDENING FIX 2 — normaliseTelHref (percent-decode tel: hrefs)
// =============================================================================
describe('normaliseTelHref (FIX 2)', () => {
  it('decodes the Holmside %20 case to a valid number (not the bogus 2001919172205)', () => {
    // Old path stripped %20 into the digits "20" → "2001919172205". Now %20 → space.
    expect(normaliseTelHref('%2001919172205')).toBe('01919172205');
  });

  it('decodes an encoded +44 (%2B) and keeps the plus', () => {
    expect(normaliseTelHref('%2B447911123456')).toBe('+447911123456');
  });

  it('strips spaces and brackets from a national number', () => {
    expect(normaliseTelHref('(0191) 917 2205')).toBe('01919172205');
    expect(normaliseTelHref('0191 917 2205')).toBe('01919172205');
  });

  it('REJECTS malformed percent-encoding instead of stripping it into garbage', () => {
    expect(normaliseTelHref('%2G01919172205')).toBeNull();
    expect(normaliseTelHref('%')).toBeNull();
  });

  it('rejects an implausibly short decoded result', () => {
    expect(normaliseTelHref('%20123')).toBeNull();
  });
});

// =============================================================================
// HARDENING FIX 3 — isSaneDescription (parked spam / agency template / non-Latin)
// =============================================================================
describe('isSaneDescription (FIX 3)', () => {
  it('REJECTS Torre Cider parked-domain Chinese gambling spam', () => {
    const spam = '优游平台总代注册-ub8优游登陆注册_注册登录优游_优游平台官网下厨人民政府网由优游平台总代注册十堰市郧阳区人民政府主办';
    expect(isSaneDescription(spam)).toBe(false);
  });

  it("REJECTS Cookie's Island web-agency template boilerplate", () => {
    const template =
      'We create websites, mobile applications and business software that people love to use. Specialized in conversion optimization & E-commerce.';
    expect(isSaneDescription(template)).toBe(false);
  });

  it('REJECTS a parked "domain is for sale" placeholder', () => {
    expect(isSaneDescription('This domain is for sale. Buy this domain today.')).toBe(false);
  });

  it('ACCEPTS a valid short venue description', () => {
    expect(
      isSaneDescription('A family-run soft play centre in Epsom with a café and party rooms.'),
    ).toBe(true);
  });

  it('ACCEPTS legitimate multilingual venue content (non-Latin present but not dominant)', () => {
    // A few CJK characters in an otherwise English description must NOT be rejected.
    const bilingual =
      'Sushi & Play 寿司 is a Japanese-themed family café and soft play in Cardiff serving fresh food and fun for all ages.';
    expect(isSaneDescription(bilingual)).toBe(true);
  });
});

// =============================================================================
// HARDENING FIX — tightened isLikelyBookingUrl (no photos/offers/projects)
// =============================================================================
describe('isLikelyBookingUrl — tightened acceptance', () => {
  it('still accepts genuine booking/ticket links', () => {
    expect(isLikelyBookingUrl('https://x.digitickets.co.uk/buy', 'Book Now')).toBe(true);
    expect(isLikelyBookingUrl('https://ticketsource.com/x', 'Event tickets')).toBe(true);
    expect(isLikelyBookingUrl('https://x.com/ilford/prices', 'Booking & Prices')).toBe(true);
  });

  it('rejects photo galleries even when the page says "buy"', () => {
    expect(isLikelyBookingUrl('https://x.photodeck.com/', 'buy your photos here')).toBe(false);
  });

  it('rejects project pages that merely contain "reserve" (nature reserve)', () => {
    expect(
      isLikelyBookingUrl('https://x.org/nature-reserve-projects', 'Our nature reserve projects'),
    ).toBe(false);
  });

  it('rejects a generic offers/events link even with a BOOK NOW button', () => {
    expect(isLikelyBookingUrl('https://x.com/offers-events', 'BOOK NOW')).toBe(false);
  });
});

// =============================================================================
// bughunter follow-ups: tel extension params, low-letter-density descriptions
// =============================================================================
describe('normaliseTelHref — RFC 3966 extension params (bughunter BUG 4)', () => {
  it('drops a ;ext= suffix instead of appending the extension digits', () => {
    // Old behaviour appended the "9" → "+4417385610839" (a wrong number).
    expect(normaliseTelHref('+441738561083;ext=9')).toBe('+441738561083');
  });
  it('drops a ;isub= subaddress param', () => {
    expect(normaliseTelHref('01919172205;isub=1234')).toBe('01919172205');
  });
});

describe('isSaneDescription — low-letter-density garbage (bughunter BUG 2)', () => {
  it('rejects an emoji-only "description"', () => {
    expect(isSaneDescription('🎪🎪🎪🎪🎪🎪🎪🎪🎪🎪🎪🎪')).toBe(false);
  });
  it('rejects a digits/symbols-only string of real length', () => {
    expect(isSaneDescription('1234567890 / 0987654321 !!!')).toBe(false);
  });
  it('still accepts a genuine description that merely contains some digits', () => {
    expect(
      isSaneDescription('Open 7 days a week, 10am-6pm. A soft play centre for ages 0-11 in Leeds.'),
    ).toBe(true);
  });
  it('does NOT reject a legitimate venue description that mentions young people', () => {
    // 'people love to use' was removed as a marker (bughunter BUG 3).
    expect(
      isSaneDescription('Young people love to use our climbing wall and sensory garden every day.'),
    ).toBe(true);
  });
});
