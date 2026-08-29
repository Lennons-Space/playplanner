// =============================================================================
// supabase/tests/migration_history_layout.mjs
//
// Structural regression guard for the Supabase migration directory layout.
//
// This is a FILENAME-ONLY test. It opens no database, reads no SQL body, and
// needs no network — it exists because the failure it guards against was
// structural, not behavioural: two branches independently allocated version
// "057", the CLI matched them by version string alone (it never compares names
// and never checksums content), and nothing anywhere warned that the repo held
// a different 057 from the one production had actually run.
//
// It also pins the two other outcomes of the 2026-08 reconciliation: the
// unapplied enrichment drafts stay OUT of CLI discovery, and no future
// migration resumes sequential numbering.
//
// See supabase/migrations/README.md for the rules this enforces.
//
// Run:  node supabase/tests/migration_history_layout.mjs   (part of npm run test:db)
// =============================================================================

import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIVE_DIR = join(__dirname, '../migrations');
const DRAFTS_DIR = join(__dirname, '../migrations_drafts');

// ── The reconciliation set ────────────────────────────────────────────────────
// Every three-digit version that legitimately existed when migration history was
// reconciled in 2026-08. This list is CLOSED: it must never grow. A new numbered
// migration is exactly the mistake this file exists to catch.
const LEGACY_NUMBERED = Object.freeze([
  '001', '002', '003', '004', '005', '006', '007', '008', '009', '010',
  '011', '012', '013', '014', '015', '016', '017', '018', '019', '020',
  '021', '022', '023', '024', '025', '026', '027', '028', '029', '030',
  '031', '032', '033', '034', '035', '036', '037', '038', '039', '040',
  '041', '042', '043', '044', '045', '046', '047', '048', '049', '050',
  '051', '052', '053', '054', '055', '056', '057', '058',
  '062', '063', '064', '065', '066', '067',
]);

// The seven versions production ran under a CLI-generated timestamp name before
// the identical SQL was committed under a numbered name. Each has a comments-only
// placeholder here so local and remote history stay aligned.
const HISTORICAL_PLACEHOLDERS = Object.freeze([
  '20260605211756_security_hardening.sql',
  '20260605212043_revoke_public_execute.sql',
  '20260606142242_049_venue_enrichment.sql',
  '20260607225234_account_deletion_photo_cleanup.sql',
  '20260607225535_account_deletion_claimed_by_cleanup.sql',
  '20260609004736_054_fix_reviews_rls_recursion.sql',
  '20260619200353_055_venue_photos_venue_id_index.sql',
]);

const UNAPPLIED_DRAFTS = Object.freeze([
  '059_enrichment_autonomy.sql',
  '060_enrichment_2_1.sql',
  '061_enrichment_review_paths.sql',
]);

const TIMESTAMP_VERSION = /^\d{14}$/;

// ── Version extraction ────────────────────────────────────────────────────────
// The version is the ENTIRE prefix before the FIRST underscore. This matches how
// the Supabase CLI derives a version, and it is why
// "20260606142242_049_venue_enrichment.sql" is version "20260606142242" and not
// "20260606142242_049".
function versionOf(filename) {
  const i = filename.indexOf('_');
  return i === -1 ? filename.replace(/\.sql$/, '') : filename.slice(0, i);
}

const activeFiles = readdirSync(ACTIVE_DIR).filter((f) => f.endsWith('.sql')).sort();

// ── Tiny assert harness (same shape as the other supabase/tests files) ────────
let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures.push({ name, message: e?.message ?? String(e) });
    console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('\nMigration history layout — structural guard (filenames only, no database)\n');

// ── H. version extraction ─────────────────────────────────────────────────────
test('H. a version is the whole prefix before the FIRST underscore', () => {
  eq(versionOf('057_enrichment_auto_decision.sql'), '057');
  eq(versionOf('20260801213434_facility_votes_select_own.sql'), '20260801213434');
  eq(
    versionOf('20260606142242_049_venue_enrichment.sql'),
    '20260606142242',
    'a placeholder whose description itself starts with a number must not leak into the version',
  );
});

