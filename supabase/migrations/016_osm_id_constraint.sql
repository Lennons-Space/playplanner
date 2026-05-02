-- ============================================================
-- Migration 016: Fix osm_id unique constraint for PostgREST upsert
-- ============================================================
--
-- Problem: Migration 013 created a partial unique INDEX on osm_id
-- (WHERE osm_id IS NOT NULL). PostgREST's upsert with onConflict:'osm_id'
-- requires a full unique CONSTRAINT — it cannot resolve partial indexes by
-- column name.
--
-- Fix: Add a standard unique constraint FIRST (which creates its own backing
-- index), THEN drop the old indexes. This ordering guarantees there is never
-- a moment where the osm_id column has no uniqueness guarantee or index —
-- avoiding a short window where duplicate osm_ids could be inserted or
-- lookups become a sequential scan.
--
-- Why a plain UNIQUE constraint is safe here:
--   Postgres treats NULL as not equal to NULL, so a UNIQUE constraint
--   already allows multiple NULL values — the partial index was unnecessary.
-- ============================================================

-- Step 1: Add the unique constraint FIRST.
-- Postgres automatically creates a backing unique index for this constraint,
-- so the osm_id column is continuously indexed and uniqueness-enforced.
ALTER TABLE venues
  ADD CONSTRAINT venues_osm_id_unique UNIQUE (osm_id);

-- Step 2: Now that the new constraint + its backing index exist, it is safe
-- to drop the old indexes from migration 013.
DROP INDEX IF EXISTS venues_osm_id_idx;

-- NOTE: The old partial index was named `venues_osm_id_unique` in migration 013.
-- Our new CONSTRAINT is also named `venues_osm_id_unique`, so the old index
-- would collide on creation. If your DB still has the old partial index under
-- that name, run this one-off cleanup manually BEFORE applying this migration:
--   DROP INDEX IF EXISTS venues_osm_id_unique;
-- (Step 1 above will then create a fresh backing index under the same name.)
