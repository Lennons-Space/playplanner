/**
 * Admin moderation screen — approve/reject pending venue submissions and photos.
 * Only visible to users with profile.is_admin = true.
 *
 * Guards:
 * - Waits for the auth profile to finish loading before rendering, so non-admins
 *   never briefly see the admin UI (race-condition fix).
 * - Uses a cross-platform Modal+TextInput for the rejection reason instead of
 *   Alert.prompt(), which only exists on iOS and crashes on Android.
 *
 * Venues tab enhancements (Phase 3):
 * - Full filter/sort/search UI for the 20k+ OSM-imported pending queue.
 * - Category lookup query (permanent cache) resolves slug → UUID before filtering.
 * - Pagination via .range() with "Load more" button; filters reset page to 0.
 * - Client-side family/junk keyword filters applied after server results.
 * - Bulk reject added (mirrors bulk approve). Both mutations always guard
 *   .eq('is_published', false) so live venues are never touched.
 * - moderation_notes set on every action for a full audit trail.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { router, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useIsAdmin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useModeratePhoto } from '@/hooks/useVenuePhotos';
import { useModerateReview } from '@/hooks/useReviews';
import { useAdminVenueClaims, useReviewClaim } from '@/hooks/useVenueClaims';
import type { Venue, PendingPhotoWithVenue } from '@/types';

// ---------------------------------------------------------------------------
// Keyword lists — defined outside the component so they are stable references
// and never recreated on each render.
// ---------------------------------------------------------------------------

const FAMILY_KEYWORDS = [
  'playground', 'park', 'farm', 'zoo', 'museum', 'library',
  'soft play', 'swim', 'trampoline', 'adventure', 'play area',
  'nature reserve', 'forest', 'country park', 'leisure centre',
  'sports centre', 'theatre', 'cinema',
];

const JUNK_KEYWORDS = [
  'unnamed', 'unknown', 'test', 'n/a', 'tbc', 'placeholder',
  '???', 'delete', 'duplicate',
];

// Category chips shown in the filter bar.
// We deliberately do not import CATEGORY_SLUGS from constants/categories.ts
// because those are the consumer-facing slugs. The admin queue uses the raw
// OSM-imported slugs stored in the categories table.
const ADMIN_CATEGORY_CHIPS: { label: string; slug: string }[] = [
  { label: 'Attraction',     slug: 'attraction'       },
  { label: 'Outdoor Sports', slug: 'outdoor-sports'   },
  { label: 'Sports',         slug: 'sports-activity'  },
  { label: 'Museum',         slug: 'museum'            },
];

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Pending review as returned by the admin queue query. */
interface PendingReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  created_at: string;
  venue_id: string;
  venues: { id: string; name: string } | null;
  profile: { username: string | null; full_name: string | null } | null;
}

