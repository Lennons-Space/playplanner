/**
 * Venue detail screen — Phase 3 design system reskin.
 *
 * Layout: full-bleed hero (320px) with sand LinearGradient overlay →
 * floating card stack overlapping hero by 56px → sticky bottom bar.
 *
 * Visual layer only — no logic, hooks, data fetching, mutations, or
 * accessibility changes from the previous version.
 */
import { useCallback, useMemo, useState } from 'react';
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
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVenue } from '@/hooks/useVenues';
import { useVenueReviews, useMyReview } from '@/hooks/useReviews';
import { useUser } from '@/hooks/useAuth';
import { useReportVenue } from '@/hooks/useVenueReport';
// useVenueClaimStatus intentionally removed — claim flow disabled at launch.
import { supabase } from '@/lib/supabase';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { VenuePhotoUpload } from '@/components/venue/VenuePhotoUpload';
import { Skeleton } from '@/components/ui/SkeletonLoader';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { IconBtn } from '@/components/ui/IconBtn';
import { Stars } from '@/components/ui/Stars';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { getCategoryMeta } from '@/constants/categories';

// ─── Design tokens ────────────────────────────────────────────────────────────
const pp = {
  ink:      '#1D2630',
  inkSoft:  '#4A5560',
  mute:     '#7B8794',
  line:     '#E6E2DB',
  sand:     '#FBF6EC',
  paper:    '#FFFFFF',
  sky:      '#2FB8B0',
  skyDeep:  '#1B8A85',
  skySoft:  '#D4F0EE',
  skyWash:  '#EEF9F8',
  star:     '#F5A524',
  coral:    '#FF6B6B',
  sun:      '#FFD66B',
  sunSoft:  '#FFF1C7',
  leaf:     '#5BC08A',
  leafSoft: '#DCF4E4',
};

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
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: pp.sand }}>
      <Skeleton width="100%" height={320} borderRadius={0} />
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

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function VenueDetailScreen() {
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
  const handleGetDirections = useCallback(async () => {
    if (!venue?.latitude || !venue?.longitude) return;
    const lat = venue.latitude;
    const lng = venue.longitude;
    const url = Platform.select({
      ios: `maps:0,0?q=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}`,
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
  }, [venue?.latitude, venue?.longitude]);

  if (isLoading) return <LoadingSkeleton />;

  if (error || !venue) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: pp.sand,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
        }}
      >
        <Icon name="info" size={48} color={pp.mute} />
        <Text
          style={{
            fontFamily: 'Nunito-Bold',
            fontSize: 17,
            color: pp.ink,
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
          <Icon name="chevL" size={16} color={pp.sky} />
          <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: pp.sky }}>Go back</Text>
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

  // Category metadata for theming (pill colour, icon tint, soft bg).
  const catMeta = getCategoryMeta(venue.category?.slug);

  // Opening hours derived state.
  const openNowState = isOpenNow(venue.opening_hours ?? []);
  const closingTime = getTodayClosingTime(venue.opening_hours ?? []);

  // Featured: venue.featured_until is a future ISO timestamp.
  const isFeatured =
    venue.featured_until != null && new Date(venue.featured_until) > new Date();

  // Age label for stat strip.
  const hasAges = venue.min_age > 0 || venue.max_age > 0;

  return (
    <View style={styles.root}>

      {/* ── ScrollView ──────────────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >

        {/* ── Hero (320px) ─────────────────────────────────────────────── */}
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
              size={320}
              borderRadius={0}
            />
          )}

          {/* Sand-fade gradient — transparent at top, sand at bottom */}
          <LinearGradient
            colors={['transparent', pp.sand]}
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

        {/* ── Card stack — overlaps hero by 56px ──────────────────────── */}
        <View style={styles.cardStack}>

          {/* ── Main info card ──────────────────────────────────────────── */}
          <View style={styles.mainCard}>

            {/* 1. Category pill + Featured badge row */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <View style={[styles.pill, { backgroundColor: catMeta.soft }]}>
                <Text style={[styles.pillText, { color: catMeta.color }]}>
                  {(venue.category?.name ?? 'Activity').toUpperCase()}
                </Text>
              </View>
              {isFeatured && (
                <View style={[styles.pill, { backgroundColor: pp.sunSoft }]}>
                  <Text style={[styles.pillText, { color: '#8B6A00' }]}>FEATURED</Text>
                </View>
              )}
            </View>

            {/* 2. Venue name */}
            <Text style={styles.venueName}>{venue.name}</Text>

            {/* 3. Rating row */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
              {venue.review_count > 0 ? (
                <>
                  <Stars rating={venue.average_rating} size={14} color={pp.star} />
                  <Text style={styles.ratingValue}>{venue.average_rating.toFixed(1)}</Text>
                  <Text style={styles.ratingMeta}>
                    · {venue.review_count} review{venue.review_count !== 1 ? 's' : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.noReviewsMeta}>No reviews yet</Text>
              )}
            </View>

            {/* 4. Stat strip */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              {/* Distance tile */}
              <View style={styles.statTile}>
                <Icon name="walk" size={16} color={pp.skyDeep} />
                <Text style={styles.statValue}>
                  {venue.distance_km != null
                    ? `${(venue.distance_km * 0.621371).toFixed(1)}mi`
                    : '—'}
                </Text>
                <Text style={styles.statLabel}>Distance</Text>
              </View>

              {/* Age tile */}
              <View style={styles.statTile}>
                <Icon name="user" size={16} color={pp.skyDeep} />
                <Text style={styles.statValue}>
                  {hasAges ? `Ages ${venue.min_age}–${venue.max_age}` : 'All ages'}
                </Text>
                <Text style={styles.statLabel}>Best fit</Text>
              </View>

              {/* Open/Closed tile */}
              <View style={styles.statTile}>
                <Icon
                  name="clock"
                  size={16}
                  color={openNowState ? '#3CAE6B' : pp.mute}
                />
                <Text style={styles.statValue}>{openNowState ? 'Open' : 'Closed'}</Text>
                <Text style={styles.statLabel}>
                  {closingTime ?? 'No hours'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── About section ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>About</Text>
            {venue.description ? (
              <Text style={styles.description}>{venue.description}</Text>
            ) : (
              <Text style={styles.mutedText}>No description available.</Text>
            )}
          </View>

          {/* ── Facilities section ────────────────────────────────────── */}
          {venue.facilities && venue.facilities.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Facilities</Text>
              <View style={styles.facilitiesGrid}>
                {(venue.facilities as { facility: { id: string; name: string; icon: string } }[]).map(
                  (f, idx) => {
                    const facilityIconName = (f.facility.icon ?? 'shield') as IconName;
                    return (
                      <View key={f.facility.id ?? idx} style={styles.facilityTile}>
                        <View
                          style={[
                            styles.facilityIconCircle,
                            { backgroundColor: catMeta.soft },
                          ]}
                        >
                          <Icon name={facilityIconName} size={16} color={catMeta.color} />
                        </View>
                        <Text style={styles.facilityName} numberOfLines={1}>
                          {f.facility.name}
                        </Text>
                      </View>
                    );
                  }
                )}
              </View>
            </View>
          )}

          {/* ── Opening hours section ─────────────────────────────────── */}
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

          {/* ── Reviews section ───────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.reviewsHeader}>
              <Text style={[styles.sectionHeading, { marginBottom: 0 }]}>Parent reviews</Text>
              <TouchableOpacity
                style={styles.writeReviewBtn}
                onPress={() => router.push(`/venue/${venueId}/review`)}
                accessibilityRole="button"
                accessibilityLabel="Write a review for this venue"
              >
                <Icon name="plus" size={12} color={pp.skyDeep} />
                <Text style={styles.writeReviewText}>Write review</Text>
              </TouchableOpacity>
            </View>

            {reviewsLoading && (
              <ActivityIndicator color={pp.sky} style={{ marginVertical: 20 }} />
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

          {/* ── Photo upload — authenticated users only ──────────────── */}
          {user && venueId && <VenuePhotoUpload venueId={venueId} />}

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

          {/* ── Address + ODbL ────────────────────────────────────────── */}
          <View style={{ marginTop: 12, marginBottom: 8, paddingHorizontal: 4 }}>
            <Text style={styles.addressText}>
              {[venue.address_line1, venue.address_line2, venue.city, venue.postcode]
                .filter(Boolean)
                .join(', ')}
            </Text>
            {venue.data_source === 'osm' && (
              <Text style={styles.odblText}>
                © OpenStreetMap contributors (ODbL)
              </Text>
            )}
          </View>

        </View>
        {/* ── end card stack ─────────────────────────────────────────── */}

      </ScrollView>

      {/* ── Floating back button ─────────────────────────────────────────── */}
      <View
        style={[
          styles.floatingBack,
          { top: insets.top + 12 },
        ]}
      >
        <IconBtn
          size={40}
          tone={pp.paper}
          border={false}
          shadow
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <Icon name="chevL" size={20} color={pp.ink} />
        </IconBtn>
      </View>

      {/* ── Floating share + heart buttons ──────────────────────────────── */}
      <View
        style={[
          styles.floatingActions,
          { top: insets.top + 12 },
        ]}
      >
        <IconBtn
          size={40}
          tone={pp.paper}
          border={false}
          shadow
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
          <Icon name="share" size={18} color={pp.ink} />
        </IconBtn>

        <IconBtn
          size={40}
          tone={pp.paper}
          border={false}
          shadow
          onPress={() => toggleFavourite.mutate()}
          disabled={toggleFavourite.isPending}
          accessibilityRole="button"
          accessibilityLabel={isFavourited ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Icon
            name={isFavourited ? 'heartFill' : 'heart'}
            size={18}
            color={isFavourited ? pp.coral : pp.ink}
          />
        </IconBtn>
      </View>

      {/* ── Sticky bottom bar ────────────────────────────────────────────── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {/* Subtle gradient so bar lifts visually above content */}
        <LinearGradient
          colors={['transparent', pp.sand]}
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
            <Icon name="pin" size={16} color={pp.ink} />
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
            <Icon name="calendar" size={16} color={pp.paper} />
            <Text style={styles.planBtnText}>Plan a visit</Text>
          </TouchableOpacity>
        </View>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: pp.sand,
  },

  // ── Hero ──
  hero: {
    height: 320,
    overflow: 'hidden',
    backgroundColor: pp.sand,
  },

  // ── Image attribution (CC licence requirement) ──
  attribution: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: '80%',
  },
  attributionText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 9,
    color: 'rgba(255,255,255,0.90)',
    letterSpacing: 0.1,
  },

  // ── Card stack — overlaps hero ──
  cardStack: {
    marginTop: -56,
    marginHorizontal: 20,
    position: 'relative',
  },

  // ── Main info card ──
  mainCard: {
    backgroundColor: pp.paper,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: pp.line,
    padding: 20,
    // Shadow spec from design
    shadowColor: pp.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 6,
  },

  // Category pill / featured badge
  pill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 10,
    letterSpacing: 0.4,
  },

  // Venue name
  venueName: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 28,
    color: pp.ink,
    letterSpacing: -0.5,
    lineHeight: 30,
    marginTop: 4,
  },

  // Rating row
  ratingValue: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 14,
    color: pp.ink,
  },
  ratingMeta: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 13,
    color: pp.mute,
  },
  noReviewsMeta: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: pp.mute,
  },

  // Stat strip tiles
  statTile: {
    flex: 1,
    backgroundColor: pp.sand,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: pp.line,
    padding: 10,
    flexDirection: 'column',
    gap: 2,
    alignItems: 'flex-start',
  },
  statValue: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 12,
    color: pp.ink,
  },
  statLabel: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 10,
    color: pp.mute,
  },

  // ── Sections ──
  section: {
    paddingTop: 22,
    paddingHorizontal: 4,
  },
  sectionHeading: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 18,
    color: pp.ink,
    letterSpacing: -0.3,
    marginBottom: 10,
  },

  // About
  description: {
    fontFamily: 'Nunito-Regular',
    fontSize: 14,
    color: pp.inkSoft,
    lineHeight: 22,
  },
  mutedText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 14,
    color: pp.mute,
  },

  // Facilities grid
  facilitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  facilityTile: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: pp.paper,
    borderWidth: 1,
    borderColor: pp.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  facilityIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facilityName: {
    fontFamily: 'Nunito-Bold',
    fontSize: 13,
    color: pp.ink,
    flex: 1,
  },

  // Opening hours
  hoursCard: {
    backgroundColor: pp.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: pp.line,
    overflow: 'hidden',
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hoursDay: {
    fontFamily: 'Nunito-Bold',
    fontSize: 13,
    color: pp.ink,
  },
  hoursTime: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 13,
    color: pp.inkSoft,
  },
  hoursDivider: {
    height: 1,
    backgroundColor: pp.line,
    marginHorizontal: 16,
  },

  // Reviews
  reviewsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  writeReviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: pp.skyWash,
    borderWidth: 1,
    borderColor: pp.skySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  writeReviewText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 12,
    color: pp.skyDeep,
  },

  // Report / Claim links
  reportClaimRow: {
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 12,
  },
  reportLink: {
    fontFamily: 'Nunito-SemiBold',
    fontSize: 13,
    color: pp.mute,
    textDecorationLine: 'underline',
  },
  // claimLink style removed — claim flow disabled at launch.

  // Address
  addressText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: pp.mute,
    lineHeight: 18,
  },
  odblText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 11,
    color: pp.mute,
    marginTop: 4,
    opacity: 0.7,
  },

  // Floating overlay buttons
  floatingBack: {
    position: 'absolute',
    left: 16,
  },
  floatingActions: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },

  // Sticky bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  bottomBarInner: {
    flexDirection: 'row',
    gap: 10,
  },
  directionsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: pp.paper,
    borderWidth: 1.5,
    borderColor: pp.line,
    borderRadius: 24,
    paddingVertical: 14,
  },
  directionsBtnText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 14,
    color: pp.ink,
  },
  planBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: pp.ink,
    borderRadius: 24,
    paddingVertical: 14,
  },
  planBtnText: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 14,
    color: pp.paper,
  },
});
