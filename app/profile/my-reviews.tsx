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
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';

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
            { color: star <= rating ? Colors.star : Colors.label4 },
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
            <ActivityIndicator color={Colors.accent} size="large" />
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
    backgroundColor: Colors.bg,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: Colors.label2,
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
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: Colors.label2,
    textAlign: 'center',
  },
  emptyLink: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: Colors.accent,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.section,
    borderWidth: 1,
    borderColor: Colors.separator,
    padding: 16,
    marginBottom: 12,
  },
  badgeDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dateText: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label3,
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
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: Colors.label,
    marginBottom: 4,
  },
  reviewBody: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: Colors.label2,
    lineHeight: 19,
    marginBottom: 8,
  },
  deleteButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  deleteText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 12,
    color: Colors.coral,
  },
  rejectionNote: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
  },
  rejectionLabel: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    color: Colors.coral,
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: Colors.label2,
    lineHeight: 18,
  },
});
