// =============================================================================
// Tests for decision.ts — per-field decision engine + description composer.
//
// All tests are offline (no network, no DB). Covers the pilot-derived cases
// from DECISION_CONTRACT.md §11 plus edge cases for every field policy.
// =============================================================================

import {
  makeFieldDecisions,
  isCanonicalEquivalentWebsite,
  composeDescription,
  checkDescriptionQuality,
  hasHoursWarning,
  DECISION_ENGINE_VERSION,
  type VenueFacts,
  type DecisionInput,
} from '../decision';
import type { CurrentVenueSnapshot, FieldCandidate, OpeningWeek, DayHours } from '../../../../types/webEnrichment';
import type { FieldDecision } from '../../../../types/enrichmentDecision';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SRC = 'https://www.venue.co.uk/';
const AT = '2026-06-29T09:00:00.000Z';

function emptySnapshot(overrides: Partial<CurrentVenueSnapshot> = {}): CurrentVenueSnapshot {
  return {
    description: null,
    price_range: null,
    website: null,
    phone: null,
    email: null,
    opening_hours: [],
    ...overrides,
  };
}

function cand(
  over: Partial<FieldCandidate> & Pick<FieldCandidate, 'field' | 'value' | 'method'>,
): FieldCandidate {
  return {
    sourceUrl: SRC,
    evidenceSnippet: `evidence for ${over.field} at ${AT}`,
    ...over,
  };
}

function makeWeek(overrides?: { openClosed?: boolean; issues?: string[] }): OpeningWeek {
  const days: DayHours[] = Array.from({ length: 7 }, (_, i) => ({
    day_of_week: i,
    is_closed: overrides?.openClosed === false,
    intervals:
      overrides?.openClosed === false
        ? []
        : [{ opens: '09:00', closes: '17:00' }],
  }));
  return {
    days,
    seasonal_notes: null,
    source_text: 'Mo-Su 09:00-17:00',
  };
}

function makeCandidateWeek(issues: string[] = []): FieldCandidate {
  return cand({
    field: 'opening_hours',
    value: makeWeek(),
    method: 'jsonld',
    openingIssues: issues,
  });
}

function facts(overrides?: Partial<VenueFacts>): VenueFacts {
  return { name: 'Test Venue', categorySlug: 'soft-play', city: 'Bristol', ...overrides };
}

function makeInput(
  candidates: FieldCandidate[],
  snapshotOverrides: Partial<CurrentVenueSnapshot> = {},
  venueFactsOverrides: Partial<VenueFacts> = {},
  venueWebsite: string | null = null,
): DecisionInput {
  return {
    allCandidates: candidates,
    snapshot: emptySnapshot(snapshotOverrides),
    venueFacts: facts(venueFactsOverrides),
    venueWebsite,
  };
}

function findDecision(decisions: FieldDecision[], field: string): FieldDecision | undefined {
  return decisions.find((d) => d.field === field);
}

// ── isCanonicalEquivalentWebsite ──────────────────────────────────────────────

describe('isCanonicalEquivalentWebsite', () => {
  it('treats www vs non-www as equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('https://www.venue.co.uk/', 'https://venue.co.uk/'),
    ).toBe(true);
  });

  it('treats http vs https with same host as equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('http://venue.co.uk/', 'https://venue.co.uk/'),
    ).toBe(true);
  });

  it('treats trailing-slash vs no-slash as equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('https://venue.co.uk', 'https://venue.co.uk/'),
    ).toBe(true);
  });

  it('treats host casing difference as equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('https://VENUE.CO.UK/', 'https://venue.co.uk/'),
    ).toBe(true);
  });

  it('treats different paths as NOT equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('https://venue.co.uk/about', 'https://venue.co.uk/'),
    ).toBe(false);
  });

  it('treats different subdomain as NOT equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('https://shop.venue.co.uk/', 'https://venue.co.uk/'),
    ).toBe(false);
  });

  it('treats query string difference as NOT equivalent', () => {
    expect(
      isCanonicalEquivalentWebsite('https://venue.co.uk/?ref=google', 'https://venue.co.uk/'),
    ).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isCanonicalEquivalentWebsite('not-a-url', 'https://venue.co.uk/')).toBe(false);
  });
});

// ── §11 pilot: Hillview — canonical equivalent website → auto_reject ──────────

