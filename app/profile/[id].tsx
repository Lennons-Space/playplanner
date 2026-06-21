/**
 * Public Profile screen — app/profile/[id].tsx
 *
 * Read-only view of another user's public profile.
 *
 * Privacy notes:
 *   - Reads ONLY from the `public_profiles` VIEW via usePublicProfile hook.
 *     The view intentionally excludes: children_ages, is_admin,
 *     subscription_tier, marketing_consent, postcode, and stripe_customer_id.
 *     We never query the full `profiles` table for another user.
 *   - If the hook returns null (user not found OR profile not visible), we show
 *     "This profile is private". We make no distinction between "not found" and
 *     "private" — this prevents user enumeration attacks.
 *   - Reviews only appear when show_reviews_publicly === true AND
 *     moderation_status === 'approved'. Pending/rejected reviews never show.
 *   - No children's data (ages, names) can appear here — it is excluded at the
 *     DB view level, so even a compromised client cannot access it.
 *
 * ICO Children's Code Standard 9 (high privacy by default):
 *   Profile data is hidden unless the user has explicitly made it public.
 */

import { useLocalSearchParams, Stack, router } from 'expo-router';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePublicProfile } from '@/hooks/useProfile';
import { usePublicProfileReviews, type PublicReviewItem } from '@/hooks/useReviews';
import { formatMonthYear, getInitials, AVATAR_COLOURS } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fills ★ and ☆ characters for a 1–5 rating. Clamped to prevent RangeError. */
function starString(rating: number): string {
  const clamped = Math.min(5, Math.max(0, rating));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

function getAvatarColour(name: string): string {
  return AVATAR_COLOURS[name.length % AVATAR_COLOURS.length];
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PublicProfileScreen() {
  // Expo Router provides the [id] segment as a query param.
  // useLocalSearchParams can return string | string[] at runtime even with a
  // typed generic, so we normalise to a plain string here.
  const { id } = useLocalSearchParams<{ id: string }>();
  const profileId = Array.isArray(id) ? id[0] : id;

  // ---- Fetch public profile ------------------------------------------------
  const {
    data: profile,
    isLoading: profileLoading,
    isError: profileError,
    refetch: refetchProfile,
  } = usePublicProfile(profileId);

  // ---- Fetch public reviews (server-side enforcement) ----------------------
  // Pass profileId only when the profile has opted into public reviews.
  // When undefined is passed the hook's `enabled` is false and no query runs.
  const reviewsUserId =
    profile?.show_reviews_publicly === true ? profileId : undefined;

  const {
    data: reviews,
    isLoading: reviewsLoading,
  } = usePublicProfileReviews(reviewsUserId);

  // ---- Dynamic screen title ------------------------------------------------
  const screenTitle = profile?.username ? `@${profile.username}` : 'Profile';

  // ---- Display name and avatar ---------------------------------------------
  const displayName = profile?.full_name ?? profile?.username ?? 'Parent';
  const avatarColour = getAvatarColour(displayName);
  const initials = getInitials(displayName);

  // ---- Loading state -------------------------------------------------------
  if (profileLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <SafeAreaView style={styles.centreContainer} edges={['top', 'bottom']}>
          <ActivityIndicator size="large" color="#4ECDC4" />
        </SafeAreaView>
      </>
    );
  }

  // ---- Error state ---------------------------------------------------------
  if (profileError) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <SafeAreaView style={styles.centreContainer} edges={['top', 'bottom']}>
          <Text style={styles.errorText}>Could not load this profile.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetchProfile()}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </>
    );
  }

  // ---- Private / not-found state ------------------------------------------
  // We make no distinction between "private" and "not found" — this prevents
  // an attacker from enumerating which user IDs exist in the database.
  if (!profile) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <SafeAreaView style={styles.centreContainer} edges={['top', 'bottom']}>
          <Text style={styles.lockEmoji}>🔒</Text>
          <Text style={styles.privateTitle}>This profile is private</Text>
          <Text style={styles.privateSubtext}>
            This person has chosen to keep their profile private.
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </>
    );
  }

  // ---- Loaded state --------------------------------------------------------
  const memberSince = formatMonthYear(profile.created_at);
  // Filter out anonymous reviews once — the same slice is used for both the
  // section header count and the list items. Anonymous reviews must never be
  // traceable back to the author on another user's public profile page.
  // (GDPR Art.5(1)(a) — transparency; the reviewer was told their identity would be hidden.)
  const publicReviews = (reviews ?? []).filter((r) => !r.is_anonymous);
  const reviewCount = publicReviews.length;

  // ---- FlatList data -------------------------------------------------------
  // When reviews are public we show the list (or a loading/empty state).
  // When private we show a single "private" card.
  // The header (avatar, bio, section label) is rendered via ListHeaderComponent.
  type ListItem =
    | { type: 'loading' }
    | { type: 'empty' }
    | { type: 'private' }
    | { type: 'review'; review: PublicReviewItem };

  let listData: ListItem[];

  if (profile.show_reviews_publicly === false) {
    listData = [{ type: 'private' }];
  } else if (reviewsLoading) {
    listData = [{ type: 'loading' }];
  } else if (publicReviews.length === 0) {
    listData = [{ type: 'empty' }];
  } else {
    listData = publicReviews.map((r) => ({ type: 'review' as const, review: r }));
  }

  const ListHeader = (
    <>
      {/* ---- Profile header ---- */}
      <View style={styles.header}>
        {/* Initials avatar — no photo URLs to avoid CDN/privacy issues */}
        <View style={[styles.avatar, { backgroundColor: avatarColour }]}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>

        <Text style={styles.displayName}>{displayName}</Text>

        {profile.username && (
          <Text style={styles.username}>@{profile.username}</Text>
        )}

        {/* Business owner badge */}
        {profile.is_business_owner && (
          <View style={styles.businessBadge}>
            <Text style={styles.businessBadgeText}>Business owner</Text>
          </View>
        )}

        {/* Member since date — from public_profiles.created_at */}
        {memberSince ? (
          <Text style={styles.memberSince}>Member since {memberSince}</Text>
        ) : null}
      </View>

      {/* ---- Bio ---- */}
      {profile.bio ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>ABOUT</Text>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      ) : null}

      {/* ---- Reviews section label ---- */}
      <Text style={styles.sectionLabel}>
        REVIEWS{reviewCount > 0 ? ` (${reviewCount})` : ''}
      </Text>
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title: screenTitle }} />
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <FlatList<ListItem>
          data={listData}
          keyExtractor={(item, index) =>
            item.type === 'review' ? item.review.id : `${item.type}-${index}`
          }
          contentContainerStyle={styles.scrollContent}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => {
            if (item.type === 'private') {
              return (
                <View style={styles.card}>
                  <Text style={styles.privateReviewsText}>
                    This member has chosen to keep their reviews private.
                  </Text>
                </View>
              );
            }
            if (item.type === 'loading') {
              return <ActivityIndicator color="#4ECDC4" style={{ marginTop: 16 }} />;
            }
            if (item.type === 'empty') {
              return (
                <View style={styles.card}>
                  <Text style={styles.emptyText}>No public reviews yet.</Text>
                </View>
              );
            }
            return <ReviewItem review={item.review} />;
          }}
        />
      </SafeAreaView>
    </>
  );
}

