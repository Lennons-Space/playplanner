// =============================================================================
// supabase/tests/061_enrichment_review_paths.mjs
//
// Behavioural database tests for migration 061 -- pglite (in-process Postgres),
// no live Supabase, migration NOT applied to any real project.
//
// FOUNDATION: this suite loads the SHARED, production-faithful bootstrap in
// supabase/tests/_enrichment_bootstrap.mjs (its PART A is the canonical
// enrichment provenance/write contract -- read it before this file), then
// layers the REAL draft SQL for 059 and 060 that 061 depends on -- extracted
// from the migration files themselves via extractFn/extractSection, never
// hand-copied -- and finally 061's own two review-path functions. A previous
// version of this file booted a private, pre-057 world (a text
// venue_field_proposals.applied_by column, a two-argument auto_accept_
// candidate that published venues directly) that no longer exists in any
// draft. Testing against that world is why it failed with errors like
// `record "p" has no field "decision_reasons"` -- the fixture, not migration
// 061, was wrong. extractFn/extractSection and the REBASED_* assembly below
// are copied from enrichment_057_rebase_redline.mjs (the reference
// implementation for this rebase) so both suites agree on what "the real
// migration text, rebased" means.
//
// Covers -- migration 061's four sections:
//   B. queue_candidate_for_review -- replaces auto_accept_candidate, which is
//      DELETED in both historical signatures. It re-checks every accept gate
//      and then QUARANTINES. It creates no venue. RELEASE ONE: there is no
//      service_role-executable path that publishes a venue unattended.
//   C. resolve_discovery_candidate -- the ONLY candidate -> live venue path in
//      the system. Requires a real auth.uid() belonging to an admin, maps
//      provenance through discovery_candidate_provenance, and FAILS CLOSED
//      (quarantines rather than publishes) when that mapping is not certain.
//   D. apply_booking_url_proposal -- the admin path for a booking_url
//      proposal automation refused (typically a legitimate third-party
//      booking host). Rebased onto 057: the write goes through
//      _enrichment_apply_write, producing an immutable ledger row. Provenance
//      is applied_mode='manual' + venue_enrichment_writes.applied_by =
//      auth.uid() -- NOT a competing text column on the proposal (see PART A
//      of the bootstrap for why that column was rejected).
//   E. resolve_facility_conflict -- the admin path for a facility conflict the
//      enrichment pipeline raised. Can only remove rows this pipeline itself
//      published; parent-confirmed and admin/import rows stay untouchable.
//
// Run: node supabase/tests/061_enrichment_review_paths.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  BOOTSTRAP, DRAFT_COLUMNS, makeHelpers, makeHarness, OWNER, OTHER, ADMIN,
  extractFn, extractSection,
} from './_enrichment_bootstrap.mjs';

const { state, test, assert, eq, throws } = makeHarness();

// ── Load the REAL draft SQL -- never a hand-copied reproduction ─────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(__dirname, '../migrations_drafts');
const SQL_059 = readFileSync(join(DRAFTS, '059_enrichment_autonomy.sql'), 'utf8');
const SQL_060 = readFileSync(join(DRAFTS, '060_enrichment_2_1.sql'), 'utf8');
const SQL_061 = readFileSync(join(DRAFTS, '061_enrichment_review_paths.sql'), 'utf8');

// Pulls "CREATE OR REPLACE FUNCTION <name>(" through its terminating $$; and
// any REVOKE/GRANT lines that immediately follow for the same function.
// extractFn now comes from _enrichment_bootstrap.mjs (single definition).

// Pulls a marked block out of a migration file:
//   -- @test-section: <name>   ...   -- @end-section: <name>
// so these tests execute the REAL DDL/ACLs/CHECK constraints that would be
// promoted, instead of a hand-written reproduction of them.
// extractSection now comes from _enrichment_bootstrap.mjs (single definition).

