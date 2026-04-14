-- Migration 014: venue_reports table
--
-- Allows authenticated users to flag venue data quality issues (wrong info,
-- permanently closed, etc.) for admin review.
--
-- WHY a separate table? Storing reports separately keeps the venues table
-- clean and gives admins a clear moderation queue without polluting venue
-- records with report state.
--
-- WHY a rate limit in the RLS policy? Prevents a single user from flooding
-- the report queue for a venue, which could be used as a harassment vector
-- against venue owners or to overwhelm the moderation team.

CREATE TABLE venue_reports (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id    uuid REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  reported_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN (
    'permanently_closed',
    'wrong_info',
    'inappropriate_content',
    'duplicate',
    'other'
  )),
  notes       text CHECK (notes IS NULL OR length(notes) <= 2000),
  resolved    boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- Enable RLS — all access goes through policies defined below.
ALTER TABLE venue_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can submit reports.
-- Rate limit: max 3 reports per user per venue prevents report flooding.
--
-- WHY the alias `vr`? In an INSERT WITH CHECK expression, unqualified
-- `venue_reports.venue_id` resolves to the *table alias* in the outer
-- INSERT context, not the NEW row being inserted — so the subquery would
-- always compare a column to itself (always 0 matches → always < 3).
-- Using an explicit alias `vr` for the subquery and comparing to
-- `venue_reports.venue_id` (which now refers to the NEW row's value via
-- the WITH CHECK binding) gives the correct rate-limit behaviour.
CREATE POLICY "Users can report venues" ON venue_reports
  FOR INSERT WITH CHECK (
    auth.uid() = reported_by
    AND (
      SELECT COUNT(*) FROM venue_reports vr
      WHERE vr.venue_id    = venue_reports.venue_id
        AND vr.reported_by = auth.uid()
    ) < 3
  );

-- Users can see their own reports only — not other users' reports.
-- WHY? Reporters should not be able to see whether others have flagged the
-- same venue; this prevents bandwagon reporting and protects reporter privacy.
CREATE POLICY "Users can view own reports" ON venue_reports
  FOR SELECT USING (auth.uid() = reported_by);

-- Users can delete their own unresolved reports (GDPR Art.17 right to erasure).
-- WHY only unresolved? Once a report has been acted on by an admin (resolved=true)
-- it forms part of the moderation audit trail and must be retained.
CREATE POLICY "Users can delete own unresolved reports" ON venue_reports
  FOR DELETE USING (
    auth.uid() = reported_by
    AND resolved = false
  );

-- Admins have full access to manage the report queue.
-- is_admin() is a DB function defined in the security hardening migration.
CREATE POLICY "Admins can manage reports" ON venue_reports
  FOR ALL USING (is_admin());

-- GDPR Art.17: When a user's profile is deleted (reported_by SET NULL above),
-- redact any free-text notes they wrote so no personal data remains.
-- The reported_by FK is already SET NULL on profile delete; this trigger
-- additionally NULLs the notes field to remove the content of their words.
CREATE OR REPLACE FUNCTION redact_venue_report_notes_on_profile_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE venue_reports
  SET    notes = NULL
  WHERE  reported_by = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_redact_report_notes_on_profile_delete
  BEFORE DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION redact_venue_report_notes_on_profile_delete();
