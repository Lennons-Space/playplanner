-- =============================================================================
-- 027_approve_claim_atomic.sql
--
-- Replaces the three sequential client-side writes in useReviewClaim with a
-- single atomic Postgres function.
--
-- WHY THIS MATTERS
-- ----------------
-- The previous approach called Supabase three times:
--   1. UPDATE venue_claims SET status = 'approved'
--   2. UPDATE venues SET claimed_by = userId
--   3. UPDATE profiles SET is_business_owner = true
--
-- If step 2 or 3 failed (network drop, RLS change), step 1 had already
-- committed. The claim disappeared from the admin queue but ownership was
-- never set — a silent data inconsistency requiring manual support intervention.
--
-- This function wraps all three in a transaction. It either succeeds fully
-- or rolls back entirely. The client mutation becomes one RPC call.
--
-- SECURITY
-- --------
-- SECURITY DEFINER so the function can update venues.claimed_by and
-- profiles.is_business_owner even though the RLS policies on those tables
-- restrict writes to the row owner. The function validates the caller is an
-- admin before proceeding.
--
-- SET search_path = extensions, public to prevent search_path injection.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.review_venue_claim(
  p_claim_id    uuid,
  p_decision    text,
  p_admin_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_venue_id uuid;
  v_user_id  uuid;
BEGIN
  -- Validate decision value
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision: must be approved or rejected'
      USING errcode = 'check_violation';
  END IF;

  -- Validate caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required'
      USING errcode = 'insufficient_privilege';
  END IF;

  -- Lock the claim row and fetch venue/user IDs
  SELECT venue_id, user_id
    INTO v_venue_id, v_user_id
    FROM public.venue_claims
   WHERE id = p_claim_id
     AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim not found or already processed'
      USING errcode = 'no_data_found';
  END IF;

  -- Step 1: Update claim status
  UPDATE public.venue_claims
     SET status      = p_decision,
         admin_notes = p_admin_notes,
         reviewed_at = now()
   WHERE id = p_claim_id;

  -- Steps 2 & 3: Only on approval
  IF p_decision = 'approved' THEN
    UPDATE public.venues
       SET claimed_by = v_user_id
     WHERE id = v_venue_id;

    UPDATE public.profiles
       SET is_business_owner = true
     WHERE id = v_user_id;
  END IF;
END;
$$;

-- Only admins should call this function — anon/authenticated get no execute.
REVOKE EXECUTE ON FUNCTION public.review_venue_claim(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.review_venue_claim(uuid, text, text) TO authenticated;
