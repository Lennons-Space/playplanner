// =============================================================================
// supabase/tests/059_enrichment_autonomy.mjs
//
// Behavioural database tests for migration draft 059 (Enrichment 2.0 autonomy
// layer) using an in-process Postgres (pglite) — NO live Supabase, NO
// production access, and migration 059 is NOT applied to any real project by
// this file.
//
// This suite was rewritten to load its schema from the SHARED, production-
// faithful bootstrap (./_enrichment_bootstrap.mjs) instead of a private,
// hand-copied BOOTSTRAP + private assert harness. The private version had
// drifted from the real contract — it modelled a pre-057, pre-release-one
// world (a text venue_field_proposals.applied_by column, an
// auto_accept_candidate RPC that published venues unattended, and no
// venue_enrichment_writes ledger at all) and so it could pass while asserting
// behaviour the real migrations do not have. See PART A of
// _enrichment_bootstrap.mjs for the canonical provenance contract this suite
// now follows:
//
//   - There is no venue_field_proposals.applied_by text column. Proposal-level
//     mode lives in applied_mode ('auto'|'manual'); actor identity lives only
//     on the immutable venue_enrichment_writes ledger (applied_by uuid, NULL
//     for automation).
//   - auto_apply_field_proposal runs cheap policy checks first (score, status,
//     never-auto fields, conflicts) and then a fill-if-empty guard: automation
//     may only complete a field that is currently empty, never overwrite a
//     meaningful existing value.
//   - auto_accept_candidate does not exist in any signature. There is no
//     service_role-executable path that inserts a venue. queue_candidate_for
//     _review (061) re-checks every accept gate and QUARANTINES a candidate —
//     it creates no venue. resolve_discovery_candidate (061) is the only
//     candidate -> venue path, and it requires a real auth.uid() belonging to
//     an admin.
//   - venue_discovery_candidates / venue_closure_signals grant NOTHING to anon
//     or authenticated. RLS alone is not the barrier; the table GRANT is.
//
// Loads REAL draft SQL via the same extractFn/extractSection technique the
// 057 rebase red-line suite (enrichment_057_rebase_redline.mjs) uses, so this
// suite exercises the actual migration text rather than a reproduction of it.
// Draft 059 does not exist in isolation any more — the discovery/candidate
// RPCs it introduces are completed by draft 061 (independent identity
// evidence + the two publication-path functions), so this suite loads the
// relevant 061 sections too, in promotion order, exactly as instructed by the
// 059 draft's own comments ("What replaces it: queue_candidate_for_review
// (061 B) ... resolve_discovery_candidate (061 C)").
//
// Run:  node supabase/tests/059_enrichment_autonomy.mjs
// (Not yet wired into package.json's "test:db" — migration 059 itself is
// still pending Liam's review/apply, so wiring it into the standard gate
// would make test:db depend on unreviewed/unapplied schema. Run this file
// directly until 059 is approved. The comprehensive cross-draft contract
// suite lives in enrichment_057_rebase_redline.mjs; this file stays scoped to
// 059's own objects plus the minimum from 061 needed to exercise them.)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  BOOTSTRAP, makeHelpers, makeHarness,
  OTHER, ADMIN,
  extractFn, extractSection,
} from './_enrichment_bootstrap.mjs';

const { state, test, assert, eq, throws } = makeHarness();

// ── Load the REAL draft SQL ──────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(__dirname, '../migrations_drafts');
const SQL_059 = readFileSync(join(DRAFTS, '059_enrichment_autonomy.sql'), 'utf8');
const SQL_061 = readFileSync(join(DRAFTS, '061_enrichment_review_paths.sql'), 'utf8');

// Pulls "CREATE OR REPLACE FUNCTION <name>(" through its terminating $$; and
// any REVOKE/GRANT lines that immediately follow for the same function.
// Copied verbatim from enrichment_057_rebase_redline.mjs so both suites parse
// the draft files identically.
// extractFn now comes from _enrichment_bootstrap.mjs (single definition).

