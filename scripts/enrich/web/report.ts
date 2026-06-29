// =============================================================================
// scripts/enrich/web/report.ts
//
// Pure pilot-report renderers (spec §3, §12). Turns ProposalDraft[] (phase 1)
// and RunReport (phase 2 / build step 4) into JSON / CSV / HTML.
//
// Phase-1 draft renderers: renderJsonReport, renderCsvReport, renderHtmlReport.
// Phase-2 run renderers:   renderRunJson, renderRunCsv, renderRunHtml.
//
// The HTML renderers HTML-ESCAPE every website-derived field so a malicious page
// cannot inject script when an admin opens the report (sec #4 XSS).
// JSON/CSV preserve raw text (safe for downstream tooling).
//
// No I/O — returns strings; the caller writes files. Deterministic. No '@/' alias.
// =============================================================================

import type { ProposalDraft } from '../../../types/webEnrichment';
import type { FieldDecision, EnrichmentBatchSummary } from '../../../types/enrichmentDecision';
import { REASON_LABELS } from '../../../types/enrichmentDecision';
import type { RunReport, VenueRunResult } from './orchestrate';
import { escapeHtml } from './sanitize';

export function renderJsonReport(drafts: ProposalDraft[]): string {
  return JSON.stringify(drafts, null, 2);
}

const CSV_COLUMNS = [
  'field',
  'confidence',
  'conflicts_existing',
  'extraction_method',
  'proposed',
  'source_url',
  'evidence_snippet',
] as const;

