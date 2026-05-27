-- Migration 043: dual discovery + trust scoring for venue_review_scores
--
-- Splits quality assessment into two independent scores:
--
--   discovery_score / discovery_recommendation
--     "Is this venue safe to show in map/search/list discovery?"
--     Public imports: lenient — excluded only for spam, adult content, or no category.
--     Business submissions: mirrors trust score.
--
--   trust_score / trust_recommendation
--     "Is this venue enriched enough for curated recommendations (Find Something For Us)?"
--     Requires description, pricing, hours, photos, etc.
--
-- Legacy columns (score, recommendation) are kept for backward compatibility
-- and are populated with the discovery values for public imports, trust values
-- for business submissions — so existing admin queries continue to work.

ALTER TABLE venue_review_scores
  ADD COLUMN IF NOT EXISTS discovery_score int
    CHECK (discovery_score IS NULL OR (discovery_score >= 0 AND discovery_score <= 100)),

  ADD COLUMN IF NOT EXISTS discovery_recommendation text
    CHECK (discovery_recommendation IS NULL OR
           discovery_recommendation IN ('discovery_approved', 'discovery_limited', 'exclude')),

  ADD COLUMN IF NOT EXISTS trust_score int
    CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 100)),

  ADD COLUMN IF NOT EXISTS trust_recommendation text
    CHECK (trust_recommendation IS NULL OR
           trust_recommendation IN ('trusted_recommendation', 'needs_enrichment', 'not_trusted_yet'));

CREATE INDEX IF NOT EXISTS venue_review_scores_discovery_rec_idx
  ON venue_review_scores (discovery_recommendation);

CREATE INDEX IF NOT EXISTS venue_review_scores_trust_rec_idx
  ON venue_review_scores (trust_recommendation);

CREATE INDEX IF NOT EXISTS venue_review_scores_discovery_score_idx
  ON venue_review_scores (discovery_score);

CREATE INDEX IF NOT EXISTS venue_review_scores_trust_score_idx
  ON venue_review_scores (trust_score);
