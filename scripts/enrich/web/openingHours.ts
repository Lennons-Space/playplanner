// =============================================================================
// scripts/enrich/web/openingHours.ts
//
// Pure opening-hours normalisation (spec §7). Two inputs:
//   parseOpeningHours(raw)       — OSM-style string ("Mo-Fr 09:00-17:00; Sa off")
//   parseSchemaOrgHours(specs)   — schema.org openingHoursSpecification array
//
// Guarantees on success (ok:true):
//   - week.days has EXACTLY 7 entries (day_of_week 0=Sun … 6=Sat). Days the source
//     never mentions default to is_closed:true (issue 'assumed_closed_days'), so the
//     apply RPC's replace-whole-week is always given a complete week.
//   - split hours, seasonal text and assumptions are surfaced in `issues` so the
//     confidence layer can cap the proposal at 'medium'.
// On failure (ok:false): NO week is returned — the caller emits no proposal (§7e).
// "Unknown is better than wrong."
//
// No I/O, deterministic. No '@/' path alias.
// =============================================================================

import type {
  DayHours,
  HourInterval,
  OpeningParseResult,
  OpeningWeek,
} from '../../../types/webEnrichment';

// 0=Sun … 6=Sat (matches the opening_hours table's day_of_week).
const DAY_INDEX: Record<string, number> = {
  su: 0, sun: 0, sunday: 0,
  mo: 1, mon: 1, monday: 1,
  tu: 2, tue: 2, tues: 2, tuesday: 2,
  we: 3, wed: 3, weds: 3, wednesday: 3,
  th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fr: 5, fri: 5, friday: 5,
  sa: 6, sat: 6, saturday: 6,
};

const SEASONAL_SOURCE =
  '\\b(term[\\s-]?time|school holidays?|seasonal|bank holidays?|easter|christmas|closed\\s+(?:in\\s+)?(?:jan(?:uary)?|feb(?:ruary)?|nov(?:ember)?|dec(?:ember)?|winter|summer))\\b';

// Fresh instances per call — never share a global regex's lastIndex state.
const seasonalGlobalRe = (): RegExp => new RegExp(SEASONAL_SOURCE, 'gi');
const seasonalTestRe = (): RegExp => new RegExp(SEASONAL_SOURCE, 'i');

// ── Public: OSM-style string ──────────────────────────────────────────────────

export function parseOpeningHours(raw: string): OpeningParseResult {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, issues: ['empty'] };

  const issues = new Set<string>();
  const seasonalNotes = collectSeasonal(text, issues);

  const dayIntervals = new Map<number, HourInterval[]>();
  const mentioned = new Set<number>();
  let anyParsed = false;

  for (const ruleRaw of text.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule) continue;

    // A bare seasonal phrase (already captured as a note) is not a time rule.
    if (isPureSeasonal(rule)) continue;

    // Strip any seasonal phrase from a mixed rule so it doesn't break time parsing.
    const cleaned = rule.replace(seasonalGlobalRe(), '').trim();
    if (!cleaned) continue;

    if (/^24\/7$/i.test(cleaned)) {
      for (let d = 0; d < 7; d++) addInterval(dayIntervals, mentioned, d, { opens: '00:00', closes: '24:00' });
      anyParsed = true;
      continue;
    }

    const parsed = parseRule(cleaned, issues);
    if (!parsed) {
      issues.add('unparseable');
      continue;
    }
    for (const d of parsed.days) {
      mentioned.add(d);
      if (parsed.closed) {
        // Explicit closed: mark mentioned with no intervals (handled in build).
        if (!dayIntervals.has(d)) dayIntervals.set(d, []);
      } else {
        for (const iv of parsed.intervals) addInterval(dayIntervals, mentioned, d, iv);
      }
    }
    anyParsed = true;
  }

  if (!anyParsed || mentioned.size === 0) {
    issues.add('unparseable');
    return { ok: false, issues: [...issues] };
  }

  return buildWeek(dayIntervals, mentioned, text, seasonalNotes, issues);
}

// ── Public: schema.org openingHoursSpecification ──────────────────────────────

export interface SchemaOrgHourSpec {
  dayOfWeek?: string | string[];
  opens?: string;
  closes?: string;
}

