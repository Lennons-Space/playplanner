/**
 * Business Dashboard — for venue owners who have claimed a listing.
 * Shows analytics, lets them edit their venue, post offers, and upgrade plan.
 */
import { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { PAYMENTS_ENABLED } from '@/constants/features';
import type { Venue } from '@/types';

export default function BusinessDashboard() {
  const user = useUser();

  // Guard: unauthenticated users must not reach the business dashboard.
  // useEffect is used instead of an early return before the hook calls below —
  // React requires all hooks to be called unconditionally on every render
  // (rules of hooks). useEffect fires after render, which is safe here
  // because the component renders null while the redirect is in flight.
  useEffect(() => {
    if (!user) {
      router.replace('/(auth)/login');
    }
  }, [user]);

  const { data: claimedVenues = [], isLoading, error } = useQuery({
    queryKey: ['claimed-venues', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('venues')
        .select('*, subscription:business_subscriptions(plan, status)')
        .eq('claimed_by', user!.id);
      return (data ?? []) as Venue[];
    },
    // Only run when a user is present — no-op guard for the unauthenticated case
    // while the useEffect redirect is in-flight.
    enabled: !!user,
  });

  if (!user) return null;

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-slate items-center justify-center" edges={['top']}>
        <ActivityIndicator size="large" color="#4ECDC4" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-slate" edges={['top']}>
        <View className="flex-row items-center gap-2 pt-4 pb-2 px-4">
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-sky">←</Text>
          </TouchableOpacity>
          <Text className="text-2xl font-extrabold text-charcoal">Business Dashboard</Text>
        </View>
        <Text className="text-coral text-center mt-16 px-4">
          Could not load your venues. Please check your connection and try again.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate" edges={['top']}>
      <ScrollView className="px-4">
        <View className="flex-row items-center gap-2 pt-4 pb-2">
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-sky">←</Text>
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
              className="bg-sky rounded-2xl px-6 py-3 mt-6"
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
                  <Text className="text-2xl font-extrabold text-coral">
                    {venue.average_rating != null ? `★${venue.average_rating.toFixed(1)}` : '—'}
                  </Text>
                  <Text className="text-grey text-xs">Rating</Text>
                </View>
                <View className="flex-1 bg-sandDark rounded-xl p-3 items-center">
                  <Text className="text-2xl font-extrabold text-coral">—</Text>
                  <Text className="text-grey text-xs">Views</Text>
                </View>
              </View>

              {/* Actions */}
              {!venue.is_premium && (
                <TouchableOpacity
                  className="border-2 border-sun rounded-xl py-3 items-center"
                  onPress={() => router.push('/business/upgrade')}
                >
                  <Text className="text-charcoal font-bold">
                    {PAYMENTS_ENABLED ? '⭐ Upgrade to Premium' : '⭐ Premium — coming soon'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
