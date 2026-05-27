/**
 * venue-review/backfill.js
 *
 * TASK 1 — Venue quality backfill for PlayPlanner.
 *
 * Computes two independent scores per venue and upserts into venue_review_scores.
 * Never touches venue records.
 *
 * ── TWO-SCORE SYSTEM ──────────────────────────────────────────────────────────
 *
 *  discovery_score  "Is it safe to show this venue in map/search/list results?"
 *  trust_score      "Is this venue enriched enough for curated recommendations?"
 *
 * Public imports (OSM / bulk data) are scored leniently for discovery.
 * Missing pricing, hours, facilities, photos, and verification do NOT exclude
 * a public import from discovery — they only reduce trust_score.
 *
 * discovery_score (public_import):
 *   40 pts  base (venue exists with a real name)
 *   +20 pts has category
 *   +25 pts category is family-suitable (park, playground, museum, etc.)
 *   +10 pts has any description
 *   -10 pts no category
 *     0 pts instant-exclude: spam name, adult/gambling category, blank name
 *   Thresholds:
 *     >= 60  discovery_approved
 *     35–59  discovery_limited
 *      < 35  exclude
 *
 * trust_score (public_import):
 *   Description quality    0–20 pts
 *   Age range specificity  0–15 pts
 *   Category assigned      0–10 pts (+15 family bonus)
 *   Opening hours          0–05 pts  (enrichment signal)
 *   Approved photos        0–05 pts  (enrichment signal)
 *   Facilities tagged      0–05 pts  (enrichment signal)
 *   Contact info           0–03 pts  (enrichment signal)
 *   Pricing info           0–03 pts  (enrichment signal)
 *   Verified               +00 pts   (flag only)
 *   Max: ~81 pts
 *   Thresholds:
 *     >= 75  trusted_recommendation
 *     55–74  needs_enrichment
 *      < 55  not_trusted_yet
 *
 * business_submission:
 *   Strict single score (same as trust_score, full 100 pts).
 *   discovery values mirror trust values.
 *
 * Launch rule (enforced by app logic, documented here for clarity):
 *   Search/map discovery  → discovery_approved + discovery_limited
 *   Find Something For Us → trusted_recommendation only (or manually curated)
 *
 * Prerequisites:
 *   - Migrations 041, 042, 043 applied
 *   - SUPABASE_URL and SUPABASE_SERVICE_KEY set (terminal or scripts/.env)
 *
 * Run: node scripts/venue-review/backfill.js
 */

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

