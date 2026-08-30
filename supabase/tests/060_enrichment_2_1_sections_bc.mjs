// =============================================================================
// supabase/tests/060_enrichment_2_1_sections_bc.mjs
//
// Behavioural database tests for migration 060's Sections B (booking_url,
// venue_enrichment.admission_status) and C (auto_apply_generated_description)
// — pglite (in-process Postgres), no live Supabase. Section A (the spatial
// RPC) needs PostGIS, unavailable in this repo's pinned pglite — see
// 060_enrichment_2_1_staging_checklist.sql for that one instead. Sections B/C
// have zero dependency on Section A, so this file extracts exactly that SQL
// text (via the ENRICHMENT_2_1_SECTIONS_BC_START/END markers in the real
// migration file — not a hand-maintained copy) and runs it standalone.
//
// BOOTSTRAP: built on the SHARED, production-faithful bootstrap in
// _enrichment_bootstrap.mjs, not this file's old private simplified schema.
// That private schema predated migration 057, so it had no decision /
// decision_reasons / applied_mode columns on venue_field_proposals — and it
// hand-added a venue_field_proposals.applied_by TEXT column that 057 and the
// rebased 059/060 drafts explicitly REJECT (see _enrichment_bootstrap.mjs
// PART A: a second, competing provenance truth that cannot name which admin
// acted). That drift is exactly why this file broke: the real 060
// auto_apply_generated_description calls enrichment_value_is_meaningful(), a
// 059 helper the private bootstrap never loaded, and writes into
// decision_reasons, a 057 column the private schema never had.
//
// Provenance is now asserted the canonical way: applied_mode on the proposal
// ('auto') plus an immutable venue_enrichment_writes ledger row (applied_by
// NULL for automation, decision_reasons carrying the machine justification).
//
// Run: node supabase/tests/060_enrichment_2_1_sections_bc.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  BOOTSTRAP, DRAFT_COLUMNS, makeHelpers, makeHarness, OTHER,
  extractFn, extractSection,
} from './_enrichment_bootstrap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_059 = readFileSync(join(__dirname, '../migrations_drafts/059_enrichment_autonomy.sql'), 'utf8');
const MIGRATION_060_FULL = readFileSync(join(__dirname, '../migrations_drafts/060_enrichment_2_1.sql'), 'utf8');

const START_MARKER = '-- ENRICHMENT_2_1_SECTIONS_BC_START';
const END_MARKER = '-- ENRICHMENT_2_1_SECTIONS_BC_END';
const startIdx = MIGRATION_060_FULL.indexOf(START_MARKER);
const endIdx = MIGRATION_060_FULL.indexOf(END_MARKER);
if (startIdx === -1 || endIdx === -1) {
  console.error('FATAL: extraction markers not found in 060_enrichment_2_1.sql — did the file change shape?');
  process.exit(1);
}
const SECTIONS_BC = MIGRATION_060_FULL.slice(startIdx, endIdx + END_MARKER.length);

// Pulls "CREATE OR REPLACE FUNCTION <name>(" through its terminating $$; and
// any REVOKE/GRANT lines that immediately follow for the same function.
// Copied verbatim from enrichment_057_rebase_redline.mjs's extractFn — this
// file executes the REAL migration text, never a hand-maintained copy of it.
// extractFn now comes from _enrichment_bootstrap.mjs (single definition).

// The 059 helper validators + audited-write primitive that draft 060's
// Section C function (auto_apply_generated_description) depends on but does
// not itself define — enrichment_value_is_meaningful chief among them (it's
// the "function does not exist" this whole rewrite is fixing). Assembled from
// the real 059 draft, in the same apply order the redline suite uses, so this
// is never a hand-copied reproduction that could drift from the real draft.
const REBASED_059 = [
  // confidence_score column (059); the competing applied_by text column is
  // deliberately NOT added — see the header comment above and PART A of
  // _enrichment_bootstrap.mjs.
  'alter table venue_field_proposals add column if not exists confidence_score smallint;',
  extractFn(SQL_059, 'enrichment_url_host'),
  extractFn(SQL_059, 'enrichment_is_valid_website'),
  extractFn(SQL_059, 'enrichment_is_valid_phone'),
  extractFn(SQL_059, 'enrichment_value_is_meaningful'),
  extractFn(SQL_059, '_enrichment_apply_write'),
  extractFn(SQL_059, 'auto_apply_field_proposal'),
].join(String.fromCharCode(10));

