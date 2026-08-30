// =============================================================================
// supabase/tests/enrichment_057_rebase_redline.mjs
//
// The RED LINE for the 057 enrichment rebase.
//
// This suite exists to FAIL before the rewrite of drafts 059/060/061, and to go
// green only once every autonomous enrichment write routes through migration
// 057's audited primitive. It is the executable definition of "done".
//
// Two kinds of test live here and are reported SEPARATELY:
//
//   test(...)  normal expectation. A failure here is a real regression.
//   red(...)   a KNOWN current defect, expected to fail. The mechanism is kept
//              because it is how a future defect gets recorded honestly, but
//              AS OF THE CANDIDATE SAFETY PASS THERE ARE NONE: D5 (geoapify vs
//              the data_source CHECK), D6 (OSM licence/provenance lost), D12
//              (new-table ACLs) and D15 (unattended publication) are all fixed
//              and now assert the fixed behaviour. An UNEXPECTEDLY GREEN red is
//              still reported, because it means the test stopped reproducing
//              what it claims to.
//
// Shared, production-faithful fixtures come from _enrichment_bootstrap.mjs.
// The canonical provenance contract (PART A) is documented there.
//
// Run:  node supabase/tests/enrichment_057_rebase_redline.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  BOOTSTRAP, DRAFT_COLUMNS, makeHelpers, makeHarness,
  OWNER, OTHER, ADMIN, PP011_OWNER_ALLOWLIST, VENUE_INSERT_COLUMNS_063,
  GEOAPIFY_OSM_DATASOURCE,
  extractFn, extractSection,
} from './_enrichment_bootstrap.mjs';

// `red` is intentionally NOT destructured: there are no known unfixed defects
// left in this suite, and an unused import would only invite one being parked
// here. makeHarness() still exports it — re-add it the day a defect genuinely
// cannot be fixed in the same pass it is found.
const { state, test, assert, eq, throws } = makeHarness();

// ── The draft 060 replacement of snapshot_current_value ──────────────────────
// Byte-identical to the live 056 definition EXCEPT the booking_url branch.
// Installed only inside this disposable harness; the shipped function is not
// touched by this pass.
const DRAFT_060_SNAPSHOT = `
  create or replace function snapshot_current_value(p_venue_id uuid, p_field text)
  returns jsonb language plpgsql stable security definer set search_path = public as $fn$
  declare v_value jsonb; v_text text;
  begin
    if p_field = 'opening_hours' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'day_of_week', day_of_week, 'is_closed', is_closed,
               'opens_at', opens_at, 'closes_at', closes_at, 'notes', notes
             ) order by day_of_week), '[]'::jsonb)
        into v_value from opening_hours where venue_id = p_venue_id;
    elsif p_field = 'description' then
      select to_jsonb(description) into v_value from venues where id = p_venue_id;
    elsif p_field = 'price_range' then
      select to_jsonb(price_range) into v_value from venues where id = p_venue_id;
    elsif p_field = 'website' then
      select to_jsonb(website) into v_value from venues where id = p_venue_id;
    elsif p_field = 'phone' then
      select to_jsonb(phone) into v_value from venues where id = p_venue_id;
    elsif p_field = 'email' then
      select to_jsonb(email) into v_value from venues where id = p_venue_id;
    elsif p_field = 'booking_url' then
      select to_jsonb(booking_url) into v_value from venues where id = p_venue_id;
    else
      raise exception 'invalid_field:%', p_field;
    end if;
    if p_field <> 'opening_hours' and v_value is not null then
      v_value := jsonb_build_object('v', v_value);
    end if;
    v_text := p_field || ':' || coalesce(v_value::text, 'null');
    return jsonb_build_object('value', v_value,
      'hash', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
  end $fn$;
`;

// ── Load the REAL rebased draft SQL ──────────────────────────────────────────
// These tests run the ACTUAL migration text, not a reproduction of it, so the
// suite cannot drift from what would be promoted.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(__dirname, '../migrations_drafts');
const SQL_059 = readFileSync(join(DRAFTS, '059_enrichment_autonomy.sql'), 'utf8');
const SQL_060 = readFileSync(join(DRAFTS, '060_enrichment_2_1.sql'), 'utf8');
const SQL_061 = readFileSync(join(DRAFTS, '061_enrichment_review_paths.sql'), 'utf8');

// Pulls "CREATE OR REPLACE FUNCTION <name>(" through its terminating $$; and
// any REVOKE/GRANT lines that immediately follow for the same function.
// extractFn now comes from _enrichment_bootstrap.mjs (single definition).

// The rebased enrichment layer, assembled from the real drafts in apply order.
const REBASED_059 = [
  // confidence_score column (059); the competing applied_by text column is gone.
  "alter table venue_field_proposals add column if not exists confidence_score smallint;",
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

const REBASED_061 = [
  extractFn(SQL_061, 'apply_booking_url_proposal'),
  extractFn(SQL_061, 'resolve_facility_conflict'),
].join(String.fromCharCode(10));

// Pulls a marked block out of a migration file:
//   -- @test-section: <name>   ...   -- @end-section: <name>
// The markers exist so these tests execute the REAL DDL, ACLs and CHECK
// constraints that would be promoted, instead of a hand-written reproduction
// of them. A reproduction is how the earlier version of this suite ended up
// asserting against a copy of the defect rather than against the migration.
// extractSection now comes from _enrichment_bootstrap.mjs (single definition).

// The REAL release-one discovery layer, assembled from the draft files in
// promotion order. 059 creates the tables, the table ACLs, the venues
// provenance columns and the provenance mapping; 061 adds the evidence columns
// and the two publication-path functions.
const REAL_DISCOVERY_059 = [
  extractSection(SQL_059, 'closure_schema'),
  extractSection(SQL_059, 'closure_functions'),
  extractSection(SQL_059, 'discovery_schema'),
  extractSection(SQL_059, 'venues_provenance'),
].join(String.fromCharCode(10));

const REAL_DISCOVERY_061 = [
  extractSection(SQL_061, 'candidate_evidence'),
  extractSection(SQL_061, 'candidate_upsert'),
  extractSection(SQL_061, 'candidate_publication'),
].join(String.fromCharCode(10));

// Every candidate/closure function the drafts introduce, for the ACL matrix.
const CANDIDATE_FUNCTIONS = [
  ['public.upsert_discovery_candidate(jsonb)',
   { PUBLIC: false, anon: false, authenticated: false, service_role: true },
   'service_role — the discovery pipeline. Refuses to reopen a settled candidate.'],
  ['public._venue_record_status_transition(uuid,text,text,uuid,text,jsonb,text,uuid)',
   { PUBLIC: false, anon: false, authenticated: false, service_role: false },
   'internal only — the three closure wrappers carry the authorisation.'],
  ['public.venue_operating_status_events_append_only()',
   { PUBLIC: false, anon: false, authenticated: false, service_role: false },
   'trigger helper — never called directly (20260830102402 standard).'],
  ['public.queue_candidate_for_review(uuid,smallint,smallint)',
   { PUBLIC: false, anon: false, authenticated: false, service_role: true },
   'service_role — the discovery pipeline. Cannot publish; quarantines only.'],
  ['public.resolve_discovery_candidate(uuid,text,text)',
   { PUBLIC: false, anon: false, authenticated: true, service_role: false },
   'authenticated + is_admin() + a real auth.uid(). THE only publication path.'],
  ['public.discovery_candidate_provenance(text,text,jsonb)',
   { PUBLIC: false, anon: false, authenticated: false, service_role: true },
   'service_role, and internally by the SECURITY DEFINER resolve path.'],
  ['public.system_flag_suspected_closure(uuid,text,jsonb,uuid,text)',
   { PUBLIC: false, anon: false, authenticated: false, service_role: true },
   'service_role — the ONLY automated transition, and only active->suspected_closed.'],
  ['public.confirm_venue_closure(uuid,text)',
   { PUBLIC: false, anon: false, authenticated: true, service_role: false },
   'authenticated admin — destructive, hides the venue from discovery.'],
  ['public.reactivate_venue(uuid,text)',
   { PUBLIC: false, anon: false, authenticated: true, service_role: false },
   'authenticated admin — restores the visibility closure actually took away.'],
  ['public.apply_booking_url_proposal(uuid,text,text)',
   { PUBLIC: false, anon: false, authenticated: true, service_role: false },
   'authenticated admin — service_role revoked (is_admin()-gated, no call site).'],
  ['public.resolve_facility_conflict(uuid,text,text,text)',
   { PUBLIC: false, anon: false, authenticated: true, service_role: false },
   'authenticated admin — service_role revoked (is_admin()-gated, no call site).'],
];


async function boot({ draftColumns = false, draftShapes = false, draftSnapshot = false,
                      rebased = false } = {}) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  if (draftColumns || rebased) await db.exec(DRAFT_COLUMNS);
  if (draftSnapshot) await db.exec(DRAFT_060_SNAPSHOT);
  if (rebased) {
    // Apply order matters: 059 then 060 then 061, as promotion would.
    await db.exec(REBASED_059);
    await db.exec(REBASED_060);
    await db.exec(REBASED_061);
  }
  if (draftShapes) {
    // Promotion order: 059's schema/ACLs/provenance, then 061's evidence
    // columns and publication functions (which reference both).
    await db.exec(REAL_DISCOVERY_059);
    await db.exec(REAL_DISCOVERY_061);
  }
  return { db, h: makeHelpers(db) };
}