describe('§11 Hillview: canonical equivalent website', () => {
  it('auto_rejects www vs non-www canonical equivalent', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'website', value: 'https://hillviewfarm.co.uk', method: 'jsonld' })],
        { website: 'https://www.hillviewfarm.co.uk/' },
        {},
        'https://www.hillviewfarm.co.uk/',
      ),
    );
    const d = findDecision(decisions, 'website')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('canonical_equivalent_website');
  });

  it('auto_rejects trailing-slash equivalence', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'website', value: 'https://venue.co.uk', method: 'jsonld' })],
        { website: 'https://venue.co.uk/' },
        {},
        'https://venue.co.uk/',
      ),
    );
    const d = findDecision(decisions, 'website')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('canonical_equivalent_website');
  });

  it('routes meaningful path difference to manual_review when current present', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'website', value: 'https://venue.co.uk/book', method: 'jsonld' })],
        { website: 'https://venue.co.uk/' },
        {},
        'https://venue.co.uk/',
      ),
    );
    const d = findDecision(decisions, 'website')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('meaningful_url_difference');
  });

  it('auto_applies a new website when current is empty', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'website', value: 'https://venue.co.uk/', method: 'jsonld' })],
        { website: null },
        {},
        null,
      ),
    );
    const d = findDecision(decisions, 'website')!;
    expect(d.decision).toBe('auto_apply');
    expect(d.reasons).toContain('current_empty');
  });
});

// ── §11 pilot: Hollywood phone — auto_apply when current empty ────────────────

describe('§11 Hollywood: phone auto_apply when current empty', () => {
  it('auto_applies a single validated phone with empty current', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '+441234567890', method: 'jsonld' })],
        { phone: null },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('auto_apply');
    expect(d.reasons).toContain('current_empty');
    expect(d.reasons).toContain('single_validated_value');
    expect(d.reasons).toContain('official_domain_source');
    expect(d.chosen?.value).toBe('+441234567890');
  });

  it('routes phone to manual_review when current non-empty and different', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '+441234567890', method: 'jsonld' })],
        { phone: '+440987654321' },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
  });

  it('auto_rejects phone that equals the current stored value', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '+441234567890', method: 'jsonld' })],
        { phone: '+44 1234 567890' },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('equals_current');
  });

  it('auto_rejects a malformed phone with no valid digits', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '123', method: 'heuristic' })],
        { phone: null },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('malformed_value');
  });
});

// ── §11 Hollywood: opening_hours NOT auto_applied due to warning ──────────────

describe('§11 Hollywood: opening_hours NOT auto_applied due to "hours may change" warning', () => {
  it('routes to manual_review when evidence contains "hours may change"', () => {
    const candidate: FieldCandidate = {
      field: 'opening_hours',
      value: makeWeek(),
      method: 'jsonld',
      sourceUrl: SRC,
      evidenceSnippet: 'Mon-Sun 09:00-17:00. Note: hours may change without notice.',
      openingIssues: [],
    };
    const decisions = makeFieldDecisions(makeInput([candidate], { opening_hours: [] }));
    const d = findDecision(decisions, 'opening_hours')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('opening_hours_change_warning');
  });

  it('routes to manual_review when evidence contains "call to confirm"', () => {
    const candidate: FieldCandidate = {
      field: 'opening_hours',
      value: makeWeek(),
      method: 'heuristic',
      sourceUrl: SRC,
      evidenceSnippet: 'Mon-Fri 10:00-16:00. Please call to confirm opening times.',
      openingIssues: [],
    };
    const decisions = makeFieldDecisions(makeInput([candidate], { opening_hours: [] }));
    const d = findDecision(decisions, 'opening_hours')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('opening_hours_change_warning');
  });

  it('routes to manual_review when openingIssues contains seasonal', () => {
    const decisions = makeFieldDecisions(
      makeInput([makeCandidateWeek(['seasonal'])], { opening_hours: [] }),
    );
    const d = findDecision(decisions, 'opening_hours')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('opening_hours_change_warning');
  });

  it('auto_applies a clean full-week schedule with empty current', () => {
    const decisions = makeFieldDecisions(
      makeInput([makeCandidateWeek([])], { opening_hours: [] }),
    );
    const d = findDecision(decisions, 'opening_hours')!;
    expect(d.decision).toBe('auto_apply');
    expect(d.reasons).toContain('current_empty');
    expect(d.reasons).toContain('complete_week');
  });

  it('routes to manual_review when current opening_hours are present', () => {
    const existing: DayHours[] = [{ day_of_week: 1, is_closed: false, intervals: [{ opens: '10:00', closes: '16:00' }] }];
    const decisions = makeFieldDecisions(
      makeInput([makeCandidateWeek([])], { opening_hours: existing }),
    );
    const d = findDecision(decisions, 'opening_hours')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
  });

  it('routes to manual_review for partial week (assumed_closed_days)', () => {
    const decisions = makeFieldDecisions(
      makeInput([makeCandidateWeek(['assumed_closed_days'])], { opening_hours: [] }),
    );
    const d = findDecision(decisions, 'opening_hours')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('opening_hours_partial_week');
  });
});

