/**
 * My Reviews screen — app/profile/my-reviews.tsx
 *
 * GDPR Art.17 (right to erasure): each review has a delete button that
 * permanently removes it. The confirmation alert names the venue and makes
 * clear the action is irreversible, satisfying the transparency requirement.
 */
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { useMyReviews, useDeleteReview } from '@/hooks/useDataRights';
import { ModerationBadge } from '@/components/profile/ModerationBadge';

// ---------------------------------------------------------------------------
// Star rating helper
// ---------------------------------------------------------------------------

function StarRating({ rating }: { rating: number }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Text
          key={star}
          style={[
            styles.star,
            { color: star <= rating ? '#FF6B6B' : '#B2BEC3' },
          ]}
        >
          {star <= rating ? '★' : '☆'}
        </Text>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MyReviewsScreen() {
  const userId  = useAuthStore((s) => s.user?.id);
  const { data: reviews, isLoading, isError } = useMyReviews(userId);
  const { mutate: deleteReview } = useDeleteReview();

  function handleDelete(reviewId: string, venueName: string | null) {
    Alert.alert(
      'Delete this review?',
      `This will permanently remove your review of ${venueName ?? 'this venue'}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete review',
          style: 'destructive',
          onPress: () => {
            if (!userId) return;
            deleteReview({ reviewId, userId });
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'My Reviews' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>

        {/* Loading */}
        {isLoading && (
          <View style={styles.centred}>
            <ActivityIndicator color="#FF6B6B" size="large" />
          </View>
        )}

        {/* Error */}
        {isError && !isLoading && (
          <View style={styles.centred}>
            <Text style={styles.errorText}>
              Could not load your reviews. Please check your connection and try again.
            </Text>
          </View>
        )}

        {/* Content */}
        {!isLoading && !isError && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Empty state */}
            {(!reviews || reviews.length === 0) && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyHeading}>
                  You haven&apos;t written any reviews yet.
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/')}
                  accessibilityRole="link"
                  accessibilityLabel="Explore venues to write a review"
                >
                  <Text style={styles.emptyLink}>Explore venues →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Review cards */}
            {reviews && reviews.map((review: any) => (
              <View key={review.id} style={styles.card}>

                {/* Row 1: badge + date */}
                <View style={styles.badgeDateRow}>
                  <ModerationBadge status={review.moderation_status} />
                  <Text style={styles.dateText}>
                    {format(new Date(review.created_at), 'd MMM yyyy')}
                  </Text>
                </View>

                {/* Row 2: stars */}
                <StarRating rating={review.rating} />

                {/* Row 3: venue name */}
                <Text style={styles.venueName}>
                  {(review.venues as any)?.name ?? 'Unknown venue'}
                </Text>

                {/* Row 4: review body */}
                {review.body ? (
                  <Text style={styles.reviewBody} numberOfLines={2}>
                    {review.body}
                  </Text>
                ) : null}

                {/* Row 4b: rejection note — shown only when rejected and a reason exists.
                    GDPR Art.13 transparency: the user is entitled to know why their
                    content was not approved so they can understand the decision. */}
                {review.moderation_status === 'rejected' && review.moderation_notes ? (
                  <View style={styles.rejectionNote}>
                    <Text style={styles.rejectionLabel}>Reason for rejection</Text>
                    <Text style={styles.rejectionText}>{review.moderation_notes}</Text>
                  </View>
                ) : null}

                {/* Row 5: delete button */}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(review.id, (review.venues as any)?.name ?? null)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete review of ${(review.venues as any)?.name ?? 'this venue'}`}
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>

              </View>
            ))}
          </ScrollView>
        )}

      </SafeAreaView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF9F0',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 12,
  },
  emptyHeading: {
    fontFamily: 'Nunito-Medium',
    fontSize: 15,
    color: '#636E72',
    textAlign: 'center',
  },
  emptyLink: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#FF6B6B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  badgeDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dateText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: '#636E72',
  },
  starsRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  star: {
    fontSize: 16,
    marginRight: 1,
  },
  venueName: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#2D3436',
    marginBottom: 4,
  },
  reviewBody: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#636E72',
    lineHeight: 19,
    marginBottom: 8,
  },
  deleteButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  deleteText: {
    fontFamily: 'Nunito-Medium',
    fontSize: 12,
    color: '#D63031',
  },
  rejectionNote: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#D63031',
  },
  rejectionLabel: {
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: '#D63031',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#2D3436',
    lineHeight: 18,
  },
});
