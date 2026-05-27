-- Migration 042: add review_mode to venue_review_scores
--
-- Distinguishes public-imported venues (OSM / bulk data) from operator
-- business submissions. The two modes use different scoring weights — public
-- imports are not penalised for missing enrichment data (pricing, hours,
-- facilities, photos) that operators are expected to supply.

ALTER TABLE venue_review_scores
  ADD COLUMN IF NOT EXISTS review_mode text
    NOT NULL DEFAULT 'public_import'
    CHECK (review_mode IN ('public_import', 'business_submission'));

CREATE INDEX IF NOT EXISTS venue_review_scores_review_mode_idx
  ON venue_review_scores (review_mode);