// =============================================================================
// PART B — snapshot_current_value compatibility
// =============================================================================
async function partB() {
  console.log('\nPART B -- snapshot_current_value: the 060 change must be PURELY ADDITIVE\n');
  const { db, h } = await boot();

  const FIELDS = ['description', 'price_range', 'website', 'phone', 'email', 'opening_hours'];

  await test('B1. live snapshot returns {value,hash} with the documented shape', async () => {
    const v = await h.newVenue({ website: 'https://a.test', phone: '0123', description: 'd' });
    for (const f of FIELDS) {
      const s = (await h.q(`select snapshot_current_value($1,$2) as s`, [v, f])).rows[0].s;
      assert('value' in s && 'hash' in s, `${f} must return value+hash`);
      eq(typeof s.hash, 'string');
      eq(s.hash.length, 64, `${f} hash must be sha256 hex`);
    }
  });

  await test('B2. scalar fields wrap as {"v":...}; opening_hours does not', async () => {
    const v = await h.newVenue({ website: 'https://a.test' });
    const w = (await h.q(`select snapshot_current_value($1,'website') as s`, [v])).rows[0].s;
    eq(JSON.stringify(w.value), JSON.stringify({ v: 'https://a.test' }));
    const oh = (await h.q(`select snapshot_current_value($1,'opening_hours') as s`, [v])).rows[0].s;
    assert(Array.isArray(oh.value), 'opening_hours must be a bare array');
  });

  await test('B3. NULL scalars produce value=null and a field-prefixed hash', async () => {
    const v = await h.newVenue();
    const a = (await h.q(`select snapshot_current_value($1,'website') as s`, [v])).rows[0].s;
    const b = (await h.q(`select snapshot_current_value($1,'phone') as s`, [v])).rows[0].s;
    eq(a.value, null); eq(b.value, null);
    assert(a.hash !== b.hash, 'a NULL value must hash DIFFERENTLY per field');
  });

  await test('B4. opening_hours is ordered by day_of_week regardless of insert order', async () => {
    const v = await h.newVenue();
    await h.reset();
    for (const d of [3, 0, 6, 1]) {
      await h.q(`insert into opening_hours (venue_id, day_of_week, is_closed) values ($1,$2,true)`, [v, d]);
    }
    const s = (await h.q(`select snapshot_current_value($1,'opening_hours') as s`, [v])).rows[0].s;
    const days = s.value.map((x) => x.day_of_week);
    eq(JSON.stringify(days), JSON.stringify([...days].sort((x, y) => x - y)), 'must be day-ordered');
  });

  await test('B5. an unknown field raises invalid_field', async () => {
    const v = await h.newVenue();
    await throws(h.q(`select snapshot_current_value($1,'not_a_field')`, [v]), /invalid_field/);
  });

  await test('B6. hashes are stable across repeated calls', async () => {
    const v = await h.newVenue({ website: 'https://a.test' });
    const a = (await h.q(`select snapshot_current_value($1,'website') as s`, [v])).rows[0].s.hash;
    const b = (await h.q(`select snapshot_current_value($1,'website') as s`, [v])).rows[0].s.hash;
    eq(a, b);
  });

  // THE decisive compatibility test.
  await test('B7. the 060 replacement leaves EVERY pre-existing field byte/hash identical', async () => {
    const v = await h.newVenue({ website: 'https://a.test', phone: '01225 000000', description: 'A place' });
    await h.reset();
    await h.q(`update venues set price_range='budget', email='x@y.test' where id=$1`, [v]);
    await h.q(`insert into opening_hours (venue_id, day_of_week, opens_at, closes_at)
               values ($1,1,'09:00','17:00')`, [v]);

    const before = {};
    for (const f of FIELDS) {
      before[f] = (await h.q(`select snapshot_current_value($1,$2) as s`, [v, f])).rows[0].s;
    }
    // Apply the draft column + the draft function inside this disposable DB only.
    await db.exec(DRAFT_COLUMNS);
    await db.exec(DRAFT_060_SNAPSHOT);

    for (const f of FIELDS) {
      const after = (await h.q(`select snapshot_current_value($1,$2) as s`, [v, f])).rows[0].s;
      eq(after.hash, before[f].hash, `060 CHANGED the hash for ${f} -- this would invalidate every pending ${f} proposal`);
      eq(JSON.stringify(after.value), JSON.stringify(before[f].value), `060 changed the value shape for ${f}`);
    }
  });

  await test('B8. booking_url gains real behaviour, and NULL stays hash-compatible', async () => {
    const { db: db2, h: h2 } = await boot();
    const v = await h2.newVenue();
    const pre = (await h2.q(`select snapshot_current_value($1,'booking_url') as s`, [v])).rows[0].s;
    await db2.exec(DRAFT_COLUMNS);
    await db2.exec(DRAFT_060_SNAPSHOT);
    const post = (await h2.q(`select snapshot_current_value($1,'booking_url') as s`, [v])).rows[0].s;
    eq(post.hash, pre.hash,
      'with booking_url NULL the hash MUST be unchanged, so no pending proposal is invalidated');
    await h2.reset();
    await h2.q(`update venues set booking_url='https://book.test' where id=$1`, [v]);
    const set = (await h2.q(`select snapshot_current_value($1,'booking_url') as s`, [v])).rows[0].s;
    assert(set.hash !== pre.hash, 'a real booking_url must now hash differently');
    eq(JSON.stringify(set.value), JSON.stringify({ v: 'https://book.test' }));
    await db2.close();
  });

  await db.close();
}

