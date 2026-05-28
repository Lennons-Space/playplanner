-- ============================================================
-- Migration 044: venues.discovery_approved
-- ============================================================
-- Adds a fast, denormalised "is this venue allowed to appear in
-- discovery (map / search / list)?" flag directly on the venues table.
--
-- WHY a column on venues instead of joining venue_review_scores every query:
--   venue_review_scores stays the detailed scoring/report table (the "why").
--   venues.discovery_approved is the cheap boolean the app filters on (the
--   "what"). A single indexed boolean check is far cheaper than joining the
--   scores table on every map pan, search keystroke, and venue open.
--
-- SAFETY:
--   - Default is TRUE — no venue disappears unless we explicitly exclude it.
--   - We NEVER delete venues. We only flip a visibility flag.
--   - This does NOT replace is_published / moderation_status. Those filters
--     remain; discovery_approved is an ADDITIONAL gate layered on top.
--
-- Backfill mapping (from venue_review_scores.discovery_recommendation):
--   'discovery_approved' -> true   (safe to show)
--   'discovery_limited'  -> true   (still shown in discovery; lower priority)
--   'exclude'            -> false  (spam / adult / no category — hide)
--   (no score row)       -> true   (default — show by default)
--
-- Note: venue_review_scores has UNIQUE(venue_id), so there is exactly ONE
-- score row per venue — there is no "latest" ambiguity to resolve here.
--
-- ATOMICITY: wrapped in BEGIN/COMMIT (same pattern as migrations 007/008) so the
-- column add, backfill, and index creation either all succeed or all roll back —
-- the table is never left with the column added but unbackfilled. All statements
-- here are transaction-safe (no CONCURRENTLY). Every statement is also idempotent
-- (IF NOT EXISTS / deterministic UPDATE), so re-running the migration is safe.
-- ============================================================

BEGIN;

-- 1. Add the column. NOT NULL DEFAULT true => every existing row becomes
--    visible by default, and any future insert is visible unless told otherwise.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS discovery_approved boolean NOT NULL DEFAULT true;

-- 2. Backfill from existing review scores.
--    Only 'exclude' flips the flag to false; everything else stays true.
--    Rows with no score row are left at the column default (true).
UPDATE venues v
SET discovery_approved = CASE vrs.discovery_recommendation
    WHEN 'exclude' THEN false   -- hide from discovery
    ELSE true                   -- discovery_approved + discovery_limited both show
  END
FROM venue_review_scores vrs
WHERE vrs.venue_id = v.id
  AND vrs.discovery_recommendation IS NOT NULL;

-- 3. Composite index matching the exact visibility gate every discovery surface
--    applies together:
--      WHERE discovery_approved = true
--        AND moderation_status = 'approved'
--        AND is_published = true
--    A single btree on all three columns lets the planner confirm the full
--    visibility predicate from one index. The map RPC still leads with the
--    PostGIS GiST index on `location` (spatial narrowing happens first); this
--    btree then cheaply checks the flags. The search query (ILIKE on name) uses
--    it to pre-narrow to the visible set before the wildcard scan.
--    Kept as a plain composite (no partial predicate) for simplicity and to
--    serve future queries that filter on these columns with other combinations.
CREATE INDEX IF NOT EXISTS venues_discovery_gate_idx
  ON venues (discovery_approved, moderation_status, is_published);

COMMIT;