export function parseSchemaOrgHours(
  specs: SchemaOrgHourSpec[],
  sourceText = 'schema.org/openingHoursSpecification',
): OpeningParseResult {
  if (!Array.isArray(specs) || specs.length === 0) {
    return { ok: false, issues: ['empty'] };
  }

  const issues = new Set<string>();
  const dayIntervals = new Map<number, HourInterval[]>();
  const mentioned = new Set<number>();

  for (const spec of specs) {
    const days = toDayList(spec.dayOfWeek);
    if (days.length === 0) continue;
    const opens = normaliseTime(spec.opens);
    let closes = normaliseTime(spec.closes);
    // schema.org commonly uses "00:00" to mean MIDNIGHT (end of day) for
    // late-closing venues (e.g. a bowling alley "10:00-00:00"). Treat that as
    // the '24:00' end-of-day sentinel so it is not mistaken for a backward
    // interval — otherwise valid late-night hours would be dropped.
    if (closes === '00:00' && !!opens && opens !== '00:00') closes = '24:00';
    // Reject a genuinely backward interval (closes < opens, '24:00' excepted) —
    // a structured spec like opens 17:00 / closes 09:00 is bad data and must NOT
    // become a (high-confidence) week. Mirrors the OSM closes_before_opens guard.
    const backward = !!opens && !!closes && closes !== '24:00' && closes < opens;
    if (backward) issues.add('closes_before_opens');
    for (const d of days) {
      mentioned.add(d);
      if (opens && closes && !backward) {
        addInterval(dayIntervals, mentioned, d, { opens, closes });
      } else if (!dayIntervals.has(d)) {
        dayIntervals.set(d, []); // listed but no/invalid times → treat as closed
      }
    }
  }

  if (mentioned.size === 0) return { ok: false, issues: ['unparseable'] };
  return buildWeek(dayIntervals, mentioned, sourceText, null, issues);
}

// ── Shared assembly ───────────────────────────────────────────────────────────

/**
 * FIX 2b — Evidence-sufficiency check.
 *
 * A thin single-day fragment like "Friday 08:00-05:00" (now also rejected by
 * the closes_before_opens guard) or "Friday 09:00-17:00" (valid, but isolated)
 * must NOT silently produce a 7-day week with 6 assumed-closed days. That would
 * be "unknown is better than wrong" — we'd be asserting Mon-Thu and Sat-Sun are
 * closed when we simply don't know.
 *
 * Threshold: we require the source to explicitly mention at least 3 distinct days
 * OR to contain a recognised contiguous day-range (Mo-Fr, Mo-Su, etc.) that spans
 * at least 5 days. The contiguous-range case is detected by checking whether
 * mentioned.size ≥ 5 and all mentioned days form a consecutive block in the week.
 *
 * This preserves:
 *   - "Mo-Fr 09:00-17:00" → 5-day range → ok (the standard "weekdays open" pattern)
 *   - "Mo-Sa 09:00-17:00; Su off" → 7 explicitly accounted → ok
 *   - 24/7 → 7 mentioned → ok
 *   - "Friday 09:00-17:00" alone (1 day, no range cue) → insufficient → ok:false
 */
function hasSufficientWeekEvidence(mentioned: Set<number>): boolean {
  // Threshold: the source must explicitly mention at least 3 distinct days.
  // A single-day or two-day fragment (e.g. "Friday 09:00-17:00" or "Sa-Su 10:00-17:00")
  // is insufficient to infer a 7-day week — the 5 assumed-closed days would be
  // asserted as fact when we simply don't know ("unknown is better than wrong").
  //
  // Trade-off: a genuine weekend-only venue ("Sa-Su 10:00-17:00", 2 days) returns
  // ok:false and emits no proposal. A human enricher can add it manually. This is
  // preferable to silently asserting Mon-Fri are closed when they might just be missing.
  //
  // Ranges (e.g. "Mo-Fr") expand to all intermediate days, so a 5-day weekday range
  // already yields mentioned.size = 5 which passes. The previously present Case B
  // (mentioned.size >= 5) was unreachable dead code (subsumed by this >= 3 check)
  // and has been removed.
  return mentioned.size >= 3;
}

