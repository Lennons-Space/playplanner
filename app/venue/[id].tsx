/**
 * Venue detail screen — Play Planner v2 (Step 2, 2026-07-09).
 *
 * SOURCE OF TRUTH: `.design-v2-handoff/pp2-venue.jsx` as rendered by
 * `Play Planner v2.html` (dark), ground truth screenshot
 * `screens/02-venue-detail-dark.png`. Authority: html > jsx > screenshots >
 * README.
 *
 * v2 layout: 300px hero photo (glass circular back/share/heart overlays,
 * top+bottom scrims) → dark sheet (surface, 20px top radius, −20 overlap,
 * drag handle) → name + ✓ Verified + type + rating → 3-tile stat strip →
 * "Why we recommended this" → info rows card (address / price range / call)
 * → What's here? (parent facility confirm) → Facilities pills → About →
 * Photos rail → Reviews → photo upload → report/ODbL → sticky
 * Directions + Plan-a-visit bar.
 *
 * PROTOTYPE-ONLY data deliberately OMITTED (no honest source — never faked):
 * indoor/outdoor hero badge, trust-signal chips ("DBS checked staff"),
 * "£6.50 per child" entry price (we show the real price_range only when
 * present), "Free parking" row, hard-coded review fixtures, "See all"
 * reviews link (every approved review already renders).
 *
 * VISUAL LAYER ONLY — all hooks, data fetching, mutations (favourite toggle,
 * report, photo upload), navigation and accessibility behaviour are
 * unchanged from the previous version.
 *
 * IMPLEMENTATION RULES (learned on Home, 2026-07-09):
 *   • No Pressable style-as-function anywhere — the dev build's NativeWind 4
 *     interop silently drops them (TouchableOpacity + static styles here).
 *   • No BlurView (native module missing → Android crash); "glass" is a
 *     translucent fill + hairline, same as the tab bar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
  Share,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVenue } from '@/hooks/useVenues';
import { addRecentlyViewed } from '@/lib/recentlyViewed';
import { useVenueReviews, useMyReview } from '@/hooks/useReviews';
import { useUser } from '@/hooks/useAuth';
import { useReportVenue } from '@/hooks/useVenueReport';
// useVenueClaimStatus intentionally removed — claim flow disabled at launch.
import { supabase } from '@/lib/supabase';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { VenuePhotoUpload } from '@/components/venue/VenuePhotoUpload';
import { VenueContactRow } from '@/components/venue/VenueContactRow';
import { FacilityChips } from '@/components/venue/FacilityChips';
import { Skeleton } from '@/components/ui/SkeletonLoader';
import { Icon } from '@/components/ui/Icon';
import { Stars } from '@/components/ui/Stars';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { RecommendationExplanation } from '@/components/venues/RecommendationExplanation';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { ocean, FontFamily, BorderRadius, type ThemeTokens } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

// v2 design tokens — T is resolved per-render via useAppTheme() inside
// VenueDetailScreen/LoadingSkeleton below (createStyles(T) mirrors the
// pattern already used by app/(tabs)/profile.tsx).
const ACCENT = ocean;

// Prototype literals with no token equivalent.
const OPEN_GREEN = '#34C77B';
const FEATURED_TINT = 'rgba(255,178,62,0.16)';
const FEATURED_TEXT = '#FFC976';
// Hero "glass" buttons/badges (pp2-venue.jsx: rgba(0,0,0,0.38) + blur —
// blur omitted, see header note).
const HERO_GLASS = 'rgba(0,0,0,0.38)';
const HERO_GLASS_BORDER = 'rgba(255,255,255,0.14)';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Could not load venue. Check your connection.';
  }
  return 'Venue not found.';
}

// ─── isOpenNow ────────────────────────────────────────────────────────────────
// Derives whether the venue is currently open from its opening_hours array.
// Mirrors the same logic used in VenueCard.
interface HoursRow {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

function isOpenNow(hours: HoursRow[]): boolean {
  if (!hours || hours.length === 0) return false;
  const now = new Date();
  const todayIndex = now.getDay(); // 0=Sun
  const todayHours = hours.find((h) => h.day_of_week === todayIndex);
  if (!todayHours || todayHours.is_closed || !todayHours.opens_at || !todayHours.closes_at) {
    return false;
  }
  const [openH, openM] = todayHours.opens_at.split(':').map(Number);
  const [closeH, closeM] = todayHours.closes_at.split(':').map(Number);
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const openMins  = openH  * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  // Handle venues open past midnight (e.g. opens 22:00, closes 02:00).
  // In that case closeMins < openMins and we check the two separate windows:
  //   22:00–23:59 and 00:00–02:00.
  if (closeMins < openMins) {
    return currentMins >= openMins || currentMins < closeMins;
  }
  return currentMins >= openMins && currentMins < closeMins;
}

function getTodayClosingTime(hours: HoursRow[]): string | null {
  if (!hours || hours.length === 0) return null;
  const now = new Date();
  const todayIndex = now.getDay();
  const todayHours = hours.find((h) => h.day_of_week === todayIndex);
  if (!todayHours || todayHours.is_closed || !todayHours.closes_at) return null;
  return todayHours.closes_at;
}

// ─── LoadingSkeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  const { mode } = useAppTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Skeleton width="100%" height={300} borderRadius={0} />
      <View style={{ padding: 20, gap: 12 }}>
        <Skeleton width="70%" height={28} borderRadius={8} />
        <Skeleton width="45%" height={14} borderRadius={6} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Skeleton width={80} height={32} borderRadius={999} />
          <Skeleton width={80} height={32} borderRadius={999} />
          <Skeleton width={80} height={32} borderRadius={999} />
        </View>
        <Skeleton width="100%" height={60} borderRadius={18} style={{ marginTop: 8 }} />
      </View>
    </SafeAreaView>
  );
}

// The sticky bottom bar's content is fixed (paddingTop 18 + one row of
// 15pt-padded buttons around ~16-20pt text + its own 14px fixed bottom
// padding, ~82px) plus a generous buffer for larger accessibility font
// scales. This is a STATIC constant, not measured via onLayout — an
// earlier version measured the bar's real height after mount and fed it
// into the ScrollView's paddingBottom, but that async measure-then-update
// round trip is exactly the kind of race that only shows up on some real
// devices (Android in particular can skip re-applying a ScrollView's
// contentContainerStyle padding change without an explicit re-layout),
// which is what caused the sticky bar to overlap page content (Phase 8
// visual-defect report). A fixed, comfortably-generous constant has no
// such race.
const BOTTOM_BAR_RESERVED_SPACE = 110;

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function VenueDetailScreen() {
  const { tokens: T, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T), [T]);
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // Expo Router can produce string[] when a param appears multiple times in a deep link.
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const insets = useSafeAreaInsets();
  const user = useUser();
  const queryClient = useQueryClient();
  const reportVenue = useReportVenue();

  // Treat missing id (undefined) as an empty string so the enabled guards in
  // each hook catch it rather than passing undefined through as a cast.
  const venueId = id ?? '';

  const { data: venue, isLoading, error } = useVenue(venueId);

  // Record this venue in the local "Recently viewed" list — ONLY once a real
  // venue has loaded (never a placeholder/loading state). Local AsyncStorage
  // only; non-blocking and failure-safe (see lib/recentlyViewed).
  useEffect(() => {
    if (venue?.id) {
      void addRecentlyViewed(venue);
    }
  }, [venue?.id, venue]);

  const { data: reviews, isLoading: reviewsLoading } = useVenueReviews(venueId);
  // myReview is fetched so the review screen (navigated via "Write review" button)
  // can show an upfront duplicate-review gate. It is not rendered on this screen.
  const { data: _myReview } = useMyReview(venueId || undefined, user?.id);
  // Hero image error states — tracked separately so a failed cover photo
  // still allows falling back to venue.image_url (Wikimedia), and a failed
  // image_url still falls back to CategoryPlaceholder.
  const [coverPhotoError, setCoverPhotoError] = useState(false);
  const [wikimediaImgError, setWikimediaImgError] = useState(false);
  // useVenue already fetches and filters approved photos in its join — no second query needed.
  const photos = venue?.photos ?? [];

  const { data: isFavourited } = useQuery({
    queryKey: ['favourite', user?.id, venueId],
    queryFn: async () => {
      // user and venueId are guaranteed non-null by the `enabled` guard below.
      // We re-check at runtime to avoid a crash if state becomes inconsistent.
      if (!user?.id || !venueId) return false;
      const { data } = await supabase
        .from('favourites')
        .select('id')
        .eq('user_id', user.id)
        .eq('venue_id', venueId)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!venueId,
  });

  const toggleFavourite = useMutation({
    mutationFn: async () => {
      // Re-assert user inside mutationFn — the session may have expired between
      // the button render and the tap (e.g. token revocation, sign-out on another
      // tab). Using user!.id outside this check would throw a runtime error.
      if (!user?.id || !venueId) throw new Error('You must be signed in to save favourites.');

      // Read the authoritative isFavourited value from the query cache rather than
      // the stale outer-closure value. This prevents a rapid double-tap from sending
      // two insert/delete calls with the same stale value, which would cause a DB
      // unique-constraint error on the second call.
      const cached: boolean | undefined = queryClient.getQueryData(['favourite', user.id, venueId]);
      const currentlyFavourited = cached ?? false;

      if (currentlyFavourited) {
        await supabase.from('favourites').delete().eq('user_id', user.id).eq('venue_id', venueId);
      } else {
        await supabase.from('favourites').insert({ user_id: user.id, venue_id: venueId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favourite', user?.id, venueId] });
      queryClient.invalidateQueries({ queryKey: ['favourites', user?.id] });
    },
    onError: () => {
      Alert.alert(
        'Favourites error',
        'Could not update favourites. Please check your connection and try again.'
      );
    },
  });

  const sortedHours = useMemo(
    () => [...(venue?.opening_hours ?? [])].sort((a, b) => a.day_of_week - b.day_of_week),
    [venue?.opening_hours]
  );

  const submitReport = useCallback(
    (reason: Parameters<typeof reportVenue.mutate>[0]['reason']) => {
      reportVenue.mutate(
        { venueId: venueId, reason },
        {
          onSuccess: () =>
            Alert.alert('Thanks', "Your report has been received. We'll review it shortly."),
          onError: (err) =>
            Alert.alert('Error', err instanceof Error ? err.message : 'Could not submit report.'),
        }
      );
    },
    [reportVenue, venueId]
  );

  const handleReport = useCallback(() => {
    Alert.alert('Report an issue', 'What is the problem with this venue?', [
      { text: 'Venue is permanently closed',  onPress: () => submitReport('permanently_closed') },
      { text: 'Wrong information',            onPress: () => submitReport('wrong_info') },
      { text: 'Inappropriate content',        onPress: () => submitReport('inappropriate_content') },
      { text: 'Duplicate listing',            onPress: () => submitReport('duplicate') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [submitReport]);

  // Get Directions handler — used by the sticky bottom bar.
  // The venue name is included (URL-encoded) so the destination pin is
  // labelled instead of showing up as "Unnamed location"; the lat/lng pair
  // remains the authoritative coordinate in every branch.
  const handleGetDirections = useCallback(async () => {
    if (!venue?.latitude || !venue?.longitude) return;
    const lat = venue.latitude;
    const lng = venue.longitude;
    const label = encodeURIComponent(venue.name);
    const url = Platform.select({
      // Apple Maps: `q` supplies the pin label, `ll` the authoritative coords.
      ios: `http://maps.apple.com/?q=${label}&ll=${lat},${lng}`,
      // Google Maps (geo: intent): the `(Label)` suffix on `q` names the pin
      // at the exact `lat,lng` given immediately before it.
      android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    })!;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        );
      }
    } catch {
      Alert.alert('Cannot open maps', 'Could not open maps on your device.');
    }
  }, [venue?.latitude, venue?.longitude, venue?.name]);

  if (isLoading) return <LoadingSkeleton />;

  if (error || !venue) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
        }}
      >
        <ThemedBackground />
        <StatusBar style={statusBarStyle} />
        <Icon name="info" size={48} color={T.label3} />
        <Text
          style={{
            fontFamily: FontFamily.heading,
            fontSize: 17,
            color: T.label,
            textAlign: 'center',
            marginTop: 14,
          }}
        >
          {error ? getErrorMessage(error) : 'Venue not found.'}
        </Text>
        <TouchableOpacity
          style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 4 }}
          onPress={() => router.back()}
        >
          <Icon name="chevL" size={16} color={ACCENT.accent} />
          <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 14, color: ACCENT.accent }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Prefer a photo marked is_cover; fallback to first approved photo with a truthy url.
  const coverPhoto = photos.find((p) => p.is_cover && p.url) ?? photos.find((p) => p.url);

  // Hero image priority chain:
  //   1. User-uploaded approved cover photo (coverPhoto.url)
  //   2. Wikimedia / category fallback (venue.image_url)
  //   3. CategoryPlaceholder (no image required)
  const heroUrl: string | null =
    (coverPhoto?.url && !coverPhotoError)   ? coverPhoto.url :
    (venue.image_url  && !wikimediaImgError) ? venue.image_url :
    null;

  // Show attribution only when displaying the Wikimedia / category fallback image.
  // Attribution is required by CC licence terms when displaying the image.
  const heroAttribution =
    heroUrl === venue.image_url && venue.image_attribution
      ? venue.image_attribution
      : null;

  // Opening hours derived state.
  const openNowState = isOpenNow(venue.opening_hours ?? []);
  const closingTime = getTodayClosingTime(venue.opening_hours ?? []);

  // Featured: venue.featured_until is a future ISO timestamp.
  const isFeatured =
    venue.featured_until != null && new Date(venue.featured_until) > new Date();

  // Age label for stat strip.
  const hasAges = venue.min_age > 0 || venue.max_age > 0;

  // Photos rail — every approved photo with a url (real data only; the rail
  // hides entirely when there are none).
  const railPhotos = photos.filter((p) => !!p.url);

  const addressText = [venue.address_line1, venue.address_line2, venue.city, venue.postcode]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.root}>
      {/* Shared v2 atmosphere layer — SAME component Home mounts, reading the
          identical coarse/cached weather fetch, so the background never
          diverges between screens (see V2Background's own doc comment). */}
      <ThemedBackground />
      <StatusBar style={statusBarStyle} />

      {/* ── ScrollView ──────────────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // Clears the sticky Directions/Plan-a-visit bar on every device.
          // Static (BOTTOM_BAR_RESERVED_SPACE + insets.bottom), not measured
          // via onLayout — see that constant's doc comment for why.
          paddingBottom: BOTTOM_BAR_RESERVED_SPACE + insets.bottom,
        }}
      >

        {/* ── Hero (jsx: 300px photo + top/bottom scrims) ───────────────── */}
        <View style={styles.hero}>
          {heroUrl ? (
            <Image
              source={{ uri: heroUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={200}
              onError={() => {
                if (heroUrl === coverPhoto?.url) setCoverPhotoError(true);
                else setWikimediaImgError(true);
              }}
            />
          ) : (
            <CategoryPlaceholder
              categorySlug={venue.category?.slug}
              size={300}
              borderRadius={0}
              variant="dark"
            />
          )}

          {/* jsx scrim: dark at very top (status/buttons legible), clear
              middle, darker at the bottom where the sheet overlaps. */}
          <LinearGradient
            colors={['rgba(0,0,0,0.22)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']}
            locations={[0, 0.4, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Attribution — required by CC licence when showing Wikimedia image */}
          {heroAttribution && (
            <View style={styles.attribution} pointerEvents="none">
              <Text style={styles.attributionText} numberOfLines={1}>
                {heroAttribution}
              </Text>
            </View>
          )}
        </View>

        {/* ── Dark sheet (jsx: surface, 20px top radius, −20 overlap) ──── */}
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          {/* ── Name + Verified/Featured + type + rating ───────────────── */}
          <View style={styles.headerBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.venueName}>{venue.name}</Text>
              <View style={{ gap: 6, alignItems: 'flex-end' }}>
                {venue.is_verified && (
                  <View style={styles.verifiedPill}>
                    <Text style={styles.verifiedText}>✓ Verified</Text>
                  </View>
                )}
                {isFeatured && (
                  <View style={[styles.verifiedPill, { backgroundColor: FEATURED_TINT }]}>
                    <Text style={[styles.verifiedText, { color: FEATURED_TEXT }]}>Featured</Text>
                  </View>
                )}
              </View>
            </View>
            <Text style={styles.typeText}>{venue.category?.name ?? 'Family venue'}</Text>
            <View style={styles.ratingRow}>
              {venue.review_count > 0 ? (
                <>
                  <Stars rating={venue.average_rating} size={13} color={T.star} />
                  <Text style={styles.ratingValue}>{venue.average_rating.toFixed(1)}</Text>
                  <Text style={styles.ratingMeta}>
                    {venue.review_count} review{venue.review_count !== 1 ? 's' : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.ratingMeta}>No reviews yet</Text>
              )}
            </View>
          </View>

          {/* ── 3-tile stat strip (jsx) ────────────────────────────────── */}
          <View style={styles.statStrip}>
            <View style={styles.statTile}>
              <Icon name="walk" size={15} color={ACCENT.accent} />
              <Text style={styles.statValue}>
                {venue.distance_km != null
                  ? `${(venue.distance_km * 0.621371).toFixed(1)} mi`
                  : '—'}
              </Text>
              <Text style={styles.statLabel}>Distance</Text>
            </View>

            <View style={styles.statTile}>
              <Icon name="user" size={15} color={ACCENT.accent} />
              <Text style={styles.statValue}>
                {hasAges ? `${venue.min_age}–${venue.max_age}` : 'All ages'}
              </Text>
              <Text style={styles.statLabel}>Ages</Text>
            </View>

            <View style={styles.statTile}>
              <Icon name="clock" size={15} color={openNowState ? OPEN_GREEN : T.label3} />
              <Text style={[styles.statValue, openNowState && { color: OPEN_GREEN }]}>
                {openNowState ? (closingTime ? `till ${closingTime}` : 'Open') : 'Closed'}
              </Text>
              <Text style={styles.statLabel}>{openNowState ? 'Open now' : 'Right now'}</Text>
            </View>
          </View>

          {/* ── Why we recommended this (real engine; self-hides) ─────── */}
          <View style={{ paddingHorizontal: 16 }}>
            <RecommendationExplanation venue={venue} />
          </View>

          {/* ── Info rows card (jsx: address / entry; call kept from the
                 current app — hours have their own full section below) ── */}
          <View style={styles.infoCard}>
            {addressText ? (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Icon name="pin" size={16} color={T.label3} strokeWidth={1.8} />
                </View>
                <Text style={styles.infoText}>{addressText}</Text>
              </View>
            ) : null}
            {venue.price_range ? (
              <View style={[styles.infoRow, styles.infoRowBorder]}>
                <View style={styles.infoIcon}>
                  <Text style={{ fontSize: 14, color: T.label3 }}>£</Text>
                </View>
                <Text style={styles.infoText}>Price range · {venue.price_range}</Text>
              </View>
            ) : null}
          </View>

          {/* Call row — self-hides when there is no dialable phone number. */}
          <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
            <VenueContactRow phone={venue.phone} venueName={venue.name} />
          </View>

          {/* ── What's here? (Parent Contribution MVP) ────────────────── */}
          <View style={{ paddingTop: 16 }}>
            <FacilityChips venueId={venueId} />
          </View>

          {/* ── Facilities (jsx: simple pill wrap — real data only) ───── */}
          {venue.facilities && venue.facilities.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Facilities</Text>
              <View style={styles.facilityWrap}>
                {(venue.facilities as { facility: { id: string; name: string; icon: string } }[]).map(
                  (f, idx) => (
                    <View key={f.facility.id ?? idx} style={styles.facilityPill}>
                      <Text style={styles.facilityPillText}>{f.facility.name}</Text>
                    </View>
                  )
                )}
              </View>
            </View>
          )}

          {/* ── About ──────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>About</Text>
            {venue.description ? (
              <Text style={styles.description}>{venue.description}</Text>
            ) : (
              <Text style={styles.mutedText}>No description available.</Text>
            )}
          </View>

          {/* ── Photos rail (jsx: 100×76 r10 — real approved photos only,
                 hidden when there are none) ─────────────────────────── */}
          {railPhotos.length > 0 && (
            <View style={{ paddingTop: 20 }}>
              <Text style={[styles.sectionHeading, { marginLeft: 16 }]}>Photos</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
              >
                {railPhotos.map((p, i) => (
                  <View key={p.url ?? i} style={styles.railPhoto}>
                    <Image
                      source={{ uri: p.url }}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                      transition={150}
                      accessibilityLabel={`Photo of ${venue.name}`}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* ── Reviews ────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.reviewsHeader}>
              <Text style={[styles.sectionHeading, { marginBottom: 0 }]}>Reviews</Text>
              <TouchableOpacity
                style={styles.writeReviewBtn}
                onPress={() => router.push(`/venue/${venueId}/review`)}
                accessibilityRole="button"
                accessibilityLabel="Write a review for this venue"
              >
                <Text style={styles.writeReviewText}>Write a review</Text>
              </TouchableOpacity>
            </View>

            {reviewsLoading && (
              <ActivityIndicator color={ACCENT.accent} style={{ marginVertical: 20 }} />
            )}

            {!reviewsLoading && (!reviews || reviews.length === 0) && (
              <Text style={styles.mutedText}>No reviews yet. Be the first!</Text>
            )}

            {!reviewsLoading && reviews && reviews.length > 0 && (
              <View style={{ gap: 10 }}>
                {reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
              </View>
            )}
          </View>

          {/* ── Opening hours (real 7-day data — richer than the jsx's
                 single summary line, never fabricated) ────────────────── */}
          {sortedHours.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Opening hours</Text>
              <View style={styles.hoursCard}>
                {sortedHours.map((h, i) => (
                  <View key={h.id}>
                    <View style={styles.hoursRow}>
                      <Text style={styles.hoursDay}>{DAYS[h.day_of_week]}</Text>
                      <Text style={styles.hoursTime}>
                        {h.is_closed ? 'Closed' : `${h.opens_at} – ${h.closes_at}`}
                      </Text>
                    </View>
                    {i < sortedHours.length - 1 && <View style={styles.hoursDivider} />}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Photo upload — authenticated users only ──────────────── */}
          <View style={{ paddingHorizontal: 16 }}>
            {user && venueId && <VenuePhotoUpload venueId={venueId} />}
          </View>

          {/* ── Report link ──────────────────────────────────────────── */}
          {/* Claim link intentionally removed — the claim flow is being
              redesigned for security. It will return in a future release. */}
          <View style={styles.reportClaimRow}>
            <TouchableOpacity
              onPress={handleReport}
              disabled={reportVenue.isPending}
              accessibilityRole="button"
              accessibilityLabel="Report an issue with this venue"
            >
              <Text style={styles.reportLink}>Report an issue</Text>
            </TouchableOpacity>
          </View>

          {/* ── ODbL attribution ─────────────────────────────────────── */}
          {venue.data_source === 'osm' && (
            <Text style={styles.odblText}>© OpenStreetMap contributors (ODbL)</Text>
          )}

        </View>
        {/* ── end sheet ─────────────────────────────────────────────── */}

      </ScrollView>

      {/* ── Floating back button (jsx: 36px glass circle) ───────────────── */}
      <View style={[styles.floatingBack, { top: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.glassBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="chevL" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* ── Floating share + heart buttons (glass circles) ──────────────── */}
      <View style={[styles.floatingActions, { top: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.glassBtn}
          onPress={async () => {
            const link = `playplanner://venue/${venueId}`;
            try {
              await Share.share({
                // iOS handles `url` as a separate tappable link — omit it from
                // `message` to avoid the link appearing twice in iMessage/WhatsApp.
                message: Platform.OS === 'ios'
                  ? `Check out ${venue.name} on PlayPlanner!`
                  : `Check out ${venue.name} on PlayPlanner!\n${link}`,
                url: link,
                title: venue.name,
              });
            } catch {
              // Share sheet dismissed or failed — no user-visible error needed.
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={`Share ${venue.name}`}
        >
          <Icon name="share" size={16} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.glassBtn}
          onPress={() => toggleFavourite.mutate()}
          disabled={toggleFavourite.isPending}
          accessibilityRole="button"
          accessibilityLabel={isFavourited ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Icon
            name={isFavourited ? 'heartFill' : 'heart'}
            size={16}
            color={isFavourited ? '#FF6B6B' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>

      {/* ── Sticky bottom bar (jsx CTA row: Directions + Plan a visit) ──── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 14 }]}>
        {/* Fade so the bar lifts off the scrolling content beneath. */}
        <LinearGradient
          colors={['rgba(12,12,17,0)', T.bg]}
          locations={[0, 0.55]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        <View style={styles.bottomBarInner}>
          {/* Directions button */}
          <TouchableOpacity
            style={styles.directionsBtn}
            onPress={handleGetDirections}
            accessibilityLabel="Get directions to this venue"
            accessibilityRole="button"
          >
            <Text style={styles.directionsBtnText}>Directions</Text>
          </TouchableOpacity>

          {/* Plan a visit button */}
          <TouchableOpacity
            style={styles.planBtn}
            onPress={() => router.push({
              pathname: '/venue/plan-visit',
              params: {
                venueId,
                distance_km: venue.distance_km != null ? String(venue.distance_km) : '',
              },
            })}
            accessibilityRole="button"
            accessibilityLabel="Plan a visit to this venue"
          >
            <Text style={styles.planBtnText}>Plan a visit</Text>
          </TouchableOpacity>
        </View>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// createStyles(T) — same pattern as app/(tabs)/profile.tsx: called via
// useMemo(() => createStyles(T), [T]) inside VenueDetailScreen so every
// colour resolves per the current app theme mode. The hero photo + its
// scrim + floating glass buttons are an INTENTIONAL dark exception (image-
// led chrome, per the design brief) and use fixed literals regardless of
// mode — everything else (sheet, info cards, reviews, stat tiles, bottom
// bar) follows T.
function createStyles(T: ThemeTokens) {
  const isDark = T.mode === 'dark';
  return StyleSheet.create({
  root: {
    flex: 1,
    // Transparent so the shared <ThemedBackground/> atmosphere (rendered as
    // the first child, behind everything below) shows through in the
    // status-bar zone, scroll overscroll, and any other gap — the hero,
    // sheet, cards and sticky bar all still render fully opaque on top of it.
    backgroundColor: 'transparent',
  },

  // ── Hero ── — intentional dark exception (image-led; matches the
  // CategoryPlaceholder variant="dark" fallback used in the same slot).
  hero: {
    height: 300,
    overflow: 'hidden',
    backgroundColor: '#0C0C11',
  },

  // ── Image attribution (CC licence requirement) ──
  attribution: {
    position: 'absolute',
    bottom: 28, // above the sheet's −20 overlap
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: '80%',
  },
  attributionText: {
    fontFamily: FontFamily.body,
    fontSize: 9,
    color: 'rgba(255,255,255,0.90)',
    letterSpacing: 0.1,
  },

  // ── Sheet (jsx: surface, 20px top radius, −20 overlap) ──
  // Translucent (not T.surface's opaque hex) so the shared <ThemedBackground/>
  // atmosphere — mounted behind this sheet at the screen root — remains
  // visible through every section that has no card background of its own
  // (headerBlock, facility pills, About, report/ODbL row, etc). Island cards
  // (statTile/infoCard/hoursCard/ReviewCard) keep their own opaque T.bg fill
  // on top, so their text stays fully legible. Dark values unchanged; light
  // uses a translucent white + the same hairline convention as GlassSurface's
  // light branch.
  sheet: {
    backgroundColor: isDark ? 'rgba(14,14,20,0.5)' : 'rgba(255,255,255,0.55)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    borderTopWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,18,28,0.08)',
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: BorderRadius.pill,
    backgroundColor: T.label4,
  },

  // ── Header block ──
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.separator,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 6,
  },
  venueName: {
    flex: 1,
    fontFamily: FontFamily.display,
    fontSize: 22,
    color: T.label,
    letterSpacing: -0.4,
    lineHeight: 27,
  },
  verifiedPill: {
    backgroundColor: ACCENT.light,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 0,
  },
  verifiedText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 11,
    color: ACCENT.accent,
  },
  typeText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label3,
    marginBottom: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  ratingValue: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 14,
    color: T.label,
  },
  ratingMeta: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: T.label3,
  },

  // ── Stat strip (jsx: 3 centred tiles on T.bg) ──
  statStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  statTile: {
    flex: 1,
    // Island card on top of the translucent sheet. Dark keeps the existing
    // opaque T.bg fill (byte-identical); light swaps to the same translucent
    // warm-white fill GlassSurface's light branch uses (components/ui/
    // GlassSurface.tsx FILL.light), so it reads as a soft card floating on
    // the warm atmosphere instead of a cold opaque grey island.
    backgroundColor: isDark ? T.bg : 'rgba(255,255,255,0.72)',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: T.separator,
    paddingVertical: 11,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: T.label,
    textAlign: 'center',
  },
  statLabel: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    color: T.label3,
    textAlign: 'center',
  },

  // ── Info rows card (jsx) ──
  infoCard: {
    // See statTile above — same mode-aware island-card fill.
    backgroundColor: isDark ? T.bg : 'rgba(255,255,255,0.72)',
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.separator,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  infoRowBorder: {
    borderTopWidth: 1,
    borderTopColor: T.separator,
  },
  infoIcon: {
    width: 20,
    alignItems: 'center',
    flexShrink: 0,
  },
  infoText: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: T.label2,
    lineHeight: 20,
  },

  // ── Sections ──
  section: {
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeading: {
    fontFamily: FontFamily.heading,
    fontSize: 17,
    color: T.label,
    letterSpacing: -0.2,
    marginBottom: 10,
  },

  // About
  description: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label2,
    lineHeight: 24,
  },
  mutedText: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: T.label3,
  },

  // Facilities (jsx: text pill wrap)
  facilityWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  facilityPill: {
    // See statTile above — same mode-aware island-card fill.
    backgroundColor: isDark ? T.bg : 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: T.separator,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  facilityPillText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: T.label2,
  },

  // Photos rail
  railPhoto: {
    width: 100,
    height: 76,
    borderRadius: 10,
    overflow: 'hidden',
    // See statTile above — same mode-aware island-card fill (visible only as
    // the placeholder colour behind a loading/broken photo).
    backgroundColor: isDark ? T.bg : 'rgba(255,255,255,0.72)',
  },

  // Opening hours
  hoursCard: {
    // See statTile above — same mode-aware island-card fill.
    backgroundColor: isDark ? T.bg : 'rgba(255,255,255,0.72)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.separator,
    overflow: 'hidden',
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hoursDay: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: T.label,
  },
  hoursTime: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: T.label2,
  },
  hoursDivider: {
    height: 1,
    backgroundColor: T.separator,
    marginHorizontal: 16,
  },

  // Reviews
  reviewsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  writeReviewBtn: {
    backgroundColor: ACCENT.light,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  writeReviewText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: ACCENT.accent,
  },

  // Report link
  reportClaimRow: {
    paddingTop: 20,
    paddingBottom: 4,
    alignItems: 'center',
  },
  reportLink: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: T.label3,
    textDecorationLine: 'underline',
  },

  // ODbL
  odblText: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    color: T.label3,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 8,
  },

  // Floating glass buttons (jsx: 36px, rgba(0,0,0,0.38), hairline)
  floatingBack: {
    position: 'absolute',
    left: 14,
  },
  floatingActions: {
    position: 'absolute',
    right: 14,
    flexDirection: 'row',
    gap: 8,
  },
  glassBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: HERO_GLASS,
    borderWidth: 1,
    borderColor: HERO_GLASS_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sticky bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 18,
    paddingHorizontal: 16,
  },
  bottomBarInner: {
    flexDirection: 'row',
    gap: 10,
  },
  directionsBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.separator,
    borderRadius: 14,
    paddingVertical: 15,
  },
  directionsBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: T.label,
  },
  planBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT.accent,
    borderRadius: 14,
    paddingVertical: 15,
  },
  planBtnText: {
    fontFamily: FontFamily.caption,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  });
}
