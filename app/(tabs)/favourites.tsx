/**
 * Favourites tab — saved venues lists
 */
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import type { Favourite } from '@/types';

export default function FavouritesScreen() {
  const user = useUser();

  const { data: favourites = [], isLoading } = useQuery({
    queryKey: ['favourites', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('favourites')
        .select('*, venue:venues(id, name, city, average_rating, review_count, category:categories(icon, name), photos:venue_photos(url, is_cover))')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Favourite[];
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-sand items-center justify-center">
        <ActivityIndicator color="#FF6B6B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-extrabold text-charcoal">Favourites</Text>
      </View>

      <FlatList
        data={favourites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <View className="items-center mt-16">
            <Text className="text-5xl mb-4">💛</Text>
            <Text className="text-charcoal font-bold text-lg">No favourites yet</Text>
            <Text className="text-grey text-center mt-2">
              Tap the heart icon on any venue to save it here.
            </Text>
          </View>
        }
        renderItem={({ item }: { item: Favourite }) => (
          <TouchableOpacity
            className="bg-white rounded-2xl p-4 flex-row items-center gap-3 shadow-sm"
            onPress={() => router.push(`/venue/${item.venue_id}`)}
          >
            <View className="w-12 h-12 rounded-xl bg-sandDark items-center justify-center">
              <Text className="text-2xl">{item.venue?.category?.icon ?? '📍'}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-charcoal font-bold text-base">{item.venue?.name}</Text>
              <Text className="text-grey text-sm">{item.venue?.city} · {item.venue?.category?.name}</Text>
              <Text className="text-coral text-sm font-bold">
                ★ {item.venue?.average_rating?.toFixed(1)} ({item.venue?.review_count})
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