function buildWeek(
  dayIntervals: Map<number, HourInterval[]>,
  mentioned: Set<number>,
  sourceText: string,
  seasonalNotes: string | null,
  issues: Set<string>,
): OpeningParseResult {
  // FIX 2b: reject thin fragments before building the full week.
  if (!hasSufficientWeekEvidence(mentioned)) {
    issues.add('insufficient_week_evidence');
    return { ok: false, issues: [...issues] };
  }

  const days: DayHours[] = [];
  let hasSplit = false;
  let assumedClosed = false;

  for (let d = 0; d < 7; d++) {
    const intervals = sortIntervals(dayIntervals.get(d) ?? []);
    const wasMentioned = mentioned.has(d);
    if (!wasMentioned) assumedClosed = true;
    if (intervals.length > 1) hasSplit = true;

    // HARDENING FIX 1: a weekday that carries two OVERLAPPING intervals is a
    // CONFLICT, not split hours — it means the same day was stated more than
    // once with different times (e.g. term-time vs holiday hours mashed
    // together: "Fri 10:00-16:00" and "Fri 10:00-18:00"). We cannot tell which
    // is correct, so we emit NO week ("unknown is better than wrong").
    // Genuine split hours (a lunch break: 09:00-12:00, 14:00-17:00) do NOT
    // overlap and are preserved. Identical duplicates were already collapsed by
    // addInterval, so they never reach here as a conflict.
    if (hasOverlap(intervals)) {
      issues.add('conflicting_hours');
      return { ok: false, issues: [...issues] };
    }

    days.push({
      day_of_week: d,
      is_closed: intervals.length === 0,
      intervals,
    });
  }

  if (hasSplit) issues.add('split_hours');
  if (assumedClosed) issues.add('assumed_closed_days');
  if (seasonalNotes) issues.add('seasonal');

  // Guarantee: days always has exactly 7 entries (the apply RPC's replace-whole-week
  // depends on this). The above loop always runs for d = 0..6.
  const week: OpeningWeek = { days, seasonal_notes: seasonalNotes, source_text: sourceText };
  return { ok: true, week, issues: [...issues] };
}

// ── Rule parsing ──────────────────────────────────────────────────────────────

interface ParsedRule {
  days: number[];
  closed: boolean;
  intervals: HourInterval[];
}

function parseRule(rule: string, issues: Set<string>): ParsedRule | null {
  // Time-only rule (no day prefix) → applies to all 7 days.
  if (/^[0-9]/.test(rule) || /^(off|closed)$/i.test(rule)) {
    const intervals = parseTimes(rule, issues);
    if (intervals === null) return null;
    return { days: [0, 1, 2, 3, 4, 5, 6], closed: intervals.length === 0, intervals };
  }

  const m = rule.match(/^([A-Za-z][A-Za-z,\- ]*?)\s+(.+)$/);
  if (!m || !m[1] || !m[2]) {
    // Maybe a day-only token meaning "closed"? e.g. handled above; otherwise fail.
    return null;
  }
  const days = expandDaySpec(m[1], issues);
  if (days.length === 0) return null;

  const intervals = parseTimes(m[2], issues);
  if (intervals === null) return null;
  return { days, closed: intervals.length === 0, intervals };
}

/** "Mo-Fr,Su" → [1,2,3,4,5,0]. Unknown tokens add an issue but don't fail the rule. */
function expandDaySpec(spec: string, issues: Set<string>): number[] {
  const out = new Set<number>();
  for (const token of spec.split(',')) {
    const t = token.trim().toLowerCase();
    if (!t) continue;
    const range = t.match(/^([a-z]+)-([a-z]+)$/);
    if (range && range[1] && range[2]) {
      const a = DAY_INDEX[range[1]];
      const b = DAY_INDEX[range[2]];
      if (a === undefined || b === undefined) {
        issues.add('unknown_day_token');
        continue;
      }
      // Inclusive range with week-wrap (e.g. Sa-Su → 6,0).
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
    } else {
      const idx = DAY_INDEX[t];
      if (idx === undefined) {
        issues.add('unknown_day_token');
        continue;
      }
      out.add(idx);
    }
  }
  return [...out];
}

