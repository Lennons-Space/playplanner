-- ============================================================
-- Venue discovery_approved — validation / observability queries
-- ============================================================
-- Run these in the Supabase SQL editor (read-only) BEFORE and AFTER applying
-- migrations 044 + 045. None of these queries modify data.
--
-- Purpose:
--   1. Confirm the backfill flipped the right venues.
--   2. Confirm no high-quality / live venues were accidentally hidden.
--   3. Confirm obvious junk (spam / adult / gambling / uncategorised) IS hidden.
--   4. Confirm the discovery candidate pool is still healthy (broad UK coverage).
--
-- Reading the results:
--   discovery_approved = true   -> appears in map / search / detail
--   discovery_approved = false  -> hidden from discovery (NOT deleted)
-- ============================================================


-- ── 0. BEFORE migration: does the column already exist? ───────────────────────
-- If this returns a row, 044 has already been applied.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'venues' AND column_name = 'discovery_approved';


-- ── 1. Headline counts: approved vs excluded ─────────────────────────────────
SELECT
  count(*)                                            AS total_venues,
  count(*) FILTER (WHERE discovery_approved)          AS approved,
  count(*) FILTER (WHERE NOT discovery_approved)      AS excluded,
  round(100.0 * count(*) FILTER (WHERE NOT discovery_approved) / nullif(count(*),0), 2)
                                                      AS pct_excluded
FROM venues;
-- EXPECT: pct_excluded small (single digits). The backfill only excludes the
-- 'exclude' bucket (spam / adult / gambling / no-category / malformed).


-- ── 2. Cross-tab: discovery_approved vs the review recommendation ────────────
-- This is the integrity check — it must line up exactly with the backfill rule.
SELECT
  vrs.discovery_recommendation,
  v.discovery_approved,
  count(*) AS venues
FROM venues v
JOIN venue_review_scores vrs ON vrs.venue_id = v.id
GROUP BY vrs.discovery_recommendation, v.discovery_approved
ORDER BY vrs.discovery_recommendation, v.discovery_approved;
-- EXPECT (no other combinations):
--   discovery_approved  -> discovery_approved = true
--   discovery_limited   -> discovery_approved = true
--   exclude             -> discovery_approved = false


-- ── 3. Counts by trust recommendation (untouched — sanity only) ──────────────
SELECT
  trust_recommendation,
  count(*) AS venues
FROM venue_review_scores
GROUP BY trust_recommendation
ORDER BY venues DESC;
-- EXPECT: same as before migration — trust scoring is NOT modified here.


-- ── 4. Sample of EXCLUDED venues (eyeball the junk) ──────────────────────────
SELECT
  v.id, v.name, v.city,
  c.name AS category,
  vrs.discovery_score,
  vrs.flags
FROM venues v
LEFT JOIN categories c ON c.id = v.category_id
JOIN venue_review_scores vrs ON vrs.venue_id = v.id
WHERE v.discovery_approved = false
ORDER BY vrs.discovery_score ASC
LIMIT 50;
-- EXPECT: spam/test names, adult/gambling categories, or NULL category rows.
-- RED FLAG: if you see a clearly good family venue here, investigate before
-- applying to production (see query 6).


-- ── 5. Sample of DISCOVERY_LIMITED venues (must STILL be visible) ────────────
SELECT
  v.id, v.name, v.city,
  c.name AS category,
  v.discovery_approved,
  vrs.discovery_score
FROM venues v
LEFT JOIN categories c ON c.id = v.category_id
JOIN venue_review_scores vrs ON vrs.venue_id = v.id
WHERE vrs.discovery_recommendation = 'discovery_limited'
ORDER BY random()
LIMIT 25;
-- EXPECT: discovery_approved = true for EVERY row. These are the smaller rural /
-- niche / less-complete venues we deliberately keep for broad UK coverage.


-- ── 6. SAFETY: high-quality venues that got hidden (should be ZERO rows) ──────
-- A "high-quality" proxy: published, moderation-approved, has reviews or a
-- trusted score, yet excluded from discovery. If this returns rows, the backfill
-- over-reached and must be reviewed before production.
SELECT
  v.id, v.name, v.city,
  v.review_count, v.average_rating,
  vrs.discovery_recommendation, vrs.trust_recommendation, vrs.flags
FROM venues v
JOIN venue_review_scores vrs ON vrs.venue_id = v.id
WHERE v.discovery_approved = false
  AND v.is_published = true
  AND v.moderation_status = 'approved'
  AND (
        v.review_count > 0
        OR v.average_rating >= 4.0
        OR vrs.trust_recommendation = 'trusted_recommendation'
      )
ORDER BY v.review_count DESC, v.average_rating DESC;
-- EXPECT: 0 rows. This is the most important guard.


-- ── 7. SAFETY: junk that should be hidden but ISN'T (review these) ───────────
-- Heuristic catch-net independent of the review table: obvious adult/gambling
-- keywords or test/spam names that are still discovery_approved.
SELECT
  v.id, v.name, v.discovery_approved,
  c.name AS category
