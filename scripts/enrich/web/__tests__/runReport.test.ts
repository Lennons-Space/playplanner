// =============================================================================
// Tests for run-level report renderers in report.ts:
//   renderRunJson, renderRunCsv, renderRunHtml
//
// Covers: valid JSON, CSV rows (proposals + zero-proposal venues), HTML escaping
// of all website-derived fields (XSS), summary header in HTML.
// =============================================================================

import { renderRunJson, renderRunCsv, renderRunHtml } from '../report';
import type { RunReport } from '../orchestrate';
import type { ProposalDraft } from '../../../../types/webEnrichment';
import type { EnrichmentBatchSummary } from '../../../../types/enrichmentDecision';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AT = '2026-06-22T12:00:00.000Z';

const xssPayload = `<script>alert('xss')</script>`;
const xssSourceUrl = 'https://venue.co.uk/';

const xssDraft: ProposalDraft = {
  field: 'description',
  proposed_value: { v: `Visit us! ${xssPayload}` },
  current_value: null,
  source_url: xssSourceUrl,
  evidence_snippet: `Evidence with ${xssPayload} injected`,
  evidence_raw: null,
  retrieved_at: AT,
  extraction_method: 'meta',
  confidence: 'medium',
  conflicts_existing: false,
};

const normalDraft: ProposalDraft = {
  field: 'phone',
  proposed_value: { v: '+441234567890' },
  current_value: null,
  source_url: 'https://venue.co.uk/',
  evidence_snippet: 'Call us: +441234567890',
  evidence_raw: null,
  retrieved_at: AT,
  extraction_method: 'jsonld',
  confidence: 'high',
  conflicts_existing: false,
};

const emptyBatchSummary: EnrichmentBatchSummary = {
  venuesProcessed: 2,
  safeChangesReady: 0,
  exceptions: 0,
  suppressed: 0,
  failures: 0,
  wouldReplaceNonEmpty: false,
  fieldsAffected: [],
};

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runLabel: 'test-run-2026-06-22',
    generatedAt: AT,
    venues: [
      {
        venueId: 'v-with-proposals',
        name: 'Venue With Proposals',
        website: 'https://venue.co.uk/',
        outcome: 'extracted',
        pages: [{ url: 'https://venue.co.uk/', httpStatus: 200, contentSha256: 'abc', bytes: 1000, fetchedAt: AT }],
        proposals: [normalDraft],
        decisions: [],
      },
      {
        venueId: 'v-skipped',
        name: 'Skipped Venue',
        website: null,
        outcome: 'skipped_no_website',
        pages: [],
        proposals: [],
        decisions: [],
      },
    ],
    summary: {
      venuesProcessed: 2,
      byOutcome: { extracted: 1, skipped_no_website: 1 },
      totalProposals: 1,
      proposalsByConfidence: { high: 1, medium: 0, low: 0 },
    },
    batchSummary: emptyBatchSummary,
    ...overrides,
  };
}

// ── renderRunJson ─────────────────────────────────────────────────────────────

describe('renderRunJson', () => {
  it('produces valid JSON that round-trips to equal the report', () => {
    const report = makeReport();
    const json = renderRunJson(report);
    const parsed = JSON.parse(json) as RunReport;
    expect(parsed.runLabel).toBe(report.runLabel);
    expect(parsed.venues).toHaveLength(2);
    expect(parsed.summary.totalProposals).toBe(1);
  });

  it('includes all venue outcomes in JSON', () => {
    const json = renderRunJson(makeReport());
    expect(json).toContain('skipped_no_website');
    expect(json).toContain('extracted');
  });

  it('preserves raw evidence snippet in JSON (not escaped)', () => {
    const report = makeReport({
      venues: [
        {
          venueId: 'v1',
          name: 'XSS Venue',
          website: xssSourceUrl,
          outcome: 'extracted',
          pages: [],
          proposals: [xssDraft],
          decisions: [],
        },
      ],
      summary: { venuesProcessed: 1, byOutcome: { extracted: 1 }, totalProposals: 1, proposalsByConfidence: { high: 0, medium: 1, low: 0 } },
    });
    const json = renderRunJson(report);
    // JSON preserves raw text — the XSS string should appear as-is
    expect(json).toContain(xssPayload);
  });
});

// ── renderRunCsv ──────────────────────────────────────────────────────────────

describe('renderRunCsv', () => {
  it('produces a header row with all expected columns', () => {
    const csv = renderRunCsv(makeReport());
    const header = csv.split('\n')[0]!;
    expect(header).toContain('venue_id');
    expect(header).toContain('venue_name');
    expect(header).toContain('outcome');
    expect(header).toContain('field');
    expect(header).toContain('confidence');
    expect(header).toContain('source_url');
    expect(header).toContain('evidence_snippet');
  });

  it('includes one row per proposal (plus the venue with proposals)', () => {
    const csv = renderRunCsv(makeReport());
    const lines = csv.split('\n');
    // header + 1 proposal row + 1 zero-proposal (skip) row = 3 lines
    expect(lines.length).toBe(3);
  });

  it('includes a row for zero-proposal (skipped) venues', () => {
    const csv = renderRunCsv(makeReport());
    expect(csv).toContain('skipped_no_website');
    expect(csv).toContain('v-skipped');
  });

  it('quotes fields containing commas', () => {
    const report = makeReport({
      venues: [
        {
          venueId: 'v1',
          name: 'Venue, With Comma',
          website: 'https://venue.co.uk/',
          outcome: 'extracted',
          pages: [],
          proposals: [normalDraft],
          decisions: [],
        },
      ],
      summary: { venuesProcessed: 1, byOutcome: { extracted: 1 }, totalProposals: 1, proposalsByConfidence: { high: 1, medium: 0, low: 0 } },
    });
    const csv = renderRunCsv(report);
    expect(csv).toContain('"Venue, With Comma"');
  });

  it('includes venue_id and venue_name columns in proposal rows', () => {
    const csv = renderRunCsv(makeReport());
    expect(csv).toContain('v-with-proposals');
    expect(csv).toContain('Venue With Proposals');
  });
});