/** Venue row with category + submitter joined — used in the admin venues queue. */
type AdminVenue = Venue & {
  category: { id: string; slug: string; name: string } | null;
  submitted_by_profile: { full_name: string | null } | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ModerationScreen() {
  const isAdmin    = useIsAdmin();
  const user       = useAuthStore((s) => s.user);
  const profile    = useAuthStore((s) => s.profile);
  const authIsLoading = useAuthStore((s) => s.isLoading);
  const queryClient = useQueryClient();

  // Tab switcher: 'venues' | 'photos' | 'reviews' | 'claims'
  const [activeTab, setActiveTab] = useState<'venues' | 'photos' | 'reviews' | 'claims'>('venues');

  // ── Venue rejection modal ────────────────────────────────────────────────
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectVenueId,      setRejectVenueId]      = useState<string | null>(null);
  const [rejectReason,       setRejectReason]       = useState('');

  // ── Photo rejection modal ────────────────────────────────────────────────
  const [rejectPhotoModalVisible, setRejectPhotoModalVisible] = useState(false);
  const [rejectPhotoId,           setRejectPhotoId]           = useState<string | null>(null);
  const [rejectPhotoVenueId,      setRejectPhotoVenueId]      = useState<string | null>(null);
  const [rejectPhotoReason,       setRejectPhotoReason]       = useState('');

  // ── Review rejection modal ───────────────────────────────────────────────
  const [rejectReviewModalVisible, setRejectReviewModalVisible] = useState(false);
  const [rejectReviewId,           setRejectReviewId]           = useState<string | null>(null);
  const [rejectReviewReason,       setRejectReviewReason]       = useState('');

  // ── Claim rejection modal ────────────────────────────────────────────────
  const [rejectClaimModalVisible, setRejectClaimModalVisible] = useState(false);
  const [rejectClaimId,           setRejectClaimId]           = useState<string | null>(null);
  const [rejectClaimVenueId,      setRejectClaimVenueId]      = useState<string | null>(null);
  const [rejectClaimUserId,       setRejectClaimUserId]       = useState<string | null>(null);
  const [rejectClaimReason,       setRejectClaimReason]       = useState('');

  // ── Bulk approve modal ───────────────────────────────────────────────────
  // bulkSource null = all pending venues; a string = filter by data_source value
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [bulkSource,       setBulkSource]       = useState<string | null>(null);

  // ── Bulk reject modal ────────────────────────────────────────────────────
  const [bulkRejectModalVisible, setBulkRejectModalVisible] = useState(false);

  // ── Venues tab filter/sort state ─────────────────────────────────────────
  const [categorySlug,      setCategorySlug]      = useState<string | null>(null);
  const [hasWebsiteFilter,  setHasWebsiteFilter]  = useState(false);
  const [hasPostcodeFilter, setHasPostcodeFilter] = useState(false);
  const [unknownAreaFilter, setUnknownAreaFilter] = useState(false);
  const [familyFilter,      setFamilyFilter]      = useState(false);
  const [junkFilter,        setJunkFilter]        = useState(false);
  const [sortBy,            setSortBy]            = useState<'newest' | 'name' | 'category'>('newest');
  const [searchText,        setSearchText]        = useState('');
  const [page,              setPage]              = useState(0);
  // Accumulated venues across pages — appended when a new page loads.
  const [allVenues,         setAllVenues]         = useState<AdminVenue[]>([]);

  // Helper: reset pagination whenever filters or sort change.
  const resetPagination = () => {
    setPage(0);
    setAllVenues([]);
  };

  // ── Category slug → UUID lookup (permanent cache) ────────────────────────
  // We resolve the slug to a UUID once and cache it forever.  The UUID is then
  // used as a server-side .eq('category_id', id) filter so PostgREST can use
  // the index rather than filtering on a joined column.
  const { data: resolvedCategoryId = null } = useQuery<string | null>({
    queryKey: ['admin', 'category-id', categorySlug],
    queryFn: async () => {
      if (!categorySlug) return null;
      const { data, error } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', categorySlug)
        .single();
      if (error) {
        // Not found is fine — just return null, the main query will run unfiltered.
        return null;
      }
      return (data as { id: string } | null)?.id ?? null;
    },
    staleTime: Infinity,   // category IDs never change — cache permanently
    gcTime: Infinity,
    enabled: isAdmin && !!categorySlug,
  });

  // ── Pending venues query (server-side filters + pagination) ──────────────
  const {
    data:      pageVenues = [],
    isLoading: venuesLoading,
    isFetching: venuesFetching,
  } = useQuery<AdminVenue[]>({
    queryKey: ['admin', 'pending-venues', {
      categoryId: resolvedCategoryId,
      hasWebsiteFilter,
      hasPostcodeFilter,
      unknownAreaFilter,
      sortBy,
      page,
    }],
    queryFn: async () => {
      let q = supabase
        .from('venues')
        .select('*, category:categories(id, slug, name), submitted_by_profile:profiles!submitted_by(full_name)')
        .eq('moderation_status', 'pending')
        .eq('is_published', false);

      // Category filter — resolved UUID from lookup query above.
      if (resolvedCategoryId) {
        q = q.eq('category_id', resolvedCategoryId);
      }
      // Server-side boolean filters
      if (hasWebsiteFilter) {
        q = q.not('website', 'is', null).neq('website', '');
      }
      if (hasPostcodeFilter) {
        q = q.not('postcode', 'is', null).neq('postcode', '');
      }
      if (unknownAreaFilter) {
        q = q.or('city.is.null,city.eq.');
      }

      // Sort
      if (sortBy === 'newest') {
        q = q.order('created_at', { ascending: false });
      } else if (sortBy === 'name') {
        q = q.order('name', { ascending: true });
      } else {
        q = q.order('category_id', { ascending: true }).order('name', { ascending: true });
      }

      // Pagination: 50 per page
      const from = page * 50;
      const to   = from + 49;
      q = q.range(from, to);

      const { data, error } = await q;
      if (error) {
        console.error('[moderation] pending venues query failed:', error.code, error.message, error.hint);
        throw error;
      }
      return (data ?? []) as AdminVenue[];
    },
    enabled: isAdmin,
    // categorySlug may still be resolving — if slug is set but ID is null yet,
    // hold until the ID arrives to avoid a flash of unfiltered results.
    // We handle this by letting resolvedCategoryId be in the queryKey so a new
    // fetch fires once the ID resolves.
  });

  // Append each new page into allVenues when data arrives.
  useEffect(() => {
    if (pageVenues.length === 0) return;
    if (page === 0) {
      setAllVenues(pageVenues);
    } else {
      setAllVenues((prev) => {
        const existingIds = new Set(prev.map((v) => v.id));
        const newRows = pageVenues.filter((v) => !existingIds.has(v.id));
        return [...prev, ...newRows];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageVenues]);

  // ── Count query — for "Showing X of Y total" row ─────────────────────────
  const { data: pendingTotalCount = 0 } = useQuery<number>({
    queryKey: ['admin', 'pending-count', {
      categoryId: resolvedCategoryId,
      hasWebsiteFilter,
      hasPostcodeFilter,
      unknownAreaFilter,
    }],
    queryFn: async () => {
      let q = supabase
        .from('venues')
        .select('*', { count: 'exact', head: true })
        .eq('moderation_status', 'pending')
        .eq('is_published', false);

      if (resolvedCategoryId) q = q.eq('category_id', resolvedCategoryId);
      if (hasWebsiteFilter)   q = q.not('website', 'is', null).neq('website', '');
      if (hasPostcodeFilter)  q = q.not('postcode', 'is', null).neq('postcode', '');
      if (unknownAreaFilter)  q = q.or('city.is.null,city.eq.');

      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin,
  });

  // ── Apply client-side filters (keyword + search) ─────────────────────────
  const displayedVenues: AdminVenue[] = allVenues.filter((v) => {
    const nameLower = v.name.toLowerCase();

    if (familyFilter && !FAMILY_KEYWORDS.some((kw) => nameLower.includes(kw))) return false;
    if (junkFilter   && !JUNK_KEYWORDS.some((kw) => nameLower.includes(kw)))   return false;

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const matchesName = nameLower.includes(q);
      const matchesCity = (v.city ?? '').toLowerCase().includes(q);
      if (!matchesName && !matchesCity) return false;
    }

    return true;
  });

  // ── Claims data ──────────────────────────────────────────────────────────
  const { data: pendingClaims = [], isLoading: claimsLoading } = useAdminVenueClaims();
  const reviewClaim = useReviewClaim();

  // ── Bulk approve count ───────────────────────────────────────────────────
  // Only runs when the modal is open to avoid a background COUNT on every render.
  const { data: bulkCount = 0 } = useQuery({
    queryKey: ['admin', 'bulk-count', bulkSource],
    queryFn: async () => {
      let q = supabase
        .from('venues')
        .select('*', { count: 'exact', head: true })
        .eq('moderation_status', 'pending')
        .eq('is_published', false);
      if (bulkSource) q = q.eq('data_source', bulkSource);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin && bulkModalVisible,
  });

  // ── Bulk reject count (reuses bulkSource selection from approve modal) ───
  const { data: bulkRejectCount = 0 } = useQuery({
    queryKey: ['admin', 'bulk-reject-count', bulkSource],
    queryFn: async () => {
      let q = supabase
        .from('venues')
        .select('*', { count: 'exact', head: true })
        .eq('moderation_status', 'pending')
        .eq('is_published', false);
      if (bulkSource) q = q.eq('data_source', bulkSource);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin && bulkRejectModalVisible,
  });

  // ── Pending photos query ─────────────────────────────────────────────────
  // B9 — Filter orphaned photos (.not('venue', 'is', null)) so we never render
  // a card with a null venue.
  const { data: pendingPhotos = [], isLoading: photosLoading } = useQuery({
    queryKey: ['pendingPhotos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_photos')
        .select('*, venue:venues(id, name)')
        .eq('status', 'pending')
        .not('venue', 'is', null)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PendingPhotoWithVenue[];
    },
    enabled: isAdmin,
  });

  // ── Pending reviews query ────────────────────────────────────────────────
  // WHY `profiles!reviews_user_id_fkey` and NOT `public_profiles`:
  //   The FK constraint targets the base `profiles` table, not the VIEW.
  //   Using the view was silently hiding pending reviews for users with
  //   show_in_search=false. Only non-sensitive columns are selected.
  const { data: pendingReviews = [], isLoading: reviewsLoading, error: reviewsError } = useQuery({
    queryKey: ['admin', 'pending-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, title, body, created_at, venue_id, venues(id, name), profile:profiles!reviews_user_id_fkey(username, full_name)')
        .eq('moderation_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) {
        console.error('[moderation] pending reviews query failed:', error.code, error.hint, error.message);
        throw error;
      }
      return (data ?? []) as unknown as PendingReview[];
    },
    enabled: isAdmin,
  });

  // ── Bulk approve mutation ────────────────────────────────────────────────
  // WHY .select('id') is chained: forces return=representation so a silent
  // RLS no-op becomes a visible zero-row error rather than a false success.
  // NEVER touches is_published=true rows — guarded by .eq('is_published', false).
  const bulkApprove = useMutation({
    mutationFn: async (source: string | null) => {
      let q = supabase
        .from('venues')
        .update({
          moderation_status: 'approved',
          is_published:      true,
          moderated_by:      user!.id,
          moderated_at:      new Date().toISOString(),
          moderation_notes:  'bulk-approved-from-admin-ui',
        })
        .eq('moderation_status', 'pending')
        .eq('is_published', false);
      if (source) q = q.eq('data_source', source);
      const { data, error } = await q.select('id');
      if (error) {
        console.error('[moderation] bulk approve failed:', error.code, error.message, error.hint);
        throw error;
      }
      if (!data || data.length === 0) {
        throw new Error('No venues were approved — your admin permissions may have changed. Sign out and back in, then try again.');
      }
      return data.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-venues'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'bulk-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['venues'] });
      setBulkModalVisible(false);
      setAllVenues([]);
      setPage(0);
      Alert.alert('Done', `${count.toLocaleString()} venue${count !== 1 ? 's' : ''} approved and live on the map.`);
    },
    onError: (err: Error) => {
      Alert.alert('Bulk approval failed', err.message || 'Could not approve venues. Please try again.');
      setBulkModalVisible(false);
    },
  });

  // ── Bulk reject mutation ─────────────────────────────────────────────────
  // Mirror of bulkApprove. Never touches is_published=true rows.
  const bulkReject = useMutation({
    mutationFn: async (source: string | null) => {
      let q = supabase
        .from('venues')
        .update({
          moderation_status: 'rejected',
          is_published:      false,
          moderated_by:      user!.id,
          moderated_at:      new Date().toISOString(),
          moderation_notes:  'bulk-rejected-from-admin-ui',
        })
        .eq('moderation_status', 'pending')
        .eq('is_published', false);
      if (source) q = q.eq('data_source', source);
      const { data, error } = await q.select('id');
      if (error) {
        console.error('[moderation] bulk reject failed:', error.code, error.message, error.hint);
        throw error;
      }
      if (!data || data.length === 0) {
        throw new Error('No venues were rejected — your admin permissions may have changed. Sign out and back in, then try again.');
      }
      return data.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-venues'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'bulk-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'bulk-reject-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['venues'] });
      setBulkRejectModalVisible(false);
      setAllVenues([]);
      setPage(0);
      Alert.alert('Done', `${count.toLocaleString()} venue${count !== 1 ? 's' : ''} rejected.`);
    },
    onError: (err: Error) => {
      Alert.alert('Bulk rejection failed', err.message || 'Could not reject venues. Please try again.');
      setBulkRejectModalVisible(false);
    },
  });

  const moderateReview = useModerateReview();

  const openReviewRejectModal = (reviewId: string) => {
    setRejectReviewId(reviewId);
    setRejectReviewReason('');
    setRejectReviewModalVisible(true);
  };

  const confirmReviewRejection = () => {
    if (!rejectReviewId) return;
    moderateReview.mutate(
      { reviewId: rejectReviewId, status: 'rejected', moderation_notes: rejectReviewReason },
      {
        onSuccess: () => {
          setRejectReviewModalVisible(false);
          setRejectReviewId(null);
          setRejectReviewReason('');
        },
        onError: () => {
          Alert.alert('Moderation failed', 'Could not reject review. Please try again.');
          setRejectReviewModalVisible(false);
          setRejectReviewId(null);
          setRejectReviewReason('');
        },
      }
    );
  };

  const cancelReviewRejection = () => {
    setRejectReviewModalVisible(false);
    setRejectReviewId(null);
    setRejectReviewReason('');
  };

  const moderatePhoto = useModeratePhoto();

  const openPhotoRejectModal = (photoId: string, venueId: string) => {
    setRejectPhotoId(photoId);
    setRejectPhotoVenueId(venueId);
    setRejectPhotoReason('');
    setRejectPhotoModalVisible(true);
  };

  // B8 — Modal state is reset inside onSuccess/onError, not synchronously before
  // the mutation resolves, to prevent double-submission.
  const confirmPhotoRejection = () => {
    if (!rejectPhotoId || !rejectPhotoVenueId) return;
    moderatePhoto.mutate(
      {
        photoId: rejectPhotoId,
        venueId: rejectPhotoVenueId,
        status: 'rejected',
        moderation_notes: rejectPhotoReason.trim() || undefined,
      },
      {
        onSuccess: () => {
          setRejectPhotoModalVisible(false);
          setRejectPhotoId(null);
          setRejectPhotoVenueId(null);
          setRejectPhotoReason('');
        },
        onError: () => {
          Alert.alert('Moderation failed', 'Could not reject photo. Please try again.');
          setRejectPhotoModalVisible(false);
          setRejectPhotoId(null);
          setRejectPhotoVenueId(null);
          setRejectPhotoReason('');
        },
      }
    );
  };

  const cancelPhotoRejection = () => {
    setRejectPhotoModalVisible(false);
    setRejectPhotoId(null);
    setRejectPhotoVenueId(null);
    setRejectPhotoReason('');
  };

  // ── Individual venue moderation ──────────────────────────────────────────
  // WHY .select('id'): forces return=representation so a silent RLS no-op
  // is caught as a zero-row error rather than a false success.
  // NEVER touches is_published=true rows — the query targets by ID so the
  // RLS policy on the DB is the primary guard; we also set is_published only
  // when approving.
  const moderateVenue = useMutation({
    mutationFn: async ({ id, action, notes }: { id: string; action: 'approved' | 'rejected'; notes?: string }) => {
      const { data, error } = await supabase
        .from('venues')
        .update({
          moderation_status: action,
          is_published:      action === 'approved',
          moderation_notes:  notes ?? (action === 'approved' ? 'admin-approved' : 'admin-rejected'),
          moderated_by:      user!.id,
          moderated_at:      new Date().toISOString(),
        })
        .eq('id', id)
        .eq('is_published', false)   // never touch a venue already published
        .select('id');

      if (error) {
        console.error('[moderation] venue update failed:', error.code, error.message, error.hint);
        throw error;
      }
      if (!data || data.length === 0) {
        throw new Error('No rows updated — your admin permissions may have changed. Sign out and back in, then try again.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-venues'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'bulk-count'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['venues'] });
      // Optimistically remove the venue from the local list for instant feedback.
      setAllVenues((prev) => prev.filter((v) => v.id !== variables.id));
    },
    onError: (err: Error) => {
      Alert.alert('Moderation failed', err.message || 'Could not update venue status. Please try again.');
    },
  });

  const openRejectModal = (venueId: string) => {
    setRejectVenueId(venueId);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  const confirmRejection = () => {
    if (!rejectVenueId) return;
    moderateVenue.mutate(
      {
        id: rejectVenueId,
        action: 'rejected',
        notes: rejectReason.trim() || 'admin-rejected',
      },
      {
        onSuccess: () => {
          setRejectModalVisible(false);
          setRejectVenueId(null);
          setRejectReason('');
        },
        onError: () => {
          setRejectModalVisible(false);
          setRejectVenueId(null);
          setRejectReason('');
        },
      }
    );
  };

  const cancelRejection = () => {
    setRejectModalVisible(false);
    setRejectVenueId(null);
    setRejectReason('');
  };

  // ── Auth / admin guard ───────────────────────────────────────────────────
  if (authIsLoading || (user && !profile)) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center">
        <ActivityIndicator color="#FF6B6B" size="large" />
      </SafeAreaView>
    );
  }

  if (!isAdmin) return <Redirect href="/(tabs)" />;

  const totalPending =
    pendingTotalCount + pendingPhotos.length + pendingReviews.length + pendingClaims.length;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>

      {/* ── Venue rejection modal ─────────────────────────────────────────── */}
      <Modal
        visible={rejectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelRejection}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Rejection reason</Text>
            <Text className="text-grey text-sm mb-4">Optional note for the submitter:</Text>
            <TextInput
              className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px]"
              multiline
              placeholder="e.g. Duplicate listing, missing info..."
              value={rejectReason}
              onChangeText={setRejectReason}
              autoFocus
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={cancelRejection}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="venue-reject-modal-confirm"
                className="flex-1 bg-error rounded-xl py-3 items-center"
                onPress={confirmRejection}
                disabled={moderateVenue.isPending}
              >
                {moderateVenue.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Photo rejection modal ─────────────────────────────────────────── */}
      <Modal
        visible={rejectPhotoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelPhotoRejection}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Photo rejection reason</Text>
            <Text className="text-grey text-sm mb-4">Optional note for the uploader:</Text>
            <TextInput
              className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px]"
              multiline
              placeholder="e.g. Contains identifiable children, poor quality..."
              value={rejectPhotoReason}
              onChangeText={setRejectPhotoReason}
              autoFocus
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={cancelPhotoRejection}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              {/* B8 — Disabled while mutation is in-flight to prevent double-submission */}
              <TouchableOpacity
                className="flex-1 bg-error rounded-xl py-3 items-center"
                onPress={confirmPhotoRejection}
                disabled={moderatePhoto.isPending}
              >
                {moderatePhoto.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Review rejection modal ────────────────────────────────────────── */}
      <Modal
        visible={rejectReviewModalVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelReviewRejection}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Review rejection reason</Text>
            <Text className="text-grey text-sm mb-4">
              This note will be shown to the reviewer so they understand the decision.
            </Text>
            <TextInput
              className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px]"
              multiline
              placeholder="e.g. Contains personal information, off-topic content..."
              value={rejectReviewReason}
              onChangeText={setRejectReviewReason}
              autoFocus
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={cancelReviewRejection}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-error rounded-xl py-3 items-center"
                onPress={confirmReviewRejection}
                disabled={moderateReview.isPending}
              >
                {moderateReview.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Claim rejection modal ─────────────────────────────────────────── */}
      <Modal
        visible={rejectClaimModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRejectClaimModalVisible(false);
          setRejectClaimId(null);
          setRejectClaimVenueId(null);
          setRejectClaimUserId(null);
          setRejectClaimReason('');
        }}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Reject claim</Text>
            <Text className="text-grey text-sm mb-4">
              Optional note for the claimant explaining the decision:
            </Text>
            <TextInput
              className="border border-greyLighter rounded-xl px-3 py-2 text-charcoal min-h-[80px]"
              multiline
              placeholder="e.g. Could not verify ownership, please provide additional documentation..."
              value={rejectClaimReason}
              onChangeText={setRejectClaimReason}
              autoFocus
            />
            <View className="flex-row gap-3 mt-4">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={() => {
                  setRejectClaimModalVisible(false);
                  setRejectClaimId(null);
                  setRejectClaimVenueId(null);
                  setRejectClaimUserId(null);
                  setRejectClaimReason('');
                }}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-error rounded-xl py-3 items-center"
                disabled={reviewClaim.isPending}
                onPress={() => {
                  if (!rejectClaimId || !rejectClaimVenueId || !rejectClaimUserId) return;
                  reviewClaim.mutate(
                    {
                      claimId:    rejectClaimId,
                      venueId:    rejectClaimVenueId,
                      userId:     rejectClaimUserId,
                      decision:   'rejected',
                      adminNotes: rejectClaimReason.trim() || undefined,
                    },
                    {
                      onSuccess: () => {
                        setRejectClaimModalVisible(false);
                        setRejectClaimId(null);
                        setRejectClaimVenueId(null);
                        setRejectClaimUserId(null);
                        setRejectClaimReason('');
                      },
                      onError: () => {
                        Alert.alert('Moderation failed', 'Could not reject claim. Please try again.');
                        setRejectClaimModalVisible(false);
                        setRejectClaimId(null);
                        setRejectClaimVenueId(null);
                        setRejectClaimUserId(null);
                        setRejectClaimReason('');
                      },
                    }
                  );
                }}
              >
                {reviewClaim.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Bulk approve modal ────────────────────────────────────────────── */}
      <Modal
        visible={bulkModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Bulk approve venues</Text>
            <Text className="text-grey text-sm mb-4">
              Review a sample of venues manually before approving in bulk.
            </Text>

            <Text className="text-charcoal font-bold text-sm mb-2">Approve from source:</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {[
                { label: 'All',            value: null              },
                { label: 'OpenStreetMap',  value: 'osm'             },
                { label: 'Gov Open Data',  value: 'ogl'             },
                { label: 'User submitted', value: 'user_submitted'  },
                { label: 'Manual',         value: 'manual'          },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  onPress={() => setBulkSource(opt.value)}
                  className={`px-3 py-2 rounded-full border ${
                    bulkSource === opt.value
                      ? 'bg-sky border-sky'
                      : 'bg-sandDark border-greyLighter'
                  }`}
                >
                  <Text className={`text-xs font-bold ${bulkSource === opt.value ? 'text-white' : 'text-charcoal'}`}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="bg-sandDark rounded-xl px-4 py-3 mb-4">
              <Text className="text-charcoal text-sm text-center">
                This will approve{' '}
                <Text className="font-bold">{bulkCount.toLocaleString()}</Text>
                {' '}venue{bulkCount !== 1 ? 's' : ''} and make{' '}
                {bulkCount !== 1 ? 'them' : 'it'} visible to parents.
              </Text>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={() => setBulkModalVisible(false)}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-success rounded-xl py-3 items-center"
                disabled={bulkApprove.isPending || bulkCount === 0}
                onPress={() => bulkApprove.mutate(bulkSource)}
              >
                {bulkApprove.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">
                      Approve {bulkCount > 0 ? bulkCount.toLocaleString() : ''}
                    </Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Bulk reject modal ─────────────────────────────────────────────── */}
      <Modal
        visible={bulkRejectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkRejectModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-charcoal font-bold text-lg mb-1">Bulk reject venues</Text>
            <Text className="text-grey text-sm mb-4">
              This action cannot be undone. Only pending, unpublished venues are affected.
            </Text>

            <Text className="text-charcoal font-bold text-sm mb-2">Reject from source:</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {[
                { label: 'All',            value: null              },
                { label: 'OpenStreetMap',  value: 'osm'             },
                { label: 'Gov Open Data',  value: 'ogl'             },
                { label: 'User submitted', value: 'user_submitted'  },
                { label: 'Manual',         value: 'manual'          },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  onPress={() => setBulkSource(opt.value)}
                  className={`px-3 py-2 rounded-full border ${
                    bulkSource === opt.value
                      ? 'bg-coral border-coral'
                      : 'bg-sandDark border-greyLighter'
                  }`}
                >
                  <Text className={`text-xs font-bold ${bulkSource === opt.value ? 'text-white' : 'text-charcoal'}`}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="bg-sandDark rounded-xl px-4 py-3 mb-4">
              <Text className="text-charcoal text-sm text-center">
                This will reject{' '}
                <Text className="font-bold text-error">{bulkRejectCount.toLocaleString()}</Text>
                {' '}venue{bulkRejectCount !== 1 ? 's' : ''}. They will not appear on the map.
              </Text>
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 bg-sandDark rounded-xl py-3 items-center"
                onPress={() => setBulkRejectModalVisible(false)}
              >
                <Text className="text-charcoal font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-error rounded-xl py-3 items-center"
                disabled={bulkReject.isPending || bulkRejectCount === 0}
                onPress={() => bulkReject.mutate(bulkSource)}
              >
                {bulkReject.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text className="text-white font-bold">
                      Reject {bulkRejectCount > 0 ? bulkRejectCount.toLocaleString() : ''}
                    </Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Screen header ─────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-coral">←</Text>
        </TouchableOpacity>
        <Text className="text-2xl font-extrabold text-charcoal">Moderation</Text>
        <View className="bg-coral rounded-full w-6 h-6 items-center justify-center ml-2">
          <Text className="text-white text-xs font-bold">{totalPending}</Text>
        </View>
      </View>

      {/* ── Tab switcher ──────────────────────────────────────────────────── */}
      <View className="flex-row px-4 pb-2 gap-2">
        {([
          { key: 'venues',  label: `Venues (${pendingTotalCount})` },
          { key: 'photos',  label: `Photos (${pendingPhotos.length})` },
          { key: 'reviews', label: `Reviews (${pendingReviews.length})` },
          { key: 'claims',  label: `Claims (${pendingClaims.length})` },
        ] as const).map((tab) => (
          <TouchableOpacity
            key={tab.key}
            className={`flex-1 py-2 rounded-xl items-center ${activeTab === tab.key ? 'bg-coral' : 'bg-sandDark'}`}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text className={`font-bold text-xs ${activeTab === tab.key ? 'text-white' : 'text-charcoal'}`}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ══════════════════════════════════════════════════════════════════════
          VENUES TAB — full-featured queue with filter/sort/search/pagination
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'venues' && (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8">

          {/* Header row: label + bulk action buttons */}
          <View className="flex-row justify-between items-center mb-3 mt-1">
            <Text className="text-grey font-bold uppercase text-xs">Pending venue submissions</Text>
            <View className="flex-row gap-2">
              <TouchableOpacity
                className="bg-success rounded-lg px-3 py-1.5"
                onPress={() => { setBulkSource(null); setBulkModalVisible(true); }}
              >
                <Text className="text-white font-bold text-xs">Bulk approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="bg-error rounded-lg px-3 py-1.5"
                onPress={() => { setBulkSource(null); setBulkRejectModalVisible(true); }}
              >
                <Text className="text-white font-bold text-xs">Bulk reject</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Search bar */}
          <TextInput
            className="bg-white border border-greyLighter rounded-xl px-4 py-2 text-charcoal mb-3"
            placeholder="Search by name or city..."
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={(t) => {
              setSearchText(t);
              resetPagination();
            }}
            clearButtonMode="while-editing"
          />

          {/* Category chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            <View className="flex-row gap-2 pr-4">
              <TouchableOpacity
                onPress={() => { setCategorySlug(null); resetPagination(); }}
                className={`px-3 py-1.5 rounded-full border ${
                  categorySlug === null ? 'bg-coral border-coral' : 'bg-sandDark border-greyLighter'
                }`}
              >
                <Text className={`text-xs font-bold ${categorySlug === null ? 'text-white' : 'text-charcoal'}`}>
                  All
                </Text>
              </TouchableOpacity>
              {ADMIN_CATEGORY_CHIPS.map((chip) => (
                <TouchableOpacity
                  key={chip.slug}
                  onPress={() => {
                    setCategorySlug(categorySlug === chip.slug ? null : chip.slug);
                    resetPagination();
                  }}
                  className={`px-3 py-1.5 rounded-full border ${
                    categorySlug === chip.slug ? 'bg-coral border-coral' : 'bg-sandDark border-greyLighter'
                  }`}
                >
                  <Text className={`text-xs font-bold ${categorySlug === chip.slug ? 'text-white' : 'text-charcoal'}`}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            <View className="flex-row gap-2 pr-4">
              {([
                { label: 'Has website',     active: hasWebsiteFilter,  onToggle: () => { setHasWebsiteFilter((v) => !v);  resetPagination(); } },
                { label: 'Has postcode',    active: hasPostcodeFilter, onToggle: () => { setHasPostcodeFilter((v) => !v); resetPagination(); } },
                { label: 'Unknown area',    active: unknownAreaFilter, onToggle: () => { setUnknownAreaFilter((v) => !v); resetPagination(); } },
                { label: 'Family keywords', active: familyFilter,      onToggle: () => setFamilyFilter((v) => !v)                             },
                { label: 'Junk keywords',   active: junkFilter,        onToggle: () => setJunkFilter((v) => !v)                               },
              ]).map((chip) => (
                <TouchableOpacity
                  key={chip.label}
                  onPress={chip.onToggle}
                  className={`px-3 py-1.5 rounded-full border ${
                    chip.active ? 'bg-sky border-sky' : 'bg-sandDark border-greyLighter'
                  }`}
                >
                  <Text className={`text-xs font-bold ${chip.active ? 'text-white' : 'text-charcoal'}`}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Sort row */}
          <View className="flex-row gap-2 mb-3">
            {([
              { key: 'newest',   label: 'Newest'   },
              { key: 'name',     label: 'Name'     },
              { key: 'category', label: 'Category' },
            ] as const).map((btn) => (
              <TouchableOpacity
                key={btn.key}
                onPress={() => { setSortBy(btn.key); resetPagination(); }}
                className={`flex-1 py-2 rounded-xl items-center border ${
                  sortBy === btn.key ? 'bg-charcoal border-charcoal' : 'bg-sandDark border-greyLighter'
                }`}
              >
                <Text className={`text-xs font-bold ${sortBy === btn.key ? 'text-white' : 'text-charcoal'}`}>
                  {btn.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Counts row */}
          <Text className="text-grey text-xs mb-3">
            Showing {displayedVenues.length.toLocaleString()} of{' '}
            {pendingTotalCount.toLocaleString()} total pending
          </Text>

          {/* Loading state */}
          {venuesLoading && allVenues.length === 0 && (
            <ActivityIndicator color="#FF6B6B" className="mt-8" />
          )}

          {/* Empty state */}
          {!venuesLoading && displayedVenues.length === 0 && (
            <View className="items-center py-12">
              <Text className="text-grey">No venues match the current filters.</Text>
            </View>
          )}

          {/* Venue cards */}
          {displayedVenues.map((venue) => (
            <View key={venue.id} className="bg-white rounded-2xl p-4 mb-4 shadow-sm">

              {/* Name + data source badge */}
              <View className="flex-row items-start justify-between mb-1">
                <Text className="text-charcoal font-extrabold text-base flex-1 mr-2">{venue.name}</Text>
                {venue.data_source && (
                  <View className="bg-sandDark rounded-full px-2 py-0.5">
                    <Text className="text-grey text-xs font-bold uppercase">
                      {venue.data_source === 'user_submitted' ? 'user' : venue.data_source}
                    </Text>
                  </View>
                )}
              </View>

              {/* Category pill */}
              {venue.category && (
                <View className="flex-row mb-1">
                  <View className="bg-sky/20 rounded-full px-2 py-0.5">
                    <Text className="text-sky text-xs font-bold">{venue.category.slug}</Text>
                  </View>
                </View>
              )}

              {/* City + postcode */}
              <Text className="text-grey text-sm">
                {[venue.city, venue.postcode].filter(Boolean).join(', ') || 'No area info'}
              </Text>

              {/* Website (tappable) */}
              {venue.website ? (
                <TouchableOpacity onPress={() => Linking.openURL(venue.website!)}>
                  <Text className="text-sky text-xs mt-1" numberOfLines={1}>{venue.website}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Lat/lng */}
              <Text className="text-greyLighter text-xs mt-1">
                {venue.latitude.toFixed(4)}, {venue.longitude.toFixed(4)}
              </Text>

              {/* Previous moderation notes */}
              {venue.moderation_notes ? (
                <Text className="text-grey text-xs mt-1 italic">{venue.moderation_notes}</Text>
              ) : null}

              {/* Created date */}
              <Text className="text-grey text-xs mt-1">
                Added: {new Date(venue.created_at).toLocaleDateString('en-GB')}
              </Text>

              {/* Action buttons row 1: Approve + Reject */}
              <View className="flex-row gap-2 mt-3">
                <TouchableOpacity
                  className="flex-1 bg-success rounded-xl py-3 items-center"
                  disabled={moderateVenue.isPending}
                  onPress={() =>
                    moderateVenue.mutate({ id: venue.id, action: 'approved', notes: 'admin-approved' })
                  }
                >
                  <Text className="text-white font-bold">Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`venue-reject-btn-${venue.id}`}
                  className="flex-1 bg-error rounded-xl py-3 items-center"
                  disabled={moderateVenue.isPending}
                  onPress={() => openRejectModal(venue.id)}
                >
                  <Text className="text-white font-bold">Reject</Text>
                </TouchableOpacity>
              </View>

              {/* Action buttons row 2: Skip + Map + Website */}
              <View className="flex-row gap-2 mt-2">
                <TouchableOpacity
                  className="bg-sandDark rounded-lg px-3 py-1.5"
                  onPress={() => setAllVenues((prev) => prev.filter((v) => v.id !== venue.id))}
                >
                  <Text className="text-grey text-xs font-bold">Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="bg-sandDark rounded-lg px-3 py-1.5"
                  onPress={() =>
                    Linking.openURL(`https://maps.google.com/?q=${venue.latitude},${venue.longitude}`)
                  }
                >
                  <Text className="text-grey text-xs font-bold">Map</Text>
                </TouchableOpacity>
                {venue.website ? (
                  <TouchableOpacity
                    className="bg-sandDark rounded-lg px-3 py-1.5"
                    onPress={() => Linking.openURL(venue.website!)}
                  >
                    <Text className="text-sky text-xs font-bold">Website</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}

          {/* Load more button */}
          {allVenues.length > 0 && pageVenues.length === 50 && (
            <TouchableOpacity
              className="bg-sandDark rounded-xl py-3 items-center mt-2 mb-4"
              disabled={venuesFetching}
              onPress={() => setPage((p) => p + 1)}
            >
              {venuesFetching
                ? <ActivityIndicator color="#FF6B6B" size="small" />
                : <Text className="text-charcoal font-bold">Load more venues</Text>}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          REVIEWS TAB — FlatList for memory efficiency
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'reviews' && (
        reviewsLoading ? (
          <ActivityIndicator className="mt-8" color="#FF6B6B" />
        ) : reviewsError ? (
          <View className="items-center py-12 px-6">
            <Text className="text-charcoal font-bold text-center">Couldn't load pending reviews</Text>
            <Text className="text-grey text-sm text-center mt-1">Pull to retry, or sign out and back in.</Text>
          </View>
        ) : (
          <FlatList
            data={pendingReviews}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-4"
            ListHeaderComponent={
              <Text className="text-grey font-bold uppercase text-xs mb-3">Pending review submissions</Text>
            }
            ListEmptyComponent={
              <View className="items-center py-12">
                <Text className="text-grey">All caught up! No pending reviews.</Text>
              </View>
            }
            renderItem={({ item: review }) => (
              <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
                <Text className="text-charcoal font-extrabold text-base">
                  {review.venues?.name ?? 'Unknown venue'}
                </Text>
                <Text className="text-grey text-xs mt-1">
                  By {review.profile?.full_name ?? review.profile?.username ?? 'Anonymous'} ·{' '}
                  {new Date(review.created_at).toLocaleDateString('en-GB')}
                </Text>
                <View className="flex-row mt-2 gap-1">
                  {[1,2,3,4,5].map((n) => (
                    <Text key={n} className={n <= review.rating ? 'text-coral' : 'text-greyLighter'}>
                      {n <= review.rating ? '★' : '☆'}
                    </Text>
                  ))}
                </View>
                {review.title ? (
                  <Text className="text-charcoal font-bold text-sm mt-2">{review.title}</Text>
                ) : null}
                <Text className="text-charcoal text-sm mt-1 leading-5">{review.body}</Text>
                <View className="flex-row gap-2 mt-3">
                  <TouchableOpacity
                    className="flex-1 bg-success rounded-xl py-3 items-center"
                    disabled={moderateReview.isPending}
                    onPress={() => moderateReview.mutate({ reviewId: review.id, status: 'approved' })}
                  >
                    <Text className="text-white font-bold">Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error rounded-xl py-3 items-center"
                    disabled={moderateReview.isPending}
                    onPress={() => openReviewRejectModal(review.id)}
                  >
                    <Text className="text-white font-bold">Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          PHOTOS TAB — P3: FlatList instead of ScrollView+map prevents memory
          pressure from holding all image views in memory simultaneously.
          P4: expo-image provides disk caching + recyclingKey for list reuse.
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'photos' && (
        photosLoading ? (
          <ActivityIndicator className="mt-8" color="#FF6B6B" />
        ) : (
          <FlatList
            data={pendingPhotos}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-4"
            ListHeaderComponent={
              <Text className="text-grey font-bold uppercase text-xs mb-3">Pending photo submissions</Text>
            }
            ListEmptyComponent={
              <View className="items-center py-12">
                <Text className="text-grey">All caught up! No pending photos.</Text>
              </View>
            }
            renderItem={({ item: photo }) => (
              <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
                {/* B9 — venue is nullable; guard with ?. to avoid crash if orphaned */}
                <Text className="text-charcoal font-extrabold text-base">
                  {photo.venue?.name ?? 'Unknown venue'}
                </Text>
                <Text className="text-grey text-xs mt-1">
                  Submitted: {new Date(photo.created_at).toLocaleDateString('en-GB')}
                </Text>
                {/* P4 — expo-image: disk cache + recyclingKey */}
                {photo.url ? (
                  <Image
                    source={{ uri: photo.url }}
                    style={{ width: '100%', height: 180, borderRadius: 8, marginTop: 8 }}
                    contentFit="cover"
                    recyclingKey={photo.id}
                    transition={150}
                  />
                ) : null}
                {photo.caption ? (
                  <Text className="text-charcoal text-sm mt-2 italic" numberOfLines={2}>{photo.caption}</Text>
                ) : null}
                {/* B8 — Approve/Reject disabled while mutation is in-flight */}
                <View className="flex-row gap-2 mt-3">
                  <TouchableOpacity
                    className="flex-1 bg-success rounded-xl py-3 items-center"
                    disabled={moderatePhoto.isPending}
                    onPress={() =>
                      moderatePhoto.mutate({
                        photoId: photo.id,
                        venueId: photo.venue?.id ?? '',
                        status: 'approved',
                      })
                    }
                  >
                    <Text className="text-white font-bold">Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error rounded-xl py-3 items-center"
                    disabled={moderatePhoto.isPending}
                    onPress={() => openPhotoRejectModal(photo.id, photo.venue?.id ?? '')}
                  >
                    <Text className="text-white font-bold">Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          CLAIMS TAB
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'claims' && (
        claimsLoading ? (
          <ActivityIndicator className="mt-8" color="#FF6B6B" />
        ) : (
          <FlatList
            data={pendingClaims}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-4"
            ListHeaderComponent={
              <Text className="text-grey font-bold uppercase text-xs mb-3">Pending venue claims</Text>
            }
            ListEmptyComponent={
              <View className="items-center py-12">
                <Text className="text-grey">All caught up! No pending claims.</Text>
              </View>
            }
            renderItem={({ item: claim }) => {
              const maskedPhone = claim.verified_phone
                ? claim.verified_phone.replace(/(\+\d{2})(\d+)(\d{4})$/, (_m: string, prefix: string, mid: string, last: string) =>
                    `${prefix} ${'*'.repeat(mid.length)} ${last}`
                  )
                : '—';

              const venue    = (claim as any).venue    as { id: string; name: string; address_line1: string | null; city: string } | null;
              const claimant = (claim as any).claimant as { id: string; username: string | null; full_name: string | null } | null;

              return (
                <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
                  <Text className="text-charcoal font-extrabold text-base">
                    {venue?.name ?? 'Unknown venue'}
                  </Text>
                  {venue && (
                    <Text className="text-grey text-xs mt-0.5">
                      {[venue.address_line1, venue.city].filter(Boolean).join(', ')}
                    </Text>
                  )}
                  <Text className="text-charcoal text-sm mt-2">
                    <Text className="font-bold">Claimant: </Text>
                    {claimant?.full_name ?? claimant?.username ?? 'Unknown user'}
                    {claimant?.username ? ` (@${claimant.username})` : ''}
                  </Text>
                  <Text className="text-charcoal text-sm mt-1">
                    <Text className="font-bold">Phone (verified): </Text>
                    {maskedPhone}
                  </Text>
                  <Text className="text-grey text-xs mt-1">
                    Submitted: {new Date(claim.created_at).toLocaleDateString('en-GB')}
                  </Text>
                  {claim.notes ? (
                    <View className="bg-sandDark rounded-xl px-3 py-2 mt-3">
                      <Text className="text-grey text-xs font-bold uppercase mb-1">Claimant notes</Text>
                      <Text className="text-charcoal text-sm leading-5">{claim.notes}</Text>
                    </View>
                  ) : null}
                  <View className="flex-row gap-2 mt-3">
                    <TouchableOpacity
                      className="flex-1 bg-success rounded-xl py-3 items-center"
                      disabled={reviewClaim.isPending}
                      onPress={() =>
                        reviewClaim.mutate(
                          {
                            claimId: claim.id,
                            venueId: claim.venue_id,
                            userId:  claim.user_id,
                            decision: 'approved',
                          },
                          {
                            onError: () =>
                              Alert.alert('Moderation failed', 'Could not approve claim. Please try again.'),
                          }
                        )
                      }
                    >
                      <Text className="text-white font-bold">Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 bg-error rounded-xl py-3 items-center"
                      disabled={reviewClaim.isPending}
                      onPress={() => {
                        setRejectClaimId(claim.id);
                        setRejectClaimVenueId(claim.venue_id);
                        setRejectClaimUserId(claim.user_id);
                        setRejectClaimReason('');
                        setRejectClaimModalVisible(true);
                      }}
                    >
                      <Text className="text-white font-bold">Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )
      )}

    </SafeAreaView>
  );
}