// ── §11 Rascals: phone auto_apply ─────────────────────────────────────────────

describe('§11 Rascals: phone auto_apply', () => {
  it('auto_applies when there is exactly one validated phone and current is empty', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '01234567890', method: 'jsonld' })],
        { phone: null },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('auto_apply');
  });
});

// ── §11 Rascals: competing emails → manual_review ────────────────────────────

describe('§11 Rascals: competing emails', () => {
  it('routes to manual_review when there are competing emails', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [
          cand({ field: 'email', value: 'info@rascalssoftplay.co.uk', method: 'jsonld' }),
          cand({ field: 'email', value: 'rascals.softplay@gmail.com', method: 'heuristic' }),
        ],
        { email: null },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('competing_email');
  });

  it('includes official_domain_email_competes when one is official and one is free-mail', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [
          cand({ field: 'email', value: 'info@venue.co.uk', method: 'jsonld' }),
          cand({ field: 'email', value: 'venueowner@gmail.com', method: 'heuristic' }),
        ],
        { email: null },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('official_domain_email_competes');
  });

  it('auto_applies a single role email with empty current', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'info@venue.co.uk', method: 'jsonld' })],
        { email: null },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('auto_apply');
  });

  it('routes personal email to manual_review (not auto_apply)', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'jane.smith@venue.co.uk', method: 'jsonld' })],
        { email: null },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('manual_review');
    // Personal emails cannot be auto-applied per the contract.
  });

  it('auto_rejects a placeholder email', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'noreply@venue.co.uk', method: 'jsonld' })],
        { email: null },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('placeholder_value');
  });
});

// ── §11: Both booking URLs → report_only ─────────────────────────────────────

describe('§11: booking_url always report_only', () => {
  it('routes any booking URL candidate to report_only', () => {
    const decisions = makeFieldDecisions(
      makeInput([cand({ field: 'booking_url', value: 'https://book.venue.co.uk/', method: 'jsonld' })]),
    );
    const d = findDecision(decisions, 'booking_url')!;
    expect(d.decision).toBe('report_only');
    expect(d.reasons).toContain('booking_url_no_target_column');
    // Must never be an actionable card.
    expect(d.chosen?.value).toBe('https://book.venue.co.uk/');
  });

  it('report_only for a second booking URL', () => {
    const decisions = makeFieldDecisions(
      makeInput([
        cand({ field: 'booking_url', value: 'https://tickets.venue.co.uk/', method: 'heuristic' }),
      ]),
    );
    const d = findDecision(decisions, 'booking_url')!;
    expect(d.decision).toBe('report_only');
  });
});

// ── §11: Descriptions — 5 cases ───────────────────────────────────────────────

