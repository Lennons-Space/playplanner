-- =============================================================================
-- 060_enrichment_2_1_staging_checklist.sql
--
-- Manual behavioural verification for enrichment_nearby_venues_for_dedupe
-- (migration 060, Phase D). NOT executed by this build, NOT a pglite test —
-- this repo's pinned @electric-sql/pglite@0.5.3 has no PostGIS contrib
-- module, so the function cannot be loaded in-sandbox at all (confirmed:
-- `ls node_modules/@electric-sql/pglite/dist/contrib` lists 40+ extensions,
-- no postgis). Run this file yourself against a real Postgres+PostGIS
-- dev/staging database AFTER applying migration 060 there (never prod
-- first) — e.g. `psql "$STAGING_DATABASE_URL" -f
-- supabase/tests/060_enrichment_2_1_staging_checklist.sql`.
--
-- Each block is a self-contained CHECK that RAISEs on failure and prints a
-- clear PASS line on success (mirrors this repo's other test scripts' pass/
-- fail style, adapted to plpgsql DO blocks since this isn't a JS test file).
-- Cleans up its own fixture rows at the end via ROLLBACK — wrap the whole
-- file in one transaction so nothing here ever touches real data even if you
-- run it against a database with real rows.
-- =============================================================================

BEGIN;

-- Fixtures: 3 venues near Shrewsbury (SY1), tightly clustered, mixed
-- publish/moderation state, plus one distant venue and one same-name
-- different-city venue (chain-branch case).
INSERT INTO venues (id, name, category_id, city, postcode, country, latitude, longitude, is_published, moderation_status, discovery_approved)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Published Approved Zoo', NULL, 'Shrewsbury', 'SY1 1AA', 'GB', 52.7069, -2.7538, true,  'approved', true),
  ('00000000-0000-0000-0000-000000000002', 'Pending Zoo Duplicate',  NULL, 'Shrewsbury', 'SY1 1AB', 'GB', 52.7070, -2.7539, false, 'pending',  true),
  ('00000000-0000-0000-0000-000000000003', 'Unpublished Excluded Zoo', NULL, 'Shrewsbury', 'SY1 1AC', 'GB', 52.7071, -2.7540, false, 'approved', false),
  ('00000000-0000-0000-0000-000000000004', 'Distant Zoo',            NULL, 'Newcastle',  'NE1 1AA', 'GB', 54.9783, -1.6178, true,  'approved', true),
  ('00000000-0000-0000-0000-000000000005', 'Chain Play Barn - Shrewsbury', NULL, 'Shrewsbury', 'SY1 1AD', 'GB', 52.7072, -2.7541, true, 'approved', true),
  ('00000000-0000-0000-0000-000000000006', 'Chain Play Barn - Telford',    NULL, 'Telford',    'TF1 1AA', 'GB', 52.6778, -2.4453, true, 'approved', true)
ON CONFLICT (id) DO NOTHING;

-- ── Test 1: nearby duplicate returned ───────────────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 1500, 50)
    WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: nearby published venue not returned'; END IF;
  RAISE NOTICE 'PASS: nearby duplicate returned';
END $$;

-- ── Test 2: pending duplicate returned (the whole point of this RPC) ───────
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 1500, 50)
    WHERE id = '00000000-0000-0000-0000-000000000002';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: pending venue not returned — get_nearby_venues-style bug reintroduced'; END IF;
  RAISE NOTICE 'PASS: pending duplicate returned';
END $$;

-- ── Test 3: unpublished duplicate returned ──────────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 1500, 50)
    WHERE id = '00000000-0000-0000-0000-000000000003';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: unpublished venue not returned'; END IF;
  RAISE NOTICE 'PASS: unpublished duplicate returned';
END $$;

-- ── Test 4: distant same-category venue excluded ────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 1500, 50)
    WHERE id = '00000000-0000-0000-0000-000000000004';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: Newcastle venue returned for a Shrewsbury query — radius clamp broken'; END IF;
  RAISE NOTICE 'PASS: distant venue excluded';
END $$;

-- ── Test 5: chain branch nearby is returned (independently scoreable by the caller) ─
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7072, -2.7541, 1500, 50)
    WHERE id = '00000000-0000-0000-0000-000000000005';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: chain branch not returned by spatial prefilter'; END IF;
  -- The Telford branch (a genuinely different branch, several miles away) must
  -- NOT be pulled in by this RPC's tight identity radius — the dedupe scorer
  -- (dedupe.ts) is what tells branches apart via domain/phone/name, but it
  -- can only do that job if the RPC hands it a plausible set, not a distant one.
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7072, -2.7541, 1500, 50)
    WHERE id = '00000000-0000-0000-0000-000000000006';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: Telford branch incorrectly returned for a Shrewsbury query'; END IF;
  RAISE NOTICE 'PASS: chain branch nearby returned, distant branch excluded';
END $$;

-- ── Test 6: result cap ──────────────────────────────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 5000, 2);
  IF v_count > 2 THEN RAISE EXCEPTION 'FAIL: result cap not enforced, got % rows for p_limit=2', v_count; END IF;
  RAISE NOTICE 'PASS: result cap enforced (% rows for p_limit=2)', v_count;
END $$;

-- ── Test 7: radius/limit hard ceilings clamp even absurd input ─────────────
DO $$
DECLARE v_count int;
BEGIN
  -- p_radius_m=999999999 must clamp to 5000m (MAX_DEDUPE_RADIUS_M) — Newcastle
  -- (~200km away) must still be excluded even when asking for a huge radius.
  SELECT count(*) INTO v_count FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 999999999, 999999)
    WHERE id = '00000000-0000-0000-0000-000000000004';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: radius ceiling not enforced — distant venue leaked through'; END IF;
  RAISE NOTICE 'PASS: radius/limit ceilings enforced regardless of requested value';
END $$;

-- ── Test 8: invalid coordinates raise, not silently return empty ───────────
DO $$
BEGIN
  BEGIN
    PERFORM * FROM enrichment_nearby_venues_for_dedupe(999, 0, 1500, 50);
    RAISE EXCEPTION 'FAIL: out-of-range latitude did not raise';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: out-of-range latitude raises check_violation';
  END;
END $$;

-- ── Test 9: role security — service_role only ───────────────────────────────
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 1500, 50);
    RAISE EXCEPTION 'FAIL: authenticated role was able to execute the function';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: authenticated role denied (insufficient_privilege)';
  END;
  RESET ROLE;
END $$;

-- ── Test 10: EXPLAIN — confirm the GIST index is actually used, not a seq scan ─
-- Run this manually and eyeball the plan (a DO block can't assert on EXPLAIN
-- output text easily) — look for "Index Scan using venues_location_idx" or
-- a Bitmap Index Scan on it, NOT "Seq Scan on venues" for any table with a
-- realistic row count (a tiny fixture table may legitimately seq-scan; this
-- matters most once real venue volume is loaded in staging).
EXPLAIN ANALYZE SELECT * FROM enrichment_nearby_venues_for_dedupe(52.7069, -2.7538, 1500, 50);

ROLLBACK; -- never persist the fixture rows, even against a database with real data
