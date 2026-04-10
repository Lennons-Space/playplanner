/**
 * Business Dashboard — for venue owners who have claimed a listing.
 * Shows analytics, lets them edit their venue, post offers, and upgrade plan.
 */
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import type { Venue } from '@/types';

export default function BusinessDashboard() {
  const user = useUser();

  const { data: claimedVenues = [] } = useQuery({
    queryKey: ['claimed-venues', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('venues')
        .select('*, subscription:business_subscriptions(plan, status)')
        .eq('claimed_by', user!.id);
      return (data ?? []) as Venue[];
    },
    enabled: !!user,
  });

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      <ScrollView className="px-4">
        <View className="flex-row items-center gap-2 pt-4 pb-2">
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-coral">←</Text>
          </TouchableOpacity>
          <Text className="text-2xl font-extrabold text-charcoal">Business Dashboard</Text>
        </View>

        {claimedVenues.length === 0 ? (
          <View className="items-center mt-16">
            <Text className="text-5xl mb-4">🏢</Text>
            <Text className="text-charcoal font-bold text-lg">No claimed venues yet</Text>
            <Text className="text-grey text-center mt-2">
              Find your venue in the app and tap "Claim this listing" to take ownership.
            </Text>
            <TouchableOpacity
              className="bg-coral rounded-2xl px-6 py-3 mt-6"
              onPress={() => router.push('/(tabs)')}
            >
              <Text className="text-white font-bold">Find my venue</Text>
            </TouchableOpacity>
          </View>
        ) : (
          claimedVenues.map((venue) => (
            <View key={venue.id} className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
              <Text className="text-charcoal font-extrabold text-lg">{venue.name}</Text>
              <Text className="text-grey text-sm mb-3">{venue.city}</Text>

              {/* Stats row */}
              <View className="flex-row gap-3 mb-4">
                <View className="flex-1 bg-sandDark rounded-xl p-3 items-center">
                  <Text className="text-2xl font-extrabold text-coral">{venue.review_count}</Text>
                  <Text className="text-grey text-xs">Reviews</Text>
                </View>
                <View className="flex-1 bg-sandDark rounded-xl p-3 items-center">
                  <Text className="text-2xl font-extrabold text-coral">★{venue.average_rating.toFixed(1)}</Text>
                  <Text className="text-grey text-xs">Rating</Text>
                </View>
                <View className="flex-1 bg-sandDark rounded-xl p-3 items-center">
                  <Text className="text-2xl font-extrabold text-coral">—</Text>
                  <Text className="text-grey text-xs">Views</Text>
                </View>
              </View>

              {/* Actions */}
              <View className="gap-2">
                <TouchableOpacity
                  className="bg-coral rounded-xl py-3 items-center"
                  onPress={() => {/* TODO: edit venue */}}
                >
                  <Text className="text-white font-bold">Edit listing</Text>
                </TouchableOpacity>
                {!venue.is_premium && (
                  <TouchableOpacity
                    className="border-2 border-sun rounded-xl py-3 items-center"
                    onPress={() => router.push('/business/upgrade')}
                  >
                    <Text className="text-charcoal font-bold">⭐ Upgrade to Premium</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
