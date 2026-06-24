// =============================================================================
// Tests for report.ts — HTML escaping end-to-end (row 23) + CSV quoting.
// =============================================================================

import { renderCsvReport, renderHtmlReport, renderJsonReport } from '../report';
import type { ProposalDraft } from '../../../../types/webEnrichment';

const xssDraft: ProposalDraft = {
  field: 'description',
  proposed_value: { v: 'Visit us!' },
  current_value: null,
  source_url: 'https://venue.co.uk/',
  evidence_snippet: `Visit us! <img src=x onerror='steal()'>`,
  evidence_raw: null,
  retrieved_at: '2026-06-22T12:00:00.000Z',
  extraction_method: 'meta',
  confidence: 'medium',
  conflicts_existing: false,
};

describe('renderHtmlReport (row 23 — XSS)', () => {
  const html = renderHtmlReport([xssDraft]);
  it('escapes website-derived evidence', () => {
    expect(html).toContain('&lt;img src=x onerror=&#x27;steal()&#x27;&gt;');
    expect(html).not.toContain('<img src=x');
  });
});

describe('renderCsvReport', () => {
  it('quotes a field containing a comma', () => {
    const d = { ...xssDraft, evidence_snippet: 'a, b, c' };
    expect(renderCsvReport([d])).toContain('"a, b, c"');
  });
});

describe('renderJsonReport', () => {
  it('round-trips to the same draft array', () => {
    expect(JSON.parse(renderJsonReport([xssDraft]))).toEqual([xssDraft]);
  });
});
