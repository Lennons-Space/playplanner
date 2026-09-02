// =============================================================================
// scripts/enrich/__tests__/releaseOnePublicationContract.test.ts
//
// RELEASE-ONE PRODUCT DECISION, asserted against the runtime source.
//
//   A newly discovered venue must never become publicly discoverable without a
//   named human admin deciding so.
//
// The real enforcement is in PostgreSQL — migration 061 drops
// auto_accept_candidate in both signatures, and no service_role-executable
// function contains INSERT INTO venues (proved by PART G of
// supabase/tests/enrichment_057_rebase_redline.mjs). A TypeScript flag is not
// a trust boundary and this file does not pretend otherwise.
//
// What these tests ARE for: making sure the runtime's expectation of the
// database matches the database we are actually going to promote. A script
// still calling auto_accept_candidate would fail at runtime with "function
// does not exist" — correct, but only discovered during a live run. This
// catches it in CI instead.
//
// Static source assertions only. Nothing is executed, no client is
// constructed, no network or database access occurs.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AUTONOMOUS = read('autonomous.ts');
const DISCOVER = read('discovery/discoverCandidates.ts');

describe('release one: the runtime never asks the database to auto-publish', () => {
  it('no source file under scripts/enrich calls the auto_accept_candidate RPC', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const src = fs.readFileSync(full, 'utf8');
        // The RPC call itself, not prose about it: rpc('auto_accept_candidate'.
        if (/rpc\(\s*['"`]auto_accept_candidate['"`]/.test(src)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });

  it('discovery apply-mode calls queue_candidate_for_review instead', () => {
    expect(AUTONOMOUS).toMatch(/rpc\(\s*'queue_candidate_for_review'/);
  });

  it('the discovery dependency is named for queueing, not accepting', () => {
    expect(DISCOVER).toMatch(/queueCandidateForReview\?:\s*\(candidateId: string\) => Promise<void>;/);
    expect(DISCOVER).not.toMatch(/autoAcceptCandidate\?:/);
  });

  it('the pipeline never writes a candidate status that means "published"', () => {
    // 'auto_accepted' was removed from the venue_discovery_candidates status
    // CHECK in migration 059; writing it would now fail the constraint. The
    // statuses the pipeline may set are the three non-terminal/rejected ones.
    expect(AUTONOMOUS).not.toMatch(/['"]auto_accepted['"]/);
    expect(AUTONOMOUS).toMatch(/d === 'quarantine' \? 'quarantined' : d === 'reject' \? 'rejected' : 'candidate'/);
  });

  it('the runtime goes through upsert_discovery_candidate, not a raw table upsert', () => {
    // R2 (pre-staging remediation, 2026-09-01): a raw
    // .from('venue_discovery_candidates').upsert(...) let rediscovery fight a
    // terminal human decision (migration 059's grant used to hand service_role
    // direct INSERT/UPDATE on the table). The only door now is this RPC.
    expect(AUTONOMOUS).toMatch(/rpc\(\s*'upsert_discovery_candidate'/);
    expect(AUTONOMOUS).not.toMatch(/from\(\s*'venue_discovery_candidates'\s*\)\s*\.\s*upsert/);
  });

  it('a terminal pipeline decision is stamped with a system actor and a time -- by the DATABASE, not the runtime', () => {
    // venue_discovery_candidates_terminal_audit_ck (059) rejects a terminal row
    // that does not say who decided and when. Before R2 the runtime computed
    // resolved_mode/reviewed_at itself and passed them in the upsert payload;
    // now upsert_discovery_candidate (061) computes both server-side for a
    // 'rejected' status (see supabase/tests/enrichment_057_rebase_redline.mjs
    // H27), so the runtime only needs to supply the human-readable reason.
    // Asserting the OLD client-side computation here would be asserting dead
    // code, not the actual audit-trail guarantee.
    expect(AUTONOMOUS).toMatch(/decision_reason:[\s\S]{0,120}acceptResult\.reason/);
    expect(AUTONOMOUS).not.toMatch(/resolved_mode:\s*candidateStatus/);
  });

  it('the operator-facing write-mode banner does not promise publication', () => {
    const banner = AUTONOMOUS.match(/Write mode\s+: \$\{flags\.apply \?[^}]*\}/s)?.[0] ?? '';
    expect(banner).toContain('queue_candidate_for_review');
    expect(banner).not.toContain('auto_accept_candidate');
    expect(banner).toMatch(/cannot publish a venue/i);
  });
});