// The rebased enrichment layer 061 sits on top of, assembled from the real
// drafts in apply order -- matches enrichment_057_rebase_redline.mjs's
// REBASED_059/060 exactly, so both suites agree on what "rebased" means.
const REBASED_059 = [
  // confidence_score column (059); the competing text applied_by column that
  // used to live alongside it on venue_field_proposals is gone -- see the
  // bootstrap's PART A, RULE 1.
  'alter table venue_field_proposals add column if not exists confidence_score smallint;',
  extractFn(SQL_059, 'enrichment_url_host'),
  extractFn(SQL_059, 'enrichment_is_valid_website'),
  extractFn(SQL_059, 'enrichment_is_valid_phone'),
  extractFn(SQL_059, 'enrichment_value_is_meaningful'),
  extractFn(SQL_059, '_enrichment_apply_write'),
  extractFn(SQL_059, 'auto_apply_field_proposal'),
].join(String.fromCharCode(10));

const REBASED_060 = [
  extractFn(SQL_060, 'snapshot_current_value'),
  extractFn(SQL_060, '_enrichment_apply_write'),
  extractFn(SQL_060, 'rollback_enrichment_run'),
  extractFn(SQL_060, 'auto_apply_generated_description'),
  extractFn(SQL_060, 'auto_apply_booking_url'),
].join(String.fromCharCode(10));

// 059's schema/ACLs/provenance, then 061's evidence columns and publication
// functions (which reference both) -- promotion order, not file order.
const REAL_DISCOVERY_059 = [
  extractSection(SQL_059, 'closure_schema'),
  extractSection(SQL_059, 'closure_functions'),
  extractSection(SQL_059, 'discovery_schema'),
  extractSection(SQL_059, 'venues_provenance'),
].join(String.fromCharCode(10));

const REAL_DISCOVERY_061 = [
  extractSection(SQL_061, 'candidate_evidence'),
  extractSection(SQL_061, 'candidate_publication'),
].join(String.fromCharCode(10));

// 061's remaining two review-path functions (D and E). Neither sits inside a
// marked section, so they are pulled by name like the 059/060 functions above.
const REBASED_061_D = extractFn(SQL_061, 'apply_booking_url_proposal');
const REBASED_061_E = extractFn(SQL_061, 'resolve_facility_conflict');

// ── facilities / venue_facilities -- pre-existing production tables (001) ───
// Not part of any 059/060/061 draft (061 section E only adds an RPC that
// operates over them), and not in the shared bootstrap because no other
// enrichment suite needs them. `icon` gets a default here purely so a test
// insert does not have to supply a decorative column resolve_facility_
// conflict never reads; name/slug/notes -- the columns the function's logic
// actually depends on -- are otherwise byte-identical to
// supabase/migrations/001_initial_schema.sql.
const FACILITIES_SCHEMA = `
  create table if not exists facilities (
    id         uuid primary key default gen_random_uuid(),
    name       text not null unique,
    slug       text not null unique,
    icon       text not null default 'circle',
    created_at timestamptz default now()
  );
  create table if not exists venue_facilities (
    venue_id    uuid references venues(id) on delete cascade,
    facility_id uuid references facilities(id) on delete cascade,
    notes       text,
    primary key (venue_id, facility_id)
  );
`;

async function boot() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(DRAFT_COLUMNS);
  await db.exec(REBASED_059);
  await db.exec(REBASED_060);
  await db.exec(REAL_DISCOVERY_059);
  await db.exec(REAL_DISCOVERY_061);
  await db.exec(REBASED_061_D);
  await db.exec(REBASED_061_E);
  await db.exec(FACILITIES_SCHEMA);
  return { db, h: makeHelpers(db) };
}

async function proposeBooking(h, venueId, url, opts = {}) {
  return h.newProposal(venueId, 'booking_url', { v: url }, opts);
}

