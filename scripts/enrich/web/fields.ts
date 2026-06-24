// =============================================================================
// scripts/enrich/web/fields.ts
//
// Pure, per-field helpers shared by the extractor and the proposals layer:
//   - mapPriceToBand          lossy £-text → the 4-bucket enum (capped 'medium' later)
//   - looksPersonalEmail      flag sole-trader-style addresses (firstname.lastname@)
//   - normalisePhone          digits/+ only, must carry >= 10 digits
//   - phoneDedupKey           canonical key for GB phone dedup (FIX 1)
//   - isLikelyBookingUrl      booking/ticket link heuristic
//   - isMeaningfulDescription quality filter for description candidates (FIX 4)
//
// No I/O, deterministic. No '@/' path alias.
// =============================================================================

import type { PriceBand } from '../../../types/webEnrichment';

// Role mailboxes are NOT personal data in the sole-trader sense.
const ROLE_LOCALS = new Set([
  'info', 'enquiries', 'enquiry', 'hello', 'hi', 'bookings', 'booking', 'admin',
  'contact', 'office', 'sales', 'reception', 'support', 'team', 'mail', 'events',
  'help', 'general', 'reservations',
]);

/**
 * firstname.lastname@… style → likely a personal address. Role mailboxes
 * (info@, bookings@, …) are excluded. Used to cap such proposals at 'low'.
 */
export function looksPersonalEmail(email: string): boolean {
  const at = email.indexOf('@');
  if (at <= 0) return false;
  const local = email.slice(0, at).toLowerCase();
  if (ROLE_LOCALS.has(local)) return false;
  // two alpha tokens joined by a dot/underscore: jane.smith, j_smith
  return /^[a-z]+[._][a-z]+$/.test(local);
}

/** Keep '+' and digits; require >= 10 digits, else null (not a usable phone). */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

/**
 * Normalise a `tel:` href value (HARDENING FIX 2).
 *
 * `tel:` href values are percent-encoded per RFC 3966, so a space is written
 * `%20` and a leading plus is `%2B`. The old path fed the RAW value straight to
 * normalisePhone, which strips non-digits — turning `tel:%2001919172205`
 * (" 01919172205") into the bogus "2001919172205" (the `%20` became the digits
 * "20"). Decode first, then normalise.
 *
 * Malformed percent-encoding (e.g. `%2G`, a stray `%`) is REJECTED outright
 * (returns null) rather than silently stripped — a half-broken escape can only
 * yield an implausible number.
 */
export function normaliseTelHref(raw: string): string | null {
  let decoded = raw;
  if (raw.includes('%')) {
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null; // malformed percent-encoding → not a trustworthy number
    }
  }
  // RFC 3966 allows extension / ISDN-subaddress params after a ';'
  // ("+441738561083;ext=9"). normalisePhone strips ';ext=' to bare digits and
  // would silently append the extension to the subscriber number — drop params.
  const withoutParams = decoded.split(';')[0] ?? decoded;
  return normalisePhone(withoutParams);
}

/**
 * Canonical dedup key for phone comparison. Collapses UK numbers so that
 * equivalent forms produce the same key:
 *   "+44 1738 561083" / "01738 561083" / "01738561083" / "+441738561083"
 *   → all produce "+441738561083"
 *
 * Non-UK numbers (+1…, +33…, etc.) are NOT coerced — their existing digit
 * string is preserved so genuinely different foreign numbers stay distinct.
 *
 * Rule:
 *   1. Strip all non-digit/non-plus characters.
 *   2. If starts with "+44" → keep as "+44<subscriber>" (already canonical).
 *   3. If starts with "0" AND total digits are 10–11 (UK national format)
 *      → convert to "+44<subscriber>" by dropping the leading 0.
 *   4. Otherwise → return the raw digit string (foreign or unknown format).
 *
 * Returns null for input that normalisePhone would reject (too short/long).
 */
