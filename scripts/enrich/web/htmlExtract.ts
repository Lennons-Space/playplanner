// =============================================================================
// scripts/enrich/web/htmlExtract.ts
//
// Pure extractor (spec §6a). An HTML string → field candidates with evidence.
// Tiers run highest-confidence first; the FIRST tier to produce a field wins
// (later tiers only fill gaps):
//   1. JSON-LD (schema.org)   2. microdata (itemprop)   3. meta/OG   4. heuristics
//
// Regex/string based on purpose: no DOM library → zero deps, fully deterministic,
// trivially fixture-testable. Never throws on missing/garbage markup (returns the
// candidates found so far). Every evidence snippet is PII-scrubbed and ≤512 chars.
//
// No I/O, no network. No '@/' path alias.
// =============================================================================

import type {
  ExtractedCandidates,
  ExtractionMethod,
  FieldCandidate,
  OpeningWeek,
  WebField,
} from '../../../types/webEnrichment';
import { cleanEvidence } from './sanitize';
import { isSafeUrl } from './urlSafety';
import { parseOpeningHours, parseSchemaOrgHours, type SchemaOrgHourSpec } from './openingHours';
import {
  isLikelyBookingUrl,
  isSaneDescription,
  mapPriceToBand,
  normalisePhone,
  normaliseTelHref,
} from './fields';

export function extractCandidates(html: string, sourceUrl: string): ExtractedCandidates {
  const found = new Map<WebField, FieldCandidate>();

  const add = (
    field: WebField,
    value: unknown,
    method: ExtractionMethod,
    evidenceText: string,
    extra?: { evidenceRaw?: string; keep?: string; openingIssues?: string[] },
  ): void => {
    if (found.has(field)) return; // first tier wins
    if (value === null || value === undefined || value === '') return;
    // HARDENING FIX 3: drop garbage descriptions (parked-domain foreign spam,
    // agency/placeholder boilerplate) at the extraction layer, before they
    // become a candidate. Name-equality is handled later in the orchestrator.
    if (field === 'description' && typeof value === 'string' && !isSaneDescription(value)) return;
    found.set(field, {
      field,
      value,
      sourceUrl,
      method,
      evidenceSnippet: cleanEvidence(evidenceText, extra?.keep),
      ...(extra?.evidenceRaw ? { evidenceRaw: extra.evidenceRaw } : {}),
      ...(extra?.openingIssues ? { openingIssues: extra.openingIssues } : {}),
    });
  };

  collectFromJsonLd(html, add);
  collectFromMicrodata(html, add);
  collectFromMeta(html, add);
  collectFromHeuristics(html, add);

  return { candidates: [...found.values()] };
}

type AddFn = (
  field: WebField,
  value: unknown,
  method: ExtractionMethod,
  evidenceText: string,
  extra?: { evidenceRaw?: string; keep?: string; openingIssues?: string[] },
) => void;

// ── Tier 1: JSON-LD ───────────────────────────────────────────────────────────

function collectFromJsonLd(html: string, add: AddFn): void {
  for (const obj of parseJsonLdObjects(html)) {
    const o = obj as Record<string, unknown>;

    if (typeof o['description'] === 'string') {
      add('description', o['description'], 'jsonld', o['description']);
    }
    if (typeof o['priceRange'] === 'string') {
      const band = mapPriceToBand(o['priceRange']);
      if (band) add('price_range', band, 'jsonld', o['priceRange']);
    }
    if (typeof o['telephone'] === 'string') {
      const phone = normalisePhone(o['telephone']);
      if (phone) add('phone', phone, 'jsonld', o['telephone'], { keep: phone });
    }
    if (typeof o['email'] === 'string') {
      add('email', o['email'].trim(), 'jsonld', o['email'], { keep: o['email'].trim() });
    }
    if (typeof o['url'] === 'string' && isSafeUrl(o['url']).safe) {
      add('website', o['url'], 'jsonld', o['url']);
    }

    const ohs = o['openingHoursSpecification'];
    if (Array.isArray(ohs)) {
      const result = parseSchemaOrgHours(ohs as SchemaOrgHourSpec[]);
      if (result.ok && result.week) {
        add('opening_hours', result.week, 'jsonld', summariseWeek(result.week), {
          evidenceRaw: JSON.stringify(ohs).slice(0, 2048),
          openingIssues: result.issues,
        });
      }
    }

    const booking = readReserveActionUrl(o);
    if (booking && isSafeUrl(booking).safe) {
      add('booking_url', booking, 'jsonld', booking);
    }
  }
}

