/**
 * ReviewCard.tsx
 * Displays a single review in the venue detail screen's review list.
 *
 * Privacy notes:
 * - Display name respects profile.show_reviews_publicly — if false, we always
 *   show "Anonymous" regardless of whether username is set. This matches the
 *   user's privacy preference set in their profile settings.
 * - We show initials-only placeholder instead of avatar images. Avatar URLs
 *   are intentionally not rendered here to avoid fetching third-party images
 *   and to keep the initial build simple. Add image support only after a
 *   privacy impact review of the Storage URL exposure.
 * - We never display user_id — it is a database internal identifier.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Review } from '@/types';
import { formatMonthYear, getInitials, AVATAR_COLOURS } from '@/lib/utils';

interface ReviewCardProps {
  review: Review;
  /**
   * Navigation injected by the parent — ReviewCard itself has no router dependency.
   * When provided, tapping the reviewer avatar/name navigates to their public profile.
   * When absent, the avatar/name block is non-interactive (existing behaviour).
   */
  onPressReviewer?: () => void;
}

/**
 * Derives the safe display name for a reviewer.
 *
 * Priority order (most restrictive first):
 *   1. is_anonymous === true  → "Anonymous parent" (reviewer's per-review opt-out,
 *      persisted in the DB via migration 038 and the "Post anonymously" toggle).
 *   2. show_reviews_publicly === false → "Anonymous parent" (user's global
 *      profile preference — must be honoured even if a username exists).
 *   3. profile absent (deleted account) → "Anonymous parent".
 *   4. profile present, show_reviews_publicly true → username ?? full_name ?? "Anonymous parent".
 *
 * Using a single label "Anonymous parent" (not just "Anonymous") provides a
 * privacy-safe, context-appropriate display that is consistent across all
 * anonymisation paths.
 */
function getDisplayName(review: Review): string {
  // Per-review anonymity: reviewer explicitly ticked "Post anonymously"
  if (review.is_anonymous) return 'Anonymous parent';
  const profile = review.profile;
  if (!profile) return 'Anonymous parent';
  // Global privacy preference: user opted out of public review identification
  if (profile.show_reviews_publicly === false) return 'Anonymous parent';
  return profile.username ?? profile.full_name ?? 'Anonymous parent';
}

/** Renders filled/empty star characters for a 1–5 rating. Clamped to prevent RangeError. */
const StarDisplay = React.memo(function StarDisplay({ rating }: { rating: number }) {
  const clamped = Math.min(5, Math.max(0, rating));
  return (
    <Text style={styles.stars}>
      {'★'.repeat(clamped)}{'☆'.repeat(5 - clamped)}
    </Text>
  );
});

export const ReviewCard = React.memo(function ReviewCard({ review, onPressReviewer }: ReviewCardProps) {
  const displayName = getDisplayName(review);
  const initials    = getInitials(displayName);
  const monthYear   = formatMonthYear(review.created_at);
  const avatarColour = AVATAR_COLOURS[displayName.length % AVATAR_COLOURS.length];

  // The avatar+name block becomes tappable when a navigation handler is provided
  // AND the reviewer is not anonymous (anonymous reviewers have opted out of
  // public identification — navigating to their profile would violate that preference).
  // isAnonymousDisplay covers all anonymisation paths: is_anonymous flag,
  // show_reviews_publicly=false, and missing profile.
  const isAnonymousDisplay = displayName === 'Anonymous parent';

  const ReviewerBlock = (
    <>
      {/* Initials placeholder — dynamic colour derived from display name length */}
      <View style={[styles.avatarPlaceholder, { backgroundColor: avatarColour }]}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>

      <View style={styles.nameBlock}>
        <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
        {monthYear ? (
          <Text style={styles.dateMeta}>{monthYear}</Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View style={styles.card}>
      {/* Top row: avatar placeholder + name + date */}
      {onPressReviewer && !isAnonymousDisplay ? (
        <TouchableOpacity
          style={styles.topRow}
          onPress={onPressReviewer}
          accessibilityRole="button"
          accessibilityLabel={`View ${displayName}'s profile`}
        >
          {ReviewerBlock}
        </TouchableOpacity>
      ) : (
        <View style={styles.topRow}>
          {ReviewerBlock}
        </View>
      )}

      {/* Star rating */}
      <StarDisplay rating={review.rating} />

      {/* Optional title */}
      {review.title ? (
        <Text style={styles.reviewTitle}>{review.title}</Text>
      ) : null}

      {/* Review body */}
      <Text style={styles.reviewBody}>{review.body}</Text>

      {/* Bottom row: moderation badge and helpfulness count */}
      <View style={styles.bottomRow}>
        {review.moderation_status === 'pending' && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>Awaiting moderation</Text>
          </View>
        )}

        {review.helpful_count > 0 && (
          <Text style={styles.helpfulText}>
            {review.helpful_count} {review.helpful_count === 1 ? 'person' : 'people'} found this helpful
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    // Subtle shadow so the card lifts off the sand background
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  // Circular coloured placeholder — backgroundColor is applied dynamically
  // via inline style (name-length-based palette). See AVATAR_COLOURS in lib/utils.
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2D3436',   // charcoal
  },
  nameBlock: {
    flex: 1,
  },
  displayName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3436',   // charcoal
  },
  dateMeta: {
    fontSize: 12,
    color: '#636E72',   // grey
    marginTop: 1,
  },
  stars: {
    fontSize: 16,
    color: '#FF6B6B',   // coral
    letterSpacing: 1,
    marginBottom: 6,
  },
  reviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 4,
  },
  reviewBody: {
    fontSize: 14,
    color: '#2D3436',
    lineHeight: 20,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 8,
  },
  pendingBadge: {
    backgroundColor: '#FFF9F0',   // sand — low-contrast, unobtrusive
    borderWidth: 1,
    borderColor: '#DFE6E9',        // greyLighter
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingBadgeText: {
    fontSize: 11,
    color: '#636E72',   // grey
  },
  helpfulText: {
    fontSize: 12,
    color: '#636E72',
  },
});