export function phoneDedupKey(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');

  // Strip the informal GB trunk indicator written after the country code:
  // "+44 (0)1738 561083" → "+44 1738 561083"
  // This is a display convention (the 0 is not dialled internationally).
  const withoutTrunk = hasPlus ? trimmed.replace(/\(0\)/g, '') : trimmed;

  const digits = withoutTrunk.replace(/\D/g, '');

  // Reject lengths that normalisePhone would already reject.
  if (digits.length < 10 || digits.length > 15) return null;

  if (hasPlus && digits.startsWith('44')) {
    // Already E.164 GB: "+44 1738 561083" → digits="441738561083" → "+441738561083"
    return `+${digits}`;
  }

  // National GB format: starts with 0, 10–11 digits (0XXXXXXXXXX or 0XXXXXXXXX)
  if (!hasPlus && digits.startsWith('0') && digits.length >= 10 && digits.length <= 11) {
    // Drop the trunk 0, prefix with +44.
    return `+44${digits.slice(1)}`;
  }

  // Non-UK international (e.g. +1, +33) or ambiguous: return raw digit string.
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Booking/ticket link heuristic over anchor text + href (HARDENING FIX:
 * tightened so generic offers, photo galleries and project pages are NOT
 * proposed as booking links).
 *
 * A NEGATIVE gate runs first: links about photos/galleries, offers/vouchers,
 * projects, gift cards, news/blog are rejected even if they also say "book"
 * (e.g. "buy your photos here", "Our nature reserve projects", a "BOOK NOW"
 * button that points at /offers-events). Only then do the positive
 * booking/ticket signals apply.
 */
const BOOKING_NEGATIVE_RE =
  /\b(photos?|gallery|galleries|images?|photodeck|projects?|offers?|vouchers?|gift[\s-]?cards?|newsletter|blog|press)\b/;
const BOOKING_POSITIVE_RE =
  /\b(book(?:ing|\s?now|\s?online|\s?tickets?|\s?your|\s?a)?|e[-\s]?tickets?|tickets?|admission|reservations?|reserve\s+(?:a|your|now|table|tickets?))\b/;

export function isLikelyBookingUrl(href: string, anchorText: string): boolean {
  const hay = `${href} ${anchorText}`.toLowerCase();
  if (BOOKING_NEGATIVE_RE.test(hay)) return false;
  return BOOKING_POSITIVE_RE.test(hay);
}

/**
 * Content-sanity gate for a description candidate (HARDENING FIX 3).
 *
 * Rejects descriptions that are clearly NOT about the venue:
 *   1. Text dominated by non-Latin script (CJK / Cyrillic / Arabic / …). This
 *      catches parked/hijacked domains whose meta description is foreign spam
 *      (e.g. the Chinese gambling text served by a lapsed venue domain).
 *   2. Web-agency / placeholder / "domain for sale" boilerplate left on
 *      unfinished template sites (e.g. "We create websites … conversion
 *      optimization").
 *
 * It deliberately does NOT reject a legitimate description just because it
 * contains some non-Latin characters (a venue name in another script, a quoted
 * foreign word, genuine bilingual copy) — only when such text *dominates*.
 *
 * Note: a sane description is still capped at 'medium' confidence by
 * confidence.ts and is always manual-review / rewrite-required — this gate only
 * removes outright garbage, it does not bless the text.
 */
const SPAM_DESCRIPTION_MARKERS = [
  'we create websites',
  'mobile applications and business software',
  'conversion optimization',
  'conversion optimisation',
  'your next agency',
  'lorem ipsum',
  'just another wordpress site',
  'this domain is for sale',
  'this domain may be for sale',
  'domain is for sale',
  'buy this domain',
  'purchase this domain',
];

// Scripts whose dominance signals wrong-language / spam content (not UK venue copy).
const NON_LATIN_RE =
  /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯Ѐ-ӿ֐-׿؀-ۿ฀-๿]/g;
const LATIN_LETTER_RE = /[A-Za-zÀ-ɏ]/g;

export function isSaneDescription(text: string): boolean {
  const lower = text.toLowerCase();
  for (const marker of SPAM_DESCRIPTION_MARKERS) {
    if (lower.includes(marker)) return false;
  }

  const latin = (text.match(LATIN_LETTER_RE) ?? []).length;
  const nonLatin = (text.match(NON_LATIN_RE) ?? []).length;
  const totalLetters = latin + nonLatin;
  // Symbol/emoji/digit-only content, or a script not covered by NON_LATIN_RE,
  // yields ~no recognised letters. A genuine description is made of words, so a
  // non-trivial string with almost no letters is garbage (bughunter BUG 2).
  if (text.trim().length > 10 && totalLetters < 3) return false;
  // Only judge by script when there's enough text to judge (avoids nuking a
  // short legitimate multilingual name). Reject when non-Latin dominates (>50%).
  if (totalLetters >= 8 && nonLatin / totalLetters > 0.5) return false;

  return true;
}

/**
 * Map free-text pricing to the venues.price_range enum. Deliberately lossy — the
 * confidence layer caps these at 'medium' and they are always reviewed.
 *   free            no positive price + a free/no-charge cue
 *   budget          max ticket < £6
 *   moderate        £6–£15
 *   premium         > £15
 */
export function mapPriceToBand(text: string): PriceBand | null {
  const lower = text.toLowerCase();
  const amounts = extractPounds(lower);
  const hasFreeCue = /\b(free entry|free admission|free of charge|no charge|admission free|entry is free|free\b)/.test(lower);

  if (amounts.length === 0) {
    return hasFreeCue ? 'free' : null;
  }
  const max = Math.max(...amounts);
  if (max === 0) return 'free';
  if (max < 6) return 'budget';
  if (max <= 15) return 'moderate';
  return 'premium';
}

function extractPounds(lower: string): number[] {
  const out: number[] = [];
  const re = /£\s?(\d+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    if (m[1]) out.push(Number(m[1]));
  }
  return out;
}

/**
 * Returns false (reject) when a description candidate is just a name/title with
 * no real descriptive content. This prevents proposals like:
 *   text = "Little People at The Limes" (identical to the venue name)
 *
 * Rejection rules (any one is sufficient):
 *   1. The text is effectively identical to the venue name after normalising
 *      case, whitespace and punctuation.
 *   2. The venue name is a contiguous substring of the text AND the text adds
 *      fewer than 4 meaningful words beyond the name (trivial suffix rule,
 *      e.g. "Little People at The Limes – Nursery" → still just a title).
 *   3. The text has fewer than 8 words AND contains no sentence-ending
 *      punctuation (no '.', '!', '?') — very short title-like strings.
 *
 * Genuine multi-sentence descriptions pass all three tests and are kept.
 */
export function isMeaningfulDescription(text: string, venueName: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // strip punctuation
      .replace(/\s+/g, ' ')
      .trim();

  const normText = norm(text);
  const normName = norm(venueName);

  // Rule 1: effectively identical to venue name.
  if (normText === normName) return false;

  // Rule 2: venue name is a substring of the text and only trivial extra words.
  if (normName.length > 0 && normText.includes(normName)) {
    const extraText = normText.replace(normName, '').trim();
    const extraWords = extraText.split(/\s+/).filter(Boolean);
    if (extraWords.length < 4) return false;
  }

  // Rule 3: too short and no sentence structure.
  const wordCount = normText.split(/\s+/).filter(Boolean).length;
  const hasSentenceEnd = /[.!?]/.test(text);
  if (wordCount < 8 && !hasSentenceEnd) return false;

  return true;
}