// Pulls a marked block out of a migration file:
//   -- @test-section: <name>   ...   -- @end-section: <name>
// Copied verbatim from enrichment_057_rebase_redline.mjs. The markers exist so
// these tests execute the REAL DDL, ACLs and CHECK constraints that would be
// promoted, instead of a hand-written reproduction of them.
// extractSection now comes from _enrichment_bootstrap.mjs (single definition).

// Two statements in draft 059 are NOT wrapped in a @test-section marker
// (confidence_score's own ALTER TABLE, and the operating_status ALTER TABLE),
// so extractSection cannot reach them. Rather than hand-copy them -- which is
// exactly the drift this rewrite exists to remove -- this pulls the real,
// byte-exact statement out of the file by anchoring on a unique substring and
// reading forward to its terminating semicolon. It is the same technique as
// extractFn, applied to a plain ALTER TABLE instead of a CREATE FUNCTION.
//
// IMPORTANT: this is why DRAFT_COLUMNS from the shared bootstrap is NOT used
// here for operating_status. DRAFT_COLUMNS's stub defines operating_status as
// `text not null default 'open'` with no CHECK -- a convenience default for
// suites that only need the column to exist. Draft 059's real column is
// `default 'active'` with a CHECK restricting it to
// ('active','suspected_closed','confirmed_closed'). Because the ALTER TABLE
// uses ADD COLUMN IF NOT EXISTS, applying the stub first would make the real
// statement a silent no-op, leaving every new venue's operating_status
// defaulting to 'open' -- a value the closure-ladder functions never test
// for, which would break system_flag_suspected_closure's active ->
// suspected_closed transition. Extracting the real statement avoids that.
function extractStatement(sql, anchor, statementStart) {
  const m = sql.indexOf(anchor);
  if (m < 0) throw new Error(`statement anchor not found: ${anchor}`);
  const stmtStart = sql.lastIndexOf(statementStart, m);
  if (stmtStart < 0) throw new Error(`could not find statement start "${statementStart}" for: ${anchor}`);
  const end = sql.indexOf(';', m);
  if (end < 0) throw new Error(`unterminated statement: ${anchor}`);
  return sql.slice(stmtStart, end + 1);
}

// The real confidence_score column, including 059's own 0-100 CHECK (the
// redline suite's copy of this line drops the CHECK for brevity; this suite
// pulls the real text instead since it is cheap to do and keeps the CHECK
// under test).
const CONFIDENCE_SCORE_COLUMN = extractStatement(
  SQL_059,
  "ADD COLUMN IF NOT EXISTS confidence_score smallint",
  'ALTER TABLE venue_field_proposals',
);

// The real operating_status column -- see the extractStatement comment above.
const OPERATING_STATUS_COLUMN = extractStatement(
  SQL_059,
  "ADD COLUMN IF NOT EXISTS operating_status text NOT NULL DEFAULT 'active'",
  'ALTER TABLE venues',
);

// The 059 functions, in the order they must promote in: the primitive before
// its callers, exactly mirroring REBASED_059 in the red-line suite.
const FN_059 = [
  CONFIDENCE_SCORE_COLUMN,
  extractFn(SQL_059, 'enrichment_url_host'),
  extractFn(SQL_059, 'enrichment_is_valid_website'),
  extractFn(SQL_059, 'enrichment_is_valid_phone'),
  extractFn(SQL_059, 'enrichment_value_is_meaningful'),
  // R1 (pre-staging remediation, 2026-09-01): the opening_hours equivalent,
  // now used by auto_apply_field_proposal below.
  extractFn(SQL_059, 'enrichment_opening_hours_is_meaningful'),
  extractFn(SQL_059, '_enrichment_apply_write'),
  extractFn(SQL_059, 'auto_apply_field_proposal'),
].join(String.fromCharCode(10));

// R3 (pre-staging remediation, 2026-09-01): auto_apply_field_proposal now
// calls enrichment_venue_field_suppressed unconditionally, so this schema must
// be loaded before FN_059's functions are ever CALLED (not before they are
// CREATEd -- plpgsql bodies aren't validated until call time -- but boot()
// below loads it first regardless, for readability).
const SUPPRESSION_SCHEMA = extractSection(SQL_059, 'suppression_schema');
const SUPPRESSION_CHECKS = extractSection(SQL_059, 'suppression_checks');

