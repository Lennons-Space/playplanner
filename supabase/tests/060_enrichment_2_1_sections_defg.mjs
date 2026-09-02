// =============================================================================
// supabase/tests/060_enrichment_2_1_sections_defg.mjs
//
// Behavioural database tests for migration 060's Sections D-G — the sections
// added by the pre-commit integration review:
//   D. venue_enrichment age/height EVIDENCE columns
//   E. snapshot_current_value reading the real venues.booking_url column
//   F. auto_apply_booking_url + enrichment_url_host (venue-identity gate)
//   G. enrichment_coverage_grid (per-cell/per-category aggregation)
//
// pglite (in-process Postgres), no live Supabase, migration NOT applied to any
// real project. None of these sections needs PostGIS (Section G deliberately
// aggregates the plain latitude/longitude columns) so unlike Section A they
// are all genuinely testable here.
//
// BOOTSTRAP: built on the SHARED, production-faithful bootstrap in
// _enrichment_bootstrap.mjs, not this file's old private simplified schema.
// That schema predated migration 057 (no decision/decision_reasons/
// applied_mode on venue_field_proposals) and hand-added a competing
// venue_field_proposals.applied_by TEXT column that 057 and the rebased
// 059/060 drafts explicitly reject — see _enrichment_bootstrap.mjs PART A.
// The real 060 auto_apply_booking_url / _enrichment_apply_write call 059's
// enrichment_value_is_meaningful() and enrichment_is_valid_website(), and
// write into decision_reasons: the private schema had neither, which is why
// this file broke ("function ... does not exist" / "no field
// decision_reasons"). Provenance is now asserted the canonical way:
// applied_mode on the proposal plus an immutable venue_enrichment_writes
// ledger row (applied_by NULL for automation, decision_reasons carrying the
// machine justification).
//
// The SQL is EXTRACTED from the real migration file via its
// ENRICHMENT_2_1_SECTIONS_BC_START/END and _DEFG_START/END markers — never a
// hand-maintained copy — and is loaded after the shared bootstrap + the real
// 059 helper functions, matching real migration promotion order (059 before
// 060; Section E replaces a function 059/057 own, Section F needs Section B's
// venues.booking_url column).
//
// Run: node supabase/tests/060_enrichment_2_1_sections_defg.mjs
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  BOOTSTRAP, DRAFT_COLUMNS, makeHelpers, makeHarness, OWNER,
  extractFn, extractSection,
} from './_enrichment_bootstrap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_059 = readFileSync(join(__dirname, '../migrations_drafts/059_enrichment_autonomy.sql'), 'utf8');
const MIGRATION_060_FULL = readFileSync(join(__dirname, '../migrations_drafts/060_enrichment_2_1.sql'), 'utf8');

function extract(startMarker, endMarker) {
  const s = MIGRATION_060_FULL.indexOf(startMarker);
  const e = MIGRATION_060_FULL.indexOf(endMarker);
  if (s === -1 || e === -1) {
    console.error(`FATAL: markers ${startMarker}/${endMarker} not found in 060_enrichment_2_1.sql — did the file change shape?`);
    process.exit(1);
  }
  return MIGRATION_060_FULL.slice(s, e + endMarker.length);
}
const SECTIONS_BC = extract('-- ENRICHMENT_2_1_SECTIONS_BC_START', '-- ENRICHMENT_2_1_SECTIONS_BC_END');
const SECTIONS_DEFG = extract('-- ENRICHMENT_2_1_SECTIONS_DEFG_START', '-- ENRICHMENT_2_1_SECTIONS_DEFG_END');

// Pulls "CREATE OR REPLACE FUNCTION <name>(" through its terminating $$; and
// any REVOKE/GRANT lines that immediately follow for the same function.
// Copied verbatim from enrichment_057_rebase_redline.mjs's extractFn — this
// file executes the REAL migration text, never a hand-maintained copy of it.
// extractFn now comes from _enrichment_bootstrap.mjs (single definition).

