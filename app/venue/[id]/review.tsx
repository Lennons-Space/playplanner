/**
 * app/venue/[id]/review.tsx
 * Route screen for writing a review about a specific venue.
 *
 * Expo Router reads the [id] segment from the URL, which is the venue UUID.
 * Navigation: /venue/<venueId>/review
 *
 * Auth gate: we do NOT auto-redirect to login. We explain what is needed and
 * let the user choose to go back. Auto-redirects during modals can create
 * confusing back-stack issues on mobile.
 *
 * Duplicate review gate: the DB has a unique constraint (user_id, venue_id)
 * so a second insert would fail with a 23505 error anyway. We check upfront
 * with useMyReview to give a better UX than waiting for a DB error.
 */
import { Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVenue } from '@/hooks/useVenues';
import { useMyReview } from '@/hooks/useReviews';
import { useUser } from '@/hooks/useAuth';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { Colors } from '@/constants/theme';

export default function WriteReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user    = useUser();

  // Fetch venue so we can display its name in the form header
  const { data: venue, isLoading: venueLoading } = useVenue(id);

  // Check if this user already has a review for this venue
  const { data: myReview, isLoading: reviewLoading } = useMyReview(id, user?.id);

  // -------------------------------------------------------------------------
  // Auth gate — unauthenticated users see an explanation, not a redirect
  // -------------------------------------------------------------------------

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg text-center mb-3">
          Sign in to write a review
        </Text>
        <Text className="text-grey text-center mb-6">
          You need to be signed in to share your experience with other parents.
        </Text>
        <TouchableOpacity
          className="bg-sky rounded-2xl px-8 py-3"
          onPress={() => router.back()}
        >
          <Text className="text-white font-bold">Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Loading state — wait for both venue name and duplicate-review check
  // -------------------------------------------------------------------------

  if (venueLoading || reviewLoading) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center">
        <ActivityIndicator color={Colors.sky} size="large" />
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Own-venue gate — a venue owner must not review their own venue.
  //
  // We check BOTH claimed_by (set when a business claims a venue) and
  // submitted_by (set when the venue was originally submitted by this user).
  // Both are checked so that a submitted-but-unclaimed venue cannot be
  // self-reviewed either. Neither field is sensitive — they are user IDs only.
  //
  // This is a UI gate. The primary enforcement is a DB RLS policy / trigger,
  // but this guard gives a clear, honest message rather than a confusing error.
  // -------------------------------------------------------------------------

  const isOwnVenue =
    (venue?.claimed_by   && venue.claimed_by   === user.id) ||
    (venue?.submitted_by && venue.submitted_by === user.id);

  if (isOwnVenue) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg text-center mb-3">
          You can't review your own venue
        </Text>
        <Text className="text-grey text-center mb-6">
          To keep reviews trustworthy for families, venue owners and submitters
          aren't able to review their own venues.
        </Text>
        <TouchableOpacity
          className="bg-coral rounded-2xl px-8 py-3"
          onPress={() => router.back()}
        >
          <Text className="text-white font-bold">Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Duplicate review gate — user has already reviewed this venue
  // -------------------------------------------------------------------------

  if (myReview) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg text-center mb-3">
          You've already reviewed this venue
        </Text>
        <Text className="text-grey text-center mb-2">
          {myReview.moderation_status === 'pending'
            ? 'Your review is waiting for moderation. It will appear here once approved.'
            : 'Visit your profile to edit or delete your existing review.'}
        </Text>
        <TouchableOpacity
          className="mt-4 bg-coral rounded-2xl px-8 py-3"
          onPress={() => router.back()}
        >
          <Text className="text-white font-bold">Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Main form
  // -------------------------------------------------------------------------

  return (
    <ReviewForm
      venueId={id}
      venueName={venue?.name ?? ''}
      onSuccess={() => router.back()}
    />
  );
}
