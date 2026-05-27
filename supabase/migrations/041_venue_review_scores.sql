-- ============================================================
-- Migration 041: venue_review_scores
-- ============================================================
-- Stores automated quality scores for each venue, computed by the
-- venue-review agent. Scores are advisory only — they never
-- automatically hide, approve, or modify a venue record.
--
-- Score range: 0–100
-- Recommendation thresholds:
--   >= 80  approve           — ready to publish
--   >= 65  needs_review      — missing 1–2 key fields; fixable
--   >= 45  hide_until_fixed  — incomplete; confusing for parents
--    < 45  reject            — not family-relevant or too sparse
--
-- Safety guarantees (enforced by script, not DB):
--   - This table is WRITE-ONLY for the review system.
--   - Venue records are NEVER modified by the review system.
-- ============================================================

CREATE TABLE venue_review_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid REFERENCES venues(id) ON DELETE CASCADE,
  score          int  NOT NULL CHECK (score >= 0 AND score <= 100),
  recommendation text NOT NULL CHECK (
    recommendation IN ('approve', 'needs_review', 'hide_until_fixed', 'reject')
  ),
  flags          text[]      NOT NULL DEFAULT '{}',
  reason         text,
  reviewed_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT venue_review_scores_venue_id_unique UNIQUE (venue_id)
);

-- Fast lookup by recommendation for the admin dashboard filter
CREATE INDEX venue_review_scores_venue_idx          ON venue_review_scores (venue_id);
CREATE INDEX venue_review_scores_score_idx           ON venue_review_scores (score);
CREATE INDEX venue_review_scores_recommendation_idx  ON venue_review_scores (recommendation);

CREATE TRIGGER venue_review_scores_updated_at
  BEFORE UPDATE ON venue_review_scores
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE venue_review_scores ENABLE ROW LEVEL SECURITY;

-- Admins can read and write all scores.
CREATE POLICY "Admins can manage venue review scores"
  ON venue_review_scores FOR ALL USING (is_admin());

-- Venue owners (claimed or submitted) can see the score for their own venues —
-- helps them understand why their listing needs improvement.
CREATE POLICY "Owners can view score for own venue"
  ON venue_review_scores FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM venues v
      WHERE v.id = venue_review_scores.venue_id
        AND (v.claimed_by = auth.uid() OR v.submitted_by = auth.uid())
    )
  );
