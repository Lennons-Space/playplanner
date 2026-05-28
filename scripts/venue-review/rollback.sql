-- ============================================================
-- ROLLBACK PLAN — discovery_approved (migrations 044 + 045)
-- ============================================================
-- This file is NOT a migration. It lives in scripts/ on purpose so the Supabase
-- migration runner never auto-applies it. Copy the level you need into the SQL
-- editor manually.
--
-- There are three levels, from least to most invasive. Pick the smallest one
-- that solves the problem.
--
-- IMPORTANT: none of these delete venues. The gate only ever hides/shows rows.
-- ============================================================


-- ── LEVEL 1 — "Show everything again" (fastest, zero schema change) ───────────
-- Use if discovery feels too aggressive in production and you want every venue
-- visible immediately while you investigate. Keeps the column + RPC in place.
-- Reversible: re-run the backfill (scripts/venue-review/backfill.js) or migration
-- 044's UPDATE to re-apply the exclude flags.
UPDATE venues SET discovery_approved = true WHERE discovery_approved = false;
-- Effect: the gate is a no-op (every row passes discovery_approved = true) but
-- the plumbing stays, so you can re-enable by re-scoring.


-- ── LEVEL 2 — "Neutralise the gate in the RPC" (revert 045 only) ──────────────
-- Use if the column is fine but you want the MAP/nearby RPC to stop filtering.
-- Re-applies the migration 040 body (no discovery_approved line). The app's
-- useVenue / useVenueSearch JS filters are independent — see the code note below.
--
-- To revert the RPC: re-run supabase/migrations/040_nearby_venues_image_url.sql
-- verbatim (it CREATE OR REPLACEs get_nearby_venues without the gate line).
--   psql/SQL editor:  \i 040_nearby_venues_image_url.sql
-- The signature is identical, so no caller breaks.
--
-- CODE side (app filters in hooks/useVenues.ts): to neutralise without editing
-- code, Level 1 (set all true) already makes those .eq('discovery_approved',true)
-- filters match every row. To remove them in code, delete the two lines:
--     .eq('discovery_approved', true)
-- in useVenue() and useVenueSearch(), then ship an app update.


-- ── LEVEL 3 — "Full teardown" (remove column, index, and RPC gate) ────────────
-- Use only if abandoning the feature entirely. Order matters: drop the RPC
-- dependency on the column first (revert 045 → 040), THEN drop the column.
--
-- Step 3a: revert the RPC to the 040 body (removes the discovery_approved line).
--          Run 040_nearby_venues_image_url.sql as in Level 2.
--
-- Step 3b: drop the index and column.
BEGIN;
  DROP INDEX IF EXISTS venues_discovery_gate_idx;
  ALTER TABLE venues DROP COLUMN IF EXISTS discovery_approved;
COMMIT;
--
-- Step 3c: remove the two `.eq('discovery_approved', true)` lines from
--          hooks/useVenues.ts (useVenue + useVenueSearch) and ship an app update.
--          If the column is dropped but the app still references it, those two
--          queries will ERROR — so 3c MUST ship before/with 3b reaching users.
--
-- NOTE on migration history: if you dropped the column, also mark 044/045 as
-- reverted in your tracking, or delete the migration files, so a future
-- `supabase db push` doesn't re-add them unexpectedly.


-- ── Verify rollback ───────────────────────────────────────────────────────────
-- After Level 1 or 2 (column still present):
SELECT count(*) FILTER (WHERE discovery_approved = false) AS still_hidden FROM venues;
-- After Level 1: should be 0.
--
-- After Level 3 (column dropped):
SELECT column_name FROM information_schema.columns
WHERE table_name = 'venues' AND column_name = 'discovery_approved';
-- Should return 0 rows.
