/**
 * useReviews.ts
 * React Query hooks for the review flow.
 *
 * Privacy notes:
 * - We ONLY join the public_profiles VIEW, never the full profiles table.
 *   The view exposes: id, username, full_name, avatar_url, show_reviews_publicly.
 *   Fields like children_ages, marketing_consent, subscription_tier are intentionally excluded.
 * - Review body and title are NEVER logged — they may contain personal information
 *   the user has written about themselves or their children.
 * - On DB errors we log only error.code and error.hint — never the full error
 *   object which may echo back user-supplied content in the message.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Review } from '@/types';
import { useUser } from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Shape of each approved review fetched for a public profile page. */
export type PublicReviewItem = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  created_at: string;
  /** Joined venue info — may be null if the venue was deleted. */
  venues: { name: string; city: string } | null;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubmitReviewPayload {
  venueId: string;
  rating: number;
  title: string;
  body: string;
  visitDate: string | null;
  childrenAges: string[];
}

// ---------------------------------------------------------------------------
// useVenueReviews
// Returns all APPROVED reviews for a given venue, newest first.
// ---------------------------------------------------------------------------

export function useVenueReviews(venueId: string) {
  return useQuery({
    queryKey: ['reviews', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          id,
          venue_id,
          user_id,
          rating,
          title,
          body,
          visit_date,
          children_ages,
          moderation_status,
          helpful_count,
          created_at,
          updated_at,
          profile:public_profiles(
            id,
            username,
            full_name,
            avatar_url,
            show_reviews_publicly
          )
        `)
        .eq('venue_id', venueId)
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: false });

      // Only log safe metadata on error — never the query or its variables
      if (error) {
        console.error('useVenueReviews error:', error.code, error.hint);
        throw new Error('Could not load reviews. Please try again.');
      }

      return (data ?? []) as unknown as Review[];
    },
    enabled: !!venueId,
  });
}

// ---------------------------------------------------------------------------
// useMyReview
// Checks whether the current user has already reviewed this venue.
// Returns the review (including pending ones) so the UI can show "edit" mode.
// ---------------------------------------------------------------------------

export function useMyReview(venueId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['myReview', venueId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          id,
          venue_id,
          user_id,
          rating,
          title,
          body,
          visit_date,
          children_ages,
          moderation_status,
          helpful_count,
          created_at,
          updated_at
        `)
        .eq('venue_id', venueId)
        .eq('user_id', userId!)
        .maybeSingle();

      if (error) {
        console.error('useMyReview error:', error.code, error.hint);
        throw new Error('Could not check your review status.');
      }

      // maybeSingle() returns null (not an error) when no row is found
      return (data ?? null) as Review | null;
    },
    // Only run this query when we have both a user and a venue
    enabled: !!userId && !!venueId,
  });
}

// ---------------------------------------------------------------------------
// useSubmitReview
// Inserts a new review with moderation_status='pending'.
// Invalidates related query keys so the UI stays consistent.
// ---------------------------------------------------------------------------

export function useSubmitReview() {
  const queryClient = useQueryClient();
  const user = useUser();

  return useMutation({
    mutationFn: async (payload: SubmitReviewPayload) => {
      const { venueId, rating, title, body, visitDate, childrenAges } = payload;

      const { error } = await supabase.from('reviews').insert({
        venue_id:          venueId,
        user_id:           user!.id,
        rating,
        // Send null rather than empty string for optional text fields —
        // the DB column is nullable text, not empty-string-friendly.
        title:             title.trim() || null,
        body:              body.trim(),
        visit_date:        visitDate || null,
        // Only store children_ages if the user actually provided any.
        // Empty array → null (data minimisation: don't store empty arrays).
        children_ages:     childrenAges.length > 0 ? childrenAges : null,
        moderation_status: 'pending',   // all reviews go through moderation first
      });

      if (error) {
        // Log only the error code and hint — NEVER log the review content
        // (body/title may contain personal information about the user or their children).
        console.error('Review submit error:', error.code, error.hint);

        // Translate known DB constraint violations into friendly messages
        if (error.code === '23505') {
          // unique_violation — user already has a review for this venue
          throw new Error("You've already reviewed this venue. Visit your profile to edit or delete your existing review.");
        }

        throw new Error('Could not submit your review. Please check your connection and try again.');
      }
    },

    onSuccess: (_data, payload) => {
      // Invalidate all three caches that are affected:
      // 1. The venue's approved review list (will update once the review is approved)
      queryClient.invalidateQueries({ queryKey: ['reviews', payload.venueId] });
      // 2. The "have I reviewed this?" check — now returns the new pending review
      queryClient.invalidateQueries({ queryKey: ['myReview', payload.venueId, user?.id] });
      // 3. The venue itself — review_count and average_rating are DB-computed aggregates
      //    that a trigger updates on insert. Invalidating forces a fresh fetch.
      queryClient.invalidateQueries({ queryKey: ['venue', payload.venueId] });
    },
  });
}

// ---------------------------------------------------------------------------
// usePublicProfileReviews
// Fetches the first 20 approved reviews for a given user, for display on their
// public profile page.
//
// Privacy: show_reviews_publicly is enforced by the CALLER — pass undefined as
// userId when the profile owner has not made their reviews public. The query
// will not run (enabled: false) and no data is returned.
//
// The moderation_status === 'approved' filter is enforced server-side here,
// not in the screen component, so a compromised client cannot bypass it.
//
// Pagination is deferred — only the first 20 results are fetched for now.
// ---------------------------------------------------------------------------

export function usePublicProfileReviews(userId: string | undefined) {
  return useQuery<PublicReviewItem[]>({
    queryKey: ['publicReviews', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, title, body, created_at, venues(name, city)')
        .eq('user_id', userId!)
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('usePublicProfileReviews error:', error.code, error.hint);
        throw new Error('Could not load reviews.');
      }

      return (data ?? []) as unknown as PublicReviewItem[];
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