describe('§11: descriptions', () => {
  it('Case 1: manual_review when current empty and known category + city (description never auto_apply)', () => {
    const decisions = makeFieldDecisions(
      makeInput([], { description: null }, { name: 'Funhouse Soft Play', categorySlug: 'soft-play', city: 'Bristol' }),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('manual_review');
    expect(d.generatedText).toBe('Funhouse Soft Play is a soft play centre in Bristol.');
    expect(d.reasons).toContain('description_facts_sufficient');
    expect(d.reasons).not.toContain('current_empty');
  });

  it('Case 2: manual_review when category slug is unknown (one uncertainty)', () => {
    const decisions = makeFieldDecisions(
      makeInput([], { description: null }, { name: 'The Mega Playbarn', categorySlug: 'mega-playbarn', city: 'Leeds' }),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('description_one_uncertainty');
    expect(d.generatedText).toBe('The Mega Playbarn is a mega playbarn in Leeds.');
  });

  it('Case 3: report_only when no category slug', () => {
    const decisions = makeFieldDecisions(
      makeInput([], { description: null }, { name: 'Some Venue', categorySlug: null, city: 'Manchester' }),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('report_only');
    expect(d.reasons).toContain('insufficient_description_evidence');
    expect(d.generatedText).toBeUndefined();
  });

  it('Case 4: manual_review when current description is non-empty', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [],
        { description: 'Existing description text.' },
        { name: 'Fun Zone', categorySlug: 'indoor-play', city: 'Leeds' },
      ),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
    // Engine provides the draft — admin is never asked to write from scratch.
    expect(d.generatedText).toBeTruthy();
  });

  it('Case 5: manual_review with Pattern B (no city, known category; description never auto_apply)', () => {
    const decisions = makeFieldDecisions(
      makeInput([], { description: null }, { name: 'Jump Zone', categorySlug: 'trampoline-park', city: null }),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('description_facts_sufficient');
    expect(d.generatedText).toBe('Jump Zone is a trampoline park.');
  });
});

// ── Existing valid non-empty field is NOT auto_applied ────────────────────────

describe('existing valid non-empty field is NOT auto_applied', () => {
  it('phone: routes to manual_review when existing valid phone differs', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '+441111111111', method: 'jsonld' })],
        { phone: '+442222222222' },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
  });

  it('email: routes to manual_review when existing valid email differs', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'new@venue.co.uk', method: 'jsonld' })],
        { email: 'old@venue.co.uk' },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
  });

  it('price_range: routes to manual_review when current price differs', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'price_range', value: 'moderate', method: 'jsonld' })],
        { price_range: 'budget' },
      ),
    );
    const d = findDecision(decisions, 'price_range')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
  });
});

// ── Phone: multiple distinct values → conflict ────────────────────────────────

describe('phone: multiple distinct values', () => {
  it('routes to manual_review with multiple_values_conflict', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [
          cand({ field: 'phone', value: '+441234567890', method: 'jsonld' }),
          cand({ field: 'phone', value: '+440987654321', method: 'heuristic' }),
        ],
        { phone: null },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('multiple_values_conflict');
  });

  it('best-by-method wins (jsonld over heuristic)', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [
          cand({ field: 'phone', value: '+441234567890', method: 'jsonld' }),
          cand({ field: 'phone', value: '+440987654321', method: 'heuristic' }),
        ],
        { phone: null },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.chosen?.value).toBe('+441234567890');
  });
});

// ── Price range ───────────────────────────────────────────────────────────────

describe('price_range decisions', () => {
  it('auto_applies unambiguous free pricing when current empty', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'price_range', value: 'free', method: 'jsonld' })],
        { price_range: null },
      ),
    );
    const d = findDecision(decisions, 'price_range')!;
    expect(d.decision).toBe('auto_apply');
    expect(d.reasons).toContain('pricing_unambiguous');
  });

  it('routes to manual_review when multiple distinct prices conflict', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [
          cand({ field: 'price_range', value: 'free', method: 'jsonld' }),
          cand({ field: 'price_range', value: 'budget', method: 'microdata' }),
        ],
        { price_range: null },
      ),
    );
    const d = findDecision(decisions, 'price_range')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('price_ambiguous');
  });

  it('auto_rejects an invalid price band value', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'price_range', value: 'expensive', method: 'jsonld' })],
        { price_range: null },
      ),
    );
    const d = findDecision(decisions, 'price_range')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('malformed_value');
  });

  it('auto_rejects when price equals current', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'price_range', value: 'moderate', method: 'jsonld' })],
        { price_range: 'moderate' },
      ),
    );
    const d = findDecision(decisions, 'price_range')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('equals_current');
  });
});

// ── Description quality gates ─────────────────────────────────────────────────

describe('description quality checks', () => {
  it('passes a clean, factual 1-sentence description', () => {
    const failures = checkDescriptionQuality(
      'Funhouse Soft Play is a soft play centre in Bristol.',
      [],
    );
    expect(failures).toHaveLength(0);
  });

  it('fails a description containing banned filler phrases', () => {
    const failures = checkDescriptionQuality(
      'Venue is a great day out for all the family.',
      [],
    );
    expect(failures).toContain('description_failed_validation');
  });

  it('fails a description that is too short', () => {
    const failures = checkDescriptionQuality('Tiny.', []);
    expect(failures).toContain('description_failed_validation');
  });

  it('fails a description containing HTML tags', () => {
    const failures = checkDescriptionQuality(
      '<b>Venue</b> is a soft play centre in Bristol.',
      [],
    );
    expect(failures).toContain('description_failed_validation');
  });

  it('fails when composed text has a 6-word run matching source', () => {
    const sourceCandidate: FieldCandidate = {
      field: 'description',
      value: 'Jump Land is a trampoline park in Leeds for all ages.',
      sourceUrl: SRC,
      evidenceSnippet: 'source description',
      method: 'meta',
    };
    // Composed text contains same 6-word sequence as source.
    const failures = checkDescriptionQuality(
      'Jump Land is a trampoline park in Leeds.',
      [sourceCandidate],
    );
    expect(failures).toContain('description_failed_similarity');
  });

  it('passes when there is no source candidate to compare against', () => {
    const failures = checkDescriptionQuality(
      'Jump Land is a trampoline park in Leeds.',
      [],
    );
    expect(failures).toHaveLength(0);
  });
});

