// =============================================================================
// Tests for openingHours.ts (spec matrix rows 5, 6, 7, 8 + schema.org).
// Updated for FIX 2: closes_before_opens rejection + evidence-sufficiency guard.
// =============================================================================

import { parseOpeningHours, parseSchemaOrgHours } from '../openingHours';
import type { DayHours } from '../../../../types/webEnrichment';

function day(week: DayHours[], dow: number): DayHours {
  const d = week.find((x) => x.day_of_week === dow);
  if (!d) throw new Error(`no day ${dow}`);
  return d;
}

describe('parseOpeningHours — basic week', () => {
  it('parses Mo-Su 10:00-17:30 into 7 open days', () => {
    const r = parseOpeningHours('Mo-Su 10:00-17:30');
    expect(r.ok).toBe(true);
    expect(r.week?.days).toHaveLength(7);
    expect(day(r.week!.days, 1).intervals).toEqual([{ opens: '10:00', closes: '17:30' }]);
    expect(day(r.week!.days, 0).is_closed).toBe(false);
    expect(r.issues).not.toContain('assumed_closed_days');
  });

  it('24/7 opens every day', () => {
    const r = parseOpeningHours('24/7');
    expect(r.ok).toBe(true);
    expect(day(r.week!.days, 3).intervals).toEqual([{ opens: '00:00', closes: '24:00' }]);
  });
});

describe('split hours (row 5)', () => {
  it('keeps both intervals and flags split + assumed-closed', () => {
    const r = parseOpeningHours('Mo-Fr 09:00-12:00,14:00-17:00');
    expect(r.ok).toBe(true);
    expect(day(r.week!.days, 1).intervals).toEqual([
      { opens: '09:00', closes: '12:00' },
      { opens: '14:00', closes: '17:00' },
    ]);
    expect(r.issues).toContain('split_hours');
    expect(r.issues).toContain('assumed_closed_days'); // Sat/Sun not mentioned
    expect(day(r.week!.days, 6).is_closed).toBe(true);
  });
});

describe('seasonal notes (row 6)', () => {
  it('captures term-time note and flags seasonal', () => {
    const r = parseOpeningHours('Mo-Su 10:00-17:00; term-time only');
    expect(r.ok).toBe(true);
    expect(r.week?.seasonal_notes?.toLowerCase()).toContain('term');
    expect(r.issues).toContain('seasonal');
    // the seasonal phrase is not treated as a (failed) time rule
    expect(r.issues).not.toContain('unparseable');
  });
});

describe('closed days (row 7)', () => {
  it('marks Sunday closed when "Su off"', () => {
    const r = parseOpeningHours('Mo-Sa 09:00-17:00; Su off');
    expect(r.ok).toBe(true);
    expect(day(r.week!.days, 0).is_closed).toBe(true);
    expect(day(r.week!.days, 6).is_closed).toBe(false);
    expect(r.issues).not.toContain('assumed_closed_days'); // all 7 mentioned
  });
});

describe('malformed / empty (row 8)', () => {
  it('returns ok:false with no week on unparseable input', () => {
    const r = parseOpeningHours('open whenever the sun shines');
    expect(r.ok).toBe(false);
    expect(r.week).toBeUndefined();
    expect(r.issues).toContain('unparseable');
  });

  it('returns ok:false on empty string', () => {
    expect(parseOpeningHours('').ok).toBe(false);
  });
});

// ── FIX 2a: closes_before_opens rejection ─────────────────────────────────────

