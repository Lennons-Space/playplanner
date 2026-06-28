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

// =============================================================================
// M2 — CSV formula-injection neutralisation tests (spec requirement B, cases 7–8)
// =============================================================================

describe('renderCsvReport — formula-injection neutralisation (M2)', () => {
  // Case 7a–7f: each formula-trigger character at the start of a cell value
  // must be neutralised by prefixing with a single quote.
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+99', "'+99"],
    ['-1', "'-1"],
    ['@foo', "'@foo"],
  ])('prefixes %s with a single quote to neutralise it', (raw, expected) => {
    const d = { ...xssDraft, evidence_snippet: raw };
    expect(renderCsvReport([d])).toContain(expected);
  });

  it('neutralises a tab-prefixed value', () => {
    const d = { ...xssDraft, evidence_snippet: '\ttabbed' };
    // Value starts with tab → prefixed; no comma so not quoted
    expect(renderCsvReport([d])).toContain("'\ttabbed");
  });

  it('neutralises a CR-prefixed value and CSV-quotes it (CR triggers both guards)', () => {
    const d = { ...xssDraft, evidence_snippet: '\rCR' };
    const csv = renderCsvReport([d]);
    // After prefix: '\rCR; CR in value → gets CSV-quoted: "'\rCR"
    expect(csv).toContain("'\rCR");
  });

  // Case 8: a normal value is unchanged (no spurious prefix, no spurious quoting)
  it('leaves a normal value like "Soft Play" unchanged', () => {
    const d = { ...xssDraft, evidence_snippet: 'Soft Play' };
    const csv = renderCsvReport([d]);
    expect(csv).toContain('Soft Play');
    // Must NOT be formula-prefixed
    const dataLine = csv.split('\n')[1]!;
    expect(dataLine).not.toContain("'Soft Play");
  });

  // Standard CSV quoting of a comma still works (regression guard)
  it('still CSV-quotes a normal comma value correctly', () => {
    const d = { ...xssDraft, evidence_snippet: 'a,b' };
    expect(renderCsvReport([d])).toContain('"a,b"');
  });

  // Both guards together: formula trigger + comma → prefix then quote
  it('applies prefix AND quoting when a formula cell also contains a comma', () => {
    const d = { ...xssDraft, evidence_snippet: '=1,2' };
    const csv = renderCsvReport([d]);
    // Prefix makes it "'=1,2"; comma → CSV-quoted: "'=1,2"
    expect(csv).toContain(`"'=1,2"`);
  });
});

describe('renderJsonReport', () => {
  it('round-trips to the same draft array', () => {
    expect(JSON.parse(renderJsonReport([xssDraft]))).toEqual([xssDraft]);
  });
});
