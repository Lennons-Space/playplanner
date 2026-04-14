-- Migration 015: Add missing index on venue_reports for RLS rate-limit subquery.
-- The INSERT policy in migration 014 runs:
--   SELECT COUNT(*) FROM venue_reports WHERE venue_id = ? AND reported_by = auth.uid()
-- Without this index, that subquery does a full table scan on every INSERT.
-- At 100k+ reports this becomes user-visible latency.

CREATE INDEX IF NOT EXISTS venue_reports_user_venue_idx
  ON venue_reports (reported_by, venue_id);