describe('FIX 2a — closes before opens (Apple Tree heuristic regression)', () => {
  // Regression: "Friday 08:00-05:00" must NOT produce a 7-day week.
  it('rejects "Friday 08:00-05:00" — closes before opens, no overnight cue', () => {
    const r = parseOpeningHours('Friday 08:00-05:00');
    expect(r.ok).toBe(false);
    expect(r.week).toBeUndefined();
    // Either closes_before_opens or insufficient_week_evidence (or both) will fire.
    expect(r.issues.some((i) => i === 'closes_before_opens' || i === 'insufficient_week_evidence')).toBe(true);
  });

  it('rejects a closes-before-opens interval in any position', () => {
    // Fr 22:00-21:00 is invalid (not an overnight close, just wrong)
    const r = parseOpeningHours('Mo-Fr 09:00-17:00; Sa 22:00-21:00');
    // The Sa interval is invalid, but we still have Mo-Fr (5 days) → ok:true or ok:false
    // depending on whether parseTimes returning null aborts the full rule.
    // The rule with the bad time returns null → that rule is skipped (unparseable).
    // Mo-Fr alone has 5 days → passes evidence threshold → ok:true with issues.
    expect(r.ok).toBe(true);
    expect(r.issues).toContain('closes_before_opens');
  });

  it('accepts a legitimate end-of-day 24:00 close (not closes-before-opens)', () => {
    // 08:00-24:00 is valid (24:00 is the end-of-day sentinel)
    const r = parseOpeningHours('Mo-Fr 08:00-24:00');
    expect(r.ok).toBe(true);
    expect(r.issues).not.toContain('closes_before_opens');
  });
});

// ── FIX 2b: evidence-sufficiency guard ────────────────────────────────────────

describe('FIX 2b — evidence sufficiency (thin fragment rejection)', () => {
  // A single isolated day with no range → ok:false (insufficient_week_evidence).
  it('rejects a single-day fragment ("Friday 09:00-17:00")', () => {
    const r = parseOpeningHours('Friday 09:00-17:00');
    expect(r.ok).toBe(false);
    expect(r.week).toBeUndefined();
    expect(r.issues).toContain('insufficient_week_evidence');
  });

  it('rejects a two-day fragment (only 2 explicit days, no range)', () => {
    const r = parseOpeningHours('Monday 09:00-17:00; Tuesday 09:00-17:00');
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('insufficient_week_evidence');
  });

  // Mo-Fr is a 5-day range (the OSM convention for "weekdays") → ok:true.
  it('accepts "Mo-Fr 09:00-17:00" (5-day range — recognised complete-week convention)', () => {
    const r = parseOpeningHours('Mo-Fr 09:00-17:00');
    expect(r.ok).toBe(true);
    expect(r.week?.days).toHaveLength(7);
    expect(day(r.week!.days, 1).is_closed).toBe(false); // Mon open
    expect(day(r.week!.days, 0).is_closed).toBe(true);  // Sun assumed closed
    expect(r.issues).toContain('assumed_closed_days');
  });

  // Mo-Sa + Su off → 7 days accounted for → ok:true.
  it('accepts "Mo-Sa 09:00-17:00; Su off" (full 7-day explicit coverage)', () => {
    const r = parseOpeningHours('Mo-Sa 09:00-17:00; Su off');
    expect(r.ok).toBe(true);
    expect(day(r.week!.days, 0).is_closed).toBe(true);
    expect(r.issues).not.toContain('assumed_closed_days');
  });

  // Three individual days explicitly mentioned → ok:true (threshold = 3).
  it('accepts three individually-listed days (meets threshold)', () => {
    const r = parseOpeningHours('Monday 09:00-17:00; Wednesday 10:00-16:00; Friday 09:00-17:00');
    expect(r.ok).toBe(true);
    expect(r.week?.days).toHaveLength(7);
  });

  // 24/7 → all 7 days → ok:true.
  it('24/7 always passes evidence check', () => {
    expect(parseOpeningHours('24/7').ok).toBe(true);
  });

  // Weekend-only venues ("Sa-Su 10:00-17:00") produce exactly 2 mentioned days —
  // below the threshold of 3. This is an accepted false-negative: a human enricher
  // can add the hours manually, which is preferable to asserting Mon-Fri closed when
  // we simply don't know ("unknown is better than wrong").
  it('weekend-only "Sa-Su 10:00-17:00" returns ok:false (accepted trade-off: 2 days < threshold 3)', () => {
    const r = parseOpeningHours('Sa-Su 10:00-17:00');
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('insufficient_week_evidence');
    // No week is emitted — no incorrect "Mon-Fri closed" assumption.
    expect(r.week).toBeUndefined();
  });

  // Three days crossing the threshold: Sa, Su, plus one weekday → ok:true.
  it('weekend + one weekday (3 days total) passes evidence check', () => {
    const r = parseOpeningHours('Sa-Su 10:00-17:00; Friday 14:00-18:00');
    expect(r.ok).toBe(true);
    expect(r.week?.days).toHaveLength(7);
  });
});