// =============================================================================
// PART D — the four defects that drove this pass, now asserting the FIXED behaviour
// =============================================================================
async function partD() {
  console.log('\nPART D -- drafts 059/060/061: the four former RED defects, now green\n');
  const { db, h } = await boot({ rebased: true, draftShapes: true });

  // ── 1/2/3: ledger, rollback, stale-rollback ────────────────────────────────
  await test('D1. an autonomous apply must create a venue_enrichment_writes row', async () => {
    const v = await h.newVenue({ claimed_by: null });
    const { proposal } = await h.newProposal(v, 'website', { v: 'https://new.test' });
    await h.asService();
    await h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]);
    await h.reset();
    const rows = await h.ledgerFor(proposal);
    eq(rows.length, 1, 'every autonomous apply must leave exactly one immutable ledger row');
    const w = rows[0];
    eq(w.applied_mode, 'auto', 'automation must record applied_mode=auto');
    eq(w.applied_by, null, 'automation has no auth user -- a NULL actor is the contract');
    assert(w.old_value_hash && w.new_value_hash, 'both hashes must be recorded');
    assert(JSON.stringify(w.decision_reasons).includes('auto_apply_confidence'),
      'the machine justification must be recorded when there is no human actor');
  });

  await test('D2. an autonomous apply must be rollbackable via rollback_enrichment_run', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { run, proposal } = await h.newProposal(v, 'website', { v: 'https://new.test' });
    await h.asService();
    await h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]);
    await h.asUser(ADMIN);
    const r = (await h.q(`select rollback_enrichment_run($1) as r`, [run])).rows[0].r;
    await h.reset();
    const after = (await h.q(`select website from venues where id=$1`, [v])).rows[0].website;
    eq(after, null, `the audited write must be fully reversed: ${JSON.stringify(r)}`);
  });

  await test('D3. a newer human edit must prevent a stale rollback', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { run, proposal } = await h.newProposal(v, 'website', { v: 'https://auto.test' });
    await h.asService();
    await h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]);
    await h.reset();
    await h.q(`update venues set website='https://human.test' where id=$1`, [v]);
    await h.asUser(ADMIN);
    const r = (await h.q(`select rollback_enrichment_run($1) as r`, [run])).rows[0].r;
    await h.reset();
    const w = (await h.q(`select website from venues where id=$1`, [v])).rows[0].website;
    eq(w, 'https://human.test', 'the human edit must survive');
    assert(JSON.stringify(r).includes('skipped_newer_change'),
      `expected an explicit skipped_newer_change outcome, got ${JSON.stringify(r)}`);
  });

  // ── 4: competing provenance ────────────────────────────────────────────────
  await test('D4. 059 must not introduce a competing text applied_by on proposals', async () => {
    await h.reset();
    const r = await h.q(
      `select data_type from information_schema.columns
        where table_schema='public' and table_name='venue_field_proposals'
          and column_name='applied_by'`);
    eq(r.rows.length, 0,
      'the competing text applied_by column must NOT be introduced');
  });

  await test('D4b. applied_mode remains the canonical proposal-level mode', async () => {
    await h.reset();
    const r = await h.q(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='venue_field_proposals'
          and column_name in ('applied_mode','decision','decision_reasons',
                              'decision_engine_version','decision_at')
        order by column_name`);
    eq(r.rows.length, 5, 'all five 057 provenance columns must be present');
  });

  // ── 5/6: provenance + licence ──────────────────────────────────────────────
  // WAS RED. The drafts passed the candidate's own `source` straight into
  // venues.data_source, whose 012 CHECK has no 'geoapify' -- so every Geoapify
  // approval failed at the moment of publication. Fixed by widening the CHECK
  // and routing provenance through discovery_candidate_provenance.
  await test('D5. a geoapify candidate publishes without violating the data_source CHECK', async () => {
    const c = await h.newCandidate({ source: 'geoapify', source_id: 'g-51a2f', name: 'Geo Play' });
    await h.asUser(ADMIN);
    const r = (await h.q(`select resolve_discovery_candidate($1,'approve','ok') as r`, [c])).rows[0].r;
    await h.reset();
    assert(r.ok && r.published, `geoapify approval must publish: ${JSON.stringify(r)}`);
    const v = await h.venueByName('Geo Play');
    assert(v, 'the venue must exist');
    eq(v.data_source, 'geoapify', 'the provider is recorded as itself -- not manual, osm or ogl');
  });

  // WAS RED. The drafts wrote name/address/coords and data_source, and
  // NOTHING else -- license, osm_id and the attribution requirement were all
  // dropped on the floor, so an OSM-derived venue became indistinguishable
  // from a manually entered one the moment it was published.
  await test('D6. a human-approved OSM venue retains its ODbL licence/provenance', async () => {
    const c = await h.newCandidate({ source: 'osm', source_id: 'way/4815162342', name: 'OSM Play' });
    await h.asUser(ADMIN);
    await h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]);
    await h.reset();
    const v = await h.venueByName('OSM Play');
    assert(v, 'the venue must exist');
    eq(v.data_source, 'osm');
    eq(v.license, 'ODbL-1.0', 'the ODbL licence must survive publication');
    eq(v.osm_id, 'way/4815162342', 'the OSM node/way/relation identity must not be lost');
    eq(v.data_source_ref, 'way/4815162342');
    eq(JSON.stringify(v.attribution_required), JSON.stringify(['openstreetmap']));
  });

  // ── 7/8/9/10: website + phone trust ────────────────────────────────────────
  await test('D7. an autonomous website write must refuse a malformed URL', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { proposal } = await h.newProposal(v, 'website', { v: 'javascript:alert(1)' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]),
      /invalid_website_url/i, 'a javascript: URL must never reach venues.website');
    await h.reset();
  });

  await test('D8. an autonomous website write must refuse to overwrite a meaningful one', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://real-business.test' });
    const { proposal } = await h.newProposal(v, 'website', { v: 'https://scraped.test' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]),
      /live_value_not_empty/i, 'automation must never overwrite a meaningful existing website');
    await h.reset();
  });

  await test('D9. an autonomous phone write must refuse a clearly invalid value', async () => {
    const v = await h.newVenue({ claimed_by: null, phone: null });
    const { proposal } = await h.newProposal(v, 'phone', { v: 'not a phone at all' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]),
      /invalid_phone/i, 'garbage must never reach venues.phone');
    await h.reset();
  });

  await test('D10. an autonomous phone write must refuse to overwrite a meaningful one', async () => {
    const v = await h.newVenue({ claimed_by: null, phone: '01225 123456' });
    const { proposal } = await h.newProposal(v, 'phone', { v: '0999 999999' });
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]),
      /live_value_not_empty/i, 'automation must never overwrite a meaningful existing phone');
    await h.reset();
  });

  // ── 12/13: privileges on new objects ───────────────────────────────────────
  // WAS RED. The drafts issued no GRANT/REVOKE for either new table, so both
  // inherited SELECT/INSERT/UPDATE/DELETE for anon and authenticated from this
  // project's ALTER DEFAULT PRIVILEGES -- leaving an RLS policy as the only
  // barrier where the contract is two independent layers.
  await test('D12. new discovery tables must deny DML to anon and authenticated', async () => {
    await h.reset();
    const bad = [];
    for (const t of ['venue_discovery_candidates', 'venue_closure_signals']) {
      for (const role of ['anon', 'authenticated']) {
        for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const held = (await h.q(`select has_table_privilege($1,$2,$3) as x`, [role, t, p])).rows[0].x;
          if (held) bad.push(`${role} ${p} ${t}`);
        }
      }
    }
    eq(bad.length, 0, `inherited DML must be revoked, still held: ${bad.join(', ')}`);
  });

  await test('D12b. the four non-DML privileges are still denied on the new tables', async () => {
    await h.reset();
    for (const t of ['venue_discovery_candidates', 'venue_closure_signals']) {
      for (const role of ['anon', 'authenticated']) {
        for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
          const held = (await h.q(`select has_table_privilege($1,$2,$3) as x`, [role, t, p])).rows[0].x;
          eq(held, false, `${role} must not inherit ${p} on ${t}`);
        }
      }
    }
  });

  await test('D13. enrichment_url_host must not rely on inherited EXECUTE defaults', async () => {
    await h.reset();
    const acl = await h.fnAcl('public.enrichment_url_host(text)');
    assert(acl.exists, 'function must exist');
    eq(acl.PUBLIC, false, 'the rebase gives it explicit REVOKE/GRANT');
    eq(acl.anon, false); eq(acl.authenticated, false);
    eq(acl.service_role, true, 'service_role is the intended caller');
  });

  // ── 14: PP-011 survival (expected GREEN) ───────────────────────────────────
  await test('D14. a claimed owner is still blocked from enrichment/system columns', async () => {
    const v = await h.newVenue({ claimed_by: OWNER });
    await h.asUser(OWNER);
    for (const [col, val] of [['is_verified', 'true'], ['discovery_approved', 'false'],
                              ['data_source', `'osm'`], ['booking_url', `'https://x.test'`]]) {
      await throws(h.q(`update venues set ${col} = ${val} where id=$1`, [v]), /42501|may not change/i,
        `PP-011 must still block ${col}`);
    }
    await h.reset();
  });

  await test('D14b. the PP-011 allowlist has NOT been widened for enrichment', async () => {
    await h.reset();
    const src = (await h.q(
      `select prosrc from pg_proc where proname='enforce_venue_owner_update_boundary'`)).rows[0].prosrc;
    for (const f of ['booking_url', 'operating_status', 'discovery_approved', 'data_source', 'license']) {
      assert(!src.includes(`'${f}'`), `${f} must NOT appear in the owner allowlist`);
    }
    for (const f of PP011_OWNER_ALLOWLIST) {
      assert(src.includes(`'${f}'`), `${f} must remain in the allowlist`);
    }
  });

  // ── 15: release-one auto-publication ───────────────────────────────────────
  // WAS RED, and it was the most serious of the four: auto_accept_candidate
  // was a service_role SECURITY DEFINER function containing
  //   INSERT INTO venues (..., is_published, moderation_status,
  //                       discovery_approved) VALUES (..., true, 'approved', true)
  // i.e. an unattended path from a third-party API response to a publicly
  // discoverable family venue. Release one has no such path; the strongest
  // outcome an unattended caller can now reach is 'quarantined'.
  await test('D15. release-one: no service_role path may publish a venue unattended', async () => {
    const c = await h.newCandidate({ name: 'Auto Published',
                                     independent_identity_evidence_count: 5 });
    await h.asService();
    const r = (await h.q(`select queue_candidate_for_review($1) as r`, [c])).rows[0].r;
    await h.reset();
    eq(r.published, false, 'the unattended path must report that it published nothing');
    eq(r.status, 'quarantined');
    eq(await h.venueByName('Auto Published'), null,
      'service_role must not be able to create a venue at all');
    const row = await h.candidate(c);
    eq(row.status, 'quarantined');
    eq(row.venue_id, null);
    assert(JSON.stringify(row.resolution_reasons).includes('release_one_human_review_required'),
      'the hold must record WHY it is being held');
  });

  await test('D15b. the human admin resolution path remains available', async () => {
    const c = await h.newCandidate({ name: 'Human Reviewed', status: 'quarantined' });
    await h.asUser(ADMIN);
    const r = (await h.q(`select resolve_discovery_candidate($1,'approve','looks real') as r`, [c])).rows[0].r;
    await h.reset();
    assert(r.ok && r.published, `a quarantined candidate must be resolvable: ${JSON.stringify(r)}`);
    const v = await h.venueByName('Human Reviewed');
    assert(v && v.is_published && v.moderation_status === 'approved' && v.discovery_approved,
      'the human path must produce a fully published venue');
  });

  await db.close();
}

// =============================================================================
// PART E — the 057 extension design, asserted as executable facts
// =============================================================================
async function partE() {
  console.log('\nPART E -- facts the _enrichment_apply_write extension design rests on\n');
  const { db, h } = await boot();

  await test('E1. BASELINE (pre-rebase): _enrichment_apply_write REFUSES booking_url', async () => {
    const v = await h.newVenue({ claimed_by: null });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://book.test' });
    await h.asUser(ADMIN);
    await throws(h.q(`select apply_venue_proposal($1)`, [proposal]), /no_target_column/,
      'this is the extension point: booking_url must become a supported field');
    await h.reset();
  });

  await test('E2. the audited path DOES produce a complete ledger row today', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { proposal } = await h.newProposal(v, 'website', { v: 'https://ok.test' });
    await h.asUser(ADMIN);
    await h.q(`select apply_venue_proposal($1)`, [proposal]);
    await h.reset();
    const rows = await h.ledgerFor(proposal);
    eq(rows.length, 1, 'the 057 path records exactly one apply row');
    const w = rows[0];
    for (const k of ['run_id', 'proposal_id', 'venue_id', 'field', 'old_value_hash',
                     'new_value_hash', 'applied_mode', 'source_url']) {
      assert(w[k] !== null && w[k] !== undefined, `ledger row must carry ${k}`);
    }
    eq(w.applied_mode, 'manual');
    eq(w.applied_by, ADMIN, 'a human apply must record the actor uuid');
  });

  await test('E3. an autonomous apply records applied_mode=auto with a NULL actor', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { proposal } = await h.newProposal(v, 'website', { v: 'https://auto.test' },
      { decision: 'auto_apply', decision_reasons: [{ code: 'high_confidence' }] });
    // Autonomous applies run as a trusted server path, not as an auth user.
    await h.reset();
    await h.q(`select _enrichment_apply_write($1, null, 'auto', null, $2::jsonb)`,
      [proposal, JSON.stringify([{ code: 'high_confidence' }])]);
    const w = (await h.ledgerFor(proposal))[0];
    eq(w.applied_mode, 'auto');
    eq(w.applied_by, null, 'a NULL actor is LEGITIMATE for automation -- decision_reasons carry the why');
    assert(JSON.stringify(w.decision_reasons).includes('high_confidence'),
      'machine justification must be recorded when there is no human actor');
  });

  await test('E4. rollback restores an audited autonomous write', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { run, proposal } = await h.newProposal(v, 'website', { v: 'https://auto.test' });
    await h.reset();
    await h.q(`select _enrichment_apply_write($1, null, 'auto', null, '[]'::jsonb)`, [proposal]);
    eq((await h.q(`select website from venues where id=$1`, [v])).rows[0].website, 'https://auto.test');
    await h.asUser(ADMIN);
    await h.q(`select rollback_enrichment_run($1)`, [run]);
    await h.reset();
    eq((await h.q(`select website from venues where id=$1`, [v])).rows[0].website, null,
      'the audited write is fully reversible');
  });

  await test('E5. rollback refuses to clobber a newer human edit', async () => {
    const v = await h.newVenue({ claimed_by: null, website: null });
    const { run, proposal } = await h.newProposal(v, 'website', { v: 'https://auto.test' });
    await h.reset();
    await h.q(`select _enrichment_apply_write($1, null, 'auto', null, '[]'::jsonb)`, [proposal]);
    await h.q(`update venues set website='https://human.test' where id=$1`, [v]);
    await h.asUser(ADMIN);
    const r = (await h.q(`select rollback_enrichment_run($1) as r`, [run])).rows[0].r;
    await h.reset();
    eq((await h.q(`select website from venues where id=$1`, [v])).rows[0].website, 'https://human.test');
    assert(JSON.stringify(r).includes('skipped_newer_change'), JSON.stringify(r));
  });

  await test('E6. BASELINE (pre-rebase): rollback has NO booking_url branch', async () => {
    await h.reset();
    const src = (await h.q(
      `select prosrc from pg_proc where proname='rollback_enrichment_run'`)).rows[0].prosrc;
    assert(!src.includes("w.field = 'booking_url'"),
      'documents the gap: adding booking_url to the ledger without a rollback branch ' +
      'would make those writes unrollbackable');
  });

  await test('E7. the description copyright guard must survive any refactor', async () => {
    const v = await h.newVenue({ claimed_by: null, description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'x' });
    await h.reset();
    await h.q(`update venue_field_proposals set evidence_snippet='Verbatim scraped text'
               where id=$1`, [proposal]);
    await throws(
      h.q(`select _enrichment_apply_write($1,'Verbatim scraped text','auto',null,'[]'::jsonb)`, [proposal]),
      /description_not_rewritten/,
      'verbatim copy of the evidence must stay refused');
  });

  await test('E8. the ledger is append-only for every API role, service_role included', async () => {
    await h.reset();
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const p of ['INSERT', 'UPDATE', 'DELETE']) {
        const x = (await h.q(`select has_table_privilege($1,'venue_enrichment_writes',$2) as x`,
          [role, p])).rows[0].x;
        eq(x, false, `${role} must not hold ${p} on the ledger`);
      }
    }
  });

  await db.close();
}

// =============================================================================
// PART F -- the REBASED behaviour, run against the real draft SQL
// =============================================================================
async function partF() {
  console.log('\nPART F -- rebased: description, booking_url, provenance, rollback\n');
  const { db, h } = await boot({ rebased: true });

  // ── generated description ──────────────────────────────────────────────
  await test('F1. auto_apply_generated_description produces a ledger row', async () => {
    const v = await h.newVenue({ claimed_by: null, description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'An original summary.' });
    await h.reset();
    await h.q(`select auto_apply_generated_description($1)`, [proposal]);
    const rows = await h.ledgerFor(proposal);
    eq(rows.length, 1, 'the description write must be audited');
    eq(rows[0].applied_mode, 'auto');
    eq(rows[0].applied_by, null);
    eq((await h.q(`select description from venues where id=$1`, [v])).rows[0].description,
      'An original summary.');
  });

  await test('F2. a generated description is rollbackable', async () => {
    const v = await h.newVenue({ claimed_by: null, description: null });
    const { run, proposal } = await h.newProposal(v, 'description', { v: 'Another summary.' });
    await h.reset();
    await h.q(`select auto_apply_generated_description($1)`, [proposal]);
    await h.asUser(ADMIN);
    await h.q(`select rollback_enrichment_run($1)`, [run]);
    await h.reset();
    eq((await h.q(`select description from venues where id=$1`, [v])).rows[0].description, null);
  });

  await test('F3. the copyright guard is retained through the rebase', async () => {
    const v = await h.newVenue({ claimed_by: null, description: null });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Verbatim scraped text' });
    await h.reset();
    await h.q(`update venue_field_proposals set evidence_snippet='Verbatim scraped text' where id=$1`, [proposal]);
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]),
      /description_not_rewritten/,
      'a generated description identical to the scraped evidence must still be refused');
  });

  await test('F4. a description that already exists is not overwritten', async () => {
    const v = await h.newVenue({ claimed_by: null, description: 'Human written copy' });
    const { proposal } = await h.newProposal(v, 'description', { v: 'Machine copy' });
    await h.reset();
    await throws(h.q(`select auto_apply_generated_description($1)`, [proposal]),
      /description_already_set/);
  });

  // ── autonomous booking_url ─────────────────────────────────────────────
  await test('F5. autonomous booking_url writes are audited and rollbackable', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    const { run, proposal } = await h.newProposal(v, 'booking_url', { v: 'https://book.venue.test/x' });
    await h.reset();
    await h.q(`select auto_apply_booking_url($1)`, [proposal]);
    const rows = await h.ledgerFor(proposal);
    eq(rows.length, 1, 'booking_url must now reach the ledger');
    eq(rows[0].applied_mode, 'auto');
    eq(rows[0].applied_by, null);
    assert(JSON.stringify(rows[0].decision_reasons).includes('auto_booking_url_same_host'));
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url,
      'https://book.venue.test/x');
    await h.asUser(ADMIN);
    await h.q(`select rollback_enrichment_run($1)`, [run]);
    await h.reset();
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, null,
      'the booking_url rollback branch must restore the previous value');
  });

  await test('F6. autonomous booking_url REQUIRES the same host as the venue website', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://third-party.test/book' });
    await h.reset();
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]),
      /host_identity_mismatch/,
      'automation may not publish a booking link on a host it cannot tie to the venue');
  });

  await test('F7. autonomous booking_url refuses when one is already set', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    await h.reset();
    await h.q(`update venues set booking_url='https://venue.test/existing' where id=$1`, [v]);
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue.test/new' });
    await h.reset();
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]),
      /booking_url_already_set/);
  });

  await test('F8. a non-HTTPS or unparseable booking_url is refused by the primitive', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    for (const bad of ['http://venue.test/book', 'javascript:alert(1)',
                       'https://venue.test@evil.test/book']) {
      const { proposal } = await h.newProposal(v, 'booking_url', { v: bad });
      await h.asUser(ADMIN);
      await throws(h.q(`select apply_booking_url_proposal($1)`, [proposal]),
        /insecure_or_invalid_scheme|unparseable_booking_url|host_identity/i,
        `${bad} must be refused even on the human path`);
      await h.reset();
    }
  });

  // ── human admin booking approval ───────────────────────────────────────
  await test('F9. a human admin MAY approve a verified third-party booking host', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://bookwhen.test/venue' });
    await h.asUser(ADMIN);
    await h.q(`select apply_booking_url_proposal($1, null, $2)`,
      [proposal, 'verified with the venue by phone']);
    await h.reset();
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url,
      'https://bookwhen.test/venue',
      'the human path must NOT impose the autonomous same-host rule');
  });

  await test('F10. a human approval records manual provenance and the actor uuid', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://eventbrite.test/e' });
    await h.asUser(ADMIN);
    await h.q(`select apply_booking_url_proposal($1)`, [proposal]);
    await h.reset();
    const w = (await h.ledgerFor(proposal))[0];
    eq(w.applied_mode, 'manual');
    eq(w.applied_by, ADMIN, 'a named human must be recorded as the actor');
    assert(JSON.stringify(w.decision_reasons).includes('admin_approved_booking_url'));
    const pr = (await h.q(`select applied_mode, status from venue_field_proposals where id=$1`,
      [proposal])).rows[0];
    eq(pr.applied_mode, 'manual');
    eq(pr.status, 'applied');
  });

  await test('F11. a non-admin cannot use the human booking path', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue.test/b' });
    await h.asUser(OTHER);
    await throws(h.q(`select apply_booking_url_proposal($1)`, [proposal]), /not_admin/);
    await h.reset();
  });

  await test('F12. a stale booking rollback skips a newer human edit', async () => {
    const v = await h.newVenue({ claimed_by: null, website: 'https://venue.test' });
    const { run, proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue.test/auto' });
    await h.reset();
    await h.q(`select auto_apply_booking_url($1)`, [proposal]);
    await h.q(`update venues set booking_url='https://venue.test/human' where id=$1`, [v]);
    await h.asUser(ADMIN);
    const r = (await h.q(`select rollback_enrichment_run($1) as r`, [run])).rows[0].r;
    await h.reset();
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url,
      'https://venue.test/human', 'the human edit must survive');
    assert(JSON.stringify(r).includes('skipped_newer_change'), JSON.stringify(r));
  });

  // ── ACLs for every function this pass changed ──────────────────────────
  await test('F13. every function changed in this pass has an explicit ACL', async () => {
    await h.reset();
    const expected = {
      'public.enrichment_url_host(text)':            { PUBLIC: false, anon: false, authenticated: false, service_role: true },
      'public.enrichment_is_valid_website(text)':    { PUBLIC: false, anon: false, authenticated: false, service_role: true },
      'public.enrichment_is_valid_phone(text)':      { PUBLIC: false, anon: false, authenticated: false, service_role: true },
      'public.enrichment_value_is_meaningful(jsonb)':{ PUBLIC: false, anon: false, authenticated: false, service_role: true },
      'public._enrichment_apply_write(uuid,text,text,uuid,jsonb)':
                                                    { PUBLIC: false, anon: false, authenticated: false, service_role: false },
      'public.auto_apply_field_proposal(uuid,smallint,smallint)':
                                                    { PUBLIC: false, anon: false, authenticated: false, service_role: true },
      'public.auto_apply_generated_description(uuid)':
                                                    { PUBLIC: false, anon: false, authenticated: false, service_role: true },
      'public.auto_apply_booking_url(uuid)':         { PUBLIC: false, anon: false, authenticated: false, service_role: true },
      // service_role REVOKED this pass: is_admin()-gated, and a repo-wide grep
      // finds no runtime call site (only operator-facing strings that describe
      // the RPC to a human).
      'public.apply_booking_url_proposal(uuid,text,text)':
                                                    { PUBLIC: false, anon: false, authenticated: true, service_role: false },
      'public.rollback_enrichment_run(uuid)':        { PUBLIC: false, anon: false, authenticated: true, service_role: false },
    };
    for (const [fn, want] of Object.entries(expected)) {
      const got = await h.fnAcl(fn);
      assert(got.exists, `${fn} must exist`);
      for (const k of Object.keys(want)) {
        eq(got[k], want[k], `${fn} ${k}`);
      }
    }
  });

  await test('F14. every function changed in this pass pins search_path', async () => {
    await h.reset();
    const names = [
      'enrichment_url_host', 'enrichment_is_valid_website', 'enrichment_is_valid_phone',
      'enrichment_value_is_meaningful', '_enrichment_apply_write',
      'auto_apply_field_proposal', 'auto_apply_generated_description',
      'auto_apply_booking_url', 'apply_booking_url_proposal', 'rollback_enrichment_run'];
    for (const n of names) {
      const r = await h.q(
        `select array_to_string(proconfig, ',') as cfg from pg_proc where proname = $1`, [n]);
      assert(r.rows.length > 0, `${n} must exist`);
      assert(/search_path=/.test(r.rows[0].cfg ?? ''), `${n} must pin search_path, got ${r.rows[0].cfg}`);
    }
  });

  await test('F15. the obsolete opening-hours internal helper is gone', async () => {
    await h.reset();
    const r = await h.q(
      `select count(*)::int c from pg_proc where proname = 'apply_venue_proposal_opening_hours_internal'`);
    eq(r.rows[0].c, 0, 'a second, unlogged opening-hours write path must not exist');
  });

  // A POLICY guard, not a validity guard -- and that distinction is exactly how
  // it got lost. The pre-rebase 059 refused to auto-apply an opening_hours
  // proposal carrying seasonal_notes. When the rebase deleted
  // apply_venue_proposal_opening_hours_internal and routed the write through the
  // shared primitive, the well-formedness checks travelled across (they are
  // universal) and this one silently did not, because it is not about whether
  // the value is valid -- it is about whether AUTOMATION may decide.
  //
  // The failure mode is a parent arriving at a closed venue: "term-time only"
  // hours published by replace-whole-week read as the year-round truth.
  await test('F17. automation must refuse opening_hours carrying seasonal_notes', async () => {
    const v = await h.newVenue({ claimed_by: null });
    const week = {
      seasonal_notes: 'term-time only',
      source_text: 'x',
      days: Array.from({ length: 7 }, (_, d) => ({
        day_of_week: d, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] })),
    };
    const { proposal } = await h.newProposal(v, 'opening_hours', week);
    await h.asService();
    await throws(h.q(`select auto_apply_field_proposal($1, 99::smallint, 90::smallint)`, [proposal]),
      /seasonal_notes_require_human_review/,
      'conditional hours must never be published unattended');
    await h.reset();
    const rows = await h.q(`select count(*)::int c from opening_hours where venue_id=$1`, [v]);
    eq(rows.rows[0].c, 0, 'and nothing partial may be written on the way to refusing');
  });

  await test('F18. a HUMAN admin may still apply seasonal opening hours', async () => {
    // The other half. If this were blocked too, the guard would have leaked out
    // of the autonomy wrapper and into the shared primitive, taking a
    // legitimate human capability with it.
    const v = await h.newVenue({ claimed_by: null });
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
      `select day_of_week, notes from opening_hours where venue_id=$1 order by day_of_week`, [v]);
    eq(rows.rows.length, 7, 'the human path writes the whole week');
    eq(rows.rows[1].notes, 'term-time only', 'and keeps the seasonal note the human read');
  });

  await test('F16. opening_hours still applies through the audited primitive', async () => {
    const v = await h.newVenue({ claimed_by: null });
    const days = Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] }));
    const { run, proposal } = await h.newProposal(v, 'opening_hours', { days });
    await h.reset();
    await h.q(`select auto_apply_field_proposal($1, 95::smallint, 90::smallint)`, [proposal]);
    eq((await h.q(`select count(*)::int c from opening_hours where venue_id=$1`, [v])).rows[0].c, 7);
    const rows = await h.ledgerFor(proposal);
    eq(rows.length, 1, 'opening_hours writes must be audited too');
    await h.asUser(ADMIN);
    await h.q(`select rollback_enrichment_run($1)`, [run]);
    await h.reset();
    eq((await h.q(`select count(*)::int c from opening_hours where venue_id=$1`, [v])).rows[0].c, 0);
  });

  await db.close();
}

// =============================================================================
// PART G -- RELEASE-ONE CANDIDATE SAFETY
//
// The locked product decision: a newly discovered venue must never become
// publicly discoverable without a named human admin deciding so. Everything
// here is an executable statement of that decision, plus the provenance
// contract publication now has to satisfy.
// =============================================================================
async function partG() {
  console.log('\nPART G -- release-one candidate safety: provenance, publication, privileges\n');
  const { db, h } = await boot({ rebased: true, draftShapes: true });

  // ── G1..G6: the provenance contract ────────────────────────────────────────
  await test('G1. venues.data_source admits geoapify and still refuses anything else', async () => {
    await h.reset();
    await h.q(`insert into venues (name, city, latitude, longitude, data_source)
               values ('G1 ok','Bath',51.38,-2.36,'geoapify')`);
    await throws(
      h.q(`insert into venues (name, city, latitude, longitude, data_source)
           values ('G1 bad','Bath',51.38,-2.36,'tripadvisor')`),
      /venues_data_source_check|violates check/i,
      'widening the CHECK must not turn it into a free-text column');
  });

  await test('G1b. exactly ONE data_source CHECK survives the widening', async () => {
    await h.reset();
    // If 012's original constraint were left in place alongside the new one,
    // 'geoapify' would still be rejected -- and the failure would only show up
    // on the first Geoapify approval in production.
    const r = await h.q(
      `select count(*)::int c from pg_constraint
        where conrelid = 'public.venues'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%data_source%'`);
    eq(r.rows[0].c, 1, 'a leftover narrow CHECK would silently re-break geoapify');
  });

  await test('G2. OSM provenance maps to ODbL, the canonical osm_id and OSM attribution', async () => {
    await h.reset();
    const p = (await h.q(`select discovery_candidate_provenance('osm','node/123') as p`)).rows[0].p;
    eq(p.data_source, 'osm');
    eq(p.license, 'ODbL-1.0');
    eq(p.osm_id, 'node/123', 'the importer contract is "type/id" -- followed, not reinvented');
    eq(p.data_source_ref, 'node/123');
    eq(JSON.stringify(p.attribution_required), JSON.stringify(['openstreetmap']));
  });

  await test('G3. Geoapify provenance keeps the provider AND the underlying OSM obligation', async () => {
    await h.reset();
    const p = (await h.q(
      `select discovery_candidate_provenance('geoapify','51a2f0c',$1::jsonb) as p`,
      [JSON.stringify(GEOAPIFY_OSM_DATASOURCE)])).rows[0].p;
    eq(p.data_source, 'geoapify', 'the provider is named honestly');
    eq(p.license, 'ODbL-1.0', 'Geoapify is substantially OSM-derived, so ODbL travels with it');
    eq(p.osm_id, null, 'a Geoapify place_id is NOT an OSM identity and must never occupy osm_id');
    eq(p.data_source_ref, '51a2f0c', 'the provider record id is still preserved');
    eq(JSON.stringify(p.attribution_required), JSON.stringify(['openstreetmap', 'geoapify']),
      'both parties must be recorded so the UI can render whichever the current terms require');
    // The provider's OWN words are carried through, not replaced by ours.
    eq(p.data_source_meta.sourcename, 'openstreetmap');
    eq(p.data_source_meta.license, 'Open Database License',
      'the provider statement is preserved verbatim, alongside our canonical mapping');
  });

  await test('G4. a non-canonical OSM identity FAILS CLOSED rather than being guessed', async () => {
    await h.reset();
    for (const bad of ['123', 'node-123', 'relation/', 'building/7', 'node/12x']) {
      await throws(h.q(`select discovery_candidate_provenance('osm',$1)`, [bad]),
        /unmappable_provenance:osm_id_not_canonical/,
        `"${bad}" is not an OSM identity we can state`);
    }
  });

  await test('G5. an unknown provider FAILS CLOSED -- there is no default branch', async () => {
    await h.reset();
    await throws(h.q(`select discovery_candidate_provenance('foursquare','x')`),
      /unmappable_provenance:unknown_source/,
      'a new provider must be added deliberately, with its licence decided');
  });

  await test('G6. a missing source id FAILS CLOSED', async () => {
    await h.reset();
    await throws(h.q(`select discovery_candidate_provenance('osm', null)`),
      /unmappable_provenance:missing_source_id/);
    await throws(h.q(`select discovery_candidate_provenance('geoapify','   ')`),
      /unmappable_provenance:missing_source_id/);
  });

  await test('G6b. a Geoapify record with NO provider datasource statement FAILS CLOSED', async () => {
    await h.reset();
    // The old contract assumed "geoapify implies ODbL". Geoapify is a company,
    // not a licence; a future product or tier of theirs may differ, and the
    // database must not assert a licence nobody checked.
    await throws(h.q(`select discovery_candidate_provenance('geoapify','g1')`),
      /unmappable_provenance:missing_datasource_metadata/);
    await throws(h.q(`select discovery_candidate_provenance('geoapify','g1','null'::jsonb)`),
      /unmappable_provenance:missing_datasource_metadata/);
  });

  await test('G6c. an unrecognised upstream dataset or licence FAILS CLOSED', async () => {
    await h.reset();
    const ds = (o) => JSON.stringify({ ...GEOAPIFY_OSM_DATASOURCE, ...o });
    await throws(
      h.q(`select discovery_candidate_provenance('geoapify','g1',$1::jsonb)`, [ds({ sourcename: 'some_new_partner_feed' })]),
      /unmappable_provenance:unknown_datasource:some_new_partner_feed/,
      'a new upstream dataset must be added deliberately, with its licence decided');
    await throws(
      h.q(`select discovery_candidate_provenance('geoapify','g1',$1::jsonb)`, [ds({ license: 'All Rights Reserved' })]),
      /unmappable_provenance:unknown_license/,
      'a licence we do not recognise is never silently normalised to ODbL');
    await throws(
      h.q(`select discovery_candidate_provenance('geoapify','g1',$1::jsonb)`, [ds({ sourcename: '' })]),
      /unmappable_provenance:missing_datasource_sourcename/);
  });

  await test('G6d. the licence spellings the provider actually returns are recognised', async () => {
    await h.reset();
    for (const lic of ['Open Database License', 'ODbL', 'odbl-1.0', 'Open Database License (ODbL)']) {
      const p = (await h.q(
        `select discovery_candidate_provenance('geoapify','g1',$1::jsonb) as p`,
        [JSON.stringify({ ...GEOAPIFY_OSM_DATASOURCE, license: lic })])).rows[0].p;
      eq(p.license, 'ODbL-1.0', `"${lic}" must map to the canonical licence id`);
    }
  });

  // ── G7..G11: no unattended publication ─────────────────────────────────────
  await test('G7. auto_accept_candidate does not exist in EITHER signature', async () => {
    await h.reset();
    const r = await h.q(
      `select count(*)::int c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'auto_accept_candidate'`);
    eq(r.rows[0].c, 0,
      'the publishing function must be absent, not merely revoked or renamed');
  });

  // THE structural proof. Not "this particular function refuses" but "no such
  // function is reachable at all".
  await test('G8. NO service_role-executable function can insert into venues', async () => {
    await h.reset();
    const r = await h.q(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
          and has_function_privilege('service_role', p.oid, 'EXECUTE')
          and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public\\.)?venues'`);
    eq(r.rows.length, 0,
      `service_role can reach a venue-creating function: ${JSON.stringify(r.rows)}`);
  });

  await test('G9. service_role cannot execute the human publication path', async () => {
    await h.reset();
    const acl = await h.fnAcl('public.resolve_discovery_candidate(uuid,text,text)');
    assert(acl.exists, 'the admin path must exist');
    eq(acl.service_role, false, 'the service key must not even be able to attempt it');
    eq(acl.anon, false);
    eq(acl.PUBLIC, false);
    eq(acl.authenticated, true, 'a human admin reaches it as an authenticated caller');
  });

  await test('G10. the unattended path still enforces every accept gate', async () => {
    const cases = [
      [{ confidence_score: 97, independent_identity_evidence_count: 5 }, /below_min_score/],
      [{ independent_identity_evidence_count: 1 }, /insufficient_independent_identity_evidence/],
      [{ dedupe_decision: 'possible_duplicate', independent_identity_evidence_count: 5 }, /not_distinct/],
      [{ has_closure_signal: true, independent_identity_evidence_count: 5 }, /has_closure_signal/],
      [{ is_trusted_source: false, independent_identity_evidence_count: 5 }, /accept_gate_not_satisfied/],
      [{ required_fields_complete: false, independent_identity_evidence_count: 5 }, /accept_gate_not_satisfied/],
      [{ postcode: null, independent_identity_evidence_count: 5 }, /missing_required_venue_fields/],
      [{ status: 'quarantined', independent_identity_evidence_count: 5 }, /not_pending_candidate/],
    ];
    for (const [opts, re] of cases) {
      const c = await h.newCandidate(opts);
      await h.asService();
      await throws(h.q(`select queue_candidate_for_review($1)`, [c]), re,
        `gate not enforced for ${JSON.stringify(opts)}`);
      await h.reset();
    }
  });

  await test('G11. a service_role UPDATE cannot forge an approved candidate', async () => {
    // service_role bypasses RLS, so the policy is no defence here. The table's
    // own CHECK constraints are, and they are what this proves.
    const c = await h.newCandidate();
    await h.asService();
    await throws(
      h.q(`update venue_discovery_candidates set status='approved' where id=$1`, [c]),
      /approved_audit_ck|violates check/i,
      'an approved row with no human actor must be structurally impossible');
    await throws(
      h.q(`update venue_discovery_candidates set status='approved', resolved_mode='manual',
             reviewed_at=now(), reviewed_by=$2 where id=$1`, [c, ADMIN]),
      /venue_only_when_approved_ck|approved_audit_ck|violates check/i,
      'an approved row must also name the venue it produced');
    await h.reset();
  });

  // ── G12..G14: only a named human admin publishes ───────────────────────────
  await test('G12. an ordinary authenticated user cannot resolve a candidate', async () => {
    const c = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(OTHER);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]),
      /not_admin/, 'is_admin() is the gate, and it is checked inside the function');
    await h.reset();
    eq((await h.candidate(c)).status, 'quarantined', 'the refused call must change nothing');
  });

  await test('G13. an anon caller cannot reach the publication path at all', async () => {
    const c = await h.newCandidate({ status: 'quarantined' });
    await h.asAnon();
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]),
      /permission denied|42501/i, 'refused by the ACL, before any body runs');
    await h.reset();
  });

  await test('G14. an already-terminal candidate cannot be re-resolved', async () => {
    const c = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(ADMIN);
    await h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]),
      /not_resolvable:approved/, 'there must be no double-publication path');
    await h.reset();
  });

  await test('G14b. an invalid decision word is refused', async () => {
    const c = await h.newCandidate({ status: 'quarantined' });
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_discovery_candidate($1,'publish',null)`, [c]),
      /invalid_decision:publish/);
    await h.reset();
  });

  // ── G15..G18: provenance survives, or nothing is published ─────────────────
  await test('G15. approval fails closed when OSM identity cannot be stated', async () => {
    const c = await h.newCandidate({ source: 'osm', source_id: 'not-an-osm-id', name: 'Bad Ident' });
    await h.asUser(ADMIN);
    const r = (await h.q(`select resolve_discovery_candidate($1,'approve',null) as r`, [c])).rows[0].r;
    await h.reset();
    eq(r.ok, false);
    eq(r.published, false);
    eq(r.outcome, 'quarantined_unmappable_provenance');
    eq(await h.venueByName('Bad Ident'), null, 'nothing may be published on a guess');
    const row = await h.candidate(c);
    eq(row.status, 'quarantined', 'the candidate is held, not lost');
    eq(row.venue_id, null);
    assert(JSON.stringify(row.resolution_reasons).includes('unmappable_provenance'),
      'the reviewer must be told WHY, in a machine-readable form');
  });

  await test('G15b. approval fails closed on a Geoapify candidate with no datasource', async () => {
    const c = await h.newCandidate({ source: 'geoapify', source_id: 'gp-nolicence',
                                     source_datasource: null, name: 'No Licence' });
    await h.asUser(ADMIN);
    const r = (await h.q(`select resolve_discovery_candidate($1,'approve',null) as r`, [c])).rows[0].r;
    await h.reset();
    eq(r.ok, false);
    eq(r.outcome, 'quarantined_unmappable_provenance');
    eq(await h.venueByName('No Licence'), null, 'no venue may be published under an assumed licence');
    assert(JSON.stringify((await h.candidate(c)).resolution_reasons).includes('missing_datasource_metadata'),
      'the reviewer must be told exactly what was missing');
  });

  await test('G16. approval fails closed on an OSM identity we already hold', async () => {
    await h.reset();
    await h.q(`insert into venues (name, city, latitude, longitude, data_source, osm_id)
               values ('Existing','Bath',51.38,-2.36,'osm','node/777')`);
    const c = await h.newCandidate({ source: 'osm', source_id: 'node/777', name: 'Dup Ident' });
    await h.asUser(ADMIN);
    const r = (await h.q(`select resolve_discovery_candidate($1,'approve',null) as r`, [c])).rows[0].r;
    await h.reset();
    eq(r.ok, false);
    eq(r.outcome, 'quarantined_duplicate_source_identity');
    eq(await h.venueByName('Dup Ident'), null);
    eq((await h.candidate(c)).status, 'quarantined');
  });

  await test('G17. a duplicate-flagged candidate is never publishable', async () => {
    const c = await h.newCandidate({ dedupe_decision: 'duplicate', name: 'Dupe' });
    await h.asUser(ADMIN);
    await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]), /is_duplicate/);
    await h.reset();
    eq(await h.venueByName('Dupe'), null);
  });

  await test('G18. an incomplete candidate is never publishable, even by an admin', async () => {
    for (const [opts, re] of [
      [{ postcode: null }, /missing_required_venue_fields/],
      [{ city: null }, /missing_required_venue_fields/],
      [{ has_family_relevant_category: false }, /accept_gate_not_satisfied/],
      [{ has_valid_uk_coordinates: false }, /accept_gate_not_satisfied/],
    ]) {
      const c = await h.newCandidate({ ...opts, status: 'quarantined' });
      await h.asUser(ADMIN);
      await throws(h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]), re);
      await h.reset();
    }
  });

  // ── G19..G21: the audit contract ───────────────────────────────────────────
  await test('G19. an approved candidate carries the full release-one audit trail', async () => {
    const c = await h.newCandidate({ source: 'osm', source_id: 'relation/909', name: 'Audited' });
    await h.asUser(ADMIN);
    await h.q(`select resolve_discovery_candidate($1,'approve','verified by phone') as r`, [c]);
    await h.reset();
    const row = await h.candidate(c);
    eq(row.status, 'approved');
    eq(row.resolved_mode, 'manual', 'release one has exactly one publication mode');
    eq(row.reviewed_by, ADMIN, 'resolved_by IS reviewed_by -- and it must be the acting human');
    assert(row.reviewed_at, 'reviewed_at must be stamped');
    assert(row.venue_id, 'venue_id must name the venue this decision created');
    eq(row.review_notes, 'verified by phone');
    const reasons = JSON.stringify(row.resolution_reasons);
    assert(reasons.includes('human_approved_publication'), 'the decision must be recorded');
    assert(reasons.includes(ADMIN), 'the actor must be recorded in the reasons too');
    assert(reasons.includes('ODbL-1.0'), 'the provenance actually applied must be recorded');
    const v = (await h.q(`select * from venues where id=$1`, [row.venue_id])).rows[0];
    eq(v.name, 'Audited');
  });

  await test('G20. reject and dismiss keep reviewer, decision, notes and time', async () => {
    for (const [decision, status] of [['reject', 'rejected'], ['dismiss', 'dismissed']]) {
      const c = await h.newCandidate({ status: 'quarantined', name: `R-${decision}` });
      await h.asUser(ADMIN);
      const r = (await h.q(`select resolve_discovery_candidate($1,$2,'not for us') as r`,
        [c, decision])).rows[0].r;
      await h.reset();
      eq(r.published, false);
      const row = await h.candidate(c);
      eq(row.status, status, 'dismiss must not be recorded as duplicate, and vice versa');
      eq(row.reviewed_by, ADMIN);
      eq(row.resolved_mode, 'manual');
      eq(row.review_notes, 'not for us');
      assert(row.reviewed_at, 'a terminal state must be timestamped');
      assert(JSON.stringify(row.resolution_reasons).includes(`human_${decision}`));
      eq(await h.venueByName(`R-${decision}`), null, 'no venue may be created');
    }
  });

  await test('G21. a terminal state with no decider is structurally impossible', async () => {
    const c = await h.newCandidate();
    await h.asService();
    for (const st of ['rejected', 'dismissed', 'duplicate']) {
      await throws(
        h.q(`update venue_discovery_candidates set status=$2 where id=$1`, [c, st]),
        /terminal_audit_ck|violates check/i,
        `${st} must record who decided and when`);
    }
    // The pipeline legitimately has no profile id -- 'system' is how it says so.
    await h.q(`update venue_discovery_candidates
                 set status='rejected', resolved_mode='system', reviewed_at=now()
               where id=$1`, [c]);
    await h.reset();
    eq((await h.candidate(c)).resolved_mode, 'system');
  });

  // ── G22..G24: privileges ───────────────────────────────────────────────────
  await test('G22. new-table privilege matrix (has_table_privilege)', async () => {
    await h.reset();
    const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const expected = {
      venue_discovery_candidates: {
        anon: {}, authenticated: {},
        service_role: { SELECT: true, INSERT: true, UPDATE: true },
      },
      venue_closure_signals: {
        anon: {}, authenticated: {},
        service_role: { SELECT: true, INSERT: true },
      },
    };
    const bad = [];
    for (const [table, roles] of Object.entries(expected)) {
      for (const [role, want] of Object.entries(roles)) {
        for (const p of PRIVS) {
          const got = (await h.q(`select has_table_privilege($1,$2,$3) as x`, [role, table, p])).rows[0].x;
          if (got !== (want[p] ?? false)) bad.push(`${role} ${p} ${table}: got ${got}`);
        }
      }
      // PUBLIC must hold nothing at all.
      const pub = (await h.q(
        `select exists (select 1 from pg_class c,
           lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
          where c.oid = $1::regclass and g.grantee = 0) as x`, [table])).rows[0].x;
      if (pub) bad.push(`PUBLIC holds a privilege on ${table}`);
    }
    eq(bad.length, 0, bad.join('; '));
  });

  await test('G23. MAINTAIN is denied to anon/authenticated where the server has it', async () => {
    await h.reset();
    const has = (await h.q(`select current_setting('server_version_num')::int >= 170000 as x`)).rows[0].x;
    if (!has) return; // PG16 and below have no MAINTAIN privilege to deny.
    for (const t of ['venue_discovery_candidates', 'venue_closure_signals']) {
      for (const role of ['anon', 'authenticated']) {
        const held = (await h.q(`select has_table_privilege($1,$2,'MAINTAIN') as x`, [role, t])).rows[0].x;
        eq(held, false, `${role} must not hold MAINTAIN on ${t}`);
      }
    }
  });

  await test('G24. candidate/closure function ACL matrix', async () => {
    await h.reset();
    const bad = [];
    for (const [fn, want] of CANDIDATE_FUNCTIONS) {
      const got = await h.fnAcl(fn);
      if (!got.exists) { bad.push(`${fn} MISSING`); continue; }
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        if (got[role] !== want[role]) bad.push(`${fn} ${role}: got ${got[role]}, want ${want[role]}`);
      }
    }
    eq(bad.length, 0, bad.join('; '));
  });

  await test('G25. every candidate/closure function is SECURITY DEFINER with a pinned search_path', async () => {
    await h.reset();
    // discovery_candidate_provenance is the deliberate exception: it is a pure
    // mapping that reads no table, so it is IMMUTABLE and does not need
    // definer rights -- but it still pins search_path.
    // Two deliberate exceptions, both for the same reason -- neither needs the
    // owner's rights, and giving definer rights to something that does not need
    // them is how a privilege escalation starts:
    //   discovery_candidate_provenance   a pure IMMUTABLE mapping; reads nothing.
    //   ..._events_append_only           a trigger helper that only ever RAISEs;
    //                                    SECURITY INVOKER so it refuses the
    //                                    caller's own write, matching the
    //                                    touch_updated_at convention.
    const DEFINER_EXEMPT = new Set([
      'discovery_candidate_provenance',
      'venue_operating_status_events_append_only',
    ]);
    const bad = [];
    for (const [fn] of CANDIDATE_FUNCTIONS) {
      const name = fn.slice(fn.indexOf('.') + 1, fn.indexOf('('));
      const r = await h.q(
        `select p.prosecdef, array_to_string(p.proconfig, ',') as cfg
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname = $1`, [name]);
      if (!r.rows.length) { bad.push(`${name} missing`); continue; }
      if (!/search_path=/.test(r.rows[0].cfg ?? '')) bad.push(`${name} does not pin search_path`);
      if (!r.rows[0].prosecdef && !DEFINER_EXEMPT.has(name)) bad.push(`${name} is not SECURITY DEFINER`);
    }
    eq(bad.length, 0, bad.join('; '));
  });

  // ── G26..G29: PP-011 / 063 must not have been widened to make this work ────
  await test('G26. PP-011 still blocks a claimed owner from the NEW provenance columns', async () => {
    const v = await h.newVenue({ claimed_by: OWNER });
    await h.asUser(OWNER);
    for (const [col, val] of [['data_source_ref', `'node/1'`],
                              ['attribution_required', `array['openstreetmap']::text[]`],
                              ['license', `'ODbL-1.0'`],
                              ['osm_id', `'node/1'`]]) {
      await throws(h.q(`update venues set ${col} = ${val} where id=$1`, [v]), /42501|may not change/i,
        `a venue owner must not be able to forge ${col}`);
    }
    await h.reset();
  });

  await test('G27. the ordinary 15-column INSERT grant was NOT widened', async () => {
    await h.reset();
    const r = await h.q(
      `select a.attname from pg_attribute a
        where a.attrelid = 'public.venues'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')
        order by a.attname`);
    const got = r.rows.map((x) => x.attname).sort();
    eq(JSON.stringify(got), JSON.stringify([...VENUE_INSERT_COLUMNS_063].sort()),
      'the trusted publication path must not have bought itself a wider user grant');
    for (const c of ['data_source', 'license', 'osm_id', 'data_source_ref',
                     'attribution_required', 'discovery_approved', 'is_verified']) {
      assert(!got.includes(c), `${c} must never be user-insertable`);
    }
  });

  await test('G28. an ordinary user still cannot self-publish a venue', async () => {
    await h.reset();
    await h.asUser(OTHER);
    await throws(
      h.q(`insert into venues (name, city, latitude, longitude, submitted_by,
                               moderation_status, is_published)
           values ('Self Published','Bath',51.38,-2.36,$1,'approved',true)`, [OTHER]),
      /42501|must be pending|must be false/i,
      '063 invariants must be unaffected by the discovery work');
    await h.reset();
  });

  await test('G29. the trusted path publishes through SECURITY DEFINER, not a widened grant', async () => {
    // The proof that G27/G28 and D5/D6 are consistent: the admin publishing a
    // venue with provenance columns is not exercising a user privilege, it is
    // running inside a definer function owned by the bootstrap role.
    await h.reset();
    const r = await h.q(
      `select prosecdef from pg_proc where proname='resolve_discovery_candidate'`);
    eq(r.rows[0].prosecdef, true);
    const c = await h.newCandidate({ source: 'geoapify', source_id: 'gp-1', name: 'Definer Proof' });
    await h.asUser(ADMIN);
    await h.q(`select resolve_discovery_candidate($1,'approve',null)`, [c]);
    // ...and the SAME admin, acting directly, may not write those columns on a
    // brand-new row, because the INSERT grant does not include them.
    await throws(
      h.q(`insert into venues (name, city, latitude, longitude, data_source)
           values ('Direct','Bath',51.38,-2.36,'geoapify')`),
      /42501|permission denied/i,
      'even an admin has no direct INSERT privilege on the provenance columns');
    await h.reset();
    const v = await h.venueByName('Definer Proof');
    eq(v.data_source, 'geoapify');
    eq(JSON.stringify(v.attribution_required), JSON.stringify(['openstreetmap', 'geoapify']));
    eq(v.data_source_meta.sourcename, 'openstreetmap',
      "the provider's own statement must survive onto the published venue");
  });

  // ── G30: the files themselves, applied whole ───────────────────────────────
  await test('G30. drafts 059 and 061 apply CLEANLY, in full, onto production truth', async () => {
    // Everything above tests marked SECTIONS of the drafts. This tests the
    // files, start to finish, exactly as promotion would run them -- so a
    // syntax error, a bad constraint, or a statement outside every marker
    // cannot hide between the sections this suite happens to extract.
    const fresh = new PGlite();
    try {
      await fresh.exec(BOOTSTRAP);
      await fresh.exec(SQL_059);
      await fresh.exec(SQL_061);
      // And the release-one invariant still holds on that whole-file database,
      // not just on the assembled one.
      const r = await fresh.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.prokind='f'
            and has_function_privilege('service_role', p.oid,'EXECUTE')
            and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public\\.)?venues'`);
      eq(r.rows.length, 0,
        `whole-file apply leaves a service_role venue-creating function: ${JSON.stringify(r.rows)}`);
      const g = await fresh.query(
        `select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='auto_accept_candidate'`);
      eq(g.rows[0].c, 0, 'auto_accept_candidate must not survive a whole-file apply');
    } finally {
      await fresh.close();
    }
  });

  await db.close();
}

