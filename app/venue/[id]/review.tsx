/**
 * app/venue/[id]/review.tsx
 * Route screen for writing a review about a specific venue.
 *
 * Expo Router reads the [id] segment from the URL, which is the venue UUID.
 * Navigation: /venue/<venueId>/review
 *
 * Auth gate: we do NOT auto-redirect to login. We explain what is needed and
 * give the parent two options — go back or sign in directly. Auto-redirects
 * during modals can create confusing back-stack issues on mobile.
 *
 * Own-venue gate: we check BOTH claimed_by and submitted_by. The DB RLS policy
 * (migration 009) is the primary enforcement; this screen guard gives a clear
 * message rather than a confusing API error. The hook-level guard in
 * useSubmitReview is a third layer in case this screen is bypassed.
 *
 * Duplicate review gate: the DB has a unique constraint (user_id, venue_id)
 * so a second insert would fail with a 23505 error anyway. We check upfront
 * with useMyReview to give a better UX than waiting for a DB error.
 */
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVenue } from '@/hooks/useVenues';
import { useMyReview } from '@/hooks/useReviews';
import { useUser } from '@/hooks/useAuth';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { Icon } from '@/components/ui/Icon';

// ─── Design tokens ────────────────────────────────────────────────────────────
const pp = {
  ink:     '#1D2630',
  inkSoft: '#4A5560',
  mute:    '#7B8794',
  sand:    '#FBF6EC',
  paper:   '#FFFFFF',
  sky:     '#2FB8B0',
  skyWash: '#EEF9F8',
  skyDeep: '#1B8A85',
  coral:   '#FF6B6B',
  line:    '#E6E2DB',
  leaf:    '#5BC08A',
  leafWash:'#EDFAF3',
};

export default function WriteReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user    = useUser();

  // Fetch venue so we can display its name in the form header and check ownership
  const { data: venue, isLoading: venueLoading } = useVenue(id);

  // Check if this user already has a review for this venue
  const { data: myReview, isLoading: reviewLoading } = useMyReview(id, user?.id);

  // -------------------------------------------------------------------------
  // Auth gate — unauthenticated users see an explanation and two CTAs
  // -------------------------------------------------------------------------

  if (!user) {
    return (
      <SafeAreaView style={[styles.centred, { backgroundColor: pp.sand }]}>
        <Icon name="shield" size={40} color={pp.mute} />
        <Text style={styles.gateTitle}>Sign in to write a review</Text>
        <Text style={styles.gateSub}>
          You need to be signed in to share your experience with other parents.
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: pp.sky, marginBottom: 12 }]}
          onPress={() => router.push('/(auth)/login')}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text style={styles.btnText}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnOutline]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.btnOutlineText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Loading state — wait for both venue name and duplicate-review check
  // -------------------------------------------------------------------------

  if (venueLoading || reviewLoading) {
    return (
      <SafeAreaView style={[styles.centred, { backgroundColor: pp.sand }]}>
        <ActivityIndicator color={pp.sky} size="large" />
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
  // This is a UI gate. The primary enforcement is the DB RLS policy in
  // migration 009; the hook-level guard in useSubmitReview is a third layer.
  // -------------------------------------------------------------------------

  const isOwnVenue =
    (venue?.claimed_by   && venue.claimed_by   === user.id) ||
    (venue?.submitted_by && venue.submitted_by === user.id);

  if (isOwnVenue) {
    return (
      <SafeAreaView style={[styles.centred, { backgroundColor: pp.sand }]}>
        <Icon name="shield" size={40} color={pp.mute} />
        <Text style={styles.gateTitle}>Can't review your own venue</Text>
        <Text style={styles.gateSub}>
          As the listing owner, you're not able to write a review for this venue. This keeps
          reviews trustworthy for families.
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: pp.coral }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.btnText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Duplicate review gate — user has already reviewed this venue
  // -------------------------------------------------------------------------

  if (myReview) {
    const isApproved = myReview.moderation_status === 'approved';

    return (
      <SafeAreaView style={[styles.centred, { backgroundColor: pp.sand }]}>
        <Icon name="info" size={40} color={isApproved ? pp.leaf : pp.mute} />
        <Text style={styles.gateTitle}>You've already reviewed this venue</Text>

        {isApproved ? (
          // Green-tinted card for approved reviews — positive framing
          <View style={styles.approvedCard}>
            <Text style={styles.approvedCardText}>
              Your review is live and helping other families.
            </Text>
            <Text style={[styles.approvedCardText, { marginTop: 4, color: pp.inkSoft }]}>
              Visit your profile to edit or delete your existing review.
            </Text>
          </View>
        ) : (
          <Text style={styles.gateSub}>
            Your review is waiting for moderation. It will appear here once approved.
          </Text>
        )}

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: pp.coral, marginTop: isApproved ? 24 : 0 }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.btnText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Main form — pass ownership fields so the hook can enforce its own guard
  // -------------------------------------------------------------------------

  return (
    <ReviewForm
      venueId={id}
      venueName={venue?.name ?? ''}
      venueClaimedBy={venue?.claimed_by}
      venueSubmittedBy={venue?.submitted_by}
      onSuccess={() => router.back()}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  gateTitle: {
    fontFamily: 'Nunito-Bold',
    fontSize: 18,
    color: pp.ink,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 12,  // increased from 8 for better breathing room
  },
  gateSub: {
    fontFamily: 'Nunito-Regular',
    fontSize: 14,
    color: pp.mute,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  btn: {
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  btnText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: pp.paper,
  },
  btnOutline: {
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: pp.line,
    backgroundColor: pp.paper,
  },
  btnOutlineText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: pp.ink,
  },
  // Approved review — green-tinted info card
  approvedCard: {
    backgroundColor: pp.leafWash,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: pp.leaf,
    padding: 14,
    marginBottom: 24,
    width: '100%',
  },
  approvedCardText: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 13,
    color: pp.leaf,
    textAlign: 'center',
    lineHeight: 20,
  },
  inkSoft: {
    color: pp.inkSoft,
  },
});