FROM venues v
LEFT JOIN categories c ON c.id = v.category_id
WHERE v.discovery_approved = true
  AND (
        v.name        ILIKE ANY (ARRAY['%casino%','%gambling%','%betting%','%strip club%','%adult%','%erotic%','%sex shop%','%test venue%','%dummy%'])
        OR c.name     ILIKE ANY (ARRAY['%casino%','%gambling%','%adult%','%nightclub%'])
      )
LIMIT 50;
-- EXPECT: few or none. Any genuine hits are candidates to re-score / exclude.
-- (False positives possible, e.g. "Adult swimming lessons" — eyeball before acting.)


-- ── 8. Discovery candidate-pool health (broad coverage preserved) ────────────
-- The full set the map/search can draw from after the gate. Compare before/after.
SELECT
  count(*)                                       AS discoverable_venues,
  count(DISTINCT v.city)                         AS cities_covered,
  count(*) FILTER (WHERE v.category_id IS NULL)  AS discoverable_without_category
FROM venues v
WHERE v.is_published = true
  AND v.moderation_status = 'approved'
  AND v.discovery_approved = true;
-- EXPECT: discoverable_venues ≈ (previously visible total) minus the exclude bucket.
-- cities_covered should barely move — we are not dropping whole regions.


-- ── 9. Per-city before/after delta (spot regional damage) ────────────────────
-- Top cities by how many venues the gate removes. A city losing nearly all its
-- venues would be a coverage problem worth investigating.
SELECT
  v.city,
  count(*)                                          AS published_approved,
  count(*) FILTER (WHERE v.discovery_approved)      AS still_visible,
  count(*) FILTER (WHERE NOT v.discovery_approved)  AS hidden
FROM venues v
WHERE v.is_published = true
  AND v.moderation_status = 'approved'
  AND v.city IS NOT NULL
GROUP BY v.city
HAVING count(*) FILTER (WHERE NOT v.discovery_approved) > 0
ORDER BY hidden DESC
LIMIT 30;
-- EXPECT: hidden counts are a small fraction of published_approved per city.


-- ============================================================
-- PERFORMANCE — EXPLAIN examples (run AFTER applying 044 + 045)
-- ============================================================
-- Goal: prove the discovery_approved gate does not slow the hot paths.
-- Run each with EXPLAIN ANALYZE on production and check the notes below.

-- ── P1. Map / nearby RPC ─────────────────────────────────────────────────────
-- The function body's hot filter is the PostGIS ST_DWithin spatial predicate,
-- served by the GiST index on venues.location. discovery_approved is just an
-- extra boolean applied to the already-tiny in-radius set.
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM get_nearby_venues(51.5074, -0.1278, 10);
-- EXPECT: an Index Scan / Bitmap Index Scan using the venues GiST location index
--         as the driving access path. Total time should be unchanged vs. before
--         045 (the boolean check is sub-millisecond on ~50–200 in-radius rows).

-- P1b. The same predicate as a raw query, to see the plan the function runs:
EXPLAIN (ANALYZE, BUFFERS)
SELECT v.id, v.name
FROM venues v
WHERE v.is_published = true
  AND v.moderation_status = 'approved'
  AND v.discovery_approved = true
  AND v.location IS NOT NULL
  AND ST_DWithin(v.location, ST_Point(-0.1278, 51.5074)::geography, 10000)
ORDER BY ST_Distance(v.location, ST_Point(-0.1278, 51.5074)::geography)
LIMIT 50;
-- EXPECT: spatial index drives; discovery_approved appears as a cheap Filter.


-- ── P2. Search query (useVenueSearch) ───────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, city
FROM venues
WHERE is_published = true
  AND moderation_status = 'approved'
  AND discovery_approved = true
  AND name ILIKE '%play%'
LIMIT 30;
-- NOTE: a leading-wildcard ILIKE ('%...') cannot use a btree on name, so a scan
--       is expected REGARDLESS of this change. The gate adds one boolean compare
--       per row. The new venues_discovery_gate_idx may be chosen to pre-narrow to
--       visible rows; if not, the planner seq-scans (acceptable for LIMIT 30).
-- EXPECT: total time materially unchanged vs. pre-044.


-- ── P3. Venue detail (useVenue) ──────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM venues
WHERE id = (SELECT id FROM venues LIMIT 1)   -- swap for a real UUID on prod
  AND is_published = true
  AND moderation_status = 'approved'
  AND discovery_approved = true;
-- EXPECT: Index Scan using venues_pkey (1 row), then the three flags as a Filter.
--         Sub-millisecond — the gate is negligible here.


-- ── P4. Confirm the new index exists and is used ─────────────────────────────
-- After running the queries above a few times, check the index sees scans:
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE relname = 'venues'
  AND indexrelname IN ('venues_discovery_gate_idx', 'venues_pkey')
ORDER BY indexrelname;
-- Also verify the index was actually created:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'venues' AND indexname = 'venues_discovery_gate_idx';
