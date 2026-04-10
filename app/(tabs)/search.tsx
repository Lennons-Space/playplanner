/**
 * Search tab — text search + category grid
 */
import { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocation } from '@/hooks/location';
import { useVenueSearch } from '@/hooks/useVenues';
import type { Venue } from '@/types';

// TODO: Replace with real SearchBar component
function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      className="bg-white border border-greyLighter rounded-2xl px-4 py-3 text-charcoal text-base"
      placeholder="Search venues, parks, soft plays..."
      value={value}
      onChangeText={onChange}
      autoCorrect={false}
    />
  );
}

export default function SearchScreen() {
  const [query, setQuery]  = useState('');
  const { coords }         = useLocation();
  const { data: results = [], isLoading } = useVenueSearch(query, coords);

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-extrabold text-charcoal mb-3">Search</Text>
        <SearchBar value={query} onChange={setQuery} />
      </View>

      {isLoading && query.length >= 2 ? (
        <ActivityIndicator className="mt-8" color="#FF6B6B" />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            query.length >= 2 ? (
              <Text className="text-grey text-center mt-8">No venues found for "{query}"</Text>
            ) : (
              <Text className="text-grey text-center mt-8">
                Start typing to search for venues near you
              </Text>
            )
          }
          renderItem={({ item }: { item: Venue }) => (
            <TouchableOpacity
              className="bg-white rounded-2xl p-4 flex-row items-center gap-3 shadow-sm"
              onPress={() => router.push(`/venue/${item.id}`)}
            >
              <View className="w-12 h-12 rounded-xl bg-sandDark items-center justify-center">
                <Text className="text-2xl">{item.category?.icon ?? '📍'}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-charcoal font-bold text-base">{item.name}</Text>
                <Text className="text-grey text-sm">{item.city} · {item.category?.name}</Text>
                <Text className="text-coral text-sm font-bold">★ {item.average_rating.toFixed(1)} ({item.review_count})</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