// ── renderRunHtml ─────────────────────────────────────────────────────────────

describe('renderRunHtml (XSS + structure)', () => {
  it('is valid HTML (starts with doctype, contains title)', () => {
    const html = renderRunHtml(makeReport());
    expect(html.trim().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>');
    expect(html).toContain('</html>');
  });

  it('HTML-escapes evidence_snippet containing script tags', () => {
    const report = makeReport({
      venues: [
        {
          venueId: 'v1',
          name: 'XSS Venue',
          website: xssSourceUrl,
          outcome: 'extracted',
          pages: [],
          proposals: [xssDraft],
          decisions: [],
        },
      ],
      summary: { venuesProcessed: 1, byOutcome: { extracted: 1 }, totalProposals: 1, proposalsByConfidence: { high: 0, medium: 1, low: 0 } },
    });
    const html = renderRunHtml(report);
    // The raw <script> tag should NOT appear unescaped
    expect(html).not.toContain(`<script>alert('xss')</script>`);
    // It should be HTML-escaped
    expect(html).toContain('&lt;script&gt;');
  });

  it('HTML-escapes venue name', () => {
    const report = makeReport({
      venues: [
        {
          venueId: 'v1',
          name: `Venue <img onerror="steal()">`,
          website: 'https://venue.co.uk/',
          outcome: 'extracted',
          pages: [],
          proposals: [],
          decisions: [],
        },
      ],
      summary: { venuesProcessed: 1, byOutcome: { extracted: 1 }, totalProposals: 0, proposalsByConfidence: { high: 0, medium: 0, low: 0 } },
    });
    const html = renderRunHtml(report);
    expect(html).not.toContain('<img onerror=');
    expect(html).toContain('&lt;img');
  });

  it('HTML-escapes proposed value', () => {
    const report = makeReport({
      venues: [
        {
          venueId: 'v1',
          name: 'Test Venue',
          website: xssSourceUrl,
          outcome: 'extracted',
          pages: [],
          proposals: [xssDraft],
          decisions: [],
        },
      ],
      summary: { venuesProcessed: 1, byOutcome: { extracted: 1 }, totalProposals: 1, proposalsByConfidence: { high: 0, medium: 1, low: 0 } },
    });
    const html = renderRunHtml(report);
    // Proposed value includes xssPayload — should be escaped
    expect(html).not.toContain(`<script>alert`);
  });

  it('HTML-escapes source_url (defence against javascript: URIs)', () => {
    const jsDraft: ProposalDraft = {
      ...normalDraft,
      source_url: `javascript:alert('xss')`,
    };
    const report = makeReport({
      venues: [
        {
          venueId: 'v1',
          name: 'Test Venue',
          website: 'https://venue.co.uk/',
          outcome: 'extracted',
          pages: [],
          proposals: [jsDraft],
          decisions: [],
        },
      ],
      summary: { venuesProcessed: 1, byOutcome: { extracted: 1 }, totalProposals: 1, proposalsByConfidence: { high: 1, medium: 0, low: 0 } },
    });
    const html = renderRunHtml(report);
    // javascript: URI must not appear unescaped
    expect(html).not.toContain(`javascript:alert('xss')`);
  });

  it('includes a run summary section with venue count and proposal totals', () => {
    const html = renderRunHtml(makeReport());
    expect(html).toContain('Run summary');
    expect(html).toContain('test-run-2026-06-22');
    // Venue count and proposal count appear
    expect(html).toContain('2'); // venuesProcessed
    expect(html).toContain('1'); // totalProposals
  });

  it('includes per-venue sections for all venues', () => {
    const html = renderRunHtml(makeReport());
    expect(html).toContain('Venue With Proposals');
    expect(html).toContain('Skipped Venue');
  });

  it('shows "No decisions" for zero-proposal/zero-decision venues', () => {
    const html = renderRunHtml(makeReport());
    // Skipped Venue has no decisions — the decision section renders the no-decisions message.
    expect(html).toContain('No decisions');
  });

  it('shows outcome in each per-venue section', () => {
    const html = renderRunHtml(makeReport());
    expect(html).toContain('skipped_no_website');
    expect(html).toContain('extracted');
  });

  it('run label appears HTML-escaped in the title', () => {
    const report = makeReport({ runLabel: `run <xss>` });
    const html = renderRunHtml(report);
    expect(html).not.toContain('<xss>');
    expect(html).toContain('&lt;xss&gt;');
  });
});