// =============================================================================
// PART H -- CLOSURE STATE MACHINE + REDISCOVERY SAFETY
//
// Closure is the other place automation touches live, publicly visible venue
// state. The proposal ledger cannot audit it (a status change is not a field
// proposal), so it has its own append-only log, and this part is the executable
// statement of what automation may and may not do to it.
// =============================================================================
async function partH() {
  console.log('\nPART H -- closure transitions, the event log, and rediscovery safety\n');
  const { db, h } = await boot({ rebased: true, draftShapes: true });

  const eventsFor = async (venueId) =>
    (await h.q(`select * from venue_operating_status_events
                 where venue_id = $1 order by created_at, id`, [venueId])).rows;
  const statusOf = async (venueId) =>
    (await h.q(`select operating_status, discovery_approved from venues where id=$1`, [venueId])).rows[0];

  await test('H0. the DRAFT_COLUMNS fixture agrees with the migration it stands in for', async () => {
    await h.reset();
    // Both use ADD COLUMN IF NOT EXISTS, so a disagreement does not error --
    // whichever ran first just wins. This asserts the world the tests below
    // think they are in is the world 059 actually creates.
    const col = (await h.q(
      `select column_default, is_nullable from information_schema.columns
        where table_schema='public' and table_name='venues' and column_name='operating_status'`)).rows[0];
    assert(col, 'operating_status must exist');
    assert(/'active'/.test(col.column_default ?? ''),
      `059 declares DEFAULT 'active', fixture gave ${col.column_default}`);
    eq(col.is_nullable, 'NO');
    const chk = (await h.q(
      `select count(*)::int c from pg_constraint
        where conrelid='public.venues'::regclass and contype='c'
          and pg_get_constraintdef(oid) ilike '%operating_status%'`)).rows[0].c;
    assert(chk >= 1, 'the operating_status CHECK from 059 must actually be present');
    const v = await h.newVenue({ claimed_by: null });
    await h.reset();
    await throws(h.q(`update venues set operating_status='deleted' where id=$1`, [v]),
      /violates check|operating_status/i, 'the status vocabulary must be closed');
  });

  // ── H1..H5: who may do what ────────────────────────────────────────────────
  await test('H1. service_role CAN flag a suspected closure, and it is audited', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    const r = (await h.q(
      `select system_flag_suspected_closure($1,'site says permanently closed') as r`, [v])).rows[0].r;
    await h.reset();
    eq(r.changed, true);
    eq(r.from_status, 'active');
    eq(r.to_status, 'suspected_closed');
    eq(r.mode, 'auto');
    eq(r.actor_id, null, 'automation has no auth user -- a NULL actor is the contract');
    eq((await statusOf(v)).operating_status, 'suspected_closed');
  });

  await test('H2. service_role CANNOT confirm a closure or reactivate', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v]);
    // Refused by the ACL, before any body runs -- the strongest form of no.
    await throws(h.q(`select confirm_venue_closure($1,'x')`, [v]), /permission denied|42501/i,
      'the destructive step must be unreachable with the service key');
    await throws(h.q(`select reactivate_venue($1)`, [v]), /permission denied|42501/i);
    await h.reset();
    eq((await statusOf(v)).operating_status, 'suspected_closed', 'nothing may have moved');
  });

  await test('H3. automation cannot reach confirmed_closed by ANY route', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v]);
    // The target status is not a parameter of the automated function, and the
    // shared primitive is not executable by service_role either.
    await throws(
      h.q(`select _venue_record_status_transition($1,'confirmed_closed','auto',null,'x')`, [v]),
      /permission denied|42501/i,
      'the transition primitive is internal -- policy lives in the wrappers');
    await h.reset();
    // And even called internally, the matrix refuses it.
    await throws(
      h.q(`select _venue_record_status_transition($1,'confirmed_closed','auto',null,'x')`, [v]),
      /transition_not_permitted_for_automation/,
      'auto may only ever perform active -> suspected_closed');
    eq((await statusOf(v)).operating_status, 'suspected_closed');
  });

  await test('H4. a NON-admin authenticated user cannot confirm or reactivate', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v]);
    await h.asUser(OTHER);
    await throws(h.q(`select confirm_venue_closure($1,'x')`, [v]), /not_admin/);
    await throws(h.q(`select reactivate_venue($1)`, [v]), /not_admin/);
    await h.reset();
    eq((await statusOf(v)).operating_status, 'suspected_closed');
    eq((await eventsFor(v)).length, 1, 'a refused call must leave no trace but the original flag');
  });

  await test('H5. an ADMIN can confirm, and an ADMIN can reactivate', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'signal')`, [v]);
    await h.asUser(ADMIN);
    const c = (await h.q(`select confirm_venue_closure($1,'phoned, it has shut') as r`, [v])).rows[0].r;
    eq(c.to_status, 'confirmed_closed');
    eq(c.mode, 'manual');
    eq(c.actor_id, ADMIN);
    const r = (await h.q(`select reactivate_venue($1,'reopened under new owners') as r`, [v])).rows[0].r;
    await h.reset();
    eq(r.from_status, 'confirmed_closed');
    eq(r.to_status, 'active');
    eq(r.actor_id, ADMIN);
    eq((await statusOf(v)).operating_status, 'active');
  });

  await test('H5b. an ADMIN can reactivate straight from suspected_closed', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'false alarm')`, [v]);
    await h.asUser(ADMIN);
    const r = (await h.q(`select reactivate_venue($1,'checked, still open') as r`, [v])).rows[0].r;
    await h.reset();
    eq(r.from_status, 'suspected_closed');
    eq(r.to_status, 'active');
    eq((await eventsFor(v)).length, 2);
  });

  // ── H6..H10: the event log ─────────────────────────────────────────────────
  await test('H6. every successful transition appends EXACTLY one event', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'a')`, [v]);
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1,'b')`, [v]);
    await h.q(`select reactivate_venue($1,'c')`, [v]);
    await h.reset();
    const ev = await eventsFor(v);
    eq(ev.length, 3, 'three transitions, three events -- no more, no fewer');
    eq(JSON.stringify(ev.map((e) => [e.from_status, e.to_status])),
       JSON.stringify([['active', 'suspected_closed'],
                       ['suspected_closed', 'confirmed_closed'],
                       ['confirmed_closed', 'active']]));
  });

  await test('H7. a FAILED or no-op transition appends NO event', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'first')`, [v]);
    // Re-detection is not a state change. Deliberate no-op, explicitly reported.
    const again = (await h.q(`select system_flag_suspected_closure($1,'again') as r`, [v])).rows[0].r;
    eq(again.changed, false);
    eq(again.reason, 'already_suspected_closed');
    await h.asUser(OTHER);
    await throws(h.q(`select confirm_venue_closure($1,'nope')`, [v]), /not_admin/);
    await h.reset();
    eq((await eventsFor(v)).length, 1,
      'a no-op and a refusal must not pollute the log with transitions that did not happen');
  });

  await test('H8. the event log is APPEND-ONLY, for every role and the owner too', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v]);
    await h.reset();
    const id = (await eventsFor(v))[0].id;
    // (1) No client role holds any privilege at all on the table.
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const held = (await h.q(`select has_table_privilege($1,'venue_operating_status_events',$2) as x`,
          [role, p])).rows[0].x;
        eq(held, false, `${role} must not hold ${p} on the closure event log`);
      }
    }
    // (2) And the trigger refuses even the table owner, so a future migration
    //     that re-grants UPDATE cannot quietly make history editable.
    await throws(h.q(`update venue_operating_status_events set reason='rewritten' where id=$1`, [id]),
      /append-only/i, 'history must not be editable by anyone');
    await throws(h.q(`delete from venue_operating_status_events where id=$1`, [id]),
      /append-only/i, 'history must not be deletable by anyone');
    eq((await eventsFor(v)).length, 1);
  });

  await test('H9. mode and actor are recorded correctly on both kinds of event', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'auto reason')`, [v]);
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1,'human reason')`, [v]);
    await h.reset();
    const [auto, manual] = await eventsFor(v);
    eq(auto.mode, 'auto');
    eq(auto.actor_id, null, 'an automated event must have NO actor');
    eq(auto.reason, 'auto reason');
    eq(manual.mode, 'manual');
    eq(manual.actor_id, ADMIN, 'a manual event must name the human');
    eq(manual.reason, 'human reason');
    assert(JSON.stringify(manual.evidence).includes('human_confirmed_closure'),
      'the machine-readable justification must be recorded too');
  });

  await test('H10. an event can never claim automation acted as a person, or vice versa', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.reset();
    await throws(
      h.q(`select _venue_record_status_transition($1,'suspected_closed','auto',$2,'x')`, [v, ADMIN]),
      /auto_transition_must_have_no_actor/);
    await throws(
      h.q(`select _venue_record_status_transition($1,'suspected_closed','manual',null,'x')`, [v]),
      /manual_transition_requires_actor/);
    eq((await eventsFor(v)).length, 0);
  });

  // ── H11..H13: visibility, and the destructive step ─────────────────────────
  await test('H11. ONLY confirmed closure changes discovery visibility', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.reset();
    eq((await statusOf(v)).discovery_approved, true);
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v]);
    await h.reset();
    eq((await statusOf(v)).discovery_approved, true,
      'a SUSPICION must never hide a venue -- that would make automation destructive');
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1,'confirmed')`, [v]);
    await h.reset();
    eq((await statusOf(v)).discovery_approved, false, 'confirmation hides it');
    const ev = (await eventsFor(v))[1];
    eq(ev.discovery_approved_before, true);
    eq(ev.discovery_approved_after, false);
  });

  await test('H12. reactivation restores what closure took away -- DELIBERATELY', async () => {
    // The trap this avoids: a venue hidden for an UNRELATED reason (moderation,
    // a manual takedown) that is later confirmed closed and then reopened. A
    // blanket "set discovery_approved = true" on reactivation would publish a
    // venue nobody ever agreed to publish.
    const v = await h.newVenue({ claimed_by: null });
    await h.reset();
    await h.q(`update venues set discovery_approved = false where id=$1`, [v]);
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v]);
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1,'closed')`, [v]);
    await h.q(`select reactivate_venue($1,'reopened')`, [v]);
    await h.reset();
    eq((await statusOf(v)).discovery_approved, false,
      'a venue hidden for another reason must STAY hidden through a closure round-trip');

    // ...and the ordinary case still restores.
    const v2 = await h.newVenue({ claimed_by: null });
    await h.asService();
    await h.q(`select system_flag_suspected_closure($1,'x')`, [v2]);
    await h.asUser(ADMIN);
    await h.q(`select confirm_venue_closure($1,'closed')`, [v2]);
    await h.q(`select reactivate_venue($1,'reopened')`, [v2]);
    await h.reset();
    eq((await statusOf(v2)).discovery_approved, true, 'a normally-visible venue comes back');
  });

  await test('H13. the state machine refuses every edge it does not name', async () => {
    const v = await h.newVenue({ claimed_by: null });
    await h.asUser(ADMIN);
    // active -> confirmed_closed is DELIBERATELY not permitted: confirming a
    // closure requires the venue to have been flagged first, so the log always
    // carries the suspicion underneath the confirmation.
    await throws(h.q(`select confirm_venue_closure($1,'straight to confirmed')`, [v]),
      /transition_not_permitted:active->confirmed_closed/);
    // A transition to where you already are is not a transition.
    await throws(h.q(`select reactivate_venue($1)`, [v]), /no_transition:active/);
    await h.reset();
    eq((await eventsFor(v)).length, 0);
    eq((await statusOf(v)).operating_status, 'active');
  });

  await test('H14. PP-011 still blocks an owner from touching closure state', async () => {
    const v = await h.newVenue({ claimed_by: OWNER });
    await h.asUser(OWNER);
    for (const [col, val] of [['operating_status', `'confirmed_closed'`],
                              ['operating_status_updated_at', 'now()'],
                              // false, not true: the venue starts visible, so
                              // setting it true again changes nothing and PP-011
                              // (rightly) only refuses an actual change.
                              ['discovery_approved', 'false']]) {
      await throws(h.q(`update venues set ${col} = ${val} where id=$1`, [v]), /42501|may not change/i,
        `a venue owner must not be able to move ${col}`);
    }
    await h.reset();
    const src = (await h.q(
      `select prosrc from pg_proc where proname='enforce_venue_owner_update_boundary'`)).rows[0].prosrc;
    for (const f of ['operating_status', 'discovery_approved']) {
      assert(!src.includes(`'${f}'`), `${f} must NOT have been added to the owner allowlist`);
    }
  });

  // ── H20..H27: rediscovery safety ───────────────────────────────────────────
  const rediscover = async (source, sourceId, overrides = {}) => {
    await h.asService();
    const payload = {
      source, source_id: sourceId, name: 'Rediscovered', latitude: 51.38, longitude: -2.36,
      postcode: 'BA1 1AA', city: 'Bath', dedupe_decision: 'distinct', confidence_score: 99,
      has_family_relevant_category: true, has_valid_uk_coordinates: true, has_valid_address: true,
      is_trusted_source: true, required_fields_complete: true,
      independent_identity_evidence_count: 5, status: 'candidate', ...overrides,
    };
    const r = (await h.q(`select upsert_discovery_candidate($1::jsonb) as r`,
      [JSON.stringify(payload)])).rows[0].r;
    await h.reset();
    return r;
  };

  for (const [label, setup] of [
    ['approved', async () => {
      const c = await h.newCandidate({ source: 'osm', source_id: 'node/700001', status: 'quarantined' });
      await h.asUser(ADMIN);
      await h.q(`select resolve_discovery_candidate($1,'approve','ok')`, [c]);
      await h.reset();
      return c;
    }],
    ['rejected', async () => {
      const c = await h.newCandidate({ source: 'osm', source_id: 'node/700002', status: 'quarantined' });
      await h.asUser(ADMIN);
      await h.q(`select resolve_discovery_candidate($1,'reject','not a venue')`, [c]);
      await h.reset();
      return c;
    }],
    ['dismissed', async () => {
      const c = await h.newCandidate({ source: 'osm', source_id: 'node/700003', status: 'quarantined' });
      await h.asUser(ADMIN);
      await h.q(`select resolve_discovery_candidate($1,'dismiss','not for us')`, [c]);
      await h.reset();
      return c;
    }],
    ['duplicate', async () => {
      const c = await h.newCandidate({ source: 'osm', source_id: 'node/700004', status: 'quarantined' });
      await h.reset();
      await h.q(`update venue_discovery_candidates
                    set status='duplicate', resolved_mode='system', reviewed_at=now()
                  where id=$1`, [c]);
      return c;
    }],
  ]) {
    await test(`H20-${label}. rediscovering a ${label} candidate must NOT reopen it`, async () => {
      const c = await setup();
      const before = await h.candidate(c);
      const r = await rediscover(before.source, before.source_id, { name: 'Renamed By Provider' });
      eq(r.outcome, 'terminal_unchanged',
        'a settled decision outranks a later automated sighting');
      const after = await h.candidate(c);
      eq(after.status, before.status, 'the status must not move');
      eq(after.name, before.name, 'nor may the provider overwrite the reviewed record');
      eq(String(after.venue_id), String(before.venue_id));
      eq(String(after.reviewed_by), String(before.reviewed_by), 'reviewer identity must survive');
      eq(String(after.reviewed_at), String(before.reviewed_at), 'and so must the decision time');
      eq(JSON.stringify(after.resolution_reasons), JSON.stringify(before.resolution_reasons),
        'the audit history must not be destroyed');
      // The re-sighting IS recorded -- it is real information.
      eq(after.seen_count, before.seen_count + 1);
      assert(after.last_seen_at > before.last_seen_at, 'the re-sighting must be timestamped');
    });
  }

  await test('H24. a still-open candidate IS refreshed with newer evidence', async () => {
    const c = await h.newCandidate({
      source: 'osm', source_id: 'node/700010', name: 'Old Name',
      confidence_score: 80, status: 'candidate' });
    const before = await h.candidate(c);
    const r = await rediscover('osm', 'node/700010',
      { name: 'Better Name', confidence_score: 99, status: 'quarantined', website: 'https://x.test' });
    eq(r.outcome, 'refreshed');
    eq(r.previous_status, 'candidate');
    const after = await h.candidate(c);
    eq(after.name, 'Better Name', 'nobody has decided anything yet -- newer evidence is better');
    eq(after.confidence_score, 99);
    eq(after.status, 'quarantined');
    eq(after.website, 'https://x.test');
    eq(after.seen_count, before.seen_count + 1);
    // Untouched, because there is nothing to preserve yet but also nothing to invent.
    eq(after.reviewed_by, null);
    eq(after.venue_id, null);
  });

  await test('H25. a refresh may UPDATE provenance but must never BLANK it', async () => {
    // A later run that omits the provider's datasource statement must not erase
    // the one we already hold -- a publishable candidate would silently become
    // unpublishable, and the reason would be invisible.
    const c = await h.newCandidate({ source: 'geoapify', source_id: 'gp-700020', status: 'candidate' });
    await rediscover('geoapify', 'gp-700020', { name: 'Refreshed' });
    const after = await h.candidate(c);
    assert(after.source_datasource, 'the datasource statement must survive a refresh that omits it');
    eq(after.source_datasource.sourcename, 'openstreetmap');

    // ...and a run that DOES supply one updates it.
    await rediscover('geoapify', 'gp-700020', {
      source_datasource: { ...GEOAPIFY_OSM_DATASOURCE, attribution: 'updated statement' } });
    const after2 = await h.candidate(c);
    eq(after2.source_datasource.attribution, 'updated statement');
  });

  await test('H26. the pipeline cannot set a human-only status through the upsert', async () => {
    await h.asService();
    for (const bad of ['approved', 'dismissed', 'duplicate']) {
      await throws(
        h.q(`select upsert_discovery_candidate($1::jsonb)`,
          [JSON.stringify({ source: 'osm', source_id: 'node/700030', name: 'X',
                            latitude: 51.38, longitude: -2.36, status: bad })]),
        new RegExp(`status_not_settable_by_pipeline:${bad}`),
        `the runner must not be able to write '${bad}' -- that is a human verdict`);
    }
    await h.reset();
    eq((await h.q(`select count(*)::int c from venue_discovery_candidates
                    where source_id='node/700030'`)).rows[0].c, 0);
  });

  await test('H27. a pipeline rejection carries the audit a terminal state requires', async () => {
    const r = await rediscover('osm', 'node/700040',
      { status: 'rejected', decision_reason: 'below the quarantine floor' });
    eq(r.outcome, 'inserted');
    await h.reset();
    const row = (await h.q(
      `select * from venue_discovery_candidates where source_id='node/700040'`)).rows[0];
    eq(row.status, 'rejected');
    eq(row.resolved_mode, 'system', 'the pipeline names itself rather than leaving a NULL actor');
    eq(row.reviewed_by, null, 'and it legitimately has no profile id');
    assert(row.reviewed_at, 'a terminal state must be timestamped');
    assert(JSON.stringify(row.resolution_reasons).includes('below the quarantine floor'));
  });

  await test('H28. the upsert RPC is the ONLY way in -- no direct table DML for any API role', async () => {
    await h.reset();
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        eq((await h.q(`select has_table_privilege($1,'venue_discovery_candidates',$2) as x`,
          [role, p])).rows[0].x, false, `${role} must hold no ${p}`);
      }
    }
    const acl = await h.fnAcl('public.upsert_discovery_candidate(jsonb)');
    eq(acl.service_role, true);
    eq(acl.authenticated, false);
    eq(acl.anon, false);
    eq(acl.PUBLIC, false);
  });

  await db.close();
}
// =============================================================================
async function main() {
  console.log('Enrichment 057 rebase -- RED LINE');
  console.log('Bootstrap: supabase/tests/_enrichment_bootstrap.mjs (production-faithful)');

  await partB();
  await partD();
  await partE();
  await partF();
  await partG();
  await partH();

  const reds = state.red.filter((r) => r.outcome === 'red (expected)');
  const unexpectedGreen = state.red.filter((r) => r.outcome === 'UNEXPECTEDLY GREEN');

  console.log(`\n${state.passed} passed, ${state.failures.length} unexpected failures`);
  console.log(`${reds.length} RED (expected -- known unfixed defects; the target is 0)`);
  if (unexpectedGreen.length) {
    console.log(`${unexpectedGreen.length} RED test(s) unexpectedly GREEN:`);
    for (const r of unexpectedGreen) console.log(`  - ${r.name}`);
  }
  if (state.failures.length) {
    console.log('\nUNEXPECTED FAILURES (these are real regressions):');
    for (const f of state.failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exitCode = 1;
  }
  // This suite is wired into `npm run test:db:security`, so the exit code is the
  // gate. A red test is a KNOWN unfixed defect, and the current baseline is ZERO
  // of them -- so any red, new or reintroduced, fails CI too. Parking a failing
  // test behind red() must never be a way to make the gate go quiet.
  if (reds.length) {
    console.log('\nRED tests present. The baseline is 0 -- a known defect may not be parked here silently.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
