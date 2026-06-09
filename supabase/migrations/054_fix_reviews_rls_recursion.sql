-- The INSERT policy "Users can write reviews" contains a rate-limit check:
--   SELECT count(*) FROM reviews WHERE user_id = auth.uid() ...
-- PostgreSQL's RLS engine marks `reviews` as "in use" while evaluating the
-- INSERT policy. The subquery then accesses `reviews`, triggering another
-- policy check on the same table → infinite recursion → 500 error.
--
-- Fix: extract the count into a SECURITY DEFINER function. SECURITY DEFINER
-- runs under the function owner's role (postgres, which has BYPASSRLS),
-- creating a separate execution context that breaks the recursion.

CREATE OR REPLACE FUNCTION public.user_review_count_today()
  RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT count(*)
  FROM public.reviews
  WHERE user_id = auth.uid()
    AND created_at > now() - interval '24 hours';
$$;

-- Recreate the INSERT policy using the function instead of the inline subquery.
DROP POLICY IF EXISTS "Users can write reviews" ON public.reviews;

CREATE POLICY "Users can write reviews" ON public.reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND moderation_status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.venues
      WHERE venues.id = reviews.venue_id
        AND (venues.claimed_by = auth.uid() OR venues.submitted_by = auth.uid())
    )
    AND user_review_count_today() < 10
  );