// ── FIX 2: seven-day guarantee on success ─────────────────────────────────────

describe('7-day guarantee on success', () => {
  it('always emits exactly 7 DayHours entries on ok:true', () => {
    const cases = [
      'Mo-Su 10:00-17:00',
      'Mo-Fr 09:00-17:00',
      'Mo-Sa 09:00-17:00; Su off',
      'Monday 09:00-17:00; Tuesday 10:00-16:00; Wednesday 09:00-17:00',
      '24/7',
    ];
    for (const c of cases) {
      const r = parseOpeningHours(c);
      if (r.ok) {
        expect(r.week?.days).toHaveLength(7);
      }
    }
  });
});

describe('parseSchemaOrgHours', () => {
  // Updated for FIX 2b: a 2-day spec (Mon + Sat) now fails the evidence-sufficiency
  // guard (threshold = 3 distinct days or a range spanning ≥ 5). Schema.org specs
  // with only 1–2 days are too thin to infer a full week from.
  it('returns ok:false for a 2-day spec (insufficient week evidence)', () => {
    const r = parseSchemaOrgHours([
      { dayOfWeek: 'https://schema.org/Monday', opens: '09:00', closes: '17:00' },
      { dayOfWeek: ['https://schema.org/Saturday'], opens: '10:00:00', closes: '16:00:00' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('insufficient_week_evidence');
  });

  it('accepts a schema.org spec with 5 weekdays + explicit weekend', () => {
    const r = parseSchemaOrgHours([
      { dayOfWeek: 'https://schema.org/Monday',    opens: '09:00', closes: '17:00' },
      { dayOfWeek: 'https://schema.org/Tuesday',   opens: '09:00', closes: '17:00' },
      { dayOfWeek: 'https://schema.org/Wednesday', opens: '09:00', closes: '17:00' },
      { dayOfWeek: 'https://schema.org/Thursday',  opens: '09:00', closes: '17:00' },
      { dayOfWeek: 'https://schema.org/Friday',    opens: '09:00', closes: '17:00' },
      { dayOfWeek: 'https://schema.org/Saturday',  opens: '10:00', closes: '16:00' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.week?.days).toHaveLength(7);
    expect(day(r.week!.days, 1).intervals).toEqual([{ opens: '09:00', closes: '17:00' }]);
    expect(day(r.week!.days, 6).intervals).toEqual([{ opens: '10:00', closes: '16:00' }]);
    expect(day(r.week!.days, 0).is_closed).toBe(true); // Sunday assumed closed
    expect(r.issues).toContain('assumed_closed_days');
  });

  it('rejects an empty spec array', () => {
    expect(parseSchemaOrgHours([]).ok).toBe(false);
  });
});

// =============================================================================
// HARDENING FIX 1 — duplicate-day conflict guard.
// Same weekday stated more than once with DIFFERENT (overlapping) intervals =>
// conflict => no week emitted. Identical duplicates dedup; genuine split hours
// and valid structured weeks are preserved.
// =============================================================================
describe('parseOpeningHours — duplicate-day conflict guard (FIX 1)', () => {
  it('rejects the Holmside case (Friday & Sunday each stated twice, conflicting)', () => {
    const r = parseOpeningHours(
      'Monday 10:00-16:00; Tuesday 10:00-16:00; Friday 10:00-16:00; ' +
        'Sunday 10:00-18:00; Friday 10:00-18:00; Sunday 10:00-18:00',
    );
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('conflicting_hours');
  });

  it('rejects the AirHop case (Monday & Thursday stated twice, conflicting)', () => {
    const r = parseOpeningHours(
      'Monday 06:00-19:00; Mon 10:00-19:00; Thu 15:00-19:00; Fri 10:00-20:00; ' +
        'Sat 09:00-20:00; Sun 09:00-18:00; Thu 09:00-19:00',
    );
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('conflicting_hours');
  });

  it('treats IDENTICAL duplicate intervals as deduplicable, not conflicting', () => {
    const r = parseOpeningHours(
      'Mon 10:00-18:00; Tue 10:00-18:00; Wed 10:00-18:00; Mon 10:00-18:00',
    );
    expect(r.ok).toBe(true);
    expect(r.issues).not.toContain('conflicting_hours');
    expect(day(r.week!.days, 1).intervals).toEqual([{ opens: '10:00', closes: '18:00' }]);
  });

  it('PRESERVES genuine split hours (non-overlapping lunch break)', () => {
    const r = parseOpeningHours('Mo-We 09:00-12:00,14:00-17:00');
    expect(r.ok).toBe(true);
    expect(r.issues).toContain('split_hours');
    expect(r.issues).not.toContain('conflicting_hours');
    expect(day(r.week!.days, 1).intervals).toEqual([
      { opens: '09:00', closes: '12:00' },
      { opens: '14:00', closes: '17:00' },
    ]);
  });

  it('PRESERVES a valid structured schema.org week (no false conflict)', () => {
    const r = parseSchemaOrgHours([
      { dayOfWeek: 'https://schema.org/Sunday',    opens: '09:00', closes: '23:00' },
      { dayOfWeek: 'https://schema.org/Monday',    opens: '10:00', closes: '23:00' },
      { dayOfWeek: 'https://schema.org/Tuesday',   opens: '10:00', closes: '23:00' },
      { dayOfWeek: 'https://schema.org/Wednesday', opens: '10:00', closes: '23:00' },
      { dayOfWeek: 'https://schema.org/Thursday',  opens: '10:00', closes: '23:00' },
      { dayOfWeek: 'https://schema.org/Friday',    opens: '10:00', closes: '24:00' },
      { dayOfWeek: 'https://schema.org/Saturday',  opens: '09:00', closes: '24:00' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues).not.toContain('conflicting_hours');
    expect(r.week?.days).toHaveLength(7);
  });
});

// =============================================================================
// bughunter follow-ups: touching-edge split (BUG 12) + schema backward interval
// =============================================================================
describe('parseOpeningHours — touching-edge split is NOT a conflict (BUG 12)', () => {
  it('keeps Mo-Fr 09:00-12:00,12:00-17:00 (back-to-back, no overlap)', () => {
    const r = parseOpeningHours('Mo-Fr 09:00-12:00,12:00-17:00');
    expect(r.ok).toBe(true);
    expect(r.issues).not.toContain('conflicting_hours');
    expect(day(r.week!.days, 1).intervals).toEqual([
      { opens: '09:00', closes: '12:00' },
      { opens: '12:00', closes: '17:00' },
    ]);
  });
});

describe('parseSchemaOrgHours — rejects a backward interval (bughunter residual)', () => {
  it('does not store a closes<opens spec and flags closes_before_opens', () => {
    const r = parseSchemaOrgHours([
      { dayOfWeek: 'https://schema.org/Monday',    opens: '17:00', closes: '09:00' }, // backward
      { dayOfWeek: 'https://schema.org/Tuesday',   opens: '09:00', closes: '17:00' },
      { dayOfWeek: 'https://schema.org/Wednesday', opens: '09:00', closes: '17:00' },
    ]);
    expect(r.issues).toContain('closes_before_opens');
    // Monday must NOT carry the bogus backward interval.
    if (r.ok) expect(day(r.week!.days, 1).intervals).toEqual([]);
  });
});

describe('parseSchemaOrgHours — midnight "00:00" close is end-of-day, not backward', () => {
  it('keeps a late-night 10:00-00:00 day as 10:00-24:00 with NO closes_before_opens', () => {
    const r = parseSchemaOrgHours([
      { dayOfWeek: 'https://schema.org/Friday',   opens: '10:00', closes: '00:00' },
      { dayOfWeek: 'https://schema.org/Saturday', opens: '09:00', closes: '00:00' },
      { dayOfWeek: 'https://schema.org/Sunday',   opens: '09:00', closes: '23:00' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues).not.toContain('closes_before_opens');
    expect(day(r.week!.days, 5).intervals).toEqual([{ opens: '10:00', closes: '24:00' }]);
  });
});
