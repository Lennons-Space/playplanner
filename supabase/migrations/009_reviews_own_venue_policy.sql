-- ============================================================
-- Migration 009: Harden review INSERT and UPDATE policies
-- ============================================================
--
-- WHAT THIS FIXES
-- ---------------
-- Two HIGH-severity policy gaps found in migration 001:
--
-- 1. INSERT gap — own-venue review fraud
--    The original "Users can write reviews" policy checked only that
--    auth.uid() = user_id and moderation_status = 'pending'. It did NOT
--    prevent a business owner from reviewing their own venue by calling
--    the Supabase API directly (bypassing any app-level guard). A crafted
--    direct API call would have passed RLS and inserted a fraudulent review.
--
-- 2. UPDATE gap — editing approved/rejected reviews
--    The original "Users can edit own reviews" policy used only a USING
--    clause (auth.uid() = user_id). Postgres UPDATE policies without a
--    WITH CHECK clause default WITH CHECK to the same expression as USING,
--    but that expression is evaluated against the *existing* row, not the
--    *new* row. This means an attacker could UPDATE a review's
--    moderation_status from 'approved' back to 'pending', re-open it for
--    editing, and then re-submit altered content — effectively bypassing
--    moderation. Adding WITH CHECK (... AND moderation_status = 'pending')
--    ensures the row remains 'pending' after the UPDATE, so only genuinely
--    unmoderated reviews can be edited.
--
-- WHY THIS MATTERS
-- ----------------
-- PlayPlanner is a UK family venue discovery app. Fake or owner-manipulated
-- reviews harm parents making safety decisions for their children. Fraudulent
-- reviews could also expose the company to liability under the UK Consumer
-- Protection from Unfair Trading Regulations 2008 (CPRs), which prohibit
-- fake endorsements. Fixing this at the database layer means the protection
-- holds even if there is a bug in the application or a direct API call.
--
-- APPROACH
-- --------
-- DROP POLICY IF EXISTS is used before each CREATE so this migration is safe
-- to re-run (idempotent). Only the two vulnerable policies on `reviews` are
-- touched — no other tables or policies are modified.
-- ============================================================


-- ============================================================
-- 1. Fix the INSERT policy — block own-venue reviews
-- ============================================================

-- Drop the old policy that was missing the own-venue guard.
DROP POLICY IF EXISTS "Users can write reviews" ON reviews;

-- Replacement INSERT policy.
--
-- Three conditions must ALL be true for an INSERT to be allowed:
--
--   a) auth.uid() = user_id
--      The row's user_id must match the authenticated caller. Prevents
--      writing reviews on behalf of another user.
--
--   b) moderation_status = 'pending'
--      New reviews must enter moderation. A direct API call with
--      moderation_status = 'approved' will be blocked here.
--
--   c) NOT EXISTS (conflicting venue ownership)
--      Queries the venues table for the venue being reviewed. If the
--      caller is the business owner (claimed_by) OR the original submitter
--      (submitted_by) of that venue, the INSERT is denied.
--      Both columns are checked because:
--        - claimed_by = the verified business owner with ongoing control
--        - submitted_by = the original submitter who may still have a
--          conflict of interest even if the business has been re-claimed
--      Using NOT EXISTS is intentional: if the venue row does not exist at
--      all (e.g. a race condition or bad venue_id), the subquery returns
--      no rows, NOT EXISTS is TRUE, and the INSERT proceeds to fail on
--      the foreign-key constraint instead — which is the correct behaviour.
CREATE POLICY "Users can write reviews" ON reviews
  FOR INSERT WITH CHECK (
    -- Reviewer must be writing their own row
    auth.uid() = user_id

    -- Review must enter moderation queue, never go live automatically
    AND moderation_status = 'pending'

    -- Reviewer must not be the owner or original submitter of this venue
    AND NOT EXISTS (
      SELECT 1
      FROM venues
      WHERE venues.id = venue_id                          -- the venue being reviewed
        AND (
          venues.claimed_by   = auth.uid()               -- is the verified business owner
          OR venues.submitted_by = auth.uid()            -- or the original submitter
        )
    )
  );


-- ============================================================
-- 2. Fix the UPDATE policy — prevent editing post-moderation
-- ============================================================

-- Drop the old policy that was missing the WITH CHECK clause.
DROP POLICY IF EXISTS "Users can edit own reviews" ON reviews;

-- Replacement UPDATE policy.
--
-- USING clause — which rows can be targeted:
--   auth.uid() = user_id
--   The user can only address their own review rows. They cannot
--   UPDATE another user's review even with a crafted API call.
--
-- WITH CHECK clause — what the row must look like AFTER the update:
--   auth.uid() = user_id AND moderation_status = 'pending'
--   Even if the USING check passes, the resulting row must still have
--   moderation_status = 'pending'. This prevents two attacks:
--
--   Attack A — re-editing an approved review:
--     Without WITH CHECK, a user could UPDATE an approved review's body.
--     The content would change even though it already passed moderation.
--
--   Attack B — status downgrade then re-edit:
--     Without WITH CHECK, a user could set moderation_status = 'pending'
--     on an approved review (rolling it back into the queue), edit the
--     content, and leave it pending for re-approval — effectively laundering
--     altered content through the moderation system.
--
--   Both attacks are closed by requiring moderation_status = 'pending'
--   in the WITH CHECK clause.
--
-- NOTE: The admin policy "Admins can update any review" (from migration 001)
-- is intentionally left in place. Admins legitimately change
-- moderation_status from 'pending' → 'approved' / 'rejected'. That policy
-- is unaffected by this migration.
CREATE POLICY "Users can edit own reviews" ON reviews
  FOR UPDATE
  USING (
    -- Target: user can only address their own reviews
    auth.uid() = user_id
  )
  WITH CHECK (
    -- Result: the updated row must still belong to this user
    auth.uid() = user_id
    -- Result: the updated row must still be in the pending state
    -- (prevents editing approved/rejected reviews, and prevents
    --  status downgrade attacks described above)
    AND moderation_status = 'pending'
  );