/** "09:00-12:00,14:00-17:00" → intervals; "off"/"closed" → []; invalid → null. */
function parseTimes(spec: string, issues: Set<string>): HourInterval[] | null {
  const s = spec.trim();
  if (/^(off|closed)$/i.test(s)) return [];

  // An explicit overnight/24-hour cue allows closes < opens.
  // We don't have the raw per-rule context here (it was cleaned), but the
  // spec only injects times at this point — a 24/7 rule is handled upstream
  // before parseTimes is called, and the "overnight" keyword would appear in
  // the raw rule text. Since we do not thread the raw text into parseTimes,
  // we conservatively require closes >= opens unless closes is '24:00'.
  const hasOvernightCue = /overnight|24\s*hour|24h/i.test(s);

  const intervals: HourInterval[] = [];
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!m || !m[1] || !m[2]) {
      issues.add('unparseable_time');
      return null;
    }
    const opens = normaliseTime(m[1]);
    const closes = normaliseTime(m[2]);
    if (!opens || !closes) {
      issues.add('unparseable_time');
      return null;
    }
    // FIX 2a: reject closes < opens unless:
    //   - closes is the end-of-day sentinel '24:00' (always valid), or
    //   - the spec string contains an explicit overnight cue keyword.
    // "Friday 08:00-05:00" with no such cue → closes_before_opens → reject.
    if (closes !== '24:00' && !hasOvernightCue && closes < opens) {
      issues.add('closes_before_opens');
      return null;
    }
    intervals.push({ opens, closes });
  }
  return intervals;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addInterval(
  map: Map<number, HourInterval[]>,
  mentioned: Set<number>,
  day: number,
  iv: HourInterval,
): void {
  mentioned.add(day);
  const list = map.get(day) ?? [];
  if (!list.some((x) => x.opens === iv.opens && x.closes === iv.closes)) list.push(iv);
  map.set(day, list);
}

function sortIntervals(list: HourInterval[]): HourInterval[] {
  return [...list].sort((a, b) => a.opens.localeCompare(b.opens));
}

/**
 * True when any two intervals in a single day overlap. Times are zero-padded
 * 'HH:MM' (with '24:00' as the end-of-day sentinel), so lexical comparison is
 * chronological. Touching edges (one closes exactly when the next opens) do NOT
 * count as overlap — that's a legitimate back-to-back split.
 */
function hasOverlap(intervals: HourInterval[]): boolean {
  const sorted = sortIntervals(intervals);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.opens < prev.closes) return true;
  }
  return false;
}

/** 'HH:MM' / 'HH:MM:SS' / 'H:MM' → 'HH:MM'; validates ranges. '24:00' allowed. */
function normaliseTime(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m || !m[1] || !m[2]) return null;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mins) || mins > 59) return null;
  if (h > 24 || (h === 24 && mins !== 0)) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function toDayList(dayOfWeek: string | string[] | undefined): number[] {
  if (!dayOfWeek) return [];
  const arr = Array.isArray(dayOfWeek) ? dayOfWeek : [dayOfWeek];
  const out = new Set<number>();
  for (const raw of arr) {
    const name = String(raw).split('/').pop()?.trim().toLowerCase() ?? '';
    const idx = DAY_INDEX[name];
    if (idx !== undefined) out.add(idx);
  }
  return [...out];
}

function collectSeasonal(text: string, issues: Set<string>): string | null {
  const matches = text.match(seasonalGlobalRe());
  if (!matches || matches.length === 0) return null;
  issues.add('seasonal');
  // De-duplicate, preserve order, normalise spacing.
  const seen: string[] = [];
  for (const m of matches) {
    const norm = m.replace(/\s+/g, ' ').trim();
    if (!seen.some((s) => s.toLowerCase() === norm.toLowerCase())) seen.push(norm);
  }
  return seen.join(' | ');
}

/**
 * True when a rule carries a seasonal phrase but no time/day content of its own
 * (e.g. "term-time only", "closed January") — it is a note, not a schedule rule.
 */
function isPureSeasonal(rule: string): boolean {
  if (!seasonalTestRe().test(rule)) return false;
  if (/\d/.test(rule)) return false; // has times → treat as a (seasonal-stripped) time rule
  return !hasDayToken(rule);
}

function hasDayToken(rule: string): boolean {
  for (const word of rule.toLowerCase().split(/[^a-z]+/)) {
    if (word && DAY_INDEX[word] !== undefined) return true;
  }
  return false;
}
