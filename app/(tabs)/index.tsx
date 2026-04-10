/**
 * Map / Explore tab — the main home screen
 * Shows a full-screen map with venue pins and a bottom filter bar.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useLocation } from '@/hooks/location';
import { useNearbyVenues } from '@/hooks/useVenues';
import { useFilterStore } from '@/store/filterStore';
import { Colors } from '@/constants/theme';
import type { Venue } from '@/types';

export default function ExploreScreen() {
  const { coords, isLoading: locLoading } = useLocation();
  const filters = useFilterStore((s) => s.filters);
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount());
  const { data: venues = [], isLoading } = useNearbyVenues(coords, filters);

  return (
    <View className="flex-1">
      {/* Map takes the full screen */}
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={{
          ...coords,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
      >
        {venues.map((venue: Venue) => (
          <Marker
            key={venue.id}
            coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
            title={venue.name}
            onCalloutPress={() => router.push(`/venue/${venue.id}`)}
          >
            {/* TODO: Replace with custom VenuePin component */}
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: venue.is_premium ? Colors.sun : Colors.coral }}
            >
              <Text className="text-white font-bold text-xs">
                {venue.category?.icon ?? '📍'}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Filter button (floating, bottom-left) */}
      <SafeAreaView className="absolute bottom-4 left-4" edges={['bottom']}>
        <TouchableOpacity
          className="bg-white rounded-full px-5 py-3 flex-row items-center gap-2 shadow-md"
          onPress={() => {/* TODO: open FilterSheet */}}
        >
          <Text className="text-charcoal font-bold">Filters</Text>
          {activeFilterCount > 0 && (
            <View className="bg-coral rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-xs font-bold">{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </SafeAreaView>

      {/* Add venue button (floating, bottom-right) */}
      <SafeAreaView className="absolute bottom-4 right-4" edges={['bottom']}>
        <TouchableOpacity
          className="bg-coral rounded-full w-14 h-14 items-center justify-center shadow-md"
          onPress={() => router.push('/venue/add')}
        >
          <Text className="text-white text-3xl font-bold">+</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}