async function main() {
  console.log('Migration 061 -- database tests (pglite, no live Supabase, migration NOT applied to production)');
  console.log('Bootstrap: supabase/tests/_enrichment_bootstrap.mjs (production-faithful)\n');

  const { db, h } = await boot();

  // =============================================================================
  // B. queue_candidate_for_review -- the unattended pre-screen. It queues; it
  //    never publishes. auto_accept_candidate no longer exists.
  // =============================================================================

  await test('B: REFUSES a single-source candidate even at a perfect confidence score of 100', async () => {
    const c = await h.newCandidate({
      confidence_score: 100, independent_identity_evidence_count: 1, identity_evidence_sources: ['osm'],
    });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]),
      /insufficient_independent_identity_evidence/, 'single source refused');
    await h.reset();
    const row = await h.candidate(c);
    eq(row.status, 'candidate', 'status unchanged');
    eq(row.venue_id, null, 'no venue created');
  });

  // CONTRACT CHANGE: 061 replaces auto_accept_candidate (which INSERTed
  // directly into venues) with queue_candidate_for_review, which contains no
  // INSERT INTO venues at all. The strongest outcome ANY unattended caller can
  // reach is 'quarantined' -- publication requires a named human admin via
  // resolve_discovery_candidate (section C below). This is THE release-one
  // guarantee (bootstrap PART A, RULE 6), asserted explicitly rather than
  // inferred from "no error was thrown".
  await test('B: a candidate passing every unattended gate is QUEUED for human review, never published', async () => {
    const c = await h.newCandidate({ independent_identity_evidence_count: 2, name: 'Two Source Venue' });
    await h.asService();
    const res = (await h.q(`select queue_candidate_for_review($1) as r`, [c])).rows[0].r;
    await h.reset();
    eq(res.ok, true, 'the pre-screen passed');
    eq(res.published, false, 'release-one: nothing may publish unattended');
    eq(res.status, 'quarantined');
    eq(res.awaiting, 'resolve_discovery_candidate');
    const row = await h.candidate(c);
    eq(row.status, 'quarantined');
    eq(row.venue_id, null, 'no venue was created');
    eq(await h.venueByName('Two Source Venue'), null,
      'confirms no venue exists anywhere, not just that this row lacks a venue_id');
  });

  await test('B: evidence gate is independent of the score gate (low score still refused first)', async () => {
    const c = await h.newCandidate({ confidence_score: 50, independent_identity_evidence_count: 5 });
    await h.asService();
    await throws(h.q(`select queue_candidate_for_review($1)`, [c]), /below_min_score/, 'score still enforced');
    await h.reset();
  });

  // CONTRACT CHANGE: the old test only checked that the 2-argument overload
  // was gone and a 3-argument one existed -- but 061 does not narrow
  // auto_accept_candidate's signature, it REMOVES the function entirely. A
  // tightened gate is still a door that exists (see the migration's own
  // header comment); checking arities could miss a reintroduced overload
  // under a third arity. The only proof that matters is that no function of
  // this name survives at all.
  await test('B: auto_accept_candidate does not exist in ANY signature -- the publishing function is gone, not merely re-gated', async () => {
    await h.reset();
    const r = await h.q(`
      select count(*)::int as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'auto_accept_candidate'
    `);
    eq(r.rows[0].n, 0, 'no auto_accept_candidate function of any arity may exist');
  });

  await test('B: default evidence column value is the SAFE one (0 = refuse), not a permissive backfill', async () => {
    await h.reset();
    const r = await h.q(`
      select column_default from information_schema.columns
      where table_name='venue_discovery_candidates' and column_name='independent_identity_evidence_count'
    `);
    eq(String(r.rows[0].column_default).startsWith('0'), true, 'defaults to 0');
  });

  // CONTRACT CHANGE: retargeted from auto_accept_candidate (gone) to
  // queue_candidate_for_review, its replacement as the service_role-only
  // unattended entry point.
  await test('B: queue_candidate_for_review is service_role only', async () => {
    await h.reset();
    const acl = await h.fnAcl('public.queue_candidate_for_review(uuid,smallint,smallint)');
    assert(acl.exists, 'queue_candidate_for_review must exist');
    eq(acl.PUBLIC, false, 'PUBLIC denied');
    eq(acl.anon, false, 'anon denied');
    eq(acl.authenticated, false, 'authenticated denied');
    eq(acl.service_role, true, 'service_role allowed -- the automated discovery pipeline');
  });

  // =============================================================================
  // C. resolve_discovery_candidate -- the ONLY candidate -> live venue path
  // =============================================================================

  // CONTRACT CHANGE: terminal state on approval is 'approved', not the
  // retired 'auto_accepted' (that name implied automation decided, and
  // nothing does any more). Provenance is now MAPPED, never passed through
  // (bootstrap PART A, RULE 7): a canonical OSM source_id must produce
  // data_source='osm', license='ODbL-1.0', a matching osm_id and the
  // openstreetmap attribution on the published venue -- not just a bare
  // is_published=true.
  await test('C: an admin can APPROVE a single-source quarantined candidate -- a human review IS the evidence', async () => {
    const c = await h.newCandidate({
      status: 'quarantined', independent_identity_evidence_count: 1,
      source: 'osm', source_id: 'node/909090', name: 'Single Source Venue',
    });
    await h.asUser(ADMIN);
    const res = (await h.q(`select resolve_discovery_candidate($1,'approve','looks legitimate') as r`, [c])).rows[0].r;
    await h.reset();
    eq(res.ok, true, 'approved');
    eq(res.published, true, 'a human decision DOES publish -- unlike queue_candidate_for_review');
    const row = await h.candidate(c);
    eq(row.status, 'approved', 'terminal state is approved, not the retired auto_accepted');
    eq(row.resolved_mode, 'manual', 'release one has exactly one publication mode');
    eq(row.reviewed_by, ADMIN, 'human attributed');
    eq(row.review_notes, 'looks legitimate', 'notes preserved');
    assert(row.venue_id, 'venue_id must name the venue this decision created');
    const v = (await h.q(`select * from venues where id=$1`, [row.venue_id])).rows[0];
    eq(v.is_published, true, 'venue published');
    eq(v.data_source, 'osm', 'provenance is MAPPED from source, never passed through raw');
    eq(v.license, 'ODbL-1.0', 'the ODbL licence must survive publication');
    eq(v.osm_id, 'node/909090', 'the OSM node/way/relation identity must not be lost');
    eq(JSON.stringify(v.attribution_required), JSON.stringify(['openstreetmap']));
  });

  // CONTRACT CHANGE: dismiss now sets status='dismissed', not 'duplicate'.
  // 'duplicate' is a FACTUAL claim about another candidate row (see the
  // status-vocabulary comment in 059's discovery_schema section); overloading
  // it for "the reviewer decided not for us" made the audit trail lie about
  // why the row was closed.
  await test('C: an admin can REJECT and DISMISS, so nothing is stuck', async () => {
    // newCandidate() calls reset() internally (it needs no auth identity to
    // insert), which would otherwise wipe out asUser(ADMIN) if called first --
    // every fixture-creation call in this suite must come BEFORE the asUser
    // that has to survive into the actual RPC call.
    const rejected = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(ADMIN);
    await h.q(`select resolve_discovery_candidate($1,'reject','not a family venue')`, [rejected]);
    // reset() before reading the row back: venue_discovery_candidates grants
    // SELECT only to service_role (D12), so the 'authenticated' role asUser()
    // switched to cannot see its own write -- reset() returns to the
    // unrestricted connection role the fixture helpers themselves use.
    await h.reset();
    const rejectedRow = await h.candidate(rejected);
    eq(rejectedRow.status, 'rejected');
    eq(rejectedRow.resolved_mode, 'manual');
    eq(rejectedRow.reviewed_by, ADMIN);

    const dismissed = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(ADMIN);
    await h.q(`select resolve_discovery_candidate($1,'dismiss','already have it')`, [dismissed]);
    await h.reset();
    const dismissedRow = await h.candidate(dismissed);
    eq(dismissedRow.status, 'dismissed', 'dismiss must record dismissed, not the factual claim duplicate');
  });

  await test('C: a NON-admin cannot resolve a candidate', async () => {
    const c = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(OTHER);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]), /not_admin/, 'non-admin refused');
    await h.reset();
  });

  await test('C: refuses an invalid decision, an already-terminal candidate, and a known duplicate', async () => {
    const c = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_discovery_candidate($1,'banana',null)`, [c]), /invalid_decision/, 'bad decision');

    // A pre-terminal candidate must carry a complete audit trail to satisfy
    // the table's own terminal_audit_ck -- unlike the earlier fixture's bare
    // status column, that constraint is now real and enforced at insert.
    const done = await h.newCandidate({
      status: 'rejected', resolved_mode: 'manual', reviewed_by: ADMIN, reviewed_at: new Date().toISOString(),
    });
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [done]), /not_resolvable/, 'terminal refused');

    const dup = await h.newCandidate({ status: 'quarantined', dedupe_decision: 'duplicate' });
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [dup]), /is_duplicate/, 'duplicate never published');
    await h.reset();
  });

  await test('C: an admin still cannot publish a candidate missing required venue fields', async () => {
    const c = await h.newCandidate({ status: 'quarantined', city: null });
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]),
      /missing_required_venue_fields/, 'data quality still enforced');
    await h.reset();
  });

  // NEW, required by the contract change (RULE 7 -- fails closed): a
  // non-canonical OSM source_id cannot be turned into a licence/attribution
  // claim, so the candidate goes BACK to quarantine with the reason recorded,
  // rather than a bare exception the admin has no way to act on.
  await test('C: approval FAILS CLOSED and re-quarantines (not lost) when the OSM identity cannot be stated', async () => {
    const c = await h.newCandidate({ status: 'quarantined', source: 'osm', source_id: 'not-an-osm-id', name: 'Bad Ident' });
    await h.asUser(ADMIN);
    const res = (await h.q(`select resolve_discovery_candidate($1,'approve',null) as r`, [c])).rows[0].r;
    await h.reset();
    eq(res.ok, false);
    eq(res.published, false);
    eq(res.outcome, 'quarantined_unmappable_provenance');
    eq(await h.venueByName('Bad Ident'), null, 'nothing is published on a guess');
    const row = await h.candidate(c);
    eq(row.status, 'quarantined', 'the row is held, not lost or left in limbo');
    eq(row.venue_id, null);
    assert(JSON.stringify(row.resolution_reasons).includes('unmappable_provenance'),
      'the reviewer must be told WHY, in machine-readable form');
  });

  // NEW, required by the contract change: venues.osm_id is UNIQUE, so
  // publishing a second venue with an OSM identity we already hold is not a
  // 500 to surface to the admin -- it is evidence the dedupe pass missed
  // something, which fails closed the same way as an unmappable identity.
  await test('C: approval FAILS CLOSED when the OSM identity already belongs to another venue', async () => {
    await h.reset();
    await h.q(`insert into venues (name, city, latitude, longitude, data_source, osm_id)
               values ('Existing Venue','Bath',51.38,-2.36,'osm','node/777')`);
    const c = await h.newCandidate({ status: 'quarantined', source: 'osm', source_id: 'node/777', name: 'Dup Ident' });
    await h.asUser(ADMIN);
    const res = (await h.q(`select resolve_discovery_candidate($1,'approve',null) as r`, [c])).rows[0].r;
    await h.reset();
    eq(res.ok, false);
    eq(res.outcome, 'quarantined_duplicate_source_identity');
    eq(await h.venueByName('Dup Ident'), null);
    eq((await h.candidate(c)).status, 'quarantined');
  });

  // =============================================================================
  // D. apply_booking_url_proposal -- the admin path for a booking_url proposal
  // =============================================================================

  // CONTRACT CHANGE: the old assertions read venue_field_proposals.applied_by
  // (a text column) -- that column does not exist (bootstrap PART A, RULE 1).
  // Provenance is now applied_mode='manual' on the proposal plus a
  // venue_enrichment_writes ledger row whose applied_by is the acting admin's
  // uuid, checked via the shared ledgerFor() helper.
  await test('D happy: an admin can approve a THIRD-PARTY booking host that automation refused', async () => {
    const v = await h.newVenue({ website: 'https://venue.co.uk' });
    const { proposal: id } = await proposeBooking(h, v, 'https://bookwhen.com/venue');
    // Automation refuses this exact proposal (different host to the venue's
    // own website)...
    await throws(h.q(`select auto_apply_booking_url($1)`, [id]), /host_identity_mismatch/, 'automation refuses');
    // ...and the admin path is what resolves it -- admin policy deliberately
    // does not require same-host identity (a human can recognise a
    // legitimate third-party booking provider).
    await h.asUser(ADMIN);
    const res = await h.q(`select apply_booking_url_proposal($1,null,'verified by phone') as r`, [id]);
    eq(res.rows[0].r.ok, true, 'admin applied');
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url,
      'https://bookwhen.com/venue', 'written');
    const p = await h.q(`select status, applied_mode, reviewed_by, review_notes from venue_field_proposals where id=$1`, [id]);
    eq(p.rows[0].status, 'applied', 'status applied');
    eq(p.rows[0].applied_mode, 'manual', 'proposal-level provenance is applied_mode, not a text applied_by column');
    eq(p.rows[0].reviewed_by, ADMIN, 'audit trail records which admin');
    eq(p.rows[0].review_notes, 'verified by phone', 'notes preserved');
    const ledger = (await h.ledgerFor(id))[0];
    eq(ledger.applied_mode, 'manual');
    eq(ledger.applied_by, ADMIN, 'actor identity lives in the ledger, as a uuid');
    assert(JSON.stringify(ledger.decision_reasons).includes('admin_approved_booking_url'),
      'the human decision must be recorded in the machine-readable reasons too');
    await h.reset();
  });

  await test('D: a NON-admin cannot apply a booking_url proposal', async () => {
    const v = await h.newVenue({ website: 'https://venue2.co.uk' });
    const { proposal: id } = await proposeBooking(h, v, 'https://bookwhen.com/venue2');
    await h.asUser(OTHER);
    await throws(h.q(`select apply_booking_url_proposal($1,null,null)`, [id]), /not_admin/, 'non-admin refused');
    await h.reset();
  });

  await test('D: enforces the stale-current-value guard', async () => {
    const v = await h.newVenue({ website: 'https://venue3.co.uk' });
    const { proposal: id } = await proposeBooking(h, v, 'https://bookwhen.com/venue3');
    await h.q(`update venues set booking_url='https://changed.example/' where id=$1`, [v]);
    await h.asUser(ADMIN);
    await throws(h.q(`select apply_booking_url_proposal($1,null,null)`, [id]), /stale_current_value/, 'stale detected');
    await h.reset();
  });

  // CONTRACT CHANGE / FIXTURE FIX: this is the test that used to fail with
  // "expected_current_value_mismatch" for the wrong reason -- the old private
  // fixture's proposeBooking() did not compute current_value_hash from a real
  // snapshot_current_value() call, so the guard's behaviour could not be
  // trusted. h.newProposal() (the shared helper) DOES compute a genuine
  // snapshot, so the guard now behaves exactly as it does in production. The
  // old regex (/unexpected_current_value/) also never matched the function's
  // actual message (expected_current_value_mismatch) -- fixed here too.
  await test('D: enforces the expected-current-value guard when the caller asserts one', async () => {
    const v = await h.newVenue({ website: 'https://venue4.co.uk' });
    const { proposal: id } = await proposeBooking(h, v, 'https://bookwhen.com/venue4');
    await h.asUser(ADMIN);
    await throws(
      h.q(`select apply_booking_url_proposal($1,'https://not-what-is-live.example/',null)`, [id]),
      /expected_current_value_mismatch/, 'expected-value mismatch caught',
    );
    // NULL means "not asserted" and still applies.
    eq((await h.q(`select apply_booking_url_proposal($1,null,null) as r`, [id])).rows[0].r.ok, true, 'null assertion allowed');
    await h.reset();
  });

  // CONTRACT CHANGE: the userinfo-disguise case's actual error is
  // unparseable_booking_url, not unparseable_booking_host as the old test
  // guessed -- fixed to match the real message from 060's
  // _enrichment_apply_write.
  await test('D: an admin still cannot apply an http:// or unparseable booking URL', async () => {
    const v = await h.newVenue({ website: 'https://venue5.co.uk' });
    const { proposal: insecure } = await proposeBooking(h, v, 'http://bookwhen.com/venue5');
    await h.asUser(ADMIN);
    await throws(h.q(`select apply_booking_url_proposal($1,null,null)`, [insecure]),
      /insecure_or_invalid_scheme/, 'http refused for admins too');

    // newVenue()/newProposal() reset() internally, which drops the asUser(ADMIN)
    // set above -- it must be re-asserted after every fixture-creation call.
    const v6 = await h.newVenue({ website: 'https://venue6.co.uk' });
    const { proposal: disguised } = await proposeBooking(h, v6, 'https://venue6.co.uk@evil.example/book');
    await h.asUser(ADMIN);
    await throws(h.q(`select apply_booking_url_proposal($1,null,null)`, [disguised]),
      /unparseable_booking_url/, 'userinfo refused');
    await h.reset();
  });

  await test('D: refuses the wrong field and an already-applied proposal', async () => {
    const v = await h.newVenue({ website: 'https://venue7.co.uk' });
    const { proposal: wrong } = await h.newProposal(v, 'phone', { v: '01234567890' });
    await h.asUser(ADMIN);
    await throws(h.q(`select apply_booking_url_proposal($1,null,null)`, [wrong]), /wrong_field/, 'wrong field');

    // proposeBooking() -> newProposal() resets again -- re-assert ADMIN.
    const { proposal: id } = await proposeBooking(h, v, 'https://bookwhen.com/venue7');
    await h.asUser(ADMIN);
    await h.q(`select apply_booking_url_proposal($1,null,null)`, [id]);
    await throws(h.q(`select apply_booking_url_proposal($1,null,null)`, [id]), /not_pending/, 'double apply refused');
    await h.reset();
  });

  // RESTORED. An intermediate rewrite of this suite deleted this test on the
  // grounds that 056's own suite covers reject_venue_proposal. It does -- but
  // only for the fields 056 shipped with. The claim THIS test exists to check
  // is 061-specific and is written into the migration header as "verified, not
  // assumed": that reject_venue_proposal is field-agnostic, and therefore the
  // REJECT half of the booking_url workflow needed no new function at all.
  // Nothing else in the repo checks that, so deleting it lost real coverage.
  await test('D: reject_venue_proposal already closes a booking_url proposal (no change needed)', async () => {
    const v = await h.newVenue({ website: 'https://venue.test' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://bookwhen.test/venue' });
    await h.asUser(ADMIN);
    const r = (await h.q(`select reject_venue_proposal($1,'not a real booking link') as r`, [proposal])).rows[0].r;
    eq(r.ok, true, 'the generic reject path must handle booking_url with no special case');
    await h.reset();
    const p = (await h.q(
      `select status, review_notes, reviewed_by from venue_field_proposals where id=$1`, [proposal])).rows[0];
    eq(p.status, 'rejected');
    eq(p.review_notes, 'not a real booking link');
    eq(p.reviewed_by, ADMIN, 'the rejecting admin is recorded');
    // And it stays closed -- no second decision on the same row.
    await h.asUser(ADMIN);
    await throws(h.q(`select reject_venue_proposal($1,'again')`, [proposal]), /not_pending/,
      'a rejected booking_url proposal cannot be re-decided');
    await h.reset();
  });

  await test('D: apply_booking_url_proposal is not executable by anon', async () => {
    await h.reset();
    const acl = await h.fnAcl('public.apply_booking_url_proposal(uuid,text,text)');
    assert(acl.exists, 'apply_booking_url_proposal must exist');
    eq(acl.anon, false, 'anon denied');
    eq(acl.PUBLIC, false, 'PUBLIC denied');
    eq(acl.authenticated, true, 'authenticated (admin-gated inside the body)');
    // CONTRACT CHANGE: service_role EXECUTE was REVOKED. The comment this
    // assertion used to carry ("for the pipeline exception-queue tooling") was
    // not true -- exceptionQueue.ts only ever prints this RPC's name to a human
    // operator, and a repo-wide grep finds no call site outside __tests__. The
    // function is is_admin()-gated, and service_role has no auth.uid(), so the
    // grant advertised a capability that could never have worked.
    eq(acl.service_role, false, 'service_role revoked -- verified to have no call site');
  });

  // =============================================================================
  // E. resolve_facility_conflict -- the admin path for a facility conflict
  // =============================================================================

  await test('E: an admin can remove an official-enrichment facility row to resolve a conflict', async () => {
    // newVenue() calls reset() internally -- create fixtures BEFORE asUser().
    const v = await h.newVenue();
    await h.asUser(ADMIN);
    const f = await h.q(`insert into facilities (slug, name) values ('parking','Parking') returning id`);
    await h.q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,'official-enrichment')`, [v, f.rows[0].id]);

    const res = await h.q(`select resolve_facility_conflict($1,'parking','remove_official','site says no parking') as r`, [v]);
    eq(res.rows[0].r.removed, 1, 'one row removed');
    eq((await h.q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v])).rows[0].n, 0, 'row gone');
    await h.reset();
  });

  await test('E: NEVER removes a parent-confirmed row -- community evidence is protected', async () => {
    const v = await h.newVenue();
    await h.asUser(ADMIN);
    const f = await h.q(`select id from facilities where slug='parking'`);
    await h.q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,'parent-confirmed')`, [v, f.rows[0].id]);

    const res = await h.q(`select resolve_facility_conflict($1,'parking','remove_official',null) as r`, [v]);
    eq(res.rows[0].r.removed, 0, 'nothing removed');
    eq((await h.q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v])).rows[0].n, 1, 'parent-confirmed row survives');
    await h.reset();
  });

  await test('E: NEVER removes an admin/import row (NULL notes)', async () => {
    const v = await h.newVenue();
    await h.asUser(ADMIN);
    const f = await h.q(`select id from facilities where slug='parking'`);
    await h.q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,null)`, [v, f.rows[0].id]);
    const res = await h.q(`select resolve_facility_conflict($1,'parking','remove_official',null) as r`, [v]);
    eq(res.rows[0].r.removed, 0, 'nothing removed');
    await h.reset();
  });

  await test("E: 'keep' is a real terminal outcome and removes nothing", async () => {
    const v = await h.newVenue();
    await h.asUser(ADMIN);
    const f = await h.q(`select id from facilities where slug='parking'`);
    await h.q(`insert into venue_facilities (venue_id, facility_id, notes) values ($1,$2,'official-enrichment')`, [v, f.rows[0].id]);
    const res = await h.q(`select resolve_facility_conflict($1,'parking','keep',null) as r`, [v]);
    eq(res.rows[0].r.decision, 'keep', 'decision recorded');
    eq(res.rows[0].r.removed, 0, 'nothing removed');
    eq((await h.q(`select count(*)::int as n from venue_facilities where venue_id=$1`, [v])).rows[0].n, 1, 'row kept');
    await h.reset();
  });

  await test('E: a NON-admin cannot resolve a facility conflict, and an unknown slug is refused', async () => {
    const v = await h.newVenue();
    await h.asUser(OTHER);
    await throws(h.q(`select resolve_facility_conflict($1,'parking','remove_official',null)`, [v]), /not_admin/, 'non-admin refused');
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_facility_conflict($1,'no-such-slug','remove_official',null)`, [v]), /unknown_facility_slug/, 'unknown slug refused');
    await throws(h.q(`select resolve_facility_conflict($1,'parking','banana',null)`, [v]), /invalid_decision/, 'bad decision refused');
    await h.reset();
  });

  await db.close();

  console.log(`\n${state.passed} passed, ${state.failures.length} failed`);
  if (state.failures.length > 0) {
    for (const f of state.failures) console.error(`  FAILED: ${f.name} -- ${f.message}`);
    process.exitCode = 1;
  }
}

await main();
