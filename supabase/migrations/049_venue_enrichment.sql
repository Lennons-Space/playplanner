-- =============================================================================
-- 049_venue_enrichment.sql
-- Family Intelligence System: venue_enrichment table.
--
-- Three-layer design:
--   Layer 1  Raw facts from OSM/Geoapify/Wikidata (verifiable, auditable)
--   Layer 2  Script-computed intelligence scores (0-100) -- TypeScript only,
--            NOT generated columns (formulas will evolve)
--   Layer 3  Pre-computed recommended_for[] tags -- GIN-indexed for O(1) filter
--
-- SAFETY RULES (enforced by script, not DB constraints):
--   * NULL means not assessed -- never infer from silence
--   * false means checked and confirmed absent
--   * 'unknown' means assessed but the source was ambiguous
--   * manually_curated = true means the enrichment script NEVER overwrites
--   * intelligence_version tracks which formula version produced the scores
--   * score_breakdown stores the per-component contribution for audit
-- =============================================================================

CREATE TABLE IF NOT EXISTS venue_enrichment (
  venue_id  uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,

  -- Layer 1: Raw facts ---------------------------------------------------
  indoor_outdoor        text
    CHECK (indoor_outdoor IN ('indoor', 'outdoor', 'mixed', 'unknown')),
  parking_available     boolean,
  cafe_available        boolean,
  toilets_available     boolean,
  baby_change_available boolean,
  wheelchair_accessible text
    CHECK (wheelchair_accessible IN ('yes', 'limited', 'no', 'unknown')),
  visit_duration_mins   smallint CHECK (visit_duration_mins IS NULL OR visit_duration_mins > 0),
  activity_level        text
    CHECK (activity_level IN ('low', 'medium', 'high', 'unknown')),

  -- Layer 2: Intelligence scores -----------------------------------------
  parent_convenience_score smallint
    CHECK (parent_convenience_score IS NULL OR parent_convenience_score BETWEEN 0 AND 100),
  rainy_day_score       smallint
    CHECK (rainy_day_score IS NULL OR rainy_day_score BETWEEN 0 AND 100),
  active_play_score     smallint
    CHECK (active_play_score IS NULL OR active_play_score BETWEEN 0 AND 100),
  learning_score        smallint
    CHECK (learning_score IS NULL OR learning_score BETWEEN 0 AND 100),
  budget_score          smallint
    CHECK (budget_score IS NULL OR budget_score BETWEEN 0 AND 100),
  accessibility_score   smallint
    CHECK (accessibility_score IS NULL OR accessibility_score BETWEEN 0 AND 100),

  -- Layer 3: Pre-computed filter tags ------------------------------------
  recommended_for       text[] NOT NULL DEFAULT '{}',

  -- Provenance -----------------------------------------------------------
  enrichment_confidence text NOT NULL DEFAULT 'low'
    CHECK (enrichment_confidence IN ('low', 'medium', 'high')),
  enrichment_sources    text[] NOT NULL DEFAULT '{}',
  raw_osm_tags          jsonb,
  raw_geoapify          jsonb,
  raw_wikidata          jsonb,
  manually_curated      boolean NOT NULL DEFAULT false,
  intelligence_version  integer NOT NULL DEFAULT 1,
  score_breakdown       jsonb NOT NULL DEFAULT '{}',
  last_enriched_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Touch updated_at on every write (reuse existing trigger function)
CREATE TRIGGER venue_enrichment_updated_at
  BEFORE UPDATE ON venue_enrichment
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Indexes -----------------------------------------------------------------

CREATE INDEX venue_enrichment_recommended_for_idx
  ON venue_enrichment USING GIN (recommended_for);

CREATE INDEX venue_enrichment_rainy_day_idx
  ON venue_enrichment (rainy_day_score)
  WHERE rainy_day_score IS NOT NULL;

CREATE INDEX venue_enrichment_active_play_idx
  ON venue_enrichment (active_play_score)
  WHERE active_play_score IS NOT NULL;

CREATE INDEX venue_enrichment_convenience_idx
  ON venue_enrichment (parent_convenience_score)
  WHERE parent_convenience_score IS NOT NULL;

-- Backfill queue: quickly find venues not yet enriched
CREATE INDEX venue_enrichment_needs_enrichment_idx
  ON venue_enrichment (last_enriched_at)
  WHERE last_enriched_at IS NULL;

-- Facility boolean filter index
CREATE INDEX venue_enrichment_facilities_idx
  ON venue_enrichment (parking_available, cafe_available, toilets_available, baby_change_available);

-- RLS ---------------------------------------------------------------------

ALTER TABLE venue_enrichment ENABLE ROW LEVEL SECURITY;

-- Enrichment data is factual physical-venue metadata -- no personal data.
-- Readable by everyone (anon and authenticated) so filters work without login.
CREATE POLICY "venue_enrichment_select"
  ON venue_enrichment FOR SELECT
  USING (true);

-- Only admins can write via the app. The enrichment script uses service_role
-- which bypasses RLS entirely.
CREATE POLICY "venue_enrichment_admin_write"
  ON venue_enrichment FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