const CLOSURE_SCHEMA = extractSection(SQL_059, 'closure_schema');
const CLOSURE_FUNCTIONS = extractSection(SQL_059, 'closure_functions');
const DISCOVERY_SCHEMA = extractSection(SQL_059, 'discovery_schema');
const VENUES_PROVENANCE = extractSection(SQL_059, 'venues_provenance');

// 061 completes what 059 started: independent identity evidence, and the two
// publication-path functions that replace auto_accept_candidate.
const CANDIDATE_EVIDENCE = extractSection(SQL_061, 'candidate_evidence');
const CANDIDATE_UPSERT = extractSection(SQL_061, 'candidate_upsert');
const CANDIDATE_PUBLICATION = extractSection(SQL_061, 'candidate_publication');

async function boot() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(SUPPRESSION_SCHEMA);
  await db.exec(SUPPRESSION_CHECKS);
  await db.exec(FN_059);
  await db.exec(OPERATING_STATUS_COLUMN);
  await db.exec(CLOSURE_SCHEMA);
  await db.exec(CLOSURE_FUNCTIONS);
  await db.exec(DISCOVERY_SCHEMA);
  await db.exec(VENUES_PROVENANCE);
  await db.exec(CANDIDATE_EVIDENCE);
  // CANDIDATE_UPSERT (upsert_discovery_candidate) also calls
  // enrichment_candidate_source_suppressed (R3) -- loaded here so any test in
  // this file that exercises it (none currently call it directly, but
  // CANDIDATE_PUBLICATION's resolve_discovery_candidate does not depend on it
  // either way) has it available if that changes.
  await db.exec(CANDIDATE_UPSERT);
  await db.exec(CANDIDATE_PUBLICATION);
  return { db, h: makeHelpers(db) };
}

