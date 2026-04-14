/**
 * Admin moderation screen — approve/reject pending venue submissions and photos.
 * Only visible to users with profile.is_admin = true.
 *
 * Guards:
 * - Waits for the auth profile to finish loading before rendering, so non-admins
 *   never briefly see the admin UI (race-condition fix).
 * - Uses a cross-platform Modal+TextInput for the rejection reason instead of
 *   Alert.prompt(), which only exists on iOS and crashes on Android.
 */
import { useState } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useIsAdmin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useModeratePhoto } from '@/hooks/useVenuePhotos';
import { useModerateReview } from '@/hooks/useReviews';
import type { Venue, PendingPhotoWithVenue } from '@/types';

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

export default function ModerationScreen() {
  const isAdmin = useIsAdmin();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const authIsLoading = useAuthStore((s) => s.isLoading);
  const queryClient = useQueryClient();

  // Tab switcher: 'venues' | 'photos' | 'reviews'
  const [activeTab, setActiveTab] = useState<'venues' | 'photos' | 'reviews'>('venues');

  // State for the cross-platform venue rejection modal (Alert.prompt is iOS-only)
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectVenueId, setRejectVenueId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // State for the photo rejection modal — same pattern as venue rejection
  const [rejectPhotoModalVisible, setRejectPhotoModalVisible] = useState(false);
  const [rejectPhotoId, setRejectPhotoId] = useState<string | null>(null);
  const [rejectPhotoVenueId, setRejectPhotoVenueId] = useState<string | null>(null);
  const [rejectPhotoReason, setRejectPhotoReason] = useState('');

  // State for the review rejection modal
  const [rejectReviewModalVisible, setRejectReviewModalVisible] = useState(false);
  const [rejectReviewId, setRejectReviewId] = useState<string | null>(null);
  const [rejectReviewReason, setRejectReviewReason] = useState('');

  // State for the bulk approve modal
  // bulkSource null = all pending venues; a string = filter by data_source value
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [bulkSource, setBulkSource] = useState<string | null>(null);

  // B11 — Destructure error and throw; previously only data was checked which
  // silently returned [] when the query failed, showing a false "all clear".
  const { data: pendingVenues = [], isLoading } = useQuery({
    queryKey: ['admin', 'pending-venues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select('*, submitted_by_profile:profiles!submitted_by(full_name)')
        .eq('moderation_status', 'pending')
        .order('created_at')
        // Safety cap — prevents loading thousands of rows on a busy platform.
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Venue[];
    },
    enabled: isAdmin,
  });

  // Pending photos query — joins venues so we can show the venue name on each card.
  // B9 — Filter out orphaned photos (venue deleted after photo was uploaded) via
  // .not('venue', 'is', null) so we never render a card with a null venue.
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

  // Pending reviews query — joins venues(name) and public_profiles(username, full_name)
  // for display in the moderation card. We never log review body content.
  const { data: pendingReviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['admin', 'pending-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, title, body, created_at, venue_id, venues(id, name), profile:public_profiles!reviews_user_id_fkey(username, full_name)')
        .eq('moderation_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PendingReview[];
    },
    enabled: isAdmin,
  });

  // Bulk approve count — how many venues will be affected by the current selection.
  // Only runs when the modal is open (enabled: bulkModalVisible) to avoid
  // a background COUNT(*) query on every render.
  const { data: bulkCount = 0 } = useQuery({
    queryKey: ['admin', 'bulk-count', bulkSource],
    queryFn: async () => {
      let q = supabase
        .from('venues')
        .select('*', { count: 'exact', head: true })
        .eq('moderation_status', 'pending');
      if (bulkSource) q = q.eq('data_source', bulkSource);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin && bulkModalVisible,
  });

  // Bulk approve mutation — updates ALL pending venues matching the source filter
  // in a single DB call. Admins must review a sample first (documented in the UI).
  // Sets moderated_by + moderated_at so the audit trail is maintained.
  const bulkApprove = useMutation({
    mutationFn: async (source: string | null) => {
      let q = supabase
        .from('venues')
        .update({
          moderation_status: 'approved',
          is_published:      true,
          moderated_by:      user!.id,
          moderated_at:      new Date().toISOString(),
        })
        .eq('moderation_status', 'pending');
      if (source) q = q.eq('data_source', source);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-venues'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'bulk-count'] });
      setBulkModalVisible(false);
      Alert.alert('Done', 'Venues approved and live on the map.');
    },
    onError: () => {
      Alert.alert('Bulk approval failed', 'Could not approve venues. Please try again.');
      setBulkModalVisible(false);
    },
  });

  const moderateReview = useModerateReview();

  /** Open the review rejection modal for a specific review */
  const openReviewRejectModal = (reviewId: string) => {
    setRejectReviewId(reviewId);
    setRejectReviewReason('');
    setRejectReviewModalVisible(true);
  };

  /** Confirm review rejection — same in-flight guard pattern as photos */
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

  /** Cancel review rejection */
  const cancelReviewRejection = () => {
    setRejectReviewModalVisible(false);
    setRejectReviewId(null);
    setRejectReviewReason('');
  };

  const moderatePhoto = useModeratePhoto();

  /** Open the photo rejection modal for a specific photo */
  const openPhotoRejectModal = (photoId: string, venueId: string) => {
    setRejectPhotoId(photoId);
    setRejectPhotoVenueId(venueId);
    setRejectPhotoReason('');
    setRejectPhotoModalVisible(true);
  };

  // B8 — Modal state is reset inside onSuccess/onError, not synchronously before
  // the mutation resolves. Previously the modal closed before the network call
  // finished, allowing a second tap to fire a duplicate moderation request.
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

  /** Cancel photo rejection and close the modal */
  const cancelPhotoRejection = () => {
    setRejectPhotoModalVisible(false);
    setRejectPhotoId(null);
    setRejectPhotoVenueId(null);
    setRejectPhotoReason('');
  };

  // B12 — Destructure and throw on Supabase error. Previously the mutationFn
  // discarded the error, so failed moderations appeared to succeed silently.
  const moderateVenue = useMutation({
    mutationFn: async ({ id, action, notes }: { id: string; action: 'approved' | 'rejected'; notes?: string }) => {
      const { error } = await supabase.from('venues').update({
        moderation_status: action,
        is_published:      action === 'approved',
        moderation_notes:  notes ?? null,
        moderated_at:      new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'pending-venues'] }),
    onError: () => {
      Alert.alert('Moderation failed', 'Could not update venue status. Please try again.');
    },
  });

  /** Open the rejection modal for a specific venue */
  const openRejectModal = (venueId: string) => {
    setRejectVenueId(venueId);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  /** Confirm venue rejection and close the modal */
  const confirmRejection = () => {
    if (rejectVenueId) {
      moderateVenue.mutate({
        id: rejectVenueId,
        action: 'rejected',
        notes: rejectReason.trim() || undefined,
      });
    }
    setRejectModalVisible(false);
    setRejectVenueId(null);
    setRejectReason('');
  };

  /** Cancel venue rejection and close the modal */
  const cancelRejection = () => {
    setRejectModalVisible(false);
    setRejectVenueId(null);
    setRejectReason('');
  };

  // Wait for auth to fully hydrate before deciding admin status.
  if (authIsLoading || (user && !profile)) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center">
        <ActivityIndicator color="#FF6B6B" size="large" />
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center px-6">
        <Text className="text-4xl mb-4">🚫</Text>
        <Text className="text-charcoal font-bold text-lg text-center">Admin access required</Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}>
          <Text className="text-coral">← Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const totalPending = pendingVenues.length + pendingPhotos.length + pendingReviews.length;

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      {/* Venue rejection modal */}
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
                className="flex-1 bg-error rounded-xl py-3 items-center"
                onPress={confirmRejection}
              >
                <Text className="text-white font-bold">Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo rejection modal */}
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

      {/* Review rejection modal */}
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

      {/* Bulk approve modal */}
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

            {/* Source filter chips */}
            <Text className="text-charcoal font-bold text-sm mb-2">Approve from source:</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {[
                { label: 'All',           value: null       },
                { label: 'OpenStreetMap', value: 'osm'      },
                { label: 'Gov Open Data', value: 'ogl'      },
                { label: 'User submitted',value: 'user_submitted' },
                { label: 'Manual',        value: 'manual'   },
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

            {/* Count */}
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

      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-coral">←</Text>
        </TouchableOpacity>
        <Text className="text-2xl font-extrabold text-charcoal">Moderation</Text>
        <View className="bg-coral rounded-full w-6 h-6 items-center justify-center ml-2">
          <Text className="text-white text-xs font-bold">{totalPending}</Text>
        </View>
      </View>

      {/* Tab switcher */}
      <View className="flex-row px-4 pb-2 gap-2">
        <TouchableOpacity
          className={`flex-1 py-2 rounded-xl items-center ${activeTab === 'venues' ? 'bg-coral' : 'bg-sandDark'}`}
          onPress={() => setActiveTab('venues')}
        >
          <Text className={`font-bold text-xs ${activeTab === 'venues' ? 'text-white' : 'text-charcoal'}`}>
            Venues ({pendingVenues.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 py-2 rounded-xl items-center ${activeTab === 'photos' ? 'bg-coral' : 'bg-sandDark'}`}
          onPress={() => setActiveTab('photos')}
        >
          <Text className={`font-bold text-xs ${activeTab === 'photos' ? 'text-white' : 'text-charcoal'}`}>
            Photos ({pendingPhotos.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 py-2 rounded-xl items-center ${activeTab === 'reviews' ? 'bg-coral' : 'bg-sandDark'}`}
          onPress={() => setActiveTab('reviews')}
        >
          <Text className={`font-bold text-xs ${activeTab === 'reviews' ? 'text-white' : 'text-charcoal'}`}>
            Reviews ({pendingReviews.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Venues tab */}
      {activeTab === 'venues' && (
        isLoading ? (
          <ActivityIndicator className="mt-8" color="#FF6B6B" />
        ) : (
          <ScrollView className="px-4">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-grey font-bold uppercase text-xs">Pending venue submissions</Text>
              <TouchableOpacity
                className="bg-success rounded-lg px-3 py-1.5"
                onPress={() => { setBulkSource(null); setBulkModalVisible(true); }}
              >
                <Text className="text-white font-bold text-xs">Bulk approve</Text>
              </TouchableOpacity>
            </View>

            {pendingVenues.length === 0 && (
              <View className="items-center py-12">
                <Text className="text-4xl mb-2">✅</Text>
                <Text className="text-grey">All caught up! No pending submissions.</Text>
              </View>
            )}

            {pendingVenues.map((venue) => (
              <View key={venue.id} className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
                <View className="flex-row items-start justify-between">
                  <Text className="text-charcoal font-extrabold text-base flex-1 mr-2">{venue.name}</Text>
                  {(venue as any).data_source && (venue as any).data_source !== 'manual' && (
                    <View className="bg-sandDark rounded-full px-2 py-0.5">
                      <Text className="text-grey text-xs font-bold uppercase">
                        {(venue as any).data_source === 'user_submitted' ? 'user' : (venue as any).data_source}
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-grey text-sm">{venue.city}, {venue.postcode}</Text>
                {venue.description && (
                  <Text className="text-charcoal text-sm mt-2" numberOfLines={3}>{venue.description}</Text>
                )}
                <Text className="text-grey text-xs mt-2">
                  Submitted: {new Date(venue.created_at).toLocaleDateString('en-GB')}
                </Text>

                <View className="flex-row gap-2 mt-3">
                  <TouchableOpacity
                    className="flex-1 bg-success rounded-xl py-3 items-center"
                    disabled={moderateVenue.isPending}
                    onPress={() => moderateVenue.mutate({ id: venue.id, action: 'approved' })}
                  >
                    <Text className="text-white font-bold">✓ Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error rounded-xl py-3 items-center"
                    disabled={moderateVenue.isPending}
                    onPress={() => openRejectModal(venue.id)}
                  >
                    <Text className="text-white font-bold">✗ Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )
      )}

      {/* Reviews tab — FlatList for memory efficiency, same pattern as photos */}
      {activeTab === 'reviews' && (
        reviewsLoading ? (
          <ActivityIndicator className="mt-8" color="#FF6B6B" />
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
                <Text className="text-4xl mb-2">✅</Text>
                <Text className="text-grey">All caught up! No pending reviews.</Text>
              </View>
            }
            renderItem={({ item: review }) => (
              <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
                {/* Venue name */}
                <Text className="text-charcoal font-extrabold text-base">
                  {review.venues?.name ?? 'Unknown venue'}
                </Text>

                {/* Reviewer */}
                <Text className="text-grey text-xs mt-1">
                  By {review.profile?.full_name ?? review.profile?.username ?? 'Anonymous'} ·{' '}
                  {new Date(review.created_at).toLocaleDateString('en-GB')}
                </Text>

                {/* Star rating */}
                <View className="flex-row mt-2 gap-1">
                  {[1,2,3,4,5].map((n) => (
                    <Text key={n} className={n <= review.rating ? 'text-coral' : 'text-greyLighter'}>
                      {n <= review.rating ? '★' : '☆'}
                    </Text>
                  ))}
                </View>

                {/* Title */}
                {review.title ? (
                  <Text className="text-charcoal font-bold text-sm mt-2">{review.title}</Text>
                ) : null}

                {/* Body — full text visible to admin so they can make a decision */}
                <Text className="text-charcoal text-sm mt-1 leading-5">{review.body}</Text>

                {/* Approve / Reject buttons */}
                <View className="flex-row gap-2 mt-3">
                  <TouchableOpacity
                    className="flex-1 bg-success rounded-xl py-3 items-center"
                    disabled={moderateReview.isPending}
                    onPress={() =>
                      moderateReview.mutate({ reviewId: review.id, status: 'approved' })
                    }
                  >
                    <Text className="text-white font-bold">✓ Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error rounded-xl py-3 items-center"
                    disabled={moderateReview.isPending}
                    onPress={() => openReviewRejectModal(review.id)}
                  >
                    <Text className="text-white font-bold">✗ Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      )}

      {/* Photos tab — P3: FlatList instead of ScrollView+map prevents memory
          pressure from holding all image views in memory simultaneously.
          P4: expo-image provides disk caching + recyclingKey for list reuse. */}
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
                <Text className="text-4xl mb-2">✅</Text>
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

                {/* P4 — expo-image: disk cache + recyclingKey tells it to reuse
                    the native view as the list scrolls, preventing memory thrash */}
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
                    <Text className="text-white font-bold">✓ Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error rounded-xl py-3 items-center"
                    disabled={moderatePhoto.isPending}
                    onPress={() => openPhotoRejectModal(photo.id, photo.venue?.id ?? '')}
                  >
                    <Text className="text-white font-bold">✗ Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      )}
    </SafeAreaView>
  );
}
