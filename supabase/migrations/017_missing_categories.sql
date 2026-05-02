-- Migration: 017_missing_categories.sql
-- Purpose: Add 7 missing venue categories required by the OSM import pipeline
--         (scripts/import/02_transform_osm.js). Without these rows, 546 OSM
--         venues are rejected due to FK/slug mismatch.
--
-- Safety:
--   * Uses ON CONFLICT (slug) DO NOTHING so the migration is idempotent and
--     safe to re-run. If any of these slugs already exist, they are skipped.
--   * Categories are publicly readable (RLS policy in 001_initial_schema.sql)
--     and only editable via migrations — no privacy/PII concerns here.
--
-- Schema reference (supabase/migrations/001_initial_schema.sql lines 14-21):
--   categories(id uuid pk, name text unique not null, slug text unique not null,
--              icon text not null, color text not null, created_at timestamptz)
--   NOTE: there is no `description` column in the current schema, so we only
--   populate the columns that exist. If a description column is added later,
--   a follow-up migration can backfill copy for these rows.

insert into categories (id, name, slug, icon, color) values
  (uuid_generate_v4(), 'Playground',         'playground',        '🛝', '#22C55E'),
  (uuid_generate_v4(), 'Childcare',          'childcare',         '🧸', '#F59E0B'),
  (uuid_generate_v4(), 'Museum',             'museum',            '🏛️', '#8B5CF6'),
  (uuid_generate_v4(), 'Attraction',         'attraction',        '🎡', '#EC4899'),
  (uuid_generate_v4(), 'Sports & Activities','sports-activity',   '⚽', '#0EA5E9'),
  (uuid_generate_v4(), 'Animal Attractions', 'animal-attraction', '🦁', '#CA8A04'),
  (uuid_generate_v4(), 'Theme Parks',        'theme-park',        '🎢', '#EF4444')
on conflict (slug) do nothing;
