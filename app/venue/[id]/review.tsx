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
 *
 * v2 dark restyle (Step 9, feat/exact-v2-design): VISUAL LAYER ONLY. Every
 * gate condition, wording, navigation target and the ownership/duplicate
 * checks above are byte-identical to the pre-restyle version — only the
 * JSX/styling changed. <V2Background/> is mounted per the frozen background
 * architecture (see app/(tabs)/profile.tsx / venue/add.tsx) behind a
 * transparent root in every gate state, dark tokens replace the old
 * cream/teal/coral palette, and each gate gains the standard v2 back
 * treatment (38px dark surface + hairline chevL, matching
 * app/explore/results.tsx and the venue detail screen) as its one
 * deliberate header — the loading spinner has none, matching the same
 * transient-state convention used elsewhere (e.g. PlanVisitScreen's
 * LoadingScreen).
 */
import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVenue } from '@/hooks/useVenues';
import { useMyReview } from '@/hooks/useReviews';
import { useUser } from '@/hooks/useAuth';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { Icon } from '@/components/ui/Icon';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { FontFamily, ocean, type ThemeTokens } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

// ─── Design tokens ────────────────────────────────────────────────────────────
const ACCENT = ocean;
// Positive accent for the approved-review card — same green used for "open
// now" state on venue detail / plan-visit.
const OPEN_GREEN = '#34C77B';

/**
 * The one deliberate header for every gate state — a small back affordance
 * in the standard v2 shape, matching app/explore/results.tsx and the venue
 * detail screen. The loading spinner (no header) and the eligible ReviewForm
 * (which supplies its own FlowHeader) do not use this.
 */
function GateHeader({ styles, T }: { styles: Styles; T: ThemeTokens }) {
  return (
    <View style={styles.gateHeaderRow}>
      <TouchableOpacity
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.gateHeaderBack}
      >
        <Icon name="chevL" size={18} color={T.label} />
      </TouchableOpacity>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

export default function WriteReviewScreen() {
  const { tokens: T } = useAppTheme();
  const styles = useMemo(() => createStyles(T), [T]);
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
      <View style={styles.outer}>
        <ThemedBackground />
        <SafeAreaView style={styles.root} edges={['top']}>
          <GateHeader styles={styles} T={T} />
          <View style={styles.centred}>
            <Icon name="shield" size={40} color={T.label3} />
            <Text style={styles.gateTitle}>Sign in to write a review</Text>
            <Text style={styles.gateSub}>
              You need to be signed in to share your experience with other parents.
            </Text>
            <TouchableOpacity
              style={[styles.btnPrimary, { marginBottom: 12 }]}
              onPress={() => router.push('/(auth)/login')}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              <Text style={styles.btnPrimaryText}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnOutline}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.btnOutlineText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Loading state — wait for both venue name and duplicate-review check
  // -------------------------------------------------------------------------

  if (venueLoading || reviewLoading) {
    return (
      <View style={styles.outer}>
        <ThemedBackground />
        <SafeAreaView style={styles.root} edges={['top']}>
          <View style={styles.centred}>
            <ActivityIndicator color={ACCENT.accent} size="large" />
          </View>
        </SafeAreaView>
      </View>
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
      <View style={styles.outer}>
        <ThemedBackground />
        <SafeAreaView style={styles.root} edges={['top']}>
          <GateHeader styles={styles} T={T} />
          <View style={styles.centred}>
            <Icon name="shield" size={40} color={T.label3} />
            <Text style={styles.gateTitle}>Can't review your own venue</Text>
            <Text style={styles.gateSub}>
              As the listing owner, you're not able to write a review for this venue. This keeps
              reviews trustworthy for families.
            </Text>
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.btnPrimaryText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Duplicate review gate — user has already reviewed this venue
  // -------------------------------------------------------------------------

  if (myReview) {
    const isApproved = myReview.moderation_status === 'approved';

    return (
      <View style={styles.outer}>
        <ThemedBackground />
        <SafeAreaView style={styles.root} edges={['top']}>
          <GateHeader styles={styles} T={T} />
          <View style={styles.centred}>
            <Icon name="info" size={40} color={isApproved ? OPEN_GREEN : T.label3} />
            <Text style={styles.gateTitle}>You've already reviewed this venue</Text>

            {isApproved ? (
              // Green-tinted card for approved reviews — positive framing
              <View style={styles.approvedCard}>
                <Text style={styles.approvedCardText}>
                  Your review is live and helping other families.
                </Text>
                <Text style={[styles.approvedCardText, { marginTop: 4, color: T.label2 }]}>
                  Visit your profile to edit or delete your existing review.
                </Text>
              </View>
            ) : (
              <Text style={styles.gateSub}>
                Your review is waiting for moderation. It will appear here once approved.
              </Text>
            )}

            <TouchableOpacity
              style={[styles.btnPrimary, { marginTop: isApproved ? 24 : 0 }]}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.btnPrimaryText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
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
// createStyles(T) — called via useMemo inside WriteReviewScreen so every
// colour resolves per the current app theme mode (same pattern as
// app/(tabs)/profile.tsx).
function createStyles(T: ThemeTokens) {
  return StyleSheet.create({
  outer: {
    flex: 1,
    // Transparent so the shared <ThemedBackground/> atmosphere shows through —
    // matches Home / Venue Detail / Plan Visit. Cards/buttons stay opaque.
    backgroundColor: 'transparent',
  },
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  gateHeaderRow: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  gateHeaderBack: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  gateTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 18,
    color: T.label,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 12,
  },
  gateSub: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: T.label3,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  btnPrimary: {
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: ACCENT.accent,
  },
  btnPrimaryText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: '#FFFFFF',
  },
  btnOutline: {
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: T.separator,
    backgroundColor: T.surface,
  },
  btnOutlineText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 15,
    color: T.label,
  },
  // Approved review — green-tinted info card
  approvedCard: {
    backgroundColor: 'rgba(52,199,123,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: OPEN_GREEN,
    padding: 14,
    marginBottom: 24,
    width: '100%',
  },
  approvedCardText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: OPEN_GREEN,
    textAlign: 'center',
    lineHeight: 20,
  },
  });
}