async function main() {
  const { db, h } = await boot();
  console.log('\nMigration draft 059 (+ the 061 pieces it depends on) — database tests');
  console.log('(pglite, no live Supabase, no migration applied to production)\n');

  // ── auto_apply_field_proposal ──────────────────────────────────────────────

  // What this catches: if the rebase ever regresses back to writing venues
  // directly (as an earlier draft did), OR reintroduces a competing
  // applied_by text column, this is the test that would go red. The canonical
  // provenance contract (PART A of the bootstrap) says actor identity for an
  // autonomous write lives ONLY on venue_enrichment_writes, as a NULL uuid,
  // with the machine justification in decision_reasons -- never a text
  // "system" sentinel on the proposal itself.
  await test('happy: auto-applies a high-confidence phone proposal via the audited ledger (applied_mode=auto, NULL actor)', async () => {
    const v = await h.newVenue({ phone: null });
    const { proposal } = await h.newProposal(v, 'phone', { v: '+441234567890' });
    await h.asService();
    const res = await h.q(`select auto_apply_field_proposal($1, 90::smallint, 88::smallint) as r`, [proposal]);
    eq(res.rows[0].r.ok, true, 'auto-apply ok');
    await h.reset();

    const venue = await h.q(`select phone from venues where id=$1`, [v]);
    eq(venue.rows[0].phone, '+441234567890', 'phone written');

    const row = await h.q(
      `select status, applied_mode, confidence_score from venue_field_proposals where id=$1`, [proposal]);
    eq(row.rows[0].status, 'applied', 'status applied');
    eq(row.rows[0].applied_mode, 'auto', 'applied_mode is the canonical proposal-level mode -- not a text applied_by column');
    eq(row.rows[0].confidence_score, 90, 'confidence_score persisted');

    const rows = await h.ledgerFor(proposal);
    eq(rows.length, 1, 'every autonomous apply must leave exactly one immutable ledger row');
    eq(rows[0].applied_mode, 'auto');
    eq(rows[0].applied_by, null, 'automation has no auth user -- a NULL actor is the contract, not a defect');
    assert(JSON.stringify(rows[0].decision_reasons).includes('auto_apply_confidence'),
      'the machine justification must be recorded when there is no human actor');
  });

  await test('rejects below-threshold score', async () => {
    const v = await h.newVenue();
    const { proposal } = await h.newProposal(v, 'phone', { v: '+441' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 80::smallint, 88::smallint)`, [proposal]),
      /below_min_score/, 'below threshold rejected');
    await h.reset();
  });

  await test('never auto-applies price_range regardless of score', async () => {
    const v = await h.newVenue();
    const { proposal } = await h.newProposal(v, 'price_range', { v: 'moderate' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 100::smallint, 50::smallint)`, [proposal]),
      /field_never_auto_applies/, 'price_range blocked');
    await h.reset();
  });

  await test('never auto-applies description regardless of score', async () => {
    const v = await h.newVenue();
    const { proposal } = await h.newProposal(v, 'description', { v: 'A farm' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 100::smallint, 50::smallint)`, [proposal]),
      /field_never_auto_applies/, 'description blocked');
    await h.reset();
  });

  // conflicts_existing has no setter in the shared newProposal() helper (it
  // defaults to false, matching the common case), so it is set directly here
  // via a raw UPDATE -- the same pattern the red-line suite uses (see E7)
  // when a test needs a column the helper does not expose.
  await test('rejects a proposal that conflicts with an existing value', async () => {
    const v = await h.newVenue({ website: 'https://old.example/' });
    const { proposal } = await h.newProposal(v, 'website', { v: 'https://new.example/' });
    await h.q(`update venue_field_proposals set conflicts_existing = true where id = $1`, [proposal]);
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [proposal]),
      /conflicts_existing_requires_human_review/, 'conflict blocked');
    await h.reset();
  });

  // REWRITTEN FIXTURE. The old fixture started from an EMPTY phone, then set
  // it to a non-empty value after the proposal was created, and expected
  // stale_current_value. Under the 059 rebase, auto_apply_field_proposal now
  // runs its fill-if-empty guard BEFORE delegating to _enrichment_apply_write
  // (which is where the stale-hash check lives): a live, non-empty value is
  // now caught by live_value_not_empty first, so the old fixture actually
  // proved the WRONG guard. This fixture instead edits the live value from
  // one EMPTY state (NULL) to another EMPTY-but-different state (''), which
  // still fails enrichment_value_is_meaningful (so the fill-if-empty guard
  // does not fire) but hashes differently from the snapshot the proposal was
  // built against -- so it is genuinely the stale-hash guard being exercised,
  // not the live-value guard.
  await test('stale current value blocks auto-apply just like the human path', async () => {
    const v = await h.newVenue({ phone: null });
    const { proposal } = await h.newProposal(v, 'phone', { v: '+441' });
    await h.q(`update venues set phone = '' where id = $1`, [v]); // edited after snapshot, still empty
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [proposal]),
      /stale_current_value/, 'stale guard');
    await h.reset();
  });

  await test('rejects a non-pending proposal (already applied)', async () => {
    const v = await h.newVenue({ phone: null });
    // A real, valid-shaped number: 059's rebase added universal phone
    // validation to the primitive (enrichment_is_valid_phone), so a
    // short placeholder like the pre-rebase suite used ('+441') is now
    // refused by the FIRST apply with invalid_phone, never reaching the
    // not_pending guard this test exists to prove.
    const { proposal } = await h.newProposal(v, 'phone', { v: '+441234500000' });
    await h.asService();
    await h.q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [proposal]);
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [proposal]),
      /not_pending/, 're-apply rejected');
    await h.reset();
  });

  await test('opening_hours clean week auto-applies', async () => {
    const v = await h.newVenue();
    const week = {
      seasonal_notes: null,
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => ({
        day_of_week: d, is_closed: d === 0,
        intervals: d === 0 ? [] : [{ opens: '09:00', closes: '17:00' }] })),
    };
    const { proposal } = await h.newProposal(v, 'opening_hours', week);
    await h.asService();
    await h.q(`select auto_apply_field_proposal($1, 95::smallint, 92::smallint)`, [proposal]);
    await h.reset();
    const rows = await h.q(`select day_of_week, is_closed from opening_hours where venue_id=$1 order by day_of_week`, [v]);
    eq(rows.rows.length, 7, '7 rows after auto-apply');
    eq(rows.rows[0].is_closed, true, 'Sunday closed');
  });

  // The original assertion, RESTORED and kept. An intermediate rewrite of this
  // suite concluded that no seasonal guard existed and rewrote the test to
  // assert the permissive behaviour instead. It was right about the file and
  // wrong about the contract: `git show HEAD:...059...` has the guard
  // (`seasonal_notes_require_human_review`), and the 057 rebase dropped it when
  // it deleted apply_venue_proposal_opening_hours_internal. The guard is now
  // back in the autonomy wrapper where policy belongs, and this test is the
  // thing that stops it being lost a second time.
  //
  // WHY IT MATTERS: seasonal_notes means the week we extracted is CONDITIONAL.
  // replace-whole-week would publish "term-time only" hours as the year-round
  // truth, and the failure mode is a parent arriving at a closed venue.
  await test('opening_hours with seasonal_notes requires human review, never auto-applies', async () => {
    const v = await h.newVenue();
    const week = {
      seasonal_notes: 'term-time only',
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => ({
        day_of_week: d, is_closed: false,
        intervals: [{ opens: '09:00', closes: '17:00' }] })),
    };
    const { proposal } = await h.newProposal(v, 'opening_hours', week);
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 92::smallint)`, [proposal]),
      /seasonal_notes_require_human_review/, 'conditional hours must never auto-apply');
    await h.reset();
    const rows = await h.q(`select count(*)::int c from opening_hours where venue_id=$1`, [v]);
    eq(rows.rows[0].c, 0, 'the refused proposal must not have written a partial week');
  });

  // The other half of the same rule: a HUMAN admin may still apply seasonal
  // hours, having read the note and judged it. The guard is autonomy policy,
  // not a validity rule, so it must not leak into the shared primitive.
  await test('a human admin MAY still apply seasonal opening hours', async () => {
    const v = await h.newVenue();
    const week = {
      seasonal_notes: 'term-time only',
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => ({
        day_of_week: d, is_closed: d === 0,
        intervals: d === 0 ? [] : [{ opens: '09:00', closes: '17:00' }] })),
    };
    const { proposal } = await h.newProposal(v, 'opening_hours', week);
    await h.asUser(ADMIN);
    await h.q(`select apply_venue_proposal($1)`, [proposal]);
    await h.reset();
    const rows = await h.q(
      `select day_of_week, is_closed, notes from opening_hours where venue_id=$1 order by day_of_week`, [v]);
    eq(rows.rows.length, 7, 'the human path writes the whole week');
    eq(rows.rows[0].notes, null, 'a closed day carries no note');
    eq(rows.rows[1].notes, 'term-time only', 'an open day carries the seasonal note');
  });

  await test('auth: auto_apply_field_proposal is service_role only (authenticated denied)', async () => {
    const v = await h.newVenue();
    const { proposal } = await h.newProposal(v, 'phone', { v: '+441' });
    await h.asUser(ADMIN); // an authenticated caller, admin or not -- the ACL denies the role, not the person
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 88::smallint)`, [proposal]),
      /permission denied/i, 'authenticated must not execute');
    await h.reset();
  });

  // ── Closure ladder ────────────────────────────────────────────────────────
  await test('system_flag_suspected_closure moves active -> suspected_closed', async () => {
    const v = await h.newVenue();
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1, 'closure phrase detected')`, [v]);
    await h.reset();
    const r = await h.q(`select operating_status from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'suspected_closed', 'flagged');
  });

  // FIXTURE UPDATED for the locked state machine: active -> confirmed_closed
  // is no longer a permitted edge even for an admin. Confirming a closure now
  // requires the venue to have been flagged first, so the event log always
  // carries the suspicion underneath the confirmation. The BEHAVIOUR this test
  // asserts -- that a later automated signal never downgrades a confirmed
  // closure -- is unchanged.
  await test('system_flag_suspected_closure is a no-op on an already-confirmed venue (additive-only)', async () => {
    const v = await h.newVenue();
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1, 'first signal')`, [v]);
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1, 'confirmed by admin')`, [v]);
    await h.asService();
    const r2 = (await h.q(`select system_flag_suspected_closure($1, 'later signal') as r`, [v])).rows[0].r;
    await h.reset();
    eq(r2.changed, false, 'a re-detection is not a state change');
    eq(r2.reason, 'already_confirmed_closed');
    const r = await h.q(`select operating_status from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'confirmed_closed', 'stays confirmed, never downgraded');
  });

  await test('confirm_venue_closure REFUSES to jump straight from active', async () => {
    // The destructive step requires the venue to have been flagged first.
    const v = await h.newVenue();
    await h.asUser(ADMIN);
    await throws(h.q(`select confirm_venue_closure($1, 'straight to confirmed')`, [v]),
      /transition_not_permitted:active->confirmed_closed/);
    await h.reset();
    const r = await h.q(`select operating_status from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'active', 'and nothing moved');
  });

  await test('confirm_venue_closure is admin-only and hides the venue from discovery', async () => {
    const v = await h.newVenue();
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1, 'signal')`, [v]); // required first step
    await h.asUser(OTHER);
    await throws(h.q(`select confirm_venue_closure($1, 'x')`, [v]), /not_admin/, 'non-admin blocked');
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1, 'permanently shut')`, [v]);
    await h.reset();
    const r = await h.q(`select operating_status, discovery_approved from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'confirmed_closed', 'confirmed');
    eq(r.rows[0].discovery_approved, false, 'hidden from discovery');
  });

  await test('reactivate_venue is admin-only and resets to active', async () => {
    const v = await h.newVenue();
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1, 'signal')`, [v]); // required first step
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1, 'x')`, [v]);
    await h.q(`select reactivate_venue($1)`, [v]);
    await h.reset();
    const r = await h.q(`select operating_status, discovery_approved from venues where id=$1`, [v]);
    eq(r.rows[0].operating_status, 'active', 'reactivated');
    eq(r.rows[0].discovery_approved, true, 'discoverable again');
  });

  // Matches the contract note: confirm_venue_closure / reactivate_venue are
  // human paths (authenticated + is_admin()) and service_role EXECUTE was
  // deliberately revoked on both, because service_role has no auth.uid() and
  // could never pass is_admin() anyway -- granting it EXECUTE would only
  // advertise a capability that does not exist.
  await test('auth: confirm_venue_closure and reactivate_venue reject service_role, not just anon', async () => {
    const v = await h.newVenue();
    await h.asService();
    await throws(h.q(`select confirm_venue_closure($1, 'x')`, [v]), /permission denied/i,
      'service_role must not execute confirm_venue_closure');
    await throws(h.q(`select reactivate_venue($1)`, [v]), /permission denied/i,
      'service_role must not execute reactivate_venue');
    await h.reset();
  });

  await test('auth: system_flag_suspected_closure is service_role only', async () => {
    const v = await h.newVenue();
    await h.asUser(ADMIN);
    await throws(h.q(`select system_flag_suspected_closure($1, 'x')`, [v]), /permission denied/i,
      'authenticated must not execute');
    await h.reset();
  });

  // ── Discovery candidates: queue_candidate_for_review replaces auto_accept_candidate ─
  // auto_accept_candidate does not exist in any signature (release-one product
  // decision: no candidate ever auto-publishes). Every test below that used to
  // exercise it now exercises queue_candidate_for_review, whose strongest
  // possible outcome is 'quarantined' -- never a published venue.

  await test('happy: queue_candidate_for_review quarantines a qualifying candidate without publishing a venue', async () => {
    const c = await h.newCandidate({ name: 'Quarantine Me', independent_identity_evidence_count: 5 });
    await h.asService();
    const res = await h.q(`select queue_candidate_for_review($1) as r`, [c]);
    eq(res.rows[0].r.ok, true, 'queue ok');
    eq(res.rows[0].r.published, false, 'the unattended path must report that it published nothing');
    eq(res.rows[0].r.status, 'quarantined');
    eq(res.rows[0].r.awaiting, 'resolve_discovery_candidate');
    await h.reset();
    const row = await h.candidate(c);
    eq(row.status, 'quarantined');
    eq(row.venue_id, null, 'no venue may be created by the unattended path');
    assert(JSON.stringify(row.resolution_reasons).includes('release_one_human_review_required'),
      'the hold must record WHY it is being held');
    eq(await h.venueByName('Quarantine Me'), null, 'service_role must not be able to create a venue at all');
  });

  // ADDED (not in the old suite): closes the loop the rewrite above opens.
  // queue_candidate_for_review's quarantine is not a dead end -- a named human
  // admin can still resolve it via resolve_discovery_candidate (061 C), the
  // only candidate -> venue path in the system. Included because a reader of
  // this file would otherwise see "queue_candidate_for_review never publishes"
  // and reasonably wonder how a quarantined candidate ever becomes a venue.
  await test('the human resolution path can still publish a queued candidate', async () => {
    const c = await h.newCandidate({ name: 'Human Approved', independent_identity_evidence_count: 5 });
    await h.asService();
    await h.q(`select queue_candidate_for_review($1)`, [c]);
    await h.asUser(ADMIN);
    const res = await h.q(`select resolve_discovery_candidate($1,'approve','looks real') as r`, [c]);
    eq(res.rows[0].r.ok, true);
    eq(res.rows[0].r.published, true);
    await h.reset();
    const v = await h.venueByName('Human Approved');
    assert(v && v.is_published && v.moderation_status === 'approved' && v.discovery_approved,
      'a named human admin must be able to publish what the pipeline only quarantined');
  });

  await test('rejects a candidate below the default min score (98)', async () => {
    const c = await h.newCandidate({ confidence_score: 97 });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /below_min_score/, 'below 98 rejected');
    await h.reset();
  });

  await test('rejects a non-distinct dedupe decision', async () => {
    const c = await h.newCandidate({ dedupe_decision: 'possible_duplicate' });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /not_distinct/, 'possible_duplicate rejected');
    await h.reset();
  });

  // independent_identity_evidence_count must be overridden here (and in the
  // next two tests): queue_candidate_for_review checks it BEFORE the accept-
  // gate booleans, so a candidate left at the column's safe default of 0
  // would fail on insufficient_independent_identity_evidence instead of the
  // thing each test is actually trying to prove.
  await test('rejects when any accept-gate boolean is false', async () => {
    const c = await h.newCandidate({ is_trusted_source: false, independent_identity_evidence_count: 5 });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /accept_gate_not_satisfied/, 'gate failure rejected');
    await h.reset();
  });

  await test('rejects a candidate with a closure signal', async () => {
    const c = await h.newCandidate({ has_closure_signal: true, independent_identity_evidence_count: 5 });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /has_closure_signal/, 'closure signal blocks accept');
    await h.reset();
  });

  await test('rejects a candidate missing postcode/city', async () => {
    const c = await h.newCandidate({ postcode: null, independent_identity_evidence_count: 5 });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /missing_required_venue_fields/, 'missing address blocked');
    await h.reset();
  });

  // REWRITTEN. The old test called this "idempotent" and expected
  // not_pending_candidate on re-accept. queue_candidate_for_review's own
  // guard is worded differently (not_pending_candidate:<status>) but the
  // underlying behaviour is the same shape: a candidate is not
  // 'candidate' any more once queued, so a second call is refused.
  await test('cannot re-queue a candidate that has already left the candidate state', async () => {
    const c = await h.newCandidate({ independent_identity_evidence_count: 5 });
    await h.asService();
    await h.q(`select queue_candidate_for_review($1)`, [c]);
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /not_pending_candidate/, 're-queue blocked');
    await h.reset();
  });

  await test('auth: queue_candidate_for_review is service_role only', async () => {
    const c = await h.newCandidate();
    await h.asUser(ADMIN);
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /permission denied/i,
      'authenticated must not execute');
    await h.reset();
  });

  // ── Table privileges + RLS on the new tables ─────────────────────────────
  // REWRITTEN. The old tests granted `select` to authenticated by hand
  // (`db.exec('grant select on ... to authenticated')`) and then relied on
  // RLS alone to prove non-admins see nothing. That is not what production
  // does: the real migration grants NOTHING to anon/authenticated on either
  // table (see 059's "TABLE PRIVILEGES (D12)" comment blocks) precisely so
  // RLS is not the only barrier. Manually granting SELECT before the test
  // silently deletes half of that contract. Each pair below asserts the two
  // layers honestly: the GRANT refuses the role outright, and the admin-only
  // RLS policy exists and is correctly scoped.
  await test('discovery candidates: authenticated is refused by the table GRANT itself, not merely by RLS', async () => {
    await h.newCandidate();
    const priv = (await h.q(
      `select has_table_privilege('authenticated','venue_discovery_candidates','SELECT') as x`)).rows[0].x;
    eq(priv, false, 'authenticated must hold no SELECT grant on this table at all');
    await h.asUser(OTHER);
    await throws(h.q(`select count(*) from venue_discovery_candidates`), /permission denied/i,
      'refused by the ACL before any row is even considered');
    await h.reset();
  });

  await test('discovery candidates: the admin-only RLS policy exists and is correctly scoped', async () => {
    const rows = (await h.q(
      `select policyname, cmd, qual from pg_policies where tablename = 'venue_discovery_candidates'`)).rows;
    assert(rows.length > 0, 'an RLS policy must exist on venue_discovery_candidates');
    assert(rows.some((r) => /is_admin/.test(r.qual || '')),
      'the policy must gate visibility on is_admin(), matching the "admins only" design');
  });

  await test('closure signals: authenticated is refused by the table GRANT itself, not merely by RLS', async () => {
    const v = await h.newVenue();
    await h.asService();
    await h.q(
      `insert into venue_closure_signals (venue_id, kind, source_url, evidence_snippet, source_tier, detected_at)
       values ($1, 'explicit_official_text', 'https://v.example/', 'we have closed', 1, now())`, [v]);
    await h.reset();
    const priv = (await h.q(
      `select has_table_privilege('authenticated','venue_closure_signals','SELECT') as x`)).rows[0].x;
    eq(priv, false, 'authenticated must hold no SELECT grant on this table at all');
    await h.asUser(OTHER);
    await throws(h.q(`select count(*) from venue_closure_signals`), /permission denied/i,
      'refused by the ACL before any row is even considered');
    await h.reset();
  });

  await test('closure signals: the admin-only RLS policy exists and is correctly scoped', async () => {
    const rows = (await h.q(
      `select policyname, cmd, qual from pg_policies where tablename = 'venue_closure_signals'`)).rows;
    assert(rows.length > 0, 'an RLS policy must exist on venue_closure_signals');
    assert(rows.some((r) => /is_admin/.test(r.qual || '')),
      'the policy must gate visibility on is_admin(), matching the "admins only" design');
  });

  // ── Additive-only sanity check ────────────────────────────────────────────
  await test('the 056/057 human apply path (apply_venue_proposal) still works unchanged after 059+061 load', async () => {
    const v = await h.newVenue({ website: null });
    const { proposal } = await h.newProposal(v, 'website', { v: 'https://ok.example/' });
    await h.asUser(ADMIN);
    await h.q(`select apply_venue_proposal($1)`, [proposal]);
    await h.reset();
    const venue = await h.q(`select website from venues where id=$1`, [v]);
    eq(venue.rows[0].website, 'https://ok.example/', 'the human-apply path is unaffected by the draft objects');
    const pr = await h.q(`select applied_mode from venue_field_proposals where id=$1`, [proposal]);
    eq(pr.rows[0].applied_mode, 'manual', 'a human apply still records applied_mode=manual');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${state.passed} passed, ${state.failures.length} failed\n`);
  if (state.failures.length > 0) {
    console.error('FAILURES:');
    for (const f of state.failures) console.error(`  - ${f.name}: ${f.message}`);
    await db.close();
    process.exit(1);
  }
  await db.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
