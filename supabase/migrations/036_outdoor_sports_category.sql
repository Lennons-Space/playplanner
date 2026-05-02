-- Migration: 036_outdoor_sports_category.sql
-- Purpose: Add the outdoor-sports category required by the OSM import pipeline.
--
-- Why: 12,593 OSM venues tagged with leisure=pitch, leisure=park,
--      leisure=nature_reserve, tourism=picnic_site etc. were skipped on
--      import because no DB category matched the 'outdoor-sports' slug
--      produced by 02_transform_osm.js. This migration adds the missing
--      row so a re-run of 05_insert.js can pick them up.
--
-- Safety: ON CONFLICT (slug) DO NOTHING — idempotent, safe to re-run.

INSERT INTO categories (id, name, slug, icon, color) VALUES
  (uuid_generate_v4(), 'Outdoor Sports', 'outdoor-sports', '🏃', '#22C55E')
ON CONFLICT (slug) DO NOTHING;