// The 059 helper validators + audited-write primitive that draft 060's own
// functions (auto_apply_booking_url, the Section F0b _enrichment_apply_write)
// depend on but do not themselves define. Assembled from the real 059 draft,
// same apply order as the redline suite, so this is never a hand copy.
const REBASED_059 = [
  'alter table venue_field_proposals add column if not exists confidence_score smallint;',
  extractFn(SQL_059, 'enrichment_url_host'),
  extractFn(SQL_059, 'enrichment_is_valid_website'),
  extractFn(SQL_059, 'enrichment_is_valid_phone'),
  extractFn(SQL_059, 'enrichment_value_is_meaningful'),
  // R1 (pre-staging remediation, 2026-09-01): used by auto_apply_field_proposal.
  extractFn(SQL_059, 'enrichment_opening_hours_is_meaningful'),
  extractFn(SQL_059, '_enrichment_apply_write'),
  extractFn(SQL_059, 'auto_apply_field_proposal'),
].join(String.fromCharCode(10));

// R3 (pre-staging remediation, 2026-09-01): auto_apply_field_proposal now
// calls enrichment_venue_field_suppressed unconditionally.
const REAL_SUPPRESSION_059 = [
  extractSection(SQL_059, 'suppression_schema'),
  extractSection(SQL_059, 'suppression_checks'),
].join(String.fromCharCode(10));

// venue_enrichment is a REAL production table (migration 049) that
// _enrichment_bootstrap.mjs deliberately does not create, because the redline
// suite it primarily serves never touches it. Sections B/D's admission_status
// and age/height evidence columns land on this table, so a minimal stand-in
// (just the PK) is created here — 049's full column set is irrelevant to what
// Sections D-G actually exercise.
const VENUE_ENRICHMENT_STUB = `
  create table if not exists venue_enrichment (
    venue_id uuid primary key references venues(id) on delete cascade);
`;

// Minimal stand-in for migration 059's venue_discovery_candidates: Section G
// only ever reads latitude/longitude/created_at from it. The shared bootstrap
// does not create this table at all (the redline suite loads 059's real,
// much larger discovery_schema section instead — accept-gate columns, RLS,
// the works — which Section G's coverage-grid join has no need of).
const VENUE_DISCOVERY_CANDIDATES_STUB = `
  create table if not exists venue_discovery_candidates (
    id uuid primary key default gen_random_uuid(),
    latitude decimal(9,6), longitude decimal(9,6),
    created_at timestamptz not null default now());
`;