// ---------------------------------------------------------------------------
// ReviewItem — inline review card for the public profile page
// ---------------------------------------------------------------------------

/**
 * Renders a single approved review on the public profile page.
 * Intentionally read-only — no edit/delete controls (this is not the user's own profile).
 *
 * Privacy: children_ages is NOT selected in the reviews query, so it cannot
 * appear here even by accident. Only venue name, rating, title, body, and date.
 */
function ReviewItem({ review }: { review: PublicReviewItem }) {
  const venue = review.venues;
  const date  = formatMonthYear(review.created_at);
  const stars = starString(review.rating);

  return (
    <View style={styles.reviewCard}>
      {/* Venue name + city */}
      {venue && (
        <Text style={styles.reviewVenueName} numberOfLines={1}>
          {venue.name}
          {venue.city ? ` · ${venue.city}` : ''}
        </Text>
      )}

      {/* Star rating */}
      <Text style={styles.reviewStars}>{stars}</Text>

      {/* Optional review title */}
      {review.title ? (
        <Text style={styles.reviewTitle}>{review.title}</Text>
      ) : null}

      {/* Review body — max 4 lines on public profile */}
      <Text style={styles.reviewBody} numberOfLines={4}>{review.body}</Text>

      {/* Date */}
      {date ? (
        <Text style={styles.reviewDate}>{date}</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F0F7F7',   // slate
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // ---- Centre-aligned full-screen states ----
  centreContainer: {
    flex: 1,
    backgroundColor: '#F0F7F7',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#636E72',
    fontFamily: 'Nunito-Regular',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#4ECDC4',
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
  },

  // ---- Private profile state ----
  lockEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  privateTitle: {
    fontSize: 20,
    fontFamily: 'Nunito-Bold',
    color: '#2D3436',
    marginBottom: 8,
    textAlign: 'center',
  },
  privateSubtext: {
    fontSize: 14,
    fontFamily: 'Nunito-Regular',
    color: '#636E72',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  backButton: {
    borderWidth: 1.5,
    borderColor: '#4ECDC4',
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#4ECDC4',
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
  },

  // ---- Profile header ----
  header: {
    backgroundColor: '#4ECDC4',   // sky
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarInitials: {
    fontSize: 28,
    fontFamily: 'Nunito-Bold',
    color: '#2D3436',
  },
  displayName: {
    fontSize: 22,
    fontFamily: 'Nunito-ExtraBold',
    color: '#FFFFFF',
    marginBottom: 2,
    textAlign: 'center',
  },
  username: {
    fontSize: 14,
    fontFamily: 'Nunito-Regular',
    color: '#FFFFFF',
    opacity: 0.8,
    marginBottom: 6,
  },
  businessBadge: {
    backgroundColor: '#FFE66D',   // sun
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
    marginBottom: 6,
  },
  businessBadgeText: {
    fontSize: 12,
    fontFamily: 'Nunito-Bold',
    color: '#2D3436',
  },
  memberSince: {
    fontSize: 13,
    fontFamily: 'Nunito-Regular',
    color: '#FFFFFF',
    opacity: 0.75,
  },

  // ---- Generic card ----
  card: {
    backgroundColor: '#FFF9F0',   // sand
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Nunito-Bold',
    color: '#636E72',
    letterSpacing: 0.8,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  bioText: {
    fontSize: 15,
    fontFamily: 'Nunito-Regular',
    color: '#2D3436',
    lineHeight: 22,
  },

  // ---- Reviews section ----
  privateReviewsText: {
    fontSize: 14,
    fontFamily: 'Nunito-Regular',
    color: '#636E72',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Nunito-Regular',
    color: '#636E72',
    textAlign: 'center',
  },

  // ---- Individual review card ----
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  reviewVenueName: {
    fontSize: 13,
    fontFamily: 'Nunito-Bold',
    color: '#2D3436',
    marginBottom: 4,
  },
  reviewStars: {
    fontSize: 16,
    color: '#FF6B6B',   // coral
    letterSpacing: 1,
    marginBottom: 6,
  },
  reviewTitle: {
    fontSize: 15,
    fontFamily: 'Nunito-Bold',
    color: '#2D3436',
    marginBottom: 4,
  },
  reviewBody: {
    fontSize: 14,
    fontFamily: 'Nunito-Regular',
    color: '#2D3436',
    lineHeight: 20,
  },
  reviewDate: {
    fontSize: 12,
    fontFamily: 'Nunito-Regular',
    color: '#636E72',
    marginTop: 8,
  },
});
