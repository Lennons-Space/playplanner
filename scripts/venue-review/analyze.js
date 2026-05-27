'use strict';

const fs   = require('fs');
const path = require('path');

const dotenvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL)         throw new Error('Missing SUPABASE_URL. Set it via terminal or scripts/.env');
if (!SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY. Set it via terminal: $env:SUPABASE_SERVICE_KEY="eyJ..."');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // ── Fetch all scores ──────────────────────────────────────────────────────
  const allRows = [];
  let page = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('venue_review_scores')
      .select(`
        venue_id,
        score,
        recommendation,
        flags,
        reason,
        review_mode,
        discovery_score,
        discovery_recommendation,
        trust_score,
        trust_recommendation,
        venues ( name )
      `)
      .range(page * PAGE, (page + 1) * PAGE - 1)
      .order('trust_score');

    if (error) { console.error('Fetch error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    page++;
  }

  const total = allRows.length;
  if (total === 0) {
    console.log(JSON.stringify({ error: 'venue_review_scores table is empty — run the backfill first.' }));
    return;
  }

  // ── 1. Summary counts ─────────────────────────────────────────────────────
  const modeCounts  = { public_import: 0, business_submission: 0 };
  const discCounts  = { discovery_approved: 0, discovery_limited: 0, exclude: 0 };
  const trustCounts = { trusted_recommendation: 0, needs_enrichment: 0, not_trusted_yet: 0 };

  for (const r of allRows) {
    modeCounts[r.review_mode]  = (modeCounts[r.review_mode]  || 0) + 1;
    discCounts[r.discovery_recommendation  ?? 'exclude']    = (discCounts[r.discovery_recommendation  ?? 'exclude'] || 0) + 1;
    trustCounts[r.trust_recommendation ?? 'not_trusted_yet'] = (trustCounts[r.trust_recommendation ?? 'not_trusted_yet'] || 0) + 1;
  }

  const summary = {
    total_venues:         total,
    public_imports:       modeCounts.public_import        || 0,
    business_submissions: modeCounts.business_submission  || 0,
    discovery: {
      approved:  discCounts.discovery_approved || 0,
      limited:   discCounts.discovery_limited  || 0,
      excluded:  discCounts.exclude            || 0,
      pct_in_discovery: parseFloat(
        (((discCounts.discovery_approved + discCounts.discovery_limited) / total) * 100).toFixed(1)
      ),
    },
    trust: {
      trusted:          trustCounts.trusted_recommendation || 0,
      needs_enrichment: trustCounts.needs_enrichment       || 0,
      not_trusted_yet:  trustCounts.not_trusted_yet        || 0,
      pct_trusted:      parseFloat(((trustCounts.trusted_recommendation / total) * 100).toFixed(1)),
    },
  };

  // ── 2. Quality thresholds ─────────────────────────────────────────────────
  const discBelow60  = allRows.filter(r => (r.discovery_score ?? 0) < 60).length;
  const discBelow35  = allRows.filter(r => (r.discovery_score ?? 0) < 35).length;
  const trustBelow75 = allRows.filter(r => (r.trust_score     ?? 0) < 75).length;
  const trustBelow55 = allRows.filter(r => (r.trust_score     ?? 0) < 55).length;

  const thresholds = {
    discovery_below_60:          discBelow60,
    discovery_below_35_excluded: discBelow35,
    pct_discovery_below_60:      parseFloat(((discBelow60 / total) * 100).toFixed(1)),
    pct_excluded:                parseFloat(((discBelow35 / total) * 100).toFixed(1)),
    trust_below_75:              trustBelow75,
    trust_below_55:              trustBelow55,
    pct_trust_below_75:          parseFloat(((trustBelow75 / total) * 100).toFixed(1)),
    pct_trust_below_55:          parseFloat(((trustBelow55 / total) * 100).toFixed(1)),
  };

  // ── 3. Top flags ──────────────────────────────────────────────────────────
  const flagCounter = new Map();
  for (const r of allRows) {
    for (const f of (r.flags || [])) {
      flagCounter.set(f, (flagCounter.get(f) || 0) + 1);
    }
  }
  const top_flags = [...flagCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([flag, count]) => ({ flag, count }));

  // ── 4. Worst 20 venues by trust_score ────────────────────────────────────
  const worst_venues = allRows.slice(0, 20).map(r => ({
    venue_id:                 r.venue_id,
    name:                     r.venues?.name ?? '(unknown)',
    review_mode:              r.review_mode,
    discovery_score:          r.discovery_score,
    discovery_recommendation: r.discovery_recommendation,
    trust_score:              r.trust_score,
    trust_recommendation:     r.trust_recommendation,
    flags:                    r.flags,
    reason:                   r.reason,
  }));

  // ── 5. Best 20 venues by trust_score ─────────────────────────────────────
  const best_venues = [...allRows]
    .sort((a, b) => (b.trust_score ?? 0) - (a.trust_score ?? 0))
    .slice(0, 20)
    .map(r => ({
      venue_id:                 r.venue_id,
      name:                     r.venues?.name ?? '(unknown)',
      review_mode:              r.review_mode,
      discovery_score:          r.discovery_score,
      discovery_recommendation: r.discovery_recommendation,
      trust_score:              r.trust_score,
      trust_recommendation:     r.trust_recommendation,
      reason:                   r.reason,
    }));

  // ── 6. Problem groups (venues below discovery threshold or low trust) ─────
  const publicRows     = allRows.filter(r => r.review_mode === 'public_import');
  const businessRows   = allRows.filter(r => r.review_mode === 'business_submission');
  const excludedRows   = allRows.filter(r => r.discovery_recommendation === 'exclude');
  const untrustedPub   = publicRows.filter(r => (r.trust_score ?? 0) < 55);

  const problem_groups = {
    excluded_from_discovery:      excludedRows.length,
    public_not_trusted_yet:       publicRows.filter(r => r.trust_recommendation === 'not_trusted_yet').length,
    public_needs_enrichment:      publicRows.filter(r => r.trust_recommendation === 'needs_enrichment').length,
    business_not_trusted:         businessRows.filter(r => r.trust_recommendation !== 'trusted_recommendation').length,
  };

  // Flag frequency breakdown for excluded venues
  const excludedFlagCounter = new Map();
  for (const r of excludedRows) {
    for (const f of (r.flags || [])) {
      excludedFlagCounter.set(f, (excludedFlagCounter.get(f) || 0) + 1);
    }
  }
  problem_groups.excluded_top_flags = [...excludedFlagCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  // Trust gap: public imports that are discovery_approved but not trusted yet
  problem_groups.discoverable_but_not_trusted = publicRows.filter(
    r => r.discovery_recommendation === 'discovery_approved' && r.trust_recommendation === 'not_trusted_yet'
  ).length;

  // ── 7. Key insights ───────────────────────────────────────────────────────
  const discPct    = summary.discovery.pct_in_discovery;
  const trustedPct = summary.trust.pct_trusted;
  const topFlag    = top_flags[0]?.flag ?? 'none';
  const topFlagPct = parseFloat(((top_flags[0]?.count ?? 0) / total * 100).toFixed(1));

  let datasetHealth;
  if (discPct >= 90 && trustedPct >= 20)  datasetHealth = 'good — healthy discovery pool, enrichment ongoing';
  else if (discPct >= 70)                  datasetHealth = 'mixed — most venues discoverable, low trust enrichment';
  else                                     datasetHealth = 'poor — large discovery gap, major data quality issue';

  const insights = [
    `${discPct}% of venues (${summary.discovery.approved + summary.discovery.limited}/${total}) are available for discovery (approved + limited)`,
    `${trustedPct}% of venues (${summary.trust.trusted}/${total}) are trusted enough for curated recommendations`,
    `${problem_groups.discoverable_but_not_trusted} public import venues appear in discovery but are not yet trusted — primary enrichment target`,
    `Biggest trust gap: "${topFlag}" affects ${top_flags[0]?.count ?? 0}/${total} venues (${topFlagPct}%)`,
    `Dataset health: ${datasetHealth}`,
  ];

  // ── Output ────────────────────────────────────────────────────────────────
  const result = { summary, thresholds, top_flags, worst_venues, best_venues, problem_groups, insights };
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