// venue_enrichment is a REAL production table (migration 049) that
// _enrichment_bootstrap.mjs deliberately does not create, because the redline
// suite it primarily serves never touches it. Section B's admission_status
// column lands on this table, so a minimal stand-in (just the PK) is created
// here — 049's full column set (scores, raw_osm_tags, recommended_for, ...)
// is irrelevant to what Sections B/C actually exercise.
const VENUE_ENRICHMENT_STUB = `
  create table if not exists venue_enrichment (
    venue_id uuid primary key references venues(id) on delete cascade);
`;

async function main() {
  const db = new PGlite();
  const h = makeHelpers(db);
  const { state, test, assert, eq, throws } = makeHarness();

  await db.exec(BOOTSTRAP);
  await db.exec(DRAFT_COLUMNS);
  await db.exec(VENUE_ENRICHMENT_STUB);
  await db.exec(REBASED_059);
  await db.exec(SECTIONS_BC);

  // Wraps h.newVenue so every venue in this suite also has the
  // venue_enrichment row the admission_status test needs — the shared
  // helper doesn't create one, because most enrichment tests never touch
  // that table.
  async function newVenue(opts = {}) {
    const id = await h.newVenue(opts);
    await h.q(`insert into venue_enrichment (venue_id) values ($1)`, [id]);
    return id;
  }

  console.log('\nMigration 060 Sections B+C — database tests (pglite, no live Supabase, migration NOT applied to production)\n');

  await test('venues.booking_url column exists and is writable', async () => {
    const v = await newVenue();
    await h.q(`update venues set booking_url = $1 where id = $2`, ['https://x.example/book', v]);
    const r = await h.q(`select booking_url from venues where id=$1`, [v]);
    eq(r.rows[0].booking_url, 'https://x.example/book', 'booking_url written');
  });

  await test('venue_enrichment.admission_status accepts free/paid/unknown, rejects garbage', async () => {
    const v = await newVenue();
    await h.q(`update venue_enrichment set admission_status='free' where venue_id=$1`, [v]);
    await h.q(`update venue_enrichment set admission_status='paid' where venue_id=$1`, [v]);
    await h.q(`update venue_enrichment set admission_status='unknown' where venue_id=$1`, [v]);
    await throws(h.q(`update venue_enrichment set admission_status='garbage' where venue_id=$1`, [v]), /check/i, 'garbage value rejected');
  });

  await test('happy: auto_apply_generated_description applies over a NULL description', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'description',
      { v: 'Indoor soft-play centre in Shrewsbury with a toddler area and parking.' });
    await h.asService();
    const res = await h.q(`select auto_apply_generated_description($1) as r`, [proposal]);
    eq(res.rows[0].r.ok, true, 'applied ok');
    await h.reset();
    const venue = await h.q(`select description from venues where id=$1`, [v]);
    eq(venue.rows[0].description,
      'Indoor soft-play centre in Shrewsbury with a toddler area and parking.', 'description written');
    const row = (await h.q(`select status, applied_mode from venue_field_proposals where id=$1`, [proposal])).rows[0];
    eq(row.status, 'applied', 'status applied');
    // CONTRACT CHANGE: venue_field_proposals.applied_by (text, 'admin'/'system')
    // does not exist — it competed with applied_mode and carried no actor id
    // (see the header comment / PART A of _enrichment_bootstrap.mjs). The
    // canonical proposal-level mode is applied_mode; actor identity and the
    // machine justification live on the venue_enrichment_writes ledger row.
    eq(row.applied_mode, 'auto', 'applied_mode records automation');
    const ledger = await h.ledgerFor(proposal);
    eq(ledger.length, 1, 'the write must be audited exactly once');
    eq(ledger[0].applied_mode, 'auto');
    eq(ledger[0].applied_by, null, 'automation has no auth user — NULL is the contract, not a bug');
    assert(JSON.stringify(ledger[0].decision_reasons).includes('auto_generated_description'),
      'the machine justification must be recorded when there is no human actor');
  });

  await test('rejects a trivial existing description too — fill-if-empty means EXACTLY empty, not "short"', async () => {
    // CONTRACT CHANGE: the pre-rebase heuristic ("under 10 chars counts as
    // empty") is gone. 060's auto_apply_generated_description now delegates
    // the emptiness check to the shared 059 enrichment_value_is_meaningful(),
    // which only asks "is this non-empty after trimming" — ANY existing text,
    // however short, now blocks automation. This matches the canonical rule:
    // automation may only fill an EMPTY value, never overwrite a meaningful
    // one, however small (_enrichment_bootstrap.mjs PART A, rule 2/3).
    const v = await newVenue({ description: 'Zoo' });
    const { proposal } = await h.newProposal(v, 'description',
      { v: 'Indoor zoo in Leeds with parking and an on-site cafe.' });
    await h.asService();
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]),
      /description_already_set/, 'a 3-character description still counts as meaningful now');
    await h.reset();
    const venue = await h.q(`select description from venues where id=$1`, [v]);
    eq(venue.rows[0].description, 'Zoo', 'the trivial description must be left untouched');
  });

  await test('rejects when the existing description is real/substantive — never overwrites a human description', async () => {
    const v = await newVenue({ description: 'A charming family-run farm with animals and a tea room, open all year round.' });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Indoor farm in York with parking.' });
    await h.asService();
    // CONTRACT CHANGE: the pre-rebase error was existing_description_not_trivial;
    // 060 delegates to 059's enrichment_value_is_meaningful() and raises
    // description_already_set instead. Same protection, renamed when the check
    // moved onto the shared primitive's vocabulary.
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]),
      /description_already_set/, 'real description protected');
    await h.reset();
    const venue = await h.q(`select description from venues where id=$1`, [v]);
    eq(venue.rows[0].description,
      'A charming family-run farm with animals and a tea room, open all year round.', 'description unchanged');
  });

  await test('rejects an empty generated text', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: '   ' });
    await h.asService();
    // CONTRACT CHANGE: 060 raises empty_description, not the pre-rebase
    // empty_generated_text — same guard, renamed on the rebase.
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]),
      /empty_description/, 'empty text rejected');
    await h.reset();
  });

  await test('rejects generated text that literally equals the scraped evidence (anti-copyright, mirrors the human path)', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Come visit our AMAZING soft play!!!' });
    await h.reset();
    await h.q(`update venue_field_proposals set evidence_snippet=$1 where id=$2`,
      ['Come visit our AMAZING soft play!!!', proposal]);
    await h.asService();
    // CONTRACT CHANGE: this guard now lives in the SHARED _enrichment_apply_write
    // primitive (057/059/060), used by every field, not a description-specific
    // check — so the error is description_not_rewritten (the primitive's name
    // for it), not the pre-rebase not_a_synthesis.
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]),
      /description_not_rewritten/, 'verbatim scrape rejected');
    await h.reset();
  });

  await test('stale current value blocks apply, same as the ordinary auto-apply path', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Indoor museum in Bath with parking.' });
    await h.reset();
    // FIXTURE FIX (not an assertion change): the original fixture edited the
    // live description to real text ("someone else edited this first"). Under
    // the NEW contract that now trips description_already_set (see the two
    // tests above) BEFORE _enrichment_apply_write's staleness check ever
    // runs, so it stopped exercising the guard this test is actually about.
    // Whitespace-only still passes enrichment_value_is_meaningful (trims to
    // empty) while still changing the live hash, so it is a genuine stale
    // edit without also being a meaningful one — the guard this test targets.
    await h.q(`update venues set description='   ' where id=$1`, [v]);
    await h.asService();
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]), /stale_current_value/, 'stale guard');
    await h.reset();
  });

  await test('rejects a proposal for a field other than description', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'phone', { v: '+441234567890' });
    await h.asService();
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]), /wrong_field/, 'wrong field rejected');
    await h.reset();
  });

  await test('is idempotent-safe — cannot re-apply an already-applied proposal', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Indoor library in Hull.' });
    await h.asService();
    await h.q(`select auto_apply_generated_description($1)`, [proposal]);
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]), /not_pending/, 're-apply blocked');
    await h.reset();
  });

  await test('auth: auto_apply_generated_description is service_role only', async () => {
    const v = await newVenue({ description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Indoor bowling alley in Derby.' });
    await h.asUser(OTHER);
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]), /permission denied/i, 'authenticated must not execute');
    await h.reset();
  });

  console.log(`\n${state.passed} passed, ${state.failures.length} failed\n`);
  if (state.failures.length > 0) {
    console.error('FAILURES:');
    for (const f of state.failures) console.error(`  - ${f.name}: ${f.message}`);
    process.exitCode = 1;
  }
  await db.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