export function renderCsvReport(drafts: ProposalDraft[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const d of drafts) {
    rows.push(
      [
        d.field,
        d.confidence,
        String(d.conflicts_existing),
        d.extraction_method,
        proposedSummary(d),
        d.source_url,
        d.evidence_snippet,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.join('\n');
}

export function renderHtmlReport(drafts: ProposalDraft[]): string {
  const body = drafts
    .map(
      (d) => `    <tr>
      <td>${escapeHtml(d.field)}</td>
      <td>${escapeHtml(d.confidence)}</td>
      <td>${escapeHtml(String(d.conflicts_existing))}</td>
      <td>${escapeHtml(d.extraction_method)}</td>
      <td>${escapeHtml(proposedSummary(d))}</td>
      <td>${escapeHtml(d.source_url)}</td>
      <td>${escapeHtml(d.evidence_snippet)}</td>
    </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Website enrichment — pilot report</title></head>
<body>
  <h1>Website enrichment — pilot proposals (${drafts.length})</h1>
  <table border="1" cellpadding="4" cellspacing="0">
    <tr><th>Field</th><th>Confidence</th><th>Conflict</th><th>Method</th><th>Proposed</th><th>Source</th><th>Evidence</th></tr>
${body}
  </table>
</body></html>`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function proposedSummary(d: ProposalDraft): string {
  const v = d.proposed_value;
  if (v && typeof v === 'object' && 'v' in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)['v']);
  }
  // opening_hours week → compact day summary
  if (v && typeof v === 'object' && 'days' in (v as Record<string, unknown>)) {
    return '[opening_hours]';
  }
  return JSON.stringify(v);
}

function csvCell(value: string): string {
  let s = String(value ?? '');
  // Formula-injection neutralisation (M2): a leading trigger character makes
  // spreadsheet apps (Excel, LibreOffice, Google Sheets) treat the cell as a
  // formula. Prefix with a single quote to force plain text. The single quote
  // is visible in formula-bar only and does not appear as a rendered character.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// =============================================================================
// Phase-2 run-level renderers
// =============================================================================

// ── renderRunJson ─────────────────────────────────────────────────────────────

/** Full RunReport as pretty-printed JSON. */
export function renderRunJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}

// ── renderDecisionsCsv ───────────────────────────────────────────────────────

const DECISIONS_CSV_COLUMNS = [
  'venue_id',
  'venue_name',
  'outcome',
  'field',
  'decision',
  'reasons',
  'confidence',
  'conflicts_existing',
  'proposed',
  'source_url',
] as const;

/**
 * One CSV row per FieldDecision. Includes the engine verdict for every field.
 * Website-derived fields are NOT HTML-escaped in CSV (raw is correct for tooling).
 */
export function renderDecisionsCsv(report: RunReport): string {
  const rows: string[] = [DECISIONS_CSV_COLUMNS.join(',')];

  for (const v of report.venues) {
    const vDecisions = v.decisions ?? [];
    if (vDecisions.length === 0) {
      rows.push(
        [v.venueId, v.name, v.outcome, '', '', '', '', '', '', ''].map(csvCell).join(','),
      );
      continue;
    }
    for (const d of vDecisions) {
      const proposed =
        d.generatedText !== undefined
          ? d.generatedText
          : d.chosen
            ? d.field === 'opening_hours'
              ? '[opening_hours]'
              : String(d.chosen.value ?? '')
            : '';

      rows.push(
        [
          v.venueId,
          v.name,
          v.outcome,
          d.field,
          d.decision,
          d.reasons.join('|'),
          d.chosen?.confidence ?? '',
          d.chosen ? String(d.chosen.conflictsExisting) : '',
          proposed,
          d.chosen?.sourceUrl ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }

  return rows.join('\n');
}

// ── renderRunCsv ──────────────────────────────────────────────────────────────

const RUN_CSV_COLUMNS = [
  'venue_id',
  'venue_name',
  'outcome',
  'field',
  'confidence',
  'conflicts_existing',
  'extraction_method',
  'proposed',
  'source_url',
  'evidence_snippet',
] as const;

/**
 * One row per proposal, plus one row for zero-proposal venues (skips are visible
 * for grading). Venue-derived fields are NOT HTML-escaped in CSV (raw is correct
 * for spreadsheet tooling).
 */
export function renderRunCsv(report: RunReport): string {
  const rows: string[] = [RUN_CSV_COLUMNS.join(',')];

  for (const v of report.venues) {
    if (v.proposals.length === 0) {
      // Zero-proposal row so skipped/failed venues appear in the sheet
      rows.push(
        [v.venueId, v.name, v.outcome, '', '', '', '', '', '', ''].map(csvCell).join(','),
      );
    } else {
      for (const p of v.proposals) {
        rows.push(
          [
            v.venueId,
            v.name,
            v.outcome,
            p.field,
            p.confidence,
            String(p.conflicts_existing),
            p.extraction_method,
            proposedSummary(p),
            p.source_url,
            p.evidence_snippet,
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }

  return rows.join('\n');
}

// ── renderRunHtml ─────────────────────────────────────────────────────────────

/**
 * Full run report as HTML. EVERY website-derived field is HTML-escaped (sec #4).
 * Includes a summary header, batch-decision summary, and per-venue sections.
 */
export function renderRunHtml(report: RunReport): string {
  const { summary, batchSummary } = report;

  // Outcome summary table
  const outcomeSummaryRows = Object.entries(summary.byOutcome)
    .map(([outcome, count]) => `    <tr><td>${escapeHtml(outcome)}</td><td>${count}</td></tr>`)
    .join('\n');

  const summaryHtml = `
  <section>
    <h2>Run summary</h2>
    <p><strong>Run label:</strong> ${escapeHtml(report.runLabel)}</p>
    <p><strong>Generated at:</strong> ${escapeHtml(report.generatedAt)}</p>
    <p><strong>Venues processed:</strong> ${summary.venuesProcessed}</p>
    <p><strong>Total proposals:</strong> ${summary.totalProposals}
      (high: ${summary.proposalsByConfidence.high},
       medium: ${summary.proposalsByConfidence.medium},
       low: ${summary.proposalsByConfidence.low})</p>
    <h3>By outcome</h3>
    <table border="1" cellpadding="4" cellspacing="0">
      <tr><th>Outcome</th><th>Count</th></tr>
${outcomeSummaryRows}
    </table>
  </section>
${renderBatchSummaryHtml(batchSummary)}`;

  // Per-venue sections
  const venueSections = report.venues.map((v) => renderVenueSection(v)).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Website enrichment — run report: ${escapeHtml(report.runLabel)}</title></head>
<body>
  <h1>Website enrichment — run report</h1>
${summaryHtml}
  <hr>
  <h2>Per-venue results</h2>
${venueSections}
</body></html>`;
}

/** Render the EnrichmentBatchSummary as an HTML section (HTML-escaped). */
function renderBatchSummaryHtml(bs: EnrichmentBatchSummary): string {
  const safeFlag = bs.wouldReplaceNonEmpty
    ? '<strong style="color:red">WARNING: would replace non-empty fields</strong>'
    : '<span style="color:green">OK — no non-empty fields replaced</span>';
  const fields = bs.fieldsAffected.length > 0
    ? bs.fieldsAffected.map((f) => escapeHtml(f)).join(', ')
    : 'none';
  return `  <section style="background:#e3f2fd;padding:8px;margin:12px 0;">
    <h2>Batch decision summary</h2>
    <table border="1" cellpadding="4" cellspacing="0">
      <tr><th>Metric</th><th>Count</th></tr>
      <tr><td>Venues processed</td><td>${bs.venuesProcessed}</td></tr>
      <tr><td>Safe changes ready (auto_apply)</td><td>${bs.safeChangesReady}</td></tr>
      <tr><td>Exceptions (manual_review)</td><td>${bs.exceptions}</td></tr>
      <tr><td>Suppressed (auto_reject + report_only)</td><td>${bs.suppressed}</td></tr>
      <tr><td>Failures (fetch/skip)</td><td>${bs.failures}</td></tr>
      <tr><td>Fields affected</td><td>${escapeHtml(fields)}</td></tr>
      <tr><td>Would replace non-empty</td><td>${safeFlag}</td></tr>
    </table>
  </section>`;
}

function renderVenueSection(v: VenueRunResult): string {
  const headerColor = v.outcome === 'extracted' ? '#e8f5e9' : '#fff3e0';
  const websiteText = v.website ? escapeHtml(v.website) : '<em>none</em>';

  // Decision table (primary — per the contract §7b).
  const decisionsHtml = (v.decisions ?? []).length === 0
    ? '    <p><em>No decisions.</em></p>'
    : `    <h4>Decisions</h4>
    <table border="1" cellpadding="4" cellspacing="0">
      <tr><th>Field</th><th>Decision</th><th>Reasons</th><th>Proposed value</th><th>Confidence</th><th>Source</th></tr>
${(v.decisions ?? []).map((d) => renderDecisionRow(d)).join('\n')}
    </table>`;

  // Legacy proposals table (secondary — kept for backward compatibility).
  const proposalRows =
    v.proposals.length === 0
      ? ''
      : `    <h4>Raw proposals (legacy)</h4>
    <table border="1" cellpadding="4" cellspacing="0">
      <tr><th>Field</th><th>Confidence</th><th>Conflict</th><th>Method</th><th>Proposed</th><th>Source</th><th>Evidence</th></tr>
${v.proposals
  .map(
    (p) => `      <tr>
        <td>${escapeHtml(p.field)}</td>
        <td>${escapeHtml(p.confidence)}</td>
        <td>${escapeHtml(String(p.conflicts_existing))}</td>
        <td>${escapeHtml(p.extraction_method)}</td>
        <td>${escapeHtml(proposedSummary(p))}</td>
        <td>${escapeHtml(p.source_url)}</td>
        <td>${escapeHtml(p.evidence_snippet)}</td>
      </tr>`,
  )
  .join('\n')}
    </table>`;

  return `  <section style="background:${headerColor};padding:8px;margin:12px 0;">
    <h3>${escapeHtml(v.name)} <small style="color:#666">(${escapeHtml(v.venueId)})</small></h3>
    <p><strong>Website:</strong> ${websiteText} | <strong>Outcome:</strong> ${escapeHtml(v.outcome)}${v.note ? ` | <strong>Note:</strong> ${escapeHtml(v.note)}` : ''}</p>
    <p><strong>Pages fetched:</strong> ${v.pages.length}</p>
${decisionsHtml}
${proposalRows}
  </section>`;
}

function renderDecisionRow(d: FieldDecision): string {
  const decisionColor: Record<string, string> = {
    auto_apply: '#c8e6c9',
    manual_review: '#fff9c4',
    auto_reject: '#ffcdd2',
    report_only: '#e0e0e0',
  };
  const bg = decisionColor[d.decision] ?? '#fff';

  // Human-readable reason labels.
  const reasonsText = d.reasons
    .map((r) => escapeHtml(REASON_LABELS[r] ?? r))
    .join('; ');

  // Proposed value: prefer generatedText (description) over chosen.value.
  let proposedText = '';
  if (d.generatedText !== undefined) {
    proposedText = escapeHtml(d.generatedText);
  } else if (d.chosen) {
    const v = d.chosen.value;
    if (v && typeof v === 'object' && 'days' in (v as Record<string, unknown>)) {
      proposedText = '[opening_hours]';
    } else {
      proposedText = escapeHtml(String(v ?? ''));
    }
  }

  const confidence = d.chosen ? escapeHtml(d.chosen.confidence) : '';
  const source = d.chosen ? escapeHtml(d.chosen.sourceUrl) : '';

  return `      <tr style="background:${bg}">
        <td>${escapeHtml(d.field)}</td>
        <td><strong>${escapeHtml(d.decision)}</strong></td>
        <td>${reasonsText}</td>
        <td>${proposedText}</td>
        <td>${confidence}</td>
        <td>${source}</td>
      </tr>`;
}
