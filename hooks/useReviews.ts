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
  /**
   * Whether the reviewer posted this review anonymously (migration 038).
   * The caller MUST filter out (or redact) reviews where is_anonymous === true
   * before displaying them on another user's public profile page — showing them
   * attributed would break the anonymity promise made to the reviewer
   * (GDPR Art.5(1)(a) transparency and Art.5(1)(b) purpose limitation).
   */
  is_anonymous: boolean;
  /** Joined venue info — may be null if the venue was deleted. */
  venues: { name: string; city: string } | null;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubmitReviewPayload {
  venueId: string;
  /**
   * The UUID of the user who has claimed this venue, if any.
   * Passed by the caller (review screen) so the hook can enforce the
   * own-venue guard without a second network round-trip.
   * Belt-and-braces: the DB RLS policy (migration 009) is the primary
   * enforcement; this is a second layer in case the screen guard is bypassed.
   */
  venueClaimedBy: string | null | undefined;
  /**
   * The UUID of the user who originally submitted this venue, if any.
   * Also checked to prevent a submitter self-reviewing before a claim exists.
   */
  venueSubmittedBy: string | null | undefined;
  rating: number;
  title: string;
  body: string;
  visitDate: string | null;
  childrenAges: string[];
  tags: string[];
  /**
   * Whether the reviewer chose "Post anonymously".
   * Persisted as is_anonymous on the reviews row (migration 038).
   * When true, display logic must show "Anonymous parent" instead of the
   * reviewer's real name — this is a privacy promise made in the UI and
   * must be honoured end-to-end (GDPR Art.5(1)(a) transparency).
   */
  anonymous: boolean;
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
          is_anonymous,
          moderation_status,
          helpful_count,
          created_at,
          updated_at,
          profile:public_profiles!reviews_user_id_fkey(
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

      return (data ?? []) as Review[];
    },
    enabled: !!venueId,
    // Reviews are fetched on every venue-detail visit. Without staleTime React
    // Query treats data as stale immediately, refetching on every navigation.
    // 60 seconds matches useVenue and useVenuePhotos. Explicit invalidation in
    // useSubmitReview and useModerateReview bypasses this when data really changes.
    staleTime: 60_000,
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
      // Guard against a null session — the user may have been signed out or
      // their token revoked between when the form rendered and when they tapped
      // submit. The Supabase insert would also fail server-side with an expired
      // JWT, but failing early gives a clearer user-facing message.
      if (!user?.id) {
        throw new Error('Your session has expired. Please sign in again to submit a review.');
      }

      // Hook-level own-venue guard (belt-and-braces).
      // The primary enforcement is the DB RLS policy in migration 009.
      // This layer surfaces a clear error if the screen guard is bypassed
      // (e.g. direct API call routed through this hook, or a future UI bug).
      if (
        (payload.venueClaimedBy   && payload.venueClaimedBy   === user.id) ||
        (payload.venueSubmittedBy && payload.venueSubmittedBy === user.id)
      ) {
        throw new Error('OWNER_REVIEW_NOT_ALLOWED');
      }

      const { venueId, rating, title, body, visitDate, childrenAges, tags, anonymous } = payload;

      const { error } = await supabase.from('reviews').insert({
        venue_id:          venueId,
        user_id:           user.id,
        rating,
        // Send null rather than empty string for optional text fields —
        // the DB column is nullable text, not empty-string-friendly.
        title:             title.trim() || null,
        body:              body.trim(),
        visit_date:        visitDate || null,
        // Only store children_ages if the user actually provided any.
        // Empty array → null (data minimisation: don't store empty arrays).
        children_ages:     childrenAges.length > 0 ? childrenAges : null,
        // Data minimisation: store null rather than an empty array for tags.
        tags:              tags.length > 0 ? tags : null,
        // Persist the reviewer's anonymity choice (migration 038).
        // Display logic must honour this flag — "Anonymous parent" shown when true.
        is_anonymous:      anonymous,
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
// useModerateReview
// Admin-only: approve or reject a pending review.
// ---------------------------------------------------------------------------

interface ModerateReviewPayload {
  reviewId: string;
  status: 'approved' | 'rejected';
  moderation_notes?: string;
}

/**
 * Approves or rejects a pending review.
 * Only callable by admin users — the DB "Admins can update any review" RLS
 * policy enforces this server-side; this hook is a UI convenience.
 *
 * On success: invalidates both the admin pending-reviews query (removes the
 * item from the queue) and the venue's public review list (if approved, it
 * should appear immediately for regular users).
 *
 * WHY .select('id') is chained on the update:
 *   Without it, Supabase sends Prefer: return=minimal and PostgREST returns
 *   204 No Content regardless of how many rows were actually updated. A
 *   silent RLS filter (e.g. admin flag missing from the JWT) would look like
 *   a successful approve with no visible change. Chaining .select('id')
 *   forces PostgREST to return the affected row; an empty result means the
 *   write was blocked and we surface a real error instead of a no-op.
 */
export function useModerateReview() {
  const queryClient = useQueryClient();
  const user = useUser();

  return useMutation({
    mutationFn: async ({ reviewId, status, moderation_notes }: ModerateReviewPayload) => {
      if (!user?.id) {
        throw new Error('Admin session has expired. Sign out and back in, then try again.');
      }
      const { data, error } = await supabase
        .from('reviews')
        .update({
          moderation_status: status,
          moderation_notes:  moderation_notes?.trim() || null,
          moderated_by:      user.id,
          moderated_at:      new Date().toISOString(),
        })
        .eq('id', reviewId)
        .select('id');

      if (error) {
        // Only log code/message/hint — NEVER log the row (body may contain
        // personal information about the user or their children).
        console.error('useModerateReview error:', error.code, error.message);
        throw new Error('Could not moderate review. Please try again.');
      }

      // Zero rows = RLS silently filtered the write (auth/admin drift).
      // Fail loud instead of pretending it worked.
      if (!data || data.length === 0) {
        throw new Error('No review updated — your admin permissions may have changed. Sign out and back in, then try again.');
      }

      // Fire-and-forget notification — a send failure must never block the moderation action.
      if (status === 'approved') {
        supabase.functions
          .invoke('notify-review-published', { body: { reviewId } })
          .catch((err: unknown) => {
            console.warn('[useModerateReview] notify-review-published failed:', (err as Error).message);
          });
      }
    },

    onSuccess: () => {
      // Remove from admin queue
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-reviews'] });
      // Public venue review lists may now include/exclude this review
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      // Also refresh the reviewer's "My Reviews" screen so the rejection
      // note / approved status appears to them immediately (GDPR Art.13).
      queryClient.invalidateQueries({ queryKey: ['myReview'] });
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
        // is_anonymous is required so the caller can filter out anonymous reviews
        // before rendering them on another user's public profile. Without it the
        // server would return the review content without the flag, making it
        // impossible to honour the anonymity promise at the display layer.
        .select('id, rating, title, body, created_at, is_anonymous, venues(name, city)')
        .eq('user_id', userId!)
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('usePublicProfileReviews error:', error.code, error.hint);
        throw new Error('Could not load reviews.');
      }

      return (data ?? []) as PublicReviewItem[];
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
