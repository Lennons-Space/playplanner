/**
 * My Reviews screen — app/profile/my-reviews.tsx
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * useMyReviews/useDeleteReview queries, the delete-confirmation Alert, and
 * the "Explore venues" empty-state destination are byte-identical to the
 * pre-restyle version.
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
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { useMyReviews, useDeleteReview } from '@/hooks/useDataRights';
import { ModerationBadge } from '@/components/profile/ModerationBadge';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { V2Background } from '@/components/ui/V2Background';
import { V2Header } from '@/components/ui/V2Header';
import { Themes, FontFamily, ocean } from '@/constants/theme';

const T = Themes.dark;
const ACCENT = ocean;

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
            { color: star <= rating ? T.star : T.label4 },
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
    <View style={styles.root}>
      <V2Background />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <V2Header title="My Reviews" />

        {/* Loading */}
        {isLoading && (
          <View style={styles.centred}>
            <ActivityIndicator color={ACCENT.accent} size="large" />
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
              <GlassSurface key={review.id} style={styles.card} tintColor="rgba(14,14,20,0.55)">

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

              </GlassSurface>
            ))}
          </ScrollView>
        )}

      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label2,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
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
    color: T.label2,
    textAlign: 'center',
  },
  emptyLink: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: ACCENT.accent,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    // Wider than the original 12px gap — with the lighter 0.55 tint above,
    // this keeps the shared animated background visible between rows even
    // when the list is long, instead of reading as one solid stacked column.
    marginBottom: 16,
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
    color: T.label3,
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
    fontFamily: FontFamily.heading,
    fontSize: 15,
    color: T.label,
    marginBottom: 4,
  },
  reviewBody: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: T.label2,
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
    color: '#FF6B6B',
  },
  rejectionNote: {
    backgroundColor: 'rgba(255,178,62,0.12)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFB23E',
  },
  rejectionLabel: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    color: '#FFB23E',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: T.label2,
    lineHeight: 18,
  },
});