function parseJsonLdObjects(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const block = (m[1] ?? '').trim();
    if (!block) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue; // malformed JSON-LD is skipped, never throws
    }
    for (const node of flattenJsonLd(parsed)) out.push(node);
  }
  return out;
}

function flattenJsonLd(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o['@graph'])) return (o['@graph'] as unknown[]).flatMap(flattenJsonLd);
    return [o];
  }
  return [];
}

function readReserveActionUrl(o: Record<string, unknown>): string | null {
  const action = o['potentialAction'];
  const actions = Array.isArray(action) ? action : action ? [action] : [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const ao = a as Record<string, unknown>;
    const type = String(ao['@type'] ?? '');
    if (!/Reserve|Order/i.test(type)) continue;
    const target = ao['target'];
    if (typeof target === 'string') return target;
    if (target && typeof target === 'object') {
      const url = (target as Record<string, unknown>)['urlTemplate'] ?? (target as Record<string, unknown>)['url'];
      if (typeof url === 'string') return url;
    }
    if (typeof ao['url'] === 'string') return ao['url'];
  }
  return null;
}

// ── Tier 2: microdata (itemprop) ──────────────────────────────────────────────

function collectFromMicrodata(html: string, add: AddFn): void {
  const tel = getItemprop(html, 'telephone');
  if (tel) {
    const phone = normalisePhone(tel);
    if (phone) add('phone', phone, 'microdata', tel, { keep: phone });
  }
  const email = getItemprop(html, 'email');
  if (email) add('email', email.trim(), 'microdata', email, { keep: email.trim() });

  const price = getItemprop(html, 'priceRange');
  if (price) {
    const band = mapPriceToBand(price);
    if (band) add('price_range', band, 'microdata', price);
  }
  const desc = getItemprop(html, 'description');
  if (desc) add('description', desc, 'microdata', desc);

  const hours = getItemprop(html, 'openingHours');
  if (hours) {
    const result = parseOpeningHours(hours);
    if (result.ok && result.week) {
      add('opening_hours', result.week, 'microdata', hours, {
        evidenceRaw: hours,
        openingIssues: result.issues,
      });
    }
  }
}

/** First itemprop value: prefer a `content="..."` attr, else the element's text. */
function getItemprop(html: string, prop: string): string | null {
  const contentRe = new RegExp(
    `<[^>]*itemprop=["']${prop}["'][^>]*\\bcontent=["']([^"']+)["'][^>]*>`,
    'i',
  );
  const cm = html.match(contentRe);
  if (cm && cm[1]) return decodeEntities(cm[1]).trim();

  const textRe = new RegExp(
    `<([a-z0-9]+)[^>]*itemprop=["']${prop}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  );
  const tm = html.match(textRe);
  if (tm && tm[2]) {
    const text = stripTags(tm[2]).trim();
    if (text) return text;
  }
  return null;
}

// ── Tier 3: meta / OpenGraph ──────────────────────────────────────────────────

function collectFromMeta(html: string, add: AddFn): void {
  const desc =
    getMetaContent(html, 'name', 'description') ?? getMetaContent(html, 'property', 'og:description');
  if (desc) add('description', desc, 'meta', desc);
}

function getMetaContent(html: string, attr: 'name' | 'property', key: string): string | null {
  // content before or after the name/property attribute — try both orders.
  const re1 = new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key}["'][^>]*>`, 'i');
  const m = html.match(re1) ?? html.match(re2);
  if (m && m[1]) {
    const v = decodeEntities(m[1]).trim();
    return v || null;
  }
  return null;
}