// ── Description composer patterns ─────────────────────────────────────────────

describe('composeDescription', () => {
  it('Pattern A: includes city when available', () => {
    const result = composeDescription({ name: 'Bounce Zone', categorySlug: 'trampoline-park', city: 'Liverpool' });
    expect(result?.text).toBe('Bounce Zone is a trampoline park in Liverpool.');
  });

  it('Pattern B: omits location when city is null', () => {
    const result = composeDescription({ name: 'Bounce Zone', categorySlug: 'trampoline-park', city: null });
    expect(result?.text).toBe('Bounce Zone is a trampoline park.');
  });

  it('Pattern B: omits location when city is empty string', () => {
    const result = composeDescription({ name: 'Bounce Zone', categorySlug: 'trampoline-park', city: '' });
    expect(result?.text).toBe('Bounce Zone is a trampoline park.');
  });

  it('returns null when categorySlug is null', () => {
    expect(composeDescription({ name: 'Venue', categorySlug: null, city: 'London' })).toBeNull();
  });

  it('returns null when categorySlug is empty string', () => {
    expect(composeDescription({ name: 'Venue', categorySlug: '', city: 'London' })).toBeNull();
  });

  it('falls back to slug→spaces for unknown category slugs', () => {
    const result = composeDescription({ name: 'Venue', categorySlug: 'mega-playbarn', city: null });
    expect(result?.text).toBe('Venue is a mega playbarn.');
    expect(result?.uncertainties).toContain('unknown_category_label');
  });

  it('has no uncertainties for known category slugs', () => {
    const result = composeDescription({ name: 'Venue', categorySlug: 'soft-play', city: 'York' });
    expect(result?.uncertainties).toHaveLength(0);
  });

  it('maps known slugs to correct labels', () => {
    const cases: [string, string][] = [
      ['indoor-play', 'indoor play centre'],
      ['farm', 'farm attraction'],
      ['swimming-pool', 'swimming pool'],
      ['museum', 'museum'],
      ['zoo', 'zoo'],
    ];
    for (const [slug, expectedLabel] of cases) {
      const result = composeDescription({ name: 'Test', categorySlug: slug, city: null });
      expect(result?.text).toContain(expectedLabel);
    }
  });
});

// ── hasHoursWarning ───────────────────────────────────────────────────────────

describe('hasHoursWarning', () => {
  it('detects "hours may change" in evidenceSnippet', () => {
    const c: FieldCandidate = {
      field: 'opening_hours',
      value: makeWeek(),
      sourceUrl: SRC,
      evidenceSnippet: 'Mon-Sun 9-5. Note: hours may change.',
      method: 'jsonld',
    };
    expect(hasHoursWarning(c)).toBe(true);
  });

  it('detects "call to confirm" in evidenceRaw', () => {
    const c: FieldCandidate = {
      field: 'opening_hours',
      value: makeWeek(),
      sourceUrl: SRC,
      evidenceSnippet: 'Mon-Sun 09:00-17:00',
      evidenceRaw: 'Please call to confirm hours before visiting.',
      method: 'heuristic',
    };
    expect(hasHoursWarning(c)).toBe(true);
  });

  it('returns false for clean evidence text', () => {
    const c: FieldCandidate = {
      field: 'opening_hours',
      value: makeWeek(),
      sourceUrl: SRC,
      evidenceSnippet: 'Mon-Sun 09:00-17:00',
      method: 'jsonld',
    };
    expect(hasHoursWarning(c)).toBe(false);
  });
});

// ── Batch summary counts ──────────────────────────────────────────────────────