if (!SUPABASE_URL)         throw new Error('Missing SUPABASE_URL. Set via terminal or scripts/.env');
if (!SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY. Set via terminal: $env:SUPABASE_SERVICE_KEY="eyJ..."');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Category classification ────────────────────────────────────────────────────

const FAMILY_KEYWORDS = [
  'park', 'playground', 'soft play', 'softplay',
  'museum', 'gallery', 'science centre', 'science center',
  'farm', 'zoo', 'aquarium', 'wildlife',
  'library',
  'swimming', 'swim', 'pool', 'lido',
  'leisure centre', 'leisure center', 'sports centre', 'sports center',
  'nature trail', 'nature reserve', 'country park', 'woodland', 'forest',
  'visitor centre', 'visitor center', 'heritage',
  'theatre', 'theater', 'pantomime',
  'family activity', 'family entertainment',
  'adventure', 'climbing wall', 'trampoline',
  'bowling', 'mini golf', 'crazy golf',
  'beach', 'seaside', 'coastal',
  'castle', 'historic', 'monument',
];

const EXCLUDE_KEYWORDS = [
  'adult entertainment', 'adult club', 'casino', 'gambling',
  'nightclub', 'night club', 'strip club', 'strip bar',
  'betting shop', 'erotic', 'sex shop',
];

const SPAM_PATTERNS = [
  /^test\b/i, /\btest venue\b/i, /\btest soft play\b/i,
  /^xxx/i, /^sample\b/i, /^dummy\b/i, /^fake\b/i,
];

function isFamilyCategory(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return FAMILY_KEYWORDS.some(kw => lower.includes(kw));
}

function isExcludeCategory(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return EXCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

function isSpamVenue(name) {
  if (!name || !name.trim()) return true;
  return SPAM_PATTERNS.some(p => p.test(name.trim()));
}

// ── Scoring helpers ────────────────────────────────────────────────────────────

function scoreDescription(description) {
  if (!description || description.trim().length < 10) return 0;
  const len = description.trim().length;
  if (len >= 200) return 20;
  if (len >= 100) return 15;
  if (len >= 50)  return 10;
  return 5;
}

function scoreAgeRange(minAge, maxAge) {
  // Default schema values (min=0, max=12) mean the operator never set them.
  if (minAge === 0 && maxAge === 12) return 0;
  return 15;
}

// ── Discovery score (public imports only) ─────────────────────────────────────
//
// Answers: "Is this venue safe and meaningful to show in discovery?"
// Excluded only for spam, adult/gambling categories, or blank name.
// Missing enrichment data has NO impact here.

function computeDiscoveryScore(venue, categoryName) {
  const discFlags = [];

  if (isSpamVenue(venue.name)) {
    return { score: 0, flags: ['spam_or_test_venue'] };
  }
  if (isExcludeCategory(categoryName)) {
    return { score: 0, flags: ['adult_or_gambling_category'] };
  }

  let score = 40; // baseline: exists in DB with a real name

  if (venue.category_id) {
    score += 20;
    if (isFamilyCategory(categoryName)) {
      score += 25;
    }
  } else {
    score -= 10;
    discFlags.push('missing_category');
  }

  if (venue.description && venue.description.trim().length >= 10) {
    score += 10;
  }

  return { score: Math.min(100, Math.max(0, score)), flags: discFlags };
}

function toDiscoveryRecommendation(score) {
  if (score >= 60) return 'discovery_approved';
  if (score >= 35) return 'discovery_limited';
  return 'exclude';
}

// ── Trust score ────────────────────────────────────────────────────────────────
//
// Answers: "Is this venue enriched enough for curated recommendations?"
// Public imports: reduced weight for enrichment fields (flag-only approach).
// Business submissions: full 100-pt scale.

function computeTrustScore(venue, hasHours, facCount, photoCount, categoryName, isPublic) {
  const flags = [];
  let score   = 0;

  // Description (same weight both modes)
  const descScore = scoreDescription(venue.description);
  score += descScore;
  if (descScore === 0)     flags.push('missing_description');
  else if (descScore < 15) flags.push('weak_description');

  // Pricing
  if (venue.price_range) {
    score += isPublic ? 3 : 10;
  } else {
    flags.push('missing_pricing');
  }

  // Opening hours
  if (hasHours) {
    score += isPublic ? 5 : 15;
  } else {
    flags.push('missing_opening_hours');
  }

  // Age range (same weight both modes)
  const ageScore = scoreAgeRange(venue.min_age, venue.max_age);
  score += ageScore;
  if (ageScore === 0) flags.push('missing_age_range');

  // Category + family suitability bonus
  if (venue.category_id) {
    score += 10;
    if (isPublic && isFamilyCategory(categoryName)) score += 15;
  } else {
    flags.push('missing_category');
  }

  // Facilities
  if (isPublic) {
    const fs = facCount >= 2 ? 5 : facCount === 1 ? 2 : 0;
    score += fs;
    if (fs === 0) flags.push('missing_facilities');
  } else {
    const fs = facCount >= 2 ? 10 : facCount === 1 ? 5 : 0;
    score += fs;
    if (fs === 0) flags.push('missing_facilities');
  }

  // Photos
  if (isPublic) {
    const ps = photoCount >= 2 ? 5 : photoCount === 1 ? 2 : 0;
    score += ps;
    if (ps === 0) flags.push('no_photos');
  } else {
    const ps = photoCount >= 2 ? 10 : photoCount === 1 ? 5 : 0;
    score += ps;
    if (ps === 0) flags.push('no_photos');
  }

  // Contact info
  if (venue.phone || venue.website || venue.email) {
    score += isPublic ? 3 : 5;
  } else {
    flags.push('no_contact_info');
  }

  // Verification — public imports: flag only, no penalty
  if (venue.is_verified) {
    if (!isPublic) score += 5;
  } else {
    flags.push('unverified');
  }

  return { score: Math.max(0, score), flags };
}

function toTrustRecommendation(score) {
  if (score >= 75) return 'trusted_recommendation';
  if (score >= 55) return 'needs_enrichment';
  return 'not_trusted_yet';
}

// ── Reason builder ─────────────────────────────────────────────────────────────

function buildReason(venue, hasHours, facCount, photoCount, categoryName, trustFlags) {
  const descScore = scoreDescription(venue.description);
  const ageScore  = scoreAgeRange(venue.min_age, venue.max_age);

  const positives = [];
  if (descScore >= 15)   positives.push('good description');
  if (venue.price_range) positives.push('pricing listed');
  if (hasHours)          positives.push('opening hours set');
  if (ageScore > 0)      positives.push('age range specified');
  if (venue.category_id) {
    positives.push('category assigned');
    if (isFamilyCategory(categoryName)) positives.push(`family category (${categoryName})`);
  }
  if (facCount >= 2)  positives.push('facilities tagged');
  if (photoCount >= 1) positives.push('photos approved');

  const flagSet  = new Set(trustFlags);
  const negatives = [];
  if (flagSet.has('missing_description'))  negatives.push('no description');
  if (flagSet.has('weak_description'))      negatives.push('description too short');
  if (flagSet.has('missing_pricing'))       negatives.push('no pricing');
  if (flagSet.has('missing_opening_hours')) negatives.push('no opening hours');
  if (flagSet.has('missing_age_range'))     negatives.push('age range at defaults');
  if (flagSet.has('missing_category'))      negatives.push('no category');
  if (flagSet.has('missing_facilities'))    negatives.push('no facilities');
  if (flagSet.has('no_photos'))             negatives.push('no approved photos');
  if (flagSet.has('no_contact_info'))       negatives.push('no contact info');

  const parts = [];
  if (positives.length) parts.push(`Strengths: ${positives.join(', ')}.`);
  if (negatives.length) parts.push(`Missing: ${negatives.join(', ')}.`);
  return parts.join(' ') || 'No data available.';
}

// ── Master review function ─────────────────────────────────────────────────────

function reviewVenue(venue, hasHours, facCount, photoCount, categoryName) {
  const reviewMode = venue.submitted_by ? 'business_submission' : 'public_import';
  const isPublic   = reviewMode === 'public_import';

  if (isPublic) {
    const discovery = computeDiscoveryScore(venue, categoryName);
    const discRec   = toDiscoveryRecommendation(discovery.score);

    const trust    = computeTrustScore(venue, hasHours, facCount, photoCount, categoryName, true);
    const trustRec = toTrustRecommendation(trust.score);

    // Merge discovery + trust flags (deduplicated)
    const allFlags = [...new Set([...discovery.flags, ...trust.flags])];

    const reason = buildReason(venue, hasHours, facCount, photoCount, categoryName, trust.flags);

    // Legacy columns → discovery values (admin dashboard can use these as before)
    const legacyScore = discovery.score;
    const legacyRec   = discRec === 'discovery_approved' ? 'approve'
                      : discRec === 'discovery_limited'  ? 'needs_review'
                      :                                    'reject';

    return {
      score:                    legacyScore,
      recommendation:           legacyRec,
      flags:                    allFlags,
      reason,
      reviewMode,
      discoveryScore:           discovery.score,
      discoveryRecommendation:  discRec,
      trustScore:               trust.score,
      trustRecommendation:      trustRec,
    };

  } else {
    // Business submissions: single enrichment score, used for both discovery + trust
    const trust    = computeTrustScore(venue, hasHours, facCount, photoCount, categoryName, false);
    const trustRec = toTrustRecommendation(trust.score);

    // Legacy recommendation using business thresholds
    let legacyRec;
    if      (trust.score >= 75) legacyRec = 'approve';
    else if (trust.score >= 55) legacyRec = 'needs_review';
    else if (trust.score >= 35) legacyRec = 'hide_until_fixed';
    else                        legacyRec = 'reject';

    // Discovery mirrors trust for business submissions
    const discScore = trust.score;
    const discRec   = trust.score >= 60 ? 'discovery_approved'
                    : trust.score >= 35 ? 'discovery_limited'
                    :                     'exclude';

    const reason = buildReason(venue, hasHours, facCount, photoCount, categoryName, trust.flags);

    return {
      score:                    trust.score,
      recommendation:           legacyRec,
      flags:                    trust.flags,
      reason,
      reviewMode,
      discoveryScore:           discScore,
      discoveryRecommendation:  discRec,
      trustScore:               trust.score,
      trustRecommendation:      trustRec,
    };
  }
}

// ── Suggested fixes (action list) ─────────────────────────────────────────────

const FLAG_FIX = {
  missing_pricing:       'Add pricing or mark as "free"',
  missing_age_range:     'Set specific age suitability (e.g. 0–5)',
  weak_description:      'Expand description with parent-focused detail (parking, facilities, age suitability)',
  missing_description:   'Add a meaningful description for parents',
  missing_opening_hours: 'Add opening times',
  missing_facilities:    'Tag parent facilities: toilets, baby changing, parking, café',
  no_photos:             'Upload at least one approved photo',
  no_contact_info:       'Add phone, website, or email',
  missing_category:      'Assign the correct venue category',
  unverified:            'Claim and verify this listing',
  spam_or_test_venue:    'Remove or fix this test/spam entry',
  adult_or_gambling_category: 'Recategorise or remove — not family-suitable',
};

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('PlayPlanner — Venue Quality Backfill (v3 — discovery + trust)');
  console.log('=================================================================\n');

  console.log('Fetching venue data...');

  // Venues (paginated, service role bypasses RLS)
  const allVenues = [];
  let page = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('venues')
      .select(
        'id, name, description, category_id, price_range, min_age, max_age, ' +
        'is_verified, phone, website, email, submitted_by, ' +
        'review_count, average_rating, moderation_status, is_published'
      )
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .order('id');

    if (error) { console.error('Failed to fetch venues:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allVenues.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  console.log(`  ${allVenues.length} venues loaded.`);

  // Categories → id-to-name map
  const { data: catRows, error: catErr } = await supabase
    .from('categories')
    .select('id, name');

  if (catErr) { console.error('Failed to fetch categories:', catErr.message); process.exit(1); }

  const categoryNameMap = new Map((catRows || []).map(c => [c.id, c.name]));
  console.log(`  ${categoryNameMap.size} categories loaded.`);

  // Opening hours — set of venue_ids that have any row
  const { data: hoursRows, error: hoursErr } = await supabase
    .from('opening_hours')
    .select('venue_id');

  if (hoursErr) { console.error('Failed to fetch opening_hours:', hoursErr.message); process.exit(1); }

  const venueHasHours = new Set((hoursRows || []).map(r => r.venue_id));

  // Facilities — count per venue_id
  const { data: facRows, error: facErr } = await supabase
    .from('venue_facilities')
    .select('venue_id');

  if (facErr) { console.error('Failed to fetch venue_facilities:', facErr.message); process.exit(1); }

  const facilityCount = new Map();
  for (const row of (facRows || [])) {
    facilityCount.set(row.venue_id, (facilityCount.get(row.venue_id) || 0) + 1);
  }

  // Approved photos — count per venue_id
  const { data: photoRows, error: photoErr } = await supabase
    .from('venue_photos')
    .select('venue_id')
    .eq('status', 'approved');

  if (photoErr) { console.error('Failed to fetch venue_photos:', photoErr.message); process.exit(1); }

  const photoCount = new Map();
  for (const row of (photoRows || [])) {
    photoCount.set(row.venue_id, (photoCount.get(row.venue_id) || 0) + 1);
  }

  // ── Score every venue ────────────────────────────────────────────────────
  console.log('Scoring venues...');

  const scored = allVenues.map(venue => {
    const result = reviewVenue(
      venue,
      venueHasHours.has(venue.id),
      facilityCount.get(venue.id) || 0,
      photoCount.get(venue.id)    || 0,
      categoryNameMap.get(venue.category_id) || null,
    );
    return { venue, ...result };
  });

  // ── Upsert results ────────────────────────────────────────────────────────
  console.log('Writing scores to venue_review_scores...');

  const BATCH = 100;
  let upserted = 0;

  for (let i = 0; i < scored.length; i += BATCH) {
    const batch = scored.slice(i, i + BATCH).map(s => ({
      venue_id:                 s.venue.id,
      score:                    s.score,
      recommendation:           s.recommendation,
      flags:                    s.flags,
      reason:                   s.reason,
      review_mode:              s.reviewMode,
      discovery_score:          s.discoveryScore,
      discovery_recommendation: s.discoveryRecommendation,
      trust_score:              s.trustScore,
      trust_recommendation:     s.trustRecommendation,
      reviewed_at:              new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('venue_review_scores')
      .upsert(batch, { onConflict: 'venue_id' });

    if (error) {
      console.error(`Upsert failed (batch ${i}–${i + BATCH}):`, error.message);
      process.exit(1);
    }

    upserted += batch.length;
    process.stdout.write(`\r  ${upserted}/${scored.length} upserted`);
  }

  console.log('\n');

  // ── Summary ───────────────────────────────────────────────────────────────
  const modeCounts = { public_import: 0, business_submission: 0 };
  const discCounts = { discovery_approved: 0, discovery_limited: 0, exclude: 0 };
  const trustCounts = { trusted_recommendation: 0, needs_enrichment: 0, not_trusted_yet: 0 };
  const flagCounter = new Map();

  for (const s of scored) {
    modeCounts[s.reviewMode]++;
    discCounts[s.discoveryRecommendation]++;
    trustCounts[s.trustRecommendation]++;
    for (const f of s.flags) {
      flagCounter.set(f, (flagCounter.get(f) || 0) + 1);
    }
  }

  const topFlags = [...flagCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([flag, count]) => ({ flag, count }));

  const summary = {
    total_venues:           scored.length,
    public_imports:         modeCounts.public_import,
    business_submissions:   modeCounts.business_submission,
    discovery: {
      approved:  discCounts.discovery_approved,
      limited:   discCounts.discovery_limited,
      excluded:  discCounts.exclude,
    },
    trust: {
      trusted:          trustCounts.trusted_recommendation,
      needs_enrichment: trustCounts.needs_enrichment,
      not_trusted_yet:  trustCounts.not_trusted_yet,
    },
    top_flags: topFlags,
  };

  console.log('=== BACKFILL SUMMARY (v3) ===\n');
  console.log(JSON.stringify(summary, null, 2));

  // ── Top 10 worst / best by trust_score ───────────────────────────────────
  const sortedByTrust = [...scored].sort((a, b) => a.trustScore - b.trustScore);

  console.log('\n=== TOP 10 WORST (lowest trust_score) ===\n');
  sortedByTrust.slice(0, 10).forEach((s, i) => {
    console.log(`${i + 1}. [${s.reviewMode}] ${s.venue.name}`);
    console.log(`   Discovery: ${s.discoveryScore}  (${s.discoveryRecommendation})`);
    console.log(`   Trust:     ${s.trustScore}  (${s.trustRecommendation})`);
    console.log(`   Flags: ${s.flags.join(', ') || 'none'}`);
    console.log('');
  });

  console.log('=== TOP 10 BEST (highest trust_score) ===\n');
  sortedByTrust.slice(-10).reverse().forEach((s, i) => {
    console.log(`${i + 1}. [${s.reviewMode}] ${s.venue.name}`);
    console.log(`   Discovery: ${s.discoveryScore}  (${s.discoveryRecommendation})`);
    console.log(`   Trust:     ${s.trustScore}  (${s.trustRecommendation})`);
    console.log(`   Reason: ${s.reason}`);
    console.log('');
  });

  // ── Action list: business submissions not yet approved ────────────────────
  const actionList = scored
    .filter(s => s.reviewMode === 'business_submission' && s.trustScore < 75)
    .sort((a, b) => a.trustScore - b.trustScore)
    .map(s => ({
      venue_id:             s.venue.id,
      name:                 s.venue.name,
      trust_score:          s.trustScore,
      trust_recommendation: s.trustRecommendation,
      flags:                s.flags,
      suggested_fix:        s.flags.map(f => FLAG_FIX[f] || f).join(' | '),
    }));

  console.log(`\n=== BUSINESS SUBMISSION ACTION LIST (${actionList.length} below trusted) ===\n`);
  if (actionList.length > 0) {
    console.log(JSON.stringify(actionList.slice(0, 50), null, 2));
    if (actionList.length > 50) {
      console.log(`\n... and ${actionList.length - 50} more. Full list in venue_review_scores table.`);
    }
  } else {
    console.log('All business submissions are trusted_recommendation.');
  }

  console.log('\nBackfill complete.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
