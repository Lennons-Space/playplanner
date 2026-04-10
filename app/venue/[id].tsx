/**
 * Venue detail screen
 * Shows everything about a single venue: photos, info, hours, reviews.
 */
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVenue } from '@/hooks/useVenues';
import { useUser } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns a user-friendly message based on the error type. */
function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('network') || message.includes('fetch')) {
    return 'Could not load venue. Check your connection.';
  }
  return 'Venue not found.';
}

export default function VenueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const queryClient = useQueryClient();

  const { data: venue, isLoading, error } = useVenue(id);

  // Check if this venue is in the user's favourites
  const { data: isFavourited } = useQuery({
    queryKey: ['favourite', user?.id, id],
    queryFn: async () => {
      const { data } = await supabase
        .from('favourites')
        .select('id')
        .eq('user_id', user!.id)
        .eq('venue_id', id)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!id,
  });

  const toggleFavourite = useMutation({
    mutationFn: async () => {
      if (isFavourited) {
        await supabase.from('favourites').delete().eq('user_id', user!.id).eq('venue_id', id);
      } else {
        await supabase.from('favourites').insert({ user_id: user!.id, venue_id: id });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favourite', user?.id, id] });
      queryClient.invalidateQueries({ queryKey: ['favourites', user?.id] });
    },
    onError: () => {
      Alert.alert(
        'Favourites error',
        'Could not update favourites. Please check your connection and try again.'
      );
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center">
        <ActivityIndicator color={Colors.coral} size="large" />
      </SafeAreaView>
    );
  }

  if (error || !venue) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg text-center">
          {error ? getErrorMessage(error) : 'Venue not found.'}
        </Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}>
          <Text className="text-coral">← Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const coverPhoto = venue.photos?.find((p) => p.is_cover) ?? venue.photos?.[0];

  return (
    <View className="flex-1 bg-sand">
      <ScrollView>
        {/* Cover photo area */}
        <View className="h-56 bg-sandDark items-center justify-center">
          {coverPhoto
            ? null /* TODO: <Image source={{ uri: coverPhoto.url }} className="w-full h-full" /> */
            : <Text className="text-8xl">{venue.category?.icon ?? '📍'}</Text>}

          {/* Back button */}
          <TouchableOpacity
            className="absolute top-12 left-4 bg-white rounded-full w-10 h-10 items-center justify-center shadow-sm"
            onPress={() => router.back()}
          >
            <Text className="text-charcoal font-bold">←</Text>
          </TouchableOpacity>

          {/* Favourite button */}
          <TouchableOpacity
            className="absolute top-12 right-4 bg-white rounded-full w-10 h-10 items-center justify-center shadow-sm"
            onPress={() => toggleFavourite.mutate()}
          >
            <Text className="text-xl">{isFavourited ? '❤️' : '🤍'}</Text>
          </TouchableOpacity>
        </View>

        <View className="px-4 pt-4">
          {/* Name & badges */}
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-2xl font-extrabold text-charcoal">{venue.name}</Text>
              <Text className="text-grey">{venue.city} · {venue.category?.name}</Text>
            </View>
            {venue.is_premium && (
              <View className="bg-sun rounded-full px-3 py-1">
                <Text className="text-charcoal font-bold text-xs">⭐ Featured</Text>
              </View>
            )}
          </View>

          {/* Rating */}
          <View className="flex-row items-center gap-2 mt-2">
            <Text className="text-coral font-bold text-lg">★ {venue.average_rating.toFixed(1)}</Text>
            <Text className="text-grey">({venue.review_count} reviews)</Text>
          </View>

          {/* Quick info chips */}
          <View className="flex-row flex-wrap gap-2 mt-3">
            {venue.price_range && (
              <View className="bg-sandDark rounded-full px-3 py-1">
                <Text className="text-charcoal text-sm capitalize">{venue.price_range}</Text>
              </View>
            )}
            <View className="bg-sandDark rounded-full px-3 py-1">
              <Text className="text-charcoal text-sm">Ages {venue.min_age}–{venue.max_age}</Text>
            </View>
            {venue.is_verified && (
              <View className="bg-mint rounded-full px-3 py-1">
                <Text className="text-charcoal text-sm">✓ Verified</Text>
              </View>
            )}
          </View>

          {/* Description */}
          {venue.description && (
            <Text className="text-charcoal mt-4 leading-6">{venue.description}</Text>
          )}

          {/* Contact buttons */}
          <View className="flex-row gap-3 mt-4">
            {venue.phone && (
              <TouchableOpacity
                className="flex-1 bg-coral rounded-xl py-3 items-center"
                onPress={() => Linking.openURL(`tel:${venue.phone}`)}
              >
                <Text className="text-white font-bold">📞 Call</Text>
              </TouchableOpacity>
            )}
            {venue.website && (
              <TouchableOpacity
                className="flex-1 bg-sky rounded-xl py-3 items-center"
                onPress={() => Linking.openURL(venue.website!)}
              >
                <Text className="text-white font-bold">🌐 Website</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Facilities */}
          {venue.facilities && venue.facilities.length > 0 && (
            <View className="mt-6">
              <Text className="text-charcoal font-bold text-lg mb-3">Facilities</Text>
              <View className="flex-row flex-wrap gap-2">
                {venue.facilities.map((f: any) => (
                  <View key={f.facility?.id ?? f.id} className="bg-white border border-greyLighter rounded-xl px-3 py-2 flex-row items-center gap-1">
                    <Text>{f.facility?.icon ?? f.icon}</Text>
                    <Text className="text-charcoal text-sm">{f.facility?.name ?? f.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Opening hours */}
          {venue.opening_hours && venue.opening_hours.length > 0 && (
            <View className="mt-6">
              <Text className="text-charcoal font-bold text-lg mb-3">Opening hours</Text>
              {venue.opening_hours
                .sort((a, b) => a.day_of_week - b.day_of_week)
                .map((h) => (
                  <View key={h.id} className="flex-row justify-between py-1 border-b border-greyLighter">
                    <Text className="text-charcoal w-12">{DAYS[h.day_of_week]}</Text>
                    {h.is_closed
                      ? <Text className="text-error">Closed</Text>
                      : <Text className="text-charcoal">{h.opens_at} – {h.closes_at}</Text>}
                  </View>
                ))}
            </View>
          )}

          {/* Address */}
          <View className="mt-6">
            <Text className="text-charcoal font-bold text-lg mb-1">Address</Text>
            <Text className="text-grey">{[venue.address_line1, venue.address_line2, venue.city, venue.postcode].filter(Boolean).join(', ')}</Text>
          </View>

          {/* Reviews section — placeholder */}
          <View className="mt-6 mb-10">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-charcoal font-bold text-lg">Reviews</Text>
              <TouchableOpacity onPress={() => {/* TODO: navigate to write review */}}>
                <Text className="text-coral font-bold">Write a review</Text>
              </TouchableOpacity>
            </View>
            {/* TODO: ReviewList component */}
            <Text className="text-grey">Reviews coming soon...</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
