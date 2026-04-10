/**
 * Admin moderation screen — approve/reject pending venue submissions and reviews.
 * Only visible to users with profile.is_admin = true.
 *
 * Guards:
 * - Waits for the auth profile to finish loading before rendering, so non-admins
 *   never briefly see the admin UI (race-condition fix).
 * - Uses a cross-platform Modal+TextInput for the rejection reason instead of
 *   Alert.prompt(), which only exists on iOS and crashes on Android.
 */
import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useIsAdmin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import type { Venue, Review } from '@/types';

export default function ModerationScreen() {
  const isAdmin = useIsAdmin();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const authIsLoading = useAuthStore((s) => s.isLoading);
  const queryClient = useQueryClient();

  // State for the cross-platform rejection modal (Alert.prompt is iOS-only)
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectVenueId, setRejectVenueId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: pendingVenues = [], isLoading } = useQuery({
    queryKey: ['admin', 'pending-venues'],
    queryFn: async () => {
      const { data } = await supabase
        .from('venues')
        .select('*, submitted_by_profile:profiles!submitted_by(full_name)')
        .eq('moderation_status', 'pending')
        .order('created_at');
      return (data ?? []) as Venue[];
    },
    enabled: isAdmin,
  });

  const moderateVenue = useMutation({
    mutationFn: async ({ id, action, notes }: { id: string; action: 'approved' | 'rejected'; notes?: string }) => {
      await supabase.from('venues').update({
        moderation_status: action,
        is_published:      action === 'approved',
        moderation_notes:  notes ?? null,
        moderated_at:      new Date().toISOString(),
      }).eq('id', id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'pending-venues'] }),
  });

  /** Open the rejection modal for a specific venue */
  const openRejectModal = (venueId: string) => {
    setRejectVenueId(venueId);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  /** Confirm rejection and close the modal */
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

  /** Cancel rejection and close the modal */
  const cancelRejection = () => {
    setRejectModalVisible(false);
    setRejectVenueId(null);
    setRejectReason('');
  };

  // Wait for auth to fully hydrate before deciding admin status.
  // Two cases where we must show a spinner:
  // 1. authIsLoading: Supabase session is still being restored from storage.
  // 2. user exists but profile is null: session restored, but fetchProfile()
  //    is still in-flight (setSession sets isLoading=false before the async
  //    fetchProfile resolves). Without this, non-admins briefly see admin UI
  //    because isAdmin defaults to false when profile is null.
  // If there's no user at all (not logged in), skip straight to the !isAdmin guard.
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

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      {/* Rejection reason modal — cross-platform replacement for Alert.prompt */}
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

      <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-coral">←</Text>
        </TouchableOpacity>
        <Text className="text-2xl font-extrabold text-charcoal">Moderation</Text>
        <View className="bg-coral rounded-full w-6 h-6 items-center justify-center ml-2">
          <Text className="text-white text-xs font-bold">{pendingVenues.length}</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator className="mt-8" color="#FF6B6B" />
      ) : (
        <ScrollView className="px-4">
          <Text className="text-grey font-bold uppercase text-xs mb-3">Pending venue submissions</Text>

          {pendingVenues.length === 0 && (
            <View className="items-center py-12">
              <Text className="text-4xl mb-2">✅</Text>
              <Text className="text-grey">All caught up! No pending submissions.</Text>
            </View>
          )}

          {pendingVenues.map((venue) => (
            <View key={venue.id} className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
              <Text className="text-charcoal font-extrabold text-base">{venue.name}</Text>
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
                  onPress={() => moderateVenue.mutate({ id: venue.id, action: 'approved' })}
                >
                  <Text className="text-white font-bold">✓ Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-error rounded-xl py-3 items-center"
                  onPress={() => openRejectModal(venue.id)}
                >
                  <Text className="text-white font-bold">✗ Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
