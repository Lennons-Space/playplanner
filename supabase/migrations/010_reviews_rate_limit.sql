-- ============================================================
-- Migration 010: Add server-side rate limit to review INSERT policy
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Replaces the "Users can write reviews" INSERT policy created in migration
-- 009 with an identical policy that adds one additional condition: a user may
-- not submit more than 10 reviews within any rolling 24-hour window.
--
-- The rate limit is enforced inside the WITH CHECK clause of the RLS policy,
-- so it is evaluated by Postgres on every INSERT regardless of whether the
-- request arrives from the mobile app, the Supabase dashboard, or a direct
-- API call. No application-layer guard alone is sufficient — an attacker can
-- always craft a raw HTTP request to the Supabase REST/PostgREST endpoint.
--
-- WHY THIS MATTERS
-- ----------------
-- PlayPlanner is a UK family venue discovery app. Review integrity is central
-- to parents making safe decisions for their children. Without a server-side
-- rate limit a single compromised or malicious account could:
--
--   - Flood a venue with identical 5-star reviews to artificially boost it
--   - Flood a competitor with negative reviews to suppress it
--   - Overwhelm the moderation queue, delaying the review of legitimate content
--
-- UK Consumer Protection from Unfair Trading Regulations 2008 (CPRs) prohibit
-- fake endorsements. A database-level cap is the last line of defence.
--
-- The threshold of 10 per 24 hours is deliberately conservative:
--   - A genuine parent is unlikely to visit and review 10 venues in a day.
--   - The window rolls (uses now() - interval '24 hours'), so it is harder to
--     game with a midnight burst than a fixed calendar-day reset would be.
--
-- APPROACH
-- --------
-- DROP POLICY IF EXISTS before the CREATE makes this migration idempotent —
-- safe to re-run without error. Only the INSERT policy on `reviews` is
-- changed. The UPDATE policy and all other tables are left untouched.
-- ============================================================


-- ============================================================
-- Drop the existing INSERT policy introduced in migration 009.
-- ============================================================

-- IF EXISTS makes this safe to run even if the policy was already dropped.
DROP POLICY IF EXISTS "Users can write reviews" ON reviews;


-- ============================================================
-- Recreate the INSERT policy — now with the rate-limit condition.
-- ============================================================

-- Four conditions must ALL be true for an INSERT to succeed:
--
--   a) auth.uid() = user_id
--      The row's user_id must match the authenticated caller. Prevents a
--      user from writing a review that appears to belong to someone else.
--
--   b) moderation_status = 'pending'
--      Every new review must enter the moderation queue. A direct API call
--      that sets moderation_status = 'approved' will be rejected here,
--      preventing reviews from going live without human oversight.
--
--   c) NOT EXISTS (own-venue block — preserved from migration 009)
--      Looks up the venue being reviewed. If the authenticated user is the
--      verified business owner (claimed_by) OR the original submitter
--      (submitted_by), the INSERT is denied. Both columns are checked
--      because either role represents a conflict of interest. If the venue
--      row does not exist, NOT EXISTS evaluates to TRUE and the INSERT then
--      fails on the foreign-key constraint — the correct behaviour.
--
--   d) Rolling 24-hour rate limit
--      Counts the caller's reviews submitted in the last 24 hours. If the
--      count is already 10 or more the INSERT is rejected. Using
--      now() - interval '24 hours' creates a true rolling window rather than
--      a midnight reset, making burst timing attacks ineffective.
--      The subquery is intentionally kept simple (no index hint) because
--      Postgres can efficiently use the index on (user_id, created_at) that
--      already supports other review queries. The count is bounded at 10,
--      so Postgres can short-circuit after finding 10 rows — no full scan.
CREATE POLICY "Users can write reviews" ON reviews
  FOR INSERT WITH CHECK (

    -- a) Reviewer must be writing their own row.
    auth.uid() = user_id

    -- b) Review must enter the moderation queue — never go live automatically.
    AND moderation_status = 'pending'

    -- c) Reviewer must not be the owner or original submitter of this venue.
    AND NOT EXISTS (
      SELECT 1
      FROM venues
      WHERE venues.id = venue_id                       -- the venue being reviewed
        AND (
          venues.claimed_by   = auth.uid()             -- verified business owner
          OR venues.submitted_by = auth.uid()          -- original submitter
        )
    )

    -- d) Rate limit: no more than 10 reviews submitted in the last 24 hours.
    --    Evaluated server-side on every INSERT; cannot be bypassed via the API.
    AND (
      SELECT COUNT(*)
      FROM reviews
      WHERE user_id   = auth.uid()
        AND created_at > now() - interval '24 hours'
    ) < 10

  );