// ── A. no duplicate versions ──────────────────────────────────────────────────
test('A. no two active migrations share a version prefix', () => {
  assert(activeFiles.length > 0, 'no .sql files found in supabase/migrations');
  const seen = new Map();
  const dupes = [];
  for (const f of activeFiles) {
    const v = versionOf(f);
    if (seen.has(v)) dupes.push(`${v}: ${seen.get(v)} vs ${f}`);
    else seen.set(v, f);
  }
  eq(dupes.length, 0, `duplicate migration versions found -> ${dupes.join('; ')}`);
});

// ── B. drafts are not discoverable by the CLI ─────────────────────────────────
test('B. the unapplied enrichment drafts are NOT in supabase/migrations', () => {
  const leaked = UNAPPLIED_DRAFTS.filter((f) => activeFiles.includes(f));
  eq(
    leaked.length,
    0,
    `unapplied drafts are visible to \`supabase db push --include-all\` -> ${leaked.join(', ')}`,
  );
});

// ── C. drafts are preserved where they belong ─────────────────────────────────
test('C. the unapplied enrichment drafts DO exist in supabase/migrations_drafts', () => {
  const missing = UNAPPLIED_DRAFTS.filter((f) => !existsSync(join(DRAFTS_DIR, f)));
  eq(missing.length, 0, `draft migration missing from migrations_drafts -> ${missing.join(', ')}`);
});

// ── D. version 057 is the migration production actually ran ───────────────────
test('D. active version 057 is exactly 057_enrichment_auto_decision.sql', () => {
  const at057 = activeFiles.filter((f) => versionOf(f) === '057');
  eq(at057.length, 1, `expected exactly one file at version 057, got ${JSON.stringify(at057)}`);
  eq(
    at057[0],
    '057_enrichment_auto_decision.sql',
    'version 057 in production is enrichment_auto_decision (32 statements, incl. the reviewed_by ON DELETE SET NULL repair)',
  );
});

// ── E. the facility-vote migration keeps its timestamp identity ───────────────
test('E. the facility-vote migration is 20260801213434_facility_votes_select_own.sql', () => {
  assert(
    activeFiles.includes('20260801213434_facility_votes_select_own.sql'),
    'facility-vote migration missing or renamed',
  );
  const strays = activeFiles.filter((f) => f.includes('facility_votes_select_own'));
  eq(strays.length, 1, `expected exactly one facility-vote migration, got ${JSON.stringify(strays)}`);
});

// ── F. no new sequential numbering ────────────────────────────────────────────
test('F. every active version is either a known legacy number or a 14-digit timestamp', () => {
  const offenders = activeFiles
    .map((f) => ({ f, v: versionOf(f) }))
    .filter(({ v }) => !LEGACY_NUMBERED.includes(v) && !TIMESTAMP_VERSION.test(v));
  eq(
    offenders.length,
    0,
    `new migrations must use YYYYMMDDHHMMSS_description.sql (see supabase/migrations/README.md) -> ${offenders
      .map((o) => o.f)
      .join(', ')}`,
  );
});

test('F2. sequential numbering has not resumed at 068/069/...', () => {
  const resumed = activeFiles.filter((f) => {
    const v = versionOf(f);
    return /^\d{3}$/.test(v) && !LEGACY_NUMBERED.includes(v);
  });
  eq(
    resumed.length,
    0,
    `sequential numbering must never resume — a numbered version sorts BEFORE every applied 2026… version and forces \`db push --include-all\` -> ${resumed.join(', ')}`,
  );
});

// ── G. the historical timestamp placeholders are all present ──────────────────
test('G. all seven historical timestamp placeholders exist', () => {
  const missing = HISTORICAL_PLACEHOLDERS.filter((f) => !activeFiles.includes(f));
  eq(
    missing.length,
    0,
    `without a local file at these versions the CLI reports remote-only migrations and refuses to push -> ${missing.join(', ')}`,
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