describe('batch summary via makeFieldDecisions', () => {
  it('returns auto_apply for a clean phone candidate with empty current', () => {
    const decisions = makeFieldDecisions(
      makeInput([cand({ field: 'phone', value: '+441234567890', method: 'jsonld' })]),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('auto_apply');
  });

  it('returns report_only for description when no category slug', () => {
    const decisions = makeFieldDecisions(
      makeInput([], {}, { categorySlug: null }),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('report_only');
  });

  it('emits no decision for a field with zero candidates', () => {
    const decisions = makeFieldDecisions(makeInput([]));
    // No candidates → only description (always attempted) should appear.
    const fields = decisions.map((d) => d.field);
    expect(fields).not.toContain('phone');
    expect(fields).not.toContain('email');
    expect(fields).toContain('description');
  });

  it('DECISION_ENGINE_VERSION is stamped correctly', () => {
    expect(DECISION_ENGINE_VERSION).toBe('decision-engine@1.0.0');
  });
});

// ── Website: additional canonical variants ─────────────────────────────────────

describe('website: additional canonical variant cases', () => {
  it('auto_rejects http→https same host', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'website', value: 'http://venue.co.uk/', method: 'jsonld' })],
        { website: 'https://venue.co.uk/' },
        {},
        'https://venue.co.uk/',
      ),
    );
    const d = findDecision(decisions, 'website')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('canonical_equivalent_website');
  });

  it('routes subdomain to manual_review when current present', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'website', value: 'https://shop.venue.co.uk/', method: 'jsonld' })],
        { website: 'https://venue.co.uk/' },
        {},
        'https://venue.co.uk/',
      ),
    );
    const d = findDecision(decisions, 'website')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('meaningful_url_difference');
  });
});

// ── Email: equals current → auto_reject ──────────────────────────────────────

describe('email: dedup', () => {
  it('auto_rejects when the extracted email equals the stored email', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'Info@Venue.co.uk', method: 'jsonld' })],
        { email: 'info@venue.co.uk' },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('equals_current');
  });
});

// ── Phone: national vs E.164 dedup (FIX 1 regression) ────────────────────────

describe('phone: GB national vs E.164 dedup', () => {
  it('treats 01234567890 and +441234567890 as equal (no proposal)', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '01234567890', method: 'heuristic' })],
        { phone: '+441234567890' },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('equals_current');
  });

  it('still flags a genuinely different UK number as a conflict', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'phone', value: '01234999999', method: 'heuristic' })],
        { phone: '+441234567890' },
      ),
    );
    const d = findDecision(decisions, 'phone')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('would_replace_existing');
  });
});

// ── Fix A regression: single free-mail email ─────────────────────────────────

describe('Fix A: single free-mail email is never auto_apply (T1, T2)', () => {
  // T1: info@gmail.com with empty current → manual_review (not auto_apply)
  it('T1: single free-mail with empty current → manual_review, NOT auto_apply', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'info@gmail.com', method: 'jsonld' })],
        { email: null },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('manual_review');
    expect(d.reasons).toContain('current_empty');
    expect(d.reasons).toContain('single_validated_value');
    // Free-mail must NOT appear as an official-domain source
    expect(d.reasons).not.toContain('official_domain_source');
  });

  // T2: free-mail equal to stored value → auto_reject (equals_current, not manual_review)
  it('T2: single free-mail equal to current value → auto_reject (equals_current)', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [cand({ field: 'email', value: 'info@gmail.com', method: 'jsonld' })],
        { email: 'info@gmail.com' },
      ),
    );
    const d = findDecision(decisions, 'email')!;
    expect(d.decision).toBe('auto_reject');
    expect(d.reasons).toContain('equals_current');
  });
});

// ── Fix D regression: description always manual_review (Td) ──────────────────

describe('Fix D: description is NEVER auto_apply (Td)', () => {
  // Td: sufficient facts, empty current, no uncertainties → manual_review (not auto_apply)
  it('Td: sufficient facts + empty current → manual_review with generatedText, NOT auto_apply', () => {
    const decisions = makeFieldDecisions(
      makeInput(
        [],
        { description: null },
        { name: 'Sunshine Farm', categorySlug: 'farm', city: 'Oxford' },
      ),
    );
    const d = findDecision(decisions, 'description')!;
    expect(d.decision).toBe('manual_review');
    expect(d.decision).not.toBe('auto_apply');
    expect(d.reasons).toContain('description_facts_sufficient');
    expect(d.generatedText).toBeTruthy();
    expect(d.generatedText).toBe('Sunshine Farm is a farm attraction in Oxford.');
  });
});