async function main() {
  const db = new PGlite();
  const h = makeHelpers(db);
  const { state, test, assert, eq, throws } = makeHarness();

  await db.exec(BOOTSTRAP);
  await db.exec(DRAFT_COLUMNS);
  await db.exec(VENUE_ENRICHMENT_STUB);
  await db.exec(VENUE_DISCOVERY_CANDIDATES_STUB);
  await db.exec(REAL_SUPPRESSION_059);
  await db.exec(REBASED_059);
  await db.exec(SECTIONS_BC);
  await db.exec(SECTIONS_DEFG);

  // Local fixture helper, not h.newVenue: this suite needs to control
  // latitude/longitude/category_id/min_age/max_age/booking_url per test (the
  // shared helper hardcodes lat/lng and doesn't expose the others). Every
  // venue also gets a venue_enrichment row, which the shared helper doesn't
  // create.
  async function newVenue(fields = {}) {
    await h.reset();
    const r = await h.q(
      `insert into venues (name, city, postcode, latitude, longitude, submitted_by,
                           is_published, moderation_status, data_source,
                           website, booking_url, category_id, min_age, max_age)
       values ($1,'Bath','BA1 1AA',$2,$3,$4,true,'approved','manual',$5,$6,$7,$8,$9)
       returning id`,
      [`V-${Math.random().toString(36).slice(2, 9)}`,
        fields.latitude ?? 51.38, fields.longitude ?? -2.36, OWNER,
        fields.website ?? null, fields.booking_url ?? null,
        fields.category_id ?? null, fields.min_age ?? null, fields.max_age ?? null]);
    const id = r.rows[0].id;
    await h.q(`insert into venue_enrichment (venue_id) values ($1)`, [id]);
    return id;
  }

  // venue_enrichment_writes (the 057 ledger) is deliberately append-only —
  // production revokes DELETE from every API role, including service_role
  // (see _enrichment_bootstrap.mjs). The old private schema in this file had
  // no such table, so its blanket `delete from venues` between Section G
  // cases never had to think about it. Now that Sections F's successful
  // auto-applies leave real ledger rows behind, venues can't be cleared
  // without clearing the (non-cascading, by design) ledger rows that point
  // at them first — this is cleanup as the DB's own table owner, not
  // anything a real API role could do.
  async function clearVenues() {
    await h.q('delete from venue_enrichment_writes');
    await h.q('delete from venues');
  }

  console.log('\nMigration 060 Sections D-G — database tests (pglite, no live Supabase, migration NOT applied to production)\n');

  // ── Section D: age/height evidence ────────────────────────────────────────
  await test('D: age/height evidence columns exist and accept plausible values', async () => {
    const v = await newVenue();
    await h.q(`update venue_enrichment set min_age_evidence=2, max_age_evidence=11, min_height_cm_evidence=90 where venue_id=$1`, [v]);
    const r = await h.q(`select min_age_evidence, max_age_evidence, min_height_cm_evidence from venue_enrichment where venue_id=$1`, [v]);
    eq(r.rows[0].min_age_evidence, 2, 'min age');
    eq(r.rows[0].max_age_evidence, 11, 'max age');
    eq(r.rows[0].min_height_cm_evidence, 90, 'min height');
  });

  await test('D: rejects an implausible age and an implausible height', async () => {
    const v = await newVenue();
    await throws(h.q(`update venue_enrichment set min_age_evidence=40 where venue_id=$1`, [v]), /check/i, 'age > 18 rejected');
    await throws(h.q(`update venue_enrichment set min_height_cm_evidence=10 where venue_id=$1`, [v]), /check/i, 'height < 50cm rejected');
    await throws(h.q(`update venue_enrichment set min_height_cm_evidence=400 where venue_id=$1`, [v]), /check/i, 'height > 250cm rejected');
  });

  await test('D: rejects a max age below its min age', async () => {
    const v = await newVenue();
    await throws(h.q(`update venue_enrichment set min_age_evidence=10, max_age_evidence=4 where venue_id=$1`, [v]), /check/i, 'inverted range rejected');
  });

  await test('D: evidence columns are SEPARATE from admin-owned venues.min_age/max_age', async () => {
    const v = await newVenue({ min_age: 0, max_age: 16 });
    await h.q(`update venue_enrichment set min_age_evidence=2, max_age_evidence=11 where venue_id=$1`, [v]);
    const r = await h.q(`select min_age, max_age from venues where id=$1`, [v]);
    // Writing evidence must leave the published, admin-owned values untouched.
    eq(r.rows[0].min_age, 0, 'published min_age untouched');
    eq(r.rows[0].max_age, 16, 'published max_age untouched');
  });

  // ── Section E: snapshot_current_value ─────────────────────────────────────
  await test('E: snapshot_current_value returns the REAL booking_url, not a hardcoded null', async () => {
    const v = await newVenue({ booking_url: 'https://v.example/book' });
    const r = await h.q(`select snapshot_current_value($1,'booking_url') as s`, [v]);
    eq(r.rows[0].s.value.v, 'https://v.example/book', 'live booking_url returned');
  });

  await test('E: booking_url snapshot HASH changes when the live value changes (the stale guard actually works now)', async () => {
    const v = await newVenue({ booking_url: null });
    const before = await h.q(`select snapshot_current_value($1,'booking_url') as s`, [v]);
    await h.q(`update venues set booking_url='https://v.example/book' where id=$1`, [v]);
    const after = await h.q(`select snapshot_current_value($1,'booking_url') as s`, [v]);
    if (before.rows[0].s.hash === after.rows[0].s.hash) {
      throw new Error('hash did not change — the stale-current-value guard would be blind for this field');
    }
  });

  await test('E: every other field branch is unchanged (description/website/phone/email/price_range/opening_hours)', async () => {
    const v = await newVenue({ website: 'https://v.example/' });
    await h.q(`update venues set description='d', phone='p', email='e@x.com', price_range='free' where id=$1`, [v]);
    for (const [field, expected] of [['description', 'd'], ['website', 'https://v.example/'], ['phone', 'p'], ['email', 'e@x.com'], ['price_range', 'free']]) {
      const r = await h.q(`select snapshot_current_value($1,$2) as s`, [v, field]);
      eq(r.rows[0].s.value.v, expected, `${field} snapshot`);
    }
    const hours = await h.q(`select snapshot_current_value($1,'opening_hours') as s`, [v]);
    eq(JSON.stringify(hours.rows[0].s.value), '[]', 'opening_hours still returns an array');
  });

  await test('E: an unknown field still raises invalid_field', async () => {
    const v = await newVenue();
    await throws(h.q(`select snapshot_current_value($1,'not_a_field')`, [v]), /invalid_field/, 'unknown field rejected');
  });

  // ── Section F: enrichment_url_host ────────────────────────────────────────
  await test('F: enrichment_url_host strips scheme/path and lowercases, but does NOT strip www (that job belongs to the identity rule, not this function)', async () => {
    // CONTRACT CHANGE: the canonical enrichment_url_host is 059's (loaded here
    // via extractFn) — 060's own header explicitly says it does NOT redefine
    // this function, because an EARLIER 060-only draft had a looser version
    // (optional scheme, so 'javascript:alert(1)' parsed as a host) and this
    // suite's private bootstrap had inherited that looser behaviour. 059's
    // version never strips a leading www — see 060's Section F0 comment:
    // "www-stripping is not needed: the identity rule below already treats
    // one host as a subdomain of the other" (that check lives in
    // auto_apply_booking_url, not in this low-level extractor).
    const r = await h.q(`select enrichment_url_host('https://www.Venue.co.uk/book?x=1') as h`);
    eq(r.rows[0].h, 'www.venue.co.uk', 'scheme/path stripped and lowercased; www retained as a literal subdomain');
  });

  await test('F: enrichment_url_host REFUSES a userinfo-style host (the impersonation trick)', async () => {
    const r = await h.q(`select enrichment_url_host('https://real-venue.co.uk@evil.example/book') as h`);
    eq(r.rows[0].h, null, 'userinfo host refused');
  });

  await test('F: enrichment_url_host returns null for empty/garbage input', async () => {
    eq((await h.q(`select enrichment_url_host(null) as h`)).rows[0].h, null, 'null input');
    eq((await h.q(`select enrichment_url_host('') as h`)).rows[0].h, null, 'empty input');
  });

  // ── Section F: auto_apply_booking_url ─────────────────────────────────────
  await test('F happy: applies a booking URL on the venue\'s own host over an empty value', async () => {
    const v = await newVenue({ website: 'https://venue.co.uk', booking_url: null });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue.co.uk/book' });
    await h.asService();
    const res = await h.q(`select auto_apply_booking_url($1) as r`, [proposal]);
    eq(res.rows[0].r.ok, true, 'applied ok');
    await h.reset();
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, 'https://venue.co.uk/book', 'written');
    const row = (await h.q(`select status, applied_mode from venue_field_proposals where id=$1`, [proposal])).rows[0];
    eq(row.status, 'applied', 'status applied');
    // CONTRACT CHANGE: venue_field_proposals.applied_by (text) does not exist
    // — applied_mode is the canonical proposal-level mode; actor identity and
    // the machine justification live on the venue_enrichment_writes ledger
    // row (see _enrichment_bootstrap.mjs PART A).
    eq(row.applied_mode, 'auto', 'applied_mode records automation');
    const ledger = await h.ledgerFor(proposal);
    eq(ledger.length, 1, 'the write must be audited exactly once');
    eq(ledger[0].applied_by, null, 'automation has no auth user — NULL is the contract');
    assert(JSON.stringify(ledger[0].decision_reasons).includes('auto_booking_url_same_host'),
      'the same-host identity justification must be recorded');
  });

  await test('F happy: accepts a subdomain of the venue\'s own host', async () => {
    const v = await newVenue({ website: 'https://venue2.co.uk' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://book.venue2.co.uk/tickets' });
    await h.asService();
    eq((await h.q(`select auto_apply_booking_url($1) as r`, [proposal])).rows[0].r.ok, true, 'subdomain accepted');
    await h.reset();
  });

  await test('F: REFUSES a third-party booking host', async () => {
    const v = await newVenue({ website: 'https://venue3.co.uk' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://bookwhen.com/venue3' });
    await h.asService();
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]), /host_identity_mismatch/, 'third-party host refused');
    await h.reset();
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, null, 'nothing written');
  });

  await test('F: REFUSES a look-alike host that merely ends with the venue\'s domain', async () => {
    const v = await newVenue({ website: 'https://venue4.co.uk' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue4.co.uk.evil.example/book' });
    await h.asService();
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]), /host_identity_mismatch/, 'look-alike refused');
    await h.reset();
  });

  await test('F: REFUSES a userinfo-disguised host that would otherwise read as the venue\'s own', async () => {
    const v = await newVenue({ website: 'https://venue5.co.uk' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue5.co.uk@evil.example/book' });
    await h.asService();
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]), /identity_unverifiable/, 'userinfo refused');
    await h.reset();
  });

  await test('F: REFUSES when the venue has no website to verify identity against', async () => {
    const v = await newVenue({ website: null });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://anything.example/book' });
    await h.asService();
    // CONTRACT CHANGE: 060 now checks "does the venue even have a usable
    // website" BEFORE it ever tries to parse a host, raising the dedicated
    // venue_website_unusable_for_identity_check rather than falling through
    // to the generic identity_unverifiable (which is what fires when a host
    // merely fails to parse). Same protection — no website means no anchor —
    // a more specific message.
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]),
      /venue_website_unusable_for_identity_check/, 'no anchor to verify against');
    await h.reset();
  });

  await test('F: REFUSES a non-https booking URL even on the venue\'s own host', async () => {
    const v = await newVenue({ website: 'https://venue6.co.uk' });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'http://venue6.co.uk/book' });
    await h.asService();
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]), /insecure_or_invalid_scheme/, 'http refused');
    await h.reset();
  });

  await test('F: NEVER overwrites a booking_url that is already set', async () => {
    const v = await newVenue({ website: 'https://venue7.co.uk', booking_url: null });
    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue7.co.uk/book' });
    // Set it AFTER proposing, so the proposal's snapshot is the empty one.
    await h.q(`update venues set booking_url='https://venue7.co.uk/original' where id=$1`, [v]);
    await h.asService();
    // CONTRACT CHANGE: auto_apply_booking_url's own fill-if-empty check
    // (enrichment_value_is_meaningful) now runs BEFORE _enrichment_apply_write
    // is ever called, so booking_url_already_set is the guard that actually
    // fires here — the generic stale-value guard in the primitive never gets
    // a chance to. (A genuinely stale-but-still-empty edit, e.g. whitespace,
    // would still surface as stale_current_value — see the 060 sections_bc
    // suite's equivalent test for that scenario.)
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]), /booking_url_already_set/, 'existing value protected');
    await h.reset();
    eq((await h.q(`select booking_url from venues where id=$1`, [v])).rows[0].booking_url, 'https://venue7.co.uk/original', 'original preserved');
  });

  await test('F: refuses a proposal for the wrong field, and a non-pending one', async () => {
    const v = await newVenue({ website: 'https://venue8.co.uk' });
    const { proposal: wrongField } = await h.newProposal(v, 'phone', { v: '01234567890' });
    await h.asService();
    await throws(h.q(`select auto_apply_booking_url($1)`, [wrongField]), /wrong_field/, 'wrong field refused');

    const { proposal } = await h.newProposal(v, 'booking_url', { v: 'https://venue8.co.uk/book' });
    await h.q(`select auto_apply_booking_url($1)`, [proposal]); // applies, status -> applied
    await throws(h.q(`select auto_apply_booking_url($1)`, [proposal]), /not_pending/, 'second apply refused');
    await h.reset();
  });

  await test('F: auto_apply_booking_url is service_role only — not anon/authenticated', async () => {
    await h.reset();
    const acl = await h.fnAcl('public.auto_apply_booking_url(uuid)');
    assert(acl.exists, 'function must exist');
    eq(acl.anon, false, 'anon denied');
    eq(acl.authenticated, false, 'authenticated denied');
    eq(acl.service_role, true, 'service_role allowed');
  });

  // ── Section G: enrichment_coverage_grid ───────────────────────────────────
  await test('G: buckets venues into integer grid cells and counts per category', async () => {
    await clearVenues();
    const museum = (await h.q(`insert into categories (name, slug) values ('Museum','museum') returning id`)).rows[0].id;
    const playground = (await h.q(`insert into categories (name, slug) values ('Playground','playground') returning id`)).rows[0].id;
    // lat 52.5 -> floor((52.5-49)/1)=3 ; lng -2.2 -> floor((-2.2 - -8.7)/1)=6
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: museum });
    await newVenue({ latitude: 52.9, longitude: -2.4, category_id: museum });   // same cell 3:6
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: playground });
    // lng -2.9 -> floor((-2.9 - -8.7)/1)=5, a DIFFERENT column — proves the
    // bucketing actually separates cells rather than lumping everything together.
    await newVenue({ latitude: 52.5, longitude: -2.9, category_id: museum });

    const r = await h.q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7) order by cell_lat_idx, cell_lng_idx, category_slug`);
    const inCell = r.rows.filter((x) => x.cell_lat_idx === 3 && x.cell_lng_idx === 6);
    const byCat = Object.fromEntries(inCell.map((x) => [x.category_slug, Number(x.venue_count)]));
    eq(byCat.museum, 2, 'two museums in cell 3:6');
    eq(byCat.playground, 1, 'one playground in cell 3:6');

    const neighbour = r.rows.filter((x) => x.cell_lat_idx === 3 && x.cell_lng_idx === 5);
    eq(neighbour.length, 1, 'neighbouring cell 3:5 kept separate');
    eq(Number(neighbour[0].venue_count), 1, 'one museum in cell 3:5');
  });

  await test('G: venues.latitude/longitude are NOT NULL, so enrichment_coverage_grid\'s coordinate-less exclusion is defence-in-depth, not a reachable path today', async () => {
    // CONTRACT CHANGE: the old private bootstrap declared venues.latitude/
    // longitude as nullable, so this test could insert a coordinate-less
    // venue and exercise the function's "WHERE v.latitude IS NOT NULL" branch
    // directly. The SHARED, production-faithful bootstrap (migration 001)
    // has always declared both NOT NULL, so that row can never exist for
    // real. The function's defensive filter is harmless and stays (a safety
    // net if that constraint is ever relaxed), but this suite can only prove
    // the row-level guarantee that makes the branch unreachable today, not
    // the branch itself — proving the branch would require asserting against
    // a schema production does not have, exactly what this whole rewrite
    // exists to stop doing.
    await h.reset();
    await throws(
      h.q(`insert into venues (name, city, latitude, longitude, submitted_by, data_source)
           values ('No Coords','Bath',null,null,$1,'manual')`, [OWNER]),
      /null value in column "latitude"|violates not-null constraint/i,
      'a coordinate-less venue must be impossible to create, not merely excluded downstream');
  });

  await test('G: an uncategorised venue is counted with a NULL category_slug, never invented', async () => {
    await clearVenues();
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: null });
    const r = await h.q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows.length, 1, 'one row');
    eq(r.rows[0].category_slug, null, 'null category preserved');
    eq(Number(r.rows[0].venue_count), 1, 'still counted toward the cell');
  });

  await test('G: reports the most recent discovery timestamp for the cell', async () => {
    await clearVenues();
    await h.q(`delete from venue_discovery_candidates`);
    const museum = (await h.q(`select id from categories where slug='museum'`)).rows[0].id;
    await newVenue({ latitude: 52.5, longitude: -2.2, category_id: museum });
    await h.q(`insert into venue_discovery_candidates (latitude, longitude, created_at) values (52.5,-2.2,'2026-01-01T00:00:00Z')`);
    await h.q(`insert into venue_discovery_candidates (latitude, longitude, created_at) values (52.6,-2.3,'2026-06-01T00:00:00Z')`);
    const r = await h.q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows.length, 1, 'one row');
    eq(new Date(r.rows[0].last_discovered_at).toISOString(), '2026-06-01T00:00:00.000Z', 'newest timestamp in the cell');
  });

  await test('G: a cell never discovery-checked reports a NULL timestamp (not a fabricated one)', async () => {
    await clearVenues();
    await h.q(`delete from venue_discovery_candidates`);
    const museum = (await h.q(`select id from categories where slug='museum'`)).rows[0].id;
    await newVenue({ latitude: 55.5, longitude: -4.2, category_id: museum });
    const r = await h.q(`select * from enrichment_coverage_grid(1.0, 49.0, -8.7)`);
    eq(r.rows[0].last_discovered_at, null, 'null, not a default date');
  });

  await test('G: rejects a non-positive step rather than dividing by zero', async () => {
    await throws(h.q(`select * from enrichment_coverage_grid(0, 49.0, -8.7)`), /p_step_deg must be > 0/, 'zero step rejected');
    await throws(h.q(`select * from enrichment_coverage_grid(-1, 49.0, -8.7)`), /p_step_deg must be > 0/, 'negative step rejected');
  });

  await test('G: enrichment_coverage_grid is service_role only', async () => {
    await h.reset();
    const acl = await h.fnAcl('public.enrichment_coverage_grid(float,float,float)');
    assert(acl.exists, 'function must exist');
    eq(acl.anon, false, 'anon denied');
    eq(acl.authenticated, false, 'authenticated denied');
    eq(acl.service_role, true, 'service_role allowed');
  });

  console.log(`\n${state.passed} passed, ${state.failures.length} failed`);
  if (state.failures.length > 0) {
    for (const f of state.failures) console.error(`  FAILED: ${f.name} — ${f.message}`);
    process.exitCode = 1;
  }
  await db.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
