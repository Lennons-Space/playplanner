/**
 * Admin moderation screen — approve/reject pending venue submissions and reviews.
 * Only visible to users with profile.is_admin = true.
 */
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useIsAdmin } from '@/hooks/useAuth';
import type { Venue, Review } from '@/types';

export default function ModerationScreen() {
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();

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
                  onPress={() =>
                    Alert.prompt('Rejection reason', 'Optional note for the submitter:', (notes) =>
                      moderateVenue.mutate({ id: venue.id, action: 'rejected', notes })
                    )
                  }
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