// ── Tier 4: heuristics ────────────────────────────────────────────────────────

function collectFromHeuristics(html: string, add: AddFn): void {
  // tel: links — percent-decode the RFC 3966 href before normalising (FIX 2).
  const tel = matchFirst(html, /href=["']tel:([^"']+)["']/i);
  if (tel) {
    const phone = normaliseTelHref(decodeEntities(tel));
    if (phone) add('phone', phone, 'heuristic', `tel: ${tel}`, { keep: phone });
  }
  // mailto: links
  const mail = matchFirst(html, /href=["']mailto:([^"'?]+)/i);
  if (mail) {
    const email = decodeEntities(mail).trim();
    add('email', email, 'heuristic', `mailto: ${email}`, { keep: email });
  }
  // booking anchors
  for (const a of iterateAnchors(html)) {
    if (!isSafeUrl(a.href).safe) continue;
    if (isLikelyBookingUrl(a.href, a.text)) {
      add('booking_url', a.href, 'heuristic', `${a.text} → ${a.href}`);
      break;
    }
  }

  const text = stripTags(html);

  // price_range: heuristic page-text pricing is SUPPRESSED for the pilot
  // (HARDENING FIX). A bare "£N" anywhere on the page is too ambiguous — it
  // picked up tennis-court hire on a free park, photo prices, etc. Only the
  // explicit, structured jsonld/microdata `priceRange` (handled in tiers 1/2)
  // is unambiguous venue-level pricing, so only those are proposed.

  // opening hours: collect "Day HH:MM-HH:MM" segments, feed to the OSM parser.
  const hoursRules = collectHourSegments(text);
  if (hoursRules.length > 0) {
    const result = parseOpeningHours(hoursRules.join('; '));
    if (result.ok && result.week) {
      add('opening_hours', result.week, 'heuristic', hoursRules.join('; '), {
        evidenceRaw: hoursRules.join('; '),
        openingIssues: result.issues,
      });
    }
  }
}

const DAY_WORD =
  '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';

function collectHourSegments(text: string): string[] {
  const re = new RegExp(
    `\\b(${DAY_WORD})\\b[^a-z0-9]{0,4}` +
      `(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\s*(?:-|–|—|to)\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const day = m[1];
    const t1 = to24h(m[2] ?? '');
    const t2 = to24h(m[3] ?? '');
    if (day && t1 && t2) out.push(`${day} ${t1}-${t2}`);
  }
  return out;
}

function to24h(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m || !m[1]) return null;
  let h = Number(m[1]);
  const mins = m[2] ?? '00';
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 24) return null;
  return `${String(h).padStart(2, '0')}:${mins}`;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

interface Anchor {
  href: string;
  text: string;
}
function iterateAnchors(html: string): Anchor[] {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: Anchor[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ href: decodeEntities(m[1] ?? ''), text: stripTags(m[2] ?? '').trim() });
  }
  return out;
}

function matchFirst(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m && m[1] ? m[1] : null;
}

function stripTags(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return decodeEntities(noScript.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return (
    s
      // Numeric character references FIRST so e.g. a parked domain's CJK meta
      // description (&#20248;&#28216;…) becomes real characters — otherwise the
      // content-sanity gate only sees ASCII "&#…;" and waves the spam through.
      .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => codePointToStr(parseInt(hex, 16), m))
      .replace(/&#(\d+);/g, (m, dec: string) => codePointToStr(parseInt(dec, 10), m))
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
  );
}

/** Safe code-point → string; leaves the original entity intact if out of range. */
function codePointToStr(cp: number, original: string): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return original;
  }
  try {
    return String.fromCodePoint(cp);
  } catch {
    return original;
  }
}

function summariseWeek(week: OpeningWeek): string {
  const names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return week.days
    .map((d) =>
      d.is_closed
        ? `${names[d.day_of_week]} closed`
        : `${names[d.day_of_week]} ${d.intervals.map((i) => `${i.opens}-${i.closes}`).join(',')}`,
    )
    .join('; ');
}
